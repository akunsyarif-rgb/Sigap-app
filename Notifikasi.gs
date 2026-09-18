// ===== NOTIFIKASI.gs =====
// Push Notification (Web Push standar W3C, VAPID) untuk SIGAP.
//
// KENAPA FILE TERPISAH: sama alasannya dengan Auth.gs terpisah dari Utils.gs
// — ini satu area tanggung jawab yang jelas (siapa yang dinotifikasi, kapan,
// dan bagaimana antreannya diproses), bukan sekadar helper lepas. Semua .gs
// di project ini berbagi satu scope global otomatis (lihat catatan di
// Utils.gs), jadi tidak perlu import apa pun dari sini.
//
// KENAPA TIDAK GAS YANG MENANDATANGANI & MENGIRIM WEB PUSH SENDIRI: mengirim
// Web Push yang sesungguhnya butuh (a) JWT VAPID ditandatangani ECDSA
// (P-256/ES256) untuk header Authorization, dan (b) payload dienkripsi AES-GCM
// lewat kunci yang disepakati ECDH dari subscription.keys (RFC 8291/8292).
// Apps Script (Utilities.computeDigest/computeHmacSha256Signature) TIDAK
// punya primitif ECDSA/ECDH/AES-GCM apa pun — hanya hash & HMAC. Memaksakan
// implementasi kripto itu di JS murni Apps Script berarti menulis ulang
// sendiri primitif kurva eliptik yang riskan salah dan sulit dirawat, jadi
// TIDAK dilakukan di sini (lihat audit di CLAUDE.md, bagian Push Notification).
//
// Pengiriman sesungguhnya didelegasikan ke satu fungsi serverless kecil di
// Vercel (`api/push-send.js`, project yang SAMA yang sudah meng-hosting
// frontend statis SIGAP — bukan vendor baru) yang memakai library `web-push`
// buat urusan kripto itu. GAS memanggilnya lewat UrlFetchApp dengan token
// rahasia sendiri (PUSH_RELAY_SECRET, Script Properties — TIDAK PERNAH di
// commit ke repo, sama seperti API_TOKEN). Kunci privat VAPID HANYA ada di
// environment variable Vercel; GAS dan repo ini tidak pernah menyentuhnya.
//
// SIAPA YANG DINOTIFIKASI (dihitung 100% server-side, lihat resolvePushRecipients
// di bawah) — HANYA dua kelompok, tidak lebih:
//   1. WALI KELAS aktif dari kelas siswa terkait (Master_Guru.Kelas_Wali,
//      dicocokkan lewat sameClass() yang sudah ada — SAMA case yang dipakai
//      izin/rekap, bukan mekanisme baru).
//   2. GURU PIKET yang BERTUGAS HARI KEJADIAN (Jadwal_Piket, dicocokkan
//      lewat hariPiketServer() yang sudah ada) — HANYA ketika ada tindakan
//      verifikasi nyata yang menunggu (event.needsPiketAction), bukan setiap
//      kali izin diajukan.
// BK/Kesiswaan, Admin, dan Guru Mapel biasa TIDAK PERNAH masuk salah satu
// kelompok di atas KECUALI mereka kebetulan Wali Kelas atau sedang piket hari
// itu berdasarkan DATA — persis prinsip izinKapasitasVerifikasi() yang sudah
// ada di Utils.gs (kapasitas dari data, bukan dari role permanen).

// ===== Sheet =====
var PUSH_SUBSCRIPTIONS_SHEET_NAME = 'Push_Subscriptions';
var PUSH_SUBSCRIPTIONS_HEADERS = ['Timestamp', 'Guru_ID', 'Endpoint', 'P256dh', 'Auth', 'User_Agent'];

var PUSH_QUEUE_SHEET_NAME = 'Push_Queue';
var PUSH_QUEUE_HEADERS = [
  'Timestamp', 'Event_ID', 'Jenis_Kejadian', 'NISN', 'Guru_ID',
  'Title', 'Body', 'Url', 'Tag', 'Priority',
  'Processed', 'Processed_At', 'Attempts', 'Last_Error',
  'Claim_Until', // kolom ke-15, lihat processPushQueue — klaim sementara saat fetch ke relay berjalan DI LUAR lock
];

// ===== Kelompok penerima =====
var PUSH_KIND_WALI = 'wali_kelas';
var PUSH_KIND_PIKET = 'guru_piket';

