// ===== tests/index-html-bundle-cache.test.js =====
// Audit performa startup (Sep 2026): index.html menggabungkan 13 file .js
// lalu memanggil Babel.transform() SEKALI atas gabungan itu (>500KB) SETIAP
// KALI halaman dibuka -- diukur dengan @babel/core di server pengembangan,
// itu sendirian makan ~250-440ms CPU murni, sebelum React sempat merender
// apa pun. Fix-nya: hasil transform di-cache di localStorage per
// BUILD_VERSION (lihat JS_BUNDLE_CACHE_KEY di index.html) supaya pembukaan
// BERIKUTNYA dengan versi yang sama melewati fetch 13 file + transform itu
// sepenuhnya.
//
// Loader-nya adalah IIFE async langsung di dalam <script> index.html (bukan
// fungsi bernama yang bisa diimpor), jadi diekstrak lewat regex dan
// dijalankan di vm dengan fetch/localStorage/document/Babel palsu -- sama
// semangatnya dengan sandbox render-smoke.test.js/login.test.js, cuma tanpa
// React sama sekali karena yang diuji di sini murni logika cache, bukan
// tampilan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const versionMatch = HTML.match(/var BUILD_VERSION = (\d+);/);
if (!versionMatch) throw new Error('BUILD_VERSION tidak ditemukan di index.html');
const BUILD_VERSION = Number(versionMatch[1]);

const CACHE_KEY_MATCH = HTML.match(/var JS_BUNDLE_CACHE_KEY = '([^']+)';/);

function extractLoaderScript() {
  // Ambil isi <script> yang memuat loadSigapApp (bukan tag <script> lain
  // seperti config Tailwind atau CDN).
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const loader = scripts.find((s) => s.includes('loadSigapApp'));
  if (!loader) throw new Error('Blok <script> loadSigapApp tidak ditemukan di index.html');
  return loader.trim();
}

function makeSandbox({ storage, fetchImpl, babelImpl } = {}) {
  const store = storage || {};
  const appended = [];
  const root = { innerHTML: '' };
  const sandbox = {
    console,
    window: {},
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        if (store.__throwOnSet) throw new Error('QuotaExceededError');
        store[k] = String(v);
      },
      removeItem: (k) => { delete store[k]; },
    },
    document: {
      getElementById: (id) => (id === 'root' ? root : null),
      createElement: (tag) => ({ tag, textContent: '' }),
      body: { appendChild: (el) => { appended.push(el); } },
    },
    fetch: fetchImpl || (() => Promise.reject(new Error('fetch dipanggil tanpa mock'))),
    Babel: babelImpl || { transform: () => { throw new Error('Babel dipanggil tanpa mock'); } },
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  return { sandbox, store, appended, root };
}

// Jalankan IIFE loader di dalam sandbox dan tunggu sampai selesai (loader
// tidak melempar return value-nya sendiri, jadi ditangkap lewat ekspresi).
async function runLoader(sandbox) {
  let src = extractLoaderScript();
  // "(async function loadSigapApp() {...})();" -> tangkap promise-nya supaya
  // bisa ditunggu di sini, tanpa mengubah isi fungsinya sama sekali.
  src = src.replace(/;\s*$/, '');
  vm.runInContext(`globalThis.__sigapPromise = ${src};`, sandbox);
  await sandbox.__sigapPromise;
}

function fakeFetch(fileTexts, callLog) {
  return (url) => {
    callLog.push(url);
    const file = String(url).split('?')[0];
    if (!(file in fileTexts)) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({ ok: true, text: () => Promise.resolve(fileTexts[file]) });
  };
}

function realFileTexts() {
  const files = [
    'config.js', 'helpers.js', 'export-format.js', 'ui-common.js', 'admin.js',
    'beranda-riwayat.js', 'statistik.js', 'gerbang.js',
    'pelanggaran-bimbingan-upacara.js', 'rekap-kelas.js', 'export-data.js',
    'notifikasi.js', 'app.js',
  ];
  const out = {};
  files.forEach((f) => { out[f] = 'const ' + f.replace(/[^a-zA-Z0-9]/g, '_') + ' = 1;'; });
  return out;
}

