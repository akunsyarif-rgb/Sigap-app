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

function createSession(user) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('sess_' + token, JSON.stringify(user), 21600); // 6 jam
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sess_' + token);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
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
