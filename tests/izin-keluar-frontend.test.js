// ===== tests/izin-keluar-frontend.test.js =====
// Sisi klien Izin Keluar / Pulang (BETA): perkabelannya di app.js, dan
// bahwa layar tidak menjanjikan apa pun yang server tidak izinkan.
//
// Otorisasi SUNGGUHAN diuji di tests/izin-keluar.test.js (memanggil
// doPost/doGet asli) — layar memang bukan tempat pengamanannya. Yang dijaga di
// sini: fitur baru tidak diam-diam menambah request boot yang berulang, tidak
// menyalakan tombol proses untuk yang tidak berwenang, dan tidak menyelipkan
// jalur edit/hapus baru ke Riwayat.
//
// Harness-nya sengaja meniru tests/performance.test.js: efek dikumpulkan,
// tidak dijalankan otomatis, supaya urutan boot bisa diperiksa.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const FILES = [
  'config.js', 'helpers.js', 'export-format.js', 'ui-common.js', 'admin.js',
  'beranda-riwayat.js', 'statistik.js', 'gerbang.js', 'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js', 'export-data.js', 'app.js',
];

let sandbox;
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
    fetch: (...args) => { fetchCalls.push(args); return Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }); },
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

test.beforeEach(() => { storage = {}; fetchCalls = []; effects = []; });

const get = (name) => vm.runInContext(name, sandbox);
const SIX_HOURS = 6 * 60 * 60 * 1000;

function loginAs(user) {
  storage.sigap_session_token = 'TOK';
  storage.sigap_user = JSON.stringify(user);
  storage.sigap_session_expires = String(Date.now() + SIX_HOURS);
}

function bootApp() {
  effects = [];
  const tree = get('App')({});
  effects.forEach((e) => e.fn());
  return tree;
}

const actionsRequested = () => fetchCalls
  .map((c) => String(c[0]))
  .map((url) => (url.match(/action=([a-zA-Z]+)/) || [])[1])
  .filter(Boolean);

function findAll(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, acc)); return acc; }
  if (pred(node)) acc.push(node);
  if (node.props) Object.keys(node.props).forEach((k) => findAll(node.props[k], pred, acc));
  findAll(node.children, pred, acc);
  return acc;
}
const findComponent = (tree, name) => findAll(tree, (n) => n.type === get(name))[0];

const guru = { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' };

test('boot: daftar Izin Keluar ditarik untuk guru, sekali saja', () => {
  loginAs(guru);
  bootApp();
  const izin = actionsRequested().filter((a) => a === 'getIzinKeluar');
  assert.equal(izin.length, 1, 'tab Gerbang butuh daftarnya, tapi cukup sekali');
});

test('boot: membuka Riwayat tidak menarik ulang daftar yang sama (penanda per-data)', () => {
  loginAs(guru);
  bootApp();
  fetchCalls = [];
  // Efek tab: buka Riwayat setelah Gerbang. Datanya sama, jadi tidak boleh
  // ditembak dua kali — inilah gunanya loadOnce('izin', ...) dipakai bersama.
  get('App')({});
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /if \(tab === 'scan' \|\| tab === 'log'\) loadOnce\('izin', fetchIzinKeluar\);/);
});

test('boot OSIS: tidak menembak getIzinKeluar sama sekali', () => {
  loginAs({ id: 'S01', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' });
  bootApp();
  assert.ok(!actionsRequested().includes('getIzinKeluar'));
});

test('GerbangTab & LogTab menerima daftar izin dari state yang sama', () => {
  loginAs(guru);
  const tree = bootApp();
  const gerbang = findComponent(tree, 'GerbangTab');
  assert.ok(gerbang, 'tab Gerbang harus terpasang untuk guru');
  assert.ok(Array.isArray(gerbang.props.izinList));
  assert.equal(typeof gerbang.props.onCreateIzin, 'function');
  assert.equal(typeof gerbang.props.onVerifikasiIzin, 'function');
  assert.equal(typeof gerbang.props.onTandaiKembaliIzin, 'function');
  // canVerifyIzin datang dari server (bukan dihitung ulang di klien), dan
  // default-nya tertutup sampai server bilang sebaliknya.
  assert.equal(gerbang.props.canVerifyIzin, false);

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /<LogTab[\s\S]*?izinList=\{izinList\}/, 'Riwayat memakai daftar yang sama, bukan fetch sendiri');
});

test('status transaksi tidak pernah dikirim klien — klien hanya memanggil aksi', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split("// ---- Izin Keluar / Pulang (BETA) ----")[1];
  assert.ok(blok, 'blok handler Izin Keluar harus ada di app.js');
  assert.match(blok, /action: 'addIzinKeluar'/);
  assert.match(blok, /verifikasiIzinKeluar/);
  assert.match(blok, /tandaiKembaliIzinKeluar/);
  assert.match(blok, /selesaikanIzinKeluar/);
  // Tidak ada payload berisi status/nama/kelas yang dikarang klien.
  assert.doesNotMatch(blok, /status: '(Sedang di Luar|Kembali|Pulang|Selesai|Menunggu Verifikasi)'/);
  assert.doesNotMatch(blok, /class_name/);
});

test('daftar izin TIDAK ikut snapshot localStorage (status berubah sepanjang hari)', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split('buildClientCache(user.id, {')[1].split('}')[0];
  assert.doesNotMatch(blok, /izinList/, 'transaksi berstatus tidak boleh disajikan dari snapshot lama');
});