// ===== Idempotency & housekeeping antrean =====
// Jendela dedup 2 menit cukup untuk menyerap double-click/retry jaringan
// tanpa membuat notifikasi susulan yang sah (mis. verifikasi lalu tandai
// kembali beberapa menit kemudian) ikut terserap keliru — dua aksi itu
// jenis kejadiannya beda jadi Event_ID-nya juga beda, tidak akan pernah
// bentrok satu sama lain.
var PUSH_QUEUE_DEDUPE_WINDOW_MS = 2 * 60 * 1000;
// Antrean dikuras tiap menit (lihat processPushQueue), jadi tidak pernah
// tumbuh besar — memindai baris TERAKHIR saja (bukan seluruh sheet sejak
// awal) cukup untuk menangkap duplikat dan jauh lebih murah.
var PUSH_QUEUE_DEDUPE_SCAN_ROWS = 300;
var PUSH_QUEUE_BATCH_SIZE = 30; // maks baris diproses per tick trigger
var PUSH_QUEUE_MAX_ATTEMPTS = 6; // ~6 menit percobaan sebelum menyerah
// Klaim "sedang diproses" dipegang lebih lama dari interval trigger (1 menit)
// supaya fetch relay yang masih berjalan tidak direbut tick berikutnya, tapi
// cukup pendek supaya eksekusi yang mati di tengah jalan (crash/timeout GAS)
// pulih sendiri paling lambat 2 tick kemudian — tidak ada baris yang nyangkut
// "diklaim" selamanya, lihat processPushQueue.
var PUSH_QUEUE_CLAIM_TTL_MS = 90 * 1000;

// ================= EVENT NOTIFICATION ENGINE =================
// notifyRelevantUsers(event): SATU pintu masuk untuk semua titik pemicu di
// Code.gs (lihat pemanggilnya di action record/addPelanggaran/addSurat/
// addPelanggaranUpacara/addIzinKeluar/verifikasiIzinKeluar/
// tandaiKembaliIzinKeluar/tandaiPulangIzinKeluar/addIzinKelompok/
// verifikasiIzinKelompok/tandaiKembaliKelompok) — SENGAJA satu fungsi, bukan
// UrlFetchApp/appendRow disebar di tiap handler, supaya menambah titik
// notifikasi baru nanti tetap ikut pola yang sama (server menghitung
// penerima, privasi, idempotency) tanpa perlu diingat ulang tiap kali.
//
// event = {
//   jenis:            string, jenis kejadian (lihat pushSalinan di bawah)
//   nisn:             NISN siswa terkait (untuk bookkeeping/Audit, BUKAN
//                      sumber kelas — kelas WAJIB sudah di-resolve server)
//   kelas:             kelas siswa, HARUS sudah diambil dari Master_Siswa
//                      (resolveSiswaForIzin dkk.) — TIDAK PERNAH data.class_name
//                      dari klien. Kosong/']' = tidak ada wali kelas yang
//                      dicari (dipakai untuk event yang murni piket).
//   needsPiketAction: boolean — true HANYA saat status baru sungguh
//                      membutuhkan tindakan Guru Piket (verifikasi menunggu).
//   waktu:             Date kejadian (dipakai menentukan hari piket)
//   refId:             id unik kejadian ini untuk idempotency (ID_Izin/
//                      ID_Kelompok kalau ada; kalau tidak, boleh kosong dan
//                      nisn dipakai)
//   priority:          'high' | 'normal' (opsional, default 'normal')
// }
//
// TIDAK PERNAH throw — kegagalan di sini TIDAK BOLEH menggagalkan aksi utama
// (mencatat keterlambatan/izin dst. harus tetap sukses walau notifikasi
// gagal ditulis ke antrean), persis pola logAudit().
function notifyRelevantUsers(event) {
  try {
    if (!event) return;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recipients = resolvePushRecipients(ss, event);
    if (!recipients.length) return;

    var queueSheet = getOrCreateSheet(ss, PUSH_QUEUE_SHEET_NAME, PUSH_QUEUE_HEADERS);
    var now = event.waktu instanceof Date ? event.waktu : new Date();
    var refId = String(event.refId || event.nisn || '');

    // Event_ID dipakai sebagai kunci idempotency DAN sebagai tag notifikasi
    // klien (supaya OS mengganti notifikasi lama yang senasib, bukan
    // menumpuk) — jenis+refId+penerima+kelompok cukup unik per kejadian
    // nyata, dan STABIL kalau dipanggil ulang untuk kejadian yang sama.
    var eventIds = recipients.map(function (r) {
      return String(event.jenis) + '|' + refId + '|' + r.guruId + '|' + r.kind;
    });
    // SATU scan tail Push_Queue untuk SEMUA penerima sekaligus (audit
    // performa September 2026) — sebelumnya pushEventAlreadyQueued() dipanggil
    // per penerima di dalam loop, jadi N penerima = N pemindaian tail terpisah
    // untuk kejadian yang sama. pushEventsAlreadyQueued() membaca tail SEKALI
    // dan mencocokkan semua eventId yang dicari terhadapnya, hasilnya identik
    // (baris mana pun yang dulu dianggap duplikat tetap dianggap duplikat).
    var already = pushEventsAlreadyQueued(queueSheet, eventIds, now);

    // Baris yang tidak duplikat dikumpulkan dulu, ditulis lewat SATU
    // appendRowsBatch() di akhir (audit performa September 2026) —
    // sebelumnya appendRow() per penerima berarti N penerima = N panggilan
    // API tulis terpisah, sama seperti alasan writeIzinRowsBatch/
    // appendRowsBatch dipakai di tempat lain. Urutan & isi tiap baris tidak
    // berubah, cuma cara menulisnya.
    var rowsToAppend = [];
    for (var i = 0; i < recipients.length; i++) {
      var r = recipients[i];
      var eventId = eventIds[i];
      if (already[eventId]) continue;

      var salinan = pushSalinan(event.jenis, r.kind);
      var url = pushDeepLink(r.kind);
      rowsToAppend.push([
        now, eventId, String(event.jenis || ''), String(event.nisn || ''), r.guruId,
        salinan.title, salinan.body, url, eventId, event.priority || 'normal',
        false, '', 0, '',
      ]);
    }
    appendRowsBatch(queueSheet, rowsToAppend);
  } catch (err) {
    // Diamkan — lihat catatan "TIDAK PERNAH throw" di atas.
  }
}

