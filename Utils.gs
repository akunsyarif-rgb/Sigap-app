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

// ===== RBAC: baris mana yang boleh dilihat siapa =====
// SATU tempat yang menentukan cakupan baca untuk Keterlambatan & Pelanggaran,
// dipakai getLogs / getPelanggaran / getStudentLateHistory / getTodayData di
// Code.gs. Ditegakkan di SERVER — sebelum ini getLogs mengirim SELURUH
// Log_Gerbang (riwayat sekolah lintas tahun ajaran) ke setiap pemanggil
// non-OSIS, dan browser yang memutuskan apa yang ditampilkan. Menyaring di
// browser bukan pengamanan: datanya sudah terlanjur sampai ke perangkat.
//
// Aturan yang disepakati:
//   Keterlambatan & Surat HARI INI : seluruh sekolah untuk semua role non-OSIS.
//     Ini BUKAN kelonggaran — guru piket di gerbang harus saling melihat
//     catatan hari itu supaya satu siswa tidak dicatat dua kali (lihat
//     GerbangTab di gerbang.js & pengecekan duplikat di aksi 'record'/'addSurat').
//   RIWAYAT keterlambatan & surat : admin/BK seluruh sekolah; wali kelas =
//     kelas perwaliannya (tanggal berapa pun); guru biasa = TIDAK ADA riwayat
//     hari sebelumnya. Yang ia catat sendiri hanya terlihat pada HARI catatan
//     itu dibuat ("OWN-hari-ini") — dan itu sudah tercakup oleh aturan "hari
//     ini = seluruh sekolah" di atas, jadi tidak ada klausa OWN terpisah di
//     sini. Ini yang membedakannya dari Pelanggaran: guru piket yang mencatat
//     puluhan siswa lintas kelas tiap pagi TIDAK ikut menyimpan riwayat lintas
//     kelas itu di layarnya besok harinya.
//   PELANGGARAN            : admin/BK seluruh sekolah; wali kelas = kelasnya
//     sendiri + catatan yang ia tulis (TANPA batas tanggal); guru biasa =
//     HANYA catatan yang ia tulis sendiri (TANPA batas tanggal). Sengaja
//     BERBEDA dari dua kategori di atas dan tidak boleh disamakan: mencatat
//     pelanggaran bukan alur gerbang massal, dan guru perlu bisa menelusuri
//     kembali catatan pelanggaran yang ia buat sendiri.
//   OSIS                   : tidak dapat keduanya (ditolak di handler).
//
// Kepemilikan (OWN) memakai mekanisme yang SUDAH ADA di aplikasi ini: kolom
// Dicatat_Oleh dicocokkan dengan nama pemilik sesi, sama persis seperti yang
// dipakai editEntry/deleteEntry. Nama pencatat kosong / sesi tanpa nama tidak
// pernah dianggap memiliki baris apa pun.
function isSchoolWideReader(sessionUser) {
  return isBkRole(sessionUser && sessionUser.role); // admin + bk_kesiswaan
}

function ownsRow(row, sessionUser) {
  var owner = String((row && row.logged_by) || '').trim();
  var me = String((sessionUser && sessionUser.name) || '').trim();
  return !!owner && !!me && owner === me;
}

function readerClass(sessionUser) {
  return String((sessionUser && sessionUser.waliKelas) || '').trim();
}

// Dipakai untuk DUA kategori yang aturannya sama: Keterlambatan (Log_Gerbang)
// dan Surat/Izin (Surat_Masuk). rows = daftar objek {timestamp, class,
// logged_by, ...}; isi lain dibiarkan apa adanya. `now` dipisah jadi parameter
// supaya bisa diuji tanpa bergantung jam dinding.
//
// Catatan kenapa tidak ada klausa ownsRow() di sini: "OWN-hari-ini" seluruhnya
// tercakup oleh klausa hari-ini (yang berlaku untuk seluruh sekolah). Klausa
// OWN tanpa batas tanggal justru yang harus TIDAK ADA — itu membuat guru piket
// menyimpan riwayat lintas kelas dari hari-hari sebelumnya hanya karena ia yang
// mencatatnya. ownsRow() tetap dipakai untuk Pelanggaran di bawah, yang
// aturannya memang berbeda.
function scopeDailyRecordsForUser(rows, sessionUser, now) {
  var list = rows || [];
  if (isSchoolWideReader(sessionUser)) return list;
  var today = now instanceof Date ? now : new Date();
  var kelas = readerClass(sessionUser);
  return list.filter(function (r) {
    if (!r) return false;
    // Hari ini: seluruh sekolah (alur gerbang) — termasuk catatan sendiri.
    if (r.timestamp && isSameDayServer(new Date(r.timestamp), today)) return true;
    // Wali kelas: kelas perwaliannya, tanggal berapa pun.
    return !!kelas && sameClass(r.class, kelas);
  });
}

// getTodayData mengirim satu paket berisi data HARI INI + potongan riwayat
// (lateForBanner, seminggu/sebulan ke belakang, untuk banner "sering
// terlambat"). Bagian hari ini tetap seluruh sekolah; bagian riwayat &
// pelanggaran dibatasi dengan aturan yang sama seperti getLogs/getPelanggaran,
// supaya tidak ada jalan memutar untuk menarik riwayat lewat endpoint ini.
// Surat sengaja tidak diubah di sini — cakupannya memang belum pernah
// dibatasi per kelas (lihat getSurat), dan itu di luar perbaikan ini.
function scopeTodayDataPayload(payload, sessionUser) {
  var data = payload || {};
  return {
    status: data.status || 'success',
    todayLate: data.todayLate || [],
    todaySurat: data.todaySurat || [],
    todayPelanggaran: scopePelanggaranForUser(data.todayPelanggaran || [], sessionUser),
    lateForBanner: scopeDailyRecordsForUser(data.lateForBanner || [], sessionUser),
  };
}

