// ===== .github/scripts/clasp-deploy-existing.js =====
// Dipakai `npm run clasp:deploy` (deploy manual dari komputer sendiri).
//
// Sebelumnya script itu berbunyi `clasp push && clasp deploy` — TANPA -i.
// Di clasp v3 pengecekannya `if (!deploymentId)`, jadi `clasp deploy` polos
// selalu membuat deployment BARU dengan URL Web App baru. URL lama tetap
// hidup menjalankan kode lama, dan config.js tidak tahu apa-apa soal URL
// baru itu — kegagalan yang tidak menimbulkan error sama sekali, cuma guru
// yang bingung kenapa perbaikannya tidak muncul.
//
// Pembungkus ini menolak jalan tanpa CLASP_DEPLOYMENT_ID, jadi tidak ada satu
// pun jalur di repo ini (CI maupun lokal) yang bisa membuat deployment baru.
// Ditulis dengan Node (bukan `test -n` di npm script) supaya sama saja
// perilakunya di macOS, Linux, dan Windows.
//
// Pakai:
//   CLASP_DEPLOYMENT_ID=<id-existing> npm run clasp:deploy
// Cari ID-nya dengan `npx clasp deployments`, cocokkan dengan API_URL di
// config.js.

'use strict';

const { spawnSync } = require('child_process');

const deploymentId = (process.env.CLASP_DEPLOYMENT_ID || '').trim();

if (!deploymentId) {
  console.error('CLASP_DEPLOYMENT_ID belum diisi — deploy dibatalkan.');
  console.error('');
  console.error('`clasp deploy` tanpa -i membuat deployment BARU dengan URL Web App');
  console.error('baru, bukan memperbarui yang dipakai guru. Jadi ID-nya wajib.');
  console.error('');
  console.error('  npx clasp deployments        # cocokkan dengan API_URL di config.js');
  console.error('  CLASP_DEPLOYMENT_ID=<id> npm run clasp:deploy');
  process.exit(1);
}

// shell:false — deploymentId dilewatkan sebagai argumen, tidak pernah
// ditafsirkan shell.
const jalankan = (args) => {
  const hasil = spawnSync('npx', ['clasp', ...args], { stdio: 'inherit', shell: false });
  if (hasil.error) {
    console.error('Gagal menjalankan clasp: ' + hasil.error.message);
    process.exit(1);
  }
  if (hasil.status !== 0) {
    process.exit(hasil.status === null ? 1 : hasil.status);
  }
};

jalankan(['push', '--force']);
jalankan(['deploy', '-i', deploymentId, '-d', 'Deploy manual dari ' + require('os').hostname()]);
