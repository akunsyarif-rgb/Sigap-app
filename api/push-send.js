// ===== api/push-send.js =====
// Fungsi serverless Vercel — SATU-SATUNYA tempat di seluruh arsitektur SIGAP
// yang benar-benar menandatangani (VAPID/ES256) dan mengirim Web Push. Google
// Apps Script TIDAK bisa melakukan ini sendiri (tidak ada ECDSA/ECDH/AES-GCM
// di Apps Script — lihat catatan panjang di Notifikasi.gs dan CLAUDE.md,
// bagian Push Notification). Fungsi ini sengaja PATUH ("dumb relay"): dia
// tidak tahu apa pun soal siswa/kelas/wali kelas/piket — itu semua sudah
// diputuskan GAS SEBELUM memanggil endpoint ini. Tugasnya cuma dua: (1)
// pastikan pemanggilnya memang GAS SIGAP (Authorization: Bearer
// PUSH_RELAY_SECRET), (2) kirim tiap {subscription, payload} lewat web-push
// dan laporkan hasilnya per item.
//
// Ini fungsi Node di project Vercel yang SAMA yang sudah meng-hosting
// frontend statis SIGAP (lihat CLAUDE.md) — bukan hosting/vendor baru.
// Vercel otomatis mendeteksi folder /api sebagai serverless functions untuk
// project statis, tidak perlu konfigurasi tambahan.
//
// Env var yang WAJIB diisi di dashboard Vercel (Project Settings > Environment
// Variables) — TIDAK ADA satu pun yang boleh masuk ke repo git:
//   VAPID_PUBLIC_KEY   - lihat CLAUDE.md untuk cara generate (web-push generate-vapid-keys)
//   VAPID_PRIVATE_KEY  - PASANGAN dari kunci publik di atas, RAHASIA
//   VAPID_SUBJECT      - 'mailto:admin@sekolah.contoh' (disyaratkan spesifikasi VAPID)
//   PUSH_RELAY_SECRET  - string acak, HARUS SAMA PERSIS dengan Script Property
//                        PUSH_RELAY_SECRET di Apps Script (lihat Notifikasi.gs)
const webpush = require('web-push');

// Batas jumlah item per panggilan — sesuai ukuran antrean satu tick trigger
// GAS (PUSH_QUEUE_BATCH_SIZE di Notifikasi.gs mengalikan jumlah kejadian
// dengan jumlah perangkat per penerima), diberi ruang lebih supaya tidak
// mepet, TAPI tetap dibatasi supaya satu request yang disalahgunakan (kalau
// PUSH_RELAY_SECRET bocor) tidak bisa dipakai mengirim jutaan notifikasi
// sekali panggil.
const MAX_ITEMS_PER_REQUEST = 200;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const relaySecret = process.env.PUSH_RELAY_SECRET;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!relaySecret || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    // Tidak pernah menyebutkan env var mana yang kosong di respons —
    // pesan ini bisa saja diterima pemanggil selain GAS SIGAP.
    res.status(500).json({ error: 'relay_not_configured' });
    return;
  }

  const authHeader = String(req.headers.authorization || '');
  const expected = 'Bearer ' + relaySecret;
  if (!timingSafeEqualString(authHeader, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : safeParseJson(req.body);
  const items = Array.isArray(body && body.items) ? body.items : [];
  if (!items.length) {
    res.status(400).json({ error: 'no_items' });
    return;
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    res.status(400).json({ error: 'too_many_items' });
    return;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const results = await Promise.all(items.map(async (item) => {
    const subscription = item && item.subscription;
    const endpoint = item && item.endpoint;
    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
      return { endpoint: endpoint || null, ok: false, gone: false, error: 'invalid_subscription' };
    }
    const payload = JSON.stringify(item.payload || {});
    try {
      await webpush.sendNotification(subscription, payload);
      return { endpoint: subscription.endpoint, ok: true };
    } catch (err) {
      // 404/410 = layanan push bilang subscription ini sudah tidak berlaku
      // (pengguna uninstall/reset izin/dst.) — GAS memakai flag `gone` ini
      // untuk membersihkan Push_Subscriptions, BUKAN sekadar retry.
      const statusCode = err && err.statusCode;
      const gone = statusCode === 404 || statusCode === 410;
      return { endpoint: subscription.endpoint, ok: false, gone: gone, statusCode: statusCode || null };
    }
  }));

  res.status(200).json({ results: results });
};

function safeParseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

// Perbandingan waktu-konstan sederhana untuk header Authorization — mencegah
// timing attack menebak PUSH_RELAY_SECRET karakter demi karakter. Panjang
// berbeda dibandingkan dulu (aman dibocorkan — panjang secret bukan rahasia
// yang sensitif) baru isinya lewat crypto.timingSafeEqual.
function timingSafeEqualString(a, b) {
  const crypto = require('crypto');
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
