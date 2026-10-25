# Cadangan backend Supabase SIGAP

Salinan kode edge function yang **sedang berjalan** di proyek Supabase "Workflow"
(ref `htutgpjcynbnyxwgorcb`), diambil 25 Okt 2026. Ini cadangan untuk dibaca dan
ditinjau; **tidak otomatis ter-deploy dari repo ini**.

| Folder | Versi live | Fungsi |
| --- | --- | --- |
| `functions/sigap-api/` | v23 | API utama yang dipakai frontend (`API_URL_SUPABASE` di `config.js`) |
| `functions/push-send/` | v2 | Pengirim Web Push (rahasia VAPID dari Vault) |

Tidak disalin:
- `sigap-login` (v2): tidak dipakai `config.js` (login lewat `sigap-api`), kemungkinan peninggalan.
- `sigap-selftest-tmp`: fungsi uji sementara.
- Isi Vault: sengaja tidak disimpan. Tidak ada rahasia di folder ini; kode hanya membaca `SUPABASE_DB_URL` dan Vault saat berjalan.

Skema database: [`SCHEMA.md`](SCHEMA.md) (tabel) dan [`objek_database.sql`](objek_database.sql) (fungsi, trigger, indeks, cron). 
**Pemulihan:** [`pemulihan/001_skema_lengkap.sql`](pemulihan/001_skema_lengkap.sql) membangun seluruh schema `sigap` (18 tabel, RLS, 8 fungsi, 6 trigger, 51 indeks) dalam satu berkas. Diuji 25 Okt 2026 di Postgres 16 kosong: termuat tanpa galat, jumlah tabel/kolom/constraint/indeks sama dengan database live (18 / 191 / 59 / 51), trigger notifikasi mengisi antrean wali kelas dan guru piket, nomor surat `IK-YYYYMMDD-001` terbentuk, catatan ganda ditolak. Belum diuji di proyek Supabase sungguhan (butuh pg_cron, pg_net, Vault, deploy fungsi, dan data guru/siswa). Riwayat migrasi asli tidak ada di repo.

Bila kode live diubah, perbarui folder ini agar tidak melenceng.
