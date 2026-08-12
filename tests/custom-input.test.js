// ===== tests/custom-input.test.js =====
// Semua jalur "Custom / ketik manual" diuji sebagai RANTAI UTUH:
//   input UI -> state -> payload -> (bentuk baris Sheet) -> hasil GET ->
//   state -> tampil di riwayat -> tetap tampil setelah refresh (snapshot).
//
// Yang dijaga khusus di sini adalah aturan paling penting: DATA YANG
// TERSIMPAN HARUS SAMA DENGAN YANG DILIHAT GURU. Bug nyata yang pernah ada:
// tombol preset tidak mengosongkan kotak ketik manual, jadi teks manual masih
// terpampang di layar padahal yang terkirim adalah preset.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const FILES = [
  'config.js',
  'helpers.js',
  'ui-common.js',
  'admin.js',
  'beranda-riwayat.js',
  'statistik.js',
  'gerbang.js',
  'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js',
  'app.js',
];

let sandbox;
let stateOverrides = [];
let stateCallIndex = 0;
let storage = {};

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
  }

  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  // useState di sini MENYIMPAN nilainya (bukan no-op setter seperti harness
  // lain) supaya interaksi berurutan — ketik manual lalu tekan preset — bisa
  // benar-benar dijalankan dan hasil akhirnya diperiksa.
  let store = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => {
      const idx = stateCallIndex++;
      if (!(idx in store)) {
        store[idx] = stateOverrides[idx] !== undefined ? stateOverrides[idx] : typeof init === 'function' ? init() : init;
      }
      return [store[idx], (v) => { store[idx] = typeof v === 'function' ? v(store[idx]) : v; }];
    },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {
      constructor(props) { this.props = props; this.state = {}; }
      setState(patch) { this.state = Object.assign({}, this.state, patch); }
    },
  };
  React.__resetStore = () => { store = []; };

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
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }),
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
  stateOverrides = [];
  stateCallIndex = 0;
  vm.runInContext('React', sandbox).__resetStore();
});

const get = (name) => vm.runInContext(name, sandbox);

// Render ulang komponen yang sama sambil mempertahankan store state, meniru
// re-render React setelah setState.
function rerender(fnName, props) {
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

const allText = (node) => flatten(node).filter((n) => n.text !== undefined).map((n) => n.text).join(' ');
const findAll = (node, pred) => flatten(node).filter((n) => n.type !== undefined && pred(n));
// Tombol bisa berupa <button> mentah (preset) ATAU komponen Button bersama
// (tombol Simpan) — createElement palsu tidak merender komponen, jadi
// keduanya harus dicocokkan.
const buttonWithText = (node, label) =>
  findAll(node, (n) => (n.type === 'button' || n.type === get('Button')) && allText(n).trim() === label)[0];
const textInputWithPlaceholder = (node, ph) =>
  findAll(node, (n) => n.type === 'input' && n.props.placeholder === ph)[0];

const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
const CUSTOM = 'Membawa HP saat upacara';

// ============================================================
// A. UpacaraTab — jenis Custom
// ============================================================
test('Upacara: ketik manual -> payload memuat teks custom, bukan "Lainnya"', () => {
  let sent = null;
  const props = { students: [student], upacaraList: [], onAddUpacara: (p) => { sent = p; }, isOsis: true };

  // selectedStudent (state #2) diisi supaya modal terbuka.
  stateOverrides = [undefined, student];
  let tree = rerender('UpacaraTab', props);

  textInputWithPlaceholder(tree, 'Atau ketik manual...').props.onChange({ target: { value: CUSTOM } });
  tree = rerender('UpacaraTab', props);
  buttonWithText(tree, 'Simpan').props.onClick();

  assert.equal(sent.jenis_pelanggaran, CUSTOM);
});

test('Upacara: memilih preset SETELAH ketik manual -> preset yang terkirim DAN kotak manual ikut kosong', () => {
  let sent = null;
  const props = { students: [student], upacaraList: [], onAddUpacara: (p) => { sent = p; }, isOsis: true };

  stateOverrides = [undefined, student];
  let tree = rerender('UpacaraTab', props);

  textInputWithPlaceholder(tree, 'Atau ketik manual...').props.onChange({ target: { value: CUSTOM } });
  tree = rerender('UpacaraTab', props);
  buttonWithText(tree, 'Tidak Tertib').props.onClick();
  tree = rerender('UpacaraTab', props);

  // Inti bug lama: teks manual TIDAK BOLEH tersisa di layar kalau yang
  // tersimpan adalah preset.
  assert.equal(textInputWithPlaceholder(tree, 'Atau ketik manual...').props.value, '',
    'kotak ketik manual harus ikut kosong saat preset dipilih');

  buttonWithText(tree, 'Simpan').props.onClick();
  assert.equal(sent.jenis_pelanggaran, 'Tidak Tertib');
});

test('Upacara: preset biasa tetap bekerja', () => {
  let sent = null;
  const props = { students: [student], upacaraList: [], onAddUpacara: (p) => { sent = p; }, isOsis: true };
  stateOverrides = [undefined, student];
  let tree = rerender('UpacaraTab', props);
  buttonWithText(tree, 'Atribut Tidak Lengkap').props.onClick();
  tree = rerender('UpacaraTab', props);
  buttonWithText(tree, 'Simpan').props.onClick();
  assert.equal(sent.jenis_pelanggaran, 'Atribut Tidak Lengkap');
});

test('Upacara: teks custom muncul di riwayat (hasil GET), bukan label preset', () => {
  const entry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: CUSTOM, catatan: '', logged_by: 'Siswa osis' };
  const tree = get('UpacaraTab')({ students: [], upacaraList: [entry], onAddUpacara: () => {}, isOsis: true });
  assert.ok(allText(tree).includes(CUSTOM));
});