// ===== Penerima: Wali Kelas + Guru Piket, murni dari data server =====
//
// Master_Guru dibaca PALING BANYAK SEKALI per panggilan, lewat getGuruRows()
// di bawah (audit performa September 2026) — sebelumnya dibaca dua kali
// terpisah dalam satu request yang sama: sekali di sini (untuk cari wali
// kelas), sekali lagi di dalam getPiketAktifHariIni (untuk cari guru aktif).
// getGuruRows() bersifat malas (baru benar-benar getRange() saat pertama kali
// dipanggil) dan hasilnya dibagikan ke getPiketAktifHariIni lewat parameter —
// jadi kejadian yang tidak sekelas ATAU tidak butuh notifikasi piket tetap
// tidak membaca Master_Guru sama sekali, persis seperti sebelumnya.
function resolvePushRecipients(ss, event) {
  var recipients = [];
  var seen = {};
  function add(guruId, kind) {
    var id = String(guruId || '').trim();
    if (!id) return;
    var key = id + '|' + kind;
    if (seen[key]) return;
    seen[key] = true;
    recipients.push({ guruId: id, kind: kind });
  }

  var guruRowsCache = null;
  function getGuruRows() {
    if (guruRowsCache === null) {
      var guruSheet = ss.getSheetByName('Master_Guru');
      var lastRow = guruSheet ? guruSheet.getLastRow() : 0;
      guruRowsCache = lastRow > 1 ? guruSheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];
    }
    return guruRowsCache;
  }

  var kelas = String(event.kelas || '').trim();
  if (kelas) {
    var rows = getGuruRows();
    for (var i = 0; i < rows.length; i++) {
      var status = String(rows[i][5] || '').toLowerCase().trim();
      var kelasWali = String(rows[i][6] || '').trim();
      if (status === 'nonaktif' || !kelasWali) continue;
      if (sameClass(kelasWali, kelas)) add(rows[i][0], PUSH_KIND_WALI);
    }
  }

  if (event.needsPiketAction) {
    var piketIds = getPiketAktifHariIni(ss, event.waktu instanceof Date ? event.waktu : new Date(), getGuruRows());
    for (var p = 0; p < piketIds.length; p++) add(piketIds[p], PUSH_KIND_PIKET);
  }

  return recipients;
}

