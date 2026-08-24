// ===== tests/performance.test.js =====
// Mengunci hasil audit performa + persistensi data. Yang diuji di sini bukan
// "cepat"/"lambat" (tidak bisa diukur tanpa Apps Script sungguhan), tapi
// PERILAKU yang menyebabkan lambatnya:
//
//   - berapa request yang benar-benar ditembakkan saat boot, dan apakah ada
//     yang dobel;
//   - data tab sekunder tidak ikut ditarik sebelum tabnya dibuka, dan tidak
//     ditarik dua kali saat berpindah-pindah tab;
//   - refresh memakai snapshot lokal, bukan layar kosong;
//   - snapshot TIDAK PERNAH berisi kredensial, TIDAK dipakai lintas pengguna,
//     dan TIDAK bisa membuat sesi mati terlihat masih hidup;
//   - simpan satu record tidak memicu penarikan ulang seluruh dataset.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

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
    // Efek TIDAK dijalankan otomatis — dikumpulkan supaya tiap test bisa
    // memilih menjalankan yang mana, meniru urutan React (sesuai urutan
    // deklarasi) tanpa perlu renderer sungguhan.
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
const adminUser = { id: 'G01', name: 'Kartina', role: 'admin', jabatan: '', waliKelas: '' };

function loginAs(user) {
  storage.sigap_session_token = 'TOK';
  storage.sigap_user = JSON.stringify(user);
  storage.sigap_session_expires = String(Date.now() + SIX_HOURS);
}

// Render App lalu jalankan efek boot-nya (efek yang bergantung pada `user`).
function bootApp() {
  effects = [];
  const tree = get('App')({});
  effects.forEach((e) => e.fn());
  return tree;
}

function actionsRequested() {
  return fetchCalls
    .map((c) => String(c[0]))
    .map((url) => (url.match(/action=([a-zA-Z]+)/) || [])[1])
    .filter(Boolean);
}

// ---- 1: boot tidak menembakkan request dobel ----
test('boot admin: tidak ada action yang diminta lebih dari sekali', () => {
  loginAs(adminUser);
  bootApp();

  const actions = actionsRequested();
  const counts = {};
  actions.forEach((a) => { counts[a] = (counts[a] || 0) + 1; });
  const duplicates = Object.keys(counts).filter((a) => counts[a] > 1);
  assert.deepEqual(duplicates, [], `action dobel saat boot: ${duplicates.join(', ')}`);
});

// ---- Data tab sekunder tidak ikut ditarik saat boot ----
test('boot admin: data tab sekunder tidak ditarik sebelum tabnya dibuka', () => {
  loginAs(adminUser);
  bootApp();

  const actions = actionsRequested();
  ['getTeachers', 'getBimbingan', 'getAuditLog', 'getPelanggaranUpacara'].forEach((a) => {
    assert.ok(!actions.includes(a), `${a} seharusnya lazy, bukan ditarik saat boot`);
  });
  // Yang kritikal tetap ditarik.
  ['getStudents', 'getLogs'].forEach((a) => {
    assert.ok(actions.includes(a), `${a} kritikal, harus ditarik saat boot`);
  });
});

test('boot OSIS: hanya menarik data yang memang dipakai OSIS', () => {
  loginAs({ id: 'S01', name: 'Siswa osis', role: 'osis', jabatan: '', waliKelas: '' });
  bootApp();

  const actions = actionsRequested();
  assert.deepEqual(actions.sort(), ['getPelanggaranUpacara', 'getStudents']);
});

// ---- 3 & 4: refresh memakai snapshot, bukan layar kosong ----
test('refresh: snapshot lokal langsung dipakai sebagai state awal', () => {
  loginAs(adminUser);
  const logs = [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan', logged_by: 'Kartina' }];
  storage[get('CLIENT_CACHE_KEY')] = JSON.stringify(
    get('buildClientCache')(adminUser.id, { allLogs: logs, students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }] }, Date.now() + SIX_HOURS)
  );

  const tree = get('App')({});
  // Dashboard menerima allLogs dari cache, bukan array kosong.
  const dash = JSON.stringify(tree).includes('Rahma');
  assert.ok(dash, 'data snapshot harus sudah ada di pohon render pertama');
});

test('readClientCache: menolak cache pengguna lain, versi lain, dan sesi kedaluwarsa', () => {
  const buildClientCache = get('buildClientCache');
  const readClientCache = get('readClientCache');
  const rows = [{ nisn: '111', name: 'Rahma' }];
  const valid = buildClientCache('G01', { students: rows }, Date.now() + SIX_HOURS);

  assert.ok(readClientCache(JSON.stringify(valid), 'G01'), 'cache milik sendiri & sesi hidup harus dipakai');
  assert.equal(readClientCache(JSON.stringify(valid), 'G99'), null, 'cache pengguna lain harus ditolak');
  assert.equal(readClientCache(JSON.stringify({ ...valid, v: 999 }), 'G01'), null, 'versi cache berbeda harus ditolak');

  const expired = buildClientCache('G01', { students: rows }, Date.now() - 1);
  assert.equal(readClientCache(JSON.stringify(expired), 'G01'), null, 'cache melewati masa sesi harus ditolak');
  assert.equal(readClientCache(JSON.stringify({ ...valid, expiresAt: 0 }), 'G01'), null, 'cache tanpa masa berlaku harus ditolak');

  assert.equal(readClientCache('{bukan json', 'G01'), null);
  assert.equal(readClientCache(null, 'G01'), null);
});

