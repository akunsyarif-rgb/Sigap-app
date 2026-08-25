# SIGAP — Panduan Fitur & Alur Kerja

**Untuk dibaca oleh: Guru, Kepala Sekolah, Wali Kelas, Orang Tua, dan Siswa**
*(Tidak perlu paham komputer untuk membaca dokumen ini.)*

---

## 1. Ringkasan Singkat

SIGAP (Sistem Informasi Gerbang & Absensi Pelanggaran) adalah aplikasi sekolah untuk **mencatat keterlambatan siswa, surat izin/sakit, izin keluar/pulang di tengah jam pelajaran (BETA), pelanggaran tata tertib, dan pelanggaran saat upacara** di SMAN 2 Tarakan. Semua catatan yang selama ini ditulis di buku piket sekarang masuk ke satu tempat yang rapi, bisa dicari, dan bisa dilihat rekapnya kapan saja.

Aplikasi ini dipakai **oleh guru dan petugas sekolah**, dibuka lewat **browser HP atau laptop** — tidak perlu instal apa pun dari Play Store atau App Store.

---

## 2. Satu Aplikasi, Empat Pintu Masuk

Bayangkan SIGAP seperti **satu gedung dengan empat pintu masuk**. Semua orang masuk ke gedung yang sama, tapi pintu yang dipakai menentukan ruangan mana saja yang boleh dimasuki.

| Pintu (Peran) | Siapa yang pakai | Yang bisa dilihat & dilakukan |
|---|---|---|
| **Admin** | Operator/pengelola sistem | Semua menu, plus mengelola akun guru, jadwal piket, dan mengunduh data |
| **BK/Kesiswaan** | Guru BK & tim kesiswaan | Semua catatan disiplin sekolah, rekap seluruh kelas, catatan bimbingan khusus |
| **Guru** | Semua guru (termasuk guru piket) | Mencatat terlambat, surat, dan pelanggaran; melihat riwayat & statistik |
| **OSIS** | Pengurus OSIS yang ditunjuk | **Hanya** menu Upacara — mencatat pelanggaran upacara dan melihat rekapnya. Tidak bisa melihat data disiplin lain |

Tambahan penting: seorang guru yang **ditetapkan sebagai wali kelas** otomatis mendapat menu tambahan **Rekap Kelas**, khusus untuk kelas perwaliannya sendiri. Guru lain tidak melihat menu itu.

> **Analogi:** peran itu seperti kartu akses hotel. Semua tamu masuk lewat lobi yang sama, tapi kartu Anda hanya membuka lantai dan kamar yang jadi hak Anda.

---

## 3. Fitur Utama untuk Guru

### 3.1 Gerbang — Catat Terlambat & Catat Surat

Ini menu yang paling sering dipakai, terutama guru piket pagi. Ada dua mode yang dipilih lewat satu sakelar di atas layar:

**Mode "Catat Terlambat"**
- Ketik nama, kelas, atau NISN siswa di kotak pencarian.
- Pilih siswanya — nama wali kelasnya ikut muncul, jadi guru piket langsung tahu harus menghubungi siapa kalau perlu.
- Pilih alasan lewat tombol cepat: **Telat Bangun, Hujan, Kendaraan, Urusan Keluarga**, atau ketik alasan sendiri.
- Kalau siswa itu sudah 3 kali atau lebih tercatat terlambat, muncul **peringatan merah** beserta tiga catatan terakhirnya — supaya guru tahu ini bukan kejadian pertama.
- Satu siswa hanya bisa dicatat terlambat **satu kali per hari**. Kalau sudah dicatat guru lain, aplikasi menolak dan memberi tahu.

**Mode "Catat Surat"**
- Untuk siswa yang **izin atau sakit** dan membawa surat.
- Guru memilih jenis (misalnya Sakit / Izin) lalu menulis keterangan singkat.
- Ini adalah **laporan tertulis** — tidak ada unggah foto surat.

**Aktivitas Hari Ini** tampil di bawah kotak pencarian: daftar langsung semua siswa yang sudah dicatat hari ini, lengkap dengan jam, jenis catatan, dan nama guru yang mencatat. Gunanya supaya dua guru piket tidak mencatat siswa yang sama dua kali.