function scopePelanggaranForUser(list, sessionUser) {
  var rows = list || [];
  if (isSchoolWideReader(sessionUser)) return rows;
  var kelas = readerClass(sessionUser);
  return rows.filter(function (p) {
    if (!p) return false;
    if (kelas && sameClass(p.class, kelas)) return true;
    return ownsRow(p, sessionUser);
  });
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
// Kolom Kelas & Dicatat_Oleh ikut dibaca (6 kolom, bukan 5) BUKAN untuk
// dikirim ke klien, tapi supaya hasilnya bisa disaring lewat
// scopeDailyRecordsForUser di Code.gs — tanpa keduanya, riwayat lengkap seorang
// siswa bisa ditarik siapa saja yang tahu NISN-nya.
function getLateHistoryForStudent(sheet, nisn) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) === String(nisn)) {
      result.push({ timestamp: data[i][0], type: data[i][4], class: data[i][3], logged_by: data[i][5] });
    }
  }
  result.sort(function (a, b) { return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
  return result;
}

// ===== EXPORT DATA (laporan PDF/Excel dari dalam aplikasi) =====
// Latar belakang: Google Spreadsheet tetap ADMIN-ONLY. Supaya guru/BK tidak
// perlu dibukakan akses ke Sheet cuma untuk mengambil rekap, aksi 'exportData'
// di doGet (Code.gs) mengembalikan LAPORAN yang sudah jadi: sudah difilter
// server-side sesuai hak akses pemanggil, sudah dipotong sesuai periode, dan
// kolomnya sudah ditetapkan per jenis laporan. Klien hanya membungkusnya jadi
// berkas PDF/XLSX — TIDAK pernah memilih kolom sendiri, dan TIDAK pernah
// menerima baris yang bukan haknya lalu menyaringnya di browser.
//
// Yang SENGAJA tidak pernah ikut ke hasil export: NISN, Foto_URL, dan
// Dicatat_Oleh_ID. Laporan cetak untuk wali kelas/BK tidak membutuhkannya,
// dan identitas siswa di dalam berkas cukup Nama + Kelas.
// (Identitas internal tetap memakai NISN — pengelompokan Rekap Siswa di bawah
// dikunci ke NISN, bukan nama, supaya dua siswa bernama sama tidak menyatu.)

var EXPORT_SEKOLAH = 'SMAN 2 Tarakan'; // identitas sekolah di kop laporan
var EXPORT_MAX_ROWS = 5000;        // batas baris per laporan (lindungi memori Apps Script & ukuran respons)
var EXPORT_MAX_RANGE_DAYS = 366;   // batas panjang periode yang boleh diminta sekali jalan

// Definisi tiap jenis laporan: dari sheet mana, kolom apa yang keluar, dan
// siapa yang boleh. level 'bk' = hanya admin/BK-Kesiswaan (mengikuti aturan
// getBimbingan yang sudah ada); level 'umum' = admin/BK + wali kelas (untuk
// kelasnya sendiri saja).
// tsIndex/classIndex = posisi kolom di SHEET (bukan di hasil export).
var EXPORT_JENIS = {
  keterlambatan: {
    label: 'Keterlambatan', judul: 'LAPORAN KETERLAMBATAN', sheet: 'Log_Gerbang',
    numCols: 6, tsIndex: 0, classIndex: 3, level: 'umum',
    columns: ['Tanggal', 'Jam', 'Nama', 'Kelas', 'Keterangan', 'Dicatat Oleh'],
    map: function (r) { return [formatExportDate(r[0]), formatExportTime(r[0]), asText(r[2]), asText(r[3]), asText(r[4]), asText(r[5])]; },
  },
  pelanggaran: {
    label: 'Pelanggaran', judul: 'LAPORAN PELANGGARAN', sheet: 'Pelanggaran',
    numCols: 8, tsIndex: 0, classIndex: 3, level: 'umum',
    columns: ['Tanggal', 'Nama', 'Kelas', 'Jenis Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat Oleh'],
    map: function (r) { return [formatExportDate(r[0]), asText(r[2]), asText(r[3]), asText(r[4]), asText(r[5]), asText(r[6]), asText(r[7])]; },
  },
  surat: {
    label: 'Surat/Izin', judul: 'LAPORAN SURAT / IZIN', sheet: 'Surat_Masuk',
    numCols: 8, tsIndex: 0, classIndex: 3, level: 'umum',
    // Kolom G (index 6) = Foto_URL — SENGAJA dilewati, lihat catatan di atas.
    columns: ['Tanggal', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Dicatat Oleh'],
    map: function (r) { return [formatExportDate(r[0]), asText(r[2]), asText(r[3]), asText(r[4]), asText(r[5]), asText(r[7])]; },
  },
  bimbingan: {
    label: 'Bimbingan Khusus', judul: 'LAPORAN BIMBINGAN KHUSUS', sheet: 'Bimbingan_Khusus',
    numCols: 6, tsIndex: 0, classIndex: 3, level: 'bk',
    columns: ['Tanggal', 'Nama', 'Kelas', 'Catatan', 'Dicatat Oleh'],
    map: function (r) { return [formatExportDate(r[0]), asText(r[2]), asText(r[3]), asText(r[4]), asText(r[5])]; },
  },
  upacara: {
    label: 'Pelanggaran Upacara', judul: 'LAPORAN PELANGGARAN UPACARA', sheet: 'Pelanggaran_Upacara',
    numCols: 8, tsIndex: 0, classIndex: 3, level: 'umum',
    // Kolom H (index 7) = Dicatat_Oleh_ID — SENGAJA tidak ikut.
    columns: ['Tanggal', 'Nama', 'Kelas', 'Jenis Pelanggaran', 'Catatan', 'Dicatat Oleh'],
    map: function (r) { return [formatExportDate(r[0]), asText(r[2]), asText(r[3]), asText(r[4]), asText(r[5]), asText(r[6])]; },
  },
  // Izin Keluar / Pulang. Memakai sheet Izin_Keluar APA ADANYA (21 kolom,
  // IZIN_HEADERS) — tidak ada kolom, sheet, atau field baru yang dibuat untuk
  // export ini, dan tidak ada satu pun nilai yang dikarang: semuanya kolom
  // yang memang sudah ditulis alur transaksinya.
  //
  // Yang SENGAJA tidak ikut, dan alasannya:
  // - NISN (kolom B) : sama seperti SEMUA laporan lain di berkas ini —
  //   identitas siswa di dalam berkas cukup Nama + Kelas (lihat catatan
  //   panjang di atas). Konsisten, bukan pengecualian untuk izin.
  // - ID_Izin (E), Disetujui_Oleh_ID (L), Diverifikasi_Oleh_ID (O),
  //   Dicatat_Kembali_Oleh_ID (T), ID_Kelompok (U) : pengenal internal,
  //   sekelas Dicatat_Oleh_ID yang juga sudah dikecualikan di mana-mana.
  // - Waktu_Verifikasi (P) : bukan dihilangkan karena tidak penting, tapi
  //   karena SELALU sama persis dengan Waktu_Keluar (Q) — keduanya distempel
  //   pada detik yang sama oleh verifikasiIzinKeluar (dan oleh addIzinKeluar
  //   pada jalur khusus). Menampilkan dua kolom berisi jam yang identik cuma
  //   mempersempit kolom lain di PDF. Nama petugas verifikasinya TETAP ikut.
  // - Timestamp (A) : nilainya sama dengan Waktu_Persetujuan (M) — dipakai
  //   sekali sebagai kolom 'Tanggal' + 'Jam Persetujuan'.
  izin: {
    label: 'Izin Keluar', judul: 'LAPORAN IZIN KELUAR / PULANG', sheet: 'Izin_Keluar',
    numCols: 21, tsIndex: 0, classIndex: 3, level: 'umum',
    columns: [
      'Tanggal', 'Nama', 'Kelas', 'Keperluan', 'Tujuan', 'Jalur', 'Alasan Khusus', 'Status',
      'Disetujui Oleh', 'Jam Setuju', 'Verifikator', 'Jam Keluar', 'Jam Kembali', 'Pencatat Kembali',
    ],
    map: function (r) {
      return [
        formatExportDate(r[0]), asText(r[2]), asText(r[3]), asText(r[5]),
        izinTujuanLabel(r[6]), izinJalurLabel(r[8]), asText(r[9]), asText(r[7]),
        asText(r[10]), formatExportTime(r[12]), asText(r[13]), formatExportTime(r[16]),
        formatExportTime(r[17]), asText(r[18]),
      ];
    },
  },
  // Rekap Siswa BUKAN sheet baru: ini agregat dari empat sheet di atas
  // (kategori yang boleh dilihat pemanggil), dihitung server-side.
  rekap: {
    label: 'Rekap Siswa', judul: 'REKAP SISWA', special: 'rekap', level: 'umum',
    columns: ['Nama', 'Kelas', 'Terlambat', 'Pelanggaran', 'Surat/Izin', 'Upacara', 'Total'],
  },
};

function asText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function pad2Export(n) {
  return n < 10 ? '0' + n : String(n);
}

// Tanggal/jam diformat DI SERVER supaya isi berkas sama untuk semua orang dan
// tidak bergantung locale/zona waktu HP yang mengunduhnya.
function formatExportDate(value) {
  var d = value instanceof Date ? value : new Date(value);
  if (!d || isNaN(d.getTime())) return '';
  return pad2Export(d.getDate()) + '/' + pad2Export(d.getMonth() + 1) + '/' + d.getFullYear();
}

function formatExportTime(value) {
  var d = value instanceof Date ? value : new Date(value);
  if (!d || isNaN(d.getTime())) return '';
  return pad2Export(d.getHours()) + ':' + pad2Export(d.getMinutes());
}

// ===== Otorisasi export (server-side, satu tempat) =====
// Aturannya SENGAJA tidak melebarkan hak akses yang sudah ada di aplikasi:
// - admin & BK/Kesiswaan  : semua jenis, semua kelas (atau satu kelas tertentu)
// - guru yang wali kelas  : semua jenis KECUALI Bimbingan Khusus (yang memang
//                           sudah admin/BK-only lewat getBimbingan), dan HANYA
//                           kelas perwaliannya — nilai kelas dari klien tidak
//                           dipercaya: kalau minta kelas lain, ditolak.
// - guru biasa (bukan wali kelas) : tidak dapat akses export sama sekali.
//   Tidak ada dasar data untuk memberi guru biasa cakupan kelas tertentu
//   (tidak ada mapping jadwal mengajar di sistem ini), jadi haknya tidak
//   diperluas hanya demi fitur ini.
// - OSIS                  : ditolak.
function resolveExportAccess(sessionUser, jenis, requestedKelas) {
  var def = EXPORT_JENIS[String(jenis || '')];
  if (!def) return { allowed: false, message: 'Jenis laporan tidak dikenali.' };
  if (!sessionUser) return { allowed: false, message: 'Sesi berakhir, silakan login ulang.' };
  if (isOsisRole(sessionUser.role)) return { allowed: false, message: 'Tidak punya akses export data.' };

  // Satu-satunya parameter export yang berbentuk teks bebas (jenis/format
  // dicocokkan ke daftar tetap, tanggal ke pola YYYY-MM-DD). Dipotong supaya
  // nilai raksasa dari klien tidak bisa membanjiri baris Audit Log atau
  // merusak tata letak kop laporan; nama kelas nyata jauh di bawah batas ini.
  var kelas = String(requestedKelas || '').trim().slice(0, 60);
  if (isBkRole(sessionUser.role)) {
    return { allowed: true, jenis: jenis, kelasFilter: kelas, scopeLabel: kelas || 'Semua Kelas' };
  }

  var wali = String((sessionUser && sessionUser.waliKelas) || '').trim();
  if (!wali) return { allowed: false, message: 'Tidak punya akses export data.' };
  if (def.level === 'bk') return { allowed: false, message: 'Tidak punya akses untuk jenis laporan ini.' };
  if (kelas && !sameClass(kelas, wali)) {
    return { allowed: false, message: 'Hanya bisa mengekspor data kelas perwalian Anda.' };
  }
  return { allowed: true, jenis: jenis, kelasFilter: wali, scopeLabel: wali };
}

// ===== Validasi periode =====
// Format yang diterima cuma YYYY-MM-DD (nilai <input type="date">). Tanggal
// yang "ada di kalender" ikut diperiksa (2026-02-31 ditolak, bukan digeser
// diam-diam ke 3 Maret seperti perilaku new Date()).
function parseExportDate(str, endOfDay) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  var date = endOfDay ? new Date(y, mo - 1, d, 23, 59, 59, 999) : new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function validateExportPeriod(startStr, endStr) {
  var start = parseExportDate(startStr, false);
  var end = parseExportDate(endStr, true);
  if (!start || !end) return { valid: false, message: 'Tanggal tidak valid. Isi tanggal mulai dan tanggal akhir.' };
  if (start.getTime() > end.getTime()) return { valid: false, message: 'Tanggal mulai tidak boleh melewati tanggal akhir.' };
  var days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days > EXPORT_MAX_RANGE_DAYS) {
    return { valid: false, message: 'Rentang terlalu panjang (maksimal ' + EXPORT_MAX_RANGE_DAYS + ' hari). Persempit periodenya.' };
  }
  return { valid: true, start: start, end: end, days: days, label: formatExportDate(start) + ' - ' + formatExportDate(end) };
}

// Saring baris mentah satu sheet -> baris laporan siap pakai. Murni (tanpa
// SpreadsheetApp) supaya bisa diuji langsung di tests/export.test.js.
function buildExportRows(jenis, rawRows, kelasFilter, start, end) {
  var def = EXPORT_JENIS[String(jenis || '')];
  if (!def || def.special) return [];
  var rows = rawRows || [];
  var startMs = start.getTime(), endMs = end.getTime();
  var kelas = String(kelasFilter || '').trim();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r[def.tsIndex]) continue;
    var ts = new Date(r[def.tsIndex]).getTime();
    if (isNaN(ts) || ts < startMs || ts > endMs) continue;
    if (kelas && !sameClass(r[def.classIndex], kelas)) continue;
    out.push({ ts: ts, cells: def.map(r) });
  }
  out.sort(function (a, b) { return a.ts - b.ts; });
  return out.map(function (o) { return o.cells; });
}

