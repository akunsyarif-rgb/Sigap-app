// ===== tests/push-frontend.test.js =====
// Bagian FRONTEND dari fitur Push Notification yang tidak tercakup
// render-smoke.test.js (badan komponennya sendiri, termasuk NotifikasiTab &
// NotifikasiOnboardingBanner, sudah dites di sana): fungsi murni di
// notifikasi.js (eligibility, deep-link, deteksi platform), dan pemeriksaan
// statis atas manifest.json/sw.js/index.html/package.json supaya potongan
// PWA-nya tidak diam-diam pecah tanpa test yang merah.
//
// TIDAK ADA satu pun asumsi printer/perangkat di sini, dan TIDAK ADA
// permintaan izin browser yang dipicu otomatis — lihat pengecekan statis di
// bagian bawah file ini.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
// notifikasi.js punya JSX (NotifikasiOnboardingBanner/NotifikasiTab) --
// harus lewat Babel dulu sebelum vm.runInContext, sama seperti
// render-smoke.test.js memperlakukan seluruh bundle frontend.
let NOTIF_SRC;
try {
  const babel = require('@babel/core');
  NOTIF_SRC = babel.transformSync(fs.readFileSync(path.join(ROOT, 'notifikasi.js'), 'utf8'), {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
  }).code;
} catch (e) {
  throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu di root repo sebelum menjalankan test ini.");
}

