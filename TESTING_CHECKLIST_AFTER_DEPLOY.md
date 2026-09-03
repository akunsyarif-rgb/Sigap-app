# Testing Checklist — Setelah Deploy Cetak Surat Izin Keluar

Jalankan checklist ini di aplikasi SIGAP yang sungguhan (browser, bukan
`npm test`) setelah `DEPLOYMENT_CHECKLIST.md` selesai. Bagian 1-8 adalah
alur normal (yang diminta brief awal); Bagian 9 adalah kasus-kasus dari
hasil code review yang sebaiknya dicek juga sebelum dianggap selesai —
lihat laporan code review untuk detail teknisnya masing-masing.

Login sebagai **guru piket yang bertugas hari ini** (atau admin/BK) untuk
sebagian besar langkah — beberapa langkah eksplisit minta akun lain, sudah
ditandai.

---

## 1. Siapkan satu transaksi yang bisa dicetak

- [ ] Buat izin keluar baru untuk satu siswa uji coba (Gerbang → Izin
      Keluar → cari siswa → Berikan Persetujuan/Izin → isi keperluan →
      Setujui Izin).
- [ ] Verifikasi izin itu (sebagai guru piket) → status jadi "Sedang di
      Luar" (kalau tujuannya "kembali") atau "Pulang" (kalau "pulang").
- [ ] Catat NAMA siswa uji coba ini — dipakai untuk cocokkan isi surat di
      langkah-langkah berikutnya.

## 2. Tombol "Cetak Surat Izin"