> *Contoh nyata:* Pak Budi piket di gerbang jam 07.10. Ada siswa datang terlambat. Pak Budi buka SIGAP di HP → menu **Gerbang** → ketik "Rizki" → pilih namanya → tekan tombol **⏰ Telat Bangun**. Selesai dalam waktu kurang dari 15 detik, dan nama Rizki langsung muncul di daftar Aktivitas Hari Ini yang juga dilihat guru piket lainnya.

### 3.2 Beranda — Ringkasan Hari Ini

Halaman pertama setelah masuk. Isinya:

- **Sapaan** sesuai jam (Selamat pagi / siang / sore) dan nama Anda.
- **Tugas hari ini**: apakah Anda piket hari ini, siapa saja guru piket hari itu, dan kelas perwalian Anda (kalau ada).
- **Tiga kartu ringkasan**: jumlah Terlambat, Surat, dan Pelanggaran hari ini.
- **Daftar Surat Hari Ini**: siapa saja yang izin/sakit hari ini beserta keterangannya — berguna untuk semua guru, bukan hanya guru piket.
- **Aktivitas Hari Ini**: catatan terlambat & pelanggaran terbaru, terbaru di atas.
- **Perlu Perhatian**: daftar siswa yang sudah **3 kali terlambat dalam seminggu** atau **5 kali dalam sebulan**. Dari sini wali kelas/BK bisa mengajukan tindak lanjut (lihat alur di bagian 5.6).

### 3.3 Riwayat — Mencari Catatan Lama

Semua catatan tersimpan dan bisa ditelusuri kapan saja.

- Pilih kategori: **Terlambat / Pelanggaran / Surat**.
- Saring berdasarkan waktu: Hari Ini, Kemarin, Minggu Ini, Bulan Ini, tanggal tertentu, atau Semua.
- Saring berdasarkan kelas dan jenis, atau cari langsung dengan nama/NISN.
- Urutkan dari yang terbaru (bawaan) atau berdasarkan Kelas & Nama A–Z.

**Siapa melihat apa di Riwayat** (dibatasi di server, bukan sekadar disembunyikan di layar):

| | Keterlambatan & Surat hari ini | Riwayat keterlambatan & surat hari sebelumnya | Pelanggaran |
| --- | --- | --- | --- |
| Guru | seluruh sekolah | tidak ada | hanya yang ia catat sendiri (tanggal berapa pun) |
| Wali kelas | seluruh sekolah | kelas perwaliannya | kelas perwaliannya + catatannya sendiri |
| BK/Kesiswaan & Admin | seluruh sekolah | seluruh sekolah | seluruh sekolah |
| OSIS | tidak ada akses | tidak ada akses | tidak ada akses |

Kolom "hari ini" sengaja terbuka untuk semua guru: guru piket di gerbang harus saling melihat catatan hari itu supaya satu siswa tidak tercatat dua kali. Catatan yang dibuat seorang guru tetap terlihat olehnya **pada hari itu**; besoknya, catatan untuk siswa di luar kelas perwaliannya tidak lagi muncul di layarnya. Pelanggaran sengaja berbeda: catatan yang ia buat sendiri tetap bisa ia telusuri kapan pun.

Aturan ini soal **apa yang terlihat**. Aturan perbaikan catatan tidak berubah: koreksi hanya bisa dilakukan dalam 5 menit pertama sejak dicatat (Admin tanpa batas waktu).

**Perbaikan salah ketik:** kalau guru salah memilih alasan atau salah ketik keterangan, catatan bisa **diubah atau dihapus dalam 5 menit pertama** sejak dicatat, dan hanya catatan yang ditulis sendiri. Setelah 5 menit lewat, hanya Admin yang bisa memperbaikinya. Aturan ini sengaja dibuat agar catatan tidak bisa "dirapikan" diam-diam berhari-hari kemudian.

### 3.3b Izin Keluar · BETA — Siswa Meninggalkan Sekolah di Tengah Jam Pelajaran

Ada di dalam menu **Gerbang**, sebagai mode ketiga di samping *Catat Terlambat* dan *Catat Surat*. Ini **bukan** fitur Surat: Surat adalah laporan tertulis untuk siswa yang tidak masuk atau terlambat, sedangkan Izin Keluar mencatat siswa yang **keluar dari lingkungan sekolah** dan mengikutinya sampai siswa itu kembali (atau memang pulang).

Statusnya **BETA** karena masih tahap uji coba dan perangkat pencetakan slip belum tersedia di sekolah.

**Alurnya persis prosedur yang sudah berjalan — tidak dipotong:**

