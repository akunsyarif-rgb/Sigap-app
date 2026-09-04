// ===== Code.gs (Main / Router) =====
// Titik masuk utama Web App: doPost dan doGet menangani semua permintaan
// dari index.html. Logika keamanan (checkToken, sesi) ada di Auth.gs/Utils.gs.

// ===== Penanda versi backend =====
// Repo ini TIDAK pernah men-deploy Apps Script otomatis (lihat CLAUDE.md), dan
// dua cara deploy yang gagal sama-sama DIAM: kode disimpan di editor tapi
// deployment-nya tidak dibuatkan versi baru, atau "New deployment" ditekan
// sehingga URL Web App-nya berganti sementara config.js masih menunjuk yang
// lama. Gejalanya identik dengan "kodenya salah": perilaku lama tetap jalan.
//
// Penanda ini membuat pertanyaan "versi mana yang sedang dilayani?" bisa
// dijawab tanpa menebak — buka API_URL + '?token=<API_TOKEN>' di browser,
// lalu cocokkan `version` di bawah dengan yang ada di file ini.
// NAIKKAN tanggal/labelnya setiap kali .gs diubah dengan cara yang perlu
// diverifikasi setelah deploy. Tidak memuat rahasia apa pun, dan tetap
// digembok API_TOKEN seperti seluruh endpoint lain.
var BACKEND_VERSION = '2026-09-04-logo-surat-base64';
var BACKEND_FEATURES = ['exportData', 'scopedLogs', 'scopedSurat', 'scopedPelanggaran', 'adminOnlyAuditLog', 'izinKeluar', 'izinKelompok', 'exportIzin', 'hapusDataPeriode', 'changeMyPassword', 'loginRateLimitPerAkun', 'pushNotifications', 'cetakSuratIzin'];

