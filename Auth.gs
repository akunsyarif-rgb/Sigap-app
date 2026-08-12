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

// ===== IDENTITAS AKUN (Master_Guru) =====
// Posisi kolom Master_Guru dikumpulkan di satu tempat supaya index ajaib
// (rows[i][7] dst.) tidak tersebar di banyak file. JANGAN mengubah angka di
// sini tanpa memindahkan kolomnya di Sheet — data lama membaca posisi ini.
// Kolom I (Login_Mode) BARU: diisi 'pin' begitu kredensial akun diset lewat
// skema PIN (tambah guru / reset PIN). Baris lama nilainya kosong = masih
// pakai password bebas warisan skema lama.
var GURU_COL = { ID: 0, NAMA: 1, HASH: 2, ROLE: 3, JABATAN: 4, STATUS: 5, KELAS_WALI: 6, SALT: 7, LOGIN_MODE: 8 };
var GURU_LOGIN_MODE_PIN = 'pin';

// Cari baris guru LANGSUNG lewat ID akun — inti dari upgrade login Nama+PIN:
// jalur lama harus menjajal verifyPassword() ke setiap baris sampai ketemu
// (makin lambat & makin rawan makin banyak guru), jalur baru cukup sekali
// lewat karena identitas akun sudah ditentukan di layar login.
// Return { rowIndex (1-based, siap dipakai getRange), row } atau null.
function findTeacherRowById(rows, userId) {
  var target = String(userId == null ? '' : userId).trim().toLowerCase();
  if (!target) return null;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][GURU_COL.ID]).trim().toLowerCase() === target) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return null;
}

function isTeacherRowDisabled(row) {
  return String(row[GURU_COL.STATUS]).toLowerCase().trim() === 'nonaktif';
}

// Bentuk objek user yang disimpan di sesi & dikirim ke client. SATU tempat,
// dipakai jalur login lama maupun baru — kalau field baru ditambahkan di sini,
// kedua jalur otomatis ikut konsisten.
// CATATAN KEAMANAN: JANGAN pernah menambahkan hash password/PIN atau salt ke
// objek ini — isinya dikirim utuh ke frontend dan disimpan di localStorage.
function buildSessionUser(row) {
  return {
    id: row[GURU_COL.ID],
    name: row[GURU_COL.NAMA],
    role: row[GURU_COL.ROLE],
    jabatan: row[GURU_COL.JABATAN] || '',
    waliKelas: row[GURU_COL.KELAS_WALI] || '',
  };
}

// ===== OTORISASI SEGAR (Sprint 2A) =====
// Sesi membuktikan IDENTITAS, bukan HAK AKSES.
//
// Sesi SIGAP hidup 6 jam (batas keras CacheService, lihat createSession) dan
// isinya adalah snapshot Master_Guru pada detik login. Artinya, sebelum ini:
// admin menonaktifkan akun jam 07.00 -> orang itu masih bisa menulis data
// sampai jam 13.00; admin menurunkan role dari admin ke guru -> hak admin
// masih menempel sampai sesinya habis. Yang paling berbahaya justru kasus
// pertama: menonaktifkan akun adalah tindakan yang dipakai admin ketika ada
// masalah SEKARANG, dan pada saat itulah tindakan tersebut tidak berefek.
//
// Karena itu, untuk aksi sensitif, id dari sesi dipakai untuk membaca ULANG
// baris guru di Master_Guru: status & role diambil dari sheet, bukan dari
// sesi. Sheet dibaca langsung tanpa cache baru — Master_Guru cuma puluhan
// baris, dan untuk aksi tulis (kecepatan manusia mengisi form) satu panggilan
// Sheets tambahan tidak terasa. Correctness di atas performance di sini.
//
// Return { ok: true, user } atau { ok: false, reason } dengan reason:
//   'session'  -> token tidak ada/kedaluwarsa
//   'gone'     -> akun sudah tidak ada di Master_Guru (dihapus manual)
//   'disabled' -> akun dinonaktifkan admin SETELAH sesi ini dibuat
function resolveAuthorizedUser(ss, sessionToken) {
  var sessionUser = getSessionUser(sessionToken);
  if (!sessionUser) return { ok: false, reason: 'session' };
  var sheet = ss.getSheetByName('Master_Guru');
  var rows = sheet.getDataRange().getValues();
  var found = findTeacherRowById(rows, sessionUser.id);
  if (!found) return { ok: false, reason: 'gone' };
  if (isTeacherRowDisabled(found.row)) return { ok: false, reason: 'disabled' };
  // Objek user dibangun ulang dari BARIS SHEET, bukan dari isi sesi — role,
  // jabatan, nama, dan kelas wali otomatis ikut versi terbaru.
  return { ok: true, user: buildSessionUser(found.row) };
}

// Pesan penolakan otorisasi. 'session' memakai kalimat "Sesi berakhir" yang
// sudah dikenali checkSession() di app.js (frontend langsung memulangkan
// pengguna ke layar login). Dua reason lainnya SENGAJA memakai kalimat lain:
// akun dinonaktifkan bukan sesi kedaluwarsa, dan guru berhak tahu bedanya
// supaya tidak mencoba login berulang kali dengan sia-sia.
function authErrorMessage(reason) {
  if (reason === 'disabled') return 'Akun Anda sudah dinonaktifkan admin. Hubungi admin.';
  if (reason === 'gone') return 'Akun Anda tidak ditemukan lagi. Hubungi admin.';
  return 'Sesi berakhir, silakan login ulang.';
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
