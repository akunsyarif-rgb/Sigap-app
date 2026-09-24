# SIGAP — Status Proyek

_Disusun 14 September 2026. Semua klaim di bawah diverifikasi langsung ke
`git log`/isi file pada `origin/main`, hasil run GitHub Actions
(`check-backend-drift.yml`), dan GitHub API (PR list) — bukan dari ingatan
sesi sebelumnya. Sumber untuk tiap baris disebutkan (commit hash / PR / file)._

---

## 0. Ringkasan versi (baca ini dulu)

| | Nilai | Sumber |
|---|---|---|
| `BACKEND_VERSION` di `Code.gs` pada `origin/main` HEAD | `2026-09-14-dedup-pelanggaran-upacara` | commit `9d9db59` (HEAD main), `Code.gs:25` |
| Cek CI sebelumnya (08:20 UTC, sebelum PR #79 di-deploy manual) | `2026-09-13-scope-pelanggaran-count` | GitHub Actions run [`check-backend-drift.yml` #30](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34822227695), job `check-drift`, 14 Sep 2026 08:20:43 UTC — log: `Backend live sudah sinkron dengan main (versi "2026-09-13-scope-pelanggaran-count")` |
| Cek CI berikutnya (09:50 UTC, otomatis setelah PR #79 merge, sebelum deploy manual) | **Gagal/tidak konklusif** — status ping timeout (`curl: (28) Operation timed out`), bukan bukti drift | run [`check-backend-drift.yml` #31](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34830077702), 14 Sep 2026 09:50 UTC |
| **Versi live saat ini — terkonfirmasi ulang via CI** | `2026-09-14-dedup-pelanggaran-upacara` — **sama dengan `BACKEND_VERSION` di `main` HEAD** | GitHub Actions run [`check-backend-drift.yml` #32](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34852081042), dipicu manual (`workflow_dispatch`) 14 Sep 2026 13:53:54 UTC, job `check-drift` — log: `Backend live sudah sinkron dengan main (versi "2026-09-14-dedup-pelanggaran-upacara")` |
| PR terbuka | **0** (tidak ada) | GitHub API `list_pull_requests(state=open)` pada `akunsyarif-rgb/sigap-app`, dicek langsung saat penyusunan dokumen ini |

**Catatan verifikasi:** run #31 (otomatis, dipicu push PR #79) sempat gagal
karena timeout jaringan ke `script.google.com` — bukan bukti drift, tapi
juga bukan konfirmasi. Untuk memastikan status deploy manual yang Anda
lakukan, run `check-backend-drift.yml` dipicu ulang secara manual
(`workflow_dispatch`) pada 14 Sep 2026 13:53 UTC dan **berhasil** (tidak
timeout) — run #32 di atas adalah bukti independen bahwa backend live
sudah sinkron dengan `main` HEAD saat ini. Angka di baris ini bukan lagi
sekadar pernyataan Anda, melainkan hasil pengecekan CI yang benar-benar
berjalan dan berhasil membaca status ping.

---

## 1. Fitur Selesai (per kategori status)

### a) LIVE DI PRODUKSI
_(kode ada di `main` **dan** sudah di-deploy ke backend live — seluruh item_
_di bawah ini, termasuk PR #79, dikonfirmasi via CI (`check-backend-drift.yml`_
_run #32, lihat §0). Untuk fitur frontend-only, "live" berarti sudah_
_ter-deploy otomatis ke Vercel karena setiap push ke `main` men-deploy_
_static site tanpa langkah manual, per `CLAUDE.md`)_

| Fitur | Status | PR/commit |
|---|---|---|
| Login dua jalur (pilih guru / fallback password legacy) + cache `getLoginUsers` di client | Live | #29, audit performa lanjutan (tanpa nomor PR eksplisit di merge, lihat commit history `helpers.js`) |
| Rate limit login terpisah global vs per-akun | Live | disebutkan di `Utils.gs` (audit Agustus 2026) |
| Sesi 1-key `localStorage` + `sessionExpiresAt` sinkron server | Live | perbaikan logout mendadak, PR #33 |
| RBAC baca Keterlambatan/Surat/Pelanggaran (`scopeDailyRecordsForUser`/`scopePelanggaranForUser`) | Live | PR #36 (dasar), diperketat lagi lewat #71 |
| **OSIS Rekap Upacara: nisn+catatan dipangkas dari payload** | Live | PR #70 (`ad462fa`/`269f1e6`) |
| **`getPelanggaranCountForStudent`/`getStudentLateHistory` dibatasi scope pemanggil** (fix celah enumerasi) | Live | PR #71 (`d9b9ee0`/`62f06cb`) — BACKEND_VERSION live saat ini persis dari commit ini |
| Export Data (PDF/XLSX) + RBAC export | Live | PR #36 |
| Audit Log admin-only | Live | seiring PR #36 |
| Izin Keluar individual (approve → verifikasi → tandai kembali/pulang, one-step close) | Live | PR #38 (dasar), #52–#55 (Cetak Surat), penyempurnaan lanjutan |
| Izin Kelompok (satu aktivitas, banyak siswa) | Live | menyusul feature Izin Keluar, lihat `Izin_Kelompok` di `SCHEMA.md` |
| Hapus per-transaksi Izin Keluar (guru piket/BK/admin, jendela 5 menit) | Live | PR #62 (`874dbbd`) |
| Cetak Surat Izin Keluar (nomor otomatis, logo base64, HTML escaping) — **BETA sudah dicabut** | Live | `a828ab5` (3 Sep 2026, hapus label BETA + fitur cetak) |
| QR/verifikasi online pada surat — **dihapus lagi**, bukan fitur aktif | N/A (dibangun lalu dicabut) | `cf4f715` — jangan dibangun ulang tanpa baca catatan di `CLAUDE.md` |
| Push Notification (Web Push/VAPID) — logika server (`Notifikasi.gs`) & queue | Live secara kode, **tapi aktivasi end-to-end perlu 7 langkah manual satu-kali** (VAPID key, env Vercel, Script Properties, `installPushQueueTrigger()`) — lihat catatan "perlu verifikasi lebih lanjut" di bawah | fitur besar, tanpa satu nomor PR (multi-PR) |
| Catat Pelanggaran Kelompok — **Fase 2a, satu kelas saja** | Live | PR #67 (`45cb640`/`75c7132`), BACKEND_VERSION dinaikkan via PR #68 (`d13eb58`) |
| Ganti Password + cabut sesi lain saat ganti password | Live | PR #69 (`479be2f`/`1825e5f`) |
| Label "Sanksi" → "Tindakan" (Pelanggaran) | Live | `a00e8fb` |
| Rotasi `API_TOKEN` | Live (kode) — **cek manual apakah Script Properties API_TOKEN sudah disamakan**, lihat catatan `STATUS_PENDING_DEPLOY.md` (sudah dihapus) | `c9b5efd` |
| Tombol Refresh di tab Gerbang "Aktivitas Hari Ini" (frontend-only) | Live (auto-deploy Vercel) | PR #78 (`c7cd75c`) |
| Tentang SIGAP / Kredit footer | Live | disebut di `CLAUDE.md`, `tests/attribution.test.js` |
| PWA shell (manifest, service worker minimal, ikon) | Live | menyertai fitur Push Notification |
| **Cegah duplikat Pelanggaran Upacara** (guard server NISN+jenis+hari sama ditolak di `addPelanggaranUpacara`, + tombol Simpan terkunci saat request berjalan di klien) | Live — dikonfirmasi via CI run [`check-backend-drift.yml` #32](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34852081042) (14 Sep 2026 13:53 UTC) | PR #79 (`9d9db59`) |

### b) DI MAIN TAPI BELUM TER-DEPLOY (backend)
_(BACKEND_VERSION di `main` > versi live yang terkonfirmasi)_

**Tidak ada saat ini.** `BACKEND_VERSION` di `main` HEAD
(`2026-09-14-dedup-pelanggaran-upacara`, commit `9d9db59`/PR #79) sudah
dikonfirmasi **sinkron dengan backend live** lewat CI run #32 (lihat §0) —
tidak ada gap antara `main` dan backend live saat dokumen ini disusun.

### c) MASIH DI PULL REQUEST TERBUKA (belum merge)

**Tidak ada.** Dicek langsung via GitHub API
(`list_pull_requests` dengan `state=open` pada `akunsyarif-rgb/sigap-app`)
saat penyusunan dokumen ini: hasilnya kosong (0 PR terbuka).

---

## 2. Struktur File

### Backend (Google Apps Script, `*.gs`)
| File | Fungsi |
|---|---|
| `Code.gs` | Router utama — seluruh `doPost`/`doGet`, semua action (login, record, izin keluar, export, hapus data, dll.) |
| `Auth.gs` | Sesi (`createSession`/`getSessionUser`), verifikasi password (legacy + salted), helper role |
| `Utils.gs` | `jsonOut`, `checkToken`, hashing password, `sameClass`, `logAudit`, `getRowsSince`, rate limit login, fungsi scoping RBAC (`scopeDailyRecordsForUser`, `scopePelanggaranForUser`, `scopeIzinForUser`), helper Izin Keluar/Kelompok, `resolveExportAccess`, dll. |
| `Notifikasi.gs` | Engine notifikasi push: `resolvePushRecipients`, `notifyRelevantUsers`, `processPushQueue`, `pushSalinan` (teks notifikasi privacy-safe) |

### Frontend (dimuat berurutan lewat `index.html`, tanpa bundler)
| File | Fungsi |
|---|---|
| `config.js` | `API_URL`/`API_TOKEN`, `ROLES` (menu per peran), `NAV_ITEMS`, `VAPID_PUBLIC_KEY` |
| `helpers.js` | Fungsi murni: format tanggal, period math, chart data, CSV export, cache login users, dll. |
| `export-format.js` | Penulis PDF/XLSX tangan (tanpa dependency eksternal) |
| `ui-common.js` | Komponen kecil bersama (Badge, stat card, chart), `LoginScreen`, Header, BottomNav, `AppFooter`, `TentangSigapPage` |
| `admin.js` | Tab Admin (Kelola Guru & Akun, Hapus Data, dll.) |
| `beranda-riwayat.js` | Tab Beranda + Riwayat |
| `statistik.js` | Tab Statistik |
| `gerbang.js` | Tab Gerbang (Keterlambatan, Izin Keluar individual & kelompok) |
| `pelanggaran-bimbingan-upacara.js` | Tab Pelanggaran, Bimbingan Khusus, Upacara |
| `rekap-kelas.js` | Rekap Kelas (termasuk kategori Upacara) |
| `export-data.js` | Tab Export Data |
| `notifikasi.js` | Onboarding & pengaturan Push Notification, logika `pushIsEligible`, dll. |
| `app.js` | Root component `App()` — routing tab, fetch data, session lifecycle, poll versi `index.html` |
| `api/push-send.js` | Fungsi serverless Vercel (Node) — signing/enkripsi VAPID untuk Web Push, tidak tahu apa pun soal data siswa |

### Dokumentasi
| File | Fungsi |
|---|---|
| `CLAUDE.md` | Panduan arsitektur & histori keputusan untuk Claude Code (sumber utama konteks proyek) |
| `README.md` | Overview proyek + Kredit/Attribution |
| `docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md` | Panduan fitur untuk pengguna awam (guru/BK/OSIS) — **⚠️ ada bagian yang sudah usang, lihat Backlog #4 di bawah** |
| `API.md` | Referensi endpoint `doGet`/`doPost` |
| `SCHEMA.md` | Struktur sheet Google Sheets (kolom per sheet) |
| `DEPLOYMENT_CHECKLIST.md` | Checklist manual sebelum/saat deploy `.gs` via clasp |
| `TESTING_CHECKLIST_AFTER_DEPLOY.md` | Checklist tes manual pasca-deploy (khusus fitur Izin Keluar/Cetak Surat) — punya bagian "Belum diputuskan" (lihat Backlog) |

### Test (`tests/*.test.js`, dijalankan `node --test`)
28 file test — mencakup: password/hashing, login, sesi & konkurensi, RBAC
riwayat/pelanggaran, export (backend+frontend), Izin Keluar/Kelompok/Cetak
Surat, hapus data, Pelanggaran Kelompok, rekap upacara, push
notification/frontend, atribusi, bundle cache `index.html`, clasp
credentials/target/deploy-workflow ordering, dan render-smoke untuk semua
tab. Rincian lengkap ada di `CLAUDE.md` bagian "Tests".

### Config / Infra
| File | Fungsi |
|---|---|
| `.clasp.json.example` | Template config clasp (per-checkout, `scriptId` asli tidak dikomit) |
| `.claspignore` | Batasi `clasp push` hanya ke file `.gs` + `appsscript.json` |
| `.github/workflows/test.yml` | CI: `npm install && npm test` di setiap push/PR ke `main` |
| `.github/workflows/deploy-gas.yml` | CI opt-in manual (`workflow_dispatch`) untuk push+deploy `.gs` via clasp |
| `.github/workflows/check-backend-drift.yml` | CI read-only: bandingkan `BACKEND_VERSION` live vs `main`, jalan tiap push ke `.gs` + jadwal harian |
| `.github/scripts/*.js` | Script pendukung clasp (cek kredensial, verifikasi target deploy, deploy ke deployment existing, cek drift) |
| `vercel.json` | Header cache untuk `index.html` (`no-cache, no-store, must-revalidate`) |
| `manifest.json`, `sw.js`, `icons/*` | Shell PWA untuk Push Notification |
| `package.json` / `package-lock.json` | Dependency (`@babel/core`, `web-push`, `@google/clasp`, dll.) — tidak ada build step frontend |
| `.devcontainer/devcontainer.json` | Konfigurasi GitHub Codespaces (Node 20) untuk akses clasp interaktif |

---

## 3. Backlog Teknis

Item di bawah **tercatat eksplisit** di kode/dokumentasi — bukan tebakan.

1. **Pelanggaran Kelompok lintas kelas (Fase 2b) — ditunda.**
   Fitur saat ini (Fase 2a, PR #67) hanya mendukung satu insiden untuk siswa
   dari **satu kelas yang sama**; lintas kelas ditolak di server
   (`addPelanggaranKelompok`, `Code.gs`).
   **Kenapa ditunda:** mendukung lintas kelas butuh struktur data baru
   (kegiatan-induk + baris-per-siswa, mirip `Izin_Kelompok`) **dan** aturan
   scoping baru yang filosofinya beda dari `scopePelanggaranForUser`/
   `scopeIzinForUser` yang sudah ada (keduanya menyaring per-baris
   berdasarkan kelas barisnya sendiri, bukan "tampilkan semua peserta ke
   wali kelas mana pun yang terlibat") — belum ada presedennya di
   codebase ini.
   **Catatannya ada di:** `Utils.gs` baris ~368–393 (komentar block "PELANGGARAN
   KELOMPOK (Fase 2a — SATU kelas saja)").
   **Solusi sementara:** kasus lintas kelas tetap dicatat manual satu per satu
   lewat `addPelanggaran` individual.

2. **Tombol hapus untuk seluruh grup Izin Kelompok sekaligus — belum dibuat.**
   `deleteIzinKeluar` (backend) sudah generik dan sudah bisa menangani
   penghapusan baris kelompok (termasuk cascade cleanup lewat
   `cleanupOrphanedIzinKelompok`), tapi tombol hapus di UI **hanya
   ditempatkan** di kartu Izin Keluar individual (`KartuIzinKeluar`,
   `gerbang.js`) — tidak ada di `KartuKelompok`/`IzinKelompokPanel`.
   **Kenapa ditunda:** disebut eksplisit "di luar cakupan untuk pass ini" saat
   fitur hapus per-transaksi dibangun.
   **Catatannya ada di:** `CLAUDE.md` bagian "Hapus per-transaksi (audit
   September 2026)", paragraf terakhir.

3. **Cetak surat untuk transaksi Izin Keluar yang sudah selesai di
   hari-hari sebelumnya — keputusan produk belum diambil.**
   Layar Gerbang → Izin Keluar hanya menampilkan bucket "Selesai Hari Ini"
   untuk **hari ini saja**, jadi tombol cetak tidak reachable dari UI untuk
   transaksi yang selesai beberapa hari lalu — meski backend
   (`generateIzinKeluarSurat`) sebenarnya sanggup memprosesnya kapan saja
   (tidak ada expiry).
   **Kenapa ditunda:** masih menunggu keputusan — cukup diterima apa
   adanya, atau perlu ditambah jalur cetak dari menu Riwayat juga.
   **Catatannya ada di:** `TESTING_CHECKLIST_AFTER_DEPLOY.md`, bagian
   "7. Belum diputuskan (bukan bug, keputusan produk tertunda)".

4. **QR/verifikasi online pada surat Izin Keluar — dibangun, lalu sengaja
   dicabut (bukan backlog untuk dilanjutkan, tapi keputusan yang harus
   diketahui sebelum ada yang mencoba membangunnya lagi).**
   `generateVerificationURL`, `generateQRCodeImage`, dan action
   `verifyIzinSurat` sudah **dihapus total** dari `Code.gs` (bukan
   dinonaktifkan). **Kenapa dicabut:** gagal berulang kali di uji lapangan
   (QR tidak render — kemungkinan besar celah otorisasi `UrlFetchApp` saat
   deploy manual copy-paste, tidak pernah dikonfirmasi pasti), dan alternatif
   berbasis link teks dianggap terlalu lambat dipakai — sekolah memutuskan
   fitur verifikasi dicabut sepenuhnya, bukan diganti.
   **Catatannya ada di:** `CLAUDE.md` bagian "Cetak Surat Izin Keluar", commit
   `cf4f715` ("Remove QR/verification from Cetak Surat Izin (product
   decision)"). **Jangan dibangun ulang tanpa membaca catatan ini** — kalau
   dibangun ulang, perlu memastikan otorisasi `UrlFetchApp` end-to-end di
   deployment nyata dulu.

5. **Dokumentasi `docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md` sudah usang di
   bagian Izin Keluar/Cetak Surat — bukan keputusan yang ditunda, tapi
   temuan yang perlu ditindaklanjuti.**
   Dokumen ini (terakhir diubah `f8fe850`, 8 September 2026) masih
   mengklaim: "Fitur Izin Keluar masih BETA dan seluruhnya digital... belum
   dirancang sama sekali" (baris ~364) dan menyebut status BETA di baris
   ~94/~144. Padahal label BETA sudah dicabut dan fitur cetak (nomor
   otomatis, logo, dll.) sudah shipped sejak commit `a828ab5` (3 September
   2026) — **5 hari sebelum** dokumen ini terakhir disentuh. Ini bukan item
   "sengaja ditunda", melainkan dokumentasi yang perlu disinkronkan ulang
   dengan `CLAUDE.md`.
   **Update (24 September 2026): sudah disinkronkan** — label BETA dihapus
   dari panduan, README, dan API.md; bagian "Soal cetak" kini menjelaskan
   Cetak Surat Izin lewat dialog cetak peramban (status *Sedang di Luar* &
   *Selesai Hari Ini*, bukan *Menunggu Verifikasi*).

6. **Push Notification — verifikasi end-to-end ke perangkat fisik belum
   pernah dilakukan dari lingkungan pengembangan mana pun** (bukan "ditunda"
   dalam arti keputusan produk, tapi keterbatasan lingkungan yang tercatat
   eksplisit).
   Seluruh logika (siapa penerima, kapan dikirim, isi pesan privacy-safe,
   idempotensi) sudah diuji otomatis lewat `doPost`/`doGet`/
   `processPushQueue()` dengan `UrlFetchApp` di-stub. Yang **belum pernah**
   diverifikasi: pengiriman push sungguhan ke Android/iPhone fisik saat
   SIGAP ditutup total, karena tidak ada deployment Vercel nyata, VAPID key
   asli, atau perangkat fisik di lingkungan pengembangan.
   **Catatannya ada di:** `CLAUDE.md` bagian "Verified vs. not verified in
   this environment" (Push Notification), langkah proof-of-concept manual
   yang harus dijalankan seseorang di sekolah.

**Item yang DISEBUT di prompt tapi TIDAK ditemukan tercatat di repo ini**
(perlu verifikasi lebih lanjut ke Anda langsung, bukan diasumsikan ada):
- "Offline/retry" sebagai fitur/keputusan tertunda — tidak ditemukan
  referensi eksplisit di `CLAUDE.md`/kode/riwayat commit.
- "Optimisasi lock global (`sigapLock`)" sebagai backlog — yang ditemukan
  hanya catatan bahwa lock **sengaja dipegang penuh** (bukan dilepas
  lebih awal) sejak QR dicabut (`CLAUDE.md`, bagian "Cetak Surat Izin
  Keluar"); tidak ada catatan rencana optimisasi lebih lanjut yang tertunda.
- "Replication Kit" — tidak ditemukan satu pun referensi di seluruh
  `git log --all`, kode, atau dokumentasi repo ini.

---

## Catatan penutup soal konsistensi versi live

Anda menyatakan sudah men-deploy manual `Code.gs` untuk perubahan PR #79
(dedup Pelanggaran Upacara). Klaim itu **sudah diverifikasi ulang secara
independen**, bukan hanya diterima apa adanya:

- `check-backend-drift.yml` dipicu ulang secara manual
  (`workflow_dispatch`) pada 14 Sep 2026 13:53 UTC.
- Run tersebut **berhasil** (tidak timeout seperti percobaan otomatis
  sebelumnya) — lihat run [`#32`](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34852081042).
- Hasilnya: `Backend live sudah sinkron dengan main (versi
  "2026-09-14-dedup-pelanggaran-upacara")` — **persis sama** dengan
  `BACKEND_VERSION` di `main` HEAD (`9d9db59`).

Jadi tidak ada gap antara `main` dan backend live saat ini, dan kesimpulan
ini punya bukti CI yang berjalan nyata di run #32 — bukan lagi sekadar
pernyataan Anda yang saya kutip tanpa verifikasi tambahan.
