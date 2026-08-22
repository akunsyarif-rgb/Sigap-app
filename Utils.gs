// ===== UTILS.gs =====
// Fungsi-fungsi dasar/pembantu (helper) yang dipakai di seluruh project:
// respons JSON, keamanan token API, hash password, cek tanggal sama,
// dan bikin sheet otomatis.
// Catatan: di Google Apps Script, SEMUA file .gs dalam 1 project otomatis
// digabung jadi satu konteks — file ini bisa dipanggil dari Main.gs/Auth.gs
// tanpa perlu import apa pun.

// ===== UTILITAS DASAR =====

// Selain membungkus jadi JSON, jsonOut menempelkan sessionExpiresAt kalau
// getSessionUser() baru saja memperpanjang sesi pada request ini (lihat
// SESSION_RENEWED_UNTIL di Auth.gs). Dipasang DI SINI, bukan di tiap handler,
// supaya setiap aksi — termasuk aksi baru yang ditambahkan nanti — otomatis
// ikut mengabarkan perpanjangannya tanpa ada yang lupa.
//
// Beberapa respons GET yang di-cache (students_list, login_users) memakai
// ContentService langsung tanpa lewat sini dan karena itu tidak membawa field
// ini — itu tidak masalah: klien hanya memperpanjang stempelnya kalau field
// ini ada, dan selalu ada request lain di boot yang membawanya.
function jsonOut(obj) {
  if (obj && typeof obj === 'object' && typeof SESSION_RENEWED_UNTIL === 'number' && SESSION_RENEWED_UNTIL > 0 && !obj.sessionExpiresAt) {
    obj.sessionExpiresAt = SESSION_RENEWED_UNTIL;
  }
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkToken(token) {
  var validToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  return token && validToken && token === validToken;
}

// ===== Hash password =====
// Skema LAMA (hashPasswordLegacy): SHA-256 tanpa salt, DAN password
// di-lowercase paksa sebelum di-hash — jadi "Sigap123" & "sigap123" dianggap
// password yang sama (melemahkan kekuatan password nyata), dan satu tabel
// pelangi (rainbow table) generik bisa dipakai untuk semua akun sekaligus.
// Skema BARU (hashPasswordSalted): tiap akun punya salt acak sendiri (kolom
// H Master_Guru), hash case-sensitive. Akun lama tidak direset paksa — lihat
// verifyPassword() di Auth.gs untuk alur migrasi otomatis saat login.
function hashPasswordLegacy(password) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password.toLowerCase().trim());
  return bytesToHex(raw);
}

function hashPasswordSalted(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password.trim());
  return bytesToHex(raw);
}

