// ===== tests/rekap-upacara.test.js =====
// Rekap Pelanggaran Upacara: hak akses, urutan/pengelompokan, filter,
// pencarian, dan janji "fitur bertambah, workflow tidak bertambah rumit".
//
// Hak akses diuji di DUA lapis, karena menyembunyikan tombol saja tidak
// cukup: aturan frontend (siapa melihat tab Rekap) dan aturan server
// (getPelanggaranUpacara di Code.gs) diperiksa terpisah.

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
  'notifikasi.js',
  'app.js',
];

let sandbox;
let stateOverrides = [];
let stateCallIndex = 0;
let storage = {};
let fetchCalls = [];
let effects = [];

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
  }

  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

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
    useEffect: (fn) => { effects.push(fn); },
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
    fetch: (...args) => { fetchCalls.push(String(args[0])); return Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }); },
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
  stateOverrides = [];
  stateCallIndex = 0;
  fetchCalls = [];
  effects = [];
  vm.runInContext('React', sandbox).__resetStore();
});

const get = (name) => vm.runInContext(name, sandbox);

function render(fnName, props, overrides) {
  stateOverrides = overrides || [];
  stateCallIndex = 0;
  return get(fnName)(props);
}
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
// JSX memecah "{a} Pelanggaran • {b} Siswa" jadi beberapa node teks terpisah,
// jadi spasi hasil penggabungan dirapatkan dulu supaya bisa dicocokkan.
const allText = (node) =>
  flatten(node).filter((n) => n.text !== undefined).map((n) => n.text).join(' ').replace(/\s+/g, ' ').trim();
const findAll = (node, pred) => flatten(node).filter((n) => n.type !== undefined && pred(n));
const buttonWithText = (node, label) =>
  findAll(node, (n) => (n.type === 'button' || n.type === get('Button')) && allText(n).trim() === label)[0];

// ⚠️ Waktu fixture WAJIB selalu di masa lalu DAN di dalam bulan berjalan.
// Dulu di sini dipakai jam dinding tetap (07:00/08:00/09:00 "hari ini"),
// padahal periode default RekapUpacara adalah 'bulan-ini' yang membuang
// timestamp MASA DEPAN (`dt >= startOfMonth(now) && dt <= now`). Jadi setiap
// kali suite dijalankan sebelum jam 9 pagi waktu lokal, seluruh fixture ikut
// terbuang dan 8 tes di file ini gagal — bukan karena ada yang rusak, tapi
// karena jam berapa tesnya dijalankan. Runner CI memakai UTC, jadi ini merah
// setiap kali CI jalan lewat tengah malam.
//
// Sekarang waktunya dihitung MUNDUR dari `now`, dan rentangnya dijepit supaya
// tidak pernah jatuh sebelum awal bulan (kasus tepat setelah tanggal 1).
// rank kecil = lebih lama, rank besar = lebih baru; semuanya <= now.
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
const SPAN_MS = Math.min(30 * 60 * 1000, Math.max(0, now.getTime() - monthStart));
const ts = (rank) => new Date(now.getTime() - SPAN_MS + (SPAN_MS * rank) / 4).toISOString();

const UPACARA = [
  { timestamp: ts(3), nisn: '3', name: 'Candra', class: 'XI TEKNIK', jenis_pelanggaran: 'Terlambat Baris', catatan: '', logged_by: 'OSIS A' },
  { timestamp: ts(2), nisn: '1', name: 'Ahmad Fauzan', class: 'XI TEKNIK', jenis_pelanggaran: 'Atribut Tidak Lengkap', catatan: 'Sepatu tidak hitam', logged_by: 'OSIS A' },
  { timestamp: ts(2), nisn: '4', name: 'Dimas', class: 'XI A', jenis_pelanggaran: 'Tidak Tertib', catatan: '', logged_by: 'OSIS B' },
  { timestamp: ts(2), nisn: '2', name: 'Budi', class: 'XI TEKNIK', jenis_pelanggaran: 'Tidak Tertib', catatan: '', logged_by: 'OSIS A' },
  { timestamp: ts(1), nisn: '5', name: 'Fajar', class: 'XI A', jenis_pelanggaran: 'Membawa HP saat upacara', catatan: '', logged_by: 'OSIS B' },
];

