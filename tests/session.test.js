// ===== tests/session.test.js =====
// Mengunci siklus hidup SESI LOGIN. Dipisah dari login.test.js (yang menguji
// layar/form login) karena yang dijaga di sini adalah bug lapangan yang
// dilaporkan setelah SIGAP dipasang ke Home Screen iPhone:
//
//   "login berhasil, lalu aplikasi langsung kembali logout dengan pesan sesi
//    habis — berulang setiap kali dicoba."
//
// Akar masalahnya BUKAN iOS: penjaga sesi di app.js dulu hanya mencocokkan
// TEKS pesan "Sesi berakhir" tanpa pernah menanyakan token mana yang dipakai
// request itu. Karena Apps Script lambat dan boot menembakkan 7 request
// paralel, jawaban milik sesi LAMA bisa mendarat setelah guru berhasil login
// ulang dan ikut menghapus sesi BARU. Membuka dari ikon Home Screen adalah
// satu-satunya alur yang rutin memulai dari "sesi tersimpan tapi sudah mati di
// server", jadi di situlah balapan ini hampir selalu kalah.
//
// Yang dijaga file ini:
//   - jawaban basi milik sesi lama TIDAK boleh melogout sesi yang sedang aktif;
//   - sesi yang MEMANG habis tetap melogout (perbaikan ini bukan penutup pesan);
//   - sesi disimpan sebagai satu record utuh, tidak bisa robek separuh;
//   - record yang tidak terbaca ≠ "sesi habis" (tidak ada pesan palsu);
//   - umur sesi tetap maksimal 6 jam sejak login, ditegakkan di server;
//   - logout benar-benar menghapus sesi;
//   - role & hak akses tetap benar setelah sesi dipulihkan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// URUTAN INI HARUS SAMA PERSIS dengan array `files` di index.html.
const FILES = [
  'config.js',
  'helpers.js',
  'export-format.js',
  'ui-common.js',
  'admin.js',
  'beranda-riwayat.js',
  'statistik.js',
  'gerbang.js',
  'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js',
  'export-data.js',
  'notifikasi.js',
  'app.js',
];

let sandbox;
let storage = {};
let fetchCalls = [];
let effects = [];
let fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) });

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
  }

  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {
      constructor(props) { this.props = props; this.state = {}; }
      setState(patch) { this.state = Object.assign({}, this.state, patch); }
    },
  };

  sandbox = {
    console,
    React,
    ReactDOM: { createRoot: () => ({ render: () => {} }) },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    fetch: (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
    setTimeout,
    clearTimeout,
    // Stub, bukan setInterval/clearInterval asli: App() sekarang mendaftarkan
    // interval 5 menit (pengecekan update, lihat app.js) yang tidak pernah
    // perlu benar-benar berbunyi di test ini -- pakai timer Node asli di sini
    // akan menggantung proses test menunggu timer itu.
    setInterval: () => 0,
    clearInterval: () => {},
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

test.beforeEach(() => {
  storage = {};
  fetchCalls = [];
  effects = [];
  fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) });
});

const get = (name) => vm.runInContext(name, sandbox);

const SIX_HOURS = 6 * 60 * 60 * 1000;
const guru = { id: 'G01', name: 'Kartina', role: 'guru', jabatan: '', waliKelas: '' };
const walikelas = { id: 'G02', name: 'Kasman', role: 'guru', jabatan: '', waliKelas: 'X-1' };

// Tulis sesi dalam FORMAT BARU (satu record utuh) langsung ke storage palsu.
function storeSession(user, token, expiresInMs, loginAt) {
  const now = Date.now();
  storage.sigap_session = JSON.stringify({
    v: 1,
    token: token || 'TOK',
    user: user,
    expiresAt: now + (expiresInMs === undefined ? SIX_HOURS : expiresInMs),
    loginAt: loginAt === undefined ? now : loginAt,
  });
}

function bootApp() {
  effects = [];
  const tree = get('App')({});
  effects.forEach((e) => e.fn());
  return tree;
}

function flatten(node, out) {
  out = out || [];
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (typeof node !== 'object') return out;
  out.push(node);
  flatten(node.children, out);
  if (node.props && node.props.children) flatten(node.props.children, out);
  return out;
}
const findAll = (node, pred) => flatten(node).filter((n) => n.type !== undefined && pred(n));

// =====================================================================
// BAGIAN 1 — penjaga sesi (fungsi murni, inti perbaikannya)
// =====================================================================

