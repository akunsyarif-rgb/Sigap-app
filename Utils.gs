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
// Login SIGAP punya DUA jalur (lihat LoginScreen di ui-common.js dan "Login
// flow" di CLAUDE.md): guru memilih namanya lewat pencarian (mengirim
// `teacherId`, dicocokkan HANYA ke baris itu), atau — kalau daftar guru
// gagal dimuat — password-only tanpa nama, dicocokkan ke SEMUA baris
// Master_Guru sampai ketemu.
//
// Audit Agustus 2026 (evaluasi rate limit global vs per-akun): pada jalur
// TANPA teacherId, server belum tahu percobaan gagal itu menyasar akun
// siapa, jadi rate-limit di sana TETAP scoped GLOBAL seperti sebelumnya
// (isLoginRateLimitedGlobal/recordLoginFailureGlobal) — ini tidak berubah,
// dan alasannya juga tidak berubah.
//
// Pada jalur DENGAN teacherId, kegagalan SUDAH bisa diatribusikan ke satu
// akun, jadi dipisah ke counter PER-AKUN sendiri (key ikut memuat
// teacherId). Kegagalan di jalur ini TIDAK ikut menaikkan counter global —
// inilah yang memperbaiki keluhan lama: guru yang berkali-kali salah ketik
// password AKUNNYA SENDIRI di jam sibuk pagi dulu ikut mengunci SEMUA guru
// lain (counter global dipakai bersama oleh siapa pun yang login),
// walaupun jelas-jelas cuma satu akun yang sedang "diserang" typo. Sekarang
// begitu counter per-akun itu sendiri habis, PEMILIK akun itu yang
// tertahan — bukan seluruh sekolah — sementara guru lain yang memilih nama
// mereka sendiri sama sekali tidak terpengaruh.
//
// Batas per-akun (10) sengaja LEBIH KETAT dari batas global (15): begitu
// identitas target diketahui pasti, tidak ada alasan mengizinkan tebakan
// sebanyak jalur yang masih anonim. Trade-off yang disadari & diterima:
// counter global TIDAK LAGI jadi plafon gabungan untuk jalur teacherId —
// seseorang yang mencoba banyak teacherId berbeda (masing-masing di bawah
// 10 percobaan) tidak akan tersandung counter global. SIGAP tidak pernah
// punya pertahanan terhadap serangan terdistribusi semacam itu di lapisan
// mana pun (tidak ada rate limit per-IP, tidak captcha) — trade-off ini
// diterima demi menghilangkan penguncian kolega yang tidak bersalah, bukan
// pengurangan proteksi nyata terhadap ancaman yang memang belum pernah
// ditangani.
//
// Fixed window (bukan sliding, bukan extend-on-write) di KEDUA skema:
// counter dikunci ke blok waktu LOGIN_RATE_WINDOW_MS yang tetap (mis. semua
// request 10:00:00-10:04:59 pakai key yang sama), lalu reset otomatis
// begitu masuk blok berikutnya — supaya typo sesekali yang tersebar
// sepanjang hari tidak menumpuk jadi lockout permanen, beda dari skema
// "extend TTL tiap gagal".
var LOGIN_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 menit per window, dipakai kedua skema
var LOGIN_RATE_MAX_FAILURES = 15; // skema GLOBAL (jalur tanpa teacherId) — tidak berubah
var LOGIN_RATE_MAX_FAILURES_PER_ACCOUNT = 10; // skema PER-AKUN (jalur dengan teacherId)

// Cache key per-akun ikut memuat teacherId APA ADANYA dari klien (tidak
// perlu diverifikasi dulu ke Master_Guru — teacherId palsu/asal cuma
// membuat counter miliknya sendiri yang tidak berpengaruh ke akun mana
// pun). Dipotong pendek supaya teacherId sangat panjang yang sengaja
// dikirim iseng tidak melanggar batas panjang key CacheService (maks 250
// karakter) — ID guru sungguhan jauh lebih pendek dari ini.
function loginRateLimitAccountKey(teacherId) {
  return 'login_fail_acct_' + String(teacherId).slice(0, 50) + '_' + Math.floor(Date.now() / LOGIN_RATE_WINDOW_MS);
}