function bytesToHex(bytes) {
  return bytes.map(function (byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function generateSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

// Nama kelas diketik manual di beberapa tempat (Master_Siswa, Kelola > Wali
// Kelas, dst.) — jadi dicocokkan toleran spasi berlebih/huruf besar-kecil, DAN
// toleran beda format antara catatan lama vs Master_Siswa yang sudah diubah
// (mis. catatan lama "XI A" sementara Master_Siswa sekarang "XI.A (KESEHATAN I)"
// setelah nama kelas ditambah keterangan peminatan) — keterangan dalam kurung
// & tanda titik/strip dibuang dulu, sama seperti normalizeClass() di frontend
// helpers.js, supaya konsisten.
function sameClass(a, b) {
  var norm = function (c) {
    return String(c || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[.\-]/g, ' ')
      .trim().toLowerCase().replace(/\s+/g, ' ');
  };
  return norm(a) === norm(b);
}

function isSameDayServer(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// uploadFotoSurat() (upload foto surat ke Drive) DIHAPUS — fitur lampiran
// foto untuk Surat dicabut total, Surat sekarang cuma laporan tertulis
// (jenis + keterangan). Alasan: berulang kali gagal di lapangan karena
// masalah otorisasi/kebijakan sharing Google Workspace sekolah yang tidak
// pernah benar-benar tuntas (lihat riwayat commit sebelumnya soal
// ANYONE_WITH_LINK/DOMAIN_WITH_LINK) — daripada fitur setengah-jalan yang
// sering gagal diam-diam, dicabut supaya alurnya sederhana & bisa diandalkan.
// Kolom Foto_URL di sheet Surat_Masuk TETAP ada (baris lama masih punya
// nilainya) tapi tidak lagi ditulis/dibaca UI — lihat catatan di addSurat
// (Code.gs) soal kenapa kolomnya tidak dihapus dari struktur baris.

// ===== RATE LIMIT LOGIN =====
// Login SIGAP cuma minta password, tanpa username (lihat LoginScreen di
// ui-common.js) — server mencocokkan password yang dikirim ke SEMUA baris
// Master_Guru sampai ketemu. Karena itu, saat password SALAH, server belum
// tahu itu menyasar akun siapa — rate-limit di sini scoped GLOBAL (semua
// user sekaligus), bukan per-akun.
// Fixed window (bukan sliding, bukan extend-on-write): counter dikunci ke
// blok waktu LOGIN_RATE_WINDOW_MS yang tetap (mis. semua request 10:00:00-
// 10:04:59 pakai key yang sama), lalu reset otomatis begitu masuk blok
// berikutnya. Ini sengaja supaya traffic sah yang tersebar sepanjang hari
// (typo sesekali dari guru berbeda-beda) TIDAK menumpuk jadi lockout permanen
// — beda dari skema "extend TTL tiap gagal" yang bisa terus mengunci selama
// masih ada 1 saja percobaan gagal per window.
var LOGIN_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 menit per window
var LOGIN_RATE_MAX_FAILURES = 15; // percobaan password-salah per window sebelum lockout

function isLoginRateLimited() {
  var key = 'login_fail_' + Math.floor(Date.now() / LOGIN_RATE_WINDOW_MS);
  var raw = CacheService.getScriptCache().get(key);
  var count = raw ? parseInt(raw, 10) : 0;
  return count >= LOGIN_RATE_MAX_FAILURES;
}

// Return jumlah kegagalan SETELAH ditambah (dipakai pemanggil untuk deteksi
// momen pertama kali lockout terpicu, supaya cuma dicatat sekali ke Audit Log).
function recordLoginFailure() {
  var cache = CacheService.getScriptCache();
  var key = 'login_fail_' + Math.floor(Date.now() / LOGIN_RATE_WINDOW_MS);
  var raw = cache.get(key);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  // TTL sedikit lebih lama dari window supaya key masih kebaca request lain
  // sampai akhir window, baru dibuang cache-nya.
  cache.put(key, String(count), Math.ceil(LOGIN_RATE_WINDOW_MS / 1000) + 30);
  return count;
}

// ===== RATE LIMIT AKSI TULIS PER SESI =====
// Beda dari rate-limit login di atas (global, karena password-only berarti
// server belum tahu akun mana yang ditarget saat gagal) — begitu sesi VALID
// ada, identitasnya sudah pasti (getSessionUser sudah lolos), jadi dibatasi
// PER SESI, bukan global. Kenapa perlu ini terpisah dari LockService: lock
// cuma menyerialkan penulisan (mencegah race condition/data korup), TIDAK
// membatasi VOLUME — sesi yang bocor (mis. lewat riwayat browser, karena
// sessionToken ikut terkirim di query string doGet) bisa dipakai menulis
// data tanpa batas selama 6 jam token itu masih hidup, kalau tidak ada ini.
// Fixed window sama seperti rate-limit login, supaya guru yang memang aktif
// mencatat banyak siswa berturut-turut (jam gerbang pagi) tidak keblokir
// cuma karena kebetulan menyentuh batas — 30/menit jauh di atas kecepatan
// wajar manusia mengetik form satu per satu.
var WRITE_RATE_WINDOW_MS = 60 * 1000; // 1 menit per window
var WRITE_RATE_MAX = 30; // aksi tulis per menit per SESI (bukan global)

// Return true kalau MASIH boleh menulis (dan otomatis menghitung percobaan
// ini), false kalau sudah melewati batas window ini.
function checkWriteRateLimit(sessionToken) {
  if (!sessionToken) return false;
  var cache = CacheService.getScriptCache();
  // Hash ringan token sesi (bukan token mentah) buat key cache — pola sama
  // seperti bytesToHex() yang sudah dipakai hashPasswordSalted di atas,
  // supaya sessionToken asli tidak ikut nampang di key CacheService.
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sessionToken);
  var tokenHash = bytesToHex(digest).slice(0, 16);
  var key = 'writelimit_' + tokenHash + '_' + Math.floor(Date.now() / WRITE_RATE_WINDOW_MS);
  var raw = cache.get(key);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  cache.put(key, String(count), Math.ceil(WRITE_RATE_WINDOW_MS / 1000) + 15);
  return count <= WRITE_RATE_MAX;
}

// ===== AUDIT LOG =====
// Jejak keamanan & akuntabilitas — beda dari Live Activity Log (yang untuk
// operasional harian). Ini permanen, mencatat SIAPA melakukan APA, dan cuma
// bisa dilihat Admin/BK/Kesiswaan (lihat isBkRole di Auth.gs).
function logAudit(actor, action, detail) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, 'Audit_Log', ['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail']);
    sheet.appendRow([new Date(), actor.name, actor.id, action, detail || '']);
  } catch (e) {
    // Audit log tidak boleh sampai bikin aksi utama gagal — kalau gagal catat, diamkan saja.
  }
}

