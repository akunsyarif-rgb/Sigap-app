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

// ===== Umur sesi & put ulang =====
// KEBIJAKAN UMUR SESI TIDAK BERUBAH: sesi tetap berlaku MAKSIMAL 6 jam sejak
// login, persis seperti sebelumnya. Batas ini ditegakkan eksplisit lewat
// loginAt di dalam record (SESSION_ABSOLUTE_MAX_MS), jadi tidak lagi hanya
// bergantung pada TTL entri cache-nya sendiri.
//
// Yang ditambahkan cuma put ulang setiap request: CacheService Apps Script
// boleh membuang entri LEBIH CEPAT daripada TTL-nya kalau memori sedang
// ketat, dan entri sesi yang dibuang lebih awal muncul di sisi guru sebagai
// "Sesi berakhir" yang tidak bisa dijelaskan. Menulis ulang record yang sama
// tiap request membuat entri itu tetap hangat. Karena batas mutlaknya 6 jam
// juga, put ulang ini TIDAK memperpanjang umur sesi — begitu lewat 6 jam sejak
// login, sesinya ditolak walau baru saja di-put ulang.
var SESSION_TTL_SECONDS = 21600;                 // 6 jam — batas maksimum SATU CacheService.put()
var SESSION_ABSOLUTE_MAX_MS = 6 * 60 * 60 * 1000; // 6 jam sejak login — sama seperti kebijakan lama

function createSession(user) {
  var token = Utilities.getUuid();
  // loginAt disimpan DI DALAM record sesi (bukan entri cache terpisah) supaya
  // batas mutlak di atas ikut terbawa setiap kali record-nya di-put ulang.
  var record = { user: user, loginAt: Date.now() };
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(record), SESSION_TTL_SECONDS);
  return token;
}

// Diisi getSessionUser() dengan BATAS AKHIR sesi ini (loginAt + 6 jam), lalu
// dilampirkan ke respons oleh jsonOut() di Utils.gs supaya klien memakai
// angka dari server, bukan menebak sendiri dari jam HP-nya. 0 = request ini
// tidak menyentuh sesi (mis. login/logout/Unauthorized).
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
  // sebelum perubahan ini tetap berlaku sampai TTL-nya habis sendiri, tapi
  // tidak di-put ulang karena waktu login-nya tidak diketahui, jadi batas 6 jam
  // tidak bisa ditegakkan atasnya.
  if (!parsed.user) return parsed;

  var loginAt = Number(parsed.loginAt) || 0;
  var now = Date.now();
  if (loginAt && now - loginAt >= SESSION_ABSOLUTE_MAX_MS) {
    cache.remove('sess_' + token);
    return null;
  }
  // Put ulang supaya entri tidak dibuang cache lebih cepat dari waktunya.
  // Kegagalan put di sini TIDAK boleh menggagalkan request-nya — sesi yang ada
  // tetap sah sampai TTL sebelumnya habis.
  try {
    cache.put('sess_' + token, raw, SESSION_TTL_SECONDS);
    // Batas akhir sesungguhnya tetap 6 jam sejak login, BUKAN 6 jam dari
    // sekarang: put ulang menjaga entri tetap hidup, tidak memperpanjang umur.
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