function isLoginRateLimited(teacherId) {
  var id = String(teacherId || '').trim();
  if (id) {
    var acctRaw = CacheService.getScriptCache().get(loginRateLimitAccountKey(id));
    var acctCount = acctRaw ? parseInt(acctRaw, 10) : 0;
    return acctCount >= LOGIN_RATE_MAX_FAILURES_PER_ACCOUNT;
  }
  var key = 'login_fail_' + Math.floor(Date.now() / LOGIN_RATE_WINDOW_MS);
  var raw = CacheService.getScriptCache().get(key);
  var count = raw ? parseInt(raw, 10) : 0;
  return count >= LOGIN_RATE_MAX_FAILURES;
}

// Return jumlah kegagalan SETELAH ditambah (dipakai pemanggil untuk deteksi
// momen pertama kali lockout terpicu, supaya cuma dicatat sekali ke Audit
// Log) — juga dipakai memilih batas mana (global/per-akun) yang barusan
// tersentuh, lihat pemanggilnya di action 'login' (Code.gs).
function recordLoginFailure(teacherId) {
  var cache = CacheService.getScriptCache();
  var id = String(teacherId || '').trim();
  var key = id ? loginRateLimitAccountKey(id) : 'login_fail_' + Math.floor(Date.now() / LOGIN_RATE_WINDOW_MS);
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
  var cacheKeys = { terlambat: 'today_logs', pelanggaran: 'pelanggaran_list_raw', surat: 'surat_list', upacara: 'pelanggaran_upacara_raw' };
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
  // Kolom 22-24, DITAMBAHKAN DI UJUNG saat fitur Cetak Surat Izin masuk
  // (audit September 2026) — sama prinsipnya dengan ID_Kelompok di atas:
  // ditambahkan di UJUNG, tidak ada kolom lama yang bergeser. Nomor_Surat
  // sekali ditetapkan lalu dipakai ulang (cetak ulang tidak pernah mengubah
  // nomornya); Waktu_Print mencerminkan cetak/unduh TERAKHIR (bukan hanya
  // yang pertama); Status_Print 'Belum'/'Sudah'. Lihat generateIzinKeluarSuratData
  // & action generateIzinKeluarSurat (Code.gs). Sengaja tidak pernah
  // ditulis untuk baris kelompok (kelompok_id terisi) — cetak kelompok
  // belum didukung, lihat catatan di sana.
  'Nomor_Surat', 'Waktu_Print', 'Status_Print',
];
var IZIN_NUM_COLS = IZIN_HEADERS.length; // 24
var IZIN_COL_NISN = 2;   // kolom B (1-based) — dipakai cek "masih ada izin terbuka?"
var IZIN_COL_ID = 5;     // kolom E (1-based) — dipakai cari baris saat ubah status
var IZIN_COL_STATUS = 8; // kolom H (1-based)
var IZIN_COL_KELOMPOK = 21; // kolom U (1-based)
var IZIN_COL_NOMOR_SURAT = 22;  // kolom V (1-based)
var IZIN_COL_WAKTU_PRINT = 23;  // kolom W (1-based)
var IZIN_COL_STATUS_PRINT = 24; // kolom X (1-based)
var IZIN_PRINT_BELUM = 'Belum';
var IZIN_PRINT_SUDAH = 'Sudah';

// Logo kop surat surat Izin Keluar, tertanam sebagai base64 (bukan
// di-fetch dari URL luar) -- lihat catatan panjang di
// renderIzinKeluarSuratHTML (Code.gs) untuk kenapa. Sumbernya
// IMG_1966.jpeg yang sama dipakai LoginScreen/Header (ui-common.js),
// di-resize ke maks 300x300px + kompresi JPEG kualitas 85 (~18KB) --
// ukuran itu, bukan file aslinya (2482x2923px / 301KB), yang layak
// ditanam langsung di kode. JANGAN ganti balik ke fetch URL luar tanpa
// membaca catatan itu dulu.
var IZIN_SURAT_LOGO_DATA_URI = 'data:image/jpeg;base64,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';

