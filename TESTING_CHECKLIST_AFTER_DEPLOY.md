# Testing Checklist — Setelah Deploy Cetak Surat Izin Keluar

Jalankan checklist ini di aplikasi SIGAP yang sungguhan (browser, bukan
`npm test`) setelah `DEPLOYMENT_CHECKLIST.md` selesai.

Login sebagai **guru piket yang bertugas hari ini** (atau admin/BK) untuk
sebagian besar langkah — beberapa langkah eksplisit minta akun lain, sudah
ditandai.

Versi ini sudah tidak menyertakan QR/verifikasi online maupun tombol
"Download HTML" — keduanya dihapus (bukan disembunyikan) setelah uji coba
lapangan, lihat `CLAUDE.md` bagian "Cetak Surat Izin Keluar" untuk alasannya.

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

Bentuknya sekarang surat dinas resmi (kop surat, paragraf, bukan
kartu/kotak app), dengan Disetujui/Diverifikasi/Status dikelompokkan dalam
satu kotak info. Cek SEMUA berikut tampil dan **datanya benar** (cocok
dengan transaksi di langkah 1):

- [ ] Logo SMAN 2 Tarakan tampil di header (kalau tidak tampil/rusak,
      bukan blocker — ada fallback `onerror` yang menyembunyikannya, tapi
      tetap cek: kemungkinan `IMG_1966.jpeg` tidak accessible publik dari
      `raw.githubusercontent.com`).
- [ ] Nama sekolah + "Sistem Informasi Gerbang & Absensi Pelanggaran
      (SIGAP)" di bawah logo.
- [ ] Judul "SURAT IZIN KELUAR" + "Nomor: IK-YYYYMMDD-NNN" (tanggal hari
      ini, urutan dimulai dari 001 kalau ini surat pertama hari ini).
- [ ] Kalimat pembuka "Yang bertanda tangan di bawah ini menerangkan
      bahwa...".
- [ ] Nama, Kelas, Keperluan sesuai transaksi.
- [ ] "Rencana Kepulangan" — nilainya "Kembali ke sekolah" (kalau tujuan
      kembali) atau "Pulang (tidak kembali ke sekolah)" (kalau tujuan
      pulang).
- [ ] Kotak info: "Disetujui oleh" (nama guru + label "Wali Kelas"/"Guru
      Mapel" — cek label ini AKURAT: kalau guru yang approve memang wali
      kelas siswa itu, harus "Wali Kelas"), "Diverifikasi oleh" (nama guru
      piket), "Status Saat Ini" (mis. "Sedang di Luar Sekolah") — SEMUA
      muat rapi di kotaknya, tidak membungkus berlebihan ke banyak baris.
- [ ] Kalimat penutup "Demikian surat izin ini dibuat...".
- [ ] "Tarakan, [tanggal]" tanpa nama hari (beda dari baris "Dicetak:" di
      bawahnya yang memang menyertakan nama hari).
- [ ] Baris "Dihasilkan otomatis oleh SIGAP, sah tanpa tanda tangan
      basah." + "Dicetak: [tanggal], [jam]" — cuma 2 baris pendek, tidak
      ada lagi "Nomor referensi" terpisah (sudah duplikat dengan nomor di
      judul atas, sengaja dihapus).

## 4. Print / Simpan sebagai PDF

- [ ] Klik **"🖨️ Print / Simpan sebagai PDF"** (satu-satunya tombol aksi
      di preview, tidak ada lagi "Download HTML") → dialog print browser
      (bukan dialog SIGAP sendiri) terbuka, menampilkan preview surat yang
      sama.
- [ ] Pilih "Save as PDF" (atau "Microsoft Print to PDF") dari dialog
      print itu → hasil PDF-nya terbaca rapi, sesuai preview.
- [ ] **Cek popup blocker**: kalau browser/ekstensi punya popup blocker
      agresif, coba matikan lalu klik tombolnya lagi — kalau jendela print
      diblokir, sekarang HARUS muncul pesan "Jendela print diblokir
      browser..." (bukan lagi diam saja tanpa keterangan apa pun).

## 5. Database (`Izin_Keluar`)

- [ ] Buka Google Sheet, cari baris transaksi uji coba (cocokkan lewat
      NISN/nama/waktu).
- [ ] Kolom `Nomor_Surat` (V) terisi, sama dengan yang tampil di surat.
- [ ] Kolom `Status_Print` (X) = `Sudah`.
- [ ] Kolom `Waktu_Print` (W) terisi dengan timestamp yang masuk akal
      (barusan).

## 6. Audit Log

- [ ] Buka sheet `Audit_Log`, cari baris `Aksi = generateIzinKeluarSurat`
      untuk transaksi uji coba ini.
- [ ] Kolom `Detail` memuat `nomor=IK-...` yang sama dengan surat.

### 6a. Idempotency — generate 2x, nomor harus SAMA

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

### 6b. Error cases

- [ ] Coba cetak surat dari transaksi berstatus **"Menunggu Verifikasi"**
      (belum diverifikasi) — lewat cara apa pun yang tersedia (tidak ada
      tombolnya di UI untuk status ini, jadi ini murni untuk memastikan
      backend menolak kalau suatu saat ada jalan lain memanggilnya) →
      harus dapat pesan error yang jelas, BUKAN surat kosong/rusak.
- [ ] Cek `Audit_Log` untuk baris `generateIzinKeluarSurat Gagal` kalau
      ada percobaan yang ditolak — pesan error di kolom `Detail` harus
      masuk akal (bukan `undefined` atau stack trace mentah).
- [ ] (Opsional) Login sebagai guru biasa yang BUKAN wali kelas siswa
      terkait, bukan piket, dan bukan yang approve transaksi ini — coba
      cetak transaksi izin siswa DI LUAR kelasnya yang sudah selesai dari
      hari sebelumnya (kalau ada) → harus ditolak dengan pesan "Tidak
      punya akses...". Ini menguji perbaikan cakupan baca dari code
      review — sudah ada test otomatisnya juga (`tests/izin-keluar-surat.test.js`,
      bagian "FIX 2"), jadi langkah manual ini opsional/tambahan saja.

---

## 7. Belum diputuskan (bukan bug, keputusan produk tertunda)

- [ ] **Cetak untuk transaksi yang SUDAH SELESAI dari hari SEBELUMNYA**:
      layar Gerbang → Izin Keluar hanya menampilkan transaksi selesai dari
      **hari ini saja** di bucket "Selesai Hari Ini", jadi tombol cetak
      tidak reachable untuk transaksi yang sudah lewat beberapa hari
      (backend-nya sendiri sanggup, UI-nya belum punya jalan). Masih
      menunggu keputusan: cukup diterima apa adanya, atau perlu ditambah
      jalan cetak dari Riwayat juga.
