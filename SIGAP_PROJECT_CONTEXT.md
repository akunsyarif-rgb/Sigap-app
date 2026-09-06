# SIGAP — Ringkasan Konteks Proyek

> Dokumen ini ditulis berdasarkan **pembacaan langsung kode sumber** repo
> `Sigap-app` pada commit `175c8a9` (branch `main`, per tanggal dokumen ini
> dibuat — lihat Bagian 9). Setiap klaim di sini ditelusuri ke file/baris
> kode, commit git, atau file dokumentasi yang sudah ada di repo (`CLAUDE.md`,
> `SCHEMA.md`, `README.md`). Bagian yang **tidak bisa dipastikan hanya dari
> membaca kode** ditandai eksplisit sebagai *"tidak dapat dipastikan dari
> kode, perlu verifikasi manual"* — tidak ada yang ditebak atau dikarang.
>
> Dokumen ini **sengaja tidak berdiri sendiri secara hukum/kepemilikan** —
> tidak memuat nama individu (pengembang, guru, siswa) atau data pribadi apa
> pun. Informasi kredit/atribusi pengembang proyek ini ada di `README.md`,
> `CLAUDE.md`, dan halaman "Tentang SIGAP" di dalam aplikasi itu sendiri.

---

## 1. Ringkasan Umum

**SIGAP** (kepanjangannya dinyatakan berbeda-beda di dua tempat kode — lihat
catatan di Bagian 7) adalah aplikasi web internal untuk satu sekolah
menengah, dipakai menggantikan "buku piket kertas" untuk mencatat:

- Keterlambatan siswa masuk sekolah (Gerbang),
- Surat izin/sakit siswa (tanpa lampiran foto — lihat Bagian 4),
- Izin keluar/pulang siswa di tengah jam pelajaran (individual maupun
  rombongan), lengkap dengan alur persetujuan-verifikasi dan cetak surat
  keterangan,
- Pelanggaran tata tertib siswa (dengan sanksi) dan pelanggaran saat
  upacara,
- Catatan bimbingan konseling (dibatasi ketat),
- Tindak lanjut untuk siswa yang sering terlambat.

Masalah yang diselesaikan: sebelumnya proses ini dicatat manual di kertas
oleh guru piket dan sulit direkap/dicari. SIGAP memusatkan pencatatan ini
ke satu sistem yang bisa dicari, direkap per kelas/periode, diekspor
sebagai laporan, dan diberi kontrol akses sesuai peran pengguna.

**Siapa penggunanya** (berdasarkan peran yang benar-benar dikenali sistem —
lihat Bagian 6, bukan asumsi jumlah orang): staf sekolah dengan empat
peran — **admin**, **BK/Kesiswaan**, **guru** (termasuk yang berstatus wali
kelas), dan **OSIS** (pengurus organisasi siswa, dengan akses paling
sempit — hanya kategori Upacara). Tidak ada peran "siswa" — siswa adalah
objek data yang dicatat, bukan pengguna sistem yang login.

Aplikasi ini **tidak punya nama sekolah/entitas hukum yang digeneralisasi**
di sini sesuai instruksi (identitas institusi & pengembang ada di
`README.md`/`CLAUDE.md`), tapi secara arsitektur ia dirancang eksplisit
untuk **direplikasi ke sekolah lain** — lihat halaman "Tentang SIGAP" di
`ui-common.js` dan `SCHEMA.md` (yang menyebutkan langkah replikasi: siapkan
3 sheet data induk, sisanya otomatis).

---

## 2. Arsitektur Teknis

### Stack aktual (diverifikasi dari `package.json`, konfigurasi deploy, dan struktur folder)

| Lapisan | Teknologi | Bukti di kode |
|---|---|---|
| Frontend UI | React 18 (build produksi, UMD lewat CDN) + JSX ditranspile **di browser** oleh Babel Standalone (`@babel/standalone@7`) — **tidak ada build step** | `index.html`: `<script src="https://unpkg.com/react@18/umd/react.production.min.js">`, `@babel/standalone@7`, `Babel.transform(...)` dijalankan langsung di `<script>` inline |
| Styling | Tailwind CSS lewat CDN play-script (`cdn.tailwindcss.com`), dengan `tailwind.config` kustom (palet warna "Modern Academic Utility") | `index.html` |
| Bahasa | JavaScript (JSX) untuk frontend; Google Apps Script (varian JavaScript/V8) untuk backend | ekstensi `.js` vs `.gs` |
| Backend | Google Apps Script **Web App** (router `doGet`/`doPost` di `Code.gs`) | `Code.gs`, `Auth.gs`, `Utils.gs`, `Notifikasi.gs` |
| Database | **Satu Google Spreadsheet**, dibaca/ditulis lewat `SpreadsheetApp` — bukan database terpisah (bukan SQL/NoSQL) | `SCHEMA.md`; pemanggilan `SpreadsheetApp.getActiveSpreadsheet()` di banyak fungsi `Code.gs`/`Utils.gs` |
| Hosting frontend | **Vercel** (situs statis) — dikonfirmasi lewat `vercel.json` (header `Cache-Control` khusus untuk `index.html`) dan status check GitHub `Vercel` yang benar-benar sukses ter-deploy pada commit terbaru | `vercel.json`; riwayat deployment PR #58 |
| Fungsi serverless tambahan | Satu fungsi Node serverless di project Vercel yang **sama**: `api/push-send.js` — dipakai HANYA untuk menandatangani & mengirim Web Push (VAPID), karena Apps Script tidak punya primitif kripto ECDSA/ECDH yang dibutuhkan | `api/push-send.js`; `package.json` dependency `web-push` |
| Hosting backend | Google Apps Script Web App, terikat ke Google Sheet yang sama sebagai database | `CLAUDE.md`, `.clasp.json.example` |
| CI | GitHub Actions (`node --test`, Node.js 20) | `.github/workflows/test.yml` |
| Package manager / runtime lokal | Node.js (versi 20 dipakai konsisten di semua workflow CI & devcontainer) | `.github/workflows/*.yml`, `.devcontainer/devcontainer.json` |
| Testing | `node --test` bawaan Node.js (bukan Jest/Mocha) + `@babel/core`+`@babel/preset-react` (devDependency, hanya untuk mentranspile JSX saat test, bukan untuk build produksi) | `package.json`, `tests/*.test.js` |
| PWA | `manifest.json` + `sw.js` (service worker minimal — hanya menangani event `push` dan `notificationclick`, **tidak** melakukan caching apa pun) | `manifest.json`, `sw.js` |

**Tidak ada framework backend seperti Express/NestJS** — seluruh backend
adalah satu set fungsi Apps Script global (`Code.gs`, `Auth.gs`, `Utils.gs`,
`Notifikasi.gs` berbagi satu scope global tanpa sistem modul/import).

**Tidak ada database relasional/NoSQL** — "tabel" adalah sheet di dalam satu
Google Spreadsheet, "kolom" dibaca berdasarkan **indeks posisi**, bukan nama
header (lihat Bagian 5).