// Rekap Siswa: hitung jumlah kejadian per siswa dari beberapa sheet sekaligus.
// sources = { keterlambatan: rows, pelanggaran: rows, surat: rows, upacara: rows }
// Dikelompokkan per NISN (identitas yang sudah dipakai sistem), tapi NISN-nya
// TIDAK ikut ke hasil export — cuma Nama + Kelas.
function buildRekapRows(sources, kelasFilter, start, end) {
  var order = ['keterlambatan', 'pelanggaran', 'surat', 'upacara'];
  var startMs = start.getTime(), endMs = end.getTime();
  var kelas = String(kelasFilter || '').trim();
  var map = {};
  var keys = [];
  for (var k = 0; k < order.length; k++) {
    var jenis = order[k];
    var def = EXPORT_JENIS[jenis];
    var rows = (sources && sources[jenis]) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[def.tsIndex]) continue;
      var ts = new Date(r[def.tsIndex]).getTime();
      if (isNaN(ts) || ts < startMs || ts > endMs) continue;
      if (kelas && !sameClass(r[def.classIndex], kelas)) continue;
      var nisn = asText(r[1]);
      var id = nisn || ('nama:' + asText(r[2]) + '|' + asText(r[3]));
      if (!map[id]) {
        map[id] = { name: asText(r[2]), kelas: asText(r[3]), counts: { keterlambatan: 0, pelanggaran: 0, surat: 0, upacara: 0 } };
        keys.push(id);
      }
      map[id].counts[jenis]++;
    }
  }
  var list = keys.map(function (id) { return map[id]; });
  list.sort(function (a, b) {
    var ca = String(a.kelas).toLowerCase(), cb = String(b.kelas).toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    var na = String(a.name).toLowerCase(), nb = String(b.name).toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  return list.map(function (s) {
    var total = s.counts.keterlambatan + s.counts.pelanggaran + s.counts.surat + s.counts.upacara;
    return [s.name, s.kelas, s.counts.keterlambatan, s.counts.pelanggaran, s.counts.surat, s.counts.upacara, total];
  });
}

// ===== RATE LIMIT EXPORT =====
// Terpisah dari checkWriteRateLimit (aksi tulis): export itu aksi BACA yang
// mahal (memindai sheet lintas bulan) dan setiap panggilannya menulis satu
// baris Audit Log. Tanpa batas sendiri, satu sesi bisa membanjiri Audit Log
// sekaligus membebani Sheets API. Pola fixed-window-nya sama persis dengan
// dua rate limit lain di file ini.
var EXPORT_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 menit per window
var EXPORT_RATE_MAX = 20;                  // laporan per window per SESI

function checkExportRateLimit(sessionToken) {
  if (!sessionToken) return false;
  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sessionToken);
  var tokenHash = bytesToHex(digest).slice(0, 16);
  var key = 'exportlimit_' + tokenHash + '_' + Math.floor(Date.now() / EXPORT_RATE_WINDOW_MS);
  var raw = cache.get(key);
  var count = (raw ? parseInt(raw, 10) : 0) + 1;
  cache.put(key, String(count), Math.ceil(EXPORT_RATE_WINDOW_MS / 1000) + 15);
  return count <= EXPORT_RATE_MAX;
}

