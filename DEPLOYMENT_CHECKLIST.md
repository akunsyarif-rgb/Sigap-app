# Deployment Checklist — Cetak Surat Izin Keluar

Checklist ini untuk **satu kali** deploy manual backend (`Code.gs` + `Utils.gs`)
yang membawa fitur Cetak Surat Izin Keluar + penghapusan label BETA. Ikuti
proses clasp yang sudah didokumentasikan di `CLAUDE.md` — file ini hanya
mempersempitnya jadi langkah-langkah konkret untuk perubahan spesifik ini,
bukan proses baru.

**Frontend (`gerbang.js`, `app.js`, `index.html`) TIDAK butuh langkah apa
pun di sini** — begitu branch ini di-merge ke `main`, Vercel auto-redeploy.
Checklist ini murni untuk backend Apps Script, yang **tidak pernah**
auto-deploy di repo ini.

---

## 0. Prasyarat (sekali saja, kalau belum pernah)

- [ ] `npm install` sudah pernah dijalankan di checkout ini (clasp ada di
      `node_modules/.bin`).
- [ ] Sudah pernah `npm run clasp:login` (atau `-- --no-localhost` kalau
      lewat Codespace) — cek dengan `npx clasp login --status`.
- [ ] `.clasp.json` ada di root repo (disalin dari `.clasp.json.example`)
      dan `scriptId`-nya benar (Apps Script → Project Settings → Script ID).
      **File ini gitignored — kalau hilang, isi ulang, jangan commit.**
- [ ] Tahu `CLASP_DEPLOYMENT_ID` yang sedang dipakai live (`npx clasp
      deployments`, cocokkan `API_URL` di `config.js` — id-nya bagian
      setelah `/macros/s/` dan sebelum `/exec`).

## 1. Sebelum push — baca ulang apa yang berubah

- [ ] File yang berubah untuk fitur ini: **`Code.gs`** dan **`Utils.gs`**
      saja (`Auth.gs`/`Notifikasi.gs` tidak disentuh, tapi keduanya tetap
      ikut ter-push karena `.claspignore` mengizinkan keduanya — itu wajar,
      bukan tanda ada yang salah).
- [ ] `BACKEND_VERSION` di `Code.gs` sudah dinaikkan ke
      `'2026-09-03-cetak-surat-izin'` dan `BACKEND_FEATURES` memuat
      `'cetakSuratIzin'` — ini yang dipakai langkah verifikasi di bawah.
- [ ] `npm test` hijau semua di checkout ini (`627 pass, 0 fail` saat
      commit ini dibuat) — kalau merah, JANGAN push, ada regresi yang
      belum ketahuan.

## 2. Push (belum membuat deployment baru — aman untuk dicoba)

```bash
npm run clasp:push
```

- [ ] Perintah selesai tanpa error. (Catatan lama tentang izin `UrlFetchApp`
      untuk QR sudah tidak berlaku — fitur QR/verifikasi surat DIHAPUS
      total, lihat `CLAUDE.md` bagian "Cetak Surat Izin Keluar". Backend
      fitur cetak surat sekarang tidak pernah menghubungi jaringan luar
      sama sekali, jadi tidak ada lagi prompt otorisasi khusus yang perlu
      diantisipasi untuk fitur ini.)
- [ ] Buka [Apps Script editor](https://script.google.com) untuk proyek
      ini, buka `Code.gs`, pastikan isinya sudah cocok dengan versi lokal
      (scroll ke `generateNomorSurat`, `renderIzinKeluarSuratHTML`, dst. —
      kalau ada, artinya push berhasil masuk).

## 3. Deploy (INI yang membuat kode live untuk semua guru)

```bash
CLASP_DEPLOYMENT_ID=<id-yang-sudah-dicatat-di-langkah-0> npm run clasp:deploy
```

- [ ] Perintah ini menjalankan `clasp push --force` lagi lalu
      `clasp deploy -i <id> -d "..."` — **BUKAN** `clasp deploy` polos
      (itu akan membuat deployment baru dengan URL berbeda dan
      `config.js` tidak akan tahu apa-apa soal itu — kalau perintah yang
      dijalankan bukan persis seperti di atas, berhenti dan cek ulang).
- [ ] Keluaran menunjukkan versi deployment baru untuk id yang sama
      (bukan id baru).

## 4. Verifikasi deployment benar-benar live

- [ ] Buka di browser (ganti `<API_URL>` dan `<API_TOKEN>` dengan nilai
      dari `config.js`):
      `<API_URL>?token=<API_TOKEN>`
- [ ] Field `version` di respons JSON = `2026-09-03-cetak-surat-izin`.
      Kalau masih versi lama (`2026-09-02-push-notifications` atau
      sebelumnya), deployment BELUM benar-benar mengganti versi yang
      dilayani — deploy ulang, jangan lanjut ke testing.
- [ ] Field `features` memuat `"cetakSuratIzin"`.

## 5. Cek Google Sheet (Izin_Keluar)

Ini bagian yang **tidak otomatis** — `getOrCreateSheet()` di `Utils.gs`
cuma menulis header kalau sheet-nya **belum ada sama sekali**. Sheet
`Izin_Keluar` sudah lama ada di Spreadsheet sekolah, jadi baris header (1)
**tidak akan otomatis** dapat 3 label kolom baru walau kode backend-nya
sudah live. Kolom baru akan tetap *berfungsi* (kode membaca/menulis by
index, bukan by nama header — sama seperti semua sheet lain di SIGAP),
tapi kepala kolomnya kosong sampai ditambah manual, dan itu membingungkan
kalau dibiarkan.

- [ ] Buka Google Sheet database SIGAP → sheet `Izin_Keluar`.
- [ ] Cek kolom **V1** (kolom ke-22) — kalau kosong, isi manual:
      `Nomor_Surat`
- [ ] Cek kolom **W1** (kolom ke-23) — kalau kosong, isi manual:
      `Waktu_Print`
- [ ] Cek kolom **X1** (kolom ke-24) — kalau kosong, isi manual:
      `Status_Print`
- [ ] Pastikan sheet-nya punya **setidaknya 24 kolom grid** (bukan cuma
      21 kolom terisi) — kalau grid-nya benar-benar dibatasi ke 21 kolom
      (jarang, tapi bisa terjadi kalau kolom kosong pernah dihapus manual),
      kode akan gagal menulis dengan error range-out-of-bounds saat surat
      pertama dicetak. Cara cek cepat: klik kolom paling kanan yang ada di
      sheet — kalau sudah lewat kolom X, aman. Kalau ragu, klik kanan
      header kolom terakhir → "Insert 3 columns right" untuk jaga-jaga.
- [ ] Jangan isi baris data manapun di kolom V/W/X — biarkan kosong,
      kolom itu terisi otomatis begitu surat pertama untuk baris itu
      dicetak (lihat `TESTING_CHECKLIST_AFTER_DEPLOY.md`).

## 6. Kalau ada yang salah

- [ ] Deployment SEBELUMNYA masih bisa dipulihkan: `npx clasp deployments`
      untuk lihat riwayat versi pada `CLASP_DEPLOYMENT_ID` yang sama, lalu
      `npx clasp deploy -i <id> -V <nomor-versi-lama>` untuk mengarahkan
      deployment yang sama ke versi kode SEBELUM perubahan ini (URL Web
      App tidak berubah, jadi guru tidak perlu tahu apa-apa).
- [ ] Kolom header V/W/X yang terlanjur salah ketik di Sheet aman diedit
      ulang kapan saja — labelnya murni kosmetik, tidak dibaca kode.
