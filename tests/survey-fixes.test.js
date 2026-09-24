// ===== tests/survey-fixes.test.js =====
// Tindak lanjut survei kepuasan guru (September 2026):
//   1. PasswordField (ui-common.js) — tombol mata lihat/sembunyikan password,
//      dipakai di Login & Ganti Password.
//   2. Rekap Kelas — "Tanggal: ..." di bawah tiap siswa untuk Terlambat,
//      Pelanggaran, Upacara (urut lama ke baru, hari sama digabung "(Nx)").
//   3. Gerbang — teks bantu Izin Keluar yang sempat ditambahkan lalu DICABUT
//      setelah uji di HP (tidak dipakai guru); tes penjaga memastikan tidak
//      muncul lagi.
//
// Sandbox sama seperti login.test.js: React palsu yang cuma mencatat elemen
// (komponen anak TIDAK dibuka), useState bisa di-override per indeks posisi.

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

// ================= 1. PasswordField =================

test('PasswordField: bawaan tersembunyi (type=password), tombol mata "Tampilkan password"', () => {
  const tree = render('PasswordField', { value: 'rahasia', onChange: () => {}, placeholder: 'Password lama', autoComplete: 'current-password', className: 'w-full px-3' });
  const input = findAll(tree, (n) => n.type === 'input')[0];
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.value, 'rahasia');
  assert.equal(input.props.placeholder, 'Password lama', 'prop lain diteruskan apa adanya');
  assert.equal(input.props.autoComplete, 'current-password');
  assert.match(input.props.className, /w-full px-3/, 'className asli tetap dipakai');
  assert.match(input.props.className, /\bpr-12\b/, 'harus ada ruang kanan supaya teks tidak tertimpa ikon');

  const btn = findAll(tree, (n) => n.type === 'button')[0];
  assert.equal(btn.props.type, 'button', 'tombol mata tidak boleh jadi submit form login');
  assert.equal(btn.props['aria-label'], 'Tampilkan password');
  assert.equal(btn.props['aria-pressed'], false);
  assert.equal(typeof btn.props.onClick, 'function');
  assert.equal(btn.props.onTouchStart, undefined, 'jangan pakai onTouchStart (preventDefault membatalkan klik di sebagian HP)');
});

test('PasswordField: saat terbuka, type=text dan label berbalik ke "Sembunyikan password"', () => {
  // idx 0 = visible (satu-satunya useState di PasswordField)
  const tree = render('PasswordField', { value: 'rahasia', onChange: () => {} }, [true]);
  const input = findAll(tree, (n) => n.type === 'input')[0];
  assert.equal(input.props.type, 'text');
  const btn = findAll(tree, (n) => n.type === 'button')[0];
  assert.equal(btn.props['aria-label'], 'Sembunyikan password');
  assert.equal(btn.props['aria-pressed'], true);
});

test('PasswordField: prop type dari pemanggil tidak bisa membuka password', () => {
  const tree = render('PasswordField', { type: 'text', value: 'x', onChange: () => {} });
  assert.equal(findAll(tree, (n) => n.type === 'input')[0].props.type, 'password');
});

test('LoginScreen & ChangePasswordModal: semua kolom password memakai PasswordField', () => {
  const PasswordField = get('PasswordField');
  const rawPassword = (tree) => findAll(tree, (n) => n.type === 'input' && n.props.type === 'password');

  const login = render('LoginScreen', { onLogin: () => {}, loading: false, error: '', password: '', setPassword: () => {}, users: [], usersState: 'loading', onRetryUsers: () => {}, selectedTeacher: null, setSelectedTeacher: () => {} });
  assert.equal(findAll(login, (n) => n.type === PasswordField).length, 1);
  assert.equal(rawPassword(login).length, 0);

  const modal = render('ChangePasswordModal', { onSubmit: () => {}, onClose: () => {} });
  const fields = findAll(modal, (n) => n.type === PasswordField);
  assert.equal(fields.length, 3, 'password lama, baru, konfirmasi');
  assert.deepEqual(fields.map((f) => f.props.autoComplete), ['current-password', 'new-password', 'new-password']);
  assert.equal(rawPassword(modal).length, 0);
});

// ================= 2. Rekap Kelas: tanggal per siswa =================