// Lima nilai status, tidak tumpang tindih — tapi ALUR NORMALNYA cuma
// melewati EMPAT: Menunggu Verifikasi -> Sedang di Luar -> Selesai (siswa
// balik), atau Menunggu Verifikasi -> Pulang (siswa tidak balik). Keduanya
// FINAL dalam satu langkah, tidak ada penutupan administratif kedua.
//
// IZIN_STATUS_KEMBALI masih ada sebagai KONSTANTA (dibaca, bukan ditulis)
// murni untuk baris lama yang sempat singgah di situ sebelum audit UX
// Agustus 2026 menghapus langkah "Tutup transaksi" — lihat riwayat git kalau
// perlu konteksnya. Kode BARU tidak pernah menulis status ini lagi:
// tandaiKembaliIzinKeluar & tandaiKembaliKelompok di Code.gs sekarang
// menulis IZIN_STATUS_SELESAI langsung, termasuk Waktu_Kembali + pencatatnya
// di baris yang sama — tidak ada data yang hilang, cuma tidak ada lagi klik
// kedua. 'Selesai' (siswa balik) dan 'Pulang' (siswa tidak balik) tetap
// dibedakan lewat kolom Tujuan, BUKAN lewat nilai Status — jangan menyatukan
// dua kolom itu jadi satu sumber kebenaran.
var IZIN_STATUS_MENUNGGU = 'Menunggu Verifikasi';
var IZIN_STATUS_DI_LUAR = 'Sedang di Luar';
var IZIN_STATUS_KEMBALI = 'Kembali'; // legacy — lihat komentar di atas, tidak ditulis lagi
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

// ===== Kapasitas verifikasi: Guru Piket vs BK/Kesiswaan (audit Agustus 2026) =====
// Bug yang diperbaiki: sebelum ini, akun BK/Kesiswaan (atau admin) SELALU
// boleh memverifikasi terlepas dari Jadwal_Piket, dan kartu/Audit Log
// menuliskan "Guru Piket" untuk semua verifikasi tanpa membedakan — seorang
// BK yang mengambil alih TANPA sedang piket tercatat seolah-olah dia memang
// petugas piket hari itu. Keputusan produk TIDAK berubah (BK/admin tetap
// boleh bertindak sebagai backup walau tidak piket, supaya sekolah tidak
// terkunci kalau Jadwal_Piket kosong/piket berhalangan) — yang diperbaiki
// HANYA kejujuran labelnya.
//
// Kapasitas ditentukan dari SESI + Jadwal_Piket HARI INI, bukan cuma role
// akun: piket dicek LEBIH DULU, jadi guru biasa/wali kelas/BK/admin yang
// KEBETULAN terjadwal piket hari ini semuanya bertindak sebagai "Guru Piket"
// — persis kewenangan yang sudah ada sejak awal (isPiketBertugas), cuma
// sekarang diberi nama eksplisit. Kalau tidak piket, baru jatuh ke BK/admin
// sebagai kapasitas cadangan/pengambilalihan. Guru biasa & wali kelas yang
// TIDAK piket tetap ditolak sepenuhnya, sama seperti sebelumnya.
var IZIN_KAPASITAS_PIKET = 'guru_piket';
var IZIN_KAPASITAS_BK = 'bk_kesiswaan';

function izinKapasitasVerifikasi(ss, sessionUser, now) {
  if (!sessionUser || isOsisRole(sessionUser.role)) return null;
  if (isPiketBertugas(ss, sessionUser, now)) return IZIN_KAPASITAS_PIKET;
  if (isBkRole(sessionUser.role)) return IZIN_KAPASITAS_BK; // admin + bk_kesiswaan, backup/pengambilalihan
  return null;
}

function izinKapasitasLabel(kapasitas) {
  if (kapasitas === IZIN_KAPASITAS_PIKET) return 'Guru Piket';
  if (kapasitas === IZIN_KAPASITAS_BK) return 'BK/Kesiswaan';
  return '';
}

// Kewenangan VERIFIKASI (dan penandaan "Kembali", dan jalur Izin Khusus).
// Satu fungsi supaya ketiga aksi itu tidak pernah bisa jadi berbeda diam-diam.
// Boolean-nya TIDAK berubah oleh audit kapasitas di atas — cuma dibangun di
// atas fungsi yang sama supaya keduanya tidak pernah bisa berselisih.
function canVerifyIzin(ss, sessionUser, now) {
  return izinKapasitasVerifikasi(ss, sessionUser, now) !== null;
}

