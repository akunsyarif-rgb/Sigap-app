// ===== Code.gs (Main / Router) =====
// Titik masuk utama Web App: doPost dan doGet menangani semua permintaan
// dari index.html. Logika keamanan (checkToken, sesi) ada di Auth.gs/Utils.gs.

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
      // Cek lockout SEBELUM sentuh sheet sama sekali — lihat komentar
      // isLoginRateLimited() di Utils.gs kenapa ini global, bukan per-akun.
      if (isLoginRateLimited()) {
        return jsonOut({ status: 'error', message: 'Terlalu banyak percobaan login gagal. Coba lagi dalam beberapa menit.' });
      }

      var sheet = ss.getSheetByName('Master_Guru');
      var rows = sheet.getDataRange().getValues();

      var loggedInUser = null;
      var isDisabled = false;
      var matchedRowIndex = -1;
      var needsMigration = false;
      // Dikirim kalau guru memilih namanya lewat pencarian di layar login.
      // Kosong = mode legacy (password-only, tanpa pilih nama) yang SENGAJA
      // masih dipertahankan — lihat komentar isLoginRateLimited() di Utils.gs.
      var requestedTeacherId = String(data.teacherId || '').trim();
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
      // tidak banjir kalau ada percobaan brute-force beneran.
      var failCount = recordLoginFailure();
      if (failCount === LOGIN_RATE_MAX_FAILURES) {
        logAudit({ name: 'System', id: '-' }, 'Login Rate Limit Triggered', 'Lockout global aktif ' + (LOGIN_RATE_WINDOW_MS / 60000) + ' menit setelah ' + failCount + ' percobaan gagal');
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
      CacheService.getScriptCache().remove('log_gerbang_raw');
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
      // index di getSurat), menghapusnya akan menggeser
      // Dicatat_Oleh ke posisi Foto_URL dan mematahkan baris-baris lama
      // yang sudah terlanjur punya URL foto tersimpan.
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.jenis, data.keterangan || '', '', sessionUser.name]);
      CacheService.getScriptCache().remove('surat_list_raw');
      return jsonOut({ status: 'success' });
    }

    // ---- Hapus data surat per bulan/tahun (admin only) ----
    if (action === 'deleteSurat') {
      if (!isAdminRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Hanya admin yang bisa menghapus data surat' });
      }
      var sheet = ss.getSheetByName('Surat_Masuk');
      if (!sheet) {
        return jsonOut({ status: 'error', message: 'Belum ada data surat' });
      }
      var rows = sheet.getDataRange().getValues();
      var month = parseInt(data.month, 10);
      var year = parseInt(data.year, 10);
      var deletedCount = 0;
      for (var i = rows.length - 1; i >= 1; i--) {
        var ts = new Date(rows[i][0]);
        if ((ts.getMonth() + 1) === month && ts.getFullYear() === year) {
          sheet.deleteRow(i + 1);
          deletedCount++;
        }
      }
      CacheService.getScriptCache().remove('surat_list_raw');
      logAudit(sessionUser, 'Hapus Data Surat', deletedCount + ' data (bulan ' + month + '/' + year + ')');
      return jsonOut({ status: 'success', deletedCount: deletedCount });
    }

    // ---- Catat pelanggaran & sanksi (bukan untuk OSIS) ----
    if (action === 'addPelanggaran') {
      if (isOsisRole(sessionUser.role)) {
        return jsonOut({ status: 'error', message: 'Tidak punya akses untuk aksi ini.' });
      }
      var sheet = getOrCreateSheet(ss, 'Pelanggaran', ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh']);
      sheet.appendRow([new Date(), data.nisn, data.name, data.class_name, data.jenis_pelanggaran, data.sanksi, data.catatan || '', sessionUser.name]);
      CacheService.getScriptCache().remove('pelanggaran_list_raw');
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
      return jsonOut({ status: 'success' });
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

    return jsonOut({ status: 'error', message: 'Action tidak dikenali' });
    } finally {
      sigapLock.releaseLock();
    }

  } catch (error) {
    return jsonOut({ status: 'error', message: error.toString() });
  }
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

  // Status publik, tidak perlu sesi — dipakai untuk cek API hidup
  if (!action) {
    return jsonOut({ status: 'active', message: 'SIGAP API Ready' });
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

  // ---- getTodayData DIHAPUS (RBAC v1) ----
  // Endpoint ini mengembalikan SATU respons berisi seluruh keterlambatan,
  // surat (termasuk kolom keterangan: alasan sakit/izin) dan pelanggaran
  // (termasuk catatan naratif) hari ini se-sekolah, PLUS lateForBanner yang
  // berisi seluruh keterlambatan sejak awal minggu/bulan. Gerbangnya cuma
  // "bukan OSIS", jadi guru biasa menerima semuanya.
  //
  // Dihapus, bukan diberi filter scope, karena dua alasan yang berdiri
  // sendiri: (1) TIDAK ADA satu pun pemanggil di frontend — seluruh datanya
  // sudah disajikan getLogs/getSurat/getPelanggaran yang kini sudah
  // ber-scope; (2) respons ini di-cache GLOBAL dengan satu kunci untuk semua
  // orang, sehingga tidak mungkin dibuat per-pengguna tanpa membongkar
  // strategi cache-nya. Menyisakannya hidup tanpa perlindungan hanya karena
  // UI tidak memanggilnya persis pola yang dilarang aturan implementasi.
  //
  // Pemanggil lama (kalau ada klien pihak ketiga) akan jatuh ke respons
  // 'SIGAP API Ready' di akhir doGet, sama seperti action tak dikenal —
  // tidak ada data yang bocor. Kunci cache 'today_data' ikut tidak ditulis/
  // dibaca lagi di mana pun.

  // ---- Riwayat keterlambatan 1 siswa saja (untuk peringatan "sudah Nx
  // terlambat" di form Catat Terlambat) — on-demand per siswa yang dipilih.
  // Sekarang DI-SCOPE: riwayat keterlambatan tunduk pada aturan histori
  // (guru = OWN, wali kelas = CLASS ∪ OWN, BK/admin = SCHOOL), jadi baris
  // yang dikembalikan disaring dulu lewat isInReadScope(). Tanpa ini,
  // endpoint ini adalah jalur BOLA paling langsung: nisn dikirim mentah dari
  // client dan doGet tidak kena rate limit tulis, jadi seluruh riwayat
  // keterlambatan tiap siswa bisa ditarik satu per satu.
  //
  // Pengecualian "hari ini = SCHOOL" TIDAK berlaku di sini: ini endpoint
  // riwayat, bukan papan hari ini. Kebutuhan hari ini sudah dilayani getLogs. ----
  if (action === 'getStudentLateHistory') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var lateScope = getReadScope(sessionUser);
    var logSheet = ss.getSheetByName('Log_Gerbang');
    var history = logSheet ? getLateHistoryForStudent(logSheet, e.parameter.nisn) : [];
    if (lateScope.level !== 'school') {
      history = history.filter(function (h) { return isInReadScope(lateScope, h.class, h.logged_by); });
    }
    return jsonOut({ status: 'success', history: history });
  }

  // ---- Keterlambatan (bukan untuk OSIS) — dipakai Riwayat, Beranda,
  // Gerbang & Statistik.
  //
  // SCOPE RBAC v1 — dua aturan berbeda dalam SATU endpoint, sengaja tidak
  // dipecah jadi dua URL supaya API/kontrak frontend tidak berubah:
  //   * baris HARI INI  -> SCHOOL untuk semua role non-OSIS. Guru piket harus
  //     bisa melihat siapa saja yang sudah tercatat pagi ini, termasuk yang
  //     dicatat guru lain, tanpa dikaitkan ke jadwal mengajar.
  //   * baris HISTORI   -> guru = OWN, wali kelas = CLASS ∪ OWN, BK/admin =
  //     SCHOOL.
  // Jadi sebuah baris dikirim kalau (hari ini) ATAU (lolos isInReadScope).
  //
  // Cache diubah dari "respons jadi" menjadi ARRAY MENTAH (kunci baru
  // 'log_gerbang_raw' — lihat clearCacheForCategory di Utils.gs kenapa
  // kuncinya wajib ganti nama), lalu difilter per-pengguna SETELAH dibaca
  // dari cache. Pola ini sama persis dengan pelanggaran_list_raw dan
  // alasannya sama: kalau yang di-cache sudah difilter untuk satu orang,
  // pengguna berikutnya bisa menerima daftar milik orang lain. ----
  if (action === 'getLogs') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var logs;
    var cachedLogsRaw = cache.get('log_gerbang_raw');
    if (cachedLogsRaw) {
      logs = JSON.parse(cachedLogsRaw);
    } else {
      var sheet = ss.getSheetByName('Log_Gerbang');
      logs = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          logs.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], type: rows[i][4], logged_by: rows[i][5] });
        }
        logs.reverse();
      }
      cache.put('log_gerbang_raw', JSON.stringify(logs), 60);
    }
    var logScope = getReadScope(sessionUser);
    if (logScope.level !== 'school') {
      var todayNow = new Date();
      logs = logs.filter(function (l) {
        if (isSameDayServer(new Date(l.timestamp), todayNow)) return true;
        return isInReadScope(logScope, l.class, l.logged_by);
      });
    }
    return jsonOut({ status: 'success', logs: logs });
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

  // ---- Surat izin/sakit (bukan untuk OSIS).
  //
  // SCOPE RBAC v1: guru = OWN, wali kelas = CLASS ∪ OWN, BK/admin = SCHOOL.
  // TIDAK ada pengecualian "hari ini = SCHOOL" di sini — beda dari
  // keterlambatan, kontrak Surat tidak punya klausul hari ini, dan kolom
  // keterangan berisi alasan sakit/izin (data kesehatan siswa) yang justru
  // paling tidak layak disebar ke seluruh guru.
  //
  // Yang berhak (wali kelas & BK/Kesiswaan) tetap menerima keterangan LENGKAP
  // — tidak ada field yang dipangkas untuk mereka, hanya barisnya yang
  // disaring. Cache jadi array mentah dengan kunci baru, alasannya sama
  // seperti getLogs di atas. ----
  if (action === 'getSurat') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var surat;
    var cachedSuratRaw = cache.get('surat_list_raw');
    if (cachedSuratRaw) {
      surat = JSON.parse(cachedSuratRaw);
    } else {
      var sheet = ss.getSheetByName('Surat_Masuk');
      surat = [];
      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          surat.push({ timestamp: rows[i][0], nisn: rows[i][1], name: rows[i][2], class: rows[i][3], jenis: rows[i][4], keterangan: rows[i][5], foto_url: rows[i][6], logged_by: rows[i][7] });
        }
        surat.reverse();
      }
      cache.put('surat_list_raw', JSON.stringify(surat), 60);
    }
    var suratScope = getReadScope(sessionUser);
    if (suratScope.level !== 'school') {
      surat = surat.filter(function (sr) { return isInReadScope(suratScope, sr.class, sr.logged_by); });
    }
    return jsonOut({ status: 'success', surat: surat });
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
    // RBAC v1: guru = OWN, wali kelas = CLASS ∪ OWN, BK/admin = SCHOOL.
    // Sebelumnya percabangannya EKSKLUSIF (kalau wali kelas -> hanya kelasnya,
    // cabang logged_by tidak pernah jalan), sehingga wali kelas kehilangan
    // catatan yang DIA SENDIRI tulis untuk siswa kelas lain — termasuk hak
    // mengoreksinya dalam jendela 5 menit, karena barisnya tidak pernah muncul
    // di UI. isInReadScope() menggabungkan keduanya (UNION).
    var pelanggaranScope = getReadScope(sessionUser);
    if (pelanggaranScope.level !== 'school') {
      pelanggaran = pelanggaran.filter(function (p) { return isInReadScope(pelanggaranScope, p.class, p.logged_by); });
    }
    return jsonOut({ status: 'success', pelanggaran: pelanggaran });
  }

  // ---- Hitung pelanggaran seorang siswa — dipakai peringatan "sudah Nx
  // tercatat" saat mencatat pelanggaran baru. Tetap cuma mengirim ANGKA,
  // bukan daftar isinya (jenis/sanksi/siapa).
  //
  // SCOPE RBAC v1 — yang dihitung sekarang HANYA baris yang memang boleh
  // dilihat pemanggil: guru = OWN, wali kelas = CLASS ∪ OWN, BK/admin =
  // SCHOOL. Sebelumnya angkanya selalu total se-sekolah, dan itu membuat
  // endpoint ini jalur enumerasi paling murah di seluruh API: nisn dikirim
  // mentah dari client, seluruh daftar NISN sudah dibagikan getStudents, dan
  // doGet tidak melewati rate limit tulis — jadi guru biasa bisa memanggilnya
  // berulang kali untuk menyusun peta "NISN -> jumlah pelanggaran" seluruh
  // sekolah, persis ranking siswa bermasalah yang justru ingin dicegah.
  //
  // Dengan scope, NISN di luar jangkauan pemanggil selalu menghasilkan 0,
  // jadi memanipulasi parameter nisn tidak lagi membocorkan apa pun. Kolom
  // yang dibaca naik dari 1 (nisn saja) ke 7 (nisn..Dicatat_Oleh) karena
  // kelas & nama pencatat wajib ada untuk menegakkan scope — tetap SATU
  // panggilan getRange, jadi biaya Sheets API-nya tidak berubah. ----
  if (action === 'getPelanggaranCountForStudent') {
    if (isOsisRole(sessionUser.role)) return jsonOut({ status: 'error', message: 'Unauthorized' });
    var countScope = getReadScope(sessionUser);
    var sheet = ss.getSheetByName('Pelanggaran');
    var count = 0;
    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        // Kolom B..H = NISN, Nama, Kelas, Jenis, Sanksi, Catatan, Dicatat_Oleh
        // -> index 0 = nisn, index 2 = kelas, index 6 = dicatat_oleh.
        var pelanggaranRows = sheet.getRange(2, 2, lastRow - 1, 7).getValues();
        for (var i = 0; i < pelanggaranRows.length; i++) {
          if (String(pelanggaranRows[i][0]) !== String(e.parameter.nisn)) continue;
          if (!isInReadScope(countScope, pelanggaranRows[i][2], pelanggaranRows[i][6])) continue;
          count++;
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
  // - OSIS                 : seluruh sekolah, TAPI hanya untuk data upacara
  //                          DAN hanya field minimum (lihat di bawah). Semua
  //                          endpoint disiplin lain (getLogs, getSurat,
  //                          getPelanggaran, getBimbingan, getTindakLanjut)
  //                          tetap menolak OSIS seperti sebelumnya.
  // - guru wali kelas      : kelasnya sendiri GABUNG catatan yang dia tulis
  //                          sendiri (CLASS ∪ OWN) — dipakai kategori Upacara
  //                          di Rekap Kelas, supaya wali kelas tidak perlu
  //                          membuka menu Upacara cuma untuk tahu kondisi
  //                          anaknya.
  // - guru biasa           : OWN — hanya catatan yang dia tulis sendiri.
  //                          Praktisnya kosong selama addPelanggaranUpacara
  //                          masih dibatasi ke OSIS/BK/admin, tapi gerbangnya
  //                          dibuka supaya scope-nya konsisten dengan kontrak
  //                          ("OWN jika memang memiliki fungsi pencatatan")
  //                          dan tidak perlu diubah lagi kalau nanti guru
  //                          diberi hak mencatat. Membuka gerbang ini TIDAK
  //                          menambah data yang terlihat: isinya disaring
  //                          isInReadScope() dengan aturan OWN yang sama.
  if (action === 'getPelanggaranUpacara') {
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
    // OSIS melihat SELURUH rekap upacara — Rekap Upacara memang dimaksudkan
    // sebagai alat baca bersama untuk petugas upacara. Yang tidak berubah:
    // OSIS tetap terkunci dari semua kategori disiplin lain.
    //
    // TAPI OSIS hanya menerima FIELD MINIMUM: nisn dan catatan naratif
    // DIBUANG dari payloadnya. Untuk tugas OSIS (tahu siapa di kelas mana
    // melanggar apa, kapan) nama + kelas + jenis + waktu sudah cukup; nisn
    // adalah nomor induk yang tidak dipakai tampilan rekap, dan catatan
    // adalah teks bebas yang bisa berisi konteks pribadi siswa. Field ini
    // dipangkas DI SERVER, bukan disembunyikan di UI, jadi tidak pernah
    // sampai ke browser petugas OSIS.
    //
    // NISN TETAP dikirim di getStudents untuk OSIS — di sana nisn adalah
    // identitas yang ditulis addPelanggaranUpacara ke sheet, jadi
    // membuangnya akan mematahkan fungsi pencatatan upacara itu sendiri.
    // Yang tidak diperlukan adalah nisn pada jalur BACA rekap ini.
    var isOsisReader = isOsisRole(sessionUser.role);
    var upacaraScope = getReadScope(sessionUser);
    var lihatSemua = isOsisReader || upacaraScope.level === 'school';
    var upacara = [];
    for (var ui = 0; ui < upacaraRaw.length; ui++) {
      var u = upacaraRaw[ui];
      if (!lihatSemua && !isInReadScope(upacaraScope, u.class, u.logged_by)) {
        continue; // wali kelas: CLASS ∪ OWN — guru biasa: OWN
      }
      if (isOsisReader) {
        upacara.push({ timestamp: u.timestamp, name: u.name, class: u.class, jenis_pelanggaran: u.jenis_pelanggaran, logged_by: u.logged_by });
      } else {
        upacara.push({ timestamp: u.timestamp, nisn: u.nisn, name: u.name, class: u.class, jenis_pelanggaran: u.jenis_pelanggaran, catatan: u.catatan, logged_by: u.logged_by });
      }
    }
    return jsonOut({ status: 'success', upacara: upacara });
  }

  // ---- Audit Log (ADMIN ONLY) — jejak keamanan permanen.
  // Gerbangnya isAdminRole, BUKAN isBkRole: isBkRole bernilai true untuk
  // admin DAN bk_kesiswaan, sehingga sebelumnya BK/Kesiswaan ikut bisa
  // membaca 300 baris terakhir Audit Log — termasuk login/logout, reset
  // password, perubahan role, perubahan wali kelas, penghapusan data, dan
  // pemicu lockout brute-force. Kontrak RBAC v1 menetapkan Audit Log
  // ADMIN ONLY. Menu 'auditlog' juga sudah dicabut dari bk_kesiswaan di
  // config.js, tapi gerbang inilah yang menegakkannya.
  //
  // Ini SATU-SATUNYA jalur baca ke sheet Audit_Log di seluruh backend
  // (logAudit di Utils.gs hanya menulis) — tidak ada endpoint alternatif. ----
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
