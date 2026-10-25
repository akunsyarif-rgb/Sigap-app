// deno-lint-ignore-file no-explicit-any
// Pengirim Web Push SIGAP (Jalur A). Hanya melayani pemicu internal (Bearer push_internal_secret dari Vault).
// Endpoint tujuan HANYA dari sigap.push_subscription. Kunci VAPID dari Vault. Tidak pernah mengembalikan rahasia.
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";

const BATCH = 30;
const MAX_PERCOBAAN = 6;
const CLAIM_DETIK = 90;
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function samaWaktuKonstan(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ status: "error", message: "metode tidak didukung" }, 405);
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    const rs = await sql`select name, decrypted_secret as v from vault.decrypted_secrets where name in ('vapid_public_key','vapid_private_key','vapid_subject','push_internal_secret')`;
    const S: Record<string, string> = {};
    for (const r of rs) S[r.name] = r.v;
    if (!S.vapid_public_key || !S.vapid_private_key || !S.vapid_subject || !S.push_internal_secret) return json({ status: "error", message: "belum_dikonfigurasi" }, 500);
    const auth = req.headers.get("authorization") ?? "";
    if (!samaWaktuKonstan(auth, "Bearer " + S.push_internal_secret)) return json({ status: "error", message: "tidak diizinkan" }, 401);
    webpush.setVapidDetails(S.vapid_subject, S.vapid_public_key, S.vapid_private_key);

    // Klaim batch (SKIP LOCKED) supaya dua pemicu yang tumpang tindih tidak mengirim baris yang sama.
    const baris: any[] = await sql`
      update sigap.push_queue q set claim_until = now() + make_interval(secs => ${CLAIM_DETIK})
      where q.id in (
        select id from sigap.push_queue
        where not diproses and (claim_until is null or claim_until < now())
        order by id limit ${BATCH} for update skip locked)
      returning q.id, q.guru_id, q.title, q.body, q.url, q.event_id, q.percobaan`;

    let terkirim = 0, gagal = 0, tanpaLangganan = 0, dihapus = 0;
    for (const b of baris) {
      const subs: any[] = await sql`select endpoint, p256dh, auth from sigap.push_subscription where guru_id = ${b.guru_id}`;
      if (!subs.length) {
        await sql`update sigap.push_queue set diproses = true, selesai_pada = now(), last_error = 'no_subscription', claim_until = null where id = ${b.id}`;
        tanpaLangganan++;
        continue;
      }
      const payload = JSON.stringify({ title: b.title, body: b.body, url: b.url, tag: b.event_id });
      let ada = false, galat = "";
      await Promise.all(subs.map(async (s) => {
        try {
          // Semua notifikasi SIGAP berprioritas tinggi (keputusan pemilik): urgency 'high'.
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high", timeout: 10000 });
          ada = true;
        } catch (e: any) {
          const sc = e?.statusCode;
          if (sc === 404 || sc === 410) {
            await sql`delete from sigap.push_subscription where endpoint = ${s.endpoint}`;
            dihapus++;
          } else if (!galat) {
            galat = "send_failed: " + (sc ? "HTTP " + sc : String(e?.message ?? e).slice(0, 120));
          }
        }
      }));
      if (ada) {
        await sql`update sigap.push_queue set diproses = true, selesai_pada = now(), last_error = '', claim_until = null where id = ${b.id}`;
        terkirim++;
      } else if (!galat) {
        // semua langganan guru ini sudah kedaluwarsa (404/410) dan terhapus
        await sql`update sigap.push_queue set diproses = true, selesai_pada = now(), last_error = 'no_subscription', claim_until = null where id = ${b.id}`;
        tanpaLangganan++;
      } else {
        const p = (b.percobaan ?? 0) + 1;
        if (p >= MAX_PERCOBAAN) {
          await sql`update sigap.push_queue set diproses = true, selesai_pada = now(), percobaan = ${p}, last_error = ${galat + " (max_attempts reached)"}, claim_until = null where id = ${b.id}`;
        } else {
          await sql`update sigap.push_queue set percobaan = ${p}, last_error = ${galat}, claim_until = null where id = ${b.id}`;
        }
        gagal++;
      }
    }
    return json({ status: "success", diklaim: baris.length, terkirim, gagal, tanpa_langganan: tanpaLangganan, langganan_dihapus: dihapus });
  } catch (e) {
    console.error("push-send error:", e instanceof Error ? e.message : String(e));
    return json({ status: "error", message: "gagal" }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
