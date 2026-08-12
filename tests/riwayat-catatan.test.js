// ===== tests/riwayat-catatan.test.js =====
// "Catatan tambahan (opsional)" sempat tersimpan ke Sheet tapi TIDAK PERNAH
// dirender di daftar riwayat Pelanggaran & Pelanggaran Upacara — guru yang
// mengetiknya mengira catatannya hilang, padahal datanya aman di sheet.
//
// Bug seperti ini tidak akan pernah tertangkap render-smoke.test.js: tidak ada
// yang error, komponennya render normal, cuma satu field yang lupa
// ditampilkan. Jadi di sini yang diperiksa isi pohon elemennya, bukan sekadar
// "tidak throw".

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

test.before(() => {
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
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
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
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

function get(name) {
  return vm.runInContext(name, sandbox);
}

// Kumpulkan seluruh teks yang benar-benar sampai ke layar.
function allText(node, out) {
  out = out || [];
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  if (typeof node !== 'object') { out.push(String(node)); return out; }
  allText(node.children, out);
  if (node.props && node.props.children) allText(node.props.children, out);
  return out;
}

const CATATAN = 'Sepatu tidak hitam, sudah ditegur wali kelas';
const ts = new Date().toISOString();

const upacaraEntry = {
  timestamp: ts, nisn: '111', name: 'Rahma', class: 'XI B',
  jenis_pelanggaran: 'Atribut Tidak Lengkap', catatan: CATATAN, logged_by: 'Siswa osis',
};

const pelanggaranEntry = {
  timestamp: ts, nisn: '111', name: 'Rahma', class: 'XI B',
  jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: CATATAN, logged_by: 'Bu Kartina',
};

test('UpacaraTab: catatan tambahan tampil di daftar riwayat', () => {
  const tree = get('UpacaraTab')({ students: [], upacaraList: [upacaraEntry], onAddUpacara: () => {}, isOsis: true });
  const text = allText(tree).join(' ');
  assert.match(text, /Atribut Tidak Lengkap/, 'jenis pelanggaran tetap tampil');
  assert.ok(text.includes(CATATAN), 'catatan tambahan HARUS ikut tampil, bukan cuma tersimpan di sheet');
});

test('UpacaraTab: catatan kosong tidak menyisakan baris kosong', () => {
  const kosong = { ...upacaraEntry, catatan: '' };
  const text = allText(get('UpacaraTab')({ students: [], upacaraList: [kosong], onAddUpacara: () => {}, isOsis: true })).join(' ');
  assert.doesNotMatch(text, /undefined|null/, 'catatan kosong tidak boleh bocor sebagai teks');
});

test('UpacaraTab: catatan yang tidak ada di data lama tidak bikin error', () => {
  const { catatan, ...tanpaCatatan } = upacaraEntry;
  assert.doesNotThrow(() => get('UpacaraTab')({ students: [], upacaraList: [tanpaCatatan], onAddUpacara: () => {}, isOsis: true }));
});

test('PelanggaranTab: catatan tambahan tampil di daftar riwayat', () => {
  const tree = get('PelanggaranTab')({
    students: [], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {},
    canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap: [],
  });
  const text = allText(tree).join(' ');
  assert.match(text, /Teguran Lisan/, 'sanksi tetap tampil');
  assert.ok(text.includes(CATATAN), 'catatan tambahan HARUS ikut tampil');
});

test('BimbinganTab: catatan tetap tampil (tidak ikut rusak)', () => {
  const tree = get('BimbinganTab')({
    bimbinganList: [{ timestamp: ts, nisn: '111', name: 'Rahma', class: 'XI B', catatan: CATATAN, logged_by: 'Bu Kartina' }],
  });
  assert.ok(allText(tree).join(' ').includes(CATATAN));
});