// Detail Audit Log untuk export. SENGAJA hanya metadata permintaan (jenis,
// periode, cakupan, format, jumlah baris) — tidak ada satu pun nama/NISN
// siswa yang ikut tercatat di sini.
function buildExportAuditDetail(jenis, periodeLabel, scopeLabel, format, total, status) {
  return 'jenis=' + jenis +
    ' | periode=' + periodeLabel +
    ' | cakupan=' + scopeLabel +
    ' | format=' + format +
    ' | baris=' + total +
    ' | status=' + status;
}

// ===== IZIN KELUAR / PULANG (BETA) =====
// Pencatatan siswa yang MENINGGALKAN lingkungan sekolah di tengah jam
// pelajaran. BUKAN fitur Surat: Surat adalah laporan tertulis atas siswa yang
// tidak masuk/terlambat (satu baris, selesai saat itu juga), sedangkan Izin
// Keluar adalah TRANSAKSI BERSTATUS yang hidup sepanjang hari dan baru
// tertutup setelah siswa kembali (atau memang pulang).
//
// Prosedur sekolah yang ditiru (TIDAK dipangkas jadi satu persetujuan):
//   Guru yang memberikan persetujuan  -> persetujuan awal
//   Guru Piket                        -> verifikasi akhir
//   Siswa keluar
// Dua tahap itu tetap dua tahap di sini: aksi 'addIzinKeluar' hanya mencatat
// PERSETUJUAN (status 'Menunggu Verifikasi'), dan siswa baru dianggap keluar
// setelah 'verifikasiIzinKeluar' dijalankan pihak yang berwenang.
//
// Istilahnya sengaja "guru yang memberikan persetujuan", BUKAN "guru mata
// pelajaran pada jam tersebut": SIGAP tidak punya data jadwal mengajar (dan
// tidak akan ditambahkan untuk fitur ini — jadwal aktual berubah
// sewaktu-waktu), jadi peran seperti itu tidak bisa diverifikasi sistem. Yang
// disimpan adalah identitas pemberi persetujuan dari SESI + waktunya.
//
// CETAK/SLIP: tidak ada apa pun soal printer di sini. Jenis printer, media,
// ukuran kertas, dan cara koneksinya BELUM ditentukan sekolah, jadi tahap BETA
// ini murni transaksi digital. Kalau nanti pencetakan ditambahkan, ia menjadi
// OUTPUT dari baris yang sudah tersimpan — keberhasilan transaksi tidak boleh
// pernah bergantung pada berhasil/tidaknya mencetak.
var IZIN_SHEET_NAME = 'Izin_Keluar';

// Posisi kolom signifikan (dibaca by index, sama seperti sheet lain di SIGAP).
// Empat kolom pertama sengaja identik dengan sheet kategori lain
// (Timestamp, NISN, Nama, Kelas) supaya helper yang sudah ada — terutama
// getRowsSince() yang binary-search kolom Timestamp — tetap berlaku.
var IZIN_HEADERS = [
  'Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
  'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID',
  // Kolom ke-21, DITAMBAHKAN DI UJUNG saat Izin Kelompok masuk — tidak ada
  // satu pun kolom lama yang bergeser posisinya. Kosong = izin individual;
  // terisi = baris ini peserta dari satu kegiatan di sheet Izin_Kelompok.
  // Relasinya sengaja cuma satu kolom kunci: nama & kelas peserta TETAP dari
  // Master_Siswa (lihat resolveSiswaListForIzin), dan nama kegiatan tetap
  // tinggal di baris induknya — tidak diduplikasi ke tiap peserta.
  'ID_Kelompok',
];
var IZIN_NUM_COLS = IZIN_HEADERS.length; // 21
var IZIN_COL_NISN = 2;   // kolom B (1-based) — dipakai cek "masih ada izin terbuka?"
var IZIN_COL_ID = 5;     // kolom E (1-based) — dipakai cari baris saat ubah status
var IZIN_COL_STATUS = 8; // kolom H (1-based)
var IZIN_COL_KELOMPOK = 21; // kolom U (1-based)

// Lima status, tidak tumpang tindih. 'Kembali' & 'Pulang' adalah HASIL AKHIR
// yang berbeda (siswa balik ke sekolah vs tidak balik), 'Selesai' adalah
// penutupan administratif atas keduanya.
var IZIN_STATUS_MENUNGGU = 'Menunggu Verifikasi';
var IZIN_STATUS_DI_LUAR = 'Sedang di Luar';
var IZIN_STATUS_KEMBALI = 'Kembali';
var IZIN_STATUS_PULANG = 'Pulang';
var IZIN_STATUS_SELESAI = 'Selesai';
// Status "masih berjalan" — selama salah satu ini masih menempel pada seorang
// siswa, siswa itu tidak boleh dibuatkan transaksi keluar kedua.
var IZIN_STATUS_TERBUKA = [IZIN_STATUS_MENUNGGU, IZIN_STATUS_DI_LUAR];

var IZIN_TUJUAN_KEMBALI = 'kembali';
var IZIN_TUJUAN_PULANG = 'pulang';
var IZIN_JALUR_NORMAL = 'normal';
var IZIN_JALUR_KHUSUS = 'khusus';

var IZIN_MAX_KEPERLUAN = 200;
var IZIN_MAX_ALASAN = 300;

