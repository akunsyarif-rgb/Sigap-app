# STATUS — SIGAP (Sigap-app)

_Disusun 25 Oktober 2026 dari isi repo (commit terakhir 19 Okt 2026, PR #106). Hanya fakta yang tertulis di repo; yang tidak bisa diverifikasi dari repo ditandai._

## Ringkasan
Aplikasi web internal SMAN 2 Tarakan untuk mencatat keterlambatan siswa, surat izin/sakit, izin keluar/pulang, pelanggaran tata tertib, dan pelanggaran saat upacara. Repo public.

**Perubahan besar yang belum tercermin di dokumen lain:** pada 18 Okt (PR #104, "Cutover frontend ke backend Supabase") frontend dialihkan ke backend Supabase. `config.js` sekarang berisi `API_BACKEND = "supabase"` dan menunjuk ke fungsi `sigap-api` di Supabase. Saklar satu baris itu masih bisa mengembalikannya ke Apps Script.

## Stack
- Frontend: statis tanpa build (React 18 + Babel Standalone lewat CDN, PWA dengan service worker), plus fungsi Vercel `api/push-send.js` untuk Web Push.
- Backend aktif: Supabase (`sigap-api`). Cadangan kodenya ada di `supabase/` (25 Okt). Isi dan status migrasi datanya tidak bisa saya verifikasi dari sini.
- Backend lama: Google Apps Script (`Code.gs`, `Auth.gs`, `Utils.gs`, `Notifikasi.gs`) dan Google Sheet. File-nya masih ada di repo, begitu juga workflow `deploy-gas.yml` dan `check-backend-drift.yml`.

## Sudah ada
Fitur lengkap per 14 Sep ada di `SIGAP_STATUS.md`. Setelah itu (commit 15 Sep–19 Okt):
- Push notifikasi PWA untuk iOS, perbaikan label dan detail error antrean push (20 Sep).
- Tambah siswa langsung dari aplikasi (21 Sep).
- Cache `students_list` dan `today_logs` untuk mempercepat pencatatan (22 Sep).
- Tindak lanjut survei guru: tombol lihat password, tanggal di Rekap Kelas, Izin Keluar lebih terlihat, aksen warna per mode di Gerbang (24 Sep).
- Sanitasi field `editEntry` dan allowlist admin/BK untuk `addBimbingan` (27 Sep).
- Cutover ke Supabase, dukungan id-based identity, surat dibuat di frontend (18 Okt).
- Cek versi baru saat aplikasi dibuka atau kembali online, dan nomor build ditampilkan (18 Okt).
- Navigasi bawah dan pemilih segmen bergaya "pil kaca" iOS (19 Okt).

## Belum / terbuka
- Backlog teknis lama ada di bagian 3 `SIGAP_STATUS.md` (per 14 Sep). Belum saya cocokkan satu per satu dengan kondisi sekarang.
- Keputusan pemilik (25 Okt 2026): **backend SIGAP adalah Supabase.** Apps Script/Sheets = arsip/jalan mundur (PR #104 menyebutnya "tetap utuh sebagai arsip"); tidak dihapus. Cadangan kode `sigap-api` (v23) dan `push-send` (v2) ada di `supabase/` (25 Okt); struktur database (tabel, fungsi, trigger, indeks, cron) juga sudah dicadangkan di `supabase/SCHEMA.md` dan `supabase/objek_database.sql`.

## Hal yang perlu diwaspadai
- **`SIGAP_STATUS.md`, `README.md`, `CLAUDE.md`, `API.md`, dan `SCHEMA.md` masih menjelaskan backend Apps Script + Google Sheet.** `SIGAP_STATUS.md` disusun 14 Sep dan mencatat versi live `2026-09-14-dedup-pelanggaran-upacara`. Itu sebelum cutover dan sudah 58 commit tertinggal.
- Workflow `check-backend-drift.yml` memeriksa backend Apps Script. Setelah cutover, hasilnya tidak lagi menggambarkan backend yang dipakai. Per 25 Okt: **gagal setiap hari sejak 20 Okt** (jadwal harian). `deploy-gas.yml` terakhir dijalankan 18 Sep dan gagal. Keduanya tidak relevan lagi bagi backend aktif; menonaktifkannya adalah langkah terpisah (belum dilakukan).
- Setiap push ke `main` men-deploy frontend (Vercel, menurut `SIGAP_STATUS.md`); nomor build perlu dinaikkan agar pengguna mendapat versi baru.

## Dokumen penting
`SIGAP_STATUS.md` (riwayat per 14 Sep), `CLAUDE.md`, `README.md`, `API.md`, `SCHEMA.md`, `DEPLOYMENT_CHECKLIST.md`, `docs/PANDUAN-FITUR-DAN-ALUR-KERJA.md`.

## Langkah berikutnya (usulan, bukan dari repo)
Latih pemulihan: bangun ulang backend di proyek Supabase kosong dari folder `supabase/`. Setelah itu `SIGAP_STATUS.md` bisa digabung atau diganti file ini.

---
Perbarui file ini di akhir tiap sesi kerja: tanggal, apa yang selesai, apa yang terbuka.
