# Audit Kecepatan SIGAP — Proposal Backend (Fase 3)

Lanjutan dari audit jalur simpan `action === 'record'` (Catat Terlambat).
Fase 1 = static analysis. Fase 2 = optimistic UI frontend (sudah merge).
Ini Fase 3: **USULAN backend saja — TIDAK di-push ke `.gs` manapun.** Semua
diff di bawah siap copy-paste ke editor Apps Script, tapi HANYA kalau kamu
yang deploy manual (lihat CLAUDE.md — tidak ada jalur di repo ini yang
men-deploy `.gs` otomatis).

## Soal akurasi angka ms di dokumen ini

Data `Debug_Timing` (4 sampel, dibaca dari sheet Debug_Timing sebelum
direvert) **tercemar overhead nulis-dirinya-sendiri** — tiap `debugTimingLog()`
adalah `getOrCreateSheet + appendRow` juga, jadi ikut kepakai waktu (~150-550ms
per panggilan) dan kepotong ke gap CHECKPOINT BERIKUTNYA, bukan checkpoint-nya
sendiri. Angka ms di proposal ini karena itu **estimasi dari static analysis
Fase 1 (asumsi konservatif per jenis operasi), diarahkan oleh besar-kecilnya
gap yang kebaca di Fase 2b** — bukan klaim presisi milidetik. Yang bisa
dipegang: **urutan besar-kecil gap** (notify-chain jauh paling besar, ~1095ms
rata-rata dari 4 sampel vs ~470-420ms untuk dua tahap lain) tetap valid
walau angka absolutnya bias ke atas.

## Ringkasan urutan prioritas

| # | Perubahan | Prioritas | Mengurangi apa | Risiko |
|---|---|---|---|---|
| 1 | `resolveSiswaForIzin` pakai cache `students_list` yang sudah ada | **Tinggi** | Latensi REQUEST ITU SENDIRI | Rendah — reuse cache+invalidasi yang sudah ada, sudah battle-tested untuk `getStudents` |
| 2 | Lepas `sigapLock` sebelum notify-chain (split-lock) | **Tinggi** | Antrean guru LAIN saat jam rame — **BUKAN** latensi request itu sendiri | Sedang — nyentuh struktur lock bersama di `doPost`, tapi didesain supaya action lain tidak berubah sama sekali |
| 3 | Cek duplikat (`record`) pakai cache `today_logs` dulu, fallback ke `getRowsSince` | **Sedang** | Latensi REQUEST ITU SENDIRI, khususnya saat banyak simpan berturut-turut (jam piket pagi) | Rendah — reuse cache+invalidasi yang sudah ada, fallback identik ke perilaku sekarang kalau cache miss |

---

## Proposal 1 (Prioritas TINGGI): `resolveSiswaForIzin` reuse cache `students_list`

### Alasan terukur

`resolveSiswaForIzin` (dipanggil di `record` DAN di semua aksi Izin
Keluar/Kelompok) sekarang selalu `getRange(2,1,lastRow-1,3).getValues()` —
FULL SCAN Master_Siswa (~1296 baris per catatan CLAUDE.md), setiap kali
dipanggil. Estimasi Fase 1: 400-700ms per panggilan, KONSTAN (gak nyambung ke
"makin banyak transaksi" tapi tetap mahal tiap kali). Data Fase 2b (gap
`appendRow → notify`, yang MENCAKUP baris ini + notifyRelevantUsers)
rata-rata 1095ms — ini salah satu dari dua penyumbang utamanya.

`getStudents` (`doGet`) SUDAH punya cache identik untuk data yang SAMA PERSIS
(`students_list`, key `{nisn, name, class}`, TTL 300 detik) — sudah
di-invalidate dengan benar di TIGA titik tulis Master_Siswa yang ada
(`addStudent`, `verifyStudent`, `deleteStudent` — cek `grep -n
"students_list" Code.gs`, semua 3 titik sudah `cache.remove('students_list')`).
Tinggal KONSUMSI cache yang sama, tidak perlu key/invalidasi baru sama
sekali — staleness yang diwarisi (maks 5 menit) PERSIS sama dengan yang
sudah diterima untuk fitur pencarian siswa, bukan risiko baru.