| Langkah | Siapa | Yang terjadi di aplikasi |
|---|---|---|
| 1. Persetujuan | Guru yang memberikan persetujuan | Isi keperluan & pilih tujuan → status **Menunggu Verifikasi** |
| 2. Verifikasi | Guru piket yang bertugas hari itu | Tekan *Verifikasi* → siswa tercatat keluar |
| 3. Siswa kembali | Guru/petugas piket yang sedang bertugas | Tekan *Tandai Kembali* → status **Kembali** |

Persetujuan guru **saja belum membuat siswa boleh keluar** — jam keluar baru dicatat saat guru piket memverifikasi.

**Kenapa tidak ada pilihan "saya Guru Mapel jam ini" atau "saya Wali Kelas"?** Karena SIGAP **tidak menyimpan jadwal mengajar guru per jam**, dan data itu memang sengaja tidak ditambahkan — jadwal sebenarnya di sekolah bisa berubah sewaktu-waktu, jadi aplikasi tidak akan pernah bisa memastikan siapa yang "seharusnya" mengajar di jam itu. Meminta guru mengaku begitu hanya akan jadi formalitas yang tidak bisa dicek kebenarannya. Jadi yang dilakukan aplikasi cukup ini: mencatat **siapa yang memberikan persetujuan** (diambil dari akun yang sedang login, bukan diketik) dan **kapan**. Di layar persetujuan tertulis apa adanya: *"Anda akan tercatat sebagai pihak yang memberikan persetujuan izin ini."* Siapa yang pantas memberi persetujuan tetap ditentukan prosedur sekolah — SIGAP mencatat, bukan menghakimi.

**Dua pilihan tujuan saat izin dibuat:**

- **Kembali ke sekolah** — setelah diverifikasi, siswa berstatus *Sedang di Luar* sampai ada petugas piket yang menandainya kembali. Yang menandai **tidak harus** orang yang tadi memberi izin, jadi pergantian guru piket di hari yang sama tidak jadi masalah.
- **Pulang / tidak kembali** — setelah diverifikasi, transaksinya langsung selesai. Siswa yang izin pulang **tidak bisa** ditandai kembali, dan siswa yang sudah ditandai kembali tidak bisa ditandai kembali dua kali.

**Izin Khusus (jalur pengecualian).** Kadang guru yang biasa menangani siswa itu tidak ada di sekolah sementara kondisi siswa butuh keputusan saat itu juga. Untuk keadaan itu, guru piket yang bertugas (juga BK/Admin) bisa memakai jalur **Izin Khusus**. Aplikasi **tidak** menuliskan seolah-olah ada guru lain yang sudah menyetujui: transaksinya ditandai jelas sebagai *Izin Khusus* atas nama petugas yang mengambil keputusan, **alasan pengecualiannya wajib diisi**, dan semuanya masuk Audit Log. Jalur ini untuk keadaan yang memang tidak bisa menunggu — bukan jalan pintas kalau prosedur normal masih bisa ditempuh.

**Halaman utamanya** menampilkan tiga kelompok yang memang ditanyakan sepanjang hari: **Menunggu Verifikasi**, **Sedang di Luar**, dan **Selesai Hari Ini**. Satu siswa tidak bisa punya dua izin keluar yang berjalan bersamaan, jadi tombol yang tertekan dua kali tidak menghasilkan dua catatan.

**Soal privasi:** izin yang **masih berjalan** terlihat semua guru — petugas piket harus tahu siapa yang masih di luar. Riwayat izin yang sudah tertutup mengikuti aturan yang sama dengan keterlambatan & surat: wali kelas melihat kelas perwaliannya, BK/Admin melihat seluruh sekolah, dan OSIS tidak melihat sama sekali. Fitur ini **tidak** menambah akses siapa pun.

**Soal cetak:** untuk sekarang seluruhnya digital. Jenis printer, cara koneksi, media, dan ukuran kertas/slip **belum ditentukan sekolah**, jadi belum ada satu pun bagian aplikasi yang berhubungan dengan alat cetak. Yang tampil di layar hanya keterangan *"Fitur pencetakan masih dalam tahap BETA."* Kalau nanti printernya sudah ada, cetakan menjadi hasil dari transaksi yang **sudah tersimpan** — bukan syarat supaya transaksinya berhasil.

### 3.4 Pelanggaran — Catat Pelanggaran Tata Tertib