// Nama hari untuk mencocokkan Jadwal_Piket (kolom Hari diisi teks 'Senin'..).
// Ditulis tetap seperti HARI_PIKET di config.js — BUKAN toLocaleDateString,
// supaya tidak tergantung locale runtime Apps Script.
var HARI_PIKET_SERVER = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function hariPiketServer(d) {
  var date = d instanceof Date ? d : new Date();
  return HARI_PIKET_SERVER[date.getDay()];
}

function izinText(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

// ===== Konteks persetujuan: Wali Kelas vs Guru Mapel =====
// MURNI framing tampilan/audit — BUKAN role baru, BUKAN klaim yang diperiksa
// lewat jadwal mengajar (SIGAP tidak punya data itu, dan tidak akan
// ditambahkan untuk ini). Tidak pernah menggerbangi otorisasi apa pun: guru
// non-OSIS mana pun tetap boleh menyetujui siswa kelas mana pun, persis
// seperti sebelumnya — ini cuma menentukan LABEL apa yang tercatat.
//
// DIHITUNG DI SERVER, tidak pernah dipercaya dari klien: satu-satunya input
// adalah sessionUser.waliKelas (dari sesi) dan kelas siswa yang di-resolve
// dari Master_Siswa (bukan dari klien). Kalau klien mengirim field 'konteks'
// apa pun, itu diabaikan total — lihat pemakaiannya di action addIzinKeluar
// (Code.gs), yang TIDAK membaca data.konteks sama sekali.
var IZIN_KONTEKS_WALI_KELAS = 'wali_kelas';
var IZIN_KONTEKS_GURU_MAPEL = 'guru_mapel';

function izinKonteksPersetujuan(sessionUser, kelasSiswa) {
  var waliKelas = String((sessionUser && sessionUser.waliKelas) || '').trim();
  var kelas = String(kelasSiswa || '').trim();
  return (waliKelas && kelas && sameClass(kelas, waliKelas)) ? IZIN_KONTEKS_WALI_KELAS : IZIN_KONTEKS_GURU_MAPEL;
}

function izinKonteksLabel(konteks) {
  return konteks === IZIN_KONTEKS_WALI_KELAS ? 'Wali Kelas' : 'Guru Mapel';
}

// Label untuk laporan Export. Nilai yang tersimpan di sheet tetap 'kembali'/
// 'pulang' dan 'normal'/'khusus' apa adanya — ini MURNI pemanis baca di
// berkas laporan, tidak mengubah apa pun yang tertulis di Izin_Keluar dan
// tidak dipakai di jalur transaksi mana pun. Nilai yang tidak dikenali
// dikembalikan apa adanya, bukan dipaksa jadi salah satu label.
//
// Sengaja SATU KATA. Laporan izin adalah laporan terlebar yang ada (14 kolom)
// dan lebar tiap kolom di PDF dibagi menurut isi terpanjangnya
// (pdfColumnWidths, export-format.js): label sepanjang "Kembali ke sekolah"
// di kolom yang cuma perlu membedakan dua nilai akan merampas ruang kolom
// Nama sampai nama siswa terpotong jadi "R..". Judul kolomnya ("Tujuan",
// "Jalur") yang menjelaskan artinya.
function izinTujuanLabel(tujuan) {
  var t = String(tujuan == null ? '' : tujuan).trim().toLowerCase();
  if (t === IZIN_TUJUAN_KEMBALI) return 'Kembali';
  if (t === IZIN_TUJUAN_PULANG) return 'Pulang';
  return asText(tujuan);
}

function izinJalurLabel(jalur) {
  var j = String(jalur == null ? '' : jalur).trim().toLowerCase();
  if (j === IZIN_JALUR_NORMAL) return 'Normal';
  if (j === IZIN_JALUR_KHUSUS) return 'Khusus';
  return asText(jalur);
}

// ===== Siapa "Guru Piket" hari ini =====
// TIDAK ada role baru: kewenangan piket dibaca dari Jadwal_Piket yang sudah
// dipakai Beranda ("Guru Piket Hari Ini") dan dikelola admin lewat menu
// Kelola. Dicek ULANG setiap aksi, memakai hari saat aksi dijalankan — jadi
// pergantian guru piket di hari yang sama otomatis terbawa: yang memverifikasi
// pagi dan yang menandai siswa kembali siang boleh orang yang berbeda.
//
// admin & BK/Kesiswaan selalu boleh (mereka memang penanggung jawab kesiswaan,
// dan tanpa ini sekolah bisa terkunci total kalau Jadwal_Piket belum diisi).
function isPiketBertugas(ss, sessionUser, now) {
  if (!sessionUser) return false;
  var sheet = ss.getSheetByName('Jadwal_Piket');
  if (!sheet) return false;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;
  var hariIni = hariPiketServer(now);
  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === hariIni && String(rows[i][1]).trim() === String(sessionUser.id).trim()) {
      return true;
    }
  }
  return false;
}

// Kewenangan VERIFIKASI (dan penandaan "Kembali", dan jalur Izin Khusus).
// Satu fungsi supaya ketiga aksi itu tidak pernah bisa jadi berbeda diam-diam.
function canVerifyIzin(ss, sessionUser, now) {
  if (!sessionUser || isOsisRole(sessionUser.role)) return false;
  if (isBkRole(sessionUser.role)) return true; // admin + bk_kesiswaan
  return isPiketBertugas(ss, sessionUser, now);
}

// ===== Transisi status: DIVALIDASI DI SERVER =====
// Klien tidak pernah mengirim "status berikutnya" — ia cuma memanggil aksi
// (verifikasi / tandai kembali / selesaikan), dan server yang menentukan status
// hasilnya dari status SEKARANG + tujuan yang tersimpan di baris itu. Dengan
// begitu tidak ada nilai status dari klien yang bisa dipercaya, dan urutan yang
// tidak masuk akal (Pulang lalu Kembali, Kembali dua kali, dst.) ditolak.
function izinStatusSetelahVerifikasi(tujuan) {
  return String(tujuan) === IZIN_TUJUAN_PULANG ? IZIN_STATUS_PULANG : IZIN_STATUS_DI_LUAR;
}

// Pesan penolakan yang bisa dibaca guru — dipakai handler di Code.gs supaya
// alasan penolakan konsisten di semua aksi.
function izinTolakTransisi(statusSekarang, aksi) {
  if (aksi === 'verifikasi') {
    if (statusSekarang === IZIN_STATUS_DI_LUAR) return 'Izin ini sudah diverifikasi — siswa sudah tercatat keluar.';
    return 'Izin ini sudah tidak menunggu verifikasi (status: ' + statusSekarang + ').';
  }
  if (aksi === 'pulang') {
    if (statusSekarang === IZIN_STATUS_MENUNGGU) return 'Izin ini belum diverifikasi Guru Piket, jadi siswa belum tercatat keluar.';
    if (statusSekarang === IZIN_STATUS_KEMBALI) return 'Siswa ini sudah tercatat kembali ke sekolah.';
    if (statusSekarang === IZIN_STATUS_PULANG) return 'Siswa ini sudah tercatat pulang.';
    return 'Transaksi ini sudah selesai — tidak bisa diubah lagi.';
  }
  if (aksi === 'kembali') {
    if (statusSekarang === IZIN_STATUS_MENUNGGU) return 'Izin ini belum diverifikasi Guru Piket, jadi siswa belum tercatat keluar.';
    if (statusSekarang === IZIN_STATUS_PULANG) return 'Siswa ini izin PULANG (tidak kembali) — tidak bisa ditandai kembali.';
    if (statusSekarang === IZIN_STATUS_KEMBALI) return 'Siswa ini sudah ditandai kembali.';
    return 'Transaksi ini sudah selesai — tidak bisa ditandai kembali.';
  }
  return 'Status transaksi tidak memungkinkan aksi ini (status: ' + statusSekarang + ').';
}