// ---- 9: urutan default Kelas -> Nama A-Z -> waktu ----
test('Rekap: urutan default Kelas -> Nama A-Z -> waktu, dikelompokkan per kelas', () => {
  const tree = render('RekapUpacara', { upacaraList: UPACARA });
  const text = allText(tree);

  // XI A muncul sebelum XI TEKNIK (kelas A-Z)
  assert.ok(text.indexOf('XI A') < text.indexOf('XI TEKNIK'), 'kelas harus urut A-Z');
  // Dalam XI TEKNIK: Ahmad -> Budi -> Candra
  assert.ok(text.indexOf('Ahmad Fauzan') < text.indexOf('Budi'), 'nama harus urut A-Z dalam kelas');
  assert.ok(text.indexOf('Budi') < text.indexOf('Candra'));
  // Dalam XI A: Dimas -> Fajar
  assert.ok(text.indexOf('Dimas') < text.indexOf('Fajar'));
});

test('Rekap: ringkasan menghitung pelanggaran, siswa, dan kelas', () => {
  const text = allText(render('RekapUpacara', { upacaraList: UPACARA }));
  assert.match(text, /5 Pelanggaran/);
  assert.match(text, /5 Siswa/);
  assert.match(text, /2 Kelas/);
});

// ---- 8: search siswa ----
test('Rekap: pencarian nama siswa bekerja (case-insensitive)', () => {
  // RekapUpacara: period(0), filterClass(1), filterJenis(2), query(3), showFilter(4)
  const tree = render('RekapUpacara', { upacaraList: UPACARA }, [undefined, undefined, undefined, 'bud']);
  const text = allText(tree);
  assert.ok(text.includes('Budi'));
  assert.ok(!text.includes('Ahmad Fauzan'));
  assert.match(text, /1 Pelanggaran/);
});

// ---- 7: filter kelas ----
test('Rekap: filter kelas bekerja', () => {
  const tree = render('RekapUpacara', { upacaraList: UPACARA }, [undefined, 'XI A']);
  const text = allText(tree);
  assert.ok(text.includes('Dimas') && text.includes('Fajar'));
  assert.ok(!text.includes('Ahmad Fauzan'));
  assert.match(text, /1 Kelas/);
});

test('Rekap: filter jenis bekerja', () => {
  const tree = render('RekapUpacara', { upacaraList: UPACARA }, [undefined, undefined, 'Tidak Tertib']);
  const text = allText(tree);
  assert.ok(text.includes('Budi') && text.includes('Dimas'));
  assert.ok(!text.includes('Candra'));
});

// ---- 10 & 11: custom input tetap terlihat ----
test('Rekap: jenis custom tampil sebagai teksnya, bukan label "Lainnya"', () => {
  const text = allText(render('RekapUpacara', { upacaraList: UPACARA }));
  assert.ok(text.includes('Membawa HP saat upacara'));
  assert.ok(!text.includes('Lainnya'));
});

test('Rekap: catatan tambahan ikut tampil', () => {
  const text = allText(render('RekapUpacara', { upacaraList: UPACARA }));
  assert.ok(text.includes('Sepatu tidak hitam'));
});

test('Rekap: daftar kosong tidak error dan memberi pesan', () => {
  assert.doesNotThrow(() => get('RekapUpacara')({ upacaraList: [] }));
  assert.doesNotThrow(() => get('RekapUpacara')({ upacaraList: undefined }));
  // EmptyState adalah komponen — createElement palsu tidak merendernya, jadi
  // pesannya dibaca dari prop, bukan dari teks anak.
  const kosong = findAll(render('RekapUpacara', { upacaraList: [] }), (n) => n.type === get('EmptyState'))[0];
  assert.ok(kosong, 'harus ada EmptyState saat tidak ada data');
  assert.match(kosong.props.text, /Tidak ada pelanggaran upacara/);
});