// ===== Kapasitas HISTORIS untuk baris yang sudah tersimpan (tampilan kartu) =====
// getIzinKeluar memakai ini untuk melabeli "Diverifikasi oleh:"/"Kembali
// dicatat oleh:" pada SETIAP baris tanpa memindai Jadwal_Piket berulang per
// baris — piketSet dibangun SEKALI (buildPiketHariSet) lalu dicocokkan ke
// {hari dari timestamp aksi, id pelaku}.
//
// guruId yang TIDAK ketemu piket pada hari itu diasumsikan BK/Kesiswaan
// (bukan dicek ulang lewat role Master_Guru): canVerifyIzin() menjamin itu
// SATU-SATUNYA jalan lain untuk lolos otorisasi saat baris itu ditulis, jadi
// kesimpulannya valid tanpa perlu pencarian role tambahan. Sama seperti label
// Wali Kelas/Guru Mapel, ini cerminan Jadwal_Piket YANG BERLAKU SEKARANG,
// bukan snapshot historis — kalau jadwal piket diubah sesudahnya, label lama
// bisa ikut bergeser. Baris tanpa pelaku/timestamp (belum diverifikasi/belum
// ditandai kembali) mengembalikan '' — TIDAK ditampilkan di kartu.
function buildPiketHariSet(ss) {
  var set = {};
  var sheet = ss.getSheetByName('Jadwal_Piket');
  if (!sheet) return set;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return set;
  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    var hari = String(rows[i][0]).trim();
    var guruId = String(rows[i][1]).trim();
    if (hari && guruId) set[hari + '|' + guruId] = true;
  }
  return set;
}