// Peta kategori -> nama sheet
function getSheetForCategory(ss, category) {
  var sheetNames = { terlambat: 'Log_Gerbang', pelanggaran: 'Pelanggaran', surat: 'Surat_Masuk' };
  var name = sheetNames[category];
  if (!name) return null;
  return ss.getSheetByName(name);
}

// Cari baris lewat kombinasi NISN + Timestamp PERSIS (bukan nomor baris),
// supaya tidak salah kalau ada baris lain yang sudah ke-geser (dihapus/ditambah).
// Return { rowIndex, timestamp } (rowIndex = nomor baris di sheet, 1-based) atau null kalau tidak ketemu.
function findRowByNisnTimestamp(sheet, nisn, timestamp) {
  if (!sheet) return null;
  var rows = sheet.getDataRange().getValues();
  var targetTime = new Date(timestamp).getTime();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(nisn) && new Date(rows[i][0]).getTime() === targetTime) {
      return { rowIndex: i + 1, timestamp: rows[i][0] };
    }
  }
  return null;
}

// Nama pencatat (Logged_By/Dicatat_Oleh) selalu kolom TERAKHIR di ketiga
// sheet kategori (Log_Gerbang/Pelanggaran/Surat_Masuk) — dipakai editEntry/
// deleteEntry untuk cek kepemilikan saat guru/BK non-admin mau ubah/hapus
// catatan (cuma boleh punya sendiri, lihat Code.gs).
function getRowLoggedBy(sheet, rowIndex) {
  var lastCol = sheet.getLastColumn();
  return sheet.getRange(rowIndex, lastCol).getValue();
}

// ===== PERUBAHAN UTAMA =====
// Hapus cache list terkait kategori supaya perubahan langsung kelihatan
// saat data ditarik ulang (getLogs/getPelanggaran/getSurat).
// Juga hapus cache 'today_data' agar Beranda ikut ke-refresh.
function clearCacheForCategory(category) {
  var cacheKeys = { terlambat: 'today_logs', pelanggaran: 'pelanggaran_list_raw', surat: 'surat_list' };
  var key = cacheKeys[category];
  if (key) CacheService.getScriptCache().remove(key);
  // Tambahan: bersihkan cache Beranda (today_data)
  CacheService.getScriptCache().remove('today_data');
}

// Ambil baris >= cutoffDate secara efisien: baca HANYA kolom Timestamp dulu
// (1 kali panggilan API ke Sheets, ringan), cari titik potong dengan binary
// search DI MEMORI JavaScript (bukan berkali-kali getRange kecil — itu pola
// yang justru LAMBAT di Apps Script karena tiap panggilan ada overhead
// jaringan). Baru setelah itu tarik kolom lengkap untuk baris yang cocok saja.
// Total tetap cuma 2 panggilan ke Sheets API berapa pun banyaknya baris.
function getRowsSince(sheet, cutoffDate, numCols) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var tsValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var cutoffTime = cutoffDate.getTime();
  var lo = 0, hi = tsValues.length - 1, startIdx = tsValues.length;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    var midTime = new Date(tsValues[mid][0]).getTime();
    if (midTime >= cutoffTime) { startIdx = mid; hi = mid - 1; }
    else { lo = mid + 1; }
  }
  if (startIdx >= tsValues.length) return [];
  var startRow = startIdx + 2; // +2: lewati header (baris 1) + index 0-based -> 1-based
  var numRows = lastRow - startRow + 1;
  return sheet.getRange(startRow, 1, numRows, numCols).getValues();
}

// Senin sebagai awal minggu — sama persis dengan startOfWeek() di frontend helpers.js
function startOfWeekServer(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Riwayat keterlambatan 1 siswa saja (dipakai peringatan "sudah Nx terlambat"
// di form Catat Terlambat) — dipanggil on-demand per siswa yang dipilih,
// bukan tarik seluruh Log_Gerbang ke semua ~1.296 siswa sekaligus.
function getLateHistoryForStudent(sheet, nisn) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) === String(nisn)) {
      result.push({ timestamp: data[i][0], type: data[i][4] });
    }
  }
  result.sort(function (a, b) { return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
  return result;
}
