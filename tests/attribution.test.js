// ===== tests/attribution.test.js =====
// Atribusi pengembang (footer + halaman "Tentang SIGAP", lihat bagian
// Kredit/Attribution & catatan AppFooter/TentangSigapPage di CLAUDE.md).
// Sandbox React palsu sama seperti render-smoke.test.js/login.test.js — cukup
// untuk memeriksa isi pohon elemen (teks, tombol, onClick), bukan piksel.
//
// Yang dipin di sini:
//   - footer muncul di LoginScreen dan berisi teks atribusi yang benar;
//   - footer TIDAK muncul di halaman kerja (Gerbang, Pelanggaran);
//   - TentangSigapPage berisi seluruh identitas wajib + tombol Kembali;
//   - toggle showTentang di LoginScreen menukar form login (bukan menumpuk
//     keduanya sekaligus);
//   - AppFooter memanggil onOpenTentang saat ditekan;
//   - pengkabelan statis di app.js/config.js: AppFooter hanya dipasang di
//     blok 'dashboard', dan 'tentang' tidak pernah masuk ke `menus` role
//     mana pun (supaya tidak pernah muncul di BottomNav/"Lainnya").

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
    useState: (init) => {
      const idx = stateCallIndex++;
      const val = stateOverrides[idx] !== undefined ? stateOverrides[idx] : typeof init === 'function' ? init() : init;
      return [val, () => {}];
    },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {
      constructor(props) {
        this.props = props;
        this.state = {};
      }
      setState(patch) {
        this.state = Object.assign({}, this.state, patch);
      }
    },
  };
  const ReactDOM = { createRoot: () => ({ render: () => {} }) };

  sandbox = {
    console,
    React,
    ReactDOM,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
    window: {},
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 10)', maxTouchPoints: 0 },
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

function get(name) {
  return vm.runInContext(name, sandbox);
}

function render(fnName, props, overrides) {
  stateOverrides = overrides || [];
  stateCallIndex = 0;
  return get(fnName)(props);
}

// Kumpulkan semua elemen di pohon (elemen palsu {type, props, children}).
function flatten(node, out) {
  out = out || [];
  if (node == null || typeof node === 'boolean') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (typeof node !== 'object') {
    out.push({ text: String(node) });
    return out;
  }
  out.push(node);
  flatten(node.children, out);
  if (node.props && node.props.children) flatten(node.props.children, out);
  return out;
}

function allText(node) {
  return flatten(node)
    .filter((n) => n.text !== undefined)
    .map((n) => n.text)
    .join(' ');
}

function findAll(node, predicate) {
  return flatten(node).filter((n) => n.type !== undefined && predicate(n));
}

const baseLoginProps = {
  onLogin: () => {},
  loading: false,
  error: '',
  password: '',
  setPassword: () => {},
  users: [],
  usersState: 'loading',
  onRetryUsers: () => {},
  selectedTeacher: null,
  setSelectedTeacher: () => {},
};

// ---- AppFooter ----

test('AppFooter: menampilkan teks atribusi ringkas yang benar', () => {
  const tree = render('AppFooter', { onOpenTentang: () => {} });
  const text = allText(tree);
  assert.match(text, /SIGAP v2026\.09/);
  assert.match(text, /Syarif Hidayatullah, S\.Pd\.I\./);
  assert.match(text, /SMAN 2 Tarakan/);
});

test('AppFooter: menekan footer memanggil onOpenTentang', () => {
  let called = false;
  const tree = render('AppFooter', { onOpenTentang: () => { called = true; } });
  const btn = findAll(tree, (n) => n.type === 'button')[0];
  assert.ok(btn, 'footer harus berupa tombol (bisa ditekan)');
  btn.props.onClick();
  assert.equal(called, true);
});

// ---- TentangSigapPage ----

test('TentangSigapPage: memuat seluruh identitas pengembang yang wajib ada', () => {
  const tree = render('TentangSigapPage', { onBack: () => {} });
  const text = allText(tree);
  assert.match(text, /Syarif Hidayatullah, S\.Pd\.I\./);
  assert.match(text, /SMAN 2 Tarakan, Kalimantan Utara/);
  assert.match(text, /Agustus 2026/);
  assert.match(text, /v2026\.09/);
  assert.match(text, /syarifhidayatullah89@guru\.sma\.belajar\.id/);
  assert.match(text, /Tentang SIGAP/);
});

test('TentangSigapPage: tombol Kembali memanggil onBack', () => {
  let called = false;
  const tree = render('TentangSigapPage', { onBack: () => { called = true; } });
  const btn = findAll(tree, (n) => n.type === 'button')[0];
  assert.ok(btn, 'harus ada tombol Kembali');
  btn.props.onClick();
  assert.equal(called, true);
});