test('ringkasTanggalKejadian: urut lama ke baru, hari sama digabung (Nx), timestamp kosong dilewati', () => {
  const fn = get('ringkasTanggalKejadian');
  assert.equal(
    fn(['10/09/2026 07:15:00', '2026-08-03T07:00:00', '', '10/09/2026 12:00:00', null]),
    '3 Agu 2026, 10 Sep 2026 (2x)'
  );
  assert.equal(fn([]), '');
  assert.equal(fn(undefined), '');
});

const waliKelasMap = [{ class: 'XI B', waliKelasName: 'Kartina', waliKelasId: 'G01' }];
const students = [
  { nisn: '111', name: 'Rahma', class: 'XI B' },
  { nisn: '222', name: 'Budi', class: 'XI B' },
];
const allLogs = [
  { timestamp: '2026-09-10T07:10:00', nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan' },
  { timestamp: '2026-08-03T07:05:00', nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan' },
  { timestamp: '2026-09-10T07:40:00', nisn: '111', name: 'Rahma', class: 'XI B', type: 'Terlambat bangun' },
];
const pelanggaranList = [
  { timestamp: '15/09/2026 09:00:00', nisn: '222', name: 'Budi', class: 'XI B', jenis_pelanggaran: 'Bolos' },
];
const upacaraList = [
  { timestamp: '2026-09-14T07:30:00', nisn: '222', name: 'Budi', class: 'XI B', jenis_pelanggaran: 'Tidak Tertib' },
  { timestamp: '2026-09-07T07:30:00', nisn: '222', name: 'Budi', class: 'XI B', jenis_pelanggaran: 'Tidak Tertib' },
];

test('RekapKelasTab (wali kelas, periode Semua): "Tanggal:" tampil untuk Terlambat, Pelanggaran, Upacara', () => {
  // idx 0 = period -> 'semua' supaya data lama tidak tersaring "Minggu Ini";
  // idx 1 = expandedClass, bawaan wali kelas = kelasnya sendiri (terbuka).
  const tree = render('RekapKelasTab', { students, allLogs, pelanggaranList, upacaraList, waliKelasMap, isPrivileged: false, myWaliKelas: 'XI B' }, ['semua']);
  const text = allText(tree);
  assert.match(text, /Tanggal:\s*3 Agu 2026, 10 Sep 2026 \(2x\)/, 'terlambat: urut lama->baru, hari sama digabung');
  assert.match(text, /Tanggal:\s*15 Sep 2026/, 'pelanggaran: format dd/MM/yyyy dari Sheet ikut terbaca');
  assert.match(text, /Tanggal:\s*7 Sep 2026, 14 Sep 2026/, 'upacara');
  assert.doesNotMatch(text, /Tanggal:[^T]*\d{1,2}:\d{2}/, 'jam tidak ikut ditampilkan');
});

test('RekapKelasTab: tanggal ikut tersaring periode (Hari Ini -> tidak ada baris Tanggal dari data lama)', () => {
  const tree = render('RekapKelasTab', { students, allLogs, pelanggaranList, upacaraList, waliKelasMap, isPrivileged: false, myWaliKelas: 'XI B' }, ['hari-ini']);
  assert.doesNotMatch(allText(tree), /Tanggal:/);
});

// ================= 3. Gerbang: teks bantu yang dicabut tetap hilang =================

const gerbangProps = { students, allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: false, waliKelasMap, izinList: [], kelompokList: [], canVerifyIzin: false };

test('GerbangTab: teks bantu Izin Keluar yang dicabut tidak muncul lagi (mode Terlambat, Surat, form Surat jenis Izin)', () => {
  for (const mode of ['terlambat', 'surat']) {
    assert.doesNotMatch(allText(render('GerbangTab', gerbangProps, [mode])), /Buka Izin Keluar/, `mode ${mode}`);
  }
  // idx 0 mode, 1 searchQuery, 2 pickerStudent, 3 suratStudent, 4 jenis
  const formIzin = allText(render('GerbangTab', gerbangProps, ['surat', undefined, undefined, students[0], 'Izin'])).replace(/\s+/g, ' ');
  assert.match(formIzin, /Catat Surat Masuk/, 'form Surat harus benar-benar terbuka');
  assert.doesNotMatch(formIzin, /surat izin tidak hadir dari orang tua/);
  assert.doesNotMatch(formIzin, /Buka Izin Keluar/);
});