// Baris sheet -> objek. by_id/ids TIDAK ikut dikirim ke klien (dipakai hanya
// untuk pengecekan di server), sama seperti pola pelanggaran_upacara_raw.
function izinRowToObject(row) {
  return {
    timestamp: row[0],
    nisn: row[1],
    name: row[2],
    class: row[3],
    id: String(row[4]),
    keperluan: row[5],
    tujuan: String(row[6]),
    status: String(row[7]),
    jalur: String(row[8]),
    alasan_khusus: row[9],
    disetujui_oleh: row[10],
    disetujui_oleh_id: String(row[11]),
    waktu_persetujuan: row[12],
    diverifikasi_oleh: row[13],
    diverifikasi_oleh_id: String(row[14]),
    waktu_verifikasi: row[15],
    waktu_keluar: row[16],
    waktu_kembali: row[17],
    dicatat_kembali_oleh: row[18],
    dicatat_kembali_oleh_id: String(row[19]),
    // Baris lama (sebelum kolom ke-21 ada) mengembalikan undefined di sini —
    // dijaga supaya tidak berubah jadi string 'undefined'.
    kelompok_id: row[20] ? String(row[20]) : '',
    // Kolom "siapa yang mencatat" untuk keperluan pembatasan cakupan baca
    // memakai PEMBERI PERSETUJUAN — mekanisme kepemilikan yang sama (nama
    // pencatat) seperti Dicatat_Oleh di sheet lain.
    logged_by: row[10],
  };
}

// Cari baris berdasarkan ID_Izin. Baca KOLOM ID saja dulu (1 panggilan Sheets
// API), baru tarik baris yang cocok — pola yang sama dengan getRowsSince, dan
// jauh lebih murah daripada getDataRange() untuk sheet yang terus tumbuh.
// ID dipakai (bukan nomor baris dari klien) supaya baris yang bergeser tidak
// pernah membuat aksi mengenai transaksi milik siswa lain.
function findIzinRowById(sheet, id) {
  if (!sheet) return null;
  var target = String(id || '').trim();
  if (!target) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var ids = sheet.getRange(2, IZIN_COL_ID, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === target) {
      var rowIndex = i + 2;
      var values = sheet.getRange(rowIndex, 1, 1, IZIN_NUM_COLS).getValues()[0];
      return { rowIndex: rowIndex, values: values, data: izinRowToObject(values) };
    }
  }
  return null;
}

// Transaksi yang MASIH BERJALAN untuk seorang siswa. Dipakai sebagai penjaga
// double-submit sekaligus penjaga integritas: selama siswa masih 'Menunggu
// Verifikasi' atau 'Sedang di Luar', permintaan keluar kedua ditolak — jadi
// tombol yang tertekan dua kali (koneksi Apps Script lambat, guru menekan
// ulang) tidak pernah menghasilkan dua transaksi. Dicek DI DALAM script lock
// global doPost, jadi dua permintaan bersamaan tidak bisa lolos berdua.
// Membaca kolom NISN..Status saja (1 panggilan API), tanpa batas tanggal —
// baris "terbuka" seberapa pun lamanya tetap ketahuan.
function findIzinTerbukaForNisn(sheet, nisn) {
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var target = String(nisn || '').trim();
  var numCols = IZIN_COL_STATUS - IZIN_COL_NISN + 1;
  var rows = sheet.getRange(2, IZIN_COL_NISN, lastRow - 1, numCols).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]).trim() !== target) continue;
    var status = String(rows[i][IZIN_COL_STATUS - IZIN_COL_NISN]).trim();
    if (IZIN_STATUS_TERBUKA.indexOf(status) !== -1) {
      return { status: status, name: String(rows[i][1]) };
    }
  }
  return null;
}

// ===== Cakupan baca Izin Keluar =====
// TIDAK memperluas hak akses siapa pun. Dua aturan, keduanya sudah ada di
// SIGAP:
//   1. Transaksi yang MASIH BERJALAN ('Menunggu Verifikasi'/'Sedang di Luar')
//      terlihat oleh semua pemakai non-OSIS. Alasannya persis sama dengan
//      "keterlambatan & surat HARI INI terlihat seluruh sekolah": guru piket
//      yang bertugas harus tahu siapa yang masih di luar untuk bisa menandai
//      kembali, dan yang menandai kembali bukan harus orang yang memberi izin.
//      Ini transaksi berjalan, bukan riwayat.
//   2. Sisanya (Kembali/Pulang/Selesai) mengikuti aturan yang SUDAH BERLAKU
//      untuk Keterlambatan & Surat lewat scopeDailyRecordsForUser(): hari ini
//      seluruh sekolah, riwayat hari sebelumnya hanya admin/BK (semua) dan
//      wali kelas (kelasnya sendiri). Guru biasa TIDAK menyimpan riwayat
//      lintas kelas hanya karena ia yang menyetujui.
// OSIS ditolak di handler, sama seperti kategori disiplin lain.
function scopeIzinForUser(list, sessionUser, now) {
  var rows = list || [];
  if (isSchoolWideReader(sessionUser)) return rows;
  var today = now instanceof Date ? now : new Date();
  var tertutup = [];
  var terbuka = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    if (IZIN_STATUS_TERBUKA.indexOf(String(r.status).trim()) !== -1) terbuka.push(r);
    else tertutup.push(r);
  }
  var hasil = scopeDailyRecordsForUser(tertutup, sessionUser, today).concat(terbuka);
  hasil.sort(function (a, b) { return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); });
  return hasil;
}

// Detail Audit Log untuk Izin Keluar. Memuat nama+NISN siswa (sama seperti
// entri 'Edit Data'/'Hapus Data' yang sudah ada) karena jejaknya memang harus
// bisa merekonstruksi transaksi siapa — tapi TIDAK mengubah kebijakan Audit
// Log itu sendiri: sheet, format kolom, dan aksesnya (Admin-only) tetap.
function buildIzinAuditDetail(izin, tambahan) {
  var detail = izin.name + ' (' + izin.nisn + ') | kelas=' + izin.class +
    ' | tujuan=' + izin.tujuan + ' | jalur=' + izin.jalur;
  return tambahan ? detail + ' | ' + tambahan : detail;
}

