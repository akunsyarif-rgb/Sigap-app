// ===== tests/refresh-guard.test.js =====
// Verifikasi Fase 0 lanjutan: tombol Refresh Beranda harus disabled + label
// "Memuat..." saat loadingLogs true (sudah begitu di Gerbang, belum di
// Beranda), dan kartu StatCard Statistik tidak boleh menampilkan "0" palsu
// saat data belum pernah datang (loading=true, periodData kosong).
// Harness sama dengan gerbang-mode-accent.test.js.

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

const user = { id: 'G1', name: 'Guru A', role: 'guru', waliKelas: '' };
function dashboardProps(extra) {
  return Object.assign({ user, allLogs: [], pelanggaranList: [], suratList: [], jadwalPiket: [], onRefresh: () => {}, loading: false, tindakLanjutList: [], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {}, izinList: [], kelompokList: [], canVerifyIzin: false }, extra);
}
function statsProps(extra) {
  return Object.assign({ allLogs: [], pelanggaranList: [], suratList: [], canExport: false, canViewRanking: true, students: [] }, extra);
}

test('Beranda: tombol Refresh disabled + label "Memuat..." saat loadingLogs true', () => {
  const tree = render('DashboardTab', dashboardProps({ loading: true }));
  const btn = findAll(tree, (n) => n.type === 'button' && allText(n).trim() === 'Refresh');
  // Kalau belum diperbaiki, tombol tetap berlabel "Refresh" dan tidak disabled --
  // tes ini gagal di kode lama.
  assert.equal(btn.length, 0, 'label harus berubah jadi "Memuat..." saat loading, bukan tetap "Refresh"');
  const memuatBtn = findAll(tree, (n) => n.type === 'button' && allText(n).trim() === 'Memuat...');
  assert.equal(memuatBtn.length, 1);
  assert.equal(memuatBtn[0].props.disabled, true, 'tombol Refresh harus disabled selagi loadingLogs true');
});

test('Beranda: tombol Refresh berlabel "Refresh" & tidak disabled saat tidak loading', () => {
  const tree = render('DashboardTab', dashboardProps({ loading: false }));
  const btn = findAll(tree, (n) => n.type === 'button' && allText(n).trim() === 'Refresh');
  assert.equal(btn.length, 1);
  assert.ok(!btn[0].props.disabled);
});

test('Statistik: StatCard total tidak menampilkan "0" palsu saat loading tanpa data (menampilkan "-")', () => {
  const tree = render('StatsTab', statsProps({ loading: true }));
  const StatCard = get('StatCard');
  const cards = findAll(tree, (n) => n.type === StatCard);
  const total = cards.find((c) => /^Total/.test(c.props.label));
  assert.ok(total, 'StatCard Total harus ada');
  assert.equal(total.props.value, '-', 'saat loading tanpa data, value harus "-" bukan 0 (angka nol menyesatkan seolah datanya memang kosong)');
});

test('Statistik: StatCard total tetap menampilkan 0 asli saat TIDAK loading (data memang kosong)', () => {
  const tree = render('StatsTab', statsProps({ loading: false }));
  const StatCard = get('StatCard');
  const cards = findAll(tree, (n) => n.type === StatCard);
  const total = cards.find((c) => /^Total/.test(c.props.label));
  assert.equal(total.props.value, 0);
});

// ---- Verifikasi (BUKAN diperbaiki -- sudah benar): getLogs gagal (reject/
// network error) tetap mengembalikan loadingLogs ke false lewat .catch(). ----
test('app.js: fetchData() -- .catch() rantai getLogs mengembalikan loadingLogs ke false (FAKTA, sudah benar di kode lama & baru)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = src.indexOf('const fetchData = () => {');
  const end = src.indexOf('\n           };', start);
  const body = src.slice(start, end);
  const getLogsIdx = body.indexOf('action=getLogs');
  assert.ok(getLogsIdx !== -1, 'panggilan getLogs harus ditemukan di fetchData()');
  const afterGetLogs = body.slice(getLogsIdx);
  const catchIdx = afterGetLogs.indexOf('.catch(');
  assert.ok(catchIdx !== -1, 'rantai getLogs harus punya .catch()');
  const catchBody = afterGetLogs.slice(catchIdx, afterGetLogs.indexOf('}', catchIdx + 200));
  assert.match(catchBody, /setLoadingLogs\(false\)/, '.catch() rantai getLogs harus memanggil setLoadingLogs(false) -- tanpa ini, koneksi gagal/offline akan mengunci layar di "Memuat data..." selamanya');
});