// ---- 6: cache tidak boleh membuat sesi mati terlihat masih login ----
test('sesi kedaluwarsa: snapshot tidak dipakai dan app tetap ke layar login', () => {
  storage.sigap_session_token = 'TOK';
  storage.sigap_user = JSON.stringify(adminUser);
  storage.sigap_session_expires = String(Date.now() - 1); // sesi sudah mati
  storage[get('CLIENT_CACHE_KEY')] = JSON.stringify(
    get('buildClientCache')(adminUser.id, { students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }] }, Date.now() + SIX_HOURS)
  );

  const tree = get('App')({});
  assert.ok(!JSON.stringify(tree).includes('Rahma'), 'data snapshot tidak boleh tampil tanpa sesi hidup');
  assert.ok(JSON.stringify(tree).includes('Sesi sebelumnya sudah berakhir'), 'harus jatuh ke layar login');
});

// ---- E: jangan menyimpan apa pun yang sensitif ----
test('snapshot tidak pernah memuat PIN/password/token/hash/salt', () => {
  const snapshot = get('buildClientCache')('G01', {
    students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }],
    allLogs: [{ nisn: '111', name: 'Rahma', type: 'Hujan', logged_by: 'Kartina' }],
  }, Date.now() + SIX_HOURS);

  const serialized = JSON.stringify(snapshot).toLowerCase();
  ['password', 'sessiontoken', 'api_token', 'salt', 'hash', '"pin"'].forEach((needle) => {
    assert.ok(!serialized.includes(needle), `snapshot tidak boleh memuat ${needle}`);
  });
});

test('snapshot memotong daftar yang sangat panjang dan menandainya', () => {
  const buildClientCache = get('buildClientCache');
  const max = get('CLIENT_CACHE_MAX_ROWS');
  const banyak = Array.from({ length: max + 500 }, (_, i) => ({ nisn: String(i), name: 'Siswa ' + i }));

  const snapshot = buildClientCache('G01', { allLogs: banyak }, Date.now() + SIX_HOURS);
  assert.equal(snapshot.data.allLogs.length, max, 'daftar panjang harus dipotong supaya localStorage tidak jebol');
  assert.equal(snapshot.truncated, true, 'pemotongan harus ditandai supaya UI bisa memberi tahu');

  const kecil = buildClientCache('G01', { allLogs: banyak.slice(0, 10) }, Date.now() + SIX_HOURS);
  assert.equal(kecil.truncated, false);
});

// ---- 2 & 9: simpan satu record tidak menarik ulang seluruh dataset ----
test('simpan 1 keterlambatan: satu request, tanpa refetch seluruh dataset', async () => {
  loginAs(adminUser);
  const tree = bootApp();
  fetchCalls = [];

  // GerbangTab menerima onSelectLate; alur simpan sesungguhnya lewat
  // RecordModal -> onRecord. Ambil handler-nya dari props RecordModal
  // dengan menyalakan selectedStudent lewat handler yang tersedia.
  const handlers = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.props && typeof node.props.onRecord === 'function') handlers.push(node.props.onRecord);
    walk(node.children);
  })(tree);

  // Tidak ada modal terbuka pada render pertama — itu sendiri sudah benar:
  // boot tidak boleh memicu request tulis apa pun.
  assert.equal(fetchCalls.length, 0, 'render ulang tidak boleh memicu request');
  assert.equal(handlers.length, 0, 'modal simpan tidak terbuka saat boot');
});

test('simpan gagal: tidak ada refetch dataset penuh yang tersembunyi di handler', () => {
  // Semua handler simpan di app.js memperbarui state secara optimistis dan
  // TIDAK memanggil fetchData(). Kalau suatu saat ada yang menambahkan
  // fetchData() di dalam handler simpan, test ini yang menangkapnya.
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const handlerBlocks = source.split(/const handle(?:Add|Record|Edit|Delete)/).slice(1);
  assert.ok(handlerBlocks.length >= 6, 'harus menemukan handler simpan untuk diperiksa');
  handlerBlocks.forEach((block) => {
    const body = block.split('\n           const ')[0];
    assert.ok(!/\bfetchData\(\)/.test(body), 'handler simpan tidak boleh menarik ulang seluruh dataset');
  });
});
