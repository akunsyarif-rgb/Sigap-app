# HANDOVER — SIGAP

> **Status: DRAFT.** Dokumen ini dibuat untuk mengisi celah yang teridentifikasi
> saat audit keberlanjutan (September 2026): seluruh akun/layanan yang menjalankan
> SIGAP saat ini kemungkinan besar terdaftar atas nama pribadi, bukan institusi —
> lihat bagian 6. Isi bagian yang ditandai `[ISI: ...]` sebelum dokumen ini
> dianggap final, lalu simpan salinannya di tempat yang bisa diakses admin lain
> (bukan cuma di repo ini — kalau akses GitHub ikut hilang, dokumen ini pun ikut
> tidak terjangkau).

---

## 1. Apa Dokumen Ini dan Untuk Siapa

Dokumen ini untuk orang yang **mengambil alih pengelolaan teknis SIGAP** —
baik karena pengelola saat ini pindah tugas, atau sekadar butuh admin cadangan.
Ini BUKAN panduan pemakaian aplikasi (itu ada di
[`docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md`](docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md))
dan bukan dokumentasi teknis mendalam (itu ada di [`CLAUDE.md`](CLAUDE.md)).
Dokumen ini murni: **layanan apa saja yang dipakai, siapa yang punya akses,
dan langkah konkret memindahkannya.**

| Peran | Nama | Kontak | Sejak |
|---|---|---|---|
| Pengelola teknis saat ini | `[ISI: nama]` | `[ISI: email/telepon]` | `[ISI: tanggal]` |
| Admin cadangan | `[ISI: nama — WAJIB diisi, lihat bagian 6]` | `[ISI]` | — |
| Penanggung jawab di sekolah (mis. Wakasek Kurikulum/Kesiswaan) | `[ISI]` | `[ISI]` | — |

---

## 2. Peta Layanan — Apa, Di Mana, Siapa Pemiliknya

SIGAP jalan di atas **empat** akun/layanan terpisah. Kehilangan akses ke
**salah satu saja** bisa melumpuhkan sebagian atau seluruh sistem.

| # | Layanan | Fungsi di SIGAP | Pemilik akun saat ini | Jenis akun |
|---|---|---|---|---|
| 1 | **Google Account** (Sheet + Apps Script) | Database (Google Sheet) + backend (`Code.gs` dkk sebagai Web App) | `[ISI: alamat email Google yang dipakai]` | `[ISI: Gmail pribadi / Google Workspace sekolah?]` |
| 2 | **GitHub** | Kode sumber (repo ini), CI (test otomatis), riwayat perubahan | `akunsyarif-rgb` (akun personal GitHub) | Personal |
| 3 | **Vercel** | Hosting frontend statis + fungsi serverless `api/push-send.js` (relay Web Push) | `conandoyle1` (akun personal Vercel — terlihat dari URL preview deployment) | Personal |
| 4 | **VAPID keypair** (Web Push) | Identitas pengirim notifikasi push, disimpan di Vercel (env var) + Apps Script (Script Properties) | Diterbitkan oleh `[ISI: siapa]` | — (bukan akun, tapi sepasang kunci kripto yang perlu diketahui siapa yang generate) |

**Kenapa ini berisiko** (bukan sekadar formalitas): repo GitHub dan project
Vercel di atas terdaftar atas nama akun personal, bukan organisasi/tim milik
sekolah. Google Account yang memegang Sheet + Apps Script belum dikonfirmasi
jenisnya. Kalau akun personal yang dipakai kehilangan akses (lupa password,
di-suspend, atau pemiliknya memang tidak lagi bisa dihubungi) **tanpa** proses
transfer di bawah sudah dijalankan lebih dulu, sekolah berisiko kehilangan
akses ke kode, hosting, DAN data sekaligus.

---

## 3. Kredensial & Konfigurasi yang Perlu Diketahui Admin Pengganti

**Jangan tulis nilai aslinya di file ini** (ini dokumen yang akan disimpan
di repo/dibagikan) — cukup catat **di mana** nilainya tersimpan, siapa yang
pegang salinannya di luar repo (mis. password manager bersama), dan kapan
terakhir diverifikasi.