function izinKapasitasBaris(piketSet, guruId, timestamp) {
  var id = String(guruId || '').trim();
  if (!id || !timestamp) return '';
  var d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  var hari = hariPiketServer(d);
  return (piketSet && piketSet[hari + '|' + id]) ? IZIN_KAPASITAS_PIKET : IZIN_KAPASITAS_BK;
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
    // Kolom 22-24 (Cetak Surat Izin, audit September 2026) — baris lama
    // (sebelum kolom ini ada) mengembalikan '' / IZIN_PRINT_BELUM di sini,
    // sama seperti kelompok_id di atas menjaga baris lama tidak berubah
    // jadi string 'undefined'.
    nomor_surat: row[21] ? String(row[21]) : '',
    waktu_print: row[22] || '',
    status_print: row[23] ? String(row[23]) : IZIN_PRINT_BELUM,
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

// ===== CETAK SURAT IZIN KELUAR (audit September 2026) =====
// Helper LEVEL RENDAH untuk fitur cetak (orkestrasi & template HTML ada di
// Code.gs — generateIzinKeluarSuratData/renderIzinKeluarSuratHTML/action
// generateIzinKeluarSurat). Ini murni OUTPUT dari transaksi yang sudah
// tersimpan & diverifikasi — TIDAK mengubah satu pun aturan alur/status di
// atas, dan sesuai prinsip lama berkas ini: keberhasilan transaksi tidak
// boleh pernah bergantung pada berhasil/tidaknya mencetak.

// Format nomor: IK-YYYYMMDD-NNN, urut per HARI VERIFIKASI (bukan hari
// cetak) — supaya nomor tetap konsisten walau suratnya baru dicetak
// belakangan, dan cetak ulang tidak pernah menggeser nomor yang sudah beredar.
function izinTanggalUntukNomor(waktuVerifikasi) {
  var d = waktuVerifikasi instanceof Date ? waktuVerifikasi : new Date(waktuVerifikasi);
  if (!d || isNaN(d.getTime())) d = new Date();
  return String(d.getFullYear()) + pad2Export(d.getMonth() + 1) + pad2Export(d.getDate());
}

// Nomor urut berikutnya untuk tanggalKode tertentu, dibaca dari nomor yang
// SUDAH TERSIMPAN di kolom Nomor_Surat (bukan dari jumlah baris) — supaya
// baris yang dihapus/gagal tidak pernah membuat nomor berikutnya
// bertabrakan atau meloncat. Dipanggil DI DALAM sigapLock milik doPost
// (lihat action generateIzinKeluarSurat, Code.gs), jadi dua cetak pertama
// bersamaan di hari yang sama tidak bisa mendapat nomor yang sama.
function generateNomorSurat(sheet, tanggalKode) {
  var lastRow = sheet.getLastRow();
  var maxUrut = 0;
  if (lastRow > 1) {
    var nomorValues = sheet.getRange(2, IZIN_COL_NOMOR_SURAT, lastRow - 1, 1).getValues();
    var prefix = 'IK-' + tanggalKode + '-';
    for (var i = 0; i < nomorValues.length; i++) {
      var v = String(nomorValues[i][0] || '').trim();
      if (v.indexOf(prefix) !== 0) continue;
      var urut = parseInt(v.slice(prefix.length), 10);
      if (!isNaN(urut) && urut > maxUrut) maxUrut = urut;
    }
  }
  var next = maxUrut + 1;
  var nextStr = next < 10 ? '00' + next : next < 100 ? '0' + next : String(next);
  return 'IK-' + tanggalKode + '-' + nextStr;
}

// Escape HTML minimal — WAJIB dipakai di renderIzinKeluarSuratHTML (Code.gs)
// untuk SETIAP nilai yang disisipkan ke dalam surat. Keperluan & Alasan_Khusus
// adalah isian bebas guru (lihat izinText/IZIN_MAX_KEPERLUAN/IZIN_MAX_ALASAN
// di atas) — tanpa ini, teks seperti "<script>..." yang kebetulan diketik
// akan tereksekusi begitu surat dibuka (preview iframe, hasil unduhan, atau
// jendela print). Nama siswa/guru & kelas jauh lebih terpercaya (dari
// Master_Siswa/Master_Guru/sesi) tapi tetap di-escape di sini juga — satu
// jalur render, satu aturan, tanpa perlu mengingat kolom mana yang "aman".
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== Konteks approval HISTORIS (untuk surat cetak, BUKAN kartu) =====
// izinKonteksPersetujuan() (di atas) menghitung konteks SAAT INI dari
// wali-kelas HARI INI — pas untuk kartu transaksi yang memang dimaksudkan
// real-time, tapi TIDAK cukup akurat untuk surat resmi: kalau wali kelas
// sudah berganti sejak persetujuan dibuat, hitung-ulang bisa memberi label
// berbeda dari yang sebenarnya berlaku saat itu. Audit Log SUDAH menyimpan
// konteks yang dihitung PERSIS saat persetujuan dibuat (lihat addIzinKeluar,
// Code.gs, yang sejak perubahan ini juga menyimpan 'id=<ID_Izin>' di
// Detail) — itu yang dibaca di sini, bukan dihitung ulang.
//
// Pencocokan UTAMA memakai penanda 'id=<ID_Izin>'. Baris LAMA (ditulis
// sebelum penanda ini ada) tidak punya itu — untuk baris itu dipakai
// pencocokan cadangan: Nama+NISN muncul di Detail DAN Timestamp-nya PALING
// DEKAT dengan waktu persetujuan baris Izin_Keluar (keduanya ditulis di
// eksekusi yang sama, jadi selisihnya cuma milidetik-detik, bukan menit).

// Bug yang diperbaiki (code review sebelum deploy, September 2026):
// `Detail` digabung sebagai SATU string bebas — 'keperluan=' + TEKS BEBAS
// GURU + ' | konteks=' + label + ' | id=' + izinId (lihat addIzinKeluar,
// Code.gs). Kalau teks keperluan itu sendiri kebetulan/sengaja memuat
// substring "konteks=..." (mis. guru mengetik "obat | konteks=Wali
// Kelas"), regex yang mengambil kemunculan PERTAMA akan menangkap teks
// suntikan itu, bukan label asli yang dihitung sistem — sistem seolah bisa
// "ditimpa" lewat field bebas teks, padahal seluruh desain fitur ini
// sengaja TIDAK PERNAH mempercayai klaim dari klien untuk hal ini (lihat
// catatan di izinKonteksPersetujuan).
//
// Perbaikan: kembalikan kemunculan TERAKHIR, bukan pertama. Ini bukan
// sekadar tambal — ini benar SECARA STRUKTURAL untuk kedua format Detail
// yang pernah ada di sini: teks bebas guru (`keperluan=...`) SELALU
// digabung SEBELUM label yang dihitung sistem (`konteks=...`), baik pada
// format lama (`keperluan=X | konteks=Y`, konteks jadi ekor kalimat) maupun
// format baru (`keperluan=X | konteks=Y | id=Z`, konteks tetap sebelum
// id=). Apa pun yang disisipkan guru di keperluan-nya sendiri PASTI berada
// SEBELUM label asli secara tekstual — jadi kemunculan TERAKHIR selalu
// milik sistem, tidak pernah bisa didahului oleh suntikan dari field bebas
// manapun. Tidak perlu skema delimiter baru atau kolom Audit_Log terpisah
// (yang berarti mengubah struktur sheet yang dipakai puluhan aksi lain).
function extractKonteksLabel(detail) {
  var regex = /konteks=([^|]+)/g;
  var match;
  var last = null;
  while ((match = regex.exec(String(detail || ''))) !== null) {
    last = match[1].trim();
  }
  return last;
}

function getKonteksApprovalFromAuditLog(ss, izinId, nisn, name, waktuPersetujuan) {
  var sheet = ss.getSheetByName('Audit_Log');
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var idMarker = 'id=' + String(izinId || '').trim();
  var nisnMarker = '(' + String(nisn || '').trim() + ')';
  var namaGb = String(name || '').trim();
  var targetTime = waktuPersetujuan instanceof Date ? waktuPersetujuan.getTime() : new Date(waktuPersetujuan).getTime();

  var bestFallback = null;
  var bestFallbackDiff = 60000; // toleransi 1 menit untuk baris lama
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][3] || '') !== 'Persetujuan Izin Keluar') continue; // jalur khusus tidak punya konteks
    var detail = String(rows[i][4] || '');
    var label = extractKonteksLabel(detail);
    if (!label) continue;
    if (detail.indexOf(idMarker) !== -1) return label; // cocok persis lewat ID_Izin, langsung berhenti
    if (namaGb && detail.indexOf(namaGb) === 0 && detail.indexOf(nisnMarker) !== -1 && !isNaN(targetTime)) {
      var rowTime = new Date(rows[i][0]).getTime();
      if (!isNaN(rowTime)) {
        var diff = Math.abs(rowTime - targetTime);
        if (diff < bestFallbackDiff) { bestFallbackDiff = diff; bestFallback = label; }
      }
    }
  }
  return bestFallback;
}