// Guru piket yang bertugas pada HARI kejadian (bukan hari ini saat antrean
// diproses — event.waktu dipakai apa adanya, jadi kalau suatu saat antrean
// sempat tertunda lewat tengah malam, hari yang dipakai tetap hari kejadian
// sesungguhnya) DAN masih berstatus aktif di Master_Guru. Jadwal_Piket yang
// berubah SEBELUM baris ini dipanggil langsung mengubah siapa yang dicari —
// tidak ada cache terpisah untuk daftar piket di sini.
//
// guruRows diterima lewat PARAMETER, bukan dibaca ulang di sini (lihat
// getGuruRows() di resolvePushRecipients) — kolom yang dipakai (ID di indeks
// 0, Status di indeks 5) tetap ada di 8 kolom yang dibaca di sana, jadi tidak
// ada data yang hilang dibanding pembacaan 6-kolom yang dulu dilakukan
// terpisah di sini.
function getPiketAktifHariIni(ss, now, guruRows) {
  var sheet = ss.getSheetByName('Jadwal_Piket');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var hari = hariPiketServer(now);
  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  var activeIds = {};
  var gRows = guruRows || [];
  for (var g = 0; g < gRows.length; g++) {
    if (String(gRows[g][5] || '').toLowerCase().trim() !== 'nonaktif') {
      activeIds[String(gRows[g][0]).trim()] = true;
    }
  }

  var ids = [];
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== hari) continue;
    var id = String(rows[i][1]).trim();
    if (id && activeIds[id] && !seen[id]) {
      seen[id] = true;
      ids.push(id);
    }
  }
  return ids;
}

// ===== Salinan notifikasi (privasi: lihat prinsip di CLAUDE.md) =====
// Judul SELALU "SIGAP" polos — lock screen tidak pernah menyebut jenis
// kejadian di judul. Body untuk kejadian yang jelas TIDAK sensitif (kehadiran/
// administrasi izin) boleh menyebut jenisnya secara ringkas; kejadian yang
// berpotensi sensitif (pelanggaran & semua jenis yang belum eksplisit
// terdaftar di bawah) SENGAJA jatuh ke teks generik lewat `default` — supaya
// menambah jenis kejadian baru nanti tidak bisa lupa membuatnya generik,
// developer harus SENGAJA menambahkan case eksplisit kalau mau teks yang
// lebih spesifik.
function pushSalinan(jenis, kind) {
  if (kind === PUSH_KIND_PIKET) {
    return { title: 'SIGAP', body: 'Izin siswa menunggu verifikasi. Buka SIGAP untuk memproses.' };
  }
  switch (String(jenis || '')) {
    case 'keterlambatan':
      return { title: 'SIGAP', body: 'Ada siswa di kelas Anda tercatat terlambat hari ini.' };
    case 'surat':
      return { title: 'SIGAP', body: 'Ada catatan surat baru untuk siswa di kelas Anda.' };
    case 'izin_dibuat':
      return { title: 'SIGAP', body: 'Izin keluar diajukan untuk siswa di kelas Anda.' };
    case 'izin_diverifikasi':
      return { title: 'SIGAP', body: 'Status izin keluar siswa di kelas Anda telah diperbarui.' };
    case 'izin_kembali':
      return { title: 'SIGAP', body: 'Siswa di kelas Anda tercatat sudah kembali ke sekolah.' };
    case 'izin_pulang':
      return { title: 'SIGAP', body: 'Siswa di kelas Anda tercatat pulang melalui jalur izin.' };
    default:
      // Pelanggaran, Pelanggaran Upacara, dan jenis lain apa pun jatuh ke
      // sini — generik dengan sengaja, lihat komentar di atas fungsi ini.
      return { title: 'SIGAP', body: 'Terdapat kejadian baru terkait salah satu siswa di kelas Anda.' };
  }
}

// Target deep-link: token pendek yang dibaca frontend (lihat notifikasi.js /
// app.js, parameter `?goto=`) — BUKAN url lengkap, dan BUKAN pintu pintas
// otorisasi. Menekan notifikasi cuma memindahkan tab yang ditampilkan; sesi &
// RBAC tetap diperiksa ulang sepenuhnya oleh setiap fetch yang sudah ada.
function pushDeepLink(kind) {
  return kind === PUSH_KIND_PIKET ? 'izin' : 'log';
}