// Identitas siswa diambil dari Master_Siswa, BUKAN dari yang dikirim klien.
// Aksi lama (record/addSurat) memang menulis nama & kelas apa adanya dari
// browser, tapi Izin Keluar adalah transaksi berstatus yang cakupan bacanya
// ditentukan oleh KELAS — kalau kelas boleh dikarang klien, seorang wali kelas
// bisa membuat baris berkelas apa pun dan bermain-main dengan cakupan itu.
// Jadi di sini klien cuma menentukan SIAPA (NISN), server yang menentukan
// nama & kelasnya.
function resolveSiswaForIzin(ss, nisn) {
  var target = String(nisn || '').trim();
  if (!target) return null;
  var sheet = ss.getSheetByName('Master_Siswa');
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === target) {
      return { nisn: String(rows[i][0]).trim(), name: String(rows[i][1]), class: String(rows[i][2]) };
    }
  }
  return null;
}

// ===== IZIN KELOMPOK (kegiatan dengan banyak peserta) =====
// Dipakai kalau BEBERAPA siswa keluar karena SATU kegiatan yang sama (seminar,
// lomba, kunjungan). Bukan "beberapa izin yang kebetulan barengan": kalau
// keperluannya berbeda-beda (satu sakit, satu ambil dokumen), itu tetap
// transaksi individual masing-masing — satu kegiatan = satu kelompok.
//
// Bentuk datanya SENGAJA parent/child, bukan satu baris gemuk:
//
//     Izin_Kelompok  (1 baris = 1 KEGIATAN, konteks bersama)
//            |
//            +--> Izin_Keluar (1 baris = 1 SISWA, transaksi individual)
//
// Alasannya: setiap peserta WAJIB tetap punya status sendiri (§ "Status
// Individual"). Kalau status disimpan di level kegiatan, satu siswa yang belum
// kembali akan tertutupi oleh status rombongan. Jadi baris peserta adalah baris
// Izin_Keluar biasa — status, transisi, kewenangan, dan cakupan bacanya persis
// sama dengan izin individual — dan kegiatan hanya menambahkan KONTEKS di
// atasnya lewat satu kolom kunci ID_Kelompok.
//
// Konsekuensinya yang disengaja: TIDAK ADA kolom status di sheet kegiatan.
// Keadaan rombongan ("8 siswa, 7 di luar, 1 kembali") selalu DIHITUNG dari
// baris pesertanya, sehingga tidak mungkin ada dua sumber kebenaran yang
// berselisih.
var IZIN_KELOMPOK_SHEET_NAME = 'Izin_Kelompok';
var IZIN_KELOMPOK_HEADERS = [
  'Timestamp', 'ID_Kelompok', 'Kegiatan', 'Tujuan', 'Keperluan', 'Pola_Kembali', 'Jumlah_Peserta',
  'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
];
var IZIN_KELOMPOK_NUM_COLS = IZIN_KELOMPOK_HEADERS.length; // 15
var IZIN_KELOMPOK_COL_ID = 2; // kolom B (1-based)

// Pola kembali — HANYA berlaku kalau tujuannya kembali ke sekolah:
//   bersama    : rombongan pulang-pergi bareng, penandaan kembali dilakukan
//                sekali untuk rombongan (tapi tetap per siswa, lihat di bawah)
//   individual : tiap peserta ditandai kembali sendiri-sendiri
// Untuk tujuan 'pulang' kolom ini dikosongkan — tidak ada yang kembali.
var IZIN_POLA_BERSAMA = 'bersama';
var IZIN_POLA_INDIVIDUAL = 'individual';

var IZIN_MAX_KEGIATAN = 120;
// Batas peserta per kegiatan. Bukan angka filosofis — ini pagar supaya satu
// permintaan tidak bisa memaksa server menulis ratusan baris sambil memegang
// script lock global (lihat komentar lock di doPost). Rombongan sekolah yang
// wajar jauh di bawah ini.
var IZIN_MAX_PESERTA = 60;

// Ambil identitas BANYAK siswa sekaligus dari Master_Siswa dengan SATU kali
// baca. Versi per-siswa (resolveSiswaForIzin) dipanggil berulang untuk 8-40
// peserta berarti memindai Master_Siswa 8-40 kali sambil memegang script lock
// global — persis pola yang sudah pernah bikin jam gerbang melambat (lihat
// catatan getRowsSince). Nama & kelas tetap dari Master_Siswa, TIDAK PERNAH
// dari daftar yang dikirim klien.
// Mengembalikan { siswa: [...urut sesuai permintaan...], tidakDitemukan: [nisn...] }.
function resolveSiswaListForIzin(ss, nisnList) {
  var hasil = { siswa: [], tidakDitemukan: [] };
  var diminta = nisnList || [];
  if (!diminta.length) return hasil;
  var sheet = ss.getSheetByName('Master_Siswa');
  var lastRow = sheet ? sheet.getLastRow() : 0;
  var peta = {};
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      var nisn = String(rows[i][0]).trim();
      if (nisn && !peta[nisn]) peta[nisn] = { nisn: nisn, name: String(rows[i][1]), class: String(rows[i][2]) };
    }
  }
  for (var j = 0; j < diminta.length; j++) {
    var cari = String(diminta[j] || '').trim();
    if (peta[cari]) hasil.siswa.push(peta[cari]);
    else hasil.tidakDitemukan.push(cari);
  }
  return hasil;
}

// Sama seperti findIzinTerbukaForNisn, tapi untuk BANYAK NISN sekaligus dengan
// satu kali baca. Mengembalikan daftar bentrokan [{nisn, name, status}] —
// dipakai untuk menolak SELURUH pengajuan kelompok sebelum satu baris pun
// ditulis, jadi tidak pernah ada kelompok yang tersimpan setengah jadi.
function findIzinTerbukaForNisnList(sheet, nisnList) {
  var bentrok = [];
  var diminta = nisnList || [];
  if (!sheet || !diminta.length) return bentrok;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return bentrok;
  var cari = {};
  for (var d = 0; d < diminta.length; d++) cari[String(diminta[d]).trim()] = true;
  var numCols = IZIN_COL_STATUS - IZIN_COL_NISN + 1;
  var rows = sheet.getRange(2, IZIN_COL_NISN, lastRow - 1, numCols).getValues();
  var ketemu = {};
  // Dari baris terbaru ke terlama: transaksi terakhir seorang siswa yang
  // menentukan, sama seperti findIzinTerbukaForNisn.
  for (var i = rows.length - 1; i >= 0; i--) {
    var nisn = String(rows[i][0]).trim();
    if (!cari[nisn] || ketemu[nisn]) continue;
    var status = String(rows[i][IZIN_COL_STATUS - IZIN_COL_NISN]).trim();
    if (IZIN_STATUS_TERBUKA.indexOf(status) !== -1) {
      ketemu[nisn] = { nisn: nisn, name: String(rows[i][1]), status: status };
    }
  }
  // Dikembalikan MENGIKUTI URUTAN YANG DIMINTA, bukan urutan baris sheet:
  // pesan penolakannya menyebut beberapa nama pertama saja, dan nama itu harus
  // yang pertama di daftar peserta yang barusan dipilih guru — bukan nama acak
  // dari ujung sheet yang membingungkan saat dicocokkan dengan layar.
  for (var d2 = 0; d2 < diminta.length; d2++) {
    var kunci = String(diminta[d2]).trim();
    if (ketemu[kunci]) { bentrok.push(ketemu[kunci]); delete ketemu[kunci]; }
  }
  return bentrok;
}