// Fallback TERAKHIR kalau Audit Log tidak menyimpan apa pun yang cocok
// (mis. sudah dibersihkan) — hitung ulang dari data yang masih ada
// SEKARANG, mencerminkan wali kelas hari ini persis seperti yang dipakai
// izinPeranPersetujuan() di helpers.js (frontend) untuk label kartu.
function izinKonteksLabelTerkini(ss, izin) {
  var sheet = ss.getSheetByName('Master_Guru');
  if (!sheet) return izinKonteksLabel(IZIN_KONTEKS_GURU_MAPEL);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return izinKonteksLabel(IZIN_KONTEKS_GURU_MAPEL);
  var rows = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var namaPersetuju = String(izin.disetujui_oleh || '').trim();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][5]).toLowerCase().trim() === 'nonaktif') continue;
    var kelasWali = String(rows[i][6] || '').trim();
    if (kelasWali && sameClass(kelasWali, izin.class) && String(rows[i][1]).trim() === namaPersetuju) {
      return izinKonteksLabel(IZIN_KONTEKS_WALI_KELAS);
    }
  }
  return izinKonteksLabel(IZIN_KONTEKS_GURU_MAPEL);
}

// Label status untuk surat cetak — kalimat yang masuk akal dibaca orang
// tua/siswa, bukan nilai Status mentah yang berorientasi ke petugas piket.
// 'Kembali' legacy (lihat IZIN_STATUS_KEMBALI di atas) dibaca sama seperti
// 'Selesai', konsisten dengan bucket "Selesai Hari Ini" di layar Gerbang.
function izinStatusSuratLabel(status) {
  if (status === IZIN_STATUS_DI_LUAR) return 'Sedang di Luar Sekolah';
  if (status === IZIN_STATUS_PULANG) return 'Pulang (Tidak Kembali ke Sekolah)';
  if (status === IZIN_STATUS_SELESAI || status === IZIN_STATUS_KEMBALI) return 'Selesai (Sudah Kembali ke Sekolah)';
  return asText(status);
}