// ===== Idempotency: cegah baris antrean ganda untuk kejadian yang sama =====
// Memeriksa BANYAK eventId sekaligus lewat SATU pemindaian tail Push_Queue
// (audit performa September 2026) — sebelumnya ini dipanggil satu-per-satu di
// dalam loop penerima (pushEventAlreadyQueued(queueSheet, eventId, now)),
// jadi N penerima = N pemindaian tail terpisah untuk kejadian yang sama.
// Hasilnya identik: sebuah eventId dianggap "sudah diantrekan" kalau ada
// baris dengan Event_ID yang sama dalam jendela dedup PUSH_QUEUE_DEDUPE_WINDOW_MS
// terakhir — logika itu tidak berubah, cuma dijalankan sekali untuk semua
// eventId yang dicari, bukan diulang per eventId.
// Return: objek { eventId: true, ... } berisi eventId yang sudah diantrekan.
function pushEventsAlreadyQueued(queueSheet, eventIds, now) {
  var result = {};
  if (!eventIds || !eventIds.length) return result;
  var lastRow = queueSheet.getLastRow();
  if (lastRow <= 1) return result;
  var scanRows = Math.min(lastRow - 1, PUSH_QUEUE_DEDUPE_SCAN_ROWS);
  var startRow = lastRow - scanRows + 1;
  var values = queueSheet.getRange(startRow, 1, scanRows, 2).getValues(); // Timestamp, Event_ID
  var nowMs = now.getTime();
  var wanted = {};
  for (var i = 0; i < eventIds.length; i++) wanted[eventIds[i]] = true;
  for (var j = 0; j < values.length; j++) {
    var eid = String(values[j][1]);
    if (!wanted[eid] || result[eid]) continue;
    var ts = values[j][0] instanceof Date ? values[j][0].getTime() : new Date(values[j][0]).getTime();
    if (nowMs - ts < PUSH_QUEUE_DEDUPE_WINDOW_MS) result[eid] = true;
  }
  return result;
}

// ================= SUBSCRIPTION (device) =================
// Satu baris = satu subscription (satu browser/perangkat). Kunci alaminya
// Endpoint (URL unik per subscription yang diberikan browser) — upsert lewat
// itu, BUKAN lewat Guru_ID, supaya kalau perangkat yang sama dipakai login
// bergantian (mis. HP bersama di ruang piket), subscription otomatis
// berpindah kepemilikan ke sesi yang SEDANG login, bukan menumpuk baris basi
// atas nama akun sebelumnya.
function savePushSubscriptionForUser(ss, guruId, endpoint, p256dh, authKey, userAgent) {
  var sheet = getOrCreateSheet(ss, PUSH_SUBSCRIPTIONS_SHEET_NAME, PUSH_SUBSCRIPTIONS_HEADERS);
  var lastRow = sheet.getLastRow();
  var now = new Date();
  if (lastRow > 1) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][2]) === endpoint) {
        sheet.getRange(i + 2, 1, 1, 6).setValues([[now, guruId, endpoint, p256dh, authKey, userAgent || '']]);
        return;
      }
    }
  }
  sheet.appendRow([now, guruId, endpoint, p256dh, authKey, userAgent || '']);
}

// Hanya menghapus baris yang BENAR-BENAR milik guruId ini — endpoint milik
// pengguna lain (kalaupun ditebak/dikirim) tidak pernah ikut terhapus, dan
// tidak ada bedanya balasannya (tidak membocorkan kepemilikan endpoint ke
// pemanggil yang bukan pemiliknya).
function deletePushSubscriptionForUser(ss, guruId, endpoint) {
  var sheet = ss.getSheetByName(PUSH_SUBSCRIPTIONS_SHEET_NAME);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][2]) === endpoint && String(rows[i][1]) === String(guruId)) {
      sheet.deleteRow(i + 2);
    }
  }
}