### Alur data (teks)

Alur permintaan biasa (mis. mencatat keterlambatan):

```
Browser guru (PWA/HP/desktop)
  │  React di-load dari index.html, fetch() 13 file .js berurutan,
  │  digabung + ditranspile Babel sekali di client (atau dipakai dari
  │  cache localStorage kalau BUILD_VERSION sama seperti sebelumnya)
  ▼
fetch() JSON ke SATU URL Web App Apps Script (API_URL di config.js)
  disertai API_TOKEN (dikirim semua klien, bukan rahasia sungguhan)
  dan sessionToken (didapat saat login, berlaku maks 6 jam)
  ▼
Code.gs  → doPost(e)/doGet(e): cek checkToken() lalu getSessionUser()
  │
  ├─ Auth.gs      → verifikasi sesi & password
  ├─ Utils.gs     → RBAC (fungsi scope*/can*), rate limit, helper sheet
  ├─ Notifikasi.gs→ enqueue baris ke sheet Push_Queue (TIDAK mengirim
  │                  langsung — supaya aksi utama tidak menunggu jaringan)
  └─ SpreadsheetApp → baca/tulis baris di Google Sheet (database)
  ▼
Respons JSON balik ke browser → React re-render
```

Alur pengiriman notifikasi push (terpisah, asinkron, dipicu trigger waktu):

```
Time-based trigger Apps Script (dipasang manual sekali lewat
installPushQueueTrigger(), tiap 1 menit)
  ▼
processPushQueue() (Notifikasi.gs) baca baris belum diproses di Push_Queue
  ▼
UrlFetchApp → POST ke api/push-send.js (fungsi Vercel, project sama
  dengan frontend), dengan secret bersama (PUSH_RELAY_SECRET)
  ▼
api/push-send.js → tanda tangani VAPID (paket npm `web-push`) + enkripsi
  payload → kirim Web Push lewat infrastruktur push milik masing-masing
  browser vendor (mis. layanan push Chrome/Firefox)
  ▼
sw.js (service worker) di perangkat guru penerima → tampilkan notifikasi OS
```

### Cara deployment saat ini

Dua target deploy **terpisah total**, dan **push/merge ke `main` HANYA
men-deploy salah satunya**:

1. **Frontend** (`index.html` + semua `*.js` non-`.gs`) — otomatis
   ter-deploy ke Vercel pada setiap push ke `main` (terverifikasi: check
   run `Vercel` sukses pada PR terbaru). Tidak ada langkah manual.
2. **Backend** (`Code.gs`, `Auth.gs`, `Utils.gs`, `Notifikasi.gs`) —
   **tidak pernah** ter-deploy otomatis. Perubahan pada file `.gs` hanya
   mengubah kode di GitHub; Web App Apps Script yang sedang berjalan tetap
   memakai versi yang terakhir di-deploy manual, sampai seseorang secara
   sadar menjalankan salah satu dari:
   - `clasp push` + `clasp deploy -i <ID>` secara manual (lokal atau lewat
     GitHub Codespaces — `.devcontainer/devcontainer.json` disiapkan untuk
     ini), atau
   - menjalankan workflow `deploy-gas.yml` secara manual (`workflow_dispatch`,
     **bukan** otomatis), yang digembok tiga secret repo
     (`CLASP_CREDENTIALS`, `CLASP_SCRIPT_ID`, `CLASP_DEPLOYMENT_ID`) dan
     serangkaian pengecekan read-only sebelum satu pun perubahan ditulis
     (lihat `.github/scripts/check-clasp-credentials.js`,
     `.github/scripts/verify-clasp-target.js`).

   Ada workflow terpisah `check-backend-drift.yml` (jalan tiap push yang
   menyentuh file `.gs` ke `main`, dan terjadwal harian jam 03:00 UTC) yang
   **hanya membaca** status publik backend (`BACKEND_VERSION` di `Code.gs`
   vs versi yang sedang dilayani live) dan menandai gagal (bukan blocker
   merge) kalau ada drift — bukan mekanisme deploy.

**Konsekuensi penting**: kode di GitHub `main` untuk `Code.gs`/`Auth.gs`/
`Utils.gs`/`Notifikasi.gs` **tidak menjamin** itu yang benar-benar berjalan
di produksi — harus dicek `BACKEND_VERSION` lewat status ping API
(`GET <API_URL>?token=<API_TOKEN>`) untuk memastikan.

---

## 3. Fitur yang Berjalan di Produksi

Semua fitur di bawah dikonfirmasi ada dan aktif lewat pembacaan langsung
`config.js` (daftar menu per peran), `Code.gs` (daftar action router), dan
komponen React terkait. Status operasional aktual di lingkungan produksi
sekolah (bukan status "kode-nya ada") ditandai terpisah kalau tidak bisa
dipastikan hanya dari kode.

### 3.1 Login & Manajemen Sesi
- **Cara kerja**: pengguna mencari namanya di kotak pencarian (opsional —
  daftar nama diambil lewat aksi `getLoginUsers` yang sengaja tidak butuh
  sesi) atau langsung mengisi password tanpa memilih nama (fallback lama
  tetap berfungsi kalau daftar nama gagal dimuat). Password diverifikasi
  server (`verifyPassword` di `Auth.gs`, skema hash SHA-256 bergaram +
  migrasi otomatis dari skema lama tanpa garam). Sesi server berlaku maksimal
  6 jam sejak login (`SESSION_ABSOLUTE_MAX_MS` di `Auth.gs`), disimpan di
  `CacheService` sisi server dan satu key `sigap_session` di `localStorage`
  sisi klien.
- **File utama**: `Auth.gs` (sesi, hash password), `Code.gs` (action
  `login`/`logout`/`getLoginUsers`), `ui-common.js` (`LoginScreen`), `app.js`
  (siklus hidup sesi klien), `helpers.js` (fungsi murni terkait sesi).
- **Status**: **Production**.

### 3.2 Gerbang — Catat Keterlambatan
- **Alur**: guru piket mencari siswa (NISN/nama) → pilih alasan
  (preset atau teks bebas) → simpan → baris baru di sheet `Log_Gerbang` →
  (opsional) notifikasi push ke wali kelas siswa terkait.
- **File utama**: `gerbang.js` (`GerbangTab`), `Code.gs` (action `record`,
  `getLogs`), `Utils.gs` (`scopeDailyRecordsForUser` — hari ini terlihat
  seluruh sekolah, riwayat lama dibatasi per kelas untuk wali kelas).
- **Status**: **Production** — fitur inti tertua di aplikasi ini.

### 3.3 Gerbang — Catat Surat Izin/Sakit
- **Alur**: input jenis (sakit/izin/dll.) + keterangan teks bebas → baris
  baru di `Surat_Masuk`. **Tidak ada lampiran foto** (lihat Bagian 4 —
  fitur ini pernah ada, dicabut).
- **File utama**: `gerbang.js`, `Code.gs` (action `addSurat`, `getSurat`).
- **Status**: **Production**.