test('shouldClearSessionForResponse: jawaban BASI milik sesi lama tidak melogout sesi yang aktif', () => {
  const guard = get('shouldClearSessionForResponse');
  const habis = { status: 'error', message: 'Sesi berakhir, silakan login ulang.' };

  // INI bug-nya: request ditembak dengan token LAMA, jawabannya baru mendarat
  // setelah guru login ulang dan memegang token BARU.
  assert.equal(guard(habis, 'TOKEN_LAMA', 'TOKEN_BARU'), false);

  // Sesi yang benar-benar habis TETAP melogout — perbaikan ini bukan penutup pesan.
  assert.equal(guard(habis, 'TOKEN_AKTIF', 'TOKEN_AKTIF'), true);

  // Sudah logout manual: jawaban yang masih di jalan tidak boleh memunculkan
  // "Sesi berakhir" di layar login padahal guru sendiri yang menekan Keluar.
  assert.equal(guard(habis, 'TOKEN_LAMA', null), false);

  // Request yang memang tidak butuh sesi (login, getLoginUsers).
  assert.equal(guard(habis, null, 'TOKEN_AKTIF'), false);
});

test('shouldClearSessionForResponse: hanya respons sesi-habis yang melogout', () => {
  const guard = get('shouldClearSessionForResponse');
  const cases = [
    [{ status: 'success', logs: [] }, 'respons normal'],
    [{ status: 'error', message: 'Unauthorized' }, 'salah API token'],
    [{ status: 'error', message: 'Terlalu banyak aksi. Coba lagi dalam 1 menit.' }, 'rate limit'],
    [{ status: 'error', message: 'Password salah!' }, 'gagal autentikasi'],
    [null, 'respons kosong'],
    [undefined, 'tanpa respons'],
  ];
  cases.forEach(([data, label]) => {
    assert.equal(guard(data, 'TOK', 'TOK'), false, `${label} tidak boleh melogout`);
  });
});

test('isSessionExpiredResponse: tidak peka besar/kecil huruf, hanya untuk status error', () => {
  const isExpired = get('isSessionExpiredResponse');
  assert.equal(isExpired({ status: 'error', message: 'Sesi berakhir, silakan login ulang.' }), true);
  assert.equal(isExpired({ status: 'error', message: 'sesi BERAKHIR' }), true);
  // Pesan yang sama pada respons sukses bukan sinyal logout.
  assert.equal(isExpired({ status: 'success', message: 'Sesi berakhir' }), false);
});

// =====================================================================
// BAGIAN 2 — record sesi di localStorage
// =====================================================================

test('parseSessionRecord: record robek/rusak dibaca sebagai "tidak ada", BUKAN "sesi habis"', () => {
  const parse = get('parseSessionRecord');
  const now = Date.now();

  // Inilah pesan palsu yang dikeluhkan: sebelumnya sesi ditulis lewat tiga
  // setItem terpisah, dan kalau yang kedua/ketiga gagal (kuota — web app Home
  // Screen iOS punya jatah sendiri yang lebih ketat) sisanya terbaca sebagai
  // sesi kedaluwarsa. Sekarang tidak ada lagi keadaan separuh jadi, dan apa pun
  // yang tidak terbaca TIDAK memicu pesan "sesi habis".
  const rusak = [
    ['{bukan json', 'JSON rusak'],
    [JSON.stringify({ v: 1, token: 'T' }), 'user hilang'],
    [JSON.stringify({ v: 1, user: guru }), 'token hilang'],
    [JSON.stringify({ v: 1, token: 'T', user: guru }), 'stempel hilang'],
    [JSON.stringify({ v: 99, token: 'T', user: guru, expiresAt: now + SIX_HOURS }), 'versi record lain'],
    [null, 'belum pernah login'],
  ];
  rusak.forEach(([raw, label]) => {
    const r = parse(raw, now);
    assert.equal(r.token, null, `${label}: tidak boleh dipakai`);
    assert.equal(r.expired, false, `${label}: tidak boleh diklaim sebagai sesi habis`);
  });

  // Sesi yang MEMANG lewat umur tetap ditandai expired supaya layar login bisa
  // menjelaskan kenapa guru harus login lagi.
  const mati = parse(JSON.stringify({ v: 1, token: 'T', user: guru, expiresAt: now - 1 }), now);
  assert.equal(mati.token, null);
  assert.equal(mati.expired, true);

  // Sesi hidup dipakai apa adanya.
  const hidup = parse(JSON.stringify({ v: 1, token: 'T', user: guru, expiresAt: now + 60000, loginAt: now }), now);
  assert.equal(hidup.token, 'T');
  assert.equal(hidup.user.name, 'Kartina');
  assert.equal(hidup.expired, false);
});