- Cari siswa, lalu isi **jenis pelanggaran** (tombol cepat: Bolos, Rambut/Seragam, Merokok — atau ketik sendiri), **sanksi** (Teguran Lisan, Surat Peringatan, Panggil Orang Tua — atau ketik sendiri), dan catatan tambahan bila perlu.
- Saat siswa dipilih, aplikasi menampilkan **berapa kali siswa itu sudah pernah tercatat** — supaya guru tahu apakah ini kejadian berulang.
- Dari halaman ini, guru BK/Kesiswaan dan Admin juga bisa menandai siswa sebagai **"Perlu Bimbingan Khusus"** beserta catatannya.

**Soal privasi:** guru biasa hanya melihat daftar pelanggaran **yang ia catat sendiri**. Wali kelas melihat pelanggaran **kelas perwaliannya + catatannya sendiri**. BK/Kesiswaan dan Admin melihat seluruh sekolah. Ini disengaja supaya catatan pribadi siswa tidak beredar ke semua guru.

### 3.5 Upacara — Catat & Rekap Pelanggaran Upacara

Menu ini dipakai bersama antara **OSIS**, **BK/Kesiswaan**, **Admin**, dan **wali kelas**.

- **Catat**: cari siswa → pilih jenis (Atribut Tidak Lengkap, Tidak Tertib, Terlambat Baris, atau ketik sendiri) → tambahkan catatan → Simpan.
- **Rekap**: tampilan baca, dikelompokkan **per kelas**, bisa disaring per periode (Hari Ini / Minggu Ini / Bulan Ini / Semua), per kelas, per jenis, atau dicari per nama siswa.

Rekap ini bisa dibuka OSIS untuk seluruh sekolah, tapi OSIS **tidak bisa melihat kategori disiplin yang lain** (terlambat, surat, pelanggaran, bimbingan). Wali kelas melihat rekap upacara **kelasnya saja**.

### 3.6 Rekap Kelas — Untuk Wali Kelas, BK, dan Admin

Ringkasan per kelas dalam satu layar:

- Nama wali kelas dan jumlah siswa di kelas itu.
- Jumlah **Terlambat**, **Pelanggaran**, dan **Pelanggaran Upacara** dalam periode yang dipilih.
- Daftar siswa yang tercatat, dikelompokkan per kategori, lengkap dengan **berapa kali** dan **jenis/alasannya**.

Admin dan BK/Kesiswaan melihat semua kelas. Wali kelas hanya melihat kelas perwaliannya sendiri — dan langsung terbuka tanpa perlu mencari.

### 3.7 Statistik — Melihat Tren

- Grafik batang tren **Mingguan / Bulanan / Semester / Tahunan**, untuk kategori Terlambat, Pelanggaran, atau Surat.
- Daftar **siswa yang sering terlambat** (minimal 3 kali) dalam jendela waktu yang bisa dipilih: 1 minggu, 2 minggu, 3 minggu, atau sebulan.
- Ringkasan kelas dan jenis kasus terbanyak.
- **Mode Ranking** (kelas mana kasusnya paling banyak) hanya tersedia untuk BK/Kesiswaan dan Admin. Guru biasa mendapat mode "Per Kelas" urut A–Z. Ini disengaja agar perbandingan antar kelas tidak jadi bahan saling melabeli.
- **Unduh data (CSV)** — bisa dibuka di Excel — tersedia untuk Admin. Untuk laporan yang lebih rapi (PDF siap cetak / Excel dengan kop & periode), lihat menu **Export Data** di 3.11.

### 3.8 Bimbingan Khusus — Untuk BK/Kesiswaan & Admin

Daftar siswa yang ditandai perlu pendampingan khusus, beserta catatan dan nama guru yang menandai. Menu ini tertutup untuk guru biasa dan OSIS.

### 3.9 Kelola — Khusus Admin

Satu halaman berisi tiga kelompok pengaturan:

- **Guru & Akun**: menambah guru baru (ID, nama, password awal, peran, jabatan), mengatur ulang password yang lupa, mengubah jabatan, mengubah peran, menetapkan **wali kelas** (dipilih dari daftar kelas yang ada, bukan diketik manual agar tidak salah ketik), serta **menonaktifkan/mengaktifkan** akun guru yang pindah/pensiun. Ada kotak pencarian nama guru.
- **Jadwal Piket**: menyusun jadwal piket mingguan (Senin–Sabtu) dengan memilih hari dan guru, lalu menyimpan. Jadwal ini yang muncul di Beranda semua guru sebagai "Guru Piket Hari Ini".
- **Hapus data surat per bulan**: pembersihan arsip surat dalam jumlah besar, dengan dialog konfirmasi sebelum benar-benar dihapus.