// ---- LoginScreen ----
// Catatan: createElement palsu di sandbox ini TIDAK menjalankan badan fungsi
// komponen anak (mis. <AppFooter .../> jadi {type: AppFooter, props, children:
// []} apa adanya, isinya tidak ikut "dirender") -- sama seperti render-smoke.
// test.js menguji NotifikasiOnboardingBanner terpisah, bukan lewat isi teks
// DashboardTab. Jadi yang diperiksa di sini adalah IDENTITAS elemen anak
// (n.type === fungsi AppFooter/TentangSigapPage yang sama persis dari
// sandbox), bukan teks hasil rendernya -- isi AppFooter/TentangSigapPage
// sendiri sudah dipin di atas.

test('LoginScreen: merender AppFooter (footer atribusi) di layar Login', () => {
  const tree = render('LoginScreen', baseLoginProps);
  const AppFooterFn = get('AppFooter');
  const found = findAll(tree, (n) => n.type === AppFooterFn);
  assert.equal(found.length, 1, 'LoginScreen harus merender AppFooter persis sekali');
  assert.equal(typeof found[0].props.onOpenTentang, 'function');
});

test('LoginScreen: toggle Tentang menukar ke TentangSigapPage, BUKAN form login sekaligus', () => {
  // idx 0 = query, idx 1 = showTentang (lihat useState di LoginScreen,
  // ui-common.js) -- override langsung ke true supaya render sudah dalam
  // keadaan "Tentang SIGAP" terbuka.
  const tree = render('LoginScreen', baseLoginProps, [undefined, true]);
  const TentangFn = get('TentangSigapPage');
  const found = findAll(tree, (n) => n.type === TentangFn);
  assert.equal(found.length, 1, 'harus merender TentangSigapPage persis sekali saat showTentang=true');
  const passwordInputs = findAll(tree, (n) => n.type === 'input' && n.props.type === 'password');
  assert.equal(passwordInputs.length, 0, 'form login (field password) tidak boleh ikut dirender saat Tentang terbuka');
});

// ---- Footer tidak muncul di halaman kerja ----

const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
const logEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan', logged_by: 'Bu Kartina' };
const pelanggaranEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: '', logged_by: 'Bu Kartina' };
const suratEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis: 'Sakit', keterangan: '', foto_url: '', logged_by: 'Bu Kartina' };
const waliKelasMap = [{ class: 'XI B', waliKelasName: 'Kartina', waliKelasId: 'G01' }];

test('GerbangTab: tidak menampilkan footer atribusi (halaman kerja)', () => {
  const tree = render('GerbangTab', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap });
  assert.doesNotMatch(allText(tree), /Syarif Hidayatullah/);
  assert.equal(findAll(tree, (n) => n.type === get('AppFooter')).length, 0);
});

test('PelanggaranTab: tidak menampilkan footer atribusi (halaman kerja)', () => {
  const tree = render('PelanggaranTab', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap });
  assert.doesNotMatch(allText(tree), /Syarif Hidayatullah/);
  assert.equal(findAll(tree, (n) => n.type === get('AppFooter')).length, 0);
});

// ---- Pengkabelan statis app.js / config.js ----
// App() sendiri tidak dirender di test manapun (butuh state sesi/data penuh,
// lihat catatan render-smoke.test.js) -- sama seperti pengecekan wiring
// index.html/app.js lain di tests/push-frontend.test.js, ini pengecekan
// statis atas sumbernya, bukan hasil render.

const appJsSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const configJsSource = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');

test('app.js: AppFooter dipasang di blok dashboard, dan tab tentang dirender lewat activeTab', () => {
  assert.match(appJsSource, /activeTab === 'dashboard'[\s\S]{0,2000}<AppFooter onOpenTentang=\{\(\) => navigateTab\('tentang'\)\}/);
  assert.match(appJsSource, /activeTab === 'tentang' && \(\s*<TentangSigapPage onBack=\{\(\) => navigateTab\('dashboard'\)\} \/>/);
});

test("app.js: AppFooter TIDAK dipasang di blok tab kerja manapun (scan/log/pelanggaran/upacara/dst.)", () => {
  const workingTabs = ['scan', 'log', 'stats', 'rekap', 'kelola', 'auditlog', 'pelanggaran', 'bimbingan', 'export', 'upacara', 'notifikasi'];
  for (const tab of workingTabs) {
    const re = new RegExp(`activeTab === '${tab}'[\\s\\S]{0,400}`);
    const m = appJsSource.match(re);
    assert.ok(m, `blok activeTab === '${tab}' harus ditemukan di app.js`);
    assert.doesNotMatch(m[0], /<AppFooter/, `AppFooter tidak boleh muncul di blok tab kerja '${tab}'`);
  }
});

test("config.js: 'tentang' tidak pernah masuk ke `menus` role manapun (tidak boleh muncul di BottomNav/Lainnya)", () => {
  const rolesBlockMatch = configJsSource.match(/const ROLES = \{[\s\S]*?\n\s*\};/);
  assert.ok(rolesBlockMatch, 'blok ROLES harus ditemukan di config.js');
  assert.doesNotMatch(rolesBlockMatch[0], /'tentang'/, "'tentang' tidak boleh ada di daftar menus manapun di ROLES");
});