function loadPureFunctions(navigatorOverrides, windowOverrides) {
  const sandbox = {
    console,
    navigator: Object.assign({ userAgent: 'Mozilla/5.0 (Linux; Android 10)', maxTouchPoints: 0 }, navigatorOverrides || {}),
    window: Object.assign({}, windowOverrides || {}),
    localStorage: { getItem: () => null, setItem: () => {} },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URLSearchParams: URLSearchParams,
    // useState/useEffect/useRef tidak dipakai fungsi murni di bawah ini,
    // tapi harus ada supaya file bisa di-parse (dipakai komponen di file
    // yang sama) -- tidak pernah benar-benar dipanggil oleh test ini.
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    React: { createElement: () => null },
    Notification: undefined,
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(NOTIF_SRC, sandbox, { filename: 'notifikasi.js' });
  return sandbox;
}

test('pushIsEligible: wali kelas selalu eligible, apa pun isi Jadwal_Piket', () => {
  const s = loadPureFunctions();
  const pushIsEligible = vm.runInContext('pushIsEligible', s);
  assert.equal(pushIsEligible({ id: 'G01', waliKelas: 'XI B' }, []), true);
});

test('pushIsEligible: guru yang namanya ada di Jadwal_Piket (hari apa pun) eligible', () => {
  const s = loadPureFunctions();
  const pushIsEligible = vm.runInContext('pushIsEligible', s);
  assert.equal(pushIsEligible({ id: 'G10', waliKelas: '' }, [{ hari: 'Senin', guruId: 'G10' }]), true);
});

test('pushIsEligible: guru biasa (bukan wali kelas, tidak pernah piket) tidak eligible', () => {
  const s = loadPureFunctions();
  const pushIsEligible = vm.runInContext('pushIsEligible', s);
  assert.equal(pushIsEligible({ id: 'G99', waliKelas: '' }, [{ hari: 'Senin', guruId: 'G10' }]), false);
  assert.equal(pushIsEligible(null, []), false);
});

test('urlBase64ToUint8Array: hasil decode sama dengan Buffer.from base64url manual', () => {
  const s = loadPureFunctions();
  const fn = vm.runInContext('urlBase64ToUint8Array', s);
  const original = Buffer.from([1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const b64url = original.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const result = fn(b64url);
  assert.deepEqual(Array.from(result), Array.from(original));
});

test('pushUnavailableReason: iOS belum di-install -> instruksi Tambah ke Layar Utama', () => {
  const s = loadPureFunctions({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' });
  const fn = vm.runInContext('pushUnavailableReason', s);
  assert.match(fn(), /Tambah ke Layar Utama/);
});

test('pushUnavailableReason: Android/desktop tanpa dukungan -> saran browser lain, bukan pesan iOS', () => {
  const s = loadPureFunctions({ userAgent: 'Mozilla/5.0 (Linux; Android 10)' });
  const fn = vm.runInContext('pushUnavailableReason', s);
  assert.doesNotMatch(fn(), /Layar Utama/);
  assert.match(fn(), /Chrome|Edge/);
});

test('pushUnavailableReason: mengembalikan null kalau pushIsSupported (tidak perlu instruksi apa pun)', () => {
  const s = loadPureFunctions({}, {}); // window kosong -> 'PushManager' in window tetap false, jadi tetap unsupported
  // Simulasikan browser yang mendukung penuh dengan menambahkan properti yang diperiksa pushIsSupported.
  s.window.PushManager = function () {};
  s.navigator.serviceWorker = {};
  s.Notification = function () {};
  const fn = vm.runInContext('pushUnavailableReason', s);
  assert.equal(fn(), null);
});

test('consumePushGotoParam: membaca & membuang ?goto= dari URL, mengembalikan null kalau tidak ada', () => {
  const replaced = [];
  const s = loadPureFunctions();
  s.window.location = { search: '?goto=izin&lainnya=1', pathname: '/', hash: '' };
  s.window.history = { replaceState: (_s, _t, url) => replaced.push(url) };
  const fn = vm.runInContext('consumePushGotoParam', s);
  const goto = fn();
  assert.equal(goto, 'izin');
  assert.equal(replaced.length, 1);
  assert.doesNotMatch(replaced[0], /goto=/, 'token goto harus dibuang dari URL supaya tidak terulang saat refresh');
  assert.match(replaced[0], /lainnya=1/, 'parameter lain di URL tidak boleh ikut hilang');

  const s2 = loadPureFunctions();
  s2.window.location = { search: '', pathname: '/', hash: '' };
  const fn2 = vm.runInContext('consumePushGotoParam', s2);
  assert.equal(fn2(), null);
});

// ================= Pemeriksaan statis: manifest.json, sw.js, index.html =================

test('manifest.json valid dan punya field minimum PWA', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(typeof manifest.name, 'string');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  manifest.icons.forEach((icon) => {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), 'ikon tidak ditemukan: ' + icon.src);
  });
});

test('sw.js TIDAK punya event listener "fetch" atau memakai Cache Storage API', () => {
  // Lihat komentar di sw.js: sengaja tidak men-cache apa pun supaya tidak
  // bentrok dengan strategi BUILD_VERSION di index.html. Kalau suatu saat ada
  // yang menambahkan caching di sw.js, test ini SENGAJA merah supaya
  // trade-off itu dipikirkan ulang secara sadar, bukan menyelinap diam-diam.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /addEventListener\(\s*['"]fetch['"]/);
  assert.doesNotMatch(sw, /caches\.(open|match)/);
});

test('sw.js menangani push & notificationclick, dan klik notifikasi tidak membawa data selain token goto', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\(\s*['"]push['"]/);
  assert.match(sw, /addEventListener\(\s*['"]notificationclick['"]/);
  assert.match(sw, /showNotification/);
});

test('index.html: files array memuat notifikasi.js, BUILD_VERSION dinaikkan, manifest & apple-touch-icon terpasang', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /'notifikasi\.js'/);
  assert.match(html, /rel="manifest" href="manifest\.json"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="theme-color"/);
  const versionMatch = html.match(/var BUILD_VERSION = (\d+);/);
  assert.ok(versionMatch, 'BUILD_VERSION tidak ditemukan');
  assert.ok(Number(versionMatch[1]) >= 55, 'BUILD_VERSION harus dinaikkan saat notifikasi.js ditambahkan ke files[]');
});

test('index.html TIDAK mendaftarkan service worker langsung -- registrasi ada di notifikasi.js, hanya untuk pengguna eligible', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /serviceWorker\.register/);
});

test('config.js menyediakan VAPID_PUBLIC_KEY (placeholder wajib diganti, bukan hardcode kunci privat)', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.match(cfg, /const VAPID_PUBLIC_KEY/);
  // Menyebut NAMA env var VAPID_PRIVATE_KEY di komentar (menjelaskan di mana
  // pasangannya hidup, di Vercel) itu boleh -- yang TIDAK BOLEH adalah
  // NILAINYA ikut ditulis di sini lewat sebuah assignment.
  assert.doesNotMatch(cfg, /VAPID_PRIVATE_KEY\s*=\s*["']/, 'kunci PRIVAT tidak boleh pernah di-hardcode di file frontend mana pun');
});

test('api/push-send.js ada, memakai web-push, dan mengharuskan Authorization Bearer sebelum mengirim apa pun', () => {
  const relay = fs.readFileSync(path.join(ROOT, 'api/push-send.js'), 'utf8');
  assert.match(relay, /require\(['"]web-push['"]\)/);
  assert.match(relay, /authorization/i);
  assert.doesNotMatch(relay, /VAPID_PRIVATE_KEY\s*=\s*['"]/, 'kunci privat tidak boleh di-hardcode, harus dari process.env');
});

test('package.json mencantumkan web-push sebagai dependency produksi (dipakai api/push-send.js), bukan devDependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && pkg.dependencies['web-push'], 'web-push harus ada di dependencies');
  assert.ok(!pkg.devDependencies || !pkg.devDependencies['web-push'], 'web-push bukan devDependency -- dibutuhkan saat runtime oleh fungsi Vercel');
});

test('.claspignore mengizinkan Notifikasi.gs ikut ter-push clasp', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.claspignore'), 'utf8');
  assert.match(ignore, /!Notifikasi\.gs/);
});