// ---- 1,2,3,4: hak akses di frontend ----
test('UpacaraTab: admin/BK/OSIS mendapat sakelar Rekap, guru biasa tidak', () => {
  const base = { students: [], upacaraList: UPACARA, onAddUpacara: () => {}, isOsis: false };

  const denganRekap = allText(render('UpacaraTab', { ...base, canSeeRekap: true }));
  assert.match(denganRekap, /Rekap/, 'yang berhak harus melihat sakelar Rekap');

  const tanpaRekap = allText(render('UpacaraTab', { ...base, canSeeRekap: false }));
  assert.doesNotMatch(tanpaRekap, /\bRekap\b/, 'guru biasa tidak boleh melihat sakelar Rekap');
});

test('UpacaraTab: menekan Rekap menampilkan rekap, bukan menambah menu baru', () => {
  const props = { students: [], upacaraList: UPACARA, onAddUpacara: () => {}, isOsis: true, canSeeRekap: true };
  let tree = render('UpacaraTab', props);
  assert.match(allText(tree), /Catat Pelanggaran Upacara/);

  buttonWithText(tree, 'Rekap').props.onClick();
  tree = rerender('UpacaraTab', props);
  assert.match(allText(tree), /Rekap Pelanggaran Upacara/);

  // RekapUpacara dipasang dengan daftar yang sama — komponen tidak
  // di-render oleh createElement palsu, jadi yang diperiksa propsnya.
  const rekap = findAll(tree, (n) => n.type === get('RekapUpacara'))[0];
  assert.ok(rekap, 'komponen Rekap harus dipasang saat sakelar Rekap aktif');
  assert.equal(rekap.props.upacaraList.length, UPACARA.length);

  // Form Catat tidak ikut tampil bersamaan (satu fokus per layar).
  assert.equal(findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Cari nama, kelas, atau NISN...').length, 0);
});

test('config: tidak ada menu utama baru untuk rekap upacara', () => {
  const ROLES = get('ROLES');
  Object.keys(ROLES).forEach((role) => {
    ROLES[role].menus.forEach((m) => {
      assert.doesNotMatch(m, /rekapupacara|upacara-rekap/i, `menu utama baru terdeteksi di role ${role}`);
    });
  });
  // OSIS tetap hanya punya satu menu.
  assert.deepEqual(JSON.parse(JSON.stringify(ROLES.osis.menus)), ['upacara']);
  // Guru biasa tetap tanpa menu upacara.
  assert.ok(!ROLES.guru.menus.includes('upacara'));
});

// ---- 5: wali kelas lewat Rekap Kelas, bukan menu Upacara ----
test('RekapKelasTab: Upacara muncul sebagai kategori untuk wali kelas', () => {
  const students = [
    { nisn: '1', name: 'Ahmad Fauzan', class: 'XI TEKNIK' },
    { nisn: '2', name: 'Budi', class: 'XI TEKNIK' },
  ];
  const tree = get('RekapKelasTab')({
    students, allLogs: [], pelanggaranList: [],
    upacaraList: UPACARA.filter((u) => u.class === 'XI TEKNIK'),
    waliKelasMap: [{ class: 'XI TEKNIK', waliKelasName: 'Kartina', waliKelasId: 'G01' }],
    isPrivileged: false, myWaliKelas: 'XI TEKNIK',
  });
  const text = allText(tree);
  assert.match(text, /Upacara/, 'kategori Upacara harus ada di kartu kelas');
  assert.ok(text.includes('Ahmad Fauzan'), 'siswa dengan pelanggaran upacara masuk daftar perlu perhatian');
});

test('RekapKelasTab: tanpa data upacara tetap aman (guru lama / prop belum ada)', () => {
  const students = [{ nisn: '1', name: 'Ahmad', class: 'XI TEKNIK' }];
  assert.doesNotThrow(() => get('RekapKelasTab')({
    students, allLogs: [], pelanggaranList: [], upacaraList: undefined,
    waliKelasMap: [], isPrivileged: true, myWaliKelas: '',
  }));
});

// ---- 12 & 13: performa ----
test('Rekap tidak ikut memperlambat boot: upacara tetap lazy untuk admin', () => {
  storage.sigap_session_token = 'TOK';
  storage.sigap_user = JSON.stringify({ id: 'G01', name: 'Kartina', role: 'admin', jabatan: '', waliKelas: '' });
  storage.sigap_session_expires = String(Date.now() + 6 * 60 * 60 * 1000);

  render('App', {});
  effects.forEach((fn) => fn());

  const actions = fetchCalls.map((u) => (u.match(/action=([a-zA-Z]+)/) || [])[1]).filter(Boolean);
  assert.ok(!actions.includes('getPelanggaranUpacara'), 'data upacara tidak boleh ditarik saat boot admin');
});

test('Data upacara ditarik sekali walau dipakai dua tab (Upacara & Rekap Kelas)', () => {
  // loadOnce memakai kunci DATA ('upacara'), bukan kunci tab — kalau kembali
  // ke kunci tab, membuka menu Upacara lalu Rekap Kelas akan menarik dua kali.
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(source, /loadOnce\('upacara', fetchUpacara\)/);
  const occurrences = (source.match(/loadOnce\('upacara', fetchUpacara\)/g) || []).length;
  assert.equal(occurrences, 2, "tab 'upacara' dan 'rekap' harus memakai kunci data yang sama");
});

// ---- 2 & 6: otorisasi server-side ----
test('Code.gs: getPelanggaranUpacara membatasi akses di server, bukan cuma di UI', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const blok = code.split("if (action === 'getPelanggaranUpacara')")[1].split("if (action === 'getAuditLog')")[0];

  // Guru biasa (bukan OSIS/BK, bukan wali kelas) ditolak.
  assert.match(blok, /if \(!\(isOsisRole\(sessionUser\.role\) \|\| isBkRole\(sessionUser\.role\) \|\| upacaraWaliKelas\)\)/);
  assert.match(blok, /Unauthorized/);
  // OSIS & BK dapat seluruh sekolah; sisanya (wali kelas) dibatasi kelasnya.
  assert.match(blok, /seluruhSekolah = isBkRole\(sessionUser\.role\) \|\| isOsisRole\(sessionUser\.role\)/);
  assert.match(blok, /!seluruhSekolah && !sameClass\(u\.class, upacaraWaliKelas\)/);
});

