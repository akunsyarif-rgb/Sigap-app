# SIGAP — Referensi API Backend

Backend SIGAP adalah **satu Google Apps Script Web App** yang menerima
seluruh permintaan lewat dua endpoint HTTP standar Apps Script — `doGet`
(baca) dan `doPost` (tulis) — di **satu URL yang sama** (`API_URL` di
`config.js`). Tidak ada routing path/REST resource; setiap permintaan
membawa `action` yang menentukan cabang mana di `Code.gs` yang dijalankan.

> Dibuat dari pembacaan langsung `Code.gs`/`Utils.gs`/`Auth.gs` per commit
> ini, bukan ditulis dari ingatan. Kalau kode berubah, dokumen ini harus
> disinkronkan ulang dengan cara yang sama — lihat `SCHEMA.md` untuk
> struktur datanya, `CLAUDE.md` untuk alasan di balik keputusan desain yang
> tidak dijelaskan ulang di sini.

## Aturan Umum

**Method**: aksi yang **membaca** data lewat `GET` (query string), aksi
yang **mengubah** data lewat `POST` (body JSON). Tidak ada PUT/PATCH/DELETE
— method HTTP-nya cuma dua, `action` yang membedakan operasinya.

**Auth — dua lapis, keduanya wajib untuk hampir semua aksi:**
1. `token` — harus sama persis dengan `API_TOKEN` di Script Properties
   (dicek `checkToken()`, `Utils.gs`). **Bukan rahasia terhadap browser** —
   ia memang dikirim dari setiap klien (lihat `config.js`); fungsinya
   menyaring bot/scanner acak yang memukul URL Apps Script publik, bukan
   kredensial pengguna.
2. `sessionToken` — dari `login`, berlaku maksimal 6 jam (lihat
   `createSession`/`getSessionUser`, `Auth.gs`). **Tiga pengecualian** yang
   tidak butuh `sessionToken` sama sekali: `login` (itu sendiri yang
   membuatnya), status ping (tanpa `action`), dan `getLoginUsers` (dipanggil
   sebelum siapa pun login, lihat catatan di bawah).

**Bentuk request**:
- `doPost`: `Content-Type` bebas (Apps Script membaca `e.postData.contents`
  sebagai teks lalu `JSON.parse`), body adalah **satu objek JSON rata**
  (tidak bersarang) berisi `token`, `sessionToken`, `action`, dan field lain
  sesuai aksinya.
- `doGet`: seluruh parameter lewat **query string** (`?token=...&action=...&...`),
  semuanya string (Apps Script tidak membedakan tipe di `e.parameter`).

**Bentuk response** — SELALU JSON, SELALU field `status`:
```json
{ "status": "success", "...": "field lain sesuai aksi" }
{ "status": "error", "message": "Pesan dalam Bahasa Indonesia, aman ditampilkan langsung ke pengguna" }
```
Tidak ada kode HTTP non-200 untuk error aplikasi (Apps Script Web App
sendiri baru mengembalikan status HTTP non-200 untuk error tingkat platform,
mis. deployment tidak ditemukan) — klien HARUS memeriksa `status` di body,
bukan status HTTP.

**Rate limit** (di luar batas per-aksi yang disebutkan di bawah):
- Login gagal: **global** (bukan per-akun), maksimal 15 kegagalan / 5 menit
  — lihat `isLoginRateLimited()`/`recordLoginFailure()` (`Utils.gs`) dan
  catatan kenapa ini masih global di `CLAUDE.md`.
- Semua aksi `doPost` (kecuali `login`/`logout`/`logClientError`): rate
  limit **per sesi** lewat `checkWriteRateLimit()`.
- `exportData` & `previewHapusData`: rate limit tambahan lewat
  `checkExportRateLimit()`.