### 3.10 Audit Log — Jejak Siapa Melakukan Apa

Catatan permanen 300 aktivitas terakhir: siapa login, siapa menambah/mengubah/menghapus catatan, kapan, dan atas siswa siapa. Bisa dicari. **Hanya Admin** yang bisa membukanya — BK/Kesiswaan, wali kelas, guru, dan OSIS tidak. Fungsinya seperti **buku tamu yang tidak bisa dihapus** — kalau ada catatan yang hilang atau berubah, ketahuan siapa yang melakukannya.

### 3.11 Export Data — Laporan PDF & Excel Tanpa Membuka Spreadsheet

Google Spreadsheet tetap **hanya boleh dibuka Admin**. Supaya guru/BK tidak perlu dibukakan akses ke sana hanya untuk mengambil rekap, ada menu **Export Data** (ada di tombol "Lainnya"):

1. Pilih **jenis data**: Keterlambatan, Pelanggaran, Surat/Izin, Pelanggaran Upacara, Bimbingan Khusus (khusus Admin/BK), atau Rekap Siswa (gabungan semuanya per siswa).
2. Pilih **kelas**: semua kelas atau satu kelas. Untuk wali kelas, kolom ini sudah terkunci ke kelas perwaliannya — tidak perlu memilih.
3. Pilih **periode**: dari tanggal — sampai tanggal (maksimal satu tahun sekali unduh).
4. Pilih **format**: PDF (siap cetak, lengkap dengan kop sekolah, judul, periode, cakupan, tanggal cetak, dan jumlah record) atau Excel (.xlsx, satu baris per kejadian, siap diolah lagi).
5. Tekan **Generate & Download**.

Siapa boleh mengekspor apa:

| Peran | Boleh export? | Cakupan |
| --- | --- | --- |
| Admin | Ya, semua jenis | Semua kelas |
| BK/Kesiswaan | Ya, semua jenis | Semua kelas |
| Wali kelas | Ya, kecuali Bimbingan Khusus | Hanya kelas perwaliannya |
| Guru biasa (bukan wali kelas) | Tidak | — |
| OSIS | Tidak | — |

Batasan ini diperiksa **di server**, bukan sekadar menyembunyikan tombol: kalau permintaan diubah-ubah dari luar aplikasi agar meminta kelas lain, permintaannya ditolak. Berkas laporan hanya memuat kolom yang memang diperlukan (tanpa NISN) dan **setiap pembuatan laporan — berhasil maupun ditolak — tercatat di Audit Log**.

### 3.11 Kenyamanan Pakai

- **Ukuran huruf bisa diperbesar** lewat tombol di bagian atas layar, dan pilihan itu diingat untuk kunjungan berikutnya.
- **Tetap login sampai 6 jam** — tidak perlu memasukkan password ulang setiap membuka aplikasi dalam rentang itu.
- Tampilan dirancang untuk **layar HP** dengan tombol besar, karena sebagian besar pencatatan dilakukan sambil berdiri di gerbang.

---

## 4. Bagaimana Siswa dan Orang Tua Terlibat

Perlu dijelaskan sejujurnya: **SIGAP saat ini tidak memiliki aplikasi khusus siswa atau orang tua.** Tidak ada kode akses untuk siswa, dan siswa tidak login untuk melihat datanya sendiri.

Yang ada sekarang:

- **Siswa** terlibat sebagai pengurus **OSIS** yang diberi akun khusus untuk mencatat pelanggaran upacara. Akun OSIS hanya bisa membuka menu Upacara.
- **Orang tua** mendapat informasi melalui jalur sekolah seperti biasa — wali kelas atau guru BK menghubungi orang tua berdasarkan data yang sudah rapi di SIGAP (misalnya "sudah 5 kali terlambat bulan ini"), termasuk lewat sanksi "Panggil Orang Tua" yang tercatat di aplikasi.

Manfaat SIGAP bagi siswa dan orang tua bersifat **tidak langsung tapi nyata**: catatan jadi akurat dan tidak asal ingat, keputusan sekolah punya dasar data, dan tidak ada siswa yang dicatat dua kali untuk kejadian yang sama.