// Dipakai processPushQueue untuk membersihkan subscription yang dilaporkan
// sudah tidak berlaku (404/410 dari layanan push saat relay mencoba
// mengirim) — dibersihkan lewat Endpoint saja (bukan per-user), karena pada
// titik ini kita sudah tahu dari relay bahwa endpoint itu memang sudah mati,
// terlepas dia sekarang tercatat milik siapa.
function removePushSubscriptionsByEndpoint(sheet, endpoints) {
  if (!sheet || !endpoints || !endpoints.length) return;
  var wanted = {};
  for (var e = 0; e < endpoints.length; e++) wanted[endpoints[e]] = true;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (wanted[String(rows[i][2])]) sheet.deleteRow(i + 2);
  }
}

// ================= PROSES ANTREAN (dipanggil trigger waktu, tiap 1 menit) =================
// TIDAK dipanggil dari doPost/doGet — dijalankan lewat time-based trigger
// yang dipasang SEKALI lewat installPushQueueTrigger() (jalankan manual dari
// editor Apps Script, lihat CLAUDE.md). Ini yang membuat penulisan baris
// keterlambatan/izin/dst. TIDAK PERNAH menunggu jaringan ke Vercel — enqueue
// di notifyRelevantUsers() di atas murni tulis sheet lokal (cepat, sudah di
// dalam lock yang sama dengan aksi utamanya), pengiriman sungguhan terjadi
// terpisah di sini.
//
// TIGA fase, DUA lock terpisah — bukan satu lock yang dipegang dari awal
// sampai akhir (audit lock scope, September 2026: sebelumnya UrlFetchApp.fetch
// ke relay Vercel ada DI DALAM lock yang sama dengan sigapLock di doPost —
// kalau relay lambat/hang, satu tick bisa menahan lock+slot eksekusi jauh
// lebih lama dari 6-20 detik biasa, menyaingi record/addTerlambat/deleteRecord
// dkk. yang semuanya lewat sigapLock yang SAMA. Pola ini SUDAH dipakai di
// tempat lain di project — lihat catatan pelepasan lock awal QR yang dihapus
// di CLAUDE.md — cuma belum pernah diterapkan di sini):
//   1) DI DALAM lock (singkat): baca antrean, KLAIM kandidat (Claim_Until =
//      sekarang + PUSH_QUEUE_CLAIM_TTL_MS) supaya tick lain yang mungkin
//      overlap tidak ikut mengirim baris yang sama, lalu lepas lock.
//   2) DI LUAR lock: UrlFetchApp.fetch() ke relay — jaringan boleh lambat
//      tanpa menahan aksi tulis lain (record/addTerlambat/deleteRecord/dst.)
//      yang berebut sigapLock yang sama.
//   3) DI DALAM lock lagi (singkat): tulis hasil akhir (Processed/Attempts/
//      Last_Error) + bersihkan Claim_Until.
// Kalau lock ke-3 gagal didapat (waitLock timeout), TIDAK ada data hilang:
// baris tetap berstatus "diklaim" apa adanya (fetch sudah terlanjur jalan,
// hasilnya cuma tidak sempat dicatat) dan klaim itu KEDALUWARSA sendiri
// setelah PUSH_QUEUE_CLAIM_TTL_MS — tick berikutnya otomatis mencoba lagi,
// tidak pernah nyangkut selamanya. Kemungkinan kirim dobel akibat retry ini
// aman: klien memakai Event_ID yang sama sebagai `tag` notifikasi, jadi OS
// mengganti notifikasi lama yang senasib, bukan menumpuk (lihat komentar
// eventIds di notifyRelevantUsers di atas).
function processPushQueue() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queueSheet = ss.getSheetByName(PUSH_QUEUE_SHEET_NAME);
  if (!queueSheet) return;
  var subSheet = ss.getSheetByName(PUSH_SUBSCRIPTIONS_SHEET_NAME);

  // ---- Fase 1: klaim kandidat, di dalam lock singkat ----
  var candidates = [];
  var lock1 = LockService.getScriptLock();
  try {
    lock1.waitLock(5000);
  } catch (lockErr) {
    return; // sedang dipakai (mis. tick sebelumnya belum selesai) — coba lagi tick berikutnya
  }
  try {
    var lastRow = queueSheet.getLastRow();
    if (lastRow <= 1) return;
    var numRows = lastRow - 1;
    var data = queueSheet.getRange(2, 1, numRows, PUSH_QUEUE_HEADERS.length).getValues();
    var subLastRow = subSheet ? subSheet.getLastRow() : 0;
    var subs = subLastRow > 1 ? subSheet.getRange(2, 1, subLastRow - 1, 6).getValues() : [];
    var nowMs = new Date().getTime();

    for (var i = 0; i < data.length && candidates.length < PUSH_QUEUE_BATCH_SIZE; i++) {
      var row = data[i];
      if (row[10] === true) continue; // Processed
      var claimUntilRaw = row[14];
      var claimUntilMs = claimUntilRaw instanceof Date ? claimUntilRaw.getTime()
        : (claimUntilRaw ? new Date(claimUntilRaw).getTime() : 0);
      if (claimUntilMs && claimUntilMs > nowMs) continue; // masih diklaim tick lain yang belum kedaluwarsa
      var sheetRow = i + 2;
      var guruId = String(row[4]);
      var matchSubs = [];
      for (var s = 0; s < subs.length; s++) {
        if (String(subs[s][1]) === guruId) {
          matchSubs.push({ endpoint: subs[s][2], p256dh: subs[s][3], auth: subs[s][4] });
        }
      }
      if (!matchSubs.length) {
        // Guru ini belum/tidak lagi punya perangkat terdaftar — tidak ada
        // yang bisa dikirimi, tandai selesai supaya tidak diperiksa ulang
        // tiap tick selamanya. Ini penulisan FINAL (tidak butuh fase 3),
        // tidak ada fetch jaringan yang terlibat sama sekali.
        queueSheet.getRange(sheetRow, 11, 1, 5).setValues([[true, new Date(), row[12], 'no_subscription', '']]);
        continue;
      }
      candidates.push({ sheetRow: sheetRow, subs: matchSubs, payload: { title: row[5], body: row[6], url: row[7], tag: row[8] } });
    }
    if (!candidates.length) return;

    // Tandai KLAIM (belum final) — supaya tick lain yang overlap tidak ikut
    // memilih baris yang sama selagi fetch di fase 2 berjalan di luar lock.
    var claimUntil = new Date(nowMs + PUSH_QUEUE_CLAIM_TTL_MS);
    for (var k = 0; k < candidates.length; k++) {
      queueSheet.getRange(candidates[k].sheetRow, 15).setValue(claimUntil);
    }
  } finally {
    lock1.releaseLock();
  }

  // ---- Fase 2: fetch ke relay Vercel, DI LUAR lock ----
  var relayUrl = PropertiesService.getScriptProperties().getProperty('PUSH_RELAY_URL');
  var relaySecret = PropertiesService.getScriptProperties().getProperty('PUSH_RELAY_SECRET');
  if (!relayUrl || !relaySecret) {
    // Relay belum dikonfigurasi (lihat CLAUDE.md, langkah setup Vercel) —
    // tambah percobaan, JANGAN ditandai selesai, supaya begitu env var-nya
    // diisi, antrean yang masih dalam batas percobaan otomatis terkirim
    // tanpa perlu menulis ulang. Tidak ada fetch di jalur ini, tapi
    // penulisannya TETAP lewat lock (fase 3) — bukan pengecualian.
    pushFinalizeUnderLock(queueSheet, candidates, null, 'relay_not_configured', null);
    return;
  }

  var items = [];
  for (var c = 0; c < candidates.length; c++) {
    for (var d = 0; d < candidates[c].subs.length; d++) {
      items.push({
        candidateIndex: c,
        endpoint: candidates[c].subs[d].endpoint,
        subscription: { endpoint: candidates[c].subs[d].endpoint, keys: { p256dh: candidates[c].subs[d].p256dh, auth: candidates[c].subs[d].auth } },
        payload: candidates[c].payload,
      });
    }
  }

  var response;
  try {
    response = UrlFetchApp.fetch(relayUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + relaySecret },
      payload: JSON.stringify({ items: items.map(function (it) { return { endpoint: it.endpoint, subscription: it.subscription, payload: it.payload }; }) }),
      muteHttpExceptions: true,
    });
  } catch (fetchErr) {
    pushFinalizeUnderLock(queueSheet, candidates, null, 'relay_unreachable', null);
    return;
  }

  var results = [];
  try {
    var parsed = JSON.parse(response.getContentText());
    results = parsed && parsed.results ? parsed.results : [];
  } catch (parseErr) {
    results = [];
  }

  var candidateOk = {};
  var goneEndpoints = [];
  for (var r = 0; r < results.length; r++) {
    var item = items[r];
    if (!item) continue;
    if (results[r] && results[r].ok) candidateOk[item.candidateIndex] = true;
    else if (results[r] && results[r].gone) goneEndpoints.push(item.endpoint);
  }

  // ---- Fase 3: tulis hasil akhir, di dalam lock singkat lagi ----
  pushFinalizeUnderLock(queueSheet, candidates, candidateOk, null, { subSheet: subSheet, goneEndpoints: goneEndpoints });
}

