// ===== tests/check-backend-drift.test.js =====
// Menguji fungsi murni .github/scripts/check-backend-drift.js yang dipakai
// workflow check-backend-drift.yml -- workflow itu sendiri TIDAK diuji di
// sini (butuh jaringan sungguhan ke Apps Script), tapi logika pembandingnya
// (yang justru menentukan apakah job merah/hijau) sepenuhnya bisa diuji
// dengan string fixture, tanpa jaringan ataupun filesystem.
// Jalankan: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractBackendVersion, extractApiConfig, evaluateDrift } = require('../.github/scripts/check-backend-drift.js');

test('extractBackendVersion: mengambil nilai persis dari deklarasi var BACKEND_VERSION', () => {
  const source = "var BACKEND_VERSION = '2026-09-01-ganti-password-sendiri';\nvar BACKEND_FEATURES = [];";
  assert.equal(extractBackendVersion(source), '2026-09-01-ganti-password-sendiri');
});

test('extractBackendVersion: null kalau format deklarasi berubah/tidak ada', () => {
  assert.equal(extractBackendVersion('const BACKEND_VERSION = "x";'), null); // beda keyword (const, bukan var)
  assert.equal(extractBackendVersion(''), null);
  assert.equal(extractBackendVersion(undefined), null);
});

test('extractApiConfig: mengambil API_URL dan API_TOKEN dari config.js', () => {
  const source = 'const API_URL = "https://script.google.com/macros/s/ABC/exec";\nconst API_TOKEN = "rahasia123";';
  const result = extractApiConfig(source);
  assert.equal(result.apiUrl, 'https://script.google.com/macros/s/ABC/exec');
  assert.equal(result.apiToken, 'rahasia123');
});

test('extractApiConfig: null kalau salah satu tidak ditemukan', () => {
  const result = extractApiConfig('const API_URL = "https://x";');
  assert.equal(result.apiUrl, 'https://x');
  assert.equal(result.apiToken, null);
});

test('evaluateDrift: sinkron kalau versi live sama persis dengan Code.gs di main', () => {
  const res = evaluateDrift('2026-09-01-ganti-password-sendiri', JSON.stringify({ status: 'active', version: '2026-09-01-ganti-password-sendiri' }));
  assert.equal(res.status, 'sync');
});

test('evaluateDrift: drift kalau versi live berbeda dari Code.gs di main', () => {
  const res = evaluateDrift('2026-09-01-ganti-password-sendiri', JSON.stringify({ status: 'active', version: '2026-08-31-hapus-data-periode' }));
  assert.equal(res.status, 'drift');
  assert.match(res.message, /2026-08-31-hapus-data-periode/);
  assert.match(res.message, /2026-09-01-ganti-password-sendiri/);
});

test('evaluateDrift: unreachable kalau respons bukan JSON (Apps Script tidak terjangkau/token salah)', () => {
  const res = evaluateDrift('v1', 'tidak dapat dihubungi');
  assert.equal(res.status, 'unreachable');
});

test('evaluateDrift: unreachable kalau JSON valid tapi tidak ada field version', () => {
  const res = evaluateDrift('v1', JSON.stringify({ status: 'error', message: 'Unauthorized' }));
  assert.equal(res.status, 'unreachable');
});

test('evaluateDrift: error kalau BACKEND_VERSION di Code.gs sendiri tidak ditemukan', () => {
  const res = evaluateDrift(null, JSON.stringify({ status: 'active', version: 'v1' }));
  assert.equal(res.status, 'error');
});

test('evaluateDrift: kosong/tidak lengkap dari sisi live tetap ditangani tanpa melempar exception', () => {
  assert.doesNotThrow(() => evaluateDrift('v1', ''));
  assert.doesNotThrow(() => evaluateDrift('v1', '{}'));
  assert.doesNotThrow(() => evaluateDrift('v1', 'null'));
});
