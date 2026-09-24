// ===== tests/loading-cache-visibility.test.js =====
// Data yang SUDAH ADA (cache klien bootCache atau data lama sebelum Refresh)
// tidak boleh disembunyikan "Memuat data..." selagi fetchData() berjalan.
// fetchData() menyalakan loadingLogs di boot (termasuk boot dari cache) dan
// tiap kali tombol Refresh Beranda/Gerbang ditekan. Sebelum perbaikan ini,
// Beranda & Gerbang mengganti seluruh feed dengan "Memuat data..." walau
// allLogs/suratList sudah berisi; Riwayat & Statistik sebaliknya tidak tahu
// sedang memuat sama sekali dan menampilkan pesan "kosong" yang menyesatkan.
// Harness sama dengan gerbang-mode-accent.test.js: React palsu, komponen anak
// tidak dibuka.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
let stateOverrides = [];
let stateCallIndex = 0;

function makeSandbox() {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error(
      "Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu di root repo sebelum menjalankan test ini."
    );
  }
  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => {
      const idx = stateCallIndex++;
      const val = stateOverrides[idx] !== undefined ? stateOverrides[idx] : typeof init === 'function' ? init() : init;
      return [val, () => {}];
    },
    useEffect: () => {},
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
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
}

test.before(makeSandbox);

function get(name) {
  return vm.runInContext(name, sandbox);
}

function render(fnName, props, overrides) {
  stateOverrides = overrides || [];
  stateCallIndex = 0;
  return get(fnName)(props);
}

function flatten(node, out) {
  out = out || [];
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out; }
  if (typeof node !== 'object') { out.push({ text: String(node) }); return out; }
  out.push(node);
  flatten(node.children, out);
  if (node.props && node.props.children) flatten(node.props.children, out);
  return out;
}

function allText(node) {
  return flatten(node).filter((n) => n.text !== undefined).map((n) => n.text).join(' ');
}

function findAll(node, predicate) {
  return flatten(node).filter((n) => n.type !== undefined && predicate(n));
}

const hariIni = new Date();
const logHariIni = { timestamp: hariIni.toISOString(), nisn: '111', name: 'Budi Santoso', class: 'X-1', type: 'Terlambat', logged_by: 'Guru A' };
const user = { id: 'G1', name: 'Guru A', role: 'guru', waliKelas: '' };

function dashboardProps(extra) {
  return Object.assign({ user, allLogs: [], pelanggaranList: [], suratList: [], jadwalPiket: [], onRefresh: () => {}, loading: false, tindakLanjutList: [], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {}, izinList: [], kelompokList: [], canVerifyIzin: false }, extra);
}
function gerbangProps(extra) {
  return Object.assign({ students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: false, waliKelasMap: [], izinList: [], kelompokList: [], canVerifyIzin: false, onRefresh: () => {}, loadingActivity: false }, extra);
}
function logProps(extra) {
  return Object.assign({ allLogs: [], pelanggaranList: [], suratList: [], izinList: [], initialCategory: 'terlambat', canManage: true, isAdmin: false, isBk: false, currentUserName: 'Guru A', onEditEntry: () => {}, onDeleteEntry: () => {}, students: [] }, extra);
}
function statsProps(extra) {
  return Object.assign({ allLogs: [], pelanggaranList: [], suratList: [], canExport: false, canViewRanking: true, students: [] }, extra);
}

// ---- Beranda ----
test('Beranda: loading + data sudah ada -> feed tetap tampil, tanpa "Memuat data..."', () => {
  const tree = render('DashboardTab', dashboardProps({ allLogs: [logHariIni], loading: true }));
  const feed = findAll(tree, (n) => n.type === get('FeedItem'));
  assert.ok(feed.length >= 1, 'FeedItem data cache harus tetap dirender selagi memuat');
  assert.doesNotMatch(allText(tree), /Memuat data\.\.\./);
});

test('Beranda: loading + belum ada data sama sekali -> "Memuat data..." (bukan "Belum ada aktivitas")', () => {
  const t = allText(render('DashboardTab', dashboardProps({ loading: true })));
  assert.match(t, /Memuat data\.\.\./);
});

test('Beranda: tidak loading + tanpa data -> empty state tetap seperti semula', () => {
  const tree = render('DashboardTab', dashboardProps({ loading: false }));
  const empty = findAll(tree, (n) => n.props && n.props.text === 'Belum ada aktivitas tercatat hari ini.');
  assert.equal(empty.length, 1);
  assert.doesNotMatch(allText(tree), /Memuat data\.\.\./);
});

// ---- Gerbang ----
test('Gerbang: loadingActivity + data sudah ada -> aktivitas hari ini tetap tampil', () => {
  const t = allText(render('GerbangTab', gerbangProps({ allLogs: [logHariIni], loadingActivity: true })));
  assert.match(t, /Budi Santoso/, 'baris aktivitas dari cache harus tetap dirender selagi memuat');
  assert.doesNotMatch(t, /Memuat data\.\.\./);
});

test('Gerbang: loadingActivity + belum ada data -> "Memuat data..."', () => {
  const t = allText(render('GerbangTab', gerbangProps({ loadingActivity: true })));
  assert.match(t, /Memuat data\.\.\./);
});

// ---- Riwayat ----
test('Riwayat: loading + belum ada data -> "Memuat..." bukan "Tidak ada catatan"', () => {
  const tree = render('LogTab', logProps({ loading: true }));
  assert.match(allText(tree), /Memuat\.\.\./);
  const empty = findAll(tree, (n) => n.props && typeof n.props.text === 'string' && /Tidak ada catatan/.test(n.props.text));
  assert.equal(empty.length, 0, 'pesan "kosong" tidak boleh muncul selagi data belum pernah datang');
});

test('Riwayat: tidak loading + tanpa data -> empty state tetap', () => {
  const tree = render('LogTab', logProps({ loading: false }));
  const empty = findAll(tree, (n) => n.props && typeof n.props.text === 'string' && /Tidak ada catatan/.test(n.props.text));
  assert.equal(empty.length, 1);
});

test('Riwayat: loading + data sudah ada -> daftar tetap, tanpa "Memuat..."', () => {
  const t = allText(render('LogTab', logProps({ allLogs: [logHariIni], loading: true })));
  assert.match(t, /Budi Santoso/);
  assert.doesNotMatch(t, /Memuat\.\.\./);
});

// ---- Statistik ----
test('Statistik: loading + belum ada data -> "Memuat..." bukan "Belum ada data di periode ini"', () => {
  const t = allText(render('StatsTab', statsProps({ loading: true })));
  assert.match(t, /Memuat\.\.\./);
  assert.doesNotMatch(t, /Belum ada data di periode ini/);
  assert.doesNotMatch(t, /Tidak ada siswa dengan/);
});

test('Statistik: tidak loading + tanpa data -> pesan kosong tetap', () => {
  const t = allText(render('StatsTab', statsProps({ loading: false })));
  assert.match(t, /Belum ada data di periode ini/);
});

// ---- Pengkabelan app.js: flag yang sama (loadingLogs), tanpa state baru ----
test('app.js: LogTab & StatsTab menerima loading={loadingLogs}', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(src, /<LogTab[\s\S]*?loading=\{loadingLogs\}[\s\S]*?\/>/);
  assert.match(src, /<StatsTab[^>]*loading=\{loadingLogs\}/);
});