// ============================================================
// B. PelanggaranTab — jenis Custom + sanksi Custom
// ============================================================
test('Pelanggaran: jenis & sanksi manual keduanya masuk payload apa adanya', () => {
  let sent = null;
  const props = {
    students: [student], pelanggaranList: [], onAddPelanggaran: (p) => { sent = p; }, onAddBimbingan: () => {},
    canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap: [],
  };
  stateOverrides = [undefined, student];
  let tree = rerender('PelanggaranTab', props);

  const manualInputs = findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Atau ketik manual...');
  assert.equal(manualInputs.length, 2, 'ada 2 kotak manual: jenis dan sanksi');
  manualInputs[0].props.onChange({ target: { value: 'Corat-coret meja kelas' } });
  tree = rerender('PelanggaranTab', props);
  findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Atau ketik manual...')[1]
    .props.onChange({ target: { value: 'Bersihkan 3 meja' } });
  tree = rerender('PelanggaranTab', props);

  buttonWithText(tree, 'Simpan').props.onClick();
  assert.equal(sent.jenis_pelanggaran, 'Corat-coret meja kelas');
  assert.equal(sent.sanksi, 'Bersihkan 3 meja');
});

test('Pelanggaran: memilih preset sanksi mengosongkan kotak sanksi manual', () => {
  const props = {
    students: [student], pelanggaranList: [], onAddPelanggaran: () => {}, onAddBimbingan: () => {},
    canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap: [],
  };
  stateOverrides = [undefined, student];
  let tree = rerender('PelanggaranTab', props);

  findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Atau ketik manual...')[1]
    .props.onChange({ target: { value: 'Bersihkan 3 meja' } });
  tree = rerender('PelanggaranTab', props);
  buttonWithText(tree, 'Teguran Lisan').props.onClick();
  tree = rerender('PelanggaranTab', props);

  const sanksiManual = findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Atau ketik manual...')[1];
  assert.equal(sanksiManual.props.value, '', 'kotak sanksi manual harus kosong setelah preset dipilih');
});

// ============================================================
// C. Gerbang / Terlambat — alasan Custom
// ============================================================
test('Terlambat: alasan manual dikirim sebagai teksnya sendiri', () => {
  let recordedType = null;
  const tree = get('RecordModal')({
    student, customReason: 'Ban motor bocor di jalan', setCustomReason: () => {},
    onRecord: (t) => { recordedType = t; }, onClose: () => {}, allLogs: [],
  });
  buttonWithText(tree, 'Simpan').props.onClick();
  assert.equal(recordedType, 'Custom', 'RecordModal menandai jalur custom');

  // handleRecord di app.js yang menerjemahkan 'Custom' jadi teks aslinya.
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(source, /type === 'Custom' \? \(customReasonInput\.trim\(\) \|\| 'Lainnya'\) : type/,
    'teks manual harus dipakai apa adanya, bukan selalu jadi "Lainnya"');
});