| Nama | Tersimpan di | Dipegang di luar repo oleh | Terakhir diverifikasi |
|---|---|---|---|
| `API_TOKEN` (token API SIGAP) | `config.js` (memang publik, dikirim tiap request dari browser) | — (tidak rahasia, lihat CLAUDE.md soal `config.js`) | — |
| `scriptId` (Apps Script) | `.clasp.json` (gitignored, per-checkout) | `[ISI]` | `[ISI]` |
| `CLASP_DEPLOYMENT_ID` | Dicatat manual (`npx clasp deployments`), tidak di repo | `[ISI]` | `[ISI]` |
| `CLASP_CREDENTIALS`, `CLASP_SCRIPT_ID`, `CLASP_DEPLOYMENT_ID` (GitHub Actions secrets, untuk `deploy-gas.yml`) | GitHub repo Settings → Secrets | `[ISI]` | `[ISI]` |
| `VAPID_PUBLIC_KEY` | `config.js` (publik) | — | — |
| `VAPID_PRIVATE_KEY` | Vercel env var (project frontend) | `[ISI]` | `[ISI]` |
| `VAPID_SUBJECT` (email kontak `mailto:`) | Vercel env var | `[ISI]` | `[ISI]` |
| `PUSH_RELAY_SECRET` | Vercel env var **dan** Apps Script Script Properties (harus identik di keduanya) | `[ISI]` | `[ISI]` |
| Password login guru (hash+salt) | Google Sheet `Master_Guru`, kolom H (salt) — lihat [`SCHEMA.md`](SCHEMA.md) | — (hash, bukan plaintext) | — |

---

## 4. Langkah Transfer Kepemilikan

Jalankan bagian yang relevan sesuai urgensi. Semua langkah di bawah **tidak
mengganggu layanan yang sedang berjalan** kalau dilakukan dengan benar (tidak
perlu mematikan SIGAP saat proses transfer).

### 4a. GitHub

1. Idealnya: pindahkan repo ke **GitHub Organization** milik sekolah (bukan
   akun personal). Dari repo Settings → General → Danger Zone → Transfer
   ownership.
2. Kalau belum ada organisasi, minimal: tambahkan admin cadangan sebagai
   **Collaborator** dengan akses Admin di repo Settings → Collaborators.
3. Repository secrets (`CLASP_CREDENTIALS` dkk) **tidak ikut pindah otomatis**
   saat transfer — harus diisi ulang manual di tempat baru (lihat
   `.github/scripts/check-clasp-credentials.js` untuk bentuk yang diharapkan).

### 4b. Vercel

1. Pindahkan project ke **Vercel Team** (bisa dibuat gratis untuk beberapa
   anggota), bukan akun personal — Project Settings → General → Transfer.
2. Tambahkan admin cadangan sebagai anggota Team dengan role yang bisa ubah
   env vars & redeploy.
3. Environment variables (`VAPID_PRIVATE_KEY`, `PUSH_RELAY_SECRET`, dst.)
   **ikut pindah** kalau transfer dilakukan lewat fitur Transfer bawaan
   Vercel (bukan bikin project baru dari nol) — pastikan pilih opsi ini,
   bukan clone manual.
4. Domain kustom (kalau ada) perlu dicek ulang DNS-nya setelah transfer.

### 4c. Google Account (Sheet + Apps Script)

Ini yang **paling kritis** karena di situ semua data siswa tersimpan.

1. **Kalau akun yang dipakai sekarang adalah akun pribadi**: langkah paling
   aman adalah memindahkan Google Sheet ke akun Google Workspace sekolah
   (kalau sekolah punya), lalu bikin ulang project Apps Script yang terikat
   ke Sheet itu — bukan sekadar "Share" Sheet-nya, karena Apps Script Web App
   URL & Script Properties (termasuk `PUSH_RELAY_SECRET`) tetap melekat ke
   project lama.
2. **Minimal, kalau pindah akun belum memungkinkan sekarang**: tambahkan
   admin cadangan sebagai **Editor** di Google Sheet-nya, dan sebagai
   **Editor project** di Apps Script (Apps Script editor → ikon Share/orang
   di pojok kanan atas → tambahkan email admin cadangan dengan akses Edit).
   Ini tidak memindahkan kepemilikan, tapi memastikan lebih dari satu orang
   bisa mengelola kalau terjadi sesuatu ke pemilik utama.
3. Setelah pindah/tambah akses, jalankan checklist di
   [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md) untuk memastikan
   deployment tetap ke URL Web App yang sama (`CLASP_DEPLOYMENT_ID` yang
   sama) — **jangan** buat deployment baru, itu akan mengganti URL dan
   `config.js` yang sudah live tidak akan tahu apa-apa soal itu.