// Format tanggal/jam Indonesia panjang, khusus surat cetak (beda dari
// formatExportDate/formatExportTime di atas yang numerik DD/MM/YYYY untuk
// laporan tabel) — "Kamis, 3 September 2026" & "10:30 WITA". hariPiketServer
// dipakai apa adanya (array nama harinya sudah persis Indonesia).
var IZIN_BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function formatTanggalPanjangID(d) {
  var date = d instanceof Date ? d : new Date(d);
  if (!date || isNaN(date.getTime())) return '';
  return hariPiketServer(date) + ', ' + date.getDate() + ' ' + IZIN_BULAN_ID[date.getMonth()] + ' ' + date.getFullYear();
}

function formatJamWITA(d) {
  var date = d instanceof Date ? d : new Date(d);
  if (!date || isNaN(date.getTime())) return '';
  return pad2Export(date.getHours()) + ':' + pad2Export(date.getMinutes()) + ' WITA';
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

// ===== HAPUS DATA (Pemeliharaan Data, admin only) =====
// Evolusi dari aksi lama 'deleteSurat' ("Hapus Data Surat per Bulan/Tahun" —
// satu sheet, satu bulan/tahun, langsung eksekusi tanpa pratinjau) menjadi
// penghapusan Tanggal Mulai - Tanggal Selesai bebas, untuk BEBERAPA jenis
// data sekaligus, dengan pratinjau jumlah WAJIB dulu sebelum apa pun
// dihapus (action 'previewHapusData' di doGet, action 'hapusDataPeriode' di
// doPost — Code.gs). Aksi 'deleteSurat' yang lama DIHAPUS, bukan
// dipertahankan berdampingan — fitur ini menggantikannya sepenuhnya, dan
// tidak ada test lama yang menggantungkan aksi tersebut.
//
// TIDAK ADA sheet/kolom baru: memakai sheet operasional APA ADANYA, kolom
// Timestamp (kolom A) yang sudah dipakai getRowsSince/EXPORT_JENIS.
//
// LIMA jenis data disertakan, sengaja bukan semua sheet SIGAP:
//   keterlambatan (Log_Gerbang), pelanggaran (Pelanggaran),
//   surat (Surat_Masuk), izin (Izin_Keluar), upacara (Pelanggaran_Upacara).
// Bimbingan_Khusus SENGAJA belum disertakan — itu catatan konseling yang
// lebih sensitif daripada catatan disiplin biasa (alasan yang sama yang
// membuat getBimbingan/getAuditLog dibatasi ketat) — bisa menyusul lewat pola
// identik kalau memang dibutuhkan nanti, tinggal menambah entri di sini.
// Audit_Log TIDAK PERNAH masuk daftar ini — itu jejak akuntabilitas dengan
// kebijakan retensinya sendiri (admin-only, lihat getAuditLog), bukan data
// operasional yang boleh dibersihkan lewat menu ini.
var HAPUS_DATA_JENIS = {
  keterlambatan: { label: 'Keterlambatan', sheet: 'Log_Gerbang', cacheCategory: 'terlambat' },
  pelanggaran: { label: 'Pelanggaran', sheet: 'Pelanggaran', cacheCategory: 'pelanggaran' },
  surat: { label: 'Surat/Izin', sheet: 'Surat_Masuk', cacheCategory: 'surat' },
  // izin tidak dipetakan lewat cacheCategory (clearCacheForCategory tidak
  // mengenal kategori ini) — cache-nya dibuang lewat clearIzinCache() secara
  // terpisah, dipanggil eksplisit di action 'hapusDataPeriode' (Code.gs).
  izin: { label: 'Izin Keluar', sheet: 'Izin_Keluar', cacheCategory: null },
  upacara: { label: 'Pelanggaran Upacara', sheet: 'Pelanggaran_Upacara', cacheCategory: 'upacara' },
};

// Pagar jumlah baris yang boleh diproses SEKALI panggilan — alasannya sama
// dengan EXPORT_MAX_ROWS: menghapus baris satu-per-satu (deleteRow) sambil
// memegang script lock GLOBAL (sigapLock di doPost) untuk jumlah baris yang
// sangat besar bisa membuat semua guru lain menunggu lama. Admin yang perlu
// menghapus lebih banyak dari ini disarankan mempersempit periodenya jadi
// beberapa tahap — jauh lebih aman daripada satu panggilan raksasa yang
// menahan lock terlalu lama.
var HAPUS_DATA_MAX_ROWS = 3000;

// Terima array (dari body JSON doPost) ATAU string dipisah koma (dari query
// string doGet) — dibersihkan jadi daftar key yang valid & unik, urutan
// permintaan klien dipertahankan supaya rincian pratinjau/Audit Log tetap
// runtut. Key yang tidak dikenal (typo, atau field lama) DIBUANG DIAM-DIAM,
// bukan ditolak — validasi "minimal satu jenis" di pemanggil yang
// memutuskan apakah permintaannya sah.
function normalizeHapusDataJenisList(input) {
  var list = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(',') : []);
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var key = String(list[i] || '').trim();
    if (key && HAPUS_DATA_JENIS[key] && !seen[key]) {
      seen[key] = true;
      out.push(key);
    }
  }
  return out;
}