Pada cache HIT: `resolveSiswaForIzin` jadi murni scan array JS (bukan
panggilan Sheets API) — benchmark Fase 1 (1300 baris, scan linear JS):
**0.05ms**, praktis nol dibanding 400-700ms baca Sheet. Pada cache MISS:
fallback ke pembacaan Sheet PERSIS seperti sekarang — nol regresi.

### Diff (Utils.gs)

Cari fungsi `resolveSiswaForIzin` (dekat komentar "Identitas siswa diambil
dari Master_Siswa, BUKAN dari yang dikirim klien"):

```diff
 function resolveSiswaForIzin(ss, nisn) {
   var target = String(nisn || '').trim();
   if (!target) return null;
+  // Cache HIT: 'students_list' sudah berisi SEMUA siswa (dipakai getStudents,
+  // TTL 300 detik, sudah di-invalidate benar di addStudent/verifyStudent/
+  // deleteStudent -- lihat AUDIT_BACKEND_PROPOSAL.md Proposal 1). Kalau
+  // ketemu di cache, hasilnya SAH langsung dipakai -- cache ini berisi
+  // seluruh Master_Siswa tanpa filter apa pun, jadi "tidak ketemu di cache"
+  // juga berarti sah "tidak ketemu di sheet", TIDAK perlu fallback baca
+  // sheet lagi untuk kasus itu.
+  var cachedStudents = CacheService.getScriptCache().get('students_list');
+  if (cachedStudents) {
+    try {
+      var parsedStudents = JSON.parse(cachedStudents);
+      var studentList = parsedStudents && parsedStudents.students;
+      if (Array.isArray(studentList)) {
+        for (var c = 0; c < studentList.length; c++) {
+          if (String(studentList[c].nisn).trim() === target) {
+            return { nisn: String(studentList[c].nisn).trim(), name: String(studentList[c].name), class: String(studentList[c].class) };
+          }
+        }
+        return null;
+      }
+    } catch (parseErr) {
+      // Cache korup -- lanjut ke fallback baca sheet di bawah, jangan gagal diam-diam.
+    }
+  }
+  // Fallback (cache kosong/miss/korup): baca langsung dari sheet, PERSIS
+  // perilaku lama -- tidak ada regresi kalau cache belum/tidak terisi.
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
```

### Risiko

- Staleness maksimum 5 menit (TTL `students_list`) — SAMA dengan yang sudah
  diterima untuk `getStudents`, bukan tradeoff baru. Siswa yang barusan
  ditambah/dipindah kelas lewat app tetap benar (3 titik tulis sudah
  invalidate cache-nya); siswa yang diedit LANGSUNG di Sheet (di luar app)
  bisa nyangkut sampai 5 menit — persis kondisi yang sudah diterima sekarang
  untuk fitur cari siswa.
- Fungsi ini dipakai fitur Izin Keluar juga (kelas dipakai untuk scope
  RBAC baca izin) — staleness yang sama berlaku, tapi ini BUKAN privilege
  escalation: kalau cache basi, hasilnya paling "kelas siswa keliru selama
  <=5 menit setelah dipindah lewat app", bukan "siapa saja bisa baca kelas
  siapa saja".
- Kalau `CacheService.put()` untuk `students_list` gagal (payload >100KB,
  sudah ditangani try/catch di `getStudents`), `resolveSiswaForIzin` otomatis
  selalu fallback ke Sheet — tidak ada mode gagal baru.

### Verifikasi setelah deploy

1. Buka SIGAP, tunggu ~1 menit tanpa buka tab manapun yang manggil
   `getStudents` (biar cache kosong), lalu Catat Terlambat 1 siswa — harus
   tetap sukses, kelas/nama benar (fallback jalan).
2. Buka tab Riwayat/Beranda dulu (supaya `getStudents` kepanggil, cache
   kepanggil), LALU Catat Terlambat siswa lain — harus tetap sukses.
3. Tambah siswa baru lewat app, LANGSUNG Catat Terlambat siswa itu (NISN
   baru) dalam <5 menit — harus ketemu (invalidasi di `addStudent` jalan,
   bukan nunggu TTL habis).
4. `npm test` — `tests/izin-keluar.test.js`/`tests/izin-kelompok.test.js`
   pakai `resolveSiswaForIzin` lewat vm sandbox TANPA `CacheService` beneran
   (stub) — pastikan stub cache-nya `get()` selalu `null` (default banyak
   test harness) supaya jalur fallback yang kena test, bukan jalur cache.

---

## Proposal 2 (Prioritas TINGGI): Split-lock — lepas `sigapLock` sebelum notify-chain

### Alasan terukur — PENTING, beda jenis manfaat dari Proposal 1 & 3

**Ini TIDAK mempercepat request `record` itu sendiri.** Kerjaannya (resolve
siswa + notifyRelevantUsers) tetap sama persis, cuma dipindah ke LUAR
`sigapLock`. Yang berkurang: **antrean guru LAIN** yang sedang menunggu
`sigapLock` yang sama (`addSurat`, `addPelanggaran`, aksi admin, dst) selama
notify-chain jalan — persis skenario yang disebut CLAUDE.md "jam gerbang
pagi saat banyak guru piket menulis nyaris serentak". Fase 1 Q3 sudah
menjawab pertanyaan applicability ini: **ya, applicable**, karena
notify-chain tidak butuh proteksi lock (baca Master_Siswa/Master_Guru,
tulis append-only ke Push_Queue yang SUDAH dilindungi dedup Event_ID
sendiri — lihat di bawah).

**Resiko duplikat notifikasi TIDAK bertambah.** `Notifikasi.gs` (catatan yang
sudah ada, lihat CLAUDE.md bagian "Idempotency & concurrency") sudah bilang
eksplisit: untuk `record`/`addSurat`/`addPelanggaran`/`addPelanggaranUpacara`,
**jendela dedup Event_ID 2 menit di `notifyRelevantUsers` itu sendiri** yang
jadi proteksi utama terhadap double-submit/race — BUKAN `sigapLock`. Jadi
melepas lock sebelum notify-chain tidak menghilangkan proteksi apa pun yang
sebelumnya benar-benar diandalkan.

### Diff (Code.gs) — 3 titik

**Titik 1 — tandai lock sedang dipegang (dekat `waitLock`):**

```diff
     var sigapLock = LockService.getScriptLock();
     try {
       sigapLock.waitLock(10000);
     } catch (lockError) {
       return jsonOut({ status: 'error', message: 'Server sedang sibuk, coba lagi sebentar.' });
     }
+    // sigapLockHeld: dipakai action 'record' untuk melepas lock LEBIH AWAL
+    // sebelum notify-chain (lihat AUDIT_BACKEND_PROPOSAL.md Proposal 2) --
+    // finally di bawah cuma releaseLock() kalau flag ini masih true, supaya
+    // tidak releaseLock() dua kali untuk action yang melepas lebih awal.
+    // Untuk SEMUA action lain (flag ini tidak pernah disentuh), perilakunya
+    // 100% sama seperti sebelumnya.
+    var sigapLockHeld = true;
     try {
```

**Titik 2 — lepas lock di action `record`, setelah appendRow+cache remove,
SEBELUM resolveSiswaForIzin+notifyRelevantUsers:**

```diff
       CacheService.getScriptCache().remove('latehist_' + data.nisn);
+      // Lepas sigapLock DI SINI (bukan nunggu finally di ujung doPost) --
+      // sisa kerjaan action ini (resolve siswa + notify) tidak menulis ke
+      // Log_Gerbang lagi dan tidak butuh proteksi lock (lihat alasan
+      // lengkap di AUDIT_BACKEND_PROPOSAL.md Proposal 2). Guru lain yang
+      // sedang antre sigapLock (addSurat/addPelanggaran/aksi admin, dst)
+      // tidak perlu ikut menunggu notify-chain selesai.
+      sigapLock.releaseLock();
+      sigapLockHeld = false;
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
```

**Titik 3 — `finally` di ujung `doPost`, jangan releaseLock() dua kali:**

```diff
     return jsonOut({ status: 'error', message: 'Action tidak dikenali' });
     } finally {
-      sigapLock.releaseLock();
+      if (sigapLockHeld) sigapLock.releaseLock();
     }
```

### Risiko

- **Ini satu-satunya proposal yang menyentuh kode BERSAMA** (`doPost`'s
  lock/finally), bukan cuma kode di dalam action `record`. Titik 1 & 3
  ditulis supaya untuk SEMUA action selain `record`, `sigapLockHeld` tidak
  pernah di-set `false` — perilakunya identik 100% dengan sebelumnya
  (`releaseLock()` selalu dipanggil tepat sekali di `finally`, sama seperti
  sekarang). Review titik ini paling teliti sebelum deploy.
- Kalau `resolveSiswaForIzin`/`notifyRelevantUsers` throw exception SETELAH
  lock dilepas (titik 2), exception itu tetap tertangkap `catch (error)` di
  luar (baris paling bawah `doPost`) — `sigapLockHeld` sudah `false`,
  `finally` tidak coba release lagi (yang kalau dicoba, GAS akan throw
  "Lock not held" dan MENUTUPI pesan error asli). Sudah ditangani lewat flag
  ini, tapi verifikasi manual tetap penting (lihat bawah).
- `notifyRelevantUsers` sendiri sudah dibungkus try/catch total (tidak
  pernah throw ke pemanggil, lihat `Notifikasi.gs`) — jadi risiko exception
  di titik 2 praktis cuma dari `resolveSiswaForIzin` (baca Sheet/cache),
  yang jarang gagal.
- **Tidak mengurangi latensi `record` itu sendiri** — kalau tujuannya
  murni "request individu lebih cepat", proposal ini TIDAK akan terlihat
  bedanya di angka `[TIMING]`/Debug_Timing manapun. Manfaatnya cuma
  kelihatan saat BANYAK guru menulis bersamaan (jam piket pagi) — sulit
  diukur dari 1 sesi tes manual, perlu observasi lapangan (atau baca
  Eksekusi Apps Script pas jam ramai: durasi `waitLock` action LAIN turun).

### Verifikasi setelah deploy

1. `npm test` — pastikan SEMUA test lock-related masih hijau (cari
   `sigapLock`/`LockService` di `tests/*.test.js` kalau ada).
2. Manual: Catat Terlambat 1x seperti biasa — harus tetap sukses, entry
   masuk Log_Gerbang, notifikasi (kalau ada wali kelas) tetap terkirim ke
   Push_Queue (cek sheet `Push_Queue` nambah baris).
3. Manual: coba PICU error di tengah notify-chain (misal NISN valid tapi
   Master_Siswa sedang error/kosong sementara) — pastikan respons ke klien
   tetap JSON error yang jelas, BUKAN "Lock not held" atau layar putih
   (kalau muncul itu, berarti flag `sigapLockHeld` gagal, cek lagi titik 1-3).
4. Manual paling penting: 2 device/akun beda, salah satu Catat Terlambat
   (lewat notify-chain yang lama), yang lain BARENGAN coba Catat
   Terlambat/Surat/Pelanggaran siswa lain — request kedua HARUS tidak perlu
   nunggu notify-chain request pertama kelar (sebelum fix, keduanya serial;
   sesudah fix, request kedua bisa masuk begitu appendRow pertama kelar).

---

## Proposal 3 (Prioritas SEDANG): Cek duplikat `record` reuse cache `today_logs`

### Alasan terukur

`getRowsSince(sheet, todayStartLog, 6)` (dup-check) selalu baca kolom
timestamp dari baris 2 sampai `lastRow` Log_Gerbang — payload-nya = TOTAL
baris Log_Gerbang SEPANJANG TAHUN AJARAN, ini SATU-SATUNYA operasi yang
match persis gejala user "makin lama seiring transaksi bertambah" (temuan
Fase 1). 4 sampel Debug_Timing belum cukup buktiin tren tumbuh (cuma snapshot
sesaat, ~400-700ms), tapi static analysis-nya sendiri sudah kuat — payload
literally = `lastRow`, bukan tebakan.

`getLogs` (`doGet`, dipanggil tiap buka Beranda/Riwayat) SUDAH cache SELURUH
isi Log_Gerbang ke key `today_logs` (TTL 60 detik, nama key agak
menyesatkan — isinya bukan cuma hari ini, tapi SELURUH riwayat, filter
per-hari terjadi di sisi pemanggil lewat `scopeDailyRecordsForUser`), dan
SUDAH di-invalidate benar di `record` sendiri (baris yang sudah ada:
`CacheService.getScriptCache().remove('today_logs')` setelah `appendRow`)
DAN di `editEntry`/`deleteEntry` (lewat `clearCacheForCategory('terlambat')`
— sudah dicek, `cacheKeys.terlambat = 'today_logs'`).

Pada cache HIT: dup-check jadi scan ARRAY JS (bukan baca Sheet) — walau
array-nya seluruh riwayat tahun ajaran, ini tetap JS murni (benchmark Fase
1: <1ms bahkan untuk ribuan baris), BUKAN panggilan Sheets API. Cache ini
kemungkinan besar SUDAH HANGAT di jam sibuk (setiap guru buka Beranda/Riwayat
ikut mengisinya, dan TTL 60 detik pas dengan skenario "banyak guru piket
simpan berturut-turut" yang jadi keluhan awal). Pada cache MISS: fallback ke
`getRowsSince` PERSIS seperti sekarang — nol regresi.

### Diff (Code.gs)

```diff
       var today = new Date();
       var todayStartLog = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
-      var rows = getRowsSince(sheet, todayStartLog, 6);
-      for (var i = 0; i < rows.length; i++) {
-        if (String(rows[i][1]) === String(data.nisn) && isSameDayServer(new Date(rows[i][0]), today)) {
-          return jsonOut({ status: 'error', message: data.name + ' sudah tercatat terlambat hari ini.' });
-        }
+      // Coba cache 'today_logs' dulu (sudah ada, sudah di-invalidate benar
+      // di record/editEntry/deleteEntry -- lihat AUDIT_BACKEND_PROPOSAL.md
+      // Proposal 3) sebelum baca Sheet lewat getRowsSince. Cache-nya berisi
+      // SELURUH Log_Gerbang (bukan cuma hari ini, walau namanya begitu),
+      // filter "hari ini" dilakukan di sini lewat isSameDayServer -- SAMA
+      // seperti kalau baca dari getRowsSince, cuma sumber datanya beda.
+      var dupFound = false;
+      var cachedTodayLogs = CacheService.getScriptCache().get('today_logs');
+      if (cachedTodayLogs) {
+        try {
+          var parsedTodayLogs = JSON.parse(cachedTodayLogs);
+          var todayLogsList = Array.isArray(parsedTodayLogs) ? parsedTodayLogs : (parsedTodayLogs.logs || []);
+          for (var ci = 0; ci < todayLogsList.length; ci++) {
+            if (String(todayLogsList[ci].nisn) === String(data.nisn) && isSameDayServer(new Date(todayLogsList[ci].timestamp), today)) {
+              dupFound = true;
+              break;
+            }
+          }
+        } catch (parseErr) {
+          cachedTodayLogs = null; // cache korup -- perlakukan sebagai miss, fallback di bawah
+        }
+      }
+      if (!cachedTodayLogs) {
+        var rows = getRowsSince(sheet, todayStartLog, 6);
+        for (var i = 0; i < rows.length; i++) {
+          if (String(rows[i][1]) === String(data.nisn) && isSameDayServer(new Date(rows[i][0]), today)) {
+            dupFound = true;
+            break;
+          }
+        }
+      }
+      if (dupFound) {
+        return jsonOut({ status: 'error', message: data.name + ' sudah tercatat terlambat hari ini.' });
       }
```

### Risiko

- Cache `today_logs` TTL 60 detik — kalau ada baris yang masuk lewat jalur
  LAIN dari record (mustahil, cuma `record` yang nulis Log_Gerbang) dalam
  60 detik terakhir dan cache belum invalidate, ini TIDAK relevan (satu
  satunya penulis cache & sheet ini adalah `record` sendiri, yang SELALU
  invalidate `today_logs` tepat setelah `appendRow` — lihat baris yang
  sudah ada di dekat sini). Jadi window balapan-nya sama sempitnya dengan
  race yang SUDAH ada di `getRowsSince` (dua request nyaris bersamaan untuk
  NISN yang sama, keduanya baca sebelum salah satu nulis) — TIDAK diperluas
  oleh perubahan ini.
- `today_logs` cache bisa BESAR (seluruh riwayat tahun ajaran) — sudah ada
  precedent-nya jalan (dipakai `getLogs` setiap hari), tapi kalau suatu saat
  Log_Gerbang jadi SANGAT besar (>100KB serialized), `cache.put()` di
  `getLogs` sendiri sudah bisa gagal (belum ada try/catch di situ per kode
  saat ini — CATATAN TERPISAH, bukan bagian proposal ini, tapi worth
  di-flag: `getLogs`nya sendiri tidak membungkus `cache.put('today_logs', ...)`
  dengan try/catch seperti `students_list` sudah lakukan). Proposal ini
  TIDAK memperburuk itu (fallback tetap baca Sheet kalau cache kosong/gagal
  terisi), tapi pertimbangkan benerin `getLogs`'s `cache.put()` juga kalau
  Log_Gerbang membesar.
- Tidak menghapus validasi apa pun — dup-check tetap 100% jalan di kedua
  jalur (cache & fallback), cuma sumber datanya beda.

### Verifikasi setelah deploy

1. `npm test` — jalankan `tests/rbac-riwayat-pelanggaran.test.js` dan
   `tests/record-then-delete-timestamp.test.js` (paling dekat dengan jalur
   ini), pastikan tetap hijau.
2. Manual: Catat Terlambat siswa A, LALU coba Catat Terlambat siswa A lagi
   di hari yang sama — harus tetap ditolak "sudah tercatat terlambat hari
   ini" (baik lewat cache hit maupun cache miss — tes 2x, sekali abis buka
   Beranda dulu biar cache hangat, sekali lagi setelah nunggu >60 detik
   tanpa buka apa-apa biar cache dingin).
3. Manual: 2 guru piket beda device, Catat Terlambat siswa BEDA hampir
   bersamaan — keduanya harus sukses (bukan saling ke-block).
4. Bandingkan gap `start → after dup check` di `[TIMING]` Logger.log
   (kalau mau pasang ulang sementara) sebelum/sesudah — harus turun
   signifikan SAAT cache hangat (baru buka Beranda/Riwayat sebelum tes).

---

## Urutan eksekusi yang disarankan

Proposal 1 dan 3 independen satu sama lain (boleh digabung satu deploy).
Proposal 2 disarankan **terpisah** (deploy sendiri, verifikasi sendiri)
karena satu-satunya yang menyentuh struktur lock bersama — kalau ada
masalah, lebih gampang diisolasi penyebabnya kalau tidak digabung dengan
perubahan lain di deploy yang sama.

1. Deploy Proposal 1 + 3 bareng → verifikasi → observasi beberapa hari.
2. Deploy Proposal 2 terpisah → verifikasi ekstra hati-hati (poin 4 di
   verifikasi Proposal 2 butuh 2 device) → observasi jam piket pagi
   berikutnya (paling kelihatan bedanya di situ, bukan di 1 kali tes).