---

## 5. Alur Kerja Langkah demi Langkah

### 5.1 Masuk Pertama Kali (Guru Baru)

1. Admin membuat akun Anda lebih dulu lewat menu **Kelola → Guru & Akun → Tambah Guru**, dan memberi tahu **password awal** Anda.
2. Buka alamat SIGAP di browser HP atau laptop.
3. Di kotak **Nama Guru**, ketik nama Anda, lalu ketuk nama Anda yang muncul.
4. Masukkan **password** Anda, lalu tekan **Masuk**. Kalau password Anda angka semua, ketuk **123** di samping label agar keyboard HP langsung terbuka sebagai papan angka.
5. Selesai — Anda langsung diarahkan ke Beranda dengan menu sesuai peran Anda.

> **Catatan:** kalau daftar nama guru belum sempat muncul (misalnya sinyal lambat), Anda **tetap bisa langsung mengisi password dan menekan Masuk**. Formnya sengaja dibuat tidak pernah terkunci.

### 5.2 Mencatat Keterlambatan (4 Langkah)

1. Buka menu **Gerbang**, pastikan sakelar di posisi **Catat Terlambat**.
2. Ketik nama / kelas / NISN siswa.
3. Ketuk nama siswa yang benar.
4. Tekan tombol alasan (⏰ Telat Bangun, 🌧️ Hujan, 🏍️ Kendaraan, 👥 Urusan Keluarga) — atau ketik alasan lain lalu tekan **Simpan**.

Catatan langsung tersimpan dan muncul di daftar **Aktivitas Hari Ini**.

### 5.3 Mencatat Surat Izin/Sakit

1. Buka menu **Gerbang**, geser sakelar ke **Catat Surat**.
2. Cari dan pilih siswanya.
3. Pilih **jenis** (Sakit / Izin / lainnya) dan tulis **keterangan** singkat.
4. Tekan **Simpan**. Jendela isian baru tertutup setelah server benar-benar mengonfirmasi tersimpan — jadi kalau gagal, isian Anda tidak hilang dan bisa langsung dicoba lagi.

### 5.3b Mencatat Izin Keluar / Pulang (BETA)

1. Buka menu **Gerbang**, geser sakelar ke **Izin Keluar · BETA**.
2. Cari dan pilih siswanya. (Kalau siswa itu masih punya izin yang berjalan, namanya tidak bisa dipilih lagi.)
3. Isi **keperluan**, lalu pilih tujuan: **Kembali ke sekolah** atau **Pulang / tidak kembali**.
4. Tekan **Setujui Izin**. Anda tercatat sebagai pihak yang memberikan persetujuan; statusnya jadi *Menunggu Verifikasi* — siswa **belum boleh keluar**.
5. **Guru piket** membuka layar yang sama, melihat izin itu di daftar *Menunggu Verifikasi*, lalu menekan **Verifikasi & Siswa Keluar**.
6. Kalau tujuannya kembali ke sekolah: begitu siswa datang lagi, petugas piket yang sedang bertugas menekan **Tandai Kembali** pada namanya di daftar *Sedang di Luar*.

*Kalau guru yang menangani siswa itu benar-benar tidak ada di sekolah:* guru piket mencentang **Izin Khusus** di langkah 3, mengisi **alasan pengecualian**, lalu menyimpan. Aplikasi menampilkan penegasan bahwa ini pengecualian dan akan tercatat sebagai Izin Khusus.

### 5.4 Mencatat Pelanggaran Tata Tertib

1. Buka menu **Pelanggaran**.
2. Cari dan pilih siswanya. Perhatikan keterangan berapa kali siswa itu sudah pernah tercatat.
3. Pilih **jenis pelanggaran** dan **sanksi** (pakai tombol cepat atau ketik sendiri).
4. Tambahkan catatan bila perlu, lalu **Simpan**.

> *Contoh nyata:* Bu Sari mendapati seorang siswa merokok di belakang kantin. Ia buka **Pelanggaran** → cari nama siswa → pilih **Merokok** → pilih sanksi **Panggil Orang Tua** → tulis catatan "Ditemukan di belakang kantin jam istirahat" → **Simpan**. Guru BK melihat catatan itu di harinya juga.

### 5.5 Mencatat Pelanggaran Upacara (OSIS)

