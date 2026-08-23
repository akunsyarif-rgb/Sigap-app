// ===== tests/deploy-workflow.test.js =====
// Audit STATIS atas .github/workflows/deploy-gas.yml dan skrip pendukungnya.
//
// Test-test di sini tidak menjalankan clasp dan tidak menyentuh jaringan.
// Yang dijaga adalah sifat-sifat yang kalau rusak baru ketahuan saat deploy
// production — persis situasi yang mahal:
//
//   - `clasp deploy` tanpa -i membuat deployment BARU dengan URL Web App baru,
//     dan TIDAK error. Guru tetap memakai URL lama yang menjalankan kode lama.
//     Tidak ada yang gagal, jadi tidak ada yang tahu.
//   - Secret yang di-interpolasi ke teks perintah shell bisa merusak quoting
//     dan menaruh potongan kredensial ke log Actions.
//   - Langkah yang menulis (push/deploy) harus selalu berada SESUDAH semua
//     gerbang validasi; kalau urutannya tergeser, project live berubah
//     sebelum sempat divalidasi.
// Jalankan: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/deploy-gas.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8');

// Baris perintah saja (buang komentar), supaya penjelasan di komentar tidak
// ikut tertangkap pemeriksaan pola berbahaya.
const barisPerintah = WORKFLOW.split('\n').filter((b) => !/^\s*#/.test(b));
const PERINTAH = barisPerintah.join('\n');

test('workflow memakai ketiga secret yang diwajibkan', () => {
  for (const secret of ['CLASP_CREDENTIALS', 'CLASP_SCRIPT_ID', 'CLASP_DEPLOYMENT_ID']) {
    assert.match(WORKFLOW, new RegExp('secrets\\.' + secret), secret + ' tidak dipakai');
  }
});

test('TIDAK ADA `clasp deploy` tanpa -i di seluruh repo', () => {
  // Ini jaring pengaman terpenting di berkas ini. `clasp deploy` polos =
  // deployment baru = URL baru, tanpa error apa pun.
  const berkas = [
    '.github/workflows/deploy-gas.yml',
    'package.json',
    '.github/scripts/clasp-deploy-existing.js',
    '.github/scripts/check-clasp-credentials.js',
    '.github/scripts/verify-clasp-target.js',
  ];
  for (const rel of berkas) {
    const isi = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const perintah = isi
      .split('\n')
      .filter((b) => !/^\s*(#|\/\/|\*)/.test(b))
      .join('\n');
    // Cari "clasp deploy" ATAU nama kanoniknya "clasp create-deployment"
    // yang TIDAK diikuti -i / --deploymentId di baris yang sama. Kelas
    // pemisah menampung bentuk shell (`clasp deploy`) maupun bentuk array
    // argumen di JS (`['clasp', 'deploy']`, `clasp(['deploy'])`).
    const cocok = perintah.match(
      /clasp["'\s,\]([]+(?:create-deployment|deploy)(?![-\w])(?![^\n]*(?:-i\b|--deploymentId))/g,
    );
    assert.equal(
      cocok,
      null,
      rel + ' memuat `clasp deploy` tanpa -i (akan membuat deployment BARU): ' + cocok,
    );
  }
});

test('langkah deploy memakai -i dengan nilai dari secret', () => {
  assert.match(PERINTAH, /clasp deploy -i "\$CLASP_DEPLOYMENT_ID"/);
  // Nilainya lewat env:, bukan ${{ secrets... }} di dalam teks perintah.
  assert.match(WORKFLOW, /CLASP_DEPLOYMENT_ID:\s*\$\{\{\s*secrets\.CLASP_DEPLOYMENT_ID\s*\}\}/);
});

test('langkah deploy menolak deployment ID kosong', () => {
  // Lapis terakhir kalau entah bagaimana lolos gerbang 1 dan 3: `clasp deploy
  // -i ""` tidak error di clasp v3, jadi shell yang harus menghentikannya.
  assert.match(PERINTAH, /test -n "\$CLASP_DEPLOYMENT_ID"/);
});

test('secret tidak pernah di-interpolasi ke dalam teks perintah shell', () => {
  // `echo '${{ secrets.X }}'` yang lama: rusak kalau nilainya memuat kutip
  // tunggal, dan menaruh nilainya ke teks perintah yang tercetak di log.
  const interpolasiSecret = PERINTAH.match(/\$\{\{\s*secrets\.[A-Z_]+\s*\}\}/g) || [];
  const diLuarBlokEnv = interpolasiSecret.filter((cocok) => {
    const idx = PERINTAH.indexOf(cocok);
    const baris = PERINTAH.slice(0, idx).split('\n').pop() + cocok;
    // Bentuk `NAMA: ${{ secrets.NAMA }}` di blok env: memang cara yang benar.
    return !/^\s*[A-Z_]+:\s*\$\{\{\s*secrets\.[A-Z_]+\s*\}\}$/.test(baris);
  });
  assert.deepEqual(diLuarBlokEnv, [], 'secret di-interpolasi ke perintah: ' + diLuarBlokEnv);
});

test('tidak ada perintah yang mencetak kredensial ke log', () => {
  for (const pola of [/cat\s+[^\n]*clasprc/i, /echo\s+[^\n]*CLASP_CREDENTIALS/i]) {
    assert.doesNotMatch(PERINTAH, pola, 'ada perintah yang bisa membocorkan kredensial');
  }
  // Daftar deployment memuat ID deployment lain — ditulis ke berkas, tidak
  // pernah di-cat ke log.
  assert.doesNotMatch(PERINTAH, /cat\s+[^\n]*deployments\.json/);
});

test('~/.clasprc.json ditulis dengan printf %s dari variabel env', () => {
  assert.match(PERINTAH, /printf '%s' "\$CLASP_CREDENTIALS" > "\$HOME\/\.clasprc\.json"/);
  assert.doesNotMatch(PERINTAH, /echo\s+'?\$\{\{\s*secrets\.CLASP_CREDENTIALS/);
});

test('semua langkah yang MENULIS berada sesudah semua gerbang validasi', () => {
  const urutan = [
    'node .github/scripts/check-clasp-credentials.js', // gerbang 1 (offline)
    'clasp deployments --json', // gerbang 2 (baca-saja)
    'node .github/scripts/verify-clasp-target.js',
    'clasp pull', // gerbang 3 (baca-saja)
    'clasp push --force', // MENULIS mulai di sini
    'clasp deploy -i',
  ];
  let posisi = -1;
  for (const potongan of urutan) {
    const idx = PERINTAH.indexOf(potongan);
    assert.notEqual(idx, -1, 'tidak ditemukan di workflow: ' + potongan);
    assert.ok(idx > posisi, 'urutan langkah salah, ' + potongan + ' terlalu awal');
    posisi = idx;
  }
});

test('workflow hanya dipicu manual, tidak otomatis saat push ke main', () => {
  // Deploy ke sekolah harus selalu tindakan sadar, bukan efek samping merge.
  assert.match(WORKFLOW, /^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(WORKFLOW, /^\s*push:/m);
});

test('npm run clasp:deploy tidak bisa membuat deployment baru', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['clasp:deploy'], 'node .github/scripts/clasp-deploy-existing.js');
});