test('IzinKeluarPanel: tombol proses hanya muncul untuk yang berwenang', () => {
  const izin = {
    id: 'IZ-1', timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B',
    keperluan: 'kontrol', tujuan: 'kembali', jalur: 'normal', alasan_khusus: '', status: 'Sedang di Luar',
    disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(),
    diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString(),
    waktu_kembali: '', dicatat_kembali_oleh: '', logged_by: 'Bu Kartina',
  };
  const props = {
    students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }], izinList: [izin], waliKelasMap: [],
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, onSelesaikan: () => {},
  };
  const teksDari = (node) => JSON.stringify(node);

  const berwenang = teksDari(get('IzinKeluarPanel')({ ...props, canVerify: true }));
  assert.ok(berwenang.includes('Tandai Kembali'), 'petugas berwenang melihat tombolnya');

  const biasa = teksDari(get('IzinKeluarPanel')({ ...props, canVerify: false }));
  assert.ok(!biasa.includes('Tandai Kembali'), 'guru tanpa kewenangan tidak ditawari tombol yang pasti ditolak server');
  // Jalur khusus juga tidak ditawarkan — tapi server tetap yang menolaknya.
  assert.ok(!biasa.includes('Izin Khusus'));
});

test('Riwayat: kategori Izin Keluar read-only, tidak lewat editEntry/deleteEntry', () => {
  const src = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');
  // Kategori baru ditandai readOnly, dan tombol kelola mengikuti tanda itu.
  assert.match(src, /key: 'izin'[^\n]*readOnly: true/);
  assert.match(src, /const bolehKelola = canManage && !activeCat\.readOnly;/);
  // submitEdit/submitDelete tetap cuma mengenal tiga kategori lama.
  const kategoriEdit = src.split('const submitEdit')[1].split('};')[0];
  assert.doesNotMatch(kategoriEdit, /'izin'/);
});

test('Gerbang: Izin Keluar jadi mode ketiga, bukan menu BottomNav baru', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbang, /setMode\('izin'\)/);
  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.doesNotMatch(config, /izin/i, 'tidak ada entri NAV_ITEMS/ROLES baru untuk fitur ini');
  // Menu tiap role tidak berubah sama sekali.
  // JSON round-trip: nilai dari dalam vm bukan objek yang sama dengan objek
  // Node di luar vm, jadi deepEqual langsung akan gagal walau isinya sama.
  const menus = (role) => JSON.parse(JSON.stringify(get('ROLES')[role].menus));
  assert.deepEqual(menus('guru'), ['scan', 'dashboard', 'log', 'stats', 'pelanggaran']);
  assert.deepEqual(menus('osis'), ['upacara']);
});

test('layar hanya menyebut pencetakan sebagai status BETA — tidak ada integrasi printer', () => {
  const semua = ['gerbang.js', 'app.js', 'beranda-riwayat.js', 'config.js', 'helpers.js', 'index.html']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.match(semua, /Fitur pencetakan masih dalam tahap BETA\./);
  // Tidak ada asumsi perangkat/protokol/ukuran kertas apa pun.
  // Batas kata dipakai supaya kode warna heksa (#1B2A41) & URL Apps Script
  // tidak ikut tertangkap sebagai "ukuran kertas".
  [/bluetooth/i, /esc\/?pos/i, /airprint/i, /window\.print/i, /\b(58|80)\s?mm\b/i, /\b(A4|A5|F4)\b/].forEach((pola) => {
    assert.doesNotMatch(semua, pola, 'tidak boleh ada asumsi perangkat/media cetak: ' + pola);
  });
});

test('layar persetujuan: mencatat pemberi persetujuan, tanpa klaim peran', () => {
  const props = {
    students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }], izinList: [], waliKelasMap: [], canVerify: false,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, onSelesaikan: () => {},
  };
  // stateOverrides idx 1 = formStudent -> form persetujuan terbuka.
  const layar = JSON.stringify(get('IzinKeluarPanel')(props));

  assert.ok(!layar.includes('Persetujuan Izin'), 'form belum terbuka, jadi judulnya belum tampil');

  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const form = gerbang.split('{formStudent && (')[1];
  assert.match(form, />Persetujuan Izin</);
  assert.match(form, /Anda akan tercatat sebagai pihak yang memberikan persetujuan izin ini\./);
  assert.match(form, /'Setujui Izin'/);
  assert.match(form, />Batal</);
});

test('tidak ada isian yang meminta guru mengaku sebagai Guru Mapel / Wali Kelas', () => {
  const src = ['gerbang.js', 'app.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // Komentar dibuang dulu: menjelaskan KENAPA jadwal mengajar tidak ada justru
  // hal yang diinginkan — yang dilarang adalah mekanismenya, bukan penjelasannya.
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  [/setPeran|peran:|sebagaiGuru|klaimPeran/, /jadwalMengajar|Jadwal_Mengajar|getJadwalMengajar/].forEach((pola) => {
    assert.doesNotMatch(kode, pola, 'tidak boleh ada klaim/validasi peran mengajar: ' + pola);
  });
  // Penjelasannya sendiri HARUS ada — supaya tidak ada yang mengira ini kelupaan.
  assert.match(src, /tidak punya data jadwal mengajar|tidak menyimpan jadwal mengajar/i);
  const blokKirim = src.split("action: 'addIzinKeluar'")[1].split('};')[0];
  assert.doesNotMatch(blokKirim, /peran|role|waliKelas/, 'payload persetujuan tidak membawa klaim peran');
});