1. Pengurus OSIS login dengan akun OSIS.
2. Menu yang tampil hanya **Upacara**, dalam posisi **Catat**.
3. Cari siswa → pilih jenis pelanggaran → tulis catatan bila perlu → **Simpan**.
4. Untuk melihat hasil keseluruhan, geser ke tab **Rekap** — data ditampilkan per kelas dan bisa disaring.

### 5.6 Menindaklanjuti Siswa yang Sering Terlambat

1. Di **Beranda**, lihat bagian **Perlu Perhatian** (muncul untuk wali kelas atas kelasnya, dan untuk BK/Admin atas seluruh sekolah).
2. Ketuk siswa yang bersangkutan, lalu tulis **catatan tindak lanjut** — misalnya "Sudah dipanggil dan orang tua dihubungi tanggal 12".
3. Ajukan. Statusnya menjadi **menunggu**.
4. **Admin** meninjau lalu menekan **Setujui**.
5. Setelah disetujui, hitungan siswa tersebut dimulai dari nol lagi sejak tanggal persetujuan — namanya hilang dari daftar Perlu Perhatian. Kalau ia terlambat lagi setelah itu, namanya akan muncul kembali secara wajar. Riwayat lamanya **tidak dihapus**.

### 5.7 Wali Kelas Memeriksa Kondisi Kelasnya

1. Login, lalu buka menu **Rekap Kelas** (menu ini otomatis muncul untuk wali kelas).
2. Kelas perwalian Anda sudah terbuka langsung.
3. Pilih periode: Hari Ini / Minggu Ini / Bulan Ini / Semua.
4. Lihat jumlah Terlambat, Pelanggaran, dan Pelanggaran Upacara, serta daftar nama siswanya beserta berapa kali dan jenisnya.

Di **Beranda**, wali kelas juga langsung melihat ringkasan mingguan kelasnya dan daftar siswa kelasnya yang izin/sakit minggu itu.

### 5.8 Admin Menyusun Jadwal Piket

1. Buka **Kelola → Jadwal Piket**.
2. Pilih **hari** (Senin–Sabtu), pilih **nama guru**, tekan tambah. Ulangi untuk semua hari.
3. Tekan **Simpan**.
4. Mulai saat itu, setiap guru melihat "Guru Piket Hari Ini" di Beranda mereka, dan guru yang bertugas mendapat tanda **✓ Anda piket hari ini**.

### 5.9 Guru Lupa Password

1. Hubungi Admin sekolah.
2. Admin membuka **Kelola → Guru & Akun**, mencari nama guru tersebut, lalu menekan tindakan **atur ulang password**.
3. Admin memberi tahu password yang baru kepada guru yang bersangkutan.

Tidak ada tombol "lupa password" yang mengirim email — pemulihan password dilakukan lewat Admin sekolah.

---

## 6. Berapa Biayanya? Apakah Ada Paket Berlangganan?

**Tidak ada paket berlangganan dan tidak ada biaya per pengguna.** SIGAP bukan produk komersial berlangganan — ini aplikasi internal SMAN 2 Tarakan.

- Tidak ada batas jumlah kelas, jumlah guru, atau jumlah catatan yang dikunci di balik pembayaran.
- Datanya disimpan di **Google Spreadsheet milik sekolah** — ibaratnya lemari arsip digital yang kuncinya dipegang sekolah sendiri, bukan disewa dari pihak lain.
- Yang dibutuhkan sekolah hanya akun Google dan koneksi internet.

---

## 7. Yang Belum Ada di SIGAP (Sering Ditanyakan)

Agar tidak ada salah harapan, berikut hal-hal yang **belum** ditangani aplikasi ini:

- Presensi kehadiran harian lengkap seluruh kelas (SIGAP mencatat keterlambatan dan surat izin/sakit, bukan absensi tiap jam pelajaran).
- Jurnal mengajar, tugas, penilaian, dan rapor.
- Kas kelas, inventaris kelas, dan pencatatan prestasi siswa.
- Jadwal pelajaran / jadwal mengajar guru per jam (yang ada adalah **jadwal piket guru**). Karena itu aplikasi juga tidak memverifikasi siapa guru mata pelajaran pada jam tertentu — lihat penjelasan di bagian Izin Keluar.
- Aplikasi khusus siswa atau orang tua, dan pengumuman ke siswa.
- Aplikasi Android/iOS di toko aplikasi — SIGAP dibuka lewat **browser**.
- **Cetak slip izin keluar.** Fitur Izin Keluar masih BETA dan seluruhnya digital; jenis printer, cara koneksi, media, dan ukuran slipnya belum ditentukan sekolah, jadi belum dirancang sama sekali.

