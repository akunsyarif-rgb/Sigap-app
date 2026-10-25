// deno-lint-ignore-file no-explicit-any
import { getSession, MSG_SESSION_END } from "./logic.ts";
import { isOsis, MSG_NO_ACCESS } from "./data.ts";
import { bersihkan } from "./errorlog.ts";
export const PUSH_MAX_ENDPOINT = 2048;
export const PUSH_MAX_KUNCI = 256;
export const PUSH_MAX_UA = 200;
const MSG_TIDAK_LENGKAP = "Data subscription tidak lengkap.";
const MSG_TIDAK_VALID = "Data subscription tidak valid.";
const teks = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
export function bacaLangganan(body: any):
{ ok: true; endpoint: string; p256dh: string; auth: string; ua: string } | { ok: false; message: string } {
const sub = body?.subscription && typeof body.subscription === "object" ? body.subscription : {};
const keys = sub.keys && typeof sub.keys === "object" ? sub.keys : {};
const endpoint = teks(sub.endpoint), p256dh = teks(keys.p256dh), auth = teks(keys.auth);
if (!endpoint || !p256dh || !auth) return { ok: false, message: MSG_TIDAK_LENGKAP };
if (!/^https:\/\//i.test(endpoint) || endpoint.length > PUSH_MAX_ENDPOINT || p256dh.length > PUSH_MAX_KUNCI || auth.length > PUSH_MAX_KUNCI) {
return { ok: false, message: MSG_TIDAK_VALID };
}
return { ok: true, endpoint, p256dh, auth, ua: bersihkan(body?.userAgent, PUSH_MAX_UA) };
}
export async function simpanLangganan(db: any, guruId: string, l: { endpoint: string; p256dh: string; auth: string; ua: string }) {
await db`
insert into sigap.push_subscription (endpoint, guru_id, p256dh, auth, user_agent)
values (${l.endpoint}, ${guruId}, ${l.p256dh}, ${l.auth}, ${l.ua})
on conflict (endpoint) do update
set guru_id = excluded.guru_id, p256dh = excluded.p256dh, auth = excluded.auth,
user_agent = excluded.user_agent, diperbarui = now()`;
}
export async function hapusLangganan(db: any, guruId: string, endpoint: string) {
await db`delete from sigap.push_subscription where endpoint = ${endpoint} and guru_id = ${guruId}`;
}
export async function doSavePushSubscription(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
if (isOsis(s.user)) return { status: "error", message: MSG_NO_ACCESS };
const l = bacaLangganan(body);
if (!l.ok) return { status: "error", message: l.message };
await simpanLangganan(sql, s.user.id, l);
return { status: "success" };
}
export async function doDeletePushSubscription(sql: any, body: any) {
const s = await getSession(sql, body?.sessionToken);
if (!s) return { status: "error", message: MSG_SESSION_END };
const endpoint = teks(body?.endpoint);
if (endpoint && endpoint.length <= PUSH_MAX_ENDPOINT) await hapusLangganan(sql, s.user.id, endpoint);
return { status: "success" };
}