test('index.html: JS_BUNDLE_CACHE_KEY dan penanganannya benar-benar ada', () => {
  assert.ok(CACHE_KEY_MATCH, 'JS_BUNDLE_CACHE_KEY tidak ditemukan di index.html');
  const src = extractLoaderScript();
  assert.match(src, /localStorage\.getItem\(JS_BUNDLE_CACHE_KEY\)/, 'harus membaca cache sebelum fetch/transform');
  assert.match(src, /cachedBundle\.version === BUILD_VERSION/, 'cache harus divalidasi terhadap BUILD_VERSION saat ini');
  assert.match(src, /localStorage\.setItem\(JS_BUNDLE_CACHE_KEY/, 'hasil transform baru harus disimpan untuk pembukaan berikutnya');
  assert.match(src, /catch\s*\(cacheReadErr\)/, 'pembacaan cache harus dibungkus try/catch (JSON rusak tidak boleh melempar)');
  assert.match(src, /catch\s*\(cacheWriteErr\)/, 'penulisan cache harus dibungkus try/catch (kuota penuh tidak boleh melempar)');
  // Self-healing: kegagalan apa pun (termasuk cache yang rusak saat DIEKSEKUSI)
  // harus membuang entri cache supaya refresh berikutnya mengambil ulang dari
  // awal, bukan mengulang kegagalan yang sama selamanya.
  assert.match(src, /catch\s*\(err\)\s*\{[\s\S]*localStorage\.removeItem\(JS_BUNDLE_CACHE_KEY\)/, 'blok catch utama harus membersihkan cache bundle yang mungkin rusak');
});

test('loader: tanpa cache -> fetch semua file + Babel.transform dipanggil, hasil disimpan ke cache', async () => {
  const fileTexts = realFileTexts();
  const fetchCalls = [];
  let transformCalls = 0;
  const { sandbox, store, appended } = makeSandbox({
    fetchImpl: fakeFetch(fileTexts, fetchCalls),
    babelImpl: { transform: (src) => { transformCalls++; return { code: '/*TRANSFORMED*/' + src }; } },
  });

  await runLoader(sandbox);

  assert.equal(fetchCalls.length, 13, 'tanpa cache, ke-13 file harus di-fetch');
  assert.equal(transformCalls, 1, 'Babel.transform harus dipanggil tepat sekali');
  assert.equal(appended.length, 1, 'satu <script> hasil transform harus ditambahkan ke body');
  assert.match(appended[0].textContent, /TRANSFORMED/);

  const cacheKey = CACHE_KEY_MATCH[1];
  const saved = JSON.parse(store[cacheKey]);
  assert.equal(saved.version, BUILD_VERSION);
  assert.match(saved.code, /TRANSFORMED/);
});

test('loader: cache versi cocok -> fetch & Babel.transform DILEWATI sepenuhnya', async () => {
  const cacheKey = CACHE_KEY_MATCH[1];
  const fetchCalls = [];
  let transformCalls = 0;
  const { sandbox, appended } = makeSandbox({
    storage: { [cacheKey]: JSON.stringify({ version: BUILD_VERSION, code: '/*FROM_CACHE*/const x=1;' }) },
    fetchImpl: fakeFetch(realFileTexts(), fetchCalls),
    babelImpl: { transform: () => { transformCalls++; return { code: 'HARUSNYA_TIDAK_DIPAKAI' }; } },
  });

  await runLoader(sandbox);

  assert.equal(fetchCalls.length, 0, 'cache hit tidak boleh melakukan satu pun fetch file .js');
  assert.equal(transformCalls, 0, 'cache hit tidak boleh memanggil Babel.transform sama sekali');
  assert.equal(appended.length, 1);
  assert.match(appended[0].textContent, /FROM_CACHE/, 'script yang dijalankan harus persis hasil cache, bukan hasil transform baru');
});

test('loader: cache versi LAMA (BUILD_VERSION naik) -> dianggap cache miss, fetch+transform ulang', async () => {
  const cacheKey = CACHE_KEY_MATCH[1];
  const fetchCalls = [];
  let transformCalls = 0;
  const { sandbox, store } = makeSandbox({
    storage: { [cacheKey]: JSON.stringify({ version: BUILD_VERSION - 1, code: '/*VERSI_LAMA*/' }) },
    fetchImpl: fakeFetch(realFileTexts(), fetchCalls),
    babelImpl: { transform: () => { transformCalls++; return { code: '/*VERSI_BARU*/' }; } },
  });

  await runLoader(sandbox);

  assert.equal(fetchCalls.length, 13, 'versi cache tidak cocok harus dianggap miss, bukan dipakai apa adanya');
  assert.equal(transformCalls, 1);
  const saved = JSON.parse(store[cacheKey]);
  assert.equal(saved.version, BUILD_VERSION, 'cache harus ditimpa dengan versi yang baru');
});

test('loader: entri cache rusak (bukan JSON valid) -> tidak melempar, jatuh ke fetch+transform biasa', async () => {
  const cacheKey = CACHE_KEY_MATCH[1];
  const fetchCalls = [];
  let transformCalls = 0;
  const { sandbox, appended } = makeSandbox({
    storage: { [cacheKey]: '{bukan json valid' },
    fetchImpl: fakeFetch(realFileTexts(), fetchCalls),
    babelImpl: { transform: () => { transformCalls++; return { code: '/*OK*/' }; } },
  });

  await runLoader(sandbox);

  assert.equal(fetchCalls.length, 13, 'JSON cache rusak harus diperlakukan sebagai cache miss, bukan error fatal');
  assert.equal(transformCalls, 1);
  assert.equal(appended.length, 1, 'app tetap harus berhasil dimuat walau cache rusak');
});

test('loader: localStorage.setItem gagal (kuota penuh) saat menyimpan cache -> app tetap jalan dari hasil transform yang baru dihitung', async () => {
  const fetchCalls = [];
  const { sandbox, appended, root } = makeSandbox({
    storage: { __throwOnSet: true },
    fetchImpl: fakeFetch(realFileTexts(), fetchCalls),
    babelImpl: { transform: () => ({ code: '/*TETAP_JALAN*/' }) },
  });

  await runLoader(sandbox);

  assert.equal(root.innerHTML, '', 'kegagalan menyimpan cache TIDAK boleh menampilkan layar error ke pengguna');
  assert.equal(appended.length, 1);
  assert.match(appended[0].textContent, /TETAP_JALAN/);
});

test('loader: fetch salah satu file gagal -> tampilkan pesan error DAN buang cache lama supaya refresh berikutnya mengambil ulang', async () => {
  const cacheKey = CACHE_KEY_MATCH[1];
  const { sandbox, store, root, appended } = makeSandbox({
    storage: { [cacheKey]: JSON.stringify({ version: BUILD_VERSION - 1, code: '/*LAMA*/' }) },
    fetchImpl: () => Promise.resolve({ ok: false, status: 500 }),
    babelImpl: { transform: () => ({ code: 'X' }) },
  });

  await runLoader(sandbox);

  assert.equal(appended.length, 0, 'tidak ada script yang boleh dijalankan kalau fetch gagal');
  assert.match(root.innerHTML, /Gagal memuat aplikasi/);
  assert.equal(store[cacheKey], undefined, 'cache basi harus dibuang supaya percobaan berikutnya bersih, bukan mengulang kegagalan yang sama');
});

test('loader: window.SIGAP_BUILD_VERSION selalu diset di awal, baik cache hit maupun miss', async () => {
  const cacheKey = CACHE_KEY_MATCH[1];
  const { sandbox } = makeSandbox({
    storage: { [cacheKey]: JSON.stringify({ version: BUILD_VERSION, code: 'const y=1;' }) },
    fetchImpl: () => Promise.reject(new Error('tidak boleh dipanggil')),
    babelImpl: { transform: () => { throw new Error('tidak boleh dipanggil'); } },
  });

  await runLoader(sandbox);
  assert.equal(sandbox.window.SIGAP_BUILD_VERSION, BUILD_VERSION);
});