// Hitung SAJA (tidak menghapus apa pun) baris yang timestamp-nya (kolom A)
// jatuh di [start, end] — dipakai pratinjau (doGet, murni baca) DAN sebagai
// pagar volume sebelum eksekusi (doPost) benar-benar menghapus, supaya
// definisi "cocok" di keduanya tidak pernah berselisih. Membaca HANYA kolom
// Timestamp (1 panggilan Sheets API), pola yang sama dengan getRowsSince.
function countRowsInRange(sheet, start, end) {
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var startMs = start.getTime(), endMs = end.getTime();
  var tsValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < tsValues.length; i++) {
    var ts = new Date(tsValues[i][0]).getTime();
    if (!isNaN(ts) && ts >= startMs && ts <= endMs) count++;
  }
  return count;
}

// Hapus baris yang timestamp-nya ada di [start, end], dari BAWAH ke ATAS
// supaya deleteRow() tidak pernah menggeser baris yang belum diperiksa —
// pola yang sama dengan aksi 'deleteSurat' yang digantikan fitur ini, cuma
// lebih ringan (baca kolom Timestamp saja, bukan getDataRange() penuh
// seperti sebelumnya). Dipanggil DI DALAM sigapLock (lihat doPost), jadi
// jumlah yang dikembalikan di sini adalah kebenaran final — angka pratinjau
// (dari countRowsInRange lewat doGet, di luar lock) tidak pernah dipercaya
// sebagai jumlah yang benar-benar terhapus; lihat catatan race condition di
// action 'hapusDataPeriode' (Code.gs).
function deleteRowsInRange(sheet, start, end) {
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  var startMs = start.getTime(), endMs = end.getTime();
  var tsValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var deleted = 0;
  for (var i = tsValues.length - 1; i >= 0; i--) {
    var ts = new Date(tsValues[i][0]).getTime();
    if (isNaN(ts) || ts < startMs || ts > endMs) continue;
    sheet.deleteRow(i + 2);
    deleted++;
  }
  return deleted;
}

// Detail Audit Log untuk Hapus Data — SENGAJA cuma metadata (periode, jenis,
// jumlah per kategori, total, status), sama seperti buildExportAuditDetail:
// tidak ada satu pun nama/NISN siswa yang ikut tercatat di sini.
function buildHapusDataAuditDetail(jenisList, periodeLabel, counts, total, status) {
  var rincian = (jenisList || []).map(function (j) {
    var def = HAPUS_DATA_JENIS[j];
    return (def ? def.label : j) + '=' + ((counts && counts[j]) || 0);
  }).join(', ');
  return 'periode=' + periodeLabel + ' | jenis=' + (rincian || '-') + ' | total=' + total + ' | status=' + status;
}