// Membungkus fase 3 (lock2 + tulis hasil akhir) — dipakai dari SEMUA jalur
// keluar fase 2 (relay tidak dikonfigurasi, relay tak terjangkau, atau respons
// relay sungguhan), supaya tidak ada satu pun jalur yang menulis ke sheet
// tanpa lock. Kalau lock2 gagal didapat, TIDAK ada data hilang: klaim fase 1
// kedaluwarsa sendiri (PUSH_QUEUE_CLAIM_TTL_MS), baris ini otomatis dicoba
// lagi tick berikutnya begitu klaim itu lewat — aman untuk dikirim dobel
// (lihat catatan Event_ID/tag di atas processPushQueue).
function pushFinalizeUnderLock(queueSheet, candidates, candidateOk, errorLabelForAll, goneInfo) {
  var lock2 = LockService.getScriptLock();
  try {
    lock2.waitLock(5000);
  } catch (lockErr) {
    return;
  }
  try {
    pushFinalizeCandidates(queueSheet, candidates, candidateOk, errorLabelForAll);
    if (goneInfo && goneInfo.goneEndpoints && goneInfo.goneEndpoints.length && goneInfo.subSheet) {
      removePushSubscriptionsByEndpoint(goneInfo.subSheet, goneInfo.goneEndpoints);
    }
  } finally {
    lock2.releaseLock();
  }
}