**Audit Log**: sebagian besar aksi tulis (bukan semua — lihat kolom "Audit
Log" di tabel referensi) mencatat ke `Audit_Log` lewat `logAudit()`, selalu
metadata saja (nama/ID aktor, nama aksi, detail ringkas) — **tidak pernah**
NISN siswa di detail, kecuali beberapa aksi lama yang memang mencantumkan
nama+NISN siswa secara eksplisit (ditandai di tabel).

---

## Referensi Cepat

### `doPost` — aksi tulis (butuh `sessionToken` kecuali ditandai *)

| Action | Otorisasi | Ringkasan |
|---|---|---|
| `login` * | — | Login, kirim `password` + `teacherId` opsional |
| `logout` | Sesi apa pun | Hapus sesi di server |
| `logClientError` * | Tidak wajib sesi | Simpan laporan error render klien |
| `record` | Non-OSIS | Catat keterlambatan |
| `addSurat` | Non-OSIS | Catat surat izin/sakit |
| `addPelanggaran` | Non-OSIS | Catat pelanggaran + sanksi |
| `addBimbingan` | Non-OSIS | Catat Bimbingan Khusus |
| `addPelanggaranUpacara` | OSIS / BK / Admin | Catat pelanggaran upacara |
| `editEntry` | Non-OSIS, ≤5 menit (admin bebas), guru biasa cuma milik sendiri | Ubah 1 catatan (terlambat/pelanggaran/surat) |
| `deleteEntry` | sama seperti `editEntry` | Hapus 1 catatan |
| `addIzinKeluar` | Non-OSIS | Ajukan/setujui izin keluar individual |
| `verifikasiIzinKeluar` | Guru Piket bertugas / BK / Admin | Verifikasi izin, siswa resmi keluar |
| `tandaiKembaliIzinKeluar` | Guru Piket bertugas / BK / Admin | Siswa kembali — status final `Selesai` |
| `tandaiPulangIzinKeluar` | Guru Piket bertugas / BK / Admin | Siswa ternyata tidak kembali — final `Pulang` |
| `addIzinKelompok` | Non-OSIS | Ajukan kegiatan + banyak peserta sekaligus |
| `verifikasiIzinKelompok` | Guru Piket bertugas / BK / Admin | Verifikasi rombongan (semua/sebagian peserta) |
| `tandaiKembaliKelompok` | Guru Piket bertugas / BK / Admin | Tandai sebagian/semua peserta kembali |
| `ajukanTindakLanjut` | Admin/BK, atau wali kelas untuk kelasnya | Ajukan status "sudah ditindaklanjuti" |
| `approveTindakLanjut` | Admin | Setujui pengajuan tindak lanjut |
| `addTeacher` | Admin | Tambah akun guru baru |
| `updatePassword` | Admin | Reset password guru **lain** (tanpa perlu tahu yang lama) |
| `changeMyPassword` | Sesi apa pun (non-admin sekalipun) | Ganti password **akun sendiri** (wajib password lama) |
| `updateJabatan` | Admin | Ubah label jabatan tampilan |
| `updateRole` | Admin | Ubah role (`guru`/`bk_kesiswaan`/`osis`/`admin`) |
| `updateWaliKelas` | Admin | Set/lepas status wali kelas |
| `updateTeacherName` | Admin | Perbaiki nama guru |
| `toggleTeacherStatus` | Admin | Nonaktifkan/aktifkan akun |
| `deleteTeacher` | Admin | Hapus akun guru permanen |
| `setJadwalPiket` | Admin | Timpa seluruh Jadwal Piket mingguan |
| `hapusDataPeriode` | Admin | Hapus massal data operasional per rentang tanggal |

### `doGet` — aksi baca (`?action=...`, butuh `sessionToken` kecuali ditandai *)

| Action | Otorisasi | Ringkasan |
|---|---|---|
| *(kosong)* * | — | Status ping — `version`/`features` (lihat `BACKEND_VERSION`) |
| `getLoginUsers` * | — | `{id, name}` guru aktif, untuk pencarian di layar login |
| `getStudents` | Semua (termasuk OSIS) | Seluruh `Master_Siswa` |
| `getTodayData` | Non-OSIS | Ringkasan hari ini (Terlambat/Surat/Pelanggaran) + data banner |
| `getStudentLateHistory` | Non-OSIS | Riwayat keterlambatan 1 siswa + total sekolah |
| `getLogs` | Non-OSIS | Keterlambatan, dibatasi cakupan per peran |
| `getSurat` | Non-OSIS | Surat/izin, dibatasi cakupan per peran |
| `getPelanggaran` | Non-OSIS | Pelanggaran, dibatasi cakupan per peran |
| `getPelanggaranCountForStudent` | Non-OSIS | Total pelanggaran 1 siswa (angka saja) |
| `getBimbingan` | Admin/BK | Seluruh Bimbingan Khusus |
| `getTindakLanjut` | Non-OSIS | Daftar tindak lanjut, dibatasi cakupan per peran |
| `getPelanggaranUpacara` | OSIS/BK/Admin, atau wali kelas (kelasnya) | Rekap pelanggaran upacara |
| `getIzinKeluar` | Non-OSIS | Izin Keluar + Izin Kelompok, dibatasi cakupan |
| `getTeachers` | Admin | Seluruh `Master_Guru` |
| `getAuditLog` | Admin | 300 baris `Audit_Log` terbaru |
| `getJadwalPiket` | Non-OSIS | Jadwal Piket mingguan |
| `getWaliKelasMap` | Non-OSIS | Peta kelas → wali kelas |
| `exportData` | Bervariasi per `jenis` — lihat detail | Laporan PDF/Excel siap unduh |
| `previewHapusData` | Admin | Hitung dampak Hapus Data (tanpa menghapus) |

---

## Detail Aksi

### Autentikasi & Sesi

#### `login` (POST)
Tanpa `sessionToken` — inilah yang membuatnya. Dua jalur, keduanya tetap
hidup (lihat "Login flow" di `CLAUDE.md`):

| Field | Wajib | Keterangan |
|---|---|---|
| `password` | ya | |
| `teacherId` | tidak | Kalau diisi, hanya baris `Master_Guru` dengan ID itu yang dicocokkan. Kalau kosong, password dicocokkan ke SEMUA baris (mode legacy) |

Respons sukses: `{ status, user: {id, name, role, jabatan, waliKelas}, sessionToken }`.
Respons gagal: `{ status: 'error', message }` — termasuk pesan khusus untuk
akun `nonaktif` dan rate limit global (lihat "Aturan Umum").

#### `logout` (POST)
Tidak ada field lain. Menghapus record sesi di `CacheService` dan mencatat
Audit Log `'Logout'`. Selalu `{ status: 'success' }`, bahkan kalau sesi
sudah tidak valid.

#### `changeMyPassword` (POST)
Semua role, termasuk OSIS — mengganti password **akun yang sedang login**.

| Field | Wajib | Keterangan |
|---|---|---|
| `oldPassword` | ya | Diverifikasi lewat `verifyPassword()` (mendukung skema lama & baru) |
| `newPassword` | ya | Minimal 6 karakter |

Audit Log: `'Ganti Password Sendiri'`, tanpa isi password.

#### `logClientError` (POST)
Tidak butuh sesi valid (dipakai `ErrorBoundary` sisi klien, termasuk saat
sesi baru saja habis). Tidak pernah gagal (dibungkus try/catch sendiri).

| Field | Wajib |
|---|---|
| `message` | tidak (dipotong 500 karakter) |
| `detail` | tidak (dipotong 2000 karakter) |
| `page` | tidak |

---

### Keterlambatan, Surat, Pelanggaran (harian)

#### `record` (POST) — catat keterlambatan
| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name` | ya |
| `type` | ya — alasan/tipe keterlambatan |

Ditolak kalau siswa itu sudah tercatat terlambat hari ini (dicek lewat
`getRowsSince`, bukan scan penuh sheet).

#### `addSurat` (POST) — catat surat izin/sakit
| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name`, `jenis` | ya |
| `keterangan` | tidak |

Ditolak kalau siswa sudah punya catatan surat hari ini. `Foto_URL` selalu
ditulis kosong — fitur upload foto sudah dicabut (lihat `CLAUDE.md`).

#### `addPelanggaran` (POST) — catat pelanggaran
| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name`, `jenis_pelanggaran`, `sanksi` | ya |
| `catatan` | tidak |

#### `addBimbingan` (POST) — catat Bimbingan Khusus
| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name`, `catatan` | ya |

#### `addPelanggaranUpacara` (POST)
Otorisasi: `isOsisRole` **atau** `isBkRole` (admin ikut lewat `isBkRole`) —
guru biasa ditolak.

| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name`, `jenis_pelanggaran` | ya |
| `catatan` | tidak |

#### `editEntry` / `deleteEntry` (POST)
Berlaku untuk 3 kategori saja: `terlambat`, `pelanggaran`, `surat` (Izin
Keluar & Upacara **tidak** lewat dua aksi ini — lihat `CLAUDE.md`, keduanya
punya alur status/hapus sendiri).

| Field | Wajib | Keterangan |
|---|---|---|
| `category` | ya | `'terlambat'` \| `'pelanggaran'` \| `'surat'` |
| `nisn`, `timestamp` | ya | Kunci pencarian baris (kombinasi persis, bukan nomor baris) |
| `name` | ya | Hanya untuk teks Audit Log |
| *(field sesuai kategori)* | ya untuk `editEntry` | `terlambat`: `type`. `pelanggaran`: `jenis_pelanggaran`+`sanksi`+`catatan`. `surat`: `jenis`+`keterangan` |

Aturan waktu/kepemilikan: admin bebas kapan saja; BK/Kesiswaan bebas siapa
pun tapi ≤5 menit sejak dicatat; guru biasa ≤5 menit **dan** cuma catatan
yang ia tulis sendiri (dicocokkan ke kolom `Dicatat_Oleh`).

---

### Izin Keluar / Pulang (BETA)

Lihat `CLAUDE.md` bagian "Izin Keluar / Pulang (BETA)" untuk mesin status
lengkap (`Menunggu Verifikasi` → `Sedang di Luar` → `Selesai`/`Pulang`) —
di sini hanya parameter tiap aksi.

#### `addIzinKeluar` (POST)
| Field | Wajib | Keterangan |
|---|---|---|
| `nisn` | ya | Nama & kelas diambil dari `Master_Siswa`, TIDAK dari klien |
| `tujuan` | ya | `'kembali'` \| `'pulang'` |
| `keperluan` | ya | Maks 200 karakter (`IZIN_MAX_KEPERLUAN`) |
| `jalur` | tidak | `'khusus'` untuk Izin Khusus (default jalur normal) |
| `alasan_khusus` | wajib kalau `jalur='khusus'` | Maks 300 karakter (`IZIN_MAX_ALASAN`); dibuang kalau jalur normal |

Ditolak kalau siswa sudah punya transaksi terbuka (`Menunggu Verifikasi`/
`Sedang di Luar`). Jalur `khusus` butuh `canVerifyIzin()` (piket
bertugas/BK/admin) — bukan sembarang guru.

#### `verifikasiIzinKeluar`, `tandaiKembaliIzinKeluar`, `tandaiPulangIzinKeluar` (POST)
| Field | Wajib |
|---|---|
| `id` | ya — `ID_Izin` baris yang dituju |

Ketiganya butuh `izinKapasitasVerifikasi()` (piket bertugas hari ini, atau
BK/admin sebagai fallback) dan menolak transisi status yang tidak valid
(lihat tabel status di `CLAUDE.md`). Server **tidak pernah** membaca
`kapasitas`/`role` dari body kalaupun dikirim klien.

#### `addIzinKelompok` (POST)
| Field | Wajib | Keterangan |
|---|---|---|
| `kegiatan` | ya | Maks 120 karakter (`IZIN_MAX_KEGIATAN`) |
| `tujuan` | ya | `'kembali'` \| `'pulang'` |
| `keperluan` | ya | |
| `pola_kembali` | tidak | `'bersama'` (default) \| `'individual'`; diabaikan kalau `tujuan='pulang'` |
| `peserta` | ya | Array NISN, duplikat dibuang, maks `IZIN_MAX_PESERTA` (60) |
| `jalur`, `alasan_khusus` | sama seperti `addIzinKeluar` | |

All-or-nothing: satu NISN tidak ditemukan atau satu peserta punya transaksi
terbuka → seluruh pengajuan ditolak, tidak ada baris yang ditulis sebagian.

#### `verifikasiIzinKelompok` (POST)
| Field | Wajib | Keterangan |
|---|---|---|
| `id` | ya | `ID_Kelompok` |
| `pesertaIds` | tidak | Kalau dikirim, **mempersempit** (bukan menambah) — id di luar kegiatan ini ditolak |

#### `tandaiKembaliKelompok` (POST)
| Field | Wajib |
|---|---|
| `id` | ya |
| `pesertaIds` | **ya** — tidak ada mode "tandai semua" |

---

### Tindak Lanjut

#### `ajukanTindakLanjut` (POST)
Otorisasi: admin/BK, atau wali kelas untuk `class_name` miliknya sendiri.

| Field | Wajib |
|---|---|
| `nisn`, `name`, `class_name` | ya |
| `catatan` | tidak |

#### `approveTindakLanjut` (POST, admin only)
| Field | Wajib |
|---|---|
| `nisn`, `timestamp` | ya — kunci pencarian baris |

---

### Kelola Guru & Akun (admin only, kecuali `changeMyPassword` di atas)

Semua aksi berikut menolak non-admin dengan pesan `'Hanya admin yang bisa ...'`.

| Action | Field wajib | Field opsional | Catatan |
|---|---|---|---|
| `addTeacher` | `newId`, `newName`, `newPassword`, `newRole` | `newJabatan` | `newId` harus unik |
| `updatePassword` | `targetId`, `newPassword` | — | Tidak perlu tahu password lama target |
| `updateJabatan` | `targetId` | `newJabatan` (kosong = label default) | |
| `updateRole` | `targetId`, `newRole` | — | `newRole` ∈ `guru`/`bk_kesiswaan`/`osis`/`admin` |
| `updateWaliKelas` | `targetId` | `newKelasWali` (kosong = lepas status wali kelas) | |
| `updateTeacherName` | `targetId`, `newName` | — | `newName` tidak boleh kosong |
| `toggleTeacherStatus` | `targetId` | — | Menolak menonaktifkan diri sendiri; respons ikut `newStatus` |
| `deleteTeacher` | `targetId` | — | Menolak hapus diri sendiri & guru yang masih jadi wali kelas aktif |

#### `setJadwalPiket` (POST, admin only)
| Field | Wajib |
|---|---|
| `schedule` | ya — array `{hari, guruId}`; **menimpa total** jadwal lama |

`hari` ∈ `Senin`..`Sabtu`, `guruId` harus ada di `Master_Guru`.

---

### Pemeliharaan Data (admin only)

#### `previewHapusData` (GET) & `hapusDataPeriode` (POST)
| Field | Wajib | Keterangan |
|---|---|---|
| `jenis` | ya | Array (POST) atau string dipisah koma (GET query) dari: `keterlambatan`, `pelanggaran`, `surat`, `izin`, `upacara` |
| `start`, `end` | ya | Format `YYYY-MM-DD`, `start` ≤ `end` |
| `confirm` | ya (`hapusDataPeriode` saja) | Harus `true` |

Batas 3000 baris (`HAPUS_DATA_MAX_ROWS`) dicek **sebelum** satu baris pun
dihapus. `previewHapusData` murni baca; jumlah aktual saat eksekusi dihitung
ULANG dari sheet (lihat race-condition note di `CLAUDE.md`), tidak pernah
memercayai angka pratinjau. `Bimbingan_Khusus` sengaja tidak termasuk.

---

### Endpoint Baca (`doGet`)

Kecuali disebutkan lain, tidak ada parameter selain `token`+`sessionToken`.

| Action | Parameter tambahan | Catatan |
|---|---|---|
| `getStudentLateHistory` | `nisn` | Balikan: `{history: [{timestamp, type}], count}` — `count` = total sekolah, tanpa detail |
| `getPelanggaranCountForStudent` | `nisn` | Balikan: `{count}` — angka saja, bukan daftar |
| `getLoginUsers` | — | Hanya `{id, name}`, guru `nonaktif` disaring. **Jangan** tambahkan field lain — endpoint ini publik-sebelum-login |
| `getTeachers` | — | Admin only; balikan terurut abjad |
| `getAuditLog` | — | Admin only; 300 baris terbaru, terbalik (terbaru dulu) |

`getIzinKeluar` juga mengirim `canVerify: boolean` (kenyamanan tampilan
tombol, **bukan** gerbang — gerbang sesungguhnya tetap di tiap aksi tulis)
dan `kelompok` (kegiatan Izin Kelompok yang minimal satu pesertanya
terlihat pemanggil).

#### `exportData` (GET)
| Parameter | Wajib | Keterangan |
|---|---|---|
| `jenis` | ya | `keterlambatan` \| `pelanggaran` \| `surat` \| `bimbingan` \| `upacara` \| `izin` \| `rekap` |
| `format` | ya | `pdf` \| `xlsx` |
| `start`, `end` | ya | `YYYY-MM-DD`, rentang maks 366 hari (`EXPORT_MAX_RANGE_DAYS`) |
| `kelas` | tidak | Nama kelas, atau kosong = semua kelas. **Tidak dipercaya** dari klien — divalidasi ulang lewat `resolveExportAccess()` |

Otorisasi per `jenis` (lihat tabel lengkap di `CLAUDE.md` "Export Data: who
may export what"): `bimbingan` admin/BK saja; jenis lain admin/BK (semua
kelas) atau wali kelas (kelasnya sendiri saja); plain guru & OSIS ditolak
semuanya. Batas 5000 baris (`EXPORT_MAX_ROWS`) per laporan. Balikan sukses:
`{ report: { jenis, jenisLabel, judul, sekolah, columns, rows, total, periodeLabel, scopeLabel, format, dibuatPada } }`
— PDF/XLSX sungguhan dirakit di klien oleh `export-format.js` dari `report`
ini, server tidak pernah mengirim file biner.

---

## Contoh Request

```bash
# Status ping (tanpa sesi)
curl "$API_URL?token=$API_TOKEN"

# Login
curl -X POST "$API_URL" -d '{"token":"'"$API_TOKEN"'","action":"login","password":"...","teacherId":"G01"}'

# Catat keterlambatan (perlu sessionToken dari login)
curl -X POST "$API_URL" -d '{
  "token":"'"$API_TOKEN"'","sessionToken":"'"$SESSION"'","action":"record",
  "nisn":"1001","name":"Rahma","class_name":"XI A","type":"Kesiangan"
}'

# Pratinjau Hapus Data (GET, admin)
curl "$API_URL?token=$API_TOKEN&sessionToken=$SESSION&action=previewHapusData&jenis=keterlambatan,surat&start=2026-01-01&end=2026-01-31"
```