// ===== doPost =====

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (!checkToken(data.token)) {
      return jsonOut({ status: 'error', message: 'Unauthorized' });
    }

    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ---- Login ----
    if (action === 'login') {
      // Dikirim kalau guru memilih namanya lewat pencarian di layar login.
      // Kosong = mode legacy (password-only, tanpa pilih nama) yang SENGAJA
      // masih dipertahankan — lihat komentar isLoginRateLimited() di Utils.gs.
      // Diambil di SINI (sebelum gerbang rate limit) karena sejak audit
      // Agustus 2026 rate limit-nya sendiri bercabang berdasarkan nilai ini:
      // per-akun kalau terisi, global (seperti sebelumnya) kalau kosong.
      var requestedTeacherId = String(data.teacherId || '').trim();

      // Cek lockout SEBELUM sentuh sheet sama sekali — lihat komentar
      // isLoginRateLimited() di Utils.gs untuk skema global vs per-akun.
      if (isLoginRateLimited(requestedTeacherId)) {
        return jsonOut({ status: 'error', message: 'Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.' });
      }

      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();

      var loggedInUser = null;
      var isDisabled = false;
      var matchedRowIndex = -1;
      var needsMigration = false;
      for (var i = 1; i < rows.length; i++) {
        // Kalau ID-nya sudah diketahui, cukup cek baris itu saja — password
        // guru lain tidak ikut dicocokkan, jadi PIN yang kebetulan sama
        // tidak bisa nyasar masuk ke akun orang lain.
        if (requestedTeacherId && String(rows[i][0]).trim() !== requestedTeacherId) continue;
        // Kolom H (index 7) = Salt. Kosong = akun belum dimigrasi ke skema
        // hash baru (lihat verifyPassword di Auth.gs) — masih dicek lewat
        // jalur lama supaya guru yang sudah pernah set password tidak perlu
        // reset paksa.
        var checkResult = verifyPassword(data.password, String(rows[i][2]), String(rows[i][7] || ''));
        if (checkResult && checkResult.matched) {
          if (String(rows[i][5]).toLowerCase().trim() === 'nonaktif') {
            isDisabled = true;
            break;
          }
          // Kolom G (index 6) = Kelas_Wali. Kosong kalau guru ini bukan wali kelas.
          loggedInUser = { id: rows[i][0], name: rows[i][1], role: rows[i][3], jabatan: rows[i][4] || '', waliKelas: rows[i][6] || '' };
          matchedRowIndex = i;
          needsMigration = checkResult.needsMigration;
          break;
        }
      }

      if (isDisabled) {
        return jsonOut({ status: 'error', message: 'Akun ini sudah dinonaktifkan. Hubungi admin.' });
      }
      if (loggedInUser) {
        if (needsMigration) {
          var migratedSalt = generateSalt();
          sheet.getRange(matchedRowIndex + 1, 3).setValue(hashPasswordSalted(data.password, migratedSalt));
          sheet.getRange(matchedRowIndex + 1, 8).setValue(migratedSalt);
        }
        var sessionToken = createSession(loggedInUser);
        logAudit(loggedInUser, 'Login', '');
        return jsonOut({ status: 'success', user: loggedInUser, sessionToken: sessionToken });
      }

      // Password tidak cocok ke akun mana pun — hitung sebagai percobaan
      // gagal untuk rate limit. Lockout baru dicatat ke Audit Log SEKALI
      // (saat count baru menyentuh batas), bukan tiap request, supaya log
      // tidak banjir kalau ada percobaan brute-force beneran. Skema mana
      // yang tersentuh (per-akun/global) mengikuti requestedTeacherId, sama
      // seperti gerbang isLoginRateLimited() di atas.
      var failCount = recordLoginFailure(requestedTeacherId);
      var failThreshold = requestedTeacherId ? LOGIN_RATE_MAX_FAILURES_PER_ACCOUNT : LOGIN_RATE_MAX_FAILURES;
      if (failCount === failThreshold) {
        logAudit({ name: 'System', id: '-' }, 'Login Rate Limit Triggered',
          (requestedTeacherId ? 'Lockout akun ' + requestedTeacherId + ' aktif ' : 'Lockout global aktif ') +
          (LOGIN_RATE_WINDOW_MS / 60000) + ' menit setelah ' + failCount + ' percobaan gagal');
      }
      return jsonOut({ status: 'error', message: 'Password salah!' });
    }

    // ---- Logout (dicatat ke Audit Log, sesi dihapus dari server) ----
    if (action === 'logout') {
      var sessionUserForLogout = getSessionUser(data.sessionToken);
      if (sessionUserForLogout) {
        logAudit(sessionUserForLogout, 'Logout', '');
        CacheService.getScriptCache().remove('sess_' + data.sessionToken);
      }
      return jsonOut({ status: 'success' });
    }

    // ---- Log error render client-side (ErrorBoundary di app.js). Sengaja
    // TIDAK butuh sesi valid (biar laporan tetap masuk walau render gagal PAS
    // sesi baru habis) dan TIDAK ikut LockService (sheet terpisah, independen
    // dari data operasional, tidak perlu antre di belakang aksi tulis lain).
    // Kegagalan di sini tidak boleh sampai bikin klien dapat error baru lagi
    // — makanya dibungkus try/catch sendiri dan selalu balas 'success'. ----
    if (action === 'logClientError') {
      try {
        var errSheet = getOrCreateSheet(ss, 'Error_Log', ['Timestamp', 'Nama', 'ID', 'Pesan', 'Detail', 'Halaman']);
        var errUser = getSessionUser(data.sessionToken);
        errSheet.appendRow([
          new Date(),
          errUser ? errUser.name : '(sesi tidak valid)',
          errUser ? errUser.id : '',
          String(data.message || '').slice(0, 500),
          String(data.detail || '').slice(0, 2000),
          String(data.page || '')
        ]);
      } catch (logError) {
        // diamkan — lihat catatan di atas
      }
      return jsonOut({ status: 'success' });
    }

    // ---- Semua aksi di bawah ini WAJIB sesi valid ----
    var sessionUser = getSessionUser(data.sessionToken);
    if (!sessionUser) {
      return jsonOut({ status: 'error', message: 'Sesi berakhir, silakan login ulang.' });
    }

    // ---- Rate-limit PER SESI untuk semua aksi tulis (baris 132 ke bawah,
    // semuanya action tulis — action baca ada di doGet, tidak lewat sini
    // sama sekali) — lihat checkWriteRateLimit() di Utils.gs untuk kebijakan
    // lengkapnya. Dicek di SATU titik ini (bukan diulang di tiap handler)
    // karena semua aksi tulis sudah lewat gerbang sesi-valid yang sama ini
    // sebelum masuk ke handler manapun — menaruhnya di sini menjamin aksi
    // tulis BARU yang ditambahkan nanti otomatis ikut terbatasi juga, tanpa
    // risiko lupa menambahkan pengecekan di satu handler baru. ----
    if (!checkWriteRateLimit(data.sessionToken)) {
      return jsonOut({ status: 'error', message: 'Terlalu banyak aksi. Coba lagi dalam 1 menit.' });
    }

    // ---- Kunci SEMUA aksi tulis di bawah titik ini (satu lock untuk
    // seluruh doPost, bukan per-aksi) — banyak aksi di bawah pakai pola
    // baca-cek-lalu-tulis (record, addTeacher, setJadwalPiket, dst.) yang
    // rawan race condition kalau 2 permintaan diproses bersamaan, paling
    // rawan pas jam gerbang pagi saat banyak guru piket menulis nyaris
    // serentak. Dilepas otomatis lewat finally di bawah apa pun hasilnya. ----
    var sigapLock = LockService.getScriptLock();
    try {
      sigapLock.waitLock(10000);
    } catch (lockError) {
      return jsonOut({ status: 'error', message: 'Server sedang sibuk, coba lagi sebentar.' });
    }
    try {

    // ---- Catat keterlambatan (bukan untuk OSIS) ----
    if (action === 'record') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = ss.getSheetByName('Log_Gerbang');
      // Cek "sudah tercatat hari ini?" CUKUP melihat baris hari ini saja.
      // Sebelumnya ini getDataRange().getValues() — menarik SELURUH isi
      // Log_Gerbang (seluruh tahun ajaran) hanya untuk mencocokkan satu NISN,
      // dan itu terjadi SAMBIL MEMEGANG script lock global. Jam gerbang pagi
      // saat banyak guru piket menyimpan hampir serentak, setiap simpan
      // mengantre di belakang pemindaian sheet penuh milik guru sebelumnya —
      // makin banyak data, makin lambat, tanpa batas. getRowsSince()
      // binary-search ke baris pertama hari ini, jadi biayanya tetap segitu
      // saja berapa pun panjang riwayatnya.
      var today = new Date();
      var todayStartLog = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
      var rows = getRowsSince(sheet, todayStartLog, 6);
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][1]) === String(data.nisn) && isSameDayServer(new Date(rows[i][0]), today)) {
          return jsonOut({ status: 'error', message: data.name + ' sudah tercatat terlambat hari ini.' });
        }
      }
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.type, sessionUser.name]);
      CacheService.getScriptCache().remove('today_logs');
      CacheService.getScriptCache().remove('today_data');
      // Notifikasi Wali Kelas — kelas diambil ULANG dari Master_Siswa (BUKAN
      // data.class_name dari klien di atas, yang tidak diverifikasi untuk
      // aksi ini) lewat resolveSiswaForIzin, satu-satunya sumber kebenaran
      // NISN->kelas yang sudah ada. Siswa yang tidak ketemu di Master_Siswa
      // (data.class_name kosong/typo) berarti tidak ada wali kelas yang bisa
      // ditentukan dengan pasti — TIDAK dinotifikasi, bukan menebak dari klien.
      var recordSiswa = resolveSiswaForIzin(ss, data.nisn);
      if (recordSiswa) {
        notifyRelevantUsers({ jenis: 'keterlambatan', nisn: recordSiswa.nisn, kelas: recordSiswa.class, needsPiketAction: false });
      }
      return jsonOut({ status: 'success' });
    }

    // ---- Tambah guru baru (admin only) ----
    if (action === 'addTeacher') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa menambah guru' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.newId)) {
          return jsonOut({ status: 'error', message: 'ID sudah dipakai, gunakan ID lain' });
        }
      }
      var newSalt = generateSalt();
      var hashed = hashPasswordSalted(data.newPassword, newSalt);
      // Kolom F (status) & G (Kelas_Wali) sengaja dikosongkan di sini (diisi
      // lewat aksi toggleStatus/updateWaliKelas terpisah) — harus tetap
      // ditulis eksplisit supaya salt di kolom H (index 8) jatuh di kolom
      // yang benar, appendRow tidak bisa "lompat" kolom.
      sheet.appendRow([data.newId, data.newName, hashed, data.newRole, data.newJabatan || '', '', '', newSalt]);
      // Daftar nama di layar login ikut berubah — buang cache-nya supaya guru
      // baru langsung ketemu saat mencari namanya, tidak nunggu TTL 5 menit.
      CacheService.getScriptCache().remove('login_users');
      logAudit(sessionUser, 'Tambah Guru', data.newName + ' (' + data.newId + ', role: ' + data.newRole + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Reset password (admin only) ----
    if (action === 'updatePassword') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah password' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var targetName = '';
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          var resetSalt = generateSalt();
          sheet.getRange(i + 1, 3).setValue(hashPasswordSalted(data.newPassword, resetSalt));
          sheet.getRange(i + 1, 8).setValue(resetSalt);
          targetName = rows[i][1];
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      logAudit(sessionUser, 'Reset Password', targetName + ' (' + data.targetId + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Ganti password sendiri (semua role yang sudah login, termasuk
    // guru/BK/OSIS) — beda dari 'updatePassword' di atas yang admin-only dan
    // menimpa password ORANG LAIN tanpa perlu tahu password lamanya.
    // Fitur ini sebelumnya belum ada sama sekali: guru biasa yang mau ganti
    // password sendiri harus minta admin reset lewat Kelola > Guru & Akun.
    if (action === 'changeMyPassword') {
      var cmpSheet = ss.getSheetByName('Master_Guru');
      var cmpRows = cmpSheet.getDataRange().getValues();
      var cmpRowIndex = -1;
      for (var cmpI = 1; cmpI < cmpRows.length; cmpI++) {
        if (String(cmpRows[cmpI][0]) === String(sessionUser.id)) { cmpRowIndex = cmpI; break; }
      }
      if (cmpRowIndex === -1) {
        return jsonOut({ status: 'error', message: 'Akun tidak ditemukan.' });
      }
      // Kolom H (index 7) = Salt, sama seperti pengecekan login di atas.
      var cmpCheck = verifyPassword(data.oldPassword, String(cmpRows[cmpRowIndex][2]), String(cmpRows[cmpRowIndex][7] || ''));
      if (!cmpCheck || !cmpCheck.matched) {
        return jsonOut({ status: 'error', message: 'Password lama salah.' });
      }
      if (!data.newPassword || String(data.newPassword).trim().length < 6) {
        return jsonOut({ status: 'error', message: 'Password baru minimal 6 karakter.' });
      }
      var cmpSalt = generateSalt();
      cmpSheet.getRange(cmpRowIndex + 1, 3).setValue(hashPasswordSalted(data.newPassword, cmpSalt));
      cmpSheet.getRange(cmpRowIndex + 1, 8).setValue(cmpSalt);
      logAudit(sessionUser, 'Ganti Password Sendiri', '');
      return jsonOut({ status: 'success' });
    }

    // ---- Ubah jabatan tampilan (admin only) — misal jadikan akun BK/Kesiswaan
    // tampil sebagai "Kepala Sekolah" tanpa mengubah hak aksesnya ----
    if (action === 'updateJabatan') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah jabatan' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          sheet.getRange(i + 1, 5).setValue(data.newJabatan || '');
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      logAudit(sessionUser, 'Ubah Jabatan', data.targetId + ' -> "' + (data.newJabatan || '(kosong)') + '"');
      return jsonOut({ status: 'success' });
    }

    // ---- Ubah role seorang guru (admin only) — kolom D di Master_Guru.
    // Ini yang dipakai kalau guru biasa juga merangkap BK/Kesiswaan, atau
    // sebaliknya. Tidak menyentuh Jabatan/Kelas Wali, itu field terpisah. ----
    if (action === 'updateRole') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah role' });
      }
      var validRoles = ['guru', 'bk_kesiswaan', 'osis', 'admin'];
      if (validRoles.indexOf(data.newRole) === -1) {
        return jsonOut({ status: 'error', message: 'Role tidak dikenali: ' + data.newRole });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var targetName = '';
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          sheet.getRange(i + 1, 4).setValue(data.newRole);
          targetName = rows[i][1];
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      logAudit(sessionUser, 'Ubah Role', targetName + ' (' + data.targetId + ') -> ' + data.newRole);
      return jsonOut({ status: 'success' });
    }

    // ---- Ubah/atur Kelas Wali seorang guru (admin only) — kolom G di
    // Master_Guru. Kirim newKelasWali kosong ('') untuk melepas status wali
    // kelas guru itu. Dipakai untuk Dashboard kontekstual & Rekap Kelas
    // (Blueprint SIGAP v2, section V & VI). ----
    if (action === 'updateWaliKelas') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah kelas wali' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var targetName = '';
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          sheet.getRange(i + 1, 7).setValue(data.newKelasWali || '');
          targetName = rows[i][1];
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      CacheService.getScriptCache().remove('wali_kelas_map');
      logAudit(sessionUser, 'Ubah Kelas Wali', targetName + ' (' + data.targetId + ') -> "' + (data.newKelasWali || '(kosong)') + '"');
      return jsonOut({ status: 'success' });
    }

    // ---- Perbaiki nama guru yang salah ketik (admin only) — kolom B di
    // Master_Guru. Tidak menyentuh ID/password/role/dsb, murni ganti label
    // nama. Guru berstatus nonaktif sekalipun tetap bisa diperbaiki namanya. ----
    if (action === 'updateTeacherName') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah nama guru' });
      }
      var newName = String(data.newName || '').trim();
      if (!newName) {
        return jsonOut({ status: 'error', message: 'Nama tidak boleh kosong' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var oldName = '';
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          oldName = rows[i][1];
          sheet.getRange(i + 1, 2).setValue(newName);
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      // Nama dipakai di layar login & di getWaliKelasMap (Dashboard/Rekap
      // Kelas kalau guru ini wali kelas) — buang keduanya biar langsung sinkron.
      CacheService.getScriptCache().remove('login_users');
      CacheService.getScriptCache().remove('wali_kelas_map');
      logAudit(sessionUser, 'Ubah Nama Guru', oldName + ' -> ' + newName + ' (' + data.targetId + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Hapus akun guru permanen (admin only). Beda dari toggleTeacherStatus
    // (nonaktifkan): ini benar-benar membuang barisnya dari Master_Guru — untuk
    // entri yang salah ketik/duplikat dan belum punya riwayat berarti. Catatan
    // lama (Log_Gerbang, Pelanggaran, dst.) menyimpan nama sebagai teks bebas
    // saat kejadian dicatat, jadi TIDAK ikut rusak/hilang kalau baris gurunya
    // dihapus belakangan. Yang sengaja DIBLOKIR: menghapus diri sendiri, dan
    // menghapus guru yang masih berstatus wali kelas aktif (kelas itu akan
    // diam-diam kehilangan wali kelas di getWaliKelasMap tanpa peringatan kalau
    // dibiarkan) — admin harus lepas status wali kelasnya dulu lewat tombol
    // "Wali Kelas" yang sudah ada. Jadwal Piket SENGAJA tidak diblokir: baris
    // yang jadi yatim di sana sudah ditangani rapi oleh getJadwalPiket
    // ('(guru tidak ditemukan)'), dan admin bisa hapus slot itu dari panel
    // Jadwal Piket yang sama. ----
    if (action === 'deleteTeacher') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa menghapus akun guru' });
      }
      if (String(data.targetId) === String(sessionUser.id)) {
        return jsonOut({ status: 'error', message: 'Tidak bisa menghapus akun sendiri.' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var targetName = '';
      var targetRow = -1;
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          targetName = rows[i][1];
          if (rows[i][6]) {
            return jsonOut({ status: 'error', message: 'Guru ini masih tercatat sebagai wali kelas ' + rows[i][6] + '. Lepas status wali kelasnya dulu lewat tombol "Wali Kelas" sebelum menghapus.' });
          }
          targetRow = i + 1;
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      sheet.deleteRow(targetRow);
      CacheService.getScriptCache().remove('login_users');
      logAudit(sessionUser, 'Hapus Guru', targetName + ' (' + data.targetId + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Ajukan "sudah ditindaklanjuti" untuk siswa yang sering terlambat
    // (banner Perlu Perhatian di Dashboard) — admin/BK, atau wali kelas untuk
    // kelasnya sendiri. Status awal 'menunggu': BELUM langsung hilang dari
    // banner, harus disetujui admin dulu (lihat action approveTindakLanjut)
    // supaya tidak bisa ditutup sepihak tanpa sepengetahuan admin. ----
    if (action === 'ajukanTindakLanjut') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      if (!isBkRole(sessionUser.role) && !(sessionUser.waliKelas && sameClass(data.class_name, sessionUser.waliKelas))) {
        return jsonOut({ status: 'error', message: 'Hanya admin/BK atau wali kelas terkait yang bisa mengajukan tindak lanjut.' });
      }
      var sheet = getOrCreateSheet(ss, 'Tindak_Lanjut', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Catatan', 'Diajukan_Oleh', 'Status', 'Disetujui_Oleh', 'Tanggal_Disetujui']);
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.catatan || '', sessionUser.name, 'menunggu', '', '']);
      CacheService.getScriptCache().remove('tindak_lanjut_list_raw');
      logAudit(sessionUser, 'Ajukan Tindak Lanjut', data.name + ' (' + data.nisn + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Setujui tindak lanjut (admin only) — begitu disetujui, siswa itu
    // hilang dari banner "Perlu Perhatian" karena hitungan 3x/minggu & 5x/bulan
    // dihitung ulang dari Tanggal_Disetujui (lihat buildResolvedMap di
    // helpers.js), BUKAN dihapus permanen — kalau kejadian baru muncul lagi
    // setelah tanggal ini, banner akan tampil lagi secara wajar. ----
    if (action === 'approveTindakLanjut') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa menyetujui tindak lanjut.' });
      }
      var sheet = ss.getSheetByName('Tindak_Lanjut');
      var found = findRowByNisnTimestamp(sheet, data.nisn, data.timestamp);
      if (!found) {
        return jsonOut({ status: 'error', message: 'Data tindak lanjut tidak ditemukan.' });
      }
      var approvedAt = new Date();
      sheet.getRange(found.rowIndex, 7).setValue('selesai');
      sheet.getRange(found.rowIndex, 8).setValue(sessionUser.name);
      sheet.getRange(found.rowIndex, 9).setValue(approvedAt);
      CacheService.getScriptCache().remove('tindak_lanjut_list_raw');
      logAudit(sessionUser, 'Setujui Tindak Lanjut', data.nisn);
      return jsonOut({ status: 'success' });
    }

    // ---- Nonaktifkan / aktifkan akun guru (admin only) ----
    if (action === 'toggleTeacherStatus') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah status akun' });
      }
      if (String(data.targetId) === String(sessionUser.id)) {
        return jsonOut({ status: 'error', message: 'Tidak bisa menonaktifkan akun sendiri.' });
      }
      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();
      var found = false;
      var targetName = '';
      var newStatus = '';
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.targetId)) {
          var currentStatus = String(rows[i][5]).toLowerCase().trim();
          newStatus = currentStatus === 'nonaktif' ? 'aktif' : 'nonaktif';
          sheet.getRange(i + 1, 6).setValue(newStatus);
          targetName = rows[i][1];
          found = true;
          break;
        }
      }
      if (!found) {
        return jsonOut({ status: 'error', message: 'ID tidak ditemukan' });
      }
      // Guru nonaktif tidak muncul di daftar nama layar login — buang cache.
      CacheService.getScriptCache().remove('login_users');
      logAudit(sessionUser, newStatus === 'nonaktif' ? 'Nonaktifkan Akun' : 'Aktifkan Akun', targetName + ' (' + data.targetId + ')');
      return jsonOut({ status: 'success', newStatus: newStatus });
    }

    // ---- Atur ulang seluruh Jadwal Piket mingguan sekaligus (admin only).
    // data.schedule = [{ hari: 'Senin', guruId: 'G01' }, ...] — sheet ditulis
    // ulang total (bukan edit baris satu-satu), lebih sederhana dan tidak ada
    // risiko baris nyasar kalau urutan berubah. Pola mingguan tetap (tanpa
    // pengecualian per tanggal) sesuai keputusan Blueprint SIGAP v2. ----
    if (action === 'setJadwalPiket') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa mengubah jadwal piket' });
      }
      var validHari = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      var guruSheet = ss.getSheetByName('Master_Guru');
      var guruRows = guruSheet.getDataRange().getValues();
      var validGuruIds = {};
      for (var i = 1; i < guruRows.length; i++) validGuruIds[String(guruRows[i][0])] = true;

      var schedule = data.schedule || [];
      for (var j = 0; j < schedule.length; j++) {
        if (validHari.indexOf(schedule[j].hari) === -1) {
          return jsonOut({ status: 'error', message: 'Hari tidak valid: ' + schedule[j].hari });
        }
        if (!validGuruIds[String(schedule[j].guruId)]) {
          return jsonOut({ status: 'error', message: 'ID guru tidak ditemukan: ' + schedule[j].guruId });
        }
      }

      var sheet = getOrCreateSheet(ss, 'Jadwal_Piket', ['Hari', 'Guru_ID']);
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
      }
      if (schedule.length > 0) {
        var values = schedule.map(function (s) { return [s.hari, s.guruId]; });
        sheet.getRange(2, 1, values.length, 2).setValues(values);
      }
      CacheService.getScriptCache().remove('jadwal_piket');
      logAudit(sessionUser, 'Ubah Jadwal Piket', schedule.length + ' penugasan disimpan');
      return jsonOut({ status: 'success' });
    }

    // ---- Catat surat masuk (bukan untuk OSIS) ----
    if (action === 'addSurat') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getOrCreateSheet(ss, 'Surat_Masuk', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh']);
      // Sama seperti 'record' di atas: cukup baris hari ini, bukan seluruh
      // Surat_Masuk — pemindaian penuh di sini terjadi sambil memegang script
      // lock global dan ikut memperlambat SEMUA aksi tulis lain.
      var todaySurat = new Date();
      var todayStartSurat = new Date(todaySurat.getFullYear(), todaySurat.getMonth(), todaySurat.getDate(), 0, 0, 0, 0);
      var existingRows = getRowsSince(sheet, todayStartSurat, 8);
      for (var i = 0; i < existingRows.length; i++) {
        if (String(existingRows[i][1]) === String(data.nisn) && isSameDayServer(new Date(existingRows[i][0]), todaySurat)) {
          return jsonOut({ status: 'error', message: data.name + ' sudah punya catatan surat hari ini.' });
        }
      }
      // Surat cuma laporan tertulis (jenis + keterangan) — TIDAK ada lampiran
      // foto lagi (fitur upload foto dihapus, lihat catatan di Utils.gs).
      // Kolom Foto_URL (index 6) TETAP ditulis kosong, BUKAN dihapus dari
      // struktur baris — posisi kolom di sheet ini signifikan (dibaca by
      // index di getSurat/getTodayData), menghapusnya akan menggeser
      // Dicatat_Oleh ke posisi Foto_URL dan mematahkan baris-baris lama
      // yang sudah terlanjur punya URL foto tersimpan.
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.jenis, data.keterangan || '', '', sessionUser.name]);
      CacheService.getScriptCache().remove('surat_list');
      CacheService.getScriptCache().remove('today_data');
      var suratSiswa = resolveSiswaForIzin(ss, data.nisn);
      if (suratSiswa) {
        notifyRelevantUsers({ jenis: 'surat', nisn: suratSiswa.nisn, kelas: suratSiswa.class, needsPiketAction: false });
      }
      return jsonOut({ status: 'success' });
    }

    // ---- Hapus Data (Pemeliharaan Data, admin only) — menggantikan aksi
    // lama 'deleteSurat' ("Hapus Data Surat per Bulan/Tahun": satu sheet,
    // satu bulan/tahun, langsung eksekusi tanpa pratinjau). Sekarang: Tanggal
    // Mulai - Tanggal Selesai bebas, beberapa jenis data sekaligus, dan WAJIB
    // sudah lewat pratinjau di klien (action 'previewHapusData' di doGet)
    // sebelum tombol hapus aktif — lihat HAPUS_DATA_JENIS di Utils.gs untuk
    // jenis data mana saja yang disertakan & kenapa.
    //
    // Urutan WAJIB (semangatnya sama dengan exportData): sesi valid & rate
    // limit tulis (sudah dicek sebelum blok lock ini) -> lock (sudah dipegang
    // di titik ini) -> OTORISASI -> VALIDASI PERIODE -> VALIDASI JENIS ->
    // KONFIRMASI EKSPLISIT -> baru hitung ulang & hapus. Jumlah dari
    // pratinjau klien TIDAK PERNAH dipercaya sebagai kebenaran — baris yang
    // benar-benar cocok dihitung ULANG dari sheet sebenarnya, PERSIS sebelum
    // dihapus (countRowsInRange lalu deleteRowsInRange, keduanya di
    // Utils.gs).
    //
    // Race condition pratinjau vs eksekusi: pratinjau (doGet) sengaja tidak
    // memegang sigapLock (murni baca, sama seperti exportData) — kalau ada
    // baris baru masuk di antara pratinjau & eksekusi (mis. guru piket
    // mencatat saat admin masih membaca dialog konfirmasi), eksekusi ini
    // tetap menghitung ULANG & menghapus persis yang cocok SAAT eksekusi
    // berjalan, bukan angka pratinjau — jadi tidak pernah ada data yang
    // "salah hapus" gara-gara angka pratinjau basi; paling hasil akhirnya
    // (dikembalikan di respons ini) berbeda sedikit dari yang sempat
    // ditampilkan sebelum konfirmasi, dan klien menampilkan angka HASIL ini,
    // bukan angka pratinjau. Double-click/double request: seluruh blok ini
    // berjalan DI DALAM sigapLock yang sama dengan semua aksi tulis lain,
    // jadi dua permintaan hapus yang identik diproses berurutan —
    // permintaan kedua otomatis menemukan 0 baris tersisa untuk kriteria
    // yang sama (idempotent), tidak perlu penjaga tambahan.
    if (action === 'hapusDataPeriode') {
      if (!isAdminRole(sessionUser.role)) {
        logAudit(sessionUser, 'Hapus Data Ditolak', 'alasan=unauthorized');
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa menghapus data.' });
      }
      var hapusPeriod = validateExportPeriod(data.start, data.end);
      if (!hapusPeriod.valid) {
        logAudit(sessionUser, 'Hapus Data Ditolak', 'alasan=periode tidak valid | ' + String(data.start || '-') + ' - ' + String(data.end || '-'));
        return jsonOut({ status: 'error', message: hapusPeriod.message });
      }
      var hapusJenisList = normalizeHapusDataJenisList(data.jenis);
      if (!hapusJenisList.length) {
        logAudit(sessionUser, 'Hapus Data Ditolak', 'alasan=jenis tidak dipilih | periode=' + hapusPeriod.label);
        return jsonOut({ status: 'error', message: 'Pilih minimal satu jenis data.' });
      }
      if (!data.confirm) {
        return jsonOut({ status: 'error', message: 'Konfirmasi penghapusan diperlukan.' });
      }

      // Pagar volume DIHITUNG DULU (belum menghapus apa pun dari kategori
      // mana pun) supaya kalau ternyata kegedean, batalnya bersih — bukan
      // berhenti di tengah setelah separuh kategori sudah terlanjur terhapus.
      var hapusCekTotal = 0;
      for (var hc = 0; hc < hapusJenisList.length; hc++) {
        var hcDef = HAPUS_DATA_JENIS[hapusJenisList[hc]];
        hapusCekTotal += countRowsInRange(ss.getSheetByName(hcDef.sheet), hapusPeriod.start, hapusPeriod.end);
      }
      if (hapusCekTotal > HAPUS_DATA_MAX_ROWS) {
        logAudit(sessionUser, 'Hapus Data Gagal', buildHapusDataAuditDetail(hapusJenisList, hapusPeriod.label, {}, hapusCekTotal, 'melebihi batas baris'));
        return jsonOut({ status: 'error', message: 'Data terlalu banyak (' + hapusCekTotal + ' baris, batas ' + HAPUS_DATA_MAX_ROWS + '). Persempit periodenya lalu ulangi bertahap.' });
      }

      var hapusCounts = {};
      var hapusTotal = 0;
      for (var hj = 0; hj < hapusJenisList.length; hj++) {
        var jenisKey = hapusJenisList[hj];
        var hjDef = HAPUS_DATA_JENIS[jenisKey];
        var hjDeleted = deleteRowsInRange(ss.getSheetByName(hjDef.sheet), hapusPeriod.start, hapusPeriod.end);
        hapusCounts[jenisKey] = hjDeleted;
        hapusTotal += hjDeleted;
        if (hjDef.cacheCategory) clearCacheForCategory(hjDef.cacheCategory);
        if (jenisKey === 'izin') clearIzinCache();
      }

      var hapusDetail = buildHapusDataAuditDetail(hapusJenisList, hapusPeriod.label, hapusCounts, hapusTotal, hapusTotal ? 'berhasil' : 'tidak ada data');
      logAudit(sessionUser, hapusTotal ? 'Hapus Data Massal' : 'Hapus Data Massal Kosong', hapusDetail);
      return jsonOut({ status: 'success', periodeLabel: hapusPeriod.label, counts: hapusCounts, total: hapusTotal });
    }

    // ---- Catat pelanggaran & sanksi (bukan untuk OSIS) ----
    if (action === 'addPelanggaran') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getOrCreateSheet(ss, 'Pelanggaran', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh']);
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.jenis_pelanggaran, data.sanksi, data.catatan || '', sessionUser.name]);
      CacheService.getScriptCache().remove('pelanggaran_list_raw');
      CacheService.getScriptCache().remove('today_data');
      var pelanggaranSiswa = resolveSiswaForIzin(ss, data.nisn);
      if (pelanggaranSiswa) {
        notifyRelevantUsers({ jenis: 'pelanggaran', nisn: pelanggaranSiswa.nisn, kelas: pelanggaranSiswa.class, needsPiketAction: false });
      }
      return jsonOut({ status: 'success' });
    }

    // ---- Catat perlu bimbingan khusus (bukan untuk OSIS; hanya admin/BK bisa lihat) ----
    if (action === 'addBimbingan') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getOrCreateSheet(ss, 'Bimbingan_Khusus', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Catatan', 'Dicatat_Oleh']);
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.catatan, sessionUser.name]);
      return jsonOut({ status: 'success' });
    }

    // ---- Catat pelanggaran upacara (OSIS, BK/Kesiswaan, Admin) ----
    if (action === 'addPelanggaranUpacara') {
      if (!(isOsisRole(sessionUser.role) || isBkRole(sessionUser.role))) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses mencatat pelanggaran upacara.' });
      }
      var sheet = getOrCreateSheet(ss, 'Pelanggaran_Upacara', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Catatan', 'Dicatat_Oleh', 'Dicatat_Oleh_ID']);
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.jenis_pelanggaran, data.catatan || '', sessionUser.name, sessionUser.id]);
      CacheService.getScriptCache().remove('pelanggaran_upacara_raw');
      var upacaraSiswa = resolveSiswaForIzin(ss, data.nisn);
      if (upacaraSiswa) {
        notifyRelevantUsers({ jenis: 'pelanggaran_upacara', nisn: upacaraSiswa.nisn, kelas: upacaraSiswa.class, needsPiketAction: false });
      }
      return jsonOut({ status: 'success' });
    }

    // ================= IZIN KELUAR / PULANG (BETA) =================
    // Empat aksi, satu untuk tiap langkah prosedur sekolah. TIDAK ada satu pun
    // aksi yang menerima "status" dari klien — status berikutnya selalu
    // dihitung server dari status sekarang + tujuan yang tersimpan di baris
    // (lihat blok IZIN di Utils.gs). Semuanya berjalan di dalam script lock
    // global doPost, jadi dua permintaan bersamaan tidak bisa lolos berdua.

    // ---- Langkah 1: PERSETUJUAN awal oleh GURU YANG MEMBERIKAN PERSETUJUAN.
    // Ini BUKAN izin keluar yang sah — hasilnya 'Menunggu Verifikasi'. Siswa
    // baru boleh keluar setelah Guru Piket memverifikasi (langkah 2).
    //
    // Yang direkam di sini adalah SIAPA yang memberikan persetujuan (nama + ID
    // dari SESI, bukan klaim dari klien) dan KAPAN — tidak lebih dari itu.
    // SIGAP memang TIDAK menyimpan jadwal mengajar per jam, dan itu keputusan
    // yang disengaja: jadwal aktual di sekolah berubah sewaktu-waktu, sehingga
    // "guru mata pelajaran jam ini" tidak bisa diverifikasi dari data mana pun
    // yang dimiliki sistem ini. Karena itu:
    //   - JANGAN membuat sheet/mapping/endpoint jadwal mengajar untuk fitur ini;
    //   - JANGAN meminta klien mengirim klaim peran ("saya wali kelasnya",
    //     "saya guru mapel jam ini") — klaim yang tidak bisa diperiksa hanya
    //     menciptakan kesan aman yang palsu;
    //   - JANGAN membuat role baru; kewenangan yang dipakai adalah yang sudah
    //     ada di SIGAP (non-OSIS boleh menyetujui, Guru Piket memverifikasi).
    if (action === 'addIzinKeluar') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var izinTujuan = String(data.tujuan || '').trim().toLowerCase();
      if (izinTujuan !== IZIN_TUJUAN_KEMBALI && izinTujuan !== IZIN_TUJUAN_PULANG) {
        return jsonOut({ status: 'error', message: 'Tujuan izin harus dipilih: kembali ke sekolah atau pulang.' });
      }
      var izinKeperluan = izinText(data.keperluan, IZIN_MAX_KEPERLUAN);
      if (!izinKeperluan) {
        return jsonOut({ status: 'error', message: 'Keperluan wajib diisi.' });
      }
      // Nama & kelas TIDAK diambil dari klien — lihat resolveSiswaForIzin.
      var izinSiswa = resolveSiswaForIzin(ss, data.nisn);
      if (!izinSiswa) {
        return jsonOut({ status: 'error', message: 'Siswa tidak ditemukan di data induk (NISN harus terisi).' });
      }

      // ---- Konteks persetujuan: Wali Kelas / Guru Mapel ----
      // Label tampilan/audit saja, DIHITUNG DI SINI dari sessionUser.waliKelas
      // + kelas siswa yang baru saja di-resolve dari Master_Siswa. Field
      // 'konteks' yang mungkin ikut terkirim dari klien SENGAJA TIDAK PERNAH
      // dibaca sama sekali di sini (lihat izinKonteksPersetujuan di Utils.gs).
      // Tidak menggerbangi apa pun: guru non-OSIS mana pun tetap boleh
      // menyetujui siswa kelas mana pun, sama seperti sebelumnya.
      var izinKonteks = izinKonteksPersetujuan(sessionUser, izinSiswa.class);

      // ---- Jalur khusus: hanya untuk yang berwenang memverifikasi (Guru Piket
      // bertugas hari ini / BK / Admin), dan WAJIB beralasan.
      // Jalur ini TIDAK memalsukan persetujuan guru mana pun: kolom
      // Disetujui_Oleh diisi nama petugas piket itu sendiri dan kolom Jalur
      // ditandai 'khusus' + alasannya disimpan, sehingga transaksi ini tidak
      // pernah bisa dibaca sebagai persetujuan normal.
      var izinJalur = String(data.jalur || '').trim().toLowerCase() === IZIN_JALUR_KHUSUS ? IZIN_JALUR_KHUSUS : IZIN_JALUR_NORMAL;
      var izinAlasanKhusus = izinText(data.alasan_khusus, IZIN_MAX_ALASAN);
      var izinNow = new Date();
      if (izinJalur === IZIN_JALUR_KHUSUS) {
        if (!canVerifyIzin(ss, sessionUser, izinNow)) {
          return jsonOut({ status: 'error', message: 'Izin Khusus hanya bisa dibuat Guru Piket yang bertugas hari ini (atau BK/Admin).' });
        }
        if (!izinAlasanKhusus) {
          return jsonOut({ status: 'error', message: 'Alasan pengecualian wajib diisi untuk Izin Khusus.' });
        }
      } else {
        // Alasan pengecualian tidak boleh menempel di transaksi normal —
        // kalau ikut tersimpan, baris normal jadi terbaca seperti pengecualian.
        izinAlasanKhusus = '';
      }

      var izinSheet = getOrCreateSheet(ss, IZIN_SHEET_NAME, IZIN_HEADERS);
      // Penjaga double-submit sekaligus penjaga integritas: satu siswa tidak
      // boleh punya dua transaksi keluar yang masih berjalan.
      var izinTerbuka = findIzinTerbukaForNisn(izinSheet, izinSiswa.nisn);
      if (izinTerbuka) {
        return jsonOut({
          status: 'error',
          message: izinTerbuka.status === IZIN_STATUS_DI_LUAR
            ? izinSiswa.name + ' tercatat masih di luar sekolah — tandai kembali dulu sebelum membuat izin baru.'
            : izinSiswa.name + ' sudah punya izin yang menunggu verifikasi Guru Piket.',
        });
      }

      // Jalur khusus = petugas piket menyetujui DAN memverifikasi sekaligus
      // (itu memang keadaannya: guru yang menangani siswa tidak tersedia), jadi
      // siswa langsung tercatat keluar. Jalur normal berhenti di 'Menunggu
      // Verifikasi' — dua tahap tetap dua tahap.
      var izinStatusAwal = izinJalur === IZIN_JALUR_KHUSUS ? izinStatusSetelahVerifikasi(izinTujuan) : IZIN_STATUS_MENUNGGU;
      var izinId = Utilities.getUuid();
      var izinRow = [
        izinNow, izinSiswa.nisn, izinSiswa.name, izinSiswa.class, izinId, izinKeperluan, izinTujuan, izinStatusAwal, izinJalur, izinAlasanKhusus,
        sessionUser.name, sessionUser.id, izinNow,
        izinJalur === IZIN_JALUR_KHUSUS ? sessionUser.name : '', izinJalur === IZIN_JALUR_KHUSUS ? sessionUser.id : '', izinJalur === IZIN_JALUR_KHUSUS ? izinNow : '',
        izinJalur === IZIN_JALUR_KHUSUS ? izinNow : '', '', '', '',
      ];
      izinSheet.appendRow(izinRow);
      clearIzinCache();
      // Konteks (Wali Kelas/Guru Mapel) cuma masuk detail audit untuk jalur
      // NORMAL. Jalur khusus sudah punya penandanya sendiri (jalur=khusus) —
      // menambahkan "konteks=Guru Mapel" di sana cuma membingungkan, karena
      // Izin Khusus justru berarti wali kelas/guru mapel TIDAK tersedia.
      // 'id=<ID_Izin>' ditambahkan di Detail (audit September 2026) supaya
      // getKonteksApprovalFromAuditLog (Utils.gs, dipakai fitur Cetak Surat
      // Izin) bisa mencocokkan baris ini PERSIS lewat ID, bukan hanya
      // menerka lewat nama+NISN+kedekatan waktu. Tidak mengubah format lama
      // apa pun yang sudah dibaca di tempat lain — cuma menambah satu bidang
      // baru di ekor Detail.
      logAudit(sessionUser,
        izinJalur === IZIN_JALUR_KHUSUS ? 'Izin Keluar Khusus' : 'Persetujuan Izin Keluar',
        buildIzinAuditDetail(izinRowToObject(izinRow), (izinJalur === IZIN_JALUR_KHUSUS
          ? 'alasan pengecualian=' + izinAlasanKhusus
          : 'keperluan=' + izinKeperluan + ' | konteks=' + izinKonteksLabel(izinKonteks)) + ' | id=' + izinId));
      // Jalur normal berhenti di 'Menunggu Verifikasi' -> Guru Piket
      // BENAR-BENAR punya tindakan menunggu, jadi ikut dinotifikasi. Jalur
      // khusus sudah tercatat keluar sekaligus (piket yang membuatnya sendiri
      // sudah tahu), jadi tidak perlu menotifikasi piket lagi untuk baris
      // yang sama.
      notifyRelevantUsers({
        jenis: izinJalur === IZIN_JALUR_KHUSUS ? 'izin_diverifikasi' : 'izin_dibuat',
        nisn: izinSiswa.nisn, kelas: izinSiswa.class, refId: izinId,
        needsPiketAction: izinJalur !== IZIN_JALUR_KHUSUS,
      });
      return jsonOut({ status: 'success', id: izinId, izinStatus: izinStatusAwal, konteks: izinKonteks });
    }

    // ---- Langkah 2: VERIFIKASI Guru Piket. Ini titik di mana siswa dianggap
    // benar-benar keluar (Waktu_Keluar diisi di sini, bukan saat disetujui). ----
    if (action === 'verifikasiIzinKeluar') {
      var verNow = new Date();
      // Kapasitas (bukan cuma boolean) dihitung SEKALI di sini dan dipakai
      // baik untuk gerbang otorisasi maupun jejak Audit Log — supaya
      // "Guru Piket" vs "BK/Kesiswaan (pengambilalihan)" tidak pernah bisa
      // berselisih antara keduanya. Server TIDAK PERNAH membaca kapasitas
      // dari klien (data.kapasitas, kalaupun dikirim, diabaikan total).
      var verKapasitas = izinKapasitasVerifikasi(ss, sessionUser, verNow);
      if (!verKapasitas) {
        return jsonOut({ status: 'error', message: 'Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa memverifikasi.' });
      }
      var verSheet = ss.getSheetByName(IZIN_SHEET_NAME);
      var verFound = verSheet ? findIzinRowById(verSheet, data.id) : null;
      if (!verFound) {
        return jsonOut({ status: 'error', message: 'Data izin tidak ditemukan (mungkin sudah diproses pengguna lain).' });
      }
      if (verFound.data.status !== IZIN_STATUS_MENUNGGU) {
        return jsonOut({ status: 'error', message: izinTolakTransisi(verFound.data.status, 'verifikasi') });
      }
      var verValues = verFound.values.slice();
      verValues[7] = izinStatusSetelahVerifikasi(verFound.data.tujuan);
      verValues[13] = sessionUser.name;
      verValues[14] = sessionUser.id;
      verValues[15] = verNow;
      verValues[16] = verNow; // Waktu_Keluar
      verSheet.getRange(verFound.rowIndex, 1, 1, IZIN_NUM_COLS).setValues([verValues]);
      clearIzinCache();
      logAudit(sessionUser, 'Verifikasi Izin Keluar', buildIzinAuditDetail(verFound.data, 'status=' + verValues[7] + ' | kapasitas=' + izinKapasitasLabel(verKapasitas)));
      notifyRelevantUsers({ jenis: 'izin_diverifikasi', nisn: verFound.data.nisn, kelas: verFound.data.class, refId: verFound.data.id, needsPiketAction: false });
      return jsonOut({ status: 'success', izinStatus: verValues[7] });
    }

    // ---- Langkah 3 (hanya untuk tujuan "kembali"): siswa kembali ke sekolah.
    // Yang menandai TIDAK harus orang yang memberi izin — cukup petugas yang
    // sedang berwenang saat itu, sehingga pergantian guru piket di hari yang
    // sama tidak menghalangi.
    //
    // Status hasilnya langsung IZIN_STATUS_SELESAI, BUKAN singgah dulu di
    // 'Kembali' menunggu aksi kedua. Keputusan produk (audit UX "Tutup
    // transaksi"): satu tap ini SUDAH administrasi lengkap — Waktu_Kembali +
    // siapa yang mencatat tetap terisi di baris yang sama, jadi tidak ada
    // informasi yang hilang, cuma tidak ada lagi klik kedua yang menunggu
    // guru piket. 'Selesai' di sini TIDAK ambigu dengan hasil 'Pulang': jalur
    // pulang sudah final di statusnya sendiri (lihat 'tandaiPulangIzinKeluar'
    // & verifikasi tujuan pulang), dan kolom Tujuan tetap membedakan
    // "kembali ke sekolah" vs "pulang" di baris yang sama-sama 'Selesai'. ----
    if (action === 'tandaiKembaliIzinKeluar') {
      var kbNow = new Date();
      var kbKapasitas = izinKapasitasVerifikasi(ss, sessionUser, kbNow);
      if (!kbKapasitas) {
        return jsonOut({ status: 'error', message: 'Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa kembali.' });
      }
      var kbSheet = ss.getSheetByName(IZIN_SHEET_NAME);
      var kbFound = kbSheet ? findIzinRowById(kbSheet, data.id) : null;
      if (!kbFound) {
        return jsonOut({ status: 'error', message: 'Data izin tidak ditemukan (mungkin sudah diproses pengguna lain).' });
      }
      // Siswa 'Pulang' & siswa yang sudah 'Selesai' ditolak di sini — bukan
      // sekadar tombolnya disembunyikan di layar.
      if (kbFound.data.status !== IZIN_STATUS_DI_LUAR) {
        return jsonOut({ status: 'error', message: izinTolakTransisi(kbFound.data.status, 'kembali') });
      }
      var kbValues = kbFound.values.slice();
      kbValues[7] = IZIN_STATUS_SELESAI;
      kbValues[17] = kbNow;
      kbValues[18] = sessionUser.name;
      kbValues[19] = sessionUser.id;
      kbSheet.getRange(kbFound.rowIndex, 1, 1, IZIN_NUM_COLS).setValues([kbValues]);
      clearIzinCache();
      logAudit(sessionUser, 'Tandai Kembali Izin Keluar', buildIzinAuditDetail(kbFound.data, 'status=' + IZIN_STATUS_SELESAI + ' | kapasitas=' + izinKapasitasLabel(kbKapasitas)));
      notifyRelevantUsers({ jenis: 'izin_kembali', nisn: kbFound.data.nisn, kelas: kbFound.data.class, refId: kbFound.data.id, needsPiketAction: false });
      return jsonOut({ status: 'success', izinStatus: IZIN_STATUS_SELESAI });
    }

    // ---- Langkah 3b: siswa yang TERNYATA tidak kembali (pulang dari kegiatan).
    // Ini SATU-SATUNYA transisi yang ditambahkan ke mesin status individual saat
    // Izin Kelompok masuk, dan memang dibutuhkan: seorang peserta rombongan bisa
    // saja langsung pulang seusai kegiatan padahal izinnya dibuat dengan tujuan
    // kembali. Tanpa transisi ini, barisnya akan menggantung 'Sedang di Luar'
    // selamanya. Aturan lama TIDAK dilonggarkan: hanya boleh dari 'Sedang di
    // Luar' (jadi tetap butuh verifikasi lebih dulu), dan begitu jadi 'Pulang'
    // siswa itu tidak bisa ditandai kembali — persis penjaga yang sudah ada.
    // Berlaku juga untuk izin individual, karena kasusnya sama saja di lapangan.
    if (action === 'tandaiPulangIzinKeluar') {
      var plgNow = new Date();
      var plgKapasitas = izinKapasitasVerifikasi(ss, sessionUser, plgNow);
      if (!plgKapasitas) {
        return jsonOut({ status: 'error', message: 'Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa pulang.' });
      }
      var plgSheet = ss.getSheetByName(IZIN_SHEET_NAME);
      var plgFound = plgSheet ? findIzinRowById(plgSheet, data.id) : null;
      if (!plgFound) {
        return jsonOut({ status: 'error', message: 'Data izin tidak ditemukan (mungkin sudah diproses pengguna lain).' });
      }
      if (plgFound.data.status !== IZIN_STATUS_DI_LUAR) {
        return jsonOut({ status: 'error', message: izinTolakTransisi(plgFound.data.status, 'pulang') });
      }
      var plgValues = plgFound.values.slice();
      plgValues[7] = IZIN_STATUS_PULANG;
      plgSheet.getRange(plgFound.rowIndex, 1, 1, IZIN_NUM_COLS).setValues([plgValues]);
      clearIzinCache();
      logAudit(sessionUser, 'Tandai Pulang Izin Keluar', buildIzinAuditDetail(plgFound.data, 'status=' + IZIN_STATUS_PULANG + ' (tidak kembali ke sekolah) | kapasitas=' + izinKapasitasLabel(plgKapasitas)));
      notifyRelevantUsers({ jenis: 'izin_pulang', nisn: plgFound.data.nisn, kelas: plgFound.data.class, refId: plgFound.data.id, needsPiketAction: false });
      return jsonOut({ status: 'success', izinStatus: IZIN_STATUS_PULANG });
    }

    // ---- Cetak Surat Izin Keluar (audit September 2026) — MURNI OUTPUT
    // dari transaksi yang sudah diverifikasi, tidak mengubah status/transisi
    // apa pun di atas. Boleh dipanggil berkali-kali (cetak/unduh ulang kapan
    // saja, tidak ada batas waktu): Nomor_Surat sekali ditetapkan lalu
    // dipakai ulang terus (tidak pernah berubah untuk transaksi yang sama),
    // Waktu_Print/Status_Print diperbarui SETIAP kali dipanggil (mencerminkan
    // cetak/unduh TERAKHIR, bukan cuma yang pertama). ----
    if (action === 'generateIzinKeluarSurat') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var suratIzinId = String(data.izinId || '').trim();
      if (!suratIzinId) {
        return jsonOut({ status: 'error', message: 'ID izin wajib diisi.' });
      }
      try {
        // sessionUser diteruskan ke generateIzinKeluarSuratData supaya ia
        // bisa menegakkan cakupan baca per-transaksi (scopeIzinForUser) —
        // lihat catatan di fungsi itu (Code.gs) untuk bug yang diperbaiki.
        var suratData = generateIzinKeluarSuratData(ss, suratIzinId, sessionUser);

        // "Reservasi" nomor surat dengan LANGSUNG MENULISKANNYA ke sheet —
        // ini yang menjaga dua permintaan cetak PERTAMA yang hampir
        // bersamaan di hari yang sama tidak pernah mendapat nomor kembar
        // (lihat generateNomorSurat, Utils.gs). Seluruh aksi ini (termasuk
        // renderIzinKeluarSuratHTML di bawah) murni baca/tulis Sheet + susun
        // teks — sejak QR (satu-satunya bagian yang pernah memanggil
        // jaringan luar) dihapus, tidak ada lagi alasan untuk melepas
        // sigapLock lebih awal seperti sebelumnya; aksi ini sekarang
        // konsisten dengan aksi izin lain, tetap di dalam lock sampai akhir.
        var suratSheet = ss.getSheetByName(IZIN_SHEET_NAME);
        var suratFound = findIzinRowById(suratSheet, suratIzinId);
        if (!suratFound) {
          return jsonOut({ status: 'error', message: 'Data izin tidak ditemukan (mungkin sudah dihapus).' });
        }
        var suratNow = new Date();
        var suratValues = suratFound.values.slice();
        suratValues[IZIN_COL_NOMOR_SURAT - 1] = suratData.nomor_surat;
        suratValues[IZIN_COL_WAKTU_PRINT - 1] = suratNow;
        suratValues[IZIN_COL_STATUS_PRINT - 1] = IZIN_PRINT_SUDAH;
        suratSheet.getRange(suratFound.rowIndex, 1, 1, IZIN_NUM_COLS).setValues([suratValues]);
        clearIzinCache();

        var suratHtml = renderIzinKeluarSuratHTML(suratData);

        logAudit(sessionUser, 'generateIzinKeluarSurat',
          buildIzinAuditDetail(suratFound.data, 'nomor=' + suratData.nomor_surat + ' | status_saat_cetak=' + suratData.status_izin));

        return jsonOut({
          status: 'success',
          data: { htmlContent: suratHtml, suratData: suratData, nomorSurat: suratData.nomor_surat },
        });
      } catch (suratError) {
        logAudit(sessionUser, 'generateIzinKeluarSurat Gagal',
          'izinId=' + suratIzinId + ' | error=' + String((suratError && suratError.message) || suratError));
        return jsonOut({ status: 'error', message: String((suratError && suratError.message) || suratError) });
      }
    }

    // ---- 'selesaikanIzinKeluar' (penutupan administratif terpisah dari
    // "Tandai Kembali") DIHAPUS oleh audit UX Agustus 2026: dulu dua tahap
    // (Kembali -> "Tutup transaksi" -> Selesai) untuk hasil yang sama-sama
    // "siswa sudah balik" ternyata tidak menambah nilai integritas apa pun —
    // 'Kembali' sudah TIDAK terhitung transaksi terbuka (IZIN_STATUS_TERBUKA
    // = [Menunggu Verifikasi, Sedang di Luar] saja) sejak awal, jadi klik
    // kedua itu murni kosmetik (ganti label) sekaligus beban tambahan buat
    // Guru Piket. 'tandaiKembaliIzinKeluar' & 'tandaiKembaliKelompok' di atas
    // sekarang menulis IZIN_STATUS_SELESAI langsung. JANGAN menambahkan lagi
    // aksi "tutup/selesaikan" terpisah untuk maksud yang sama. ----

    // ================= IZIN KELOMPOK (satu kegiatan, banyak peserta) =================
    // Tiga aksi, semuanya BEKERJA DI ATAS baris Izin_Keluar yang sama dengan izin
    // individual — bukan mesin status kedua. Kegiatan cuma menambahkan konteks
    // (baris induk di Izin_Kelompok) dan memungkinkan satu tindakan petugas
    // mengenai banyak peserta sekaligus; tiap peserta tetap divalidasi satu per
    // satu dengan aturan yang persis sama. Lihat blok IZIN KELOMPOK di Utils.gs.

    // ---- Ajukan satu kegiatan + pesertanya sekaligus.
    // SEMUA validasi dituntaskan SEBELUM satu baris pun ditulis: kalau ada satu
    // peserta saja yang bermasalah (tidak ada di Master_Siswa, atau masih punya
    // transaksi berjalan), seluruh pengajuan ditolak. Kelompok yang tersimpan
    // separuh jauh lebih berbahaya daripada pengajuan yang gagal — separuhnya
    // akan terlihat sah padahal petugas mengira semuanya batal. ----
    if (action === 'addIzinKelompok') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var kelKegiatan = izinText(data.kegiatan, IZIN_MAX_KEGIATAN);
      if (!kelKegiatan) {
        return jsonOut({ status: 'error', message: 'Nama kegiatan wajib diisi.' });
      }
      var kelTujuan = String(data.tujuan || '').trim().toLowerCase();
      if (kelTujuan !== IZIN_TUJUAN_KEMBALI && kelTujuan !== IZIN_TUJUAN_PULANG) {
        return jsonOut({ status: 'error', message: 'Tujuan izin harus dipilih: kembali ke sekolah atau pulang.' });
      }
      var kelKeperluan = izinText(data.keperluan, IZIN_MAX_KEPERLUAN);
      if (!kelKeperluan) {
        return jsonOut({ status: 'error', message: 'Keperluan wajib diisi.' });
      }
      // Pola kembali hanya punya arti kalau memang ada yang kembali.
      var kelPola = '';
      if (kelTujuan === IZIN_TUJUAN_KEMBALI) {
        kelPola = String(data.pola_kembali || '').trim().toLowerCase() === IZIN_POLA_INDIVIDUAL ? IZIN_POLA_INDIVIDUAL : IZIN_POLA_BERSAMA;
      }

      // Daftar peserta dari klien: yang dipakai HANYA NISN-nya, duplikat dibuang
      // (bukan ditolak — memilih siswa yang sama dua kali di layar itu wajar,
      // yang tidak boleh adalah dua BARIS untuk siswa yang sama).
      var kelPeserta = normalizeDaftarPesertaIzin(data.peserta);
      if (!kelPeserta.length) {
        return jsonOut({ status: 'error', message: 'Pilih minimal satu siswa peserta kegiatan.' });
      }
      if (kelPeserta.length > IZIN_MAX_PESERTA) {
        return jsonOut({ status: 'error', message: 'Peserta terlalu banyak (maksimal ' + IZIN_MAX_PESERTA + ' siswa per kegiatan).' });
      }

      var kelJalur = String(data.jalur || '').trim().toLowerCase() === IZIN_JALUR_KHUSUS ? IZIN_JALUR_KHUSUS : IZIN_JALUR_NORMAL;
      var kelAlasan = izinText(data.alasan_khusus, IZIN_MAX_ALASAN);
      var kelNow = new Date();
      if (kelJalur === IZIN_JALUR_KHUSUS) {
        if (!canVerifyIzin(ss, sessionUser, kelNow)) {
          return jsonOut({ status: 'error', message: 'Izin Khusus hanya bisa dibuat Guru Piket yang bertugas hari ini (atau BK/Admin).' });
        }
        if (!kelAlasan) {
          return jsonOut({ status: 'error', message: 'Alasan pengecualian wajib diisi untuk Izin Khusus.' });
        }
      } else {
        kelAlasan = '';
      }

      // Nama & kelas peserta dari Master_Siswa — apa pun yang dikirim klien
      // soal nama/kelas diabaikan (lihat resolveSiswaListForIzin).
      var kelResolved = resolveSiswaListForIzin(ss, kelPeserta);
      if (kelResolved.tidakDitemukan.length) {
        return jsonOut({ status: 'error', message: 'Ada peserta yang tidak ditemukan di data induk siswa (NISN: ' + kelResolved.tidakDitemukan.slice(0, 5).join(', ') + ').' });
      }

      var kelIzinSheet = getOrCreateSheet(ss, IZIN_SHEET_NAME, IZIN_HEADERS);
      var kelBentrok = findIzinTerbukaForNisnList(kelIzinSheet, kelPeserta);
      if (kelBentrok.length) {
        var kelNama = kelBentrok.map(function (b) { return b.name; }).slice(0, 5).join(', ');
        return jsonOut({ status: 'error', message: 'Sudah ada izin berjalan untuk: ' + kelNama + '. Selesaikan dulu sebelum membuat kegiatan ini.' });
      }

      // Jalur khusus = petugas piket menyetujui sekaligus memverifikasi, jadi
      // rombongannya langsung tercatat keluar. Jalur normal berhenti di
      // 'Menunggu Verifikasi' — dua tahap tetap dua tahap, sama seperti individual.
      var kelStatusAwal = kelJalur === IZIN_JALUR_KHUSUS ? izinStatusSetelahVerifikasi(kelTujuan) : IZIN_STATUS_MENUNGGU;
      var kelId = Utilities.getUuid();
      var kelSheet = getOrCreateSheet(ss, IZIN_KELOMPOK_SHEET_NAME, IZIN_KELOMPOK_HEADERS);
      var kelRow = [
        kelNow, kelId, kelKegiatan, kelTujuan, kelKeperluan, kelPola, kelResolved.siswa.length,
        kelJalur, kelAlasan,
        sessionUser.name, sessionUser.id, kelNow,
        kelJalur === IZIN_JALUR_KHUSUS ? sessionUser.name : '', kelJalur === IZIN_JALUR_KHUSUS ? sessionUser.id : '', kelJalur === IZIN_JALUR_KHUSUS ? kelNow : '',
      ];

      var kelBarisPeserta = kelResolved.siswa.map(function (siswa) {
        return [
          kelNow, siswa.nisn, siswa.name, siswa.class, Utilities.getUuid(), kelKeperluan, kelTujuan, kelStatusAwal, kelJalur, kelAlasan,
          sessionUser.name, sessionUser.id, kelNow,
          kelJalur === IZIN_JALUR_KHUSUS ? sessionUser.name : '', kelJalur === IZIN_JALUR_KHUSUS ? sessionUser.id : '', kelJalur === IZIN_JALUR_KHUSUS ? kelNow : '',
          kelJalur === IZIN_JALUR_KHUSUS ? kelNow : '', '', '', '',
          kelId,
        ];
      });

      kelSheet.appendRow(kelRow);
      appendRowsBatch(kelIzinSheet, kelBarisPeserta);
      clearIzinCache();
      logAudit(sessionUser,
        kelJalur === IZIN_JALUR_KHUSUS ? 'Izin Kelompok Khusus' : 'Persetujuan Izin Kelompok',
        buildKelompokAuditDetail(izinKelompokRowToObject(kelRow),
          'siswa=' + kelResolved.siswa.map(function (s) { return s.name; }).join(', ') +
          (kelJalur === IZIN_JALUR_KHUSUS ? ' | alasan pengecualian=' + kelAlasan : '')));
      // Satu notifikasi per KELAS yang terlibat (bukan per siswa) — rombongan
      // 8 siswa dari kelas yang sama tidak boleh membanjiri wali kelasnya
      // dengan 8 notifikasi identik untuk satu kegiatan yang sama. Guru Piket
      // (jalur normal saja) dinotifikasi TERPISAH, sekali per kegiatan.
      var kelJenisNotif = kelJalur === IZIN_JALUR_KHUSUS ? 'izin_diverifikasi' : 'izin_dibuat';
      var kelKelasNotified = {};
      kelResolved.siswa.forEach(function (siswa) {
        var kelasKey = String(siswa.class || '').trim().toLowerCase();
        if (!kelasKey || kelKelasNotified[kelasKey]) return;
        kelKelasNotified[kelasKey] = true;
        notifyRelevantUsers({ jenis: kelJenisNotif, nisn: siswa.nisn, kelas: siswa.class, refId: kelId, needsPiketAction: false });
      });
      if (kelJalur !== IZIN_JALUR_KHUSUS) {
        notifyRelevantUsers({ jenis: kelJenisNotif, nisn: '', kelas: '', refId: kelId, needsPiketAction: true });
      }
      return jsonOut({ status: 'success', id: kelId, izinStatus: kelStatusAwal, jumlahPeserta: kelResolved.siswa.length });
    }

    // ---- Verifikasi satu rombongan sekaligus (Guru Piket).
    // `pesertaIds` opsional: kalau dikirim, HANYA peserta itu yang diverifikasi —
    // inilah yang membuat petugas bisa mencoret siswa yang ternyata tidak jadi
    // ikut, tanpa memaksa seluruh rombongan lolos. Peserta yang tidak dicentang
    // tetap 'Menunggu Verifikasi', bukan diam-diam dianggap keluar. ----
    if (action === 'verifikasiIzinKelompok') {
      var vkNow = new Date();
      var vkKapasitas = izinKapasitasVerifikasi(ss, sessionUser, vkNow);
      if (!vkKapasitas) {
        return jsonOut({ status: 'error', message: 'Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa memverifikasi.' });
      }
      var vkKelSheet = ss.getSheetByName(IZIN_KELOMPOK_SHEET_NAME);
      var vkKel = vkKelSheet ? findIzinKelompokRowById(vkKelSheet, data.id) : null;
      if (!vkKel) {
        return jsonOut({ status: 'error', message: 'Data kegiatan tidak ditemukan (mungkin sudah diproses pengguna lain).' });
      }
      var vkIzinSheet = ss.getSheetByName(IZIN_SHEET_NAME);
      var vkPeserta = findPesertaKelompok(vkIzinSheet, vkKel.data.id);
      if (!vkPeserta.length) {
        return jsonOut({ status: 'error', message: 'Kegiatan ini tidak punya peserta.' });
      }

      // Daftar dari klien cuma boleh MEMPERSEMPIT, tidak pernah menambah: id
      // yang bukan milik kegiatan ini ditolak, bukan diabaikan diam-diam.
      var vkDipilih = vkPeserta;
      if (Array.isArray(data.pesertaIds) && data.pesertaIds.length) {
        var vkMinta = {};
        for (var vi = 0; vi < data.pesertaIds.length; vi++) vkMinta[String(data.pesertaIds[vi]).trim()] = true;
        vkDipilih = vkPeserta.filter(function (p) { return vkMinta[p.data.id]; });
        var vkDitemukan = {};
        vkDipilih.forEach(function (p) { vkDitemukan[p.data.id] = true; });
        for (var vk in vkMinta) {
          if (!vkDitemukan[vk]) return jsonOut({ status: 'error', message: 'Ada peserta yang bukan bagian dari kegiatan ini.' });
        }
      }

      var vkTarget = vkDipilih.filter(function (p) { return p.data.status === IZIN_STATUS_MENUNGGU; });
      if (!vkTarget.length) {
        return jsonOut({ status: 'error', message: 'Tidak ada peserta yang menunggu verifikasi pada kegiatan ini.' });
      }
      var vkStatusBaru = izinStatusSetelahVerifikasi(vkKel.data.tujuan);
      vkTarget.forEach(function (p) {
        p.values[7] = vkStatusBaru;
        p.values[13] = sessionUser.name;
        p.values[14] = sessionUser.id;
        p.values[15] = vkNow;
        p.values[16] = vkNow; // Waktu_Keluar — dicap saat verifikasi, sama seperti individual
      });
      writeIzinRowsBatch(vkIzinSheet, vkTarget);

      // Verifier di baris kegiatan diisi sekali (verifikasi pertama) — sekadar
      // konteks; kebenaran per siswa tetap ada di baris pesertanya masing-masing.
      if (!vkKel.values[12]) {
        var vkKelValues = vkKel.values.slice();
        vkKelValues[12] = sessionUser.name;
        vkKelValues[13] = sessionUser.id;
        vkKelValues[14] = vkNow;
        vkKelSheet.getRange(vkKel.rowIndex, 1, 1, IZIN_KELOMPOK_NUM_COLS).setValues([vkKelValues]);
      }
      clearIzinCache();
      var vkSisa = vkPeserta.length - vkTarget.length;
      logAudit(sessionUser, 'Verifikasi Izin Kelompok',
        buildKelompokAuditDetail(vkKel.data, 'diverifikasi=' + vkTarget.length + ' | tidak diverifikasi=' + vkSisa + ' | status=' + vkStatusBaru + ' | kapasitas=' + izinKapasitasLabel(vkKapasitas)));
      var vkKelasNotified = {};
      vkTarget.forEach(function (p) {
        var kelasKey = String(p.data.class || '').trim().toLowerCase();
        if (!kelasKey || vkKelasNotified[kelasKey]) return;
        vkKelasNotified[kelasKey] = true;
        notifyRelevantUsers({ jenis: 'izin_diverifikasi', nisn: p.data.nisn, kelas: p.data.class, refId: vkKel.data.id, needsPiketAction: false });
      });
      return jsonOut({ status: 'success', izinStatus: vkStatusBaru, jumlahDiverifikasi: vkTarget.length });
    }

    // ---- Tandai rombongan kembali (pola "bersama").
    // `pesertaIds` WAJIB dan berisi siswa yang BENAR-BENAR sudah kembali. Tidak
    // ada jalan "tandai semua" tanpa daftar: satu tap yang mengubah 8 siswa
    // sekaligus padahal 1 di antaranya masih di luar adalah persis catatan palsu
    // yang harus dihindari. Peserta yang tidak ikut dicentang TETAP 'Sedang di
    // Luar', dan selisihnya dicatat ke Audit Log sebagai pengecualian. ----
    if (action === 'tandaiKembaliKelompok') {
      var tkNow = new Date();
      var tkKapasitas = izinKapasitasVerifikasi(ss, sessionUser, tkNow);
      if (!tkKapasitas) {
        return jsonOut({ status: 'error', message: 'Hanya Guru Piket yang bertugas hari ini (atau BK/Admin) yang bisa menandai siswa kembali.' });
      }
      var tkKelSheet = ss.getSheetByName(IZIN_KELOMPOK_SHEET_NAME);
      var tkKel = tkKelSheet ? findIzinKelompokRowById(tkKelSheet, data.id) : null;
      if (!tkKel) {
        return jsonOut({ status: 'error', message: 'Data kegiatan tidak ditemukan (mungkin sudah diproses pengguna lain).' });
      }
      if (!Array.isArray(data.pesertaIds) || !data.pesertaIds.length) {
        return jsonOut({ status: 'error', message: 'Pilih dulu siswa mana saja yang sudah benar-benar kembali.' });
      }
      var tkIzinSheet = ss.getSheetByName(IZIN_SHEET_NAME);
      var tkPeserta = findPesertaKelompok(tkIzinSheet, tkKel.data.id);
      var tkMinta = {};
      for (var ti = 0; ti < data.pesertaIds.length; ti++) tkMinta[String(data.pesertaIds[ti]).trim()] = true;
      var tkDipilih = tkPeserta.filter(function (p) { return tkMinta[p.data.id]; });
      var tkDitemukan = {};
      tkDipilih.forEach(function (p) { tkDitemukan[p.data.id] = true; });
      for (var tk in tkMinta) {
        if (!tkDitemukan[tk]) return jsonOut({ status: 'error', message: 'Ada peserta yang bukan bagian dari kegiatan ini.' });
      }
      // Siswa yang sudah 'Pulang'/'Selesai' ditolak DI SINI juga — aksi
      // massal tidak boleh jadi celah untuk menembus penjaga transisi yang
      // berlaku pada aksi per siswa.
      for (var tj = 0; tj < tkDipilih.length; tj++) {
        if (tkDipilih[tj].data.status !== IZIN_STATUS_DI_LUAR) {
          return jsonOut({ status: 'error', message: tkDipilih[tj].data.name + ': ' + izinTolakTransisi(tkDipilih[tj].data.status, 'kembali') });
        }
      }
      // Langsung IZIN_STATUS_SELESAI, sama seperti tandaiKembaliIzinKeluar
      // individual — satu tap rombongan ini SUDAH administrasi lengkap untuk
      // peserta yang dicentang, tidak menunggu "Tutup transaksi" kedua.
      tkDipilih.forEach(function (p) {
        p.values[7] = IZIN_STATUS_SELESAI;
        p.values[17] = tkNow;
        p.values[18] = sessionUser.name;
        p.values[19] = sessionUser.id;
      });
      writeIzinRowsBatch(tkIzinSheet, tkDipilih);
      clearIzinCache();

      var tkBelum = tkPeserta.filter(function (p) { return p.data.status === IZIN_STATUS_DI_LUAR && !tkMinta[p.data.id]; });
      logAudit(sessionUser, 'Tandai Rombongan Kembali',
        buildKelompokAuditDetail(tkKel.data,
          'kembali=' + tkDipilih.length +
          ' | belum kembali=' + tkBelum.length +
          (tkBelum.length ? ' (' + tkBelum.map(function (p) { return p.data.name; }).join(', ') + ')' : '') +
          ' | kapasitas=' + izinKapasitasLabel(tkKapasitas)));
      var tkKelasNotified = {};
      tkDipilih.forEach(function (p) {
        var kelasKey = String(p.data.class || '').trim().toLowerCase();
        if (!kelasKey || tkKelasNotified[kelasKey]) return;
        tkKelasNotified[kelasKey] = true;
        notifyRelevantUsers({ jenis: 'izin_kembali', nisn: p.data.nisn, kelas: p.data.class, refId: tkKel.data.id, needsPiketAction: false });
      });
      return jsonOut({ status: 'success', jumlahKembali: tkDipilih.length, jumlahBelumKembali: tkBelum.length });
    }

    // ---- Edit 1 catatan (Terlambat/Pelanggaran/Surat) — SEMUA role non-OSIS
    // boleh, tapi dibatasi 5 menit sejak catatan dibuat (asumsi salah input),
    // kecuali admin (tidak dibatasi waktu). Guru/BK non-admin cuma boleh ubah
    // catatan yang DIA SENDIRI tulis — dicek lewat kolom Dicatat_Oleh (selalu
    // kolom terakhir di ketiga sheet kategori), supaya tidak ada yang bisa
    // utak-atik catatan guru lain. Baris dicari lewat kombinasi NISN+Timestamp
    // persis (bukan nomor baris), supaya tidak salah kalau baris lain sudah
    // ke-geser. ----
    if (action === 'editEntry') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getSheetForCategory(ss, data.category);
      if (!sheet) {
        return jsonOut({ status: 'error', message: 'Kategori tidak dikenali.' });
      }
      var found = findRowByNisnTimestamp(sheet, data.nisn, data.timestamp);
      if (!found) {
        return jsonOut({ status: 'error', message: 'Data tidak ditemukan (mungkin sudah diubah/dihapus pengguna lain).' });
      }
      if (!isAdminRole(sessionUser.role)) {
        var elapsedMs = new Date().getTime() - new Date(found.timestamp).getTime();
        if (elapsedMs > 5 * 60 * 1000) {
          return jsonOut({ status: 'error', message: 'Sudah lewat 5 menit sejak dicatat — tidak bisa diubah lagi.' });
        }
        // BK/Kesiswaan tetap boleh catatan siapa pun (perilaku lama, cuma
        // dibatasi waktu) — yang baru dibatasi ke "punya sendiri" cuma guru biasa.
        if (!isBkRole(sessionUser.role) && getRowLoggedBy(sheet, found.rowIndex) !== sessionUser.name) {
          return jsonOut({ status: 'error', message: 'Cuma bisa mengubah catatan yang Anda tulis sendiri.' });
        }
      }
      var rowIndex = found.rowIndex;
      if (data.category === 'terlambat') {
        sheet.getRange(rowIndex, 5).setValue(data.type || '');
      } else if (data.category === 'pelanggaran') {
        sheet.getRange(rowIndex, 5).setValue(data.jenis_pelanggaran || '');
        sheet.getRange(rowIndex, 6).setValue(data.sanksi || '');
        sheet.getRange(rowIndex, 7).setValue(data.catatan || '');
      } else if (data.category === 'surat') {
        sheet.getRange(rowIndex, 5).setValue(data.jenis || '');
        sheet.getRange(rowIndex, 6).setValue(data.keterangan || '');
      } else {
        return jsonOut({ status: 'error', message: 'Kategori tidak dikenali.' });
      }
      clearCacheForCategory(data.category);
      logAudit(sessionUser, 'Edit Data ' + data.category, data.name + ' (' + data.nisn + ')');
      return jsonOut({ status: 'success' });
    }

    // ---- Hapus 1 catatan — aturan sama seperti edit (semua role non-OSIS,
    // 5 menit; BK/Kesiswaan tetap boleh catatan siapa pun seperti perilaku
    // lama, guru biasa cuma boleh catatan sendiri) ----
    if (action === 'deleteEntry') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getSheetForCategory(ss, data.category);
      if (!sheet) {
        return jsonOut({ status: 'error', message: 'Kategori tidak dikenali.' });
      }
      var found = findRowByNisnTimestamp(sheet, data.nisn, data.timestamp);
      if (!found) {
        return jsonOut({ status: 'error', message: 'Data tidak ditemukan (mungkin sudah diubah/dihapus pengguna lain).' });
      }
      if (!isAdminRole(sessionUser.role)) {
        var elapsedMs = new Date().getTime() - new Date(found.timestamp).getTime();
        if (elapsedMs > 5 * 60 * 1000) {
          return jsonOut({ status: 'error', message: 'Sudah lewat 5 menit sejak dicatat — tidak bisa dihapus lagi.' });
        }
        if (!isBkRole(sessionUser.role) && getRowLoggedBy(sheet, found.rowIndex) !== sessionUser.name) {
          return jsonOut({ status: 'error', message: 'Cuma bisa menghapus catatan yang Anda tulis sendiri.' });
        }
      }
      sheet.deleteRow(found.rowIndex);
      clearCacheForCategory(data.category);
      logAudit(sessionUser, 'Hapus Data ' + data.category, data.name + ' (' + data.nisn + ')');
      return jsonOut({ status: 'success' });
    }

    // ================= PUSH NOTIFICATION: subscription per perangkat =================
    // Lihat Notifikasi.gs untuk arsitektur lengkap. Simpan/hapus SELALU
    // terikat ke sessionUser.id dari sesi — TIDAK PERNAH ke id yang (kalaupun)
    // dikirim klien — sehingga satu perangkat hanya bisa mengelola
    // subscription-nya sendiri, dan tidak pernah subscription pengguna lain.
    if (action === 'savePushSubscription') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sub = data.subscription || {};
      var subKeys = sub.keys || {};
      var endpoint = String(sub.endpoint || '').trim();
      var p256dh = String(subKeys.p256dh || '').trim();
      var authKey = String(subKeys.auth || '').trim();
      if (!endpoint || !p256dh || !authKey) {
        return jsonOut({ status: 'error', message: 'Data subscription tidak lengkap.' });
      }
      savePushSubscriptionForUser(ss, sessionUser.id, endpoint, p256dh, authKey, String(data.userAgent || '').slice(0, 200));
      return jsonOut({ status: 'success' });
    }

    if (action === 'deletePushSubscription') {
      var delEndpoint = String(data.endpoint || '').trim();
      if (delEndpoint) deletePushSubscriptionForUser(ss, sessionUser.id, delEndpoint);
      return jsonOut({ status: 'success' });
    }

    return jsonOut({ status: 'error', message: 'Action tidak dikenali' });
    } finally {
      sigapLock.releaseLock();
    }

  } catch (error) {
    return jsonOut({ status: 'error', message: error.toString() });
  }
}