// Menulis hasil akhir untuk satu batch kandidat SEKALIGUS membersihkan
// Claim_Until (kolom 15) supaya tidak ada baris yang nyangkut berstatus
// "diklaim" walau sebenarnya sudah beres (atau sudah gagal permanen).
// SELALU dipanggil dari dalam lock2 (lewat pushFinalizeUnderLock) — tidak
// ada jalur langsung ke sheet di luar lock mana pun.
//   - candidateOk === null → semua kandidat gagal karena SATU errorLabel yang
//     sama (relay belum dikonfigurasi / relay tidak terjangkau) — dipakai
//     untuk pengganti pushIncrementAttempts() yang lama.
//   - candidateOk !== null → hasil per kandidat dari respons relay (indeks
//     kandidat yang ok dikirim, sisanya dianggap gagal kirim).
function pushFinalizeCandidates(queueSheet, candidates, candidateOk, errorLabelForAll) {
  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i];
    var ok = candidateOk ? candidateOk[i] : false;
    if (ok) {
      queueSheet.getRange(cand.sheetRow, 11, 1, 2).setValues([[true, new Date()]]);
      queueSheet.getRange(cand.sheetRow, 15).setValue('');
      continue;
    }
    var errorLabel = errorLabelForAll || 'send_failed';
    var attempts = (Number(queueSheet.getRange(cand.sheetRow, 13).getValue()) || 0) + 1;
    if (attempts >= PUSH_QUEUE_MAX_ATTEMPTS) {
      queueSheet.getRange(cand.sheetRow, 11, 1, 5).setValues([[true, new Date(), attempts, 'max_attempts', '']]);
    } else {
      queueSheet.getRange(cand.sheetRow, 13, 1, 2).setValues([[attempts, errorLabel]]);
      queueSheet.getRange(cand.sheetRow, 15).setValue('');
    }
  }
}

// ===== Setup trigger (jalankan SEKALI manual dari editor Apps Script) =====
// Tidak dipanggil otomatis dari mana pun (trigger adalah setelan project,
// bukan kode — clasp push tidak memasangnya). Idempotent: memeriksa trigger
// yang sudah ada dulu supaya menjalankan fungsi ini berkali-kali tidak
// memasang banyak trigger duplikat yang masing-masing memproses antrean yang
// sama.
function installPushQueueTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processPushQueue') return 'sudah terpasang';
  }
  ScriptApp.newTrigger('processPushQueue').timeBased().everyMinutes(1).create();
  return 'trigger terpasang';
}