test('Code.gs: OSIS tetap terkunci dari kategori disiplin lain', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const doGet = code.slice(code.indexOf('function doGet'));
  ['getLogs', 'getSurat', 'getPelanggaran', 'getBimbingan', 'getTindakLanjut'].forEach((action) => {
    const idx = doGet.indexOf(`if (action === '${action}')`);
    assert.ok(idx > -1, `${action} harus ada di doGet`);
    const blok = doGet.slice(idx, idx + 400);
    // Dua bentuk yang sama-sama sah: menolak OSIS secara eksplisit, atau
    // allowlist yang hanya mengizinkan BK/admin (OSIS otomatis tertolak).
    assert.match(blok, /isOsisRole\(sessionUser\.role\)|!isBkRole\(sessionUser\.role\)/,
      `${action} harus mengunci OSIS`);
  });
});

// ---- 7A: workflow mencatat tidak bertambah rumit ----
test('Workflow Catat tidak bertambah langkah: form langsung tampil saat tab dibuka', () => {
  const props = { students: [{ nisn: '1', name: 'Ahmad', class: 'XI TEKNIK' }], upacaraList: [], onAddUpacara: () => {}, isOsis: true, canSeeRekap: true };
  const tree = render('UpacaraTab', props);

  // Tampilan awal = Catat, dengan kotak cari siswa siap dipakai.
  const cari = findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Cari nama, kelas, atau NISN...');
  assert.equal(cari.length, 1, 'kotak cari siswa harus langsung ada tanpa klik tambahan');
  assert.notEqual(cari[0].props.disabled, true);
});