test('Terlambat: tombol Simpan custom mati kalau teksnya kosong (tidak mengirim string kosong)', () => {
  const tree = get('RecordModal')({
    student, customReason: '   ', setCustomReason: () => {},
    onRecord: () => {}, onClose: () => {}, allLogs: [],
  });
  assert.equal(buttonWithText(tree, 'Simpan').props.disabled, true);
});

test('Terlambat: alasan manual tampil di riwayat', () => {
  const entry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Ban motor bocor di jalan', logged_by: 'Kartina' };
  const tree = get('FeedItem')({ item: { ...entry, _kind: 'terlambat', _time: new Date() } });
  assert.ok(allText(tree).includes('Ban motor bocor di jalan'));
});

// ============================================================
// D. Surat — keterangan manual
// ============================================================
test('Surat: keterangan manual tampil di kartu riwayat gabungan', () => {
  const item = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis: 'Lainnya', keterangan: 'Ada acara keluarga', logged_by: 'Kartina', _kind: 'surat', _time: new Date() };
  const text = allText(get('FeedItem')({ item }));
  assert.ok(text.includes('Ada acara keluarga'), 'keterangan manual harus terlihat, bukan cuma label preset');
});

test('Surat: tanpa keterangan, kartu tetap rapi (tidak ada pemisah menggantung)', () => {
  const item = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis: 'Sakit', keterangan: '', logged_by: 'Kartina', _kind: 'surat', _time: new Date() };
  const text = allText(get('FeedItem')({ item }));
  assert.ok(text.includes('Sakit'));
  assert.doesNotMatch(text, /Sakit\s+—\s*(\s|$)/);
});

// ============================================================
// E. Bertahan setelah refresh (lewat snapshot klien)
// ============================================================
test('Nilai custom bertahan lewat snapshot: keluar utuh saat di-hydrate ulang', () => {
  const buildClientCache = get('buildClientCache');
  const readClientCache = get('readClientCache');
  const expiresAt = Date.now() + 6 * 60 * 60 * 1000;

  const datasets = {
    allLogs: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Ban motor bocor di jalan', logged_by: 'Kartina' }],
    pelanggaranList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Corat-coret meja kelas', sanksi: 'Bersihkan 3 meja', catatan: 'Sudah minta maaf', logged_by: 'Kartina' }],
    suratList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis: 'Lainnya', keterangan: 'Ada acara keluarga', logged_by: 'Kartina' }],
  };

  const restored = readClientCache(JSON.stringify(buildClientCache('G01', datasets, expiresAt)), 'G01');
  assert.equal(restored.data.allLogs[0].type, 'Ban motor bocor di jalan');
  assert.equal(restored.data.pelanggaranList[0].jenis_pelanggaran, 'Corat-coret meja kelas');
  assert.equal(restored.data.pelanggaranList[0].sanksi, 'Bersihkan 3 meja');
  assert.equal(restored.data.pelanggaranList[0].catatan, 'Sudah minta maaf');
  assert.equal(restored.data.suratList[0].keterangan, 'Ada acara keluarga');
});

// ============================================================
// F. Edit tidak boleh menghapus nilai custom
// ============================================================
test('Edit memakai input teks bebas, jadi nilai custom tidak dipaksa jadi preset', () => {
  const source = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');
  // Modal edit mengisi field dari nilai yang ada sekarang...
  assert.match(source, /setEditType\(item\.type \|\| ''\)/);
  assert.match(source, /setEditJenisPelanggaran\(item\.jenis_pelanggaran \|\| ''\)/);
  assert.match(source, /setEditKeterangan\(item\.keterangan \|\| ''\)/);
  // ...dan mengirimkannya kembali apa adanya.
  assert.match(source, /payload\.type = editType/);
  assert.match(source, /payload\.jenis_pelanggaran = editJenisPelanggaran/);
});