// ===== CETAK SURAT IZIN KELUAR: orkestrasi & template (audit September 2026) =====
// Helper level-rendah (nomor surat, escapeHtml, konteks historis) ada di
// Utils.gs bersama blok IZIN lain — di sini murni MERANGKAI data & HTML.
// Prinsip yang sama dengan seluruh fitur Izin Keluar: ini OUTPUT dari
// transaksi yang sudah tersimpan, tidak pernah mengubah status/transisi.

// Kumpulkan (tanpa MENULIS apa pun) semua data untuk satu surat. Nomor
// surat yang dikembalikan di sini BELUM tentu sudah tersimpan di sheet —
// action 'generateIzinKeluarSurat' di atas yang menuliskannya, SETELAH
// render HTML-nya berhasil, supaya render yang gagal tidak "memakai" nomor.
function generateIzinKeluarSuratData(ss, izinId, sessionUser) {
  var sheet = ss.getSheetByName(IZIN_SHEET_NAME);
  var found = sheet ? findIzinRowById(sheet, izinId) : null;
  if (!found) throw new Error('Data izin tidak ditemukan.');
  var izin = found.data;

  // Bug yang diperbaiki (code review sebelum deploy, September 2026): aksi
  // ini dulu hanya menolak OSIS (dicek di pemanggilnya, action
  // 'generateIzinKeluarSurat') dan TIDAK mengecek ulang cakupan baca
  // per-transaksi — beda dari getIzinKeluar (daftar) yang menyaring lewat
  // scopeIzinForUser. Akibatnya siapa pun yang login (non-OSIS) dan tahu
  // satu ID transaksi (mis. dari URL) bisa mencetak surat transaksi siapa
  // saja, walau di luar kelas/harinya sendiri. Diperbaiki dengan memakai
  // scopeIzinForUser yang SAMA (satu sumber kebenaran, bukan aturan baru
  // yang bisa berselisih) — dibungkus jadi daftar berisi SATU transaksi ini
  // saja, lalu dicek apakah masih lolos saringannya. Aturannya PERSIS sama
  // dengan yang menentukan kartu ini tampil atau tidak di layar Gerbang:
  // transaksi yang masih berjalan tetap terlihat seluruh sekolah, yang
  // sudah selesai ikut aturan hari-ini-sekolah-luas / kelas-wali-kapan-saja.
  var izinTerlihat = scopeIzinForUser([izin], sessionUser, new Date());
  if (!izinTerlihat.length) {
    throw new Error('Tidak punya akses untuk mencetak surat izin ini.');
  }

  // Cetak kelompok BELUM didukung — lihat catatan di IZIN_HEADERS (Utils.gs).
  // Bukan lupa, sengaja: nomor per-aktivitas vs per-siswa, dan tanda tangan
  // kegiatan adalah keputusan produk sendiri yang belum dibahas.
  if (izin.kelompok_id) {
    throw new Error('Surat untuk peserta kegiatan kelompok belum didukung.');
  }
  var statusBolehCetak = [IZIN_STATUS_DI_LUAR, IZIN_STATUS_PULANG, IZIN_STATUS_SELESAI, IZIN_STATUS_KEMBALI];
  if (statusBolehCetak.indexOf(izin.status) === -1) {
    throw new Error('Surat hanya bisa dicetak setelah izin diverifikasi Guru Piket (status saat ini: ' + izin.status + ').');
  }

  var tanggalKode = izinTanggalUntukNomor(izin.waktu_verifikasi);
  // Nomor SUDAH ada (cetak ulang) -> dipakai lagi apa adanya, tidak pernah
  // minta nomor baru. Ini yang membuat aksi ini idempotent.
  var nomorSurat = izin.nomor_surat || generateNomorSurat(sheet, tanggalKode);

  // Konteks Wali Kelas/Guru Mapel HANYA untuk jalur normal — jalur khusus
  // memang sengaja tidak pernah diberi label itu di mana pun (lihat kartu
  // transaksi, gerbang.js) karena itu keputusan piket, bukan guru/wali kelas.
  var konteksLabel = '';
  if (izin.jalur !== IZIN_JALUR_KHUSUS) {
    konteksLabel = getKonteksApprovalFromAuditLog(ss, izin.id, izin.nisn, izin.name, izin.waktu_persetujuan) ||
      izinKonteksLabelTerkini(ss, izin);
  }

  var cetakNow = new Date();
  return {
    izinId: izin.id,
    nomor_surat: nomorSurat,
    tgl_cetak: formatTanggalPanjangID(cetakNow),
    jam_cetak: formatJamWITA(cetakNow),
    // NISN SENGAJA tidak ikut ke sini — konsisten dengan seluruh dokumen
    // lain yang dihasilkan SIGAP (lihat EXPORT_JENIS, Utils.gs: "identitas
    // siswa di dalam berkas cukup Nama + Kelas"), bukan pengecualian untuk
    // surat izin.
    nama_siswa: izin.name,
    kelas: izin.class,
    tujuan: izinTujuanLabel(izin.tujuan),
    keperluan: izin.keperluan,
    jalur: izin.jalur,
    alasan_khusus: izin.alasan_khusus,
    waktu_persetujuan: izin.waktu_persetujuan,
    waktu_verifikasi: izin.waktu_verifikasi,
    waktu_keluar: izin.waktu_keluar,
    waktu_kembali: izin.waktu_kembali,
    disetujui_oleh: izin.disetujui_oleh,
    konteks_persetujuan: konteksLabel,
    diverifikasi_oleh: izin.diverifikasi_oleh,
    status_izin: izin.status,
    status_izin_label: izinStatusSuratLabel(izin.status),
  };
}