---

## 8. Pertanyaan yang Sering Diajukan (FAQ)

**1. Apakah data siswa aman?**
Data disimpan di spreadsheet milik sekolah, bukan di layanan pihak ketiga yang tidak dikenal. Setiap orang harus login dengan nama dan password, dan **tidak semua orang melihat semua data**: guru biasa tidak menyimpan riwayat keterlambatan/surat hari-hari sebelumnya sama sekali (hari ini tetap terbuka untuk semua guru demi alur gerbang) dan hanya melihat catatan pelanggaran yang ia tulis sendiri, wali kelas melihat kelas perwaliannya, OSIS hanya data upacara. Setiap perubahan tercatat permanen di Audit Log. Batasan ini diberlakukan di sisi server, bukan sekadar menyembunyikan menu.

**2. Apakah bisa dipakai di HP?**
Bisa, dan memang dirancang untuk HP. Cukup buka alamat SIGAP lewat browser (Chrome, Safari, dll.) — tidak perlu instal aplikasi. Bisa juga dibuka di laptop.

**3. Bagaimana kalau lupa password?**
Hubungi Admin sekolah untuk diatur ulang (lihat alur 5.9). Tidak ada pemulihan lewat email/SMS.

**4. Apakah siswa perlu email untuk memakai aplikasi ini?**
Tidak. Siswa tidak login sama sekali, kecuali pengurus OSIS yang diberi akun khusus oleh Admin. Akun itu pun cukup nama + password, tanpa email.

**5. Kalau saya salah catat, bagaimana?**
Anda bisa memperbaiki atau menghapus catatan Anda sendiri dalam **5 menit** pertama lewat menu Riwayat. Lewat dari itu, mintalah bantuan Admin. Semua perbaikan tercatat di Audit Log.

**6. Kalau dua guru piket mencatat siswa yang sama, apakah datanya jadi dobel?**
Tidak. Satu siswa hanya bisa dicatat terlambat sekali per hari — percobaan kedua akan ditolak dengan pesan yang jelas. Selain itu daftar **Aktivitas Hari Ini** memperlihatkan siapa saja yang sudah dicatat beserta nama pencatatnya.

**7. Kalau internet di gerbang lambat, apakah aplikasi macet?**
Layar login tetap bisa diisi walaupun daftar nama guru belum selesai dimuat. Halaman lain memuat data secukupnya, bukan seluruh arsip sekolah, sehingga tetap ringan meski data sudah menumpuk bertahun-tahun. Namun aplikasi ini tetap **membutuhkan koneksi internet** untuk menyimpan catatan.

**8. Apakah saya harus login ulang setiap hari?**
Sesi bertahan **6 jam**. Setelah itu Anda diminta memasukkan password lagi — pembatasan waktu ini disengaja demi keamanan data siswa.

---

## 9. Analogi Keseluruhan

**SIGAP itu seperti buku piket gerbang, buku kasus BK, dan buku catatan wali kelas — yang digabung jadi satu, dipindahkan ke dalam HP, dan otomatis merapikan dirinya sendiri.**

Buku piket lama hanya bisa dipegang satu orang di satu tempat, tulisannya bisa sulit dibaca, dan untuk tahu "siswa ini sudah berapa kali terlambat" seseorang harus membalik puluhan halaman. SIGAP menjawab pertanyaan itu dalam satu detik, untuk semua guru sekaligus, tanpa ada halaman yang hilang.

---

## 10. Perkenalan 30 Detik

> "SIGAP adalah aplikasi pencatatan kedisiplinan siswa SMAN 2 Tarakan. Guru piket cukup buka aplikasi di HP, cari nama siswa, dan tekan satu tombol untuk mencatat keterlambatan, surat izin/sakit, atau pelanggaran — semuanya masuk ke satu arsip digital sekolah. Wali kelas bisa langsung melihat rekap kelasnya, guru BK melihat kondisi seluruh sekolah, dan aplikasi otomatis menandai siswa yang sudah terlalu sering terlambat agar bisa segera ditindaklanjuti. Tidak perlu instal aplikasi, cukup buka lewat browser, dan setiap perubahan data tercatat siapa pelakunya."