### 4d. VAPID keypair

Kalau perlu diterbitkan ulang (mis. karena `VAPID_PRIVATE_KEY` lama sudah
tidak diketahui siapa pun): `npx web-push generate-vapid-keys`, lalu ikuti
ulang langkah "One-time manual setup" di [`CLAUDE.md`](CLAUDE.md#push-notification-web-push-vapid)
bagian Push Notification. **Catatan**: mengganti VAPID key membuat semua
subscription push yang sudah ada di HP guru tidak valid lagi — guru perlu
aktifkan ulang notifikasi dari menu Notifikasi setelah ini dilakukan.

---

## 5. Peta Dokumentasi — Baca yang Mana untuk Apa

| Dokumen | Isinya | Baca kalau... |
|---|---|---|
| [`README.md`](README.md) | Arsitektur singkat, cara jalankan/test lokal | Baru mulai, butuh gambaran besar |
| [`CLAUDE.md`](CLAUDE.md) | Alasan di balik tiap keputusan desain & riwayat bug | Mau mengubah kode apa pun — **wajib** dibaca dulu bagian yang relevan |
| [`SCHEMA.md`](SCHEMA.md) | Struktur 15 sheet Google Sheet, urutan kolom persis | Mau menyentuh data di Sheet, atau kode yang membaca/menulis sheet |
| [`API.md`](API.md) | Referensi seluruh action `doGet`/`doPost` | Mau menambah/mengubah endpoint |
| [`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md) | Checklist deploy manual backend | Setiap kali habis ubah `.gs` dan mau deploy |
| `docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md` | Panduan pemakaian untuk guru/kepala sekolah | Perlu jelaskan fitur ke pengguna non-teknis |

---

## 6. Risiko Terbuka yang Belum Ada Solusinya (Jujur, per September 2026)

Supaya admin pengganti tidak kaget menemukan sendiri:

- **Kepemilikan akun masih personal** (lihat bagian 2) — bagian 4 di atas
  adalah rencana penyelesaiannya, tapi belum dieksekusi per tanggal dokumen
  ini ditulis.
- **Tidak ada mode offline / antre-kirim-ulang otomatis.** Kalau sinyal
  internet hilang tepat saat guru piket mengisi data, entri berpotensi hilang
  dan perlu diulang manual — tidak ada penyimpanan lokal yang otomatis
  terkirim lagi saat sinyal kembali. Lihat `handleRecord` di `app.js` untuk
  detail teknisnya.
- **Tidak ada backup otomatis terjadwal.** Yang ada: Export Data (manual,
  sesuai permintaan) dan Pemeliharaan Data/hapus periode (dengan pratinjau,
  tapi tidak otomatis mem-backup dulu sebelum menghapus). Google Sheets
  sendiri punya version history bawaan sebagai jaring pengaman tambahan,
  tapi itu bukan sesuatu yang dibangun SIGAP.
- **Tidak ada SLA** dari Google Sheets/Apps Script (tier gratis) maupun
  Vercel (Hobby tier) — keduanya bisa berubah kebijakan/kuota sewaktu-waktu
  tanpa jaminan kontraktual. Ini trade-off yang diterima sadar demi biaya
  nol, bukan sesuatu yang bisa "diperbaiki" tanpa mulai membayar layanan
  berbayar.
- **Jenis akun Google yang dipakai belum dikonfirmasi** (Gmail pribadi vs.
  Google Workspace for Education) — ini menentukan seberapa dekat sistem ini
  dengan batas kuota harian Apps Script. Perlu diisi di bagian 2 di atas.

---

## 7. Checklist Rutin untuk Admin

- [ ] Setelah **setiap** perubahan `.gs` yang di-deploy manual: cek
      `BACKEND_VERSION` lewat status ping (`API_URL?token=API_TOKEN`) untuk
      konfirmasi versi yang live sesuai yang dimaksud.
- [ ] Perhatikan hasil `check-backend-drift.yml` di GitHub Actions (jalan
      harian) — kalau merah, berarti `main` dan backend yang live sudah beda
      versi, ada `.gs` yang belum di-deploy.
- [ ] Sebelum menjalankan Pemeliharaan Data (hapus data lama), jalankan
      Export Data dulu untuk rentang yang sama sebagai backup manual.
- [ ] Verifikasi ulang isi bagian 2, 3, dan 6 dokumen ini setiap kali ada
      pergantian pengelola teknis.
