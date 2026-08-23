// ===== tests/clasp-target.test.js =====
// Menguji .github/scripts/verify-clasp-target.js — gerbang yang memastikan
// deploy menembak project DAN deployment yang benar.
//
// Dua kegagalan yang dicegah di sini sama-sama tidak menimbulkan error yang
// jelas kalau lolos:
//   - deployment ID milik project lain / sudah dihapus: `clasp push` sudah
//     terlanjur mengubah project live, baru `clasp deploy -i` gagal. Guru
//     menjalankan versi yang tidak pernah dites.
//   - scriptId di .clasp.json berbeda dari CLASP_SCRIPT_ID: push mendarat di
//     project Apps Script yang salah.
// Semua nilai di bawah palsu. Jalankan: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyClaspTarget } = require('../.github/scripts/verify-clasp-target.js');

const SCRIPT_ID = 'ContohScriptId1234567890';
const DEPLOY_ID = 'AKfycbContohDeploymentId1234567890';

const ENV_OK = { CLASP_SCRIPT_ID: SCRIPT_ID, CLASP_DEPLOYMENT_ID: DEPLOY_ID };
const CLASP_JSON = JSON.stringify({ scriptId: SCRIPT_ID, rootDir: '.' });
const DEPLOYMENTS = JSON.stringify([
  { deploymentId: 'AKfycbDeploymentLain111', versionNumber: 3, description: 'lama' },
  { deploymentId: DEPLOY_ID, versionNumber: 7, description: 'produksi' },
]);

const jalan = (over = {}) =>
  verifyClaspTarget({
    env: ENV_OK,
    claspJsonRaw: CLASP_JSON,
    deploymentsRaw: DEPLOYMENTS,
    ...over,
  });
const gabung = (h) => h.problems.join('\n');

test('target valid: deployment ada di project yang sama', () => {
  const hasil = jalan();
  assert.deepEqual(hasil.problems, []);
  assert.match(hasil.info.join('\n'), /akan DIPERBARUI, bukan dibuat baru/);
});

test('deployment ID tidak ada di project ini → dihentikan', () => {
  const hasil = jalan({ env: { ...ENV_OK, CLASP_DEPLOYMENT_ID: 'AKfycbTidakAda999' } });
  assert.equal(hasil.problems.length, 1);
  assert.match(gabung(hasil), /TIDAK ADA di daftar deployment/);
});

test('project tanpa deployment sama sekali → dihentikan, bukan bikin baru', () => {
  const hasil = jalan({ deploymentsRaw: '[]' });
  assert.match(gabung(hasil), /TIDAK ADA di daftar deployment/);
});

test('scriptId .clasp.json beda dari CLASP_SCRIPT_ID → dihentikan', () => {
  const hasil = jalan({
    claspJsonRaw: JSON.stringify({ scriptId: 'ScriptIdProjectLain', rootDir: '.' }),
  });
  assert.match(gabung(hasil), /TIDAK SAMA dengan secret CLASP_SCRIPT_ID/);
});

test('.clasp.json hilang / kosong / rusak → dihentikan', () => {
  assert.match(gabung(jalan({ claspJsonRaw: null })), /tidak ada atau kosong/);
  assert.match(gabung(jalan({ claspJsonRaw: '   ' })), /tidak ada atau kosong/);
  assert.match(gabung(jalan({ claspJsonRaw: '{"scriptId":' })), /bukan JSON yang valid/);
  assert.match(gabung(jalan({ claspJsonRaw: '[]' })), /harus berupa objek JSON/);
  assert.match(gabung(jalan({ claspJsonRaw: '{"rootDir":"."}' })), /tidak punya scriptId/);
});

test('daftar deployment hilang / rusak → dihentikan, tidak dianggap lolos', () => {
  assert.match(gabung(jalan({ deploymentsRaw: null })), /kosong\/tidak terbaca/);
  assert.match(gabung(jalan({ deploymentsRaw: 'bukan json' })), /bukan JSON yang valid/);
  assert.match(gabung(jalan({ deploymentsRaw: '{}' })), /bukan array/);
});

test('spasi/newline di sekitar ID tidak bikin gagal palsu', () => {
  const hasil = jalan({
    env: { CLASP_SCRIPT_ID: '  ' + SCRIPT_ID + '\n', CLASP_DEPLOYMENT_ID: DEPLOY_ID + '\n' },
  });
  assert.deepEqual(hasil.problems, []);
});

test('verifier tidak pernah mencetak scriptId/deploymentId', () => {
  // Log Actions bisa dibaca siapa pun yang punya akses repo, dan daftar
  // deployment memuat ID deployment lain juga.
  const hasil = verifyClaspTarget({
    env: { CLASP_SCRIPT_ID: SCRIPT_ID, CLASP_DEPLOYMENT_ID: 'AKfycbTidakAda999' },
    claspJsonRaw: JSON.stringify({ scriptId: 'ScriptIdProjectLain' }),
    deploymentsRaw: DEPLOYMENTS,
  });
  const semua = [...hasil.problems, ...hasil.info].join('\n');
  for (const rahasia of [SCRIPT_ID, DEPLOY_ID, 'ScriptIdProjectLain', 'AKfycbDeploymentLain111', 'AKfycbTidakAda999']) {
    assert.ok(!semua.includes(rahasia), 'nilai bocor ke pesan: ' + rahasia);
  }
});
