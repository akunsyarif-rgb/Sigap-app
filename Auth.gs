// ===== AUTH.gs =====
// Semua yang berkaitan dengan sesi login & pengecekan hak akses (role).
// Dipanggil dari Main.gs setiap ada aksi yang butuh verifikasi identitas.

// ===== SESI LOGIN (diverifikasi server, bukan dipercaya begitu saja dari client) =====
// Sebelumnya, aksi admin/BK hanya mengandalkan "requesterId" yang dikirim dari
// HP/browser — itu bisa dilihat & dipalsukan siapa saja lewat Inspect/View Source.
// Sekarang, begitu login berhasil, server menyimpan sesi (siapa & apa rolenya) dan
// memberi client sebuah token sesi acak. Setiap aksi berikutnya diverifikasi lewat
// token itu — server sendiri yang cek rolenya, bukan percaya klaim dari client.
//
// 21600 detik (6 jam) adalah batas MAKSIMUM yang diizinkan Apps Script untuk
// CacheService.put() — bukan angka sembarang, tidak bisa diperpanjang lagi
// tanpa ganti mekanisme penyimpanan sesi sama sekali.

// ===== Perpanjangan sesi (sliding) =====
// Sebelumnya sesi di-put SEKALI saat login dan tidak pernah disentuh lagi,
// jadi sesi mati tepat 6 jam sejak login WALAU guru sedang aktif memakainya —
// logout mendadak di tengah jam pelajaran, tanpa alasan yang bisa dijelaskan
// ke penggunanya. Sekarang setiap request yang sesinya masih sah memperpanjang
// masa berlakunya 6 jam lagi ke depan (put ulang; 21600 detik tetap batas
// maksimum SATU put di Apps Script, jadi perpanjangannya harus per-request
// seperti ini, bukan sekali dengan TTL lebih panjang).
//
// Tetap ada batas mutlak sejak login supaya token yang tersimpan di
// localStorage tidak bisa hidup selamanya hanya karena terus dipakai.
var SESSION_TTL_SECONDS = 21600;                    // 6 jam — batas maksimum CacheService.put()
var SESSION_ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari sejak login

function createSession(user) {
  var token = Utilities.getUuid();
  // loginAt disimpan DI DALAM record sesi (bukan entri cache terpisah) supaya
  // batas mutlak di atas ikut terbawa setiap kali record-nya di-put ulang.
  var record = { user: user, loginAt: Date.now() };
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(record), SESSION_TTL_SECONDS);
  return token;
}

// Diisi getSessionUser() setiap kali sesi berhasil diperpanjang, lalu
// dilampirkan ke respons oleh jsonOut() di Utils.gs supaya klien tahu sampai
// kapan sesinya sekarang berlaku. 0 = tidak ada perpanjangan pada request ini.
var SESSION_RENEWED_UNTIL = 0;

function getSessionUser(token) {
  SESSION_RENEWED_UNTIL = 0;
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('sess_' + token);
  if (!raw) return null;
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed) return null;

  // Record format lama (objek user polos, tanpa pembungkus) — sesi yang dibuat
  // sebelum perubahan ini tetap berlaku sampai habis sendiri, tapi tidak ikut
  // diperpanjang karena umur aslinya tidak diketahui.
  if (!parsed.user) return parsed;

  var loginAt = Number(parsed.loginAt) || 0;
  var now = Date.now();
  if (loginAt && now - loginAt >= SESSION_ABSOLUTE_MAX_MS) {
    cache.remove('sess_' + token);
    return null;
  }
  // Perpanjang. Kegagalan put di sini TIDAK boleh menggagalkan request-nya —
  // sesi yang ada tetap sah sampai TTL sebelumnya habis.
  try {
    cache.put('sess_' + token, raw, SESSION_TTL_SECONDS);
    var until = now + SESSION_TTL_SECONDS * 1000;
    if (loginAt) until = Math.min(until, loginAt + SESSION_ABSOLUTE_MAX_MS);
    SESSION_RENEWED_UNTIL = until;
  } catch (e) {}
  return parsed.user;
}

// ===== Verifikasi password (dua skema, migrasi otomatis) =====
// storedSalt kosong = akun belum pernah login sejak salt ditambahkan (skema
// lama). Kalau match lewat skema lama, needsMigration:true dikembalikan —
// pemanggil (doPost 'login') yang urus tulis salt+hash baru ke sheet SAAT
// itu juga, karena ini satu-satunya momen kita masih pegang password asli
// (belum di-lowercase, belum di-hash). Fungsi ini sendiri tidak menulis apa
// pun, murni pengecekan, supaya gampang dites terpisah.
function verifyPassword(inputPassword, storedHash, storedSalt) {
  if (storedSalt) {
    return hashPasswordSalted(inputPassword, storedSalt) === storedHash ? { matched: true, needsMigration: false } : null;
  }
  return hashPasswordLegacy(inputPassword) === storedHash ? { matched: true, needsMigration: true } : null;
}

function normalizeRole(role) {
  return String(role || '').toLowerCase().trim();
}

// admin: akses penuh
function isAdminRole(role) {
  return normalizeRole(role) === 'admin';
}

// bk: guru BK / tim kesiswaan — punya semua hak Guru + Bimbingan Khusus + Pelanggaran Upacara
function isBkRole(role) {
  var r = normalizeRole(role);
  return r === 'admin' || r === 'bk_kesiswaan';
}

// osis: siswa OSIS — HANYA boleh akses Pelanggaran Upacara (punya sendiri)
function isOsisRole(role) {
  return normalizeRole(role) === 'osis';
}
