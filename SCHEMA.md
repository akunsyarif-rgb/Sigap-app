# SIGAP — Skema Google Sheet (Database)

SIGAP tidak punya database terpisah — **satu Google Spreadsheet** adalah
database-nya (dibaca/ditulis lewat `SpreadsheetApp` di `Code.gs`/`Utils.gs`).
Dokumen ini mencantumkan **semua 13 sheet** yang dipakai backend saat ini,
beserta **urutan kolom persis** — posisi kolom itu signifikan (dibaca *by
index*, bukan by nama header) di banyak tempat, jadi kolom yang tertukar
urutannya akan salah baca data tanpa error yang jelas.

> Dibuat dari pembacaan langsung kode backend (`Code.gs`/`Utils.gs`) per
> commit ini, bukan ditulis terpisah dari ingatan — kalau kode berubah,
> dokumen ini harus disinkronkan ulang dengan cara yang sama.

## Dua kategori sheet

| Kategori | Sheet | Dibuat otomatis? |
|---|---|---|
| **Data induk** — harus disiapkan **manual** dengan data asli sekolah sebelum SIGAP dipakai | `Master_Guru`, `Master_Siswa`, `Log_Gerbang` | **Tidak** — backend cuma `getSheetByName()`, tidak pernah membuatkan sheet ini kalau belum ada |
| **Data operasional** — dibuat otomatis begitu aksi terkait pertama kali dipanggil | `Pelanggaran`, `Surat_Masuk`, `Bimbingan_Khusus`, `Pelanggaran_Upacara`, `Izin_Keluar`, `Izin_Kelompok`, `Jadwal_Piket`, `Tindak_Lanjut`, `Audit_Log`, `Error_Log` | **Ya** — lewat `getOrCreateSheet(ss, nama, headers)` (`Utils.gs`): kalau sheet belum ada, dibuat lalu baris header ditulis persis sesuai urutan di dokumen ini |

Untuk replikasi ke sekolah lain: **cukup buat 3 sheet data induk** dengan
kolom sesuai dokumen ini dan isi datanya (guru + siswa), lalu deploy
backend (lihat `CLAUDE.md`). 10 sheet operasional lainnya akan membuat
dirinya sendiri dengan header yang benar saat pertama kali dipakai — tidak
perlu dibuat manual, dan **sebaiknya jangan dibuat manual** (kalau dibuat
manual dengan header yang salah/tertukar urutan, `getOrCreateSheet` tidak
akan memperbaikinya — ia cuma membuat sheet kalau sheetnya **belum ada
sama sekali**).

---

## Data Induk (wajib disiapkan manual)

### `Master_Guru`
Header baris ini bukan dijaga oleh kode (tidak ada `getOrCreateSheet`),
tapi **posisi kolom A–H di bawah wajib persis** — dibaca *by index* di
puluhan tempat di `Code.gs`/`Auth.gs` (login, reset password, ubah role, dst.).

| # | Kolom | Header disarankan | Keterangan |
|---|---|---|---|
| 1 | A | `ID` | ID unik guru, dipakai sebagai `teacherId` saat login & kunci di semua aksi admin |
| 2 | B | `Nama` | Nama tampil |
| 3 | C | `Password` | Hash password (salted SHA-256 skema baru, atau legacy unsalted SHA-256 — lihat `Auth.gs verifyPassword`) — **jangan pernah isi plaintext manual** |
| 4 | D | `Role` | `admin` \| `bk_kesiswaan` \| `guru` \| `osis` |
| 5 | E | `Jabatan` | Label tampilan opsional (mis. akun `bk_kesiswaan` yang ditampilkan sebagai "Kepala Sekolah") — kosong = pakai label role biasa |
| 6 | F | `Status` | Kosong = aktif; `nonaktif` = akun dikunci (tidak bisa login) |
| 7 | G | `Kelas_Wali` | Kosong = bukan wali kelas; diisi nama kelas kalau wali kelas |
| 8 | H | `Salt` | Kosong = akun masih pakai skema hash lama (auto-migrasi ke salted saat login berhasil berikutnya) |

### `Master_Siswa`