- [ ] Kartu transaksi di atas (bucket "Sedang di Luar" atau "Selesai Hari
      Ini") menampilkan tombol **"📄 Cetak Surat Izin"**.
- [ ] Kartu di bucket **"Menunggu Verifikasi"** TIDAK punya tombol ini
      (belum boleh dicetak sebelum diverifikasi).
- [ ] Klik tombol → muncul dialog konfirmasi ("Generate surat izin
      keluar?..."). Klik OK.
- [ ] Tombol berubah jadi "Membuat surat..." sesaat, lalu preview modal
      terbuka.

## 3. Isi Preview Surat

Di modal preview, cek SEMUA berikut tampil dan **datanya benar** (cocok
dengan transaksi di langkah 1):

- [ ] Logo SMAN 2 Tarakan tampil di header (kalau tidak tampil/rusak,
      bukan blocker — ada fallback `onerror` yang menyembunyikannya,
      tapi tetap cek: kemungkinan `IMG_1966.jpeg` tidak accessible publik
      dari `raw.githubusercontent.com`, lihat catatan Bagian 9).
- [ ] Judul "SURAT IZIN KELUAR".
- [ ] Nomor surat format `IK-YYYYMMDD-NNN` (tanggal hari ini, urutan
      dimulai dari 001 kalau ini surat pertama hari ini).
- [ ] Nama & kelas siswa benar.
- [ ] Tujuan & keperluan sesuai yang diisi.
- [ ] Baris "Disetujui Oleh" — nama guru yang approve, + label "Wali
      Kelas" atau "Guru Mapel" (cek label ini AKURAT: kalau guru yang
      approve memang wali kelas siswa itu, harus "Wali Kelas").
- [ ] Baris "Diverifikasi Oleh" — nama guru piket yang verifikasi.
- [ ] Badge status (mis. "Sedang di Luar Sekolah").
- [ ] QR code tampil di bagian bawah + teks "Pindai untuk verifikasi
      online". **Kalau QR TIDAK tampil**, itu bukan berarti fitur gagal
      total (surat tetap valid tanpa QR by design) — tapi berarti langkah
      "otorisasi scope UrlFetchApp" di `DEPLOYMENT_CHECKLIST.md` langkah 2
      kemungkinan belum beres. Cek `Audit_Log` untuk baris
      `generateIzinKeluarSurat Gagal` — kalau tidak ada baris gagal sama
      sekali tapi QR tetap kosong, errornya senyap di dalam
      `generateQRCodeImage` sendiri (fetch gagal, bukan exception) —
      laporkan ke pengembang untuk diselidiki lebih lanjut kalau ini
      terjadi.
- [ ] Footer menyebut nomor surat sebagai referensi.

## 4. Download HTML

- [ ] Klik "📥 Download HTML" → file `Surat_Izin_IK-<tanggal>-<urutan>.html`
      terunduh.
- [ ] Buka file yang terunduh langsung di browser (double-click / drag ke
      tab baru) — suratnya tampil rapi, SAMA seperti preview, termasuk QR
      (QR harus tetap tampil walau offline/tanpa koneksi ke SIGAP, karena
      QR disematkan sebagai gambar langsung di file-nya, bukan link ke
      luar — kalau QR di file yang diunduh HILANG padahal tadi ada di
      preview, itu bug, laporkan).

## 5. Print

- [ ] Klik "🖨️ Print" → dialog print browser (bukan dialog SIGAP sendiri)
      terbuka, menampilkan preview surat yang sama.
- [ ] Coba "Save as PDF" dari dialog print itu → hasil PDF-nya terbaca
      rapi.
- [ ] **Cek popup blocker**: kalau browser/ekstensi punya popup blocker
      agresif, coba juga di browser lain / dengan popup blocker
      dimatikan — tombol Print memakai `window.open()`, dan kalau
      di-block, TIDAK ADA pesan error yang muncul (silent no-op, lihat
      catatan Bagian 9). Kalau ini terjadi ke guru di lapangan, mereka
      akan mengira tombolnya tidak berfungsi.

## 6. QR / verifikasi online

- [ ] Scan QR code di surat (pakai HP, kamera bawaan atau app QR apa
      pun) → terbuka URL yang dimulai dengan `API_URL` proyek ini
      (`.../exec?token=...&action=verifyIzinSurat&id=...&nomor=...`).
- [ ] Buka URL itu **di browser yang TIDAK login SIGAP sama sekali**
      (mode incognito) — harus tetap bisa diakses (tidak diminta login)
      dan menampilkan JSON `{"status":"success","valid":true, "nama":
      ..., "kelas": ..., ...}` yang cocok dengan data siswa uji coba.
- [ ] Ubah parameter `nomor` di URL jadi angka lain yang salah → respons
      berubah jadi `"valid":false`.

## 7. Database (`Izin_Keluar`)

- [ ] Buka Google Sheet, cari baris transaksi uji coba (cocokkan lewat
      NISN/nama/waktu).
- [ ] Kolom `Nomor_Surat` (V) terisi, sama dengan yang tampil di surat.
- [ ] Kolom `Status_Print` (X) = `Sudah`.
- [ ] Kolom `Waktu_Print` (W) terisi dengan timestamp yang masuk akal
      (barusan).

## 8. Audit Log

- [ ] Buka sheet `Audit_Log`, cari baris `Aksi = generateIzinKeluarSurat`
      untuk transaksi uji coba ini.
- [ ] Kolom `Detail` memuat `nomor=IK-...` yang sama dengan surat.

### 8a. Idempotency — generate 2x, nomor harus SAMA

- [ ] Dari kartu yang sama, klik lagi "📄 Cetak Surat Izin" (transaksi
      yang sama, belum berubah status).
- [ ] Nomor surat di preview kedua ini **PERSIS SAMA** dengan yang
      pertama (bukan `-002`).
- [ ] Cek Google Sheet lagi — **tidak ada baris baru** di `Izin_Keluar`
      untuk transaksi ini (masih satu baris yang sama), dan `Waktu_Print`
      **ikut ter-update** ke waktu yang baru (mencerminkan cetak
      terakhir, ini memang perilaku yang diharapkan, bukan bug).
- [ ] Ada baris `generateIzinKeluarSurat` KEDUA di `Audit_Log` (audit
      mencatat SETIAP kali cetak, bukan cuma yang pertama) — cek nomornya
      juga sama dengan yang pertama.

### 8b. Error cases

- [ ] Coba cetak surat dari transaksi berstatus **"Menunggu Verifikasi"**
      (belum diverifikasi) — lewat cara apa pun yang tersedia (tidak ada
      tombolnya di UI untuk status ini, jadi ini murni untuk memastikan
      backend menolak kalau suatu saat ada jalan lain memanggilnya) →
      harus dapat pesan error yang jelas, BUKAN surat kosong/rusak.
- [ ] Cek `Audit_Log` untuk baris `generateIzinKeluarSurat Gagal` kalau
      ada percobaan yang ditolak — pesan error di kolom `Detail` harus
      masuk akal (bukan `undefined` atau stack trace mentah).

---

## 9. Kasus tambahan dari code review (opsional, tapi disarankan)

Bagian ini BUKAN dari brief awal — ini temuan dari review kode sebelum
deploy (lihat laporan review). Sengaja dipisah supaya jelas mana yang
"harus" (Bagian 1-8) vs "baik untuk diketahui sebelum umumkan fitur ini
ke semua guru" (di bawah ini).

- [ ] **Cetak untuk transaksi yang SUDAH SELESAI dari hari SEBELUMNYA**:
      coba cari transaksi izin yang statusnya sudah "Selesai"/"Pulang"
      dari kemarin atau lebih lama (lewat Riwayat, bukan Gerbang) — akan
      terlihat bahwa tombol "Cetak Surat Izin" **TIDAK ADA** di mana pun
      untuk transaksi itu, karena layar Gerbang → Izin Keluar hanya
      menampilkan transaksi selesai dari **hari ini saja** di bucket
      "Selesai Hari Ini". Backend-nya sendiri SANGGUP mencetak transaksi
      lama (tidak ada pembatasan tanggal di sana), tapi UI saat ini tidak
      punya jalan untuk memanggilnya. Kalau kebutuhan aslinya memang
      "boleh cetak transaksi kapan saja, termasuk yang sudah lewat
      beberapa hari", ini gap yang perlu keputusan: apakah cukup diterima
      apa adanya (guru mencetak di hari yang sama transaksinya terjadi),
      atau perlu ditambahkan jalan cetak dari Riwayat juga.
- [ ] **Guru yang bukan pihak terkait transaksi**: login sebagai guru
      biasa (bukan piket, bukan wali kelas siswa terkait, bukan yang
      approve) dan coba akses transaksi izin siswa DI LUAR kelasnya —
      normalnya guru ini tidak akan melihat kartu transaksi itu sama
      sekali di layarnya (dibatasi cakupan baca). Item ini murni untuk
      kesadaran, bukan sesuatu yang bisa diuji lewat UI biasa: action
      `generateIzinKeluarSurat` di backend TIDAK mengecek ulang cakupan
      baca per-transaksi seperti yang dilakukan daftar `getIzinKeluar` —
      siapa pun yang login (non-OSIS) dan tahu ID transaksi tertentu
      (mis. dari riwayat URL) bisa mencetak surat itu walau transaksinya
      di luar kelas/harinya. Lihat laporan code review untuk detail.
- [ ] **Waktu respons saat generate surat lambat**: kalau suatu saat
      terasa tombol "Cetak Surat Izin" butuh waktu lebih lama dari biasa
      (beberapa detik), dan BERSAMAAN dengan itu guru piket LAIN di
      gerbang mengeluhkan "Server sedang sibuk" saat mencatat
      keterlambatan/izin lain — itu kemungkinan besar terkait: proses
      cetak memanggil layanan QR di luar SIGAP SAMBIL memegang kunci
      tulis yang sama dipakai semua aksi lain. Ini bukan sesuatu yang
      perlu diuji aktif sekarang (perlu kondisi jaringan lambat untuk
      terjadi), tapi baik diingat kalau muncul keluhan seperti itu nanti.
