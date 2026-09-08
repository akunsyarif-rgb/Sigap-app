# Status Deploy Backend — Tertunda

_Catatan referensi, dibuat 8 September 2026. Update atau hapus file ini setelah deploy benar-benar selesai._

## Versi

- **Live sekarang (Apps Script Web App):** `2026-09-04-logo-surat-base64`
- **Menunggu deploy (BACKEND_VERSION di Code.gs, branch `main`):** `2026-09-07-hapus-izin-keluar`
  - Mencakup commit: `175c8a9`, `b2a6704`, `874dbbd`, dan `a00e8fb` (yang terakhir tidak mengubah BACKEND_VERSION, tapi tetap menyentuh `Code.gs` — lihat catatan CLAUDE.md soal drift version).
  - Dikonfirmasi via `check-backend-drift.yml` (read-only) pada 8 September 2026, run [#16](https://github.com/akunsyarif-rgb/Sigap-app/actions/runs/34222286189): backend live masih `2026-09-04-logo-surat-base64`.

## Alasan tertunda

1. Kuota GitHub Codespace habis — jalur manual (`clasp login` interaktif → `clasp:push` → `clasp:deploy`) tidak bisa dilakukan saat ini.
2. Jalur CI (`deploy-gas.yml`, workflow_dispatch) juga gagal — bukan soal secret yang belum diisi (`CLASP_CREDENTIALS`/`CLASP_SCRIPT_ID`/`CLASP_DEPLOYMENT_ID` semuanya lolos validasi bentuk), tapi kredensial OAuth di dalam `CLASP_CREDENTIALS` sudah tidak valid: langkah "Verifikasi target deploy" gagal dengan error `Insufficient Permission` saat memanggil `clasp deployments --json`. Ini konsisten di **semua 10 run sebelumnya** sejak 12 Agustus 2026 — bukan masalah baru.
3. PR #63 (rotasi `API_TOKEN` menyusul rotasi Script Properties) sudah merge ke main lebih dulu — deploy backend jadi lebih mendesak untuk memastikan `API_TOKEN` di Script Properties benar-benar sinkron dengan yang dipakai frontend live.

## Langkah untuk melanjutkan nanti

1. **Refresh kredensial clasp** — jalankan `clasp login --no-localhost` di GitHub Codespace (atau environment lain dengan browser interaktif), ikuti prosedur di `CLAUDE.md` bagian "Using GitHub Codespaces for manual clasp access".
2. Salin isi `~/.clasprc.json` yang baru ke GitHub repo secret `CLASP_CREDENTIALS` (Settings → Secrets and variables → Actions).
3. Dari Codespace yang sama, `cp .clasp.json.example .clasp.json` lalu isi `scriptId` sebenarnya.
4. Jalankan `npm run clasp:push`, lalu `CLASP_DEPLOYMENT_ID=<id> npm run clasp:deploy` (id dari `clasp deployments`, cocokkan dengan `API_URL` di `config.js`) — **atau** setelah secret `CLASP_CREDENTIALS` di GitHub sudah di-refresh, trigger `deploy-gas.yml` manual dari tab Actions (workflow_dispatch).
5. Pastikan juga Script Properties `API_TOKEN` di Apps Script sudah cocok dengan `API_TOKEN` terbaru di `config.js` (menyusul rotasi PR #63) — deploy kode saja tidak mengubah Script Properties.

## Cara verifikasi setelah deploy

1. Cek field `"version"` pada response `API_URL` (status ping, token dari Script Properties/`config.js`) — harus menunjukkan `2026-09-07-hapus-izin-keluar` (atau versi lebih baru bila ada commit tambahan).
2. Bisa juga trigger ulang `check-backend-drift.yml` (workflow_dispatch) — read-only, akan hijau begitu versi live cocok dengan `main`.
3. Tes manual di aplikasi live:
   - Login (pastikan tidak ada masalah terkait rotasi `API_TOKEN`).
   - Fitur Izin Keluar: approve → verifikasi → tandai kembali/pulang.
   - Fitur hapus per-transaksi Izin Keluar (baru dari commit `874dbbd`) — coba hapus satu transaksi belum-final sebagai guru piket, dan satu transaksi final sebagai admin.