// Satu-satunya tempat yang merangkai HTML surat. SEMUA nilai bebas-teks
// (keperluan, alasan_khusus, dan nama sekalipun) WAJIB lewat escapeHtml()
// (Utils.gs) sebelum disisipkan — lihat catatan panjang di fungsi itu.
// Print-friendly (@media print, target kertas A4 standar — lihat catatan
// lama soal BETA pencetakan yang sekarang berakhir di sini) dan tidak
// mengasumsikan perangkat cetak tertentu: HTML biasa yang dibuka & di-print
// lewat dialog print browser, bukan protokol khusus.
//
// Layout surat resmi (revisi setelah uji coba lapangan pertama, September
// 2026) — perbaikan dari 3 masalah yang ditemukan guru piket saat mencoba
// versi pertama (bentuk kartu aplikasi, bukan surat):
// 1. Bentuknya diubah dari kartu/kotak-kotak ala UI aplikasi menjadi
//    paragraf surat dinas formal (kop, kalimat pembuka "Yang bertanda
//    tangan di bawah ini...", daftar field bertitik dua, kalimat penutup)
//    — konvensi surat resmi sekolah Indonesia pada umumnya. Tidak ada
//    contoh surat asli sekolah yang dijadikan acuan persis; ini mengikuti
//    format surat dinas standar.
// 2. Kalimat "Surat ini berlaku sampai jam pulang sekolah (16:00 WITA)"
//    DIHAPUS — itu klaim yang TIDAK didukung aturan apa pun yang benar-benar
//    ditegakkan sistem (SIGAP tidak punya logika batas waktu 16:00 di mana
//    pun), jadi berisiko dibaca sebagai "siswa ini diizinkan di luar sampai
//    sore" padahal bukan itu maksudnya. Lebih aman tidak mengklaim sesuatu
//    yang tidak benar-benar berlaku.
// 3. Label "Tujuan" (nilai 'Kembali'/'Pulang', dari izinTujuanLabel — SATU
//    KATA karena fungsi itu memang untuk kolom tabel Export yang sempit,
//    lihat catatan di sana) gampang salah baca di surat ini sebagai
//    "tujuan/ke mana perginya siswa", padahal field itu sebenarnya
//    menjawab "akan kembali ke sekolah atau tidak". Direlabel jadi "Rencana
//    Kepulangan" dengan nilai frasa penuh ("Kembali ke sekolah" / "Pulang
//    (tidak kembali ke sekolah)"), dipetakan LOKAL di sini — bukan
//    memakai/mengubah izinTujuanLabel, supaya kolom Export yang sudah
//    benar sempit tidak ikut melebar.
// 4. QR verifikasi DIHAPUS (September 2026) — bukan cuma disembunyikan,
//    seluruh mekanismenya (generateVerificationURL, generateQRCodeImage,
//    action doGet 'verifyIzinSurat') sudah dicabut, bukan sekadar tidak
//    dipanggil. Alasan: satu-satunya bagian dari fitur cetak surat yang
//    butuh UrlFetchApp (memanggil layanan QR luar) berulang kali gagal di
//    lapangan tanpa bisa didiagnosis cepat dari jarak jauh, dan alternatif
//    "link teks biasa" (tanpa gambar QR, tapi tetap butuh endpoint publik)
//    dianggap tidak cukup praktis dibanding manfaatnya (satpam/orang tua
//    harus mengetik URL manual). Keputusan produk, bukan keterbatasan
//    teknis yang belum terpecahkan — surat tetap sah lewat nomor otomatis
//    + nama & jam persetujuan/verifikasi, sama seperti sebelum QR ada.
//    Konsekuensinya: renderIzinKeluarSuratHTML sekarang TIDAK PERNAH
//    memanggil layanan luar apa pun — murni menyusun teks dari data yang
//    sudah ada.
// 5. Logo kop surat DIUBAH dari <img src="https://raw.githubusercontent...">
//    menjadi base64 tertanam langsung di IZIN_SURAT_LOGO_DATA_URI di bawah
//    (audit September 2026) — poin 4 di atas mengklaim fungsi ini "TIDAK
//    PERNAH memanggil layanan luar apa pun", tapi klaim itu sebenarnya
//    salah selama logo masih di-fetch dari raw.githubusercontent.com
//    (domain LAIN dari yang menghosting SIGAP sendiri, beda dari dua
//    pemakaian IMG_1966.jpeg lain di ui-common.js yang relatif/satu-origin
//    dengan app). Laporan lapangan: logo kosong di preview/print pada
//    Android — root cause paling mungkin BUKAN url-nya tidak publik (sudah
//    dicek, 200 OK, image/jpeg), tapi ukurannya: file sumber 2482x2923px /
//    301KB untuk tampilan yang cuma 60x60px di kop surat, gampang lambat
//    atau gagal di koneksi seluler lambat/proxy kompresi operator (tema
//    yang sama dengan investigasi cache Android index.html, lihat
//    CLAUDE.md). Base64 di bawah adalah hasil resize ke maks 300x300px +
//    kompresi JPEG (~18KB) dari IMG_1966.jpeg yang sama — bukan gambar
//    baru, cuma versi kecilnya, ditanam langsung supaya BENAR-BENAR tidak
//    ada fetch jaringan sama sekali saat surat dibuat, sama seperti alasan
//    QR dihapus di poin 4.
function renderIzinKeluarSuratHTML(suratData) {
  var d = suratData || {};
  var logoUrl = IZIN_SURAT_LOGO_DATA_URI;
  var jalurKhusus = d.jalur === IZIN_JALUR_KHUSUS;
  var rencanaKepulangan = d.tujuan === 'Pulang' ? 'Pulang (tidak kembali ke sekolah)' : 'Kembali ke sekolah';

  var baris = function (label, nilaiHtmlSudahAman) {
    return '<div class="field-row"><span class="label">' + escapeHtml(label) + '</span><span class="titik-dua">:</span><span class="value">' + nilaiHtmlSudahAman + '</span></div>';
  };
  // Label DI ATAS isi (bukan sejajar dengan titik dua seperti field-row) —
  // field-row menyempitkan nilai jadi (lebar kotak - 160px label - 14px
  // titik dua), dan nama guru + konteks + jam ("Syarif Hidayatullah, S.Pd.I
  // — Wali Kelas, pukul 08:18 WITA") jauh lebih panjang dari itu, jadi
  // membungkus 2-3 baris dan memakan banyak tempat kertas (masukan
  // lapangan, September 2026). Dikelompokkan jadi kotak sendiri (mirip
  // tampilan sebelum surat dijadikan format dinas) supaya isinya punya
  // lebar PENUH kotak untuk membungkus, bukan terjepit di sebelah label.
  var kotakBaris = function (label, nilaiHtmlSudahAman) {
    return '<div class="baris"><div class="judul">' + escapeHtml(label) + '</div><div class="isi">' + nilaiHtmlSudahAman + '</div></div>';
  };

  var fieldRows =
    baris('Nama', escapeHtml(d.nama_siswa)) +
    baris('Kelas', escapeHtml(d.kelas)) +
    baris('Keperluan', escapeHtml(d.keperluan)) +
    baris('Rencana Kepulangan', escapeHtml(rencanaKepulangan));

  var infoBoxRows =
    (jalurKhusus
      ? kotakBaris('Izin Khusus oleh', escapeHtml(d.disetujui_oleh) + (d.waktu_persetujuan ? ', pukul ' + escapeHtml(formatJamWITA(d.waktu_persetujuan)) : '')) +
        (d.alasan_khusus ? kotakBaris('Alasan Pengecualian', escapeHtml(d.alasan_khusus)) : '')
      : kotakBaris('Disetujui oleh', escapeHtml(d.disetujui_oleh) + (d.konteks_persetujuan ? ' — ' + escapeHtml(d.konteks_persetujuan) : '') + (d.waktu_persetujuan ? ', pukul ' + escapeHtml(formatJamWITA(d.waktu_persetujuan)) : ''))) +
    (d.diverifikasi_oleh ? kotakBaris('Diverifikasi oleh', escapeHtml(d.diverifikasi_oleh) + (d.waktu_verifikasi ? ', pukul ' + escapeHtml(formatJamWITA(d.waktu_verifikasi)) : '')) : '') +
    kotakBaris('Status Saat Ini', escapeHtml(d.status_izin_label));

  return '<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Surat Izin Keluar - ' + escapeHtml(d.nomor_surat) + '</title>' +
    '<style>' +
    'body{font-family:"Times New Roman",Georgia,serif;color:#1B2A41;max-width:700px;margin:0 auto;padding:32px 40px;font-size:14px;line-height:1.65;background:#fff;}' +
    '.kop{text-align:center;border-bottom:3px double #1B2A41;padding-bottom:12px;margin-bottom:22px;}' +
    '.kop img{width:60px;height:60px;object-fit:contain;margin-bottom:6px;}' +
    '.kop .nama-sekolah{font-size:16px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;}' +
    '.kop .sub{font-size:11px;color:#3A3529;font-family:Arial,Helvetica,sans-serif;}' +
    'h1{font-size:14px;text-align:center;text-transform:uppercase;text-decoration:underline;letter-spacing:1px;margin:0 0 2px;}' +
    '.nomor{text-align:center;font-size:13px;margin-bottom:22px;}' +
    'p.pembuka,p.penutup{text-align:justify;margin:0 0 14px;}' +
    '.field-list{margin:0 0 18px 20px;}' +
    '.field-row{display:flex;margin-bottom:5px;font-size:13px;}' +
    '.field-row .label{width:160px;flex-shrink:0;}' +
    '.field-row .titik-dua{width:14px;flex-shrink:0;}' +
    '.field-row .value{font-weight:bold;}' +
    '.info-box{border:1px solid #DCD2C0;border-radius:8px;padding:12px 16px;margin:0 0 18px;}' +
    '.info-box .baris{margin-bottom:10px;}' +
    '.info-box .baris:last-child{margin-bottom:0;}' +
    '.info-box .judul{font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#5C5548;font-family:Arial,Helvetica,sans-serif;margin-bottom:2px;}' +
    '.info-box .isi{font-weight:bold;font-size:13px;}' +
    '.tempat-tanggal{text-align:right;margin-bottom:24px;}' +
    '.elektronik{font-size:10px;color:#5C5548;line-height:1.6;font-family:Arial,Helvetica,sans-serif;text-align:right;margin-top:8px;}' +
    '@media print{body{padding:15mm 20mm;max-width:none;}}' +
    '</style></head><body>' +
    '<div class="kop"><img src="' + logoUrl + '" alt="Logo SMAN 2 Tarakan" onerror="this.style.display=\'none\'"/>' +
    '<div class="nama-sekolah">SMAN 2 Tarakan</div>' +
    '<div class="sub">Sistem Informasi Gerbang &amp; Absensi Pelanggaran (SIGAP)</div></div>' +
    '<h1>Surat Izin Keluar</h1>' +
    '<div class="nomor">Nomor: ' + escapeHtml(d.nomor_surat) + '</div>' +
    '<p class="pembuka">Yang bertanda tangan di bawah ini menerangkan bahwa siswa berikut telah diberikan izin untuk meninggalkan lingkungan sekolah pada jam pelajaran berlangsung:</p>' +
    '<div class="field-list">' + fieldRows + '</div>' +
    '<div class="info-box">' + infoBoxRows + '</div>' +
    '<p class="penutup">Demikian surat izin ini dibuat untuk dapat dipergunakan sebagaimana mestinya.</p>' +
    // "Tarakan, <tanggal>" TANPA nama hari — konvensi baris tempat/tanggal
    // penutup surat resmi tidak menyertakan nama hari (beda dari baris
    // "Dicetak:" di bawah, yang memang sengaja menyertakannya). d.tgl_cetak
    // (formatTanggalPanjangID, Utils.gs) selalu berformat "Hari, D Bulan
    // YYYY" — bagian sebelum koma pertama dibuang di sini saja, bukan
    // dengan mengubah formatTanggalPanjangID itu sendiri (dipakai juga di
    // baris "Dicetak:" yang MEMANG perlu nama harinya).
    '<div class="tempat-tanggal">Tarakan, ' + escapeHtml(String(d.tgl_cetak || '').replace(/^[^,]+,\s*/, '')) + '</div>' +
    // Dipangkas dari 4 baris jadi 2 (masukan lapangan: surat ini kecil,
    // ruang vertikalnya berharga). "Nomor referensi" DIHAPUS di sini —
    // nomor suratnya sudah tertulis besar di judul atas ("Nomor: IK-..."),
    // menuliskannya lagi di sini cuma duplikat. Kalimat sah-tanpa-tanda-
    // tangan dipersingkat tapi maknanya dipertahankan utuh.
    '<div class="elektronik">Dihasilkan otomatis oleh SIGAP, sah tanpa tanda tangan basah.<br>Dicetak: ' + escapeHtml(d.tgl_cetak) + ', ' + escapeHtml(d.jam_cetak) + '</div>' +
    '</body></html>';
}

