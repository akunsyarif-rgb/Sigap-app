# Skema database Supabase SIGAP (schema `sigap`)

Diambil dari database live 25 Okt 2026 (proyek "Workflow", ref `htutgpjcynbnyxwgorcb`). **Hanya struktur, tanpa data.**
Fungsi, trigger, indeks, dan cron ada di [`objek_database.sql`](objek_database.sql). `SCHEMA.md` di root repo masih menjelaskan Google Sheet lama.

Catatan umum:
- Semua tabel **RLS aktif tanpa policy sama sekali**: hanya koneksi server (edge function lewat `SUPABASE_DB_URL`) yang bisa membaca/menulis. Klien tidak boleh mengakses tabel langsung.
- `tanggal` = `(dicatat_pada AT TIME ZONE 'Asia/Makassar')::date` (kolom generated). `kelas_norm` = `sigap.norm_kelas(kelas)` (generated).
- Pencatat memakai `dicatat_oleh` (nama) dan `dicatat_oleh_id` (FK ke `guru.id`).
- Jumlah baris per 25 Okt: guru 58, siswa 1257, terlambat 299, surat_masuk 102, pelanggaran 44, pelanggaran_upacara 41, izin_keluar 4, bimbingan_khusus 1, push_queue 108, push_subscription 5, audit_log 57.

## Pengguna dan sesi
| Tabel | Kolom (tipe, default / aturan) |
| --- | --- |
| `guru` | `id` text PK · `nama` · `password_hash` · `salt` (null) · `role` (huruf kecil, tidak kosong) · `jabatan` ('') · `status` ('aktif'; `aktif`/`nonaktif`) · `kelas_wali` ('') · `created_at` · `updated_at` · `password_changed_at` (null) |
| `sesi` | `token_hash` text PK · `guru_id` FK guru · `login_at` now() · `expires_at` |
| `login_gagal` | `kunci` + `jendela` (bigint) PK · `jumlah` int 0 |
| `jadwal_piket` | `hari` (Minggu…Sabtu) + `guru_id` FK guru, PK gabungan |

## Siswa
| Tabel | Kolom |
| --- | --- |
| `siswa` | `id` uuid PK · `nisn` text unik · `nama` · `kelas` · `kelas_norm` (generated) · `status` ('aktif'; `aktif`/`perlu_verifikasi`) · `ditambah_oleh` · `waktu_tambah` · `nisn_lama` · `created_at` |

## Catatan harian (semua punya `id` uuid PK, `dicatat_pada`, `tanggal`, `siswa_id` FK siswa, `nisn`, `nama`, `kelas`, `kelas_norm`, `dicatat_oleh`, `dicatat_oleh_id`)
| Tabel | Kolom khusus | Aturan unik |
| --- | --- | --- |
| `terlambat` | `alasan` | satu per `nisn` per `tanggal` |
| `surat_masuk` | `jenis`, `keterangan`, `foto_url` (lama, tidak dipakai UI) | satu per `nisn` per `tanggal` |
| `pelanggaran` | `jenis_pelanggaran`, `sanksi`, `catatan` | - |
| `pelanggaran_upacara` | `jenis_pelanggaran`, `catatan` | satu per `nisn` + jenis + `tanggal` |
| `bimbingan_khusus` | `catatan` (tanpa `tanggal`/`kelas_norm`) | - |
| `tindak_lanjut` | `catatan`, `diajukan_oleh`/`_id`, `status` ('menunggu'/'selesai'), `disetujui_oleh`/`_id`, `disetujui_pada` | - |
| `surat_masuk_tahap1_kosong` | sisa tahap awal migrasi, 0 baris | - |

## Izin keluar
| Tabel | Kolom |
| --- | --- |
| `izin_keluar` | `id` uuid PK · `dicatat_pada` · `siswa_id` · `nisn` · `nama` · `kelas` · `kelas_norm` · `keperluan` · `tujuan` (`kembali`/`pulang`) · `status` (`Menunggu Verifikasi`/`Sedang di Luar`/`Selesai`/`Pulang`/`Kembali`) · `jalur` (`normal`/`khusus`) · `alasan_khusus` · `disetujui_oleh`/`_id` · `waktu_persetujuan` · `diverifikasi_oleh`/`_id` · `waktu_verifikasi` · `waktu_keluar` · `waktu_kembali` · `dicatat_kembali_oleh`/`_id` · `kelompok_id` FK izin_kelompok · `nomor_surat` ('' ; unik bila terisi) · `waktu_print` · `status_print` (`Belum`/`Sudah`) · `jam_perkiraan_kembali` ('' atau `HH:MM`). Satu siswa hanya boleh punya satu izin terbuka (`Menunggu Verifikasi`/`Sedang di Luar`). |
| `izin_kelompok` | `id` uuid PK · `dicatat_pada` · `kegiatan` · `tujuan` · `keperluan` · `pola_kembali` ('', `bersama`, `individual`) · `jumlah_peserta` · `jalur` · `alasan_khusus` · `disetujui_oleh`/`_id` · `waktu_persetujuan` · `diverifikasi_oleh`/`_id` · `waktu_verifikasi` |

## Push, audit, galat
| Tabel | Kolom |
| --- | --- |
| `push_subscription` | `id` identity PK · `endpoint` unik · `guru_id` FK · `p256dh` · `auth` · `user_agent` · `diperbarui` |
| `push_queue` | `id` identity PK · `dibuat` · `event_id` · `jenis` · `nisn` · `guru_id` FK · `kind` (`wali_kelas`/`guru_piket`) · `title` · `body` · `url` · `prioritas` · `diproses` bool · `percobaan` int · `last_error` · `claim_until` · `selesai_pada` |
| `audit_log` | `id` identity PK · `waktu` · `nama` · `guru_id` · `aksi` · `detail` |
| `error_log` | `id` identity PK · `waktu` · `nama` · `guru_id` · `pesan` · `detail` · `halaman` |

## Yang belum ada di repo
- Riwayat migrasi asli (`sigap_stage1_schema` … `push_trigger_izin_update_distinct_jenis`, 17–18 Okt) hanya terlihat sebagai daftar nama; isi SQL-nya tidak diambil.
- Nilai Vault (`vapid_*`, `push_internal_secret`) sengaja tidak disimpan di sini.
- Tabel schema `public` milik proyek lain di database yang sama (Teacher-workspace, Ulangan Harian) tidak termasuk.