test('buildSessionRecord + parseSessionRecord: sekali tulis, sekali baca, utuh', () => {
  const now = Date.now();
  const raw = JSON.stringify(get('buildSessionRecord')('TOK', guru, now + SIX_HOURS, now));
  const back = get('parseSessionRecord')(raw, now);
  assert.equal(back.token, 'TOK');
  assert.equal(back.user.role, 'guru');
  assert.equal(back.expiresAt, now + SIX_HOURS);
  assert.equal(back.loginAt, now);
  // Record TIDAK boleh menyimpan kredensial apa pun.
  assert.ok(!/password|salt|hash|pin/i.test(raw), 'record sesi tidak boleh memuat kredensial');
});

// =====================================================================
// BAGIAN 3 — perpanjangan sesi
// =====================================================================

test('nextSessionExpiry: backend lama (tanpa sessionExpiresAt) tidak mengubah apa pun', () => {
  const next = get('nextSessionExpiry');
  const now = Date.now();
  const current = now + 60000;
  // Ini yang menjaga tidak ada regresi selama Code.gs/Auth.gs belum di-deploy
  // manual: klien hanya memperpanjang kalau server benar-benar mengabarkannya.
  assert.equal(next(current, undefined, now), current);
  assert.equal(next(current, 0, now), current);
  assert.equal(next(current, 'bukan angka', now), current);
});

test('nextSessionExpiry: memperpanjang, tapi tidak pernah memendekkan atau melewati satu TTL', () => {
  const next = get('nextSessionExpiry');
  const now = Date.now();

  // Diperpanjang saat server memberi masa berlaku yang lebih jauh.
  assert.equal(next(now + 60000, now + SIX_HOURS, now), now + SIX_HOURS);

  // Nilai yang lebih pendek diabaikan — jawaban aneh tidak boleh memotong sesi.
  assert.equal(next(now + SIX_HOURS, now + 1000, now), now + SIX_HOURS);

  // Server tidak pernah boleh memberi lebih dari satu TTL penuh ke depan.
  assert.equal(next(now + 60000, now + 30 * 24 * 60 * 60 * 1000, now), now + SIX_HOURS);
});

// =====================================================================
// BAGIAN 4 — alur nyata di App()
// =====================================================================

// TEST 2/3/4 (Home Screen, reload, tutup-buka): sesi tersimpan yang masih sah
// langsung dipakai, tanpa perlu login lagi.
test('boot: sesi tersimpan yang masih sah langsung dipakai (buka dari ikon/reload)', () => {
  storeSession(guru, 'TOK');
  const tree = bootApp();
  assert.equal(findAll(tree, (n) => n.type === get('LoginScreen')).length, 0, 'tidak boleh balik ke layar login');
  assert.ok(fetchCalls.length > 0, 'boot harus menarik data dengan sesi yang dipulihkan');
  fetchCalls.map((c) => String(c[0])).filter((u) => u.includes('sessionToken')).forEach((u) => {
    assert.match(u, /sessionToken=TOK/, 'request boot harus memakai token sesi yang dipulihkan');
  });
});

// TEST 7: role & hak akses harus tetap benar setelah sesi dipulihkan.
test('boot: role & hak akses tetap benar setelah sesi dipulihkan', () => {
  storeSession(guru, 'TOK');
  const guruTree = bootApp();
  const guruNav = findAll(guruTree, (n) => n.type === get('BottomNav'))[0];
  assert.ok(guruNav, 'BottomNav harus terender');
  assert.ok(!guruNav.props.menus.includes('rekap'), 'guru biasa tidak boleh dapat Rekap Kelas');
  assert.ok(!guruNav.props.menus.includes('bimbingan'), 'guru biasa tidak boleh dapat Bimbingan');

  // Wali kelas: hak tambahan yang dihitung runtime dari user.waliKelas harus
  // ikut pulih, bukan cuma role statis dari config.js.
  storage = {};
  fetchCalls = [];
  storeSession(walikelas, 'TOK');
  const waliNav = findAll(bootApp(), (n) => n.type === get('BottomNav'))[0];
  assert.ok(waliNav.props.menus.includes('rekap'), 'wali kelas harus tetap dapat Rekap Kelas setelah sesi dipulihkan');
});

// TEST 5: sesi yang benar-benar habis → langsung layar login yang bisa dipakai,
// tanpa satu pun request ditembakkan dengan token mati.
test('boot: sesi yang sudah lewat umur → layar login, tanpa request ber-sesi', () => {
  storeSession(guru, 'TOK', -1);
  const tree = bootApp();
  const login = findAll(tree, (n) => n.type === get('LoginScreen'));
  assert.equal(login.length, 1);
  assert.match(login[0].props.error, /Sesi sebelumnya sudah berakhir/);
  assert.equal(
    fetchCalls.filter((c) => String(c[0]).includes('sessionToken=')).length,
    0,
    'tidak boleh ada request yang menembak dengan sesi mati'
  );
});