// ===== doGet =====

function doGet(e) {
  var token = e.parameter.token;
  if (!checkToken(token)) {
    return jsonOut({ status: 'error', message: 'Unauthorized' });
  }

  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cache = CacheService.getScriptCache();

  // Status publik, tidak perlu sesi — dipakai untuk cek API hidup, DAN untuk
  // memastikan deployment yang sedang dilayani memang versi yang baru
  // di-push (lihat BACKEND_VERSION di atas).
  if (!action) {
    return jsonOut({ status: 'active', message: 'SIGAP API Ready', version: BACKEND_VERSION, features: BACKEND_FEATURES });
  }

  // ---- Daftar nama guru untuk pencarian di layar Login. SENGAJA tidak butuh
  // sesi: justru dipanggil SEBELUM login (tetap digembok API_TOKEN seperti
  // semua endpoint lain). Yang dikirim HANYA {id, name} — JANGAN pernah
  // menambahkan role/jabatan/status/hash/salt ke respons ini, karena
  // endpoint ini terbuka untuk siapa pun yang belum terautentikasi.
  // Guru berstatus 'nonaktif' tidak ikut (memang tidak bisa login).
  // Cache 5 menit, alasannya sama dengan students_list di bawah: Master_Guru
  // kadang diedit langsung di Sheet tanpa lewat aplikasi. Aksi yang mengubah
  // daftar ini lewat aplikasi (addTeacher/toggleTeacherStatus) membuang
  // cache-nya sendiri, jadi perubahan dari dalam aplikasi tetap instan. ----
  if (action === 'getLoginUsers') {
    var cachedLoginUsers = cache.get('login_users');
    if (cachedLoginUsers) {
      return ContentService.createTextOutput(cachedLoginUsers).setMimeType(ContentService.MimeType.JSON);
    }
    var guruSheet = ss.getSheetByName('Master_Guru');
    var guruRows = guruSheet.getDataRange().getValues();
    var loginUsers = [];
    for (var gi = 1; gi < guruRows.length; gi++) {
      var guruId = String(guruRows[gi][0] || '').trim();
      var guruName = String(guruRows[gi][1] || '').trim();
      if (!guruId || !guruName) continue;
      if (String(guruRows[gi][5]).toLowerCase().trim() === 'nonaktif') continue;
      loginUsers.push({ id: guruId, name: guruName });
    }
    loginUsers.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    var loginUsersResult = JSON.stringify({ status: 'success', users: loginUsers });
    cache.put('login_users', loginUsersResult, 300);
    return ContentService.createTextOutput(loginUsersResult).setMimeType(ContentService.MimeType.JSON);
  }

  // 'verifyIzinSurat' (verifikasi surat via QR) DIHAPUS (September 2026)
  // bersamaan dengan seluruh fitur QR — lihat catatan di
  // renderIzinKeluarSuratHTML (Code.gs) untuk alasannya. Endpoint publik
  // ini tidak punya lagi apa pun yang mengarah ke sana (tidak ada QR yang
  // memuatnya), jadi dicabut, bukan dibiarkan menganggur.

  // Semua aksi GET lainnya WAJIB sesi valid
  var sessionUser = getSessionUser(e.parameter.sessionToken);
  if (!sessionUser) {
    return jsonOut({ status: 'error', message: 'Sesi berakhir, silakan login ulang.' });
  }

  // ---- Daftar siswa — semua role termasuk OSIS boleh (perlu untuk cari nama).
  // Cache 5 menit (bukan 6 jam seperti sebelumnya) — Master_Siswa sering diedit
  // LANGSUNG di Sheet (tambah/pindah siswa) tanpa lewat aplikasi, jadi tidak ada
  // aksi yang bisa membersihkan cache saat itu terjadi. 5 menit cukup pendek
  // supaya perubahan manual di Sheet muncul sendiri tanpa admin perlu tindakan
  // apa pun, tapi cukup panjang untuk tetap meringankan beban saat banyak guru
  // login bersamaan (misal pagi hari). ----
  if (action === 'getStudents') {
    var cached = cache.get('students_list');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
    var sheet = ss.getSheetByName('Master_Siswa');
    var rows = sheet.getDataRange().getValues();
    var students = [];
    for (var i = 1; i < rows.length; i++) {
      students.push({ nisn: rows[i][0], name: rows[i][1], class: rows[i][2] });
    }
    var result = JSON.stringify({ status: 'success', students: students });
    cache.put('students_list', result, 300);
    return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
  }

  // ---- Data ringkas hari ini (Terlambat/Surat/Pelanggaran) + data buat
  // banner "Siswa Sering Terlambat" — dipakai Beranda & Gerbang. JAUH lebih
  // ringan daripada tarik seluruh sheet (lihat getRowsSince di Utils.gs):
  // cuma 2 panggilan Sheets API per kategori, berapa pun banyak baris total.
  // CATATAN: respons ini di-cache GLOBAL (60 detik, sama untuk semua orang)
  // — jangan pernah taruh data yang beda per-pengguna (mis. status piket
  // pemanggil) di sini. Konteks personal (piket/wali kelas) ada di
  // getJadwalPiket/getWaliKelasMap yang dihitung terpisah di frontend. ----
  if (action === 'getTodayData') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var cachedToday = cache.get('today_data');
    if (cachedToday) {
      // Cache tetap MENTAH & global; pembatasan cakupan dilakukan setelah
      // dibaca, per pemanggil (pola yang sama dengan getLogs/getPelanggaran).
      return jsonOut(scopeTodayDataPayload(JSON.parse(cachedToday), sessionUser));
    }
    var now = new Date();
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    var logSheet = ss.getSheetByName('Log_Gerbang');
    var todayLateRaw = logSheet ? getRowsSince(logSheet, todayStart, 6) : [];
    var todayLate = todayLateRaw.map(function (r) { return { timestamp: r[0], nisn: r[1], name: r[2], class: r[3], type: r[4], logged_by: r[5] }; }).reverse();

    var suratSheet = ss.getSheetByName('Surat_Masuk');
    var todaySuratRaw = suratSheet ? getRowsSince(suratSheet, todayStart, 8) : [];
    var todaySurat = todaySuratRaw.map(function (r) { return { timestamp: r[0], nisn: r[1], name: r[2], class: r[3], jenis: r[4], keterangan: r[5], foto_url: r[6], logged_by: r[7] }; }).reverse();

    var pelanggaranSheet = ss.getSheetByName('Pelanggaran');
    var todayPelanggaranRaw = pelanggaranSheet ? getRowsSince(pelanggaranSheet, todayStart, 8) : [];
    var todayPelanggaran = todayPelanggaranRaw.map(function (r) { return { timestamp: r[0], nisn: r[1], name: r[2], class: r[3], jenis_pelanggaran: r[4], sanksi: r[5], catatan: r[6], logged_by: r[7] }; }).reverse();

    var weekStart = startOfWeekServer(now);
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var bannerCutoff = weekStart < monthStart ? weekStart : monthStart;
    var lateForBannerRaw = logSheet ? getRowsSince(logSheet, bannerCutoff, 6) : [];
    var lateForBanner = lateForBannerRaw.map(function (r) { return { timestamp: r[0], nisn: r[1], name: r[2], class: r[3], type: r[4], logged_by: r[5] }; });

    var result = JSON.stringify({ status: 'success', todayLate: todayLate, todaySurat: todaySurat, todayPelanggaran: todayPelanggaran, lateForBanner: lateForBanner });
    cache.put('today_data', result, 60);
    return jsonOut(scopeTodayDataPayload(JSON.parse(result), sessionUser));
  }

  // ---- Riwayat keterlambatan 1 siswa saja (untuk peringatan "sudah Nx
  // terlambat" di form Catat Terlambat) — on-demand per siswa yang dipilih ----
  if (action === 'getStudentLateHistory') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var logSheet = ss.getSheetByName('Log_Gerbang');
    var historyRaw = logSheet ? getLateHistoryForStudent(logSheet, e.parameter.nisn) : [];
    // Parameter nisn datang dari klien, jadi endpoint ini adalah jalan paling
    // langsung untuk menarik riwayat siswa mana pun kalau tidak dibatasi:
    // cakupannya dilewatkan melalui aturan yang sama dengan getLogs.
    var historyScoped = scopeDailyRecordsForUser(historyRaw, sessionUser);
    // Kelas & nama pencatat hanya dipakai untuk menyaring di atas — yang
    // dikirim ke klien tetap dua field seperti sebelumnya.
    var history = historyScoped.map(function (h) { return { timestamp: h.timestamp, type: h.type }; });
    // `count` = TOTAL keterlambatan siswa ini di seluruh sekolah, ANGKA saja —
    // tanpa tanggal, alasan, atau nama pencatatnya. Ini yang membuat peringatan
    // "sudah Nx terlambat" di form Catat Terlambat tetap benar untuk guru piket
    // setelah riwayat detail dibatasi di atas. Pola & alasannya sama persis
    // dengan getPelanggaranCountForStudent: guru tetap dapat konteks yang ia
    // butuhkan saat menangani SATU siswa yang sedang ada di depannya, tanpa
    // bisa menelusuri catatan siswa/guru lain. Sengaja per-siswa on-demand,
    // bukan peta semua siswa sekaligus (itu akan jadi bahan ranking).
    return jsonOut({ status: 'success', history: history, count: historyRaw.length });
  }

  // ---- Data umum (bukan untuk OSIS) — dipakai Riwayat & Statistik, di-fetch
  // lazy oleh frontend (baru ditarik saat salah satu tab itu pertama dibuka) ----
  // ⚠️ BUG YANG PERNAH TERJADI — jangan diulang: aksi ini dulu mengirim
  // SELURUH isi Log_Gerbang (riwayat seluruh sekolah, lintas bulan) ke SETIAP
  // pemanggil non-OSIS, dan browser yang memutuskan mana yang ditampilkan.
  // Artinya guru biasa bisa membaca riwayat keterlambatan siswa kelas mana pun
  // hanya dengan membuka Inspect/Network — penyaringan di UI tidak pernah
  // menjadi pengamanan. Cakupan sekarang ditentukan server lewat
  // scopeDailyRecordsForUser() di Utils.gs: hari ini seluruh sekolah (alur gerbang
  // butuh itu), riwayat hari sebelumnya = kelas perwalian saja. Guru biasa
  // tidak menyimpan riwayat lintas kelas hanya karena ia yang mencatatnya.
  //
  // Yang di-cache adalah daftar MENTAH (sama untuk semua orang), lalu disaring
  // per-pengguna SETELAH dibaca dari cache — pola yang sama persis dengan
  // pelanggaran_list_raw di bawah. Kalau yang di-cache adalah hasil yang sudah
  // disaring untuk satu orang, pemanggil berikutnya bisa menerima daftar milik
  // orang lain.
  if (action === 'getLogs') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var logsRaw;
    var cachedLogs = cache.get('today_logs');
    if (cachedLogs) {
      // Toleran terhadap entri format LAMA (respons utuh {status, logs})
      // yang mungkin masih tersisa di cache saat versi ini baru di-deploy.
      var parsedLogs = JSON.parse(cachedLogs);
      logsRaw = Array.isArray(parsedLogs) ? parsedLogs : (parsedLogs.logs || []);
    } else {
      var sheet = ss.getSheetByName('Log_Gerbang');
      logsRaw = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          logsRaw.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], type: rows[i][4], logged_by: rows[i][5] });
        }
        logsRaw.reverse();
      }
      cache.put('today_logs', JSON.stringify(logsRaw), 60);
    }
    return jsonOut({ status: 'success', logs: scopeDailyRecordsForUser(logsRaw, sessionUser) });
  }

  if (action === 'getTeachers') {
    if (!isAdminRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var sheet = ss.getSheetByName('Master_Guru');
    var rows = sheet.getDataRange().getValues();
    var teachers = [];
    for (var i = 1; i < rows.length; i++) {
      // Kolom G (index 6) = Kelas_Wali, dipakai panel Kelola untuk atur wali kelas.
      teachers.push({ id: rows[i][0], name: rows[i][1], role: rows[i][3], jabatan: rows[i][4] || '', status: (String(rows[i][5]).toLowerCase().trim() === 'nonaktif') ? 'nonaktif' : 'aktif', kelasWali: rows[i][6] || '' });
    }
    // Urut abjad (sama seperti getLoginUsers) — dipakai Daftar Guru & dropdown
    // Jadwal Piket di panel Kelola, supaya sekolah dengan puluhan guru tidak
    // perlu menyisir urutan baris Sheet yang acak.
    teachers.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return jsonOut({ status: 'success', teachers: teachers });
  }

  // Surat/Izin mengikuti aturan cakupan yang SAMA PERSIS dengan Keterlambatan
  // (scopeDailyRecordsForUser di Utils.gs): hari ini seluruh sekolah — guru
  // gerbang harus tahu siswa mana yang sudah menyerahkan surat hari itu supaya
  // tidak dicatat dua kali — sedangkan riwayat hari sebelumnya hanya untuk
  // admin/BK (seluruh sekolah) dan wali kelas (kelasnya sendiri).
  // Sebelum ini seluruh isi Surat_Masuk dikirim ke setiap pemanggil non-OSIS.
  // Cache tetap MENTAH & global, penyaringan dilakukan setelah dibaca.
  if (action === 'getSurat') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var suratRaw;
    var cachedSurat = cache.get('surat_list');
    if (cachedSurat) {
      // Toleran terhadap entri format LAMA (respons utuh {status, surat}).
      var parsedSurat = JSON.parse(cachedSurat);
      suratRaw = Array.isArray(parsedSurat) ? parsedSurat : (parsedSurat.surat || []);
    } else {
      var sheet = ss.getSheetByName('Surat_Masuk');
      suratRaw = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          suratRaw.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], jenis: rows[i][4], keterangan: rows[i][5], foto_url: rows[i][6], logged_by: rows[i][7] });
        }
        suratRaw.reverse();
      }
      cache.put('surat_list', JSON.stringify(suratRaw), 60);
    }
    return jsonOut({ status: 'success', surat: scopeDailyRecordsForUser(suratRaw, sessionUser) });
  }

  // ---- Pelanggaran: BK/Kesiswaan/Admin lihat semua, wali kelas lihat
  // kelasnya sendiri, guru biasa (bukan wali kelas) lihat catatan yang DIA
  // SENDIRI tulis (dicocokkan lewat nama pencatat) — bukan dikosongkan total.
  // Tujuannya supaya guru tidak merasa "disembunyikan", tapi tetap tidak bisa
  // menelusuri catatan siswa/kelas/guru lain. Data mentah (semua kelas)
  // di-cache GLOBAL 60 detik seperti biasa — tapi hasil akhir yang dikirim ke
  // browser difilter per-pengguna SETELAH diambil dari cache, supaya tidak
  // ada versi "sudah difilter untuk orang lain" yang ke-cache lalu salah
  // kirim ke pengguna berikutnya. ----
  if (action === 'getPelanggaran') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var pelanggaran;
    var cachedRaw = cache.get('pelanggaran_list_raw');
    if (cachedRaw) {
      pelanggaran = JSON.parse(cachedRaw);
    } else {
      var sheet = ss.getSheetByName('Pelanggaran');
      pelanggaran = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          pelanggaran.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], jenis_pelanggaran: rows[i][4], sanksi: rows[i][5], catatan: rows[i][6], logged_by: rows[i][7] });
        }
        pelanggaran.reverse();
      }
      cache.put('pelanggaran_list_raw', JSON.stringify(pelanggaran), 60);
    }
    // Cakupan ditentukan scopePelanggaranForUser() di Utils.gs: admin/BK
    // seluruh sekolah, wali kelas = kelasnya + catatan yang ia tulis sendiri
    // (sebelumnya KELAS saja — catatan yang ia tulis untuk siswa kelas lain
    // ikut hilang dari daftarnya sendiri), guru biasa = catatan sendiri.
    return jsonOut({ status: 'success', pelanggaran: scopePelanggaranForUser(pelanggaran, sessionUser) });
  }

  // ---- Hitung TOTAL pelanggaran seorang siswa (semua guru, bukan cuma yang
  // login) — dipakai peringatan "sudah Nx tercatat" saat mencatat pelanggaran
  // baru. Sengaja cuma kirim ANGKA, bukan daftar isinya (jenis/sanksi/siapa)
  // — supaya guru biasa tetap dapat konteks penting tanpa bisa mengintip
  // detail catatan siswa/guru lain lewat celah ini. Dipanggil on-demand per
  // 1 siswa yang dipilih (pola sama seperti getStudentLateHistory), bukan
  // agregat semua siswa sekaligus — kalau semua nisn dikirim jadi peta
  // sekaligus, guru bisa susun ranking siswa paling bermasalah se-sekolah,
  // justru itu yang mau dicegah. ----
  if (action === 'getPelanggaranCountForStudent') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var sheet = ss.getSheetByName('Pelanggaran');
    var count = 0;
    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var nisnValues = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
        for (var i = 0; i < nisnValues.length; i++) {
          if (String(nisnValues[i][0]) === String(e.parameter.nisn)) count++;
        }
      }
    }
    return jsonOut({ status: 'success', count: count });
  }

  // ---- Bimbingan Khusus (admin + BK/Kesiswaan only) ----
  if (action === 'getBimbingan') {
    if (!isBkRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var sheet = ss.getSheetByName('Bimbingan_Khusus');
    var bimbingan = [];
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        bimbingan.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], catatan: rows[i][4], logged_by: rows[i][5] });
      }
      bimbingan.reverse();
    }
    return jsonOut({ status: 'success', bimbingan: bimbingan });
  }

  // ---- Tindak Lanjut siswa sering terlambat (banner Perlu Perhatian di
  // Dashboard) — admin/BK lihat semua kelas, wali kelas cuma kelasnya sendiri,
  // guru biasa non-wali-kelas tidak dapat apa-apa (sama seperti getPelanggaran). ----
  if (action === 'getTindakLanjut') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var cache = CacheService.getScriptCache();
    var tindakLanjut;
    var cachedRaw = cache.get('tindak_lanjut_list_raw');
    if (cachedRaw) {
      tindakLanjut = JSON.parse(cachedRaw);
    } else {
      var sheet = ss.getSheetByName('Tindak_Lanjut');
      tindakLanjut = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          tindakLanjut.push({
            timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3],
            catatan: rows[i][4], diajukanOleh: rows[i][5], status: rows[i][6],
            disetujuiOleh: rows[i][7], tanggalDisetujui: rows[i][8],
          });
        }
        tindakLanjut.reverse();
      }
      cache.put('tindak_lanjut_list_raw', JSON.stringify(tindakLanjut), 60);
    }
    if (!isBkRole(sessionUser.role)) {
      var myKelas = sessionUser.waliKelas || '';
      tindakLanjut = myKelas ? tindakLanjut.filter(function (t) { return sameClass(t.class, myKelas); }) : [];
    }
    return jsonOut({ status: 'success', tindakLanjut: tindakLanjut });
  }

  // ---- Pelanggaran Upacara ----
  // Siapa boleh apa di Rekap Pelanggaran Upacara — ditegakkan DI SINI, bukan
  // sekadar menyembunyikan menu di frontend:
  // - admin & BK/Kesiswaan : seluruh sekolah
  // - OSIS                 : seluruh sekolah, TAPI hanya untuk data upacara.
  //                          Semua endpoint disiplin lain (getLogs, getSurat,
  //                          getPelanggaran, getBimbingan, getTindakLanjut)
  //                          tetap menolak OSIS seperti sebelumnya.
  // - guru wali kelas      : HANYA kelasnya sendiri — dipakai kategori Upacara
  //                          di Rekap Kelas, supaya wali kelas tidak perlu
  //                          membuka menu Upacara cuma untuk tahu kondisi
  //                          anaknya.
  // - guru biasa           : tidak dapat akses.
  if (action === 'getPelanggaranUpacara') {
    var upacaraWaliKelas = String(sessionUser.waliKelas || '');
    if (!(isOsisRole(sessionUser.role) || isBkRole(sessionUser.role) || upacaraWaliKelas)) {
      return jsonOut({ status: 'error', message: 'Unauthorized' });
    }
    // Cache MENTAH (semua pencatat) lalu difilter per-pengguna SETELAH dibaca
    // dari cache — pola yang sama persis dengan pelanggaran_list_raw di atas,
    // dan alasannya sama: kalau yang di-cache adalah hasil yang sudah
    // difilter untuk satu orang, pengguna berikutnya bisa menerima daftar
    // milik orang lain. Kolom H (index 7) = Dicatat_Oleh_ID ikut disimpan di
    // cache karena filter OSIS membutuhkannya, tapi TIDAK ikut dikirim ke
    // klien (tetap hanya 7 field seperti sebelumnya).
    //
    // Invalidasi 'pelanggaran_upacara_raw' sudah dipasang di
    // addPelanggaranUpacara sejak lama, tapi tidak pernah ada yang MENULIS
    // cache-nya — jadi setiap pembukaan tab Upacara memindai seluruh sheet.
    var upacaraRaw;
    var cachedUpacara = cache.get('pelanggaran_upacara_raw');
    if (cachedUpacara) {
      upacaraRaw = JSON.parse(cachedUpacara);
    } else {
      var sheet = ss.getSheetByName('Pelanggaran_Upacara');
      upacaraRaw = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          upacaraRaw.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], jenis_pelanggaran: rows[i][4], catatan: rows[i][5], logged_by: rows[i][6], by_id: String(rows[i][7]) });
        }
        upacaraRaw.reverse();
      }
      cache.put('pelanggaran_upacara_raw', JSON.stringify(upacaraRaw), 60);
    }
    // OSIS sekarang melihat SELURUH rekap upacara (sebelumnya hanya catatan
    // yang dia input sendiri) — Rekap Upacara memang dimaksudkan sebagai alat
    // baca bersama untuk petugas upacara. Yang tidak berubah: OSIS tetap
    // terkunci dari semua kategori disiplin lain.
    var seluruhSekolah = isBkRole(sessionUser.role) || isOsisRole(sessionUser.role);
    var upacara = [];
    for (var ui = 0; ui < upacaraRaw.length; ui++) {
      var u = upacaraRaw[ui];
      if (!seluruhSekolah && !sameClass(u.class, upacaraWaliKelas)) {
        continue; // wali kelas: hanya kelasnya sendiri
      }
      upacara.push({ timestamp: u.timestamp, nisn: u.nisn, name: u.name, class: u.class, jenis_pelanggaran: u.jenis_pelanggaran, catatan: u.catatan, logged_by: u.logged_by });
    }
    return jsonOut({ status: 'success', upacara: upacara });
  }

  // ---- Izin Keluar / Pulang (BETA) — bukan untuk OSIS ----
  // Cakupannya ditentukan scopeIzinForUser() di Utils.gs dan TIDAK memperluas
  // hak baca siapa pun: transaksi yang masih berjalan terlihat semua pemakai
  // non-OSIS (alasan yang sama dengan "hari ini seluruh sekolah" pada alur
  // gerbang — petugas piket harus bisa menandai siswa yang masih di luar),
  // sedangkan yang sudah tertutup ikut aturan Keterlambatan & Surat yang sudah
  // berlaku. Cache tetap MENTAH & global, penyaringan dilakukan SETELAH dibaca
  // — pola yang sama persis dengan today_logs/surat_list/pelanggaran_list_raw,
  // supaya tidak ada hasil "sudah difilter untuk satu orang" yang ke-cache
  // lalu salah kirim ke pemanggil berikutnya.
  if (action === 'getIzinKeluar') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var izinRaw;
    var cachedIzin = cache.get('izin_keluar_raw');
    if (cachedIzin) {
      izinRaw = JSON.parse(cachedIzin);
    } else {
      var izinSheetGet = ss.getSheetByName(IZIN_SHEET_NAME);
      izinRaw = [];
      if (izinSheetGet) {
        var izinRows = izinSheetGet.getDataRange().getValues();
        for (var izi = 1; izi < izinRows.length; izi++) {
          if (!izinRows[izi][4]) continue; // baris tanpa ID = baris kosong/rusak
          izinRaw.push(izinRowToObject(izinRows[izi]));
        }
        izinRaw.reverse();
      }
      cache.put('izin_keluar_raw', JSON.stringify(izinRaw), 30);
    }
    // ---- Konteks kegiatan (Izin Kelompok) ----
    // Baris kegiatan TIDAK punya kolom kelas, jadi ia tidak bisa (dan tidak
    // boleh) disaring sendiri: yang dikirim hanya kegiatan yang MASIH PUNYA
    // minimal satu peserta yang boleh dilihat pemanggil ini. Dengan begitu
    // cakupan bacanya diturunkan langsung dari aturan yang sudah ada di
    // scopeIzinForUser — tidak ada aturan kedua yang bisa melenceng, dan nama
    // kegiatan tidak bocor ke orang yang tidak berhak melihat satu pun pesertanya.
    var izinScoped = scopeIzinForUser(izinRaw, sessionUser);
    var kelompokRaw;
    var cachedKelompok = cache.get('izin_kelompok_raw');
    if (cachedKelompok) {
      kelompokRaw = JSON.parse(cachedKelompok);
    } else {
      var kelSheetGet = ss.getSheetByName(IZIN_KELOMPOK_SHEET_NAME);
      kelompokRaw = [];
      if (kelSheetGet) {
        var kelRows = kelSheetGet.getDataRange().getValues();
        for (var kli = 1; kli < kelRows.length; kli++) {
          if (!kelRows[kli][1]) continue; // baris tanpa ID = baris kosong/rusak
          kelompokRaw.push(izinKelompokRowToObject(kelRows[kli]));
        }
        kelompokRaw.reverse();
      }
      cache.put('izin_kelompok_raw', JSON.stringify(kelompokRaw), 30);
    }
    var kelompokTerlihat = {};
    for (var si = 0; si < izinScoped.length; si++) {
      if (izinScoped[si].kelompok_id) kelompokTerlihat[izinScoped[si].kelompok_id] = true;
    }
    var kelompok = kelompokRaw.filter(function (k) { return kelompokTerlihat[k.id]; });
    // Nama kegiatan ditempelkan ke baris peserta SAAT MENGIRIM saja (bukan
    // disimpan ulang di sheet peserta) — supaya Riwayat bisa menampilkan
    // "peserta Seminar Bank Indonesia" tanpa menduplikasi data kegiatan.
    var namaKegiatan = {};
    kelompok.forEach(function (k) { namaKegiatan[k.id] = k.kegiatan; });

    // Kapasitas "Guru Piket" vs "BK/Kesiswaan" untuk kartu — lihat audit
    // Agustus 2026 di Utils.gs. Dihitung SEKALI di sini (piketSet dibangun
    // sekali dari Jadwal_Piket), bukan diklaim/dikirim dari klien: kartu
    // hanya menampilkan ulang label yang sudah ditentukan server.
    var piketSet = buildPiketHariSet(ss);
    izinScoped = izinScoped.map(function (r) {
      var patch = {
        diverifikasi_kapasitas: izinKapasitasBaris(piketSet, r.diverifikasi_oleh_id, r.waktu_verifikasi),
        dicatat_kembali_kapasitas: izinKapasitasBaris(piketSet, r.dicatat_kembali_oleh_id, r.waktu_kembali),
      };
      if (r.kelompok_id) patch.kegiatan = namaKegiatan[r.kelompok_id] || '';
      return Object.assign({}, r, patch);
    });
    kelompok = kelompok.map(function (k) {
      return Object.assign({}, k, {
        diverifikasi_kapasitas: izinKapasitasBaris(piketSet, k.diverifikasi_oleh_id, k.waktu_verifikasi),
      });
    });

    // Status "boleh verifikasi / boleh tandai kembali" ikut dikirim supaya
    // layar tidak menampilkan tombol yang pasti ditolak server. Ini KENYAMANAN,
    // bukan pengamanan — gerbang sesungguhnya ada di canVerifyIzin() pada tiap
    // aksi tulis di doPost.
    return jsonOut({
      status: 'success',
      izin: izinScoped,
      kelompok: kelompok,
      canVerify: canVerifyIzin(ss, sessionUser, new Date()),
    });
  }

  // ---- Audit Log (ADMIN ONLY) — jejak keamanan permanen ----
  // Sebelumnya isBkRole (admin + BK/Kesiswaan). Dipersempit ke admin saja:
  // Audit Log memuat jejak SEMUA orang (termasuk aksi admin & percobaan export
  // milik guru lain), jadi ia alat pengawasan, bukan alat kerja harian BK.
  // Pemeriksaan tetap memakai helper role yang sudah ada (isAdminRole di
  // Auth.gs) — tidak ada mekanisme role/identitas baru. Menu 'auditlog' juga
  // dicabut dari bk_kesiswaan di config.js, tapi ITU bukan pengamanannya:
  // gerbangnya di baris ini.
  if (action === 'getAuditLog') {
    if (!isAdminRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var sheet = ss.getSheetByName('Audit_Log');
    var auditLog = [];
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      var start = Math.max(1, rows.length - 300); // batasi 300 terbaru biar tidak berat
      for (var i = start; i < rows.length; i++) {
        auditLog.push({ timestamp: rows[i][0], name: rows[i][1], id: rows[i][2], action: rows[i][3], detail: rows[i][4] });
      }
      auditLog.reverse();
    }
    return jsonOut({ status: 'success', auditLog: auditLog });
  }

  // ---- Jadwal Piket mingguan (bukan untuk OSIS) — pola tetap per hari,
  // sama untuk semua orang yang lihat, jadi aman di-cache lebih lama (1 jam).
  // Frontend yang menentukan "hari ini" & "apakah saya piket" dari daftar ini
  // (lihat helpers.js), bukan dihitung di sini, supaya cache tidak perlu
  // dipecah per-pengguna atau per-hari. ----
  if (action === 'getJadwalPiket') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var cached = cache.get('jadwal_piket');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
    var sheet = ss.getSheetByName('Jadwal_Piket');
    var guruMap = {};
    var guruSheet = ss.getSheetByName('Master_Guru');
    var guruRows = guruSheet.getDataRange().getValues();
    for (var i = 1; i < guruRows.length; i++) guruMap[String(guruRows[i][0])] = guruRows[i][1];

    var jadwal = [];
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      for (var j = 1; j < rows.length; j++) {
        if (!rows[j][0]) continue;
        jadwal.push({ hari: rows[j][0], guruId: rows[j][1], guruName: guruMap[String(rows[j][1])] || '(guru tidak ditemukan)' });
      }
    }
    var result = JSON.stringify({ status: 'success', jadwal: jadwal });
    cache.put('jadwal_piket', result, 3600);
    return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
  }

  // ---- Peta Kelas -> Wali Kelas (bukan untuk OSIS) — dipakai Dashboard
  // (ringkasan kelas perwalian) & Rekap Kelas. Sama untuk semua orang yang
  // lihat, aman di-cache 1 jam. ----
  if (action === 'getWaliKelasMap') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var cached = cache.get('wali_kelas_map');
    if (cached) {
      return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    }
    var sheet = ss.getSheetByName('Master_Guru');
    var rows = sheet.getDataRange().getValues();
    var map = [];
    for (var i = 1; i < rows.length; i++) {
      var kelasWali = rows[i][6];
      if (kelasWali) {
        map.push({ class: kelasWali, waliKelasName: rows[i][1], waliKelasId: rows[i][0] });
      }
    }
    var result = JSON.stringify({ status: 'success', waliKelasMap: map });
    cache.put('wali_kelas_map', result, 3600);
    return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
  }

  // ---- Export Data: laporan siap unduh (PDF/Excel) ----
  // Google Spreadsheet tetap ADMIN-ONLY; ini jalan resmi bagi yang berwenang
  // untuk mengambil rekap TANPA dibukakan akses ke Sheet-nya.
  //
  // Urutannya WAJIB seperti di bawah dan tidak boleh dibalik:
  //   sesi valid (sudah dicek di atas) -> rate limit -> OTORISASI ->
  //   VALIDASI FILTER -> baru baca sheet -> susun laporan -> catat Audit Log.
  // Artinya: tidak ada satu baris data pun yang dibaca (apalagi dikirim ke
  // browser) sebelum server memutuskan pemanggil memang berhak atas jenis
  // laporan + kelas + periode yang diminta. Nilai `kelas` dari klien TIDAK
  // dipercaya — lihat resolveExportAccess() di Utils.gs.
  if (action === 'exportData') {
    if (!checkExportRateLimit(e.parameter.sessionToken)) {
      return jsonOut({ status: 'error', message: 'Terlalu banyak permintaan export. Coba lagi beberapa menit lagi.' });
    }

    var exportJenis = String(e.parameter.jenis || '').trim();
    var exportFormat = String(e.parameter.format || '').toLowerCase().trim();
    if (exportFormat !== 'pdf' && exportFormat !== 'xlsx') exportFormat = '-';
    // Parameter mentah cuma dipakai untuk keperluan pesan/Audit Log saat
    // permintaan DITOLAK — dipotong pendek supaya teks bebas dari klien tidak
    // bisa membanjiri baris Audit Log.
    var rawPeriode = String(e.parameter.start || '-').slice(0, 10) + ' - ' + String(e.parameter.end || '-').slice(0, 10);

    var exportAccess = resolveExportAccess(sessionUser, exportJenis, e.parameter.kelas);
    if (!exportAccess.allowed) {
      logAudit(sessionUser, 'Export Data Ditolak', buildExportAuditDetail(exportJenis || '-', rawPeriode, String(e.parameter.kelas || '-').slice(0, 40), exportFormat, 0, 'ditolak'));
      return jsonOut({ status: 'error', message: exportAccess.message });
    }

    var exportPeriod = validateExportPeriod(e.parameter.start, e.parameter.end);
    if (!exportPeriod.valid) {
      logAudit(sessionUser, 'Export Data Ditolak', buildExportAuditDetail(exportJenis, rawPeriode, exportAccess.scopeLabel, exportFormat, 0, 'filter tidak valid'));
      return jsonOut({ status: 'error', message: exportPeriod.message });
    }
    if (exportFormat === '-') {
      logAudit(sessionUser, 'Export Data Ditolak', buildExportAuditDetail(exportJenis, exportPeriod.label, exportAccess.scopeLabel, '-', 0, 'format tidak dikenali'));
      return jsonOut({ status: 'error', message: 'Format laporan tidak dikenali.' });
    }

    var exportDef = EXPORT_JENIS[exportJenis];
    var exportRows;
    if (exportDef.special === 'rekap') {
      // Rekap Siswa = agregat empat kategori, bukan sheet tersendiri.
      var rekapSources = {};
      var rekapJenis = ['keterlambatan', 'pelanggaran', 'surat', 'upacara'];
      for (var rj = 0; rj < rekapJenis.length; rj++) {
        var rekapDef = EXPORT_JENIS[rekapJenis[rj]];
        var rekapSheet = ss.getSheetByName(rekapDef.sheet);
        rekapSources[rekapJenis[rj]] = rekapSheet ? getRowsSince(rekapSheet, exportPeriod.start, rekapDef.numCols) : [];
      }
      exportRows = buildRekapRows(rekapSources, exportAccess.kelasFilter, exportPeriod.start, exportPeriod.end);
    } else {
      var exportSheet = ss.getSheetByName(exportDef.sheet);
      // getRowsSince = binary search ke baris pertama dalam periode, jadi
      // biaya bacanya tidak ikut membengkak seiring panjang riwayat sheet.
      var exportRaw = exportSheet ? getRowsSince(exportSheet, exportPeriod.start, exportDef.numCols) : [];
      exportRows = buildExportRows(exportJenis, exportRaw, exportAccess.kelasFilter, exportPeriod.start, exportPeriod.end);
    }

    if (exportRows.length > EXPORT_MAX_ROWS) {
      logAudit(sessionUser, 'Export Data Gagal', buildExportAuditDetail(exportJenis, exportPeriod.label, exportAccess.scopeLabel, exportFormat, exportRows.length, 'melebihi batas baris'));
      return jsonOut({ status: 'error', message: 'Data terlalu banyak (' + exportRows.length + ' baris, batas ' + EXPORT_MAX_ROWS + '). Persempit periode atau pilih satu kelas.' });
    }

    var exportNow = new Date();
    logAudit(sessionUser, exportRows.length ? 'Export Data' : 'Export Data Kosong',
      buildExportAuditDetail(exportJenis, exportPeriod.label, exportAccess.scopeLabel, exportFormat, exportRows.length, exportRows.length ? 'berhasil' : 'tidak ada data'));

    return jsonOut({
      status: 'success',
      report: {
        jenis: exportJenis,
        jenisLabel: exportDef.label,
        judul: exportDef.judul,
        sekolah: EXPORT_SEKOLAH,
        columns: exportDef.columns,
        rows: exportRows,
        total: exportRows.length,
        periodeLabel: exportPeriod.label,
        scopeLabel: exportAccess.scopeLabel,
        format: exportFormat,
        dibuatPada: formatExportDate(exportNow) + ' ' + formatExportTime(exportNow),
      },
    });
  }

  // ---- Pratinjau Hapus Data: hitung dampak SEBELUM ada apa pun yang
  // terhapus (Pemeliharaan Data, menu Kelola > admin only) — Tahap 1 dari
  // alur konfirmasi berlapis di admin.js. Murni baca, sama seperti
  // exportData: tidak pernah mengubah satu baris pun. Jumlah yang
  // dikembalikan di sini BUKAN sumber kebenaran final — eksekusi
  // ('hapusDataPeriode' di doPost) menghitung ULANG dari sheet sebenarnya
  // persis sebelum menghapus, lihat catatan race condition di sana. ----
  if (action === 'previewHapusData') {
    if (!isAdminRole(sessionUser.role)) {
      return jsonOut({ status: 'error', message: 'Hanya admin yang bisa melihat pratinjau penghapusan data.' });
    }
    if (!checkExportRateLimit(e.parameter.sessionToken)) {
      return jsonOut({ status: 'error', message: 'Terlalu banyak permintaan. Coba lagi beberapa menit lagi.' });
    }
    var previewPeriod = validateExportPeriod(e.parameter.start, e.parameter.end);
    if (!previewPeriod.valid) {
      return jsonOut({ status: 'error', message: previewPeriod.message });
    }
    var previewJenisList = normalizeHapusDataJenisList(e.parameter.jenis || '');
    if (!previewJenisList.length) {
      return jsonOut({ status: 'error', message: 'Pilih minimal satu jenis data.' });
    }
    var previewCounts = {};
    var previewTotal = 0;
    for (var pj = 0; pj < previewJenisList.length; pj++) {
      var pDef = HAPUS_DATA_JENIS[previewJenisList[pj]];
      var pCount = countRowsInRange(ss.getSheetByName(pDef.sheet), previewPeriod.start, previewPeriod.end);
      previewCounts[previewJenisList[pj]] = pCount;
      previewTotal += pCount;
    }
    return jsonOut({ status: 'success', periodeLabel: previewPeriod.label, counts: previewCounts, total: previewTotal });
  }

  return jsonOut({ status: 'active', message: 'SIGAP API Ready' });
}
function debugBannerData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Log_Gerbang');

  Logger.log('=== INFO DASAR ===');
  Logger.log('Sheet ditemukan: ' + (logSheet ? 'YA' : 'TIDAK'));
  if (!logSheet) return;
  Logger.log('Jumlah baris terisi (termasuk header): ' + logSheet.getLastRow());

  var now = new Date();
  var weekStart = startOfWeekServer(now);
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var bannerCutoff = weekStart < monthStart ? weekStart : monthStart;

  Logger.log('=== TANGGAL ===');
  Logger.log('now: ' + now);
  Logger.log('weekStart (Senin minggu ini): ' + weekStart);
  Logger.log('monthStart (awal bulan ini): ' + monthStart);
  Logger.log('bannerCutoff (yang dipakai): ' + bannerCutoff);

  Logger.log('=== ISI KOLOM TIMESTAMP MENTAH (5 BARIS PERTAMA & TERAKHIR) ===');
  var lastRow = logSheet.getLastRow();
  if (lastRow > 1) {
    var tsValues = logSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    Logger.log('Tipe data cell pertama: ' + (typeof tsValues[0][0]) + ' | isi: ' + tsValues[0][0]);
    Logger.log('5 timestamp PERTAMA di sheet: ' + JSON.stringify(tsValues.slice(0, 5)));
    Logger.log('5 timestamp TERAKHIR di sheet: ' + JSON.stringify(tsValues.slice(-5)));
  }

  Logger.log('=== HASIL getRowsSince() UNTUK BANNER ===');
  var raw = getRowsSince(logSheet, bannerCutoff, 6);
  Logger.log('Jumlah baris yang kembali: ' + raw.length);
  Logger.log('Contoh isi (maks 10 baris): ' + JSON.stringify(raw.slice(0, 10)));

  Logger.log('=== HASIL getRowsSince() UNTUK HARI INI (pembanding) ===');
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  var rawToday = getRowsSince(logSheet, todayStart, 6);
  Logger.log('Jumlah baris hari ini: ' + rawToday.length);
}
