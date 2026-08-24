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
//   Keterlambatan HARI INI : seluruh sekolah untuk semua role non-OSIS.
//     Ini BUKAN kelonggaran — guru piket di gerbang harus saling melihat
//     catatan hari itu supaya satu siswa tidak dicatat dua kali (lihat
//     GerbangTab di gerbang.js & pengecekan duplikat di aksi 'record').
//   RIWAYAT keterlambatan  : admin/BK seluruh sekolah; wali kelas = kelasnya
//     sendiri + catatan yang ia tulis; guru biasa = HANYA catatan yang ia
//     tulis sendiri.
//   PELANGGARAN            : admin/BK seluruh sekolah; wali kelas = kelasnya
//     sendiri + catatan yang ia tulis; guru biasa = HANYA catatan yang ia
//     tulis sendiri. (Tidak ada pengecualian "hari ini" di sini — mencatat
//     pelanggaran tidak punya alur anti-duplikat seperti gerbang.)
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

// logs = daftar objek {timestamp, class, logged_by, ...} (urutan/isi lain
// dibiarkan apa adanya). now dipisah jadi parameter supaya bisa diuji.
function scopeLateLogsForUser(logs, sessionUser, now) {
  var list = logs || [];
  if (isSchoolWideReader(sessionUser)) return list;
  var today = now instanceof Date ? now : new Date();
  var kelas = readerClass(sessionUser);
  return list.filter(function (l) {
    if (!l) return false;
    // Hari ini: seluruh sekolah (alur gerbang di atas).
    if (l.timestamp && isSameDayServer(new Date(l.timestamp), today)) return true;
    // Wali kelas: kelas perwaliannya.
    if (kelas && sameClass(l.class, kelas)) return true;
    // Sisanya: hanya catatan sendiri.
    return ownsRow(l, sessionUser);
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
    lateForBanner: scopeLateLogsForUser(data.lateForBanner || [], sessionUser),
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
// scopeLateLogsForUser di Code.gs — tanpa keduanya, riwayat lengkap seorang
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