### 3.4 Gerbang — Izin Keluar / Pulang (individual)
- **Alur**: (1) guru mana pun (bukan hanya wali kelas) memberi *persetujuan*
  → (2) Guru Piket yang bertugas hari itu (atau BK/admin sebagai cadangan)
  *memverifikasi*, siswa tercatat "Sedang di Luar" → (3a) ditandai kembali
  (langsung final, satu langkah) atau (3b) ditandai pulang (tidak kembali
  ke sekolah). Ada jalur "Izin Khusus" untuk kondisi di luar prosedur normal.
  Surat keterangan (PDF via cetak browser) bisa dibuat setelah verifikasi,
  dengan nomor surat otomatis per hari.
- **File utama**: `gerbang.js` (`IzinKeluarPanel`, `KartuIzinKeluar`),
  `Code.gs` (`addIzinKeluar`, `verifikasiIzinKeluar`,
  `tandaiKembaliIzinKeluar`, `tandaiPulangIzinKeluar`,
  `generateIzinKeluarSurat`, `renderIzinKeluarSuratHTML`), `Utils.gs`
  (`canVerifyIzin`, `izinKapasitasVerifikasi`, `scopeIzinForUser`,
  `generateNomorSurat`).
- **Status**: **Production** — label "BETA" resmi dicabut lewat commit
  `a828ab5` ("Izin Keluar: remove BETA label, add Cetak Surat Izin (print)
  feature", 2026-09-03) setelah fitur cetak surat selesai dan diuji.

### 3.5 Gerbang — Izin Keluar Rombongan (Izin Kelompok)
- **Alur**: sama seperti izin individual, tapi satu pengajuan mencakup
  banyak siswa sekaligus (satu baris "kegiatan" di `Izin_Kelompok`, tiap
  peserta tetap baris sendiri di `Izin_Keluar`). Verifikasi dan "tandai
  kembali" bisa dilakukan sebagian (tidak harus semua peserta sekaligus).
- **File utama**: `gerbang.js` (`IzinKelompokPanel`, `KartuKelompok`,
  `PesertaKelompokSheet`), `Code.gs` (`addIzinKelompok`,
  `verifikasiIzinKelompok`, `tandaiKembaliKelompok`).
- **Status**: **Production**.

### 3.6 Pelanggaran Tata Tertib
- **Alur**: catat jenis pelanggaran + sanksi + catatan opsional untuk
  seorang siswa.
- **File utama**: `pelanggaran-bimbingan-upacara.js` (`PelanggaranTab`),
  `Code.gs` (`addPelanggaran`, `getPelanggaran`), `Utils.gs`
  (`scopePelanggaranForUser`).
- **Status**: **Production**.

### 3.7 Pelanggaran Upacara
- **Alur**: sama seperti Pelanggaran, tapi kategori terpisah khusus
  kejadian saat upacara; punya sub-mode "Rekap" yang bisa dibaca bersama
  oleh OSIS (lihat Bagian 6).
- **File utama**: `pelanggaran-bimbingan-upacara.js` (`UpacaraTab`),
  `Code.gs` (`addPelanggaranUpacara`, `getPelanggaranUpacara`).
- **Status**: **Production**.

### 3.8 Bimbingan Khusus
- **Alur**: catatan konseling untuk siswa tertentu, hanya bisa dibuat &
  dibaca oleh admin/BK-Kesiswaan.
- **File utama**: `pelanggaran-bimbingan-upacara.js` (`BimbinganTab`),
  `Code.gs` (`addBimbingan`, `getBimbingan`).
- **Status**: **Production**.

### 3.9 Tindak Lanjut (siswa sering terlambat)
- **Alur**: sistem menandai siswa yang sudah beberapa kali terlambat (lewat
  data `Log_Gerbang`); guru dapat mengajukan tindak lanjut, admin/BK
  menyetujuinya.
- **File utama**: `beranda-riwayat.js` (bagian dari `DashboardTab`, bukan
  tab terpisah), `Code.gs` (`ajukanTindakLanjut`, `approveTindakLanjut`,
  `getTindakLanjut`).
- **Status**: **Production**.

### 3.10 Rekap Kelas & Statistik
- **Alur**: agregasi jumlah kasus (terlambat/pelanggaran/upacara) per kelas
  atau per siswa, dengan mode "Ranking" antar kelas untuk BK/admin.
- **File utama**: `rekap-kelas.js` (`RekapKelasTab`), `statistik.js`
  (`StatsTab`).
- **Status**: **Production**.

### 3.11 Export Data (Laporan PDF/Excel)
- **Alur**: pilih jenis laporan + periode + cakupan kelas → server
  memvalidasi otorisasi & filter → hasil dirender jadi file PDF/XLSX
  langsung di browser (pembuat file sendiri, tanpa library pihak ketiga —
  lihat `export-format.js`).
- **File utama**: `export-data.js` (`ExportTab`), `export-format.js`
  (pembuat PDF/XLSX manual), `Code.gs` (action `exportData`), `Utils.gs`
  (`resolveExportAccess`, `EXPORT_JENIS`).
- **Status**: **Production**.

### 3.12 Kelola (Admin Panel)
- **Alur**: kelola akun guru (tambah/edit/nonaktifkan/hapus/reset
  password/ubah role), atur jadwal piket, dan "Pemeliharaan Data" (hapus
  data operasional lama per rentang tanggal, dengan pratinjau wajib
  sebelum eksekusi).
- **File utama**: `admin.js` (`KelolaTab`), `Code.gs` (`addTeacher`,
  `updatePassword`, `updateRole`, `toggleTeacherStatus`, `deleteTeacher`,
  `setJadwalPiket`, `previewHapusData`, `hapusDataPeriode`, dll.).
- **Status**: **Production** — admin-only.

### 3.13 Audit Log
- **Alur**: jejak siapa melakukan aksi apa (termasuk setiap ekspor data),
  metadata saja (tidak memuat nama/isi data siswa).
- **File utama**: `admin.js` (`AuditLogTab`), `Utils.gs` (`logAudit`),
  `Code.gs` (`getAuditLog`).
- **Status**: **Production** — **admin-only** (BK/Kesiswaan tidak lagi
  punya akses sejak commit `14a9acf`, "Persempit Audit Log jadi
  Admin-only").

### 3.14 Ganti Password Sendiri
- **Alur**: semua peran bisa mengganti password akunnya sendiri (wajib
  password lama yang benar), tanpa lewat admin.
- **File utama**: `ui-common.js` (`ChangePasswordModal`), `Code.gs`
  (action `changeMyPassword`).
- **Status**: **Production**.

### 3.15 Notifikasi Push (Web Push berbasis VAPID)
- **Alur**: wali kelas & guru piket yang bertugas hari itu bisa menerima
  notifikasi bahkan saat aplikasi tertutup, untuk kejadian yang relevan
  (keterlambatan, izin keluar butuh verifikasi, dll.), dengan isi
  notifikasi yang sengaja digeneralisasi (tidak pernah memuat nama siswa
  atau isi catatan sensitif).
- **File utama**: `Notifikasi.gs` (logika penerima & antrean),
  `api/push-send.js` (fungsi Vercel — penandatanganan & pengiriman
  sungguhan), `notifikasi.js` (UI onboarding & pengaturan klien), `sw.js`
  (service worker).
- **Status kode**: selesai dibangun, diuji lewat `tests/push-notifications.test.js`
  dan `tests/push-frontend.test.js` (logika penentuan penerima, antrean,
  idempotency, privasi isi pesan — semua diuji lewat simulasi, bukan
  jaringan sungguhan).
- **Status operasional di produksi**: ⚠️ **tidak dapat dipastikan dari
  kode, perlu verifikasi manual**. Fitur ini butuh 7 langkah konfigurasi
  manual di luar repo (generate pasangan kunci VAPID, isi env var di
  dashboard Vercel, isi Script Properties di Apps Script, jalankan
  `installPushQueueTrigger()` sekali dari editor Apps Script — daftar
  lengkap ada di `CLAUDE.md` bagian "Push Notification" poin "One-time
  manual setup"). Tidak ada cara memverifikasi dari kode/repo apakah
  langkah-langkah itu sudah benar-benar dilakukan di lingkungan produksi
  sekolah. `CLAUDE.md` sendiri secara eksplisit menyatakan pengiriman
  end-to-end ke perangkat fisik **belum pernah diverifikasi** dari
  lingkungan pengembangan (lihat bagian "Verified vs. not verified in this
  environment" di `CLAUDE.md`).

### 3.16 Footer Atribusi & Halaman "Tentang SIGAP"
- **Alur**: footer kecil tampil hanya di layar Login dan tab Beranda,
  berisi tautan ke halaman "Tentang SIGAP" (identitas pengembang, cara
  kontak, dan pernyataan keterbukaan untuk direplikasi sekolah lain).
- **File utama**: `ui-common.js` (`AppFooter`, `TentangSigapPage`),
  `app.js` (pengait ke tab `'tentang'`).
- **Status**: **Production** — fitur paling baru, digabungkan ke `main`
  pada tanggal dokumen ini dibuat (PR #58, lihat Bagian 8).

---

## 4. Fitur yang Direncanakan tapi Dibatalkan

Ditemukan dengan menelusuri `git log` (riwayat commit yang bisa diakses dari
clone ini — lihat catatan keterbatasan riwayat di akhir bagian ini) dan
komentar eksplisit di kode yang menjelaskan alasan pencabutan.

### 4.1 Verifikasi QR Code untuk Surat Izin Keluar
- **Apa fiturnya**: setiap surat keterangan izin keluar yang dicetak akan
  disertai kode QR (dan URL verifikasi publik `verifyIzinSurat`) yang bisa
  dipindai untuk memverifikasi keasliannya. Sempat dibangun penuh:
  `generateVerificationURL`, `generateQRCodeImage` (memanggil
  `api.qrserver.com`), dan endpoint `doGet` `verifyIzinSurat`.
- **Kenapa dibatalkan**: menurut commit `cf4f715` ("Remove QR/verification
  from Cetak Surat Izin (product decision)", 2026-09-04) — fitur ini
  **berulang kali gagal di uji lapangan tanpa akar masalah yang benar-benar
  terkonfirmasi**, kemungkinan besar celah otorisasi `UrlFetchApp` akibat
  deploy lewat salin-tempel manual ke editor Apps Script (bukan `clasp
  push`), tapi ini **tidak pernah dikonfirmasi**. Alternatif berbasis
  tautan teks (tanpa gambar) dipertimbangkan tapi ditolak karena dianggap
  terlalu lambat dipakai di lapangan. Keputusannya eksplisit disebut
  "keputusan produk, bukan bug yang belum selesai" — keaslian surat
  sekarang bersandar pada nomor surat otomatis + nama penyetuju/verifikator
  + stempel waktu saja, sama seperti formulir kertas sebelumnya.
- **Kode dihapus total** (bukan sekadar dinonaktifkan) — `Code.gs` bahkan
  punya komentar yang menegaskan fitur ini tidak boleh dihidupkan lagi
  tanpa membaca ulang riwayat masalahnya, dan salah satu test
  (`tests/izin-keluar-surat.test.js`) memindai `Code.gs` untuk memastikan
  kode QR tidak diam-diam kembali.

### 4.2 Lampiran Foto pada Surat Izin/Sakit
- **Apa fiturnya**: unggah foto (mis. foto surat dokter) sebagai lampiran
  saat mencatat Surat Masuk, disimpan ke Google Drive dan tautannya
  disimpan di kolom `Foto_URL`.
- **Kenapa dibatalkan**: menurut commit `5a5b100` ("Hapus fitur foto surat
  — sisakan laporan tertulis saja", 2026-08-11) — **berulang kali gagal di
  lapangan** karena masalah otorisasi/kebijakan *sharing* Google Workspace
  sekolah yang tidak pernah benar-benar tuntas (percobaan berpindah dari
  mode akses `ANYONE_WITH_LINK` ke `DOMAIN_WITH_LINK` pun masih gagal).
  Daripada membiarkan fitur "setengah-jalan" yang sering gagal secara diam-
  diam, fitur ini dicabut total.
- **Jejak yang tersisa**: kolom `Foto_URL` di sheet `Surat_Masuk` **masih
  ada** (baris lama yang kebetulan sudah pernah punya foto tidak rusak),
  tapi tidak pernah ditulis/dibaca lagi oleh UI mana pun untuk baris baru.

### 4.3 Langkah "Tutup Transaksi" Terpisah di Izin Keluar
- **Apa fiturnya**: alur asli Izin Keluar punya *dua* langkah setelah siswa
  kembali: `tandaiKembaliIzinKeluar` (status → `Kembali`) lalu aksi kedua
  `selesaikanIzinKeluar` (status → `Selesai`) sebagai langkah "menutup"
  transaksi secara administratif.
- **Kenapa dibatalkan**: menurut commit `fa7dee3` (2026-08-25) — hasil
  audit menemukan status `Kembali` **tidak pernah** dihitung sebagai
  transaksi yang masih terbuka di logika manapun, jadi langkah kedua itu
  murni kosmetik dan hanya menambah beban klik bagi Guru Piket tanpa
  menambah integritas data apa pun. Aksi `selesaikanIzinKeluar` **dihapus
  total** dari server; `tandaiKembaliIzinKeluar` sekarang langsung menulis
  status akhir `Selesai` dalam satu langkah.

### 4.4 Sakelar Keyboard ABC/123 di Layar Login
- **Apa fiturnya**: tombol untuk berpindah antara keyboard huruf dan
  keyboard angka saat mengisi password di layar login.
- **Kenapa dibatalkan**: commit `fda850c` ("Hapus sakelar keyboard ABC/123
  di layar login (permintaan eksplisit)", 2026-08-18) — dihapus atas
  **permintaan eksplisit** (bukan ditemukan sebagai bug), karena password
  yang dibagikan sekolah boleh mengandung huruf, jadi keyboard huruf
  standar (dengan tombol angka bawaan lewat "123" di keyboard itu sendiri)
  dianggap cukup.

### 4.5 Opsi Deploy Otomatis Backend Lewat GitHub Environment
- **Apa rencananya**: memakai fitur GitHub Environment dengan *required
  reviewers* supaya deploy backend bisa semi-otomatis (jalan otomatis
  setelah disetujui manusia lewat approval UI GitHub), sebagai alternatif
  dari tombol manual `workflow_dispatch` yang dipakai sekarang.
- **Kenapa tidak jadi dibangun**: menurut komentar di `CLAUDE.md` bagian
  "Backend drift detection" — opsi ini **ditolak sebelum diimplementasikan**
  (bukan dibangun lalu dicabut), dengan alasan: butuh paket berbayar GitHub
  untuk repo privat, dan risiko *fail-open* — kalau Environment dibuat tapi
  lupa mengaktifkan aturan proteksinya, deploy akan tetap jalan otomatis
  tanpa gerbang sama sekali, yang dinilai lebih berisiko daripada baseline
  "klik manual" yang ada sekarang.

**Catatan keterbatasan riwayat**: clone repo yang dipakai untuk menulis
dokumen ini adalah **shallow clone** (`.git/shallow` ada isinya) — riwayat
commit yang bisa ditelusuri dari sini dimulai dari sekitar awal Agustus
2026 (154 commit sampai commit terbaru). Kemungkinan ada riwayat/keputusan
lebih lama sebelum itu yang tidak terlihat dari clone ini — **tidak dapat
dipastikan dari kode, perlu verifikasi manual** ke riwayat git lengkap di
GitHub kalau dibutuhkan.

---

## 5. Struktur Data

SIGAP **tidak punya database terpisah** — satu Google Spreadsheet adalah
database-nya, dengan **15 sheet** total. Skema di bawah diverifikasi silang
antara `SCHEMA.md` (dokumen skema yang sudah ada di repo, yang menyatakan
dirinya sendiri dibuat dari pembacaan kode) dengan konstanta header yang
sungguhan dideklarasikan di kode (`IZIN_HEADERS`/`IZIN_KELOMPOK_HEADERS` di
`Utils.gs`, `PUSH_SUBSCRIPTIONS_HEADERS`/`PUSH_QUEUE_HEADERS` di
`Notifikasi.gs`) — cocok persis. **Tidak ada data siswa/guru asli yang
disertakan di sini, hanya nama kolom & tipe/maknanya.**

**Kolom dibaca berdasarkan indeks posisi (`row[0]`, `row[1]`, dst.), bukan
nama header** — urutan kolom di bawah ini signifikan secara teknis, bukan
sekadar dokumentasi.

### Kategori 1 — Data induk (harus disiapkan manual, tidak dibuat otomatis)

**`Master_Guru`** (kolom A–H, posisi wajib persis)
| Kolom | Nama | Tipe/makna |
|---|---|---|
| A | ID | teks, ID unik guru (dipakai sebagai `teacherId` saat login) |
| B | Nama | teks |
| C | Password | teks (hash, **bukan plaintext**) |
| D | Role | enum: `admin` \| `bk_kesiswaan` \| `guru` \| `osis` |
| E | Jabatan | teks, opsional (label tampilan) |
| F | Status | teks: kosong = aktif, `nonaktif` = terkunci |
| G | Kelas_Wali | teks, kosong = bukan wali kelas |
| H | Salt | teks, kosong = masih skema hash lama |

**`Master_Siswa`** (kolom A–C)
| Kolom | Nama | Tipe |
|---|---|---|
| A | NISN | teks, kunci pencarian siswa |
| B | Nama | teks |
| C | Kelas | teks |

**`Log_Gerbang`** (keterlambatan, kolom A–F)
| Kolom | Nama | Tipe |
|---|---|---|
| A | Timestamp | tanggal/waktu, **harus terurut naik** |
| B | NISN | teks |
| C | Nama | teks |
| D | Kelas | teks |
| E | Alasan | teks bebas |
| F | Dicatat_Oleh | teks (nama, bukan ID) |

### Kategori 2 — Data operasional (dibuat otomatis saat pertama dipakai)

**`Pelanggaran`** (A–H): Timestamp, NISN, Nama, Kelas, Jenis_Pelanggaran,
Sanksi, Catatan (opsional), Dicatat_Oleh.

**`Surat_Masuk`** (A–H): Timestamp, NISN, Nama, Kelas, Jenis, Keterangan,
**Foto_URL (legacy, selalu kosong untuk baris baru — lihat Bagian 4.2)**,
Dicatat_Oleh.

**`Bimbingan_Khusus`** (A–F): Timestamp, NISN, Nama, Kelas, Catatan,
Dicatat_Oleh. — Akses baca dibatasi admin/BK saja.

**`Pelanggaran_Upacara`** (A–H): Timestamp, NISN, Nama, Kelas,
Jenis_Pelanggaran, Catatan (opsional), Dicatat_Oleh, Dicatat_Oleh_ID.

**`Izin_Keluar`** (24 kolom, A–X): Timestamp, NISN, Nama, Kelas, ID_Izin,
Keperluan, Tujuan (`kembali`/`pulang`), Status (`Menunggu Verifikasi` \|
`Sedang di Luar` \| `Selesai` \| `Pulang`; `Kembali` = nilai lama, tidak
ditulis lagi), Jalur (`normal`/`khusus`), Alasan_Khusus, Disetujui_Oleh,
Disetujui_Oleh_ID, Waktu_Persetujuan, Diverifikasi_Oleh,
Diverifikasi_Oleh_ID, Waktu_Verifikasi, Waktu_Keluar, Waktu_Kembali,
Dicatat_Kembali_Oleh, Dicatat_Kembali_Oleh_ID, ID_Kelompok (kosong = izin
individual), Nomor_Surat, Waktu_Print, Status_Print (`Belum`/`Sudah`).

**`Izin_Kelompok`** (15 kolom, A–O): Timestamp, ID_Kelompok, Kegiatan,
Tujuan, Keperluan, Pola_Kembali (`bersama`/`individual`), Jumlah_Peserta,
Jalur, Alasan_Khusus, Disetujui_Oleh, Disetujui_Oleh_ID,
Waktu_Persetujuan, Diverifikasi_Oleh, Diverifikasi_Oleh_ID,
Waktu_Verifikasi. — **Sengaja tidak punya kolom status**: status kegiatan
selalu dihitung dari status baris-baris peserta di `Izin_Keluar`.

**`Jadwal_Piket`** (A–B): Hari (`Senin`..`Sabtu`), Guru_ID (rujuk
`Master_Guru` kolom A). Satu baris = satu penugasan.

**`Tindak_Lanjut`** (A–I): Timestamp, NISN, Nama, Kelas, Catatan,
Diajukan_Oleh, Status, Disetujui_Oleh, Tanggal_Disetujui.

**`Audit_Log`** (A–E): Timestamp, Nama (aktor), ID (aktor), Aksi, Detail. —
Tidak pernah memuat nama/NISN siswa atau isi password.

**`Error_Log`** (A–F): Timestamp, Nama, ID, Pesan, Detail, Halaman. — Log
error render sisi klien.

**`Push_Subscriptions`** (A–F): Timestamp, Guru_ID (selalu dari sesi server,
tidak pernah dari klaim klien), Endpoint (kunci unik — upsert lewat ini,
bukan lewat Guru_ID), P256dh, Auth, User_Agent (opsional).

**`Push_Queue`** (A–N): Timestamp, Event_ID (kunci idempotency), Jenis_Kejadian, NISN,
Guru_ID (penerima), Title, Body (sudah disaring privasi), Url (token
deep-link), Tag, Priority, Processed, Processed_At, Attempts, Last_Error.

### Relasi antar sheet

- `Master_Guru.ID` ← dirujuk oleh `Jadwal_Piket.Guru_ID`, `Audit_Log.ID`,
  `Push_Subscriptions.Guru_ID`, dan kolom `*_Oleh_ID` di `Izin_Keluar`/
  `Izin_Kelompok`/`Pelanggaran_Upacara`.
- `Master_Siswa.NISN` ← dirujuk oleh kolom `NISN` di hampir semua sheet
  operasional (nama & kelas siswa **selalu** diambil ulang dari
  `Master_Siswa` saat menulis baris baru — kolom `Kelas` di baris data
  historis adalah **snapshot** nama kelas saat kejadian dicatat, bukan
  *live join* — kalau siswa pindah kelas, baris lama tidak berubah).
- `Izin_Keluar.ID_Kelompok` ← dirujuk balik ke `Izin_Kelompok.ID_Kelompok`
  (satu kegiatan bisa punya banyak baris peserta).
- Tidak ada *foreign key* sungguhan (Google Sheets tidak punya konsep itu)
  — semua relasi ditegakkan di level kode aplikasi (Apps Script), bukan di
  level penyimpanan.

---

## 6. Peran dan Kewenangan Pengguna (Role-Based Access)

Empat peran dikenali sistem (`config.js` — `ROLES`, dan `Auth.gs` — fungsi
`isAdminRole`/`isBkRole`/`isOsisRole`). Kolom "Menu yang terlihat" adalah
menu dasar per peran (`config.js`); beberapa menu **ditambahkan saat
run-time per orang**, bukan per peran (lihat catatan di bawah tabel).

| Peran | Menu dasar yang terlihat | Ekspor laporan | Mode "Ranking" di Statistik |
|---|---|---|---|
| `admin` | Gerbang, Beranda, Riwayat, Statistik, Rekap Kelas, Pelanggaran, Bimbingan, Upacara, Audit Log, Export, Kelola | Ya, semua jenis & kelas | Ya |
| `bk_kesiswaan` | Gerbang, Beranda, Riwayat, Statistik, Rekap Kelas, Pelanggaran, Bimbingan, Upacara, Export | Ya, kecuali Audit Log | Ya |
| `guru` | Gerbang, Beranda, Riwayat, Statistik, Pelanggaran | Tidak (kecuali jadi wali kelas — lihat bawah) | Tidak |
| `osis` | **Hanya** Upacara (catat + rekap) | Tidak | Tidak |

**Penambahan menu per-orang saat run-time** (`app.js`, bukan `config.js`,
sehingga tidak terlihat sebagai daftar tetap):
- Seorang `guru` yang statusnya **wali kelas** (kolom `Kelas_Wali` di
  `Master_Guru` terisi) otomatis mendapat menu **Rekap Kelas** dan
  **Export Data** tambahan, dibatasi hanya untuk kelasnya sendiri.
- Siapa pun yang termasuk salah satu dari dua kelompok penerima Push
  Notification (wali kelas, atau guru piket bertugas hari itu) otomatis
  mendapat menu **Notifikasi** (pengaturan aktifkan/nonaktifkan), terlepas
  dari perannya.

**Otorisasi ditegakkan di server (Apps Script), bukan hanya di menu UI**
— menyembunyikan menu bukan pengamanan; setiap aksi dicek ulang di
`Code.gs`/`Utils.gs`. Ringkasan aturan per kategori data (dari
`scopeDailyRecordsForUser`, `scopePelanggaranForUser`, `scopeIzinForUser`,
`resolveExportAccess` di `Utils.gs` — dibaca langsung dari kode):

| Kategori | admin / bk_kesiswaan | wali kelas (guru) | guru biasa | osis |
|---|---|---|---|---|
| Keterlambatan & Surat | Seluruh sekolah, semua tanggal | Kelas sendiri (semua tanggal) **+** seluruh sekolah **khusus hari ini** | Seluruh sekolah **hanya hari ini** | Ditolak |
| Pelanggaran | Seluruh sekolah | Kelas sendiri **+** catatan sendiri (semua tanggal) | Catatan sendiri saja (semua tanggal) | Ditolak |
| Bimbingan Khusus | Ya | Tidak | Tidak | Tidak |
| Pelanggaran Upacara (rekap) | Seluruh sekolah | Kelas sendiri | Ditolak (bukan wali kelas → ditolak) | **Seluruh sekolah** (sengaja dilebarkan — lihat catatan di bawah) |
| Izin Keluar — approve (persetujuan) | Ya | Ya (siapa pun, tidak harus wali kelas siswa itu) | Ya | Ditolak |
| Izin Keluar — verifikasi/tandai kembali | Ya, **sebagai cadangan** kalau tidak ada guru piket bertugas | Hanya kalau sedang bertugas piket hari itu (dicek ke `Jadwal_Piket`) | Sama seperti wali kelas | Ditolak |
| Export Data | Semua jenis, semua kelas (kecuali Audit Log utk BK) | Kelas sendiri saja, kecuali laporan Bimbingan Khusus | Ditolak total (tidak ada pemetaan jadwal mengajar di sistem ini) | Ditolak |
| Audit Log | **Admin-only** (BK tidak lagi termasuk) | Ditolak | Ditolak | Ditolak |

Catatan penting yang diverifikasi langsung dari kode (`Code.gs`, fungsi
`getPelanggaranUpacara`): akses OSIS ke rekap Upacara **sengaja dilebarkan
ke seluruh sekolah** (awalnya hanya catatan miliknya sendiri) supaya Rekap
bisa dipakai sebagai alat baca bersama antar petugas upacara — OSIS tetap
terkunci total dari semua kategori disiplin lain (`getLogs`, `getSurat`,
`getPelanggaran`, `getTindakLanjut`, `getBimbingan` semua menolak eksplisit
peran `osis`).

Wewenang verifikasi Izin Keluar **tidak berdasarkan role permanen**,
melainkan **data hari itu** (`Jadwal_Piket`) — seorang admin/BK yang
kebetulan terjadwal piket hari itu diberi label "Guru Piket" di jejak
audit, bukan "BK/Kesiswaan", dan sebaliknya. Ini dihitung ulang di server
setiap kali aksi dipanggil (`izinKapasitasVerifikasi` di `Utils.gs`), tidak
pernah dipercaya dari klaim klien.

---

## 7. Keterbatasan Teknis yang Diketahui

### 7.1 Eksplisit disebutkan di kode/dokumentasi

- **Cetak surat rombongan (Izin Kelompok) belum didukung** — `Code.gs`
  baris ~1450 memuat komentar eksplisit "Cetak kelompok BELUM didukung" dan
  `generateIzinKeluarSuratData` melempar error kalau dipanggil untuk baris
  yang punya `kelompok_id`.
- **Verifikasi keaslian surat izin keluar tidak ada lagi mekanisme
  digital** (QR/URL) sejak dicabut — keasliannya bersandar pada nomor surat
  + nama pihak terkait + stempel waktu saja (lihat Bagian 4.1). Ini
  keputusan produk yang disadari, bukan bug, tapi tetap sebuah keterbatasan
  dibanding rencana awal.
- **Tidak ada pemetaan jadwal mengajar guru** di sistem ini sama sekali
  (disebutkan berulang di `CLAUDE.md` dan komentar `Code.gs`/`Utils.gs`) —
  ini yang membuat "siapa boleh menyetujui izin keluar siswa X" tidak bisa
  dibatasi ke "guru yang sedang mengajar jam itu" (jadwal berubah sewaktu-
  waktu dan tidak ada datanya), dan yang membuat guru biasa (non-wali
  kelas) sama sekali tidak bisa mengekspor laporan.
- **API_TOKEN dikirim oleh semua klien** dan bisa dilihat lewat DevTools
  browser (`config.js`, komentar eksplisit "tidak ada cara benar-benar
  menyembunyikan ini di app statis tanpa bundler") — ini pembatas akses
  dasar (mempersulit bot acak), **bukan** rahasia yang aman secara
  kriptografis. Keamanan sebenarnya bertumpu pada sesi login per pengguna.
- **Rate limiting login bersifat trade-off yang disadari**: sejak dipisah
  jadi limit per-akun (10 kegagalan/5 menit) vs limit global (15
  kegagalan/5 menit untuk jalur tanpa nama dipilih), penyerang yang
  mencoba banyak akun **berbeda** secara bergantian (masing-masing di
  bawah batas per-akun) tidak akan tertangkap oleh limit global lagi.
  `CLAUDE.md` menyatakan eksplisit ini diterima karena sistem memang belum
  pernah punya pertahanan terhadap serangan terdistribusi semacam itu di
  lapisan mana pun (tidak ada rate limit per-IP, tidak ada CAPTCHA).
- **Push notification belum diverifikasi end-to-end ke perangkat fisik**
  dari lingkungan pengembangan manapun — lihat Bagian 3.15.
- **Nama kepanjangan SIGAP tidak konsisten, bahkan di dalam satu file yang
  sama**: `ui-common.js` sendiri memuat **dua** varian berbeda — tagline di
  `LoginScreen` (baris ~257) menuliskan "Sistem Informasi Gerbang & Absensi
  Pelanggaran" (dua frasa: "Gerbang" + "Absensi Pelanggaran"), sedangkan isi
  halaman `TentangSigapPage` (baris ~565) menuliskan "Sistem Informasi
  Gerbang, Absensi, dan Pelanggaran" (tiga item terpisah: Gerbang / Absensi
  / Pelanggaran). `README.md` (judul dokumen) memakai varian pertama,
  `index.html` (`<title>` tab browser) memakai varian kedua. `CLAUDE.md`
  sendiri tidak menuliskan kepanjangan SIGAP sama sekali (hanya
  menyebutnya "a Google Apps Script (GAS) web app..."). Ini temuan
  tekstual langsung dari membandingkan string persis di kode, bukan opini.
- **Fitur foto surat**: kolom `Foto_URL` di `Surat_Masuk` tetap ada tapi
  mati (lihat Bagian 4.2) — bukan bug, tapi peninggalan struktural yang
  perlu diketahui siapa pun yang membaca data mentah sheet ini.

### 7.2 Observasi tambahan (temuan pembaca dokumen ini, BUKAN disebutkan eksplisit di kode — ditandai terpisah sesuai instruksi)

- **Ketergantungan pada CDN pihak ketiga tanpa fallback lokal**: React,
  ReactDOM, Babel Standalone, dan Tailwind semuanya dimuat dari CDN publik
  (`unpkg.com`, `cdn.tailwindcss.com`) di `index.html`. Kalau salah satu
  CDN itu turun atau diblokir jaringan sekolah, aplikasi tidak bisa
  dimuat sama sekali — tidak ada mekanisme fallback/self-host yang
  terlihat di kode. *(Observasi saya — tidak ada komentar di kode yang
  membahas risiko ini secara eksplisit.)*
- **Single point of failure Google Apps Script**: karena backend adalah
  satu Web App Apps Script tunggal (bukan beberapa instance), setiap batas
  kuota Google Apps Script (mis. batas eksekusi harian, batas `UrlFetchApp`,
  batas `LockService`) berlaku sebagai satu titik kegagalan untuk seluruh
  sekolah sekaligus. Saya tidak menemukan penanganan eksplisit untuk
  skenario "kuota Apps Script habis" di kode manapun. *(Observasi saya.)*
- **Ketergantungan waktu eksekusi trigger untuk push notification**: antrean
  `Push_Queue` hanya diproses kalau trigger waktu (`installPushQueueTrigger`)
  benar-benar terpasang dan tidak dihapus secara tidak sengaja dari editor
  Apps Script — tidak ada mekanisme di kode yang memberi tahu admin kalau
  trigger ini berhenti berjalan (CLAUDE.md menyebutkan ini bisa dicek
  manual lewat memeriksa apakah `Push_Queue` menumpuk, tapi tidak ada
  alarm otomatis). *(Sebagian disebutkan di `CLAUDE.md`, saya
  menambahkan catatan "tidak ada alarm otomatis" sebagai observasi saya
  sendiri.)*
- **Tidak ada mekanisme rollback data**: aksi "Pemeliharaan Data" (hapus
  data operasional lama) punya pratinjau wajib sebelum eksekusi, tapi
  begitu dieksekusi, saya tidak menemukan mekanisme *undo*/backup otomatis
  di kode — pemulihan bergantung pada fitur riwayat versi bawaan Google
  Sheets di luar aplikasi ini. *(Observasi saya.)*
- **Class-name matching bersifat "toleran", berpotensi ambigu**:
  `sameClass()`/`normalizeClass()` (di `Utils.gs` dan `helpers.js`,
  dijaga sinkron manual sebagai dua salinan terpisah di dua bahasa
  berbeda — bukan satu sumber kebenaran tunggal) mencocokkan nama kelas
  secara toleran (menormalisasi format penulisan). Ini nyaman untuk
  variasi pengetikan, tapi berarti dua nama kelas yang *seharusnya*
  berbeda namun kebetulan ternormalisasi sama berpotensi tercampur secara
  tidak sengaja. Saya tidak menemukan test yang secara eksplisit menguji
  kasus tabrakan seperti ini (test yang ada menguji variasi ejaan kelas
  yang *sama*, bukan potensi tabrakan antar kelas yang berbeda).
  *(Observasi saya — perlu diverifikasi manual dengan daftar kelas nyata
  sekolah kalau ingin memastikan tidak ada tabrakan.)*

---

## 8. Riwayat Perubahan Penting

Ringkasan dari `git log` (154 commit yang bisa ditelusuri dari clone ini,
non-merge, diurutkan dari terbaru), difokuskan ke perubahan substansial —
bukan setiap commit kecil. Tanggal memakai zona waktu commit.

| Periode | Perubahan besar |
|---|---|
| 2026-08-03 s.d. 08-04 | Titik awal riwayat yang terlihat dari clone ini: fitur Rekap Kelas, "Design System" internal (komponen `Card`/`RowCard`/`Button` terpusat), migrasi tampilan Beranda/Statistik/Admin ke design system tsb. |
| 2026-08-03 | Fitur **Tindak Lanjut** siswa sering terlambat ditambahkan. |
| 2026-08-07 | `LockService` ditambahkan di `Code.gs` untuk mencegah race condition pada tulis-konkuren ke sheet. |
| 2026-08-08 s.d. 08-09 | Restrukturisasi **Kelola** jadi hub 3-kartu (Guru/Jadwal/Pemeliharaan); password di-*salt*, `Audit_Log` & logging error dilengkapi, test suite mulai dibangun. |
| 2026-08-10 s.d. 08-11 | `CLAUDE.md` mulai ditulis; rate limiting login ditambahkan; **fitur foto surat dicabut total** (lihat Bagian 4.2); `clasp` disiapkan untuk deploy backend. |
| 2026-08-18 | Audit desain besar ("Modern Academic Utility" — token warna & tipografi baru); migrasi ikon emoji fungsional ke SVG; **sakelar keyboard ABC/123 dicabut**; berbagai perbaikan bug BottomNav/Header. |
| 2026-08-19 s.d. 08-22 | Perbaikan bug sesi (**"logout mendadak setelah login"**, paling terasa di PWA Home Screen iOS — akar masalahnya *stale response* dari sesi lama menimpa sesi baru); batas umur sesi dikembalikan tegas ke 6 jam. |
| 2026-08-24 | **RBAC dipersempit signifikan**: Riwayat & Pelanggaran dibatasi cakupan bacanya di server (sebelumnya semua data terkirim ke klien dan hanya disaring di UI); **Audit Log dipersempit jadi admin-only**; fitur **Export Data** (PDF/Excel) ditambahkan; penanda versi backend (`BACKEND_VERSION`) ditambahkan. |
| 2026-08-25 | Fitur besar: **Izin Keluar/Pulang (BETA)** ditambahkan pertama kali di Gerbang; lalu di hari yang sama ditambah **Izin Kelompok** (rombongan), badge "pekerjaan menunggu saya", notifikasi ringkasan di Beranda, **penghapusan langkah "Tutup Transaksi"** (lihat Bagian 4.3), dan perbaikan kapasitas verifikasi Guru Piket vs BK/Kesiswaan. |
| 2026-08-26 | Audit keamanan/konkurensi untuk Izin Khusus dan Izin Keluar/Kelompok (bukti lock, isolasi sesi/cache). |
| 2026-08-31 | "Hapus Data per Bulan/Tahun" diperluas jadi **Pemeliharaan Data** lintas kategori (bukan hanya surat). |
| 2026-09-01 | Rate limit login dipisah **per-akun vs global** (lihat Bagian 6/7); fitur **Ganti Password Sendiri** untuk semua peran; dokumentasi `API.md`/`README.md`/`SCHEMA.md` ditambahkan; deteksi *drift* versi backend otomatis (bukan auto-deploy) ditambahkan. |
| 2026-09-02 | Fitur besar: **Web Push Notification** (VAPID) untuk wali kelas & guru piket ditambahkan, lengkap dengan fungsi serverless `api/push-send.js` di Vercel. |
| 2026-09-03 | Devcontainer untuk akses `clasp`/GitHub Codespaces ditambahkan; **label BETA Izin Keluar dicabut**, fitur **Cetak Surat Izin Keluar** (PDF via print browser) ditambahkan. |
| 2026-09-04 | Beberapa iterasi surat izin keluar berdasar umpan balik lapangan (desain ulang jadi surat dinas formal, penyederhanaan tombol unduh jadi satu tombol Print); **verifikasi QR dicabut total** (lihat Bagian 4.1); perbaikan bug pengguna Android yang terjebak di versi lama aplikasi (root cause: `index.html` sendiri ter-cache lama oleh browser/proxy operator, di luar skema `?v=` yang sudah ada). |
| 2026-09-05 s.d. 09-06 | Rapikan UI kecil; optimasi performa (**cache hasil transpile Babel + daftar guru login di `localStorage`** supaya buka aplikasi berulang lebih cepat); **fitur atribusi pengembang & halaman "Tentang SIGAP"** ditambahkan (PR #58 — dokumen ini ditulis tak lama setelah PR ini digabungkan). |

---

## 9. Versi dan Tanggal

- **Tidak ada nomor versi semver di `package.json`** — file itu tidak
  memiliki field `"version"` sama sekali (diverifikasi langsung: `grep
  version package.json` tidak menghasilkan apa pun).
- **Label versi yang benar-benar dipakai & terlihat pengguna**: `v2026.09`
  — muncul di footer atribusi (`ui-common.js`, komponen `AppFooter`),
  halaman "Tentang SIGAP", `README.md`, dan `CLAUDE.md` (bagian
  Kredit/Attribution). Ini format `vYYYY.MM`, bukan semver.
- **Penanda versi backend** (`BACKEND_VERSION` di `Code.gs`, baris 25, per
  commit `175c8a9`): string deskriptif bertanggal —
  `'2026-09-04-logo-surat-base64'`. Ini **bukan** nomor versi resmi
  aplikasi, melainkan penanda internal untuk memverifikasi deployment
  Apps Script mana yang sedang aktif melayani (lihat Bagian 2).
- **Penanda versi bundle frontend** (`BUILD_VERSION` di `index.html`, per
  commit `175c8a9`): angka `61` — penghitung manual untuk *cache-busting*
  file `.js`, dinaikkan setiap deploy yang mengubah isi file `.js` mana
  pun. Ini juga **bukan** nomor versi aplikasi, murni mekanisme cache.
- **Commit HEAD `main` pada saat dokumen ini ditulis**: `175c8a9` ("Add
  developer attribution footer and Tentang SIGAP page (#58)").
- **Tanggal dokumen ini dibuat**: 2026-09-06.

---

*Dokumen ini dibuat oleh Claude Code berdasarkan pembacaan langsung kode
sumber repo `Sigap-app` pada commit di atas. Kalau kode berubah setelah
tanggal ini, dokumen ini perlu ditinjau ulang dengan cara yang sama
(baca kode langsung, jangan asumsi dari versi dokumen ini).*