| # | Kolom | Header disarankan | Keterangan |
|---|---|---|---|
| 1 | A | `NISN` | Dipakai sebagai kunci pencarian siswa di semua fitur |
| 2 | B | `Nama` | |
| 3 | C | `Kelas` | Nama kelas — dicocokkan toleran format oleh `sameClass()` (`Utils.gs`) & `normalizeClass()` (`helpers.js`) |

### `Log_Gerbang` (Keterlambatan)

| # | Kolom | Header disarankan | Keterangan |
|---|---|---|---|
| 1 | A | `Timestamp` | Dibaca binary-search oleh `getRowsSince()` — HARUS terurut naik |
| 2 | B | `NISN` | |
| 3 | C | `Nama` | |
| 4 | D | `Kelas` | |
| 5 | E | `Alasan` | Alasan/tipe keterlambatan (bebas teks, termasuk custom) |
| 6 | F | `Dicatat_Oleh` | Nama guru pencatat (teks bebas, bukan ID — dipakai cek kepemilikan saat edit/hapus) |

---

## Data Operasional (dibuat otomatis — `getOrCreateSheet`)

### `Pelanggaran`
Sumber: `Code.gs`, action `addPelanggaran`.

| # | Kolom | Header | Keterangan |
|---|---|---|---|
| 1 | A | `Timestamp` | |
| 2 | B | `NISN` | |
| 3 | C | `Nama` | |
| 4 | D | `Kelas` | |
| 5 | E | `Jenis_Pelanggaran` | |
| 6 | F | `Sanksi` | |
| 7 | G | `Catatan` | Opsional |
| 8 | H | `Dicatat_Oleh` | |

### `Surat_Masuk` (Surat Izin/Sakit)
Sumber: `Code.gs`, action `addSurat`.

| # | Kolom | Header | Keterangan |
|---|---|---|---|
| 1 | A | `Timestamp` | |
| 2 | B | `NISN` | |
| 3 | C | `Nama` | |
| 4 | D | `Kelas` | |
| 5 | E | `Jenis` | |
| 6 | F | `Keterangan` | |
| 7 | G | `Foto_URL` | **Legacy, tidak dipakai lagi** — fitur upload foto sudah dicabut (lihat `CLAUDE.md`); kolom ini tetap ada supaya baris lama tidak bergeser, selalu ditulis kosong untuk baris baru |
| 8 | H | `Dicatat_Oleh` | |

### `Bimbingan_Khusus`
Sumber: `Code.gs`, action `addBimbingan`. Akses baca dibatasi ketat (admin/BK saja).

| # | Kolom | Header | Keterangan |
|---|---|---|---|
| 1 | A | `Timestamp` | |
| 2 | B | `NISN` | |
| 3 | C | `Nama` | |
| 4 | D | `Kelas` | |
| 5 | E | `Catatan` | |
| 6 | F | `Dicatat_Oleh` | |

### `Pelanggaran_Upacara`
Sumber: `Code.gs`, action `addPelanggaranUpacara`.

| # | Kolom | Header | Keterangan |
|---|---|---|---|
| 1 | A | `Timestamp` | |
| 2 | B | `NISN` | |
| 3 | C | `Nama` | |
| 4 | D | `Kelas` | |
| 5 | E | `Jenis_Pelanggaran` | |
| 6 | F | `Catatan` | Opsional |
| 7 | G | `Dicatat_Oleh` | |
| 8 | H | `Dicatat_Oleh_ID` | |