// TEST 5 lanjutan: perbaikan ini TIDAK boleh jadi penutup pesan — sesi yang
// memang ditolak server tetap harus melogout.
test('sesi yang benar-benar ditolak server tetap melogout & menghapus record', async () => {
  storeSession(guru, 'TOK');
  storage.sigap_data_cache = JSON.stringify({ v: 1, userId: 'G01', data: {} });
  fetchImpl = () => Promise.resolve({
    json: () => Promise.resolve({ status: 'error', message: 'Sesi berakhir, silakan login ulang.' }),
  });

  bootApp();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(storage.sigap_session, undefined, 'record sesi harus dihapus');
  assert.equal(storage.sigap_data_cache, undefined, 'snapshot data ikut dibuang saat sesi habis');
});

// Bug utamanya, diuji lewat efek yang bisa diamati: request yang ditembakkan
// TANPA sesi (login) lalu dijawab "Sesi berakhir" tidak boleh menghapus apa pun.
// Penjaga versi lama yang cuma mencocokkan teks pesan akan gagal di sini.
test('jawaban "Sesi berakhir" atas request tanpa sesi tidak menghapus penyimpanan', async () => {
  storage.sigap_data_cache = JSON.stringify({ v: 1, userId: 'G01', data: {} });
  fetchImpl = () => Promise.resolve({
    json: () => Promise.resolve({ status: 'error', message: 'Sesi berakhir, silakan login ulang.' }),
  });

  const tree = bootApp();
  findAll(tree, (n) => n.type === get('LoginScreen'))[0].props.onLogin({ preventDefault: () => {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(storage.sigap_data_cache, 'clearSession tidak boleh terpicu oleh jawaban request tanpa sesi');
});

// TEST 3/4: sesi diperpanjang saat server mengabarkannya, jadi pemakaian aktif
// tidak putus di tengah jalan.
test('respons yang membawa sessionExpiresAt memperpanjang record tersimpan', async () => {
  const now = Date.now();
  storeSession(guru, 'TOK', 60 * 60 * 1000); // tinggal 1 jam
  fetchImpl = () => Promise.resolve({
    json: () => Promise.resolve({ status: 'success', logs: [], sessionExpiresAt: now + SIX_HOURS }),
  });

  bootApp();
  await new Promise((r) => setTimeout(r, 0));

  const record = JSON.parse(storage.sigap_session);
  assert.ok(record.expiresAt > now + 5 * 60 * 60 * 1000, 'masa berlaku sesi harus ikut diperpanjang');
  assert.equal(record.token, 'TOK', 'token tidak boleh berubah saat diperpanjang');
  assert.equal(record.user.name, 'Kartina');
});

// TEST 6: logout manual benar-benar menghapus sesi.
test('logout: record sesi & snapshot data benar-benar dihapus', () => {
  storeSession(guru, 'TOK');
  storage.sigap_data_cache = JSON.stringify({ v: 1, userId: 'G01', data: {} });
  const tree = bootApp();

  const header = findAll(tree, (n) => n.type === get('Header'))[0];
  assert.ok(header, 'Header harus terender saat sudah login');
  header.props.onLogout();

  assert.equal(storage.sigap_session, undefined);
  assert.equal(storage.sigap_data_cache, undefined);
  const logoutPost = fetchCalls.find((c) => c[1] && c[1].method === 'POST' && String(c[1].body).includes('logout'));
  assert.ok(logoutPost, 'logout harus juga dikabarkan ke server supaya sesinya dihapus di sana');
});

// =====================================================================
// BAGIAN 5 — sisi server (Auth.gs sungguhan, CacheService di-stub)
// =====================================================================

function loadAuthContext() {
  const store = {};
  const ctx = {
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(str).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-token-123' }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k].value : null),
        put: (k, v, ttl) => { store[k] = { value: v, ttl: ttl }; },
        remove: (k) => { delete store[k]; },
      }),
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8'), ctx, { filename: 'Utils.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Auth.gs'), 'utf8'), ctx, { filename: 'Auth.gs' });
  ctx.__store = store;
  return ctx;
}

test('Auth.gs: entri sesi di-put ulang tiap dipakai supaya tidak dibuang cache lebih awal', () => {
  const ctx = loadAuthContext();
  const token = ctx.createSession(guru);

  const user = ctx.getSessionUser(token);
  assert.equal(user.name, 'Kartina');
  assert.equal(user.role, 'guru');
  assert.equal(ctx.__store['sess_' + token].ttl, 21600, 'entri harus di-put ulang dengan TTL penuh');
  assert.ok(ctx.SESSION_RENEWED_UNTIL > Date.now(), 'batas akhir sesi harus dikabarkan ke klien');
  assert.ok(ctx.SESSION_RENEWED_UNTIL <= Date.now() + SIX_HOURS, 'dan tidak pernah lebih dari 6 jam');
});

test('Auth.gs: token tidak dikenal & token kosong tetap ditolak', () => {
  const ctx = loadAuthContext();
  assert.equal(ctx.getSessionUser(''), null);
  assert.equal(ctx.getSessionUser(null), null);
  assert.equal(ctx.getSessionUser('token-karangan'), null);
  assert.equal(ctx.SESSION_RENEWED_UNTIL, 0, 'token ditolak tidak boleh mengabarkan batas akhir sesi');
});

test('Auth.gs: umur sesi tetap maksimal 6 jam sejak login (kebijakan lama tidak berubah)', () => {
  const ctx = loadAuthContext();
  const key = (t) => 'sess_' + t;

  // Baru login: sah.
  const baru = ctx.createSession(guru);
  assert.equal(ctx.getSessionUser(baru).name, 'Kartina');

  // Masih di dalam 6 jam (login 5 jam lalu): sah, dan put ulang TIDAK boleh
  // mendorong batas akhirnya melewati 6 jam sejak login.
  const hampir = ctx.createSession(guru);
  const recH = JSON.parse(ctx.__store[key(hampir)].value);
  recH.loginAt = Date.now() - 5 * 60 * 60 * 1000;
  ctx.__store[key(hampir)].value = JSON.stringify(recH);
  assert.equal(ctx.getSessionUser(hampir).name, 'Kartina', 'sesi 5 jam masih sah');
  assert.ok(
    ctx.SESSION_RENEWED_UNTIL <= recH.loginAt + SIX_HOURS,
    'batas akhir tidak boleh lewat dari 6 jam sejak login — put ulang bukan perpanjangan umur'
  );

  // Lewat 6 jam sejak login: ditolak, walau entri cache-nya masih ada.
  const lewat = ctx.createSession(guru);
  const recL = JSON.parse(ctx.__store[key(lewat)].value);
  recL.loginAt = Date.now() - (SIX_HOURS + 60000);
  ctx.__store[key(lewat)].value = JSON.stringify(recL);
  assert.equal(ctx.getSessionUser(lewat), null, 'sesi lewat 6 jam harus ditolak');
  assert.equal(ctx.__store[key(lewat)], undefined, 'dan dibuang dari cache');
});

test('Auth.gs: record sesi format lama tetap berlaku sampai habis sendiri', () => {
  const ctx = loadAuthContext();
  // Sesi yang dibuat backend versi sebelumnya: objek user polos tanpa
  // pembungkus. Guru yang sedang login saat deploy tidak boleh ikut terlempar.
  ctx.CacheService.getScriptCache().put('sess_LAMA', JSON.stringify(guru), 21600);
  const user = ctx.getSessionUser('sess-tidak-ada');
  assert.equal(user, null);
  const old = ctx.getSessionUser('LAMA');
  assert.equal(old.name, 'Kartina');
  assert.equal(ctx.SESSION_RENEWED_UNTIL, 0, 'waktu login-nya tidak diketahui, jadi tidak di-put ulang');
});

test('Utils.gs: jsonOut melampirkan sessionExpiresAt hanya saat sesi tersentuh', () => {
  const ctx = loadAuthContext();
  const captured = [];
  ctx.ContentService = {
    createTextOutput: (s) => { captured.push(s); return { setMimeType: () => s }; },
    MimeType: { JSON: 'JSON' },
  };

  // Request yang tidak menyentuh sesi (mis. respons login / Unauthorized).
  ctx.SESSION_RENEWED_UNTIL = 0;
  ctx.jsonOut({ status: 'success' });
  assert.ok(!JSON.parse(captured[0]).sessionExpiresAt);

  // Setelah getSessionUser memvalidasi & menyegarkan entri sesi.
  const token = ctx.createSession(guru);
  ctx.getSessionUser(token);
  ctx.jsonOut({ status: 'success', logs: [] });
  const body = JSON.parse(captured[1]);
  assert.ok(body.sessionExpiresAt > Date.now(), 'klien harus tahu sampai kapan sesinya berlaku sekarang');
  assert.deepEqual(body.logs, []);
});