function izinKelompokRowToObject(row) {
  return {
    timestamp: row[0],
    id: String(row[1]),
    kegiatan: row[2],
    tujuan: String(row[3]),
    keperluan: row[4],
    pola_kembali: String(row[5] || ''),
    jumlah_peserta: Number(row[6]) || 0,
    jalur: String(row[7]),
    alasan_khusus: row[8],
    disetujui_oleh: row[9],
    disetujui_oleh_id: String(row[10]),
    waktu_persetujuan: row[11],
    diverifikasi_oleh: row[12],
    diverifikasi_oleh_id: String(row[13]),
    waktu_verifikasi: row[14],
  };
}

// Cari baris kegiatan lewat ID_Kelompok — pola & alasannya sama persis dengan
// findIzinRowById: baca kolom ID dulu (1 panggilan API), baru tarik barisnya.
function findIzinKelompokRowById(sheet, id) {
  if (!sheet) return null;
  var target = String(id || '').trim();
  if (!target) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var ids = sheet.getRange(2, IZIN_KELOMPOK_COL_ID, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === target) {
      var rowIndex = i + 2;
      var values = sheet.getRange(rowIndex, 1, 1, IZIN_KELOMPOK_NUM_COLS).getValues()[0];
      return { rowIndex: rowIndex, values: values, data: izinKelompokRowToObject(values) };
    }
  }
  return null;
}

// Semua baris peserta milik satu kegiatan, LENGKAP dengan nomor barisnya —
// aksi kelompok perlu itu untuk menulis balik status tiap peserta.
// Membaca seluruh kolom (bukan cuma kolom kunci) sekali jalan: jumlah peserta
// satu kegiatan kecil, dan ini menghindari satu getRange per peserta.
function findPesertaKelompok(sheet, idKelompok) {
  var hasil = [];
  if (!sheet) return hasil;
  var target = String(idKelompok || '').trim();
  if (!target) return hasil;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return hasil;
  var rows = sheet.getRange(2, 1, lastRow - 1, IZIN_NUM_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][IZIN_COL_KELOMPOK - 1] || '').trim() !== target) continue;
    hasil.push({ rowIndex: i + 2, values: rows[i], data: izinRowToObject(rows[i]) });
  }
  return hasil;
}

// Ringkasan keadaan rombongan, DIHITUNG dari baris peserta (bukan disimpan).
// Inilah yang membuat "8 siswa · 7 di luar · 1 kembali" tidak pernah bisa
// berselisih dengan status siswanya sendiri.
function ringkasKelompok(pesertaList) {
  var ringkas = { total: 0, menunggu: 0, diLuar: 0, kembali: 0, pulang: 0, selesai: 0 };
  var list = pesertaList || [];
  for (var i = 0; i < list.length; i++) {
    var st = String((list[i].data ? list[i].data.status : list[i].status) || '').trim();
    ringkas.total++;
    if (st === IZIN_STATUS_MENUNGGU) ringkas.menunggu++;
    else if (st === IZIN_STATUS_DI_LUAR) ringkas.diLuar++;
    else if (st === IZIN_STATUS_KEMBALI) ringkas.kembali++;
    else if (st === IZIN_STATUS_PULANG) ringkas.pulang++;
    else if (st === IZIN_STATUS_SELESAI) ringkas.selesai++;
  }
  return ringkas;
}

// Daftar peserta unik & valid dari permintaan klien. Klien boleh mengirim apa
// saja — di sini yang dipakai HANYA NISN-nya, dibersihkan, dibuang duplikatnya,
// dan dibatasi jumlahnya. Nama/kelas yang ikut terkirim diabaikan total
// (identitas diambil dari Master_Siswa).
function normalizeDaftarPesertaIzin(daftar) {
  var keluar = [];
  var terlihat = {};
  var input = daftar || [];
  if (!Array.isArray(input)) return keluar;
  for (var i = 0; i < input.length; i++) {
    var item = input[i];
    var nisn = String((item && typeof item === 'object') ? (item.nisn || '') : (item || '')).trim();
    if (!nisn || terlihat[nisn]) continue;
    terlihat[nisn] = true;
    keluar.push(nisn);
  }
  return keluar;
}

// Detail Audit Log untuk aksi kelompok. Memuat nama kegiatan + jumlah peserta,
// dan (untuk pengecualian) nama siswa yang statusnya menyimpang dari rombongan
// — itu justru inti jejaknya. Kebijakan Audit Log sendiri tidak diubah: sheet,
// kolom, dan aksesnya (Admin-only) tetap seperti semula.
function buildKelompokAuditDetail(kelompok, tambahan) {
  var detail = 'kegiatan=' + kelompok.kegiatan +
    ' | peserta=' + kelompok.jumlah_peserta +
    ' | tujuan=' + kelompok.tujuan +
    ' | pola=' + (kelompok.pola_kembali || '-') +
    ' | jalur=' + kelompok.jalur;
  return tambahan ? detail + ' | ' + tambahan : detail;
}

// Satu titik pembuangan cache untuk SEMUA aksi tulis Izin Keluar/Kelompok.
// Dipisah jadi fungsi supaya aksi baru tidak bisa lupa membuang salah satunya
// (baris peserta dan baris kegiatan selalu berubah berpasangan di layar).
function clearIzinCache() {
  var cache = CacheService.getScriptCache();
  cache.remove('izin_keluar_raw');
  cache.remove('izin_kelompok_raw');
}

// Tulis banyak baris peserta sekaligus. Baris satu kegiatan dibuat berurutan,
// jadi perubahan statusnya hampir selalu jatuh pada blok baris yang bersebelahan
// — dikelompokkan dulu supaya jadi SATU setValues per blok, bukan satu
// panggilan Sheets API per siswa (40 peserta = 40 panggilan sambil memegang
// script lock global; itu pola yang sudah pernah bikin jam gerbang melambat).
function writeIzinRowsBatch(sheet, items) {
  var list = (items || []).slice().sort(function (a, b) { return a.rowIndex - b.rowIndex; });
  var i = 0;
  while (i < list.length) {
    var mulai = i;
    while (i + 1 < list.length && list[i + 1].rowIndex === list[i].rowIndex + 1) i++;
    var blok = list.slice(mulai, i + 1).map(function (it) { return it.values; });
    sheet.getRange(list[mulai].rowIndex, 1, blok.length, IZIN_NUM_COLS).setValues(blok);
    i++;
  }
}

// Tambah banyak baris sekaligus di ujung sheet. appendRow() per baris berarti
// satu panggilan API per siswa; setValues() sekali jalan jauh lebih murah, tapi
// getRange() TIDAK boleh melewati jumlah baris yang dimiliki sheet — makanya
// sheet-nya dilebarkan dulu kalau memang kurang.
function appendRowsBatch(sheet, rows) {
  var list = rows || [];
  if (!list.length) return;
  var mulai = sheet.getLastRow() + 1;
  var butuh = mulai + list.length - 1;
  var maks = sheet.getMaxRows();
  if (butuh > maks) sheet.insertRowsAfter(maks, butuh - maks);
  sheet.getRange(mulai, 1, list.length, list[0].length).setValues(list);
}