### `Izin_Keluar` (21 kolom)
Sumber: `IZIN_HEADERS` (`Utils.gs`). Satu baris = satu siswa/satu transaksi
individual. Kolom 1–4 sengaja sama urutannya dengan sheet lain
(`Timestamp, NISN, Nama, Kelas`) supaya `getRowsSince()` tetap berlaku.
Kolom ke-21 (`ID_Kelompok`) ditambahkan belakangan **di ujung** saat fitur
Izin Kelompok dibuat — tidak ada kolom lama yang bergeser.

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Timestamp` |
| 2 | B | `NISN` |
| 3 | C | `Nama` |
| 4 | D | `Kelas` |
| 5 | E | `ID_Izin` |
| 6 | F | `Keperluan` |
| 7 | G | `Tujuan` (`kembali` atau `pulang`) |
| 8 | H | `Status` (`Menunggu Verifikasi` \| `Sedang di Luar` \| `Selesai` \| `Pulang`; `Kembali` legacy, tidak ditulis lagi) |
| 9 | I | `Jalur` (`normal` atau `khusus`) |
| 10 | J | `Alasan_Khusus` |
| 11 | K | `Disetujui_Oleh` |
| 12 | L | `Disetujui_Oleh_ID` |
| 13 | M | `Waktu_Persetujuan` |
| 14 | N | `Diverifikasi_Oleh` |
| 15 | O | `Diverifikasi_Oleh_ID` |
| 16 | P | `Waktu_Verifikasi` |
| 17 | Q | `Waktu_Keluar` |
| 18 | R | `Waktu_Kembali` |
| 19 | S | `Dicatat_Kembali_Oleh` |
| 20 | T | `Dicatat_Kembali_Oleh_ID` |
| 21 | U | `ID_Kelompok` (kosong = izin individual; terisi = peserta kegiatan `Izin_Kelompok`) |

### `Izin_Kelompok` (15 kolom)
Sumber: `IZIN_KELOMPOK_HEADERS` (`Utils.gs`). Satu baris = satu **kegiatan**
(bukan satu siswa) — setiap peserta tetap punya baris sendiri di
`Izin_Keluar` yang menunjuk kembali lewat `ID_Kelompok`. **Sengaja tidak
punya kolom status** — status kegiatan selalu dihitung dari status
peserta-peserta di `Izin_Keluar`, tidak disimpan dobel.

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Timestamp` |
| 2 | B | `ID_Kelompok` |
| 3 | C | `Kegiatan` |
| 4 | D | `Tujuan` |
| 5 | E | `Keperluan` |
| 6 | F | `Pola_Kembali` (`bersama` atau `individual`; kosong kalau `Tujuan` = pulang) |
| 7 | G | `Jumlah_Peserta` |
| 8 | H | `Jalur` |
| 9 | I | `Alasan_Khusus` |
| 10 | J | `Disetujui_Oleh` |
| 11 | K | `Disetujui_Oleh_ID` |
| 12 | L | `Waktu_Persetujuan` |
| 13 | M | `Diverifikasi_Oleh` |
| 14 | N | `Diverifikasi_Oleh_ID` |
| 15 | O | `Waktu_Verifikasi` |

### `Jadwal_Piket`
Sumber: `Code.gs`, action `setJadwalPiket`. Satu baris = satu penugasan
piket (hari + guru), bukan satu baris per hari dalam seminggu.

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Hari` (`Senin`..`Sabtu`) |
| 2 | B | `Guru_ID` (merujuk kolom A `Master_Guru`) |

### `Tindak_Lanjut`
Sumber: `Code.gs`, action `ajukanTindakLanjut` (pengajuan) & `approveTindakLanjut` (persetujuan).

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Timestamp` |
| 2 | B | `NISN` |
| 3 | C | `Nama` |
| 4 | D | `Kelas` |
| 5 | E | `Catatan` |
| 6 | F | `Diajukan_Oleh` |
| 7 | G | `Status` |
| 8 | H | `Disetujui_Oleh` |
| 9 | I | `Tanggal_Disetujui` |

### `Audit_Log`
Sumber: `logAudit()` (`Utils.gs`) — dipanggil dari puluhan aksi di seluruh
`Code.gs`. Baca dibatasi admin-only (`getAuditLog`). **Tidak pernah**
memuat nama/NISN siswa atau isi password — hanya metadata aksi.

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Timestamp` |
| 2 | B | `Nama` (aktor, bukan siswa) |
| 3 | C | `ID` (ID guru aktor) |
| 4 | D | `Aksi` |
| 5 | E | `Detail` |

### `Error_Log`
Sumber: `Code.gs`, action `logClientError` — laporan error render sisi
klien (`ErrorBoundary` di `app.js`). Sengaja tidak butuh sesi valid (biar
laporan tetap masuk walau sesi baru habis saat render gagal).

| # | Kolom | Header |
|---|---|---|
| 1 | A | `Timestamp` |
| 2 | B | `Nama` |
| 3 | C | `ID` |
| 4 | D | `Pesan` |
| 5 | E | `Detail` |
| 6 | F | `Halaman` |
