// ===== tests/login.test.js =====
// Tes khusus layar Login. Dipisah dari render-smoke.test.js karena di sini
// yang diperiksa bukan cuma "tidak throw", tapi PERILAKU yang pernah rusak
// di lapangan:
//
//   - form login harus bisa disentuh sejak frame pertama, walau daftar nama
//     guru (getLoginUsers) belum/tidak pernah datang;
//   - tidak ada field yang muncul lalu hilang sendiri;
//   - sesi lama yang sudah kedaluwarsa TIDAK boleh dipakai me-render tampilan
//     "sudah login" (ini akar bug "nama sempat muncul lalu hilang");
//   - tap ganda tombol Masuk tidak mengirim dua request login;
//   - guru yang dipilih benar-benar terkirim sebagai teacherId.
//
// Sandbox-nya sama seperti render-smoke.test.js: React palsu yang cuma
// mencatat elemen, bukan renderer sungguhan. Cukup, karena yang diuji adalah
// isi pohon elemen + efek samping fungsi, bukan pikselnya.

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
let stateOverrides = [];
let stateCallIndex = 0;
let storage = {};
let fetchCalls = [];
let fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) });

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
      constructor(props) {
        this.props = props;
        this.state = {};
      }
      setState(patch) {
        this.state = Object.assign({}, this.state, patch);
      }
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
}

test.before(makeSandbox);

test.beforeEach(() => {
  stateOverrides = [];
  stateCallIndex = 0;
  storage = {};
  fetchCalls = [];
  fetchImpl = () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) });
});

function get(name) {
  return vm.runInContext(name, sandbox);
}

// Objek yang lahir di dalam vm punya prototype dari realm lain, jadi
// assert.deepEqual (strict) menolaknya walau isinya sama persis. Normalkan
// dulu lewat JSON supaya yang dibandingkan benar-benar isinya.
function eq(actual, expected, message) {
  assert.deepEqual(actual === undefined ? actual : JSON.parse(JSON.stringify(actual)), expected, message);
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
  if (node.props) {
    // children yang dilewatkan lewat props (jarang, tapi ada di beberapa komponen)
    if (node.props.children) flatten(node.props.children, out);
  }
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

function inputsOfType(node, type) {
  return findAll(node, (n) => n.type === 'input' && n.props.type === type);
}

function submitButton(node) {
  const btns = findAll(node, (n) => n.props && n.props.type === 'submit');
  return btns[0];
}

const USERS = [
  { id: 'G01', name: 'Kartina' },
  { id: 'G02', name: 'Bu Eka' },
  { id: 'G03', name: 'Kasman' },
  { id: 'G04', name: 'Siti Aminah' },
];

const baseProps = {
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

// ---- 1 & 2: layar login langsung bisa dipakai, termasuk saat daftar guru
// masih loading. Tidak ada satu pun field/tombol yang disabled. ----
test('LoginScreen: langsung interaktif saat daftar guru masih loading', () => {
  const tree = render('LoginScreen', { ...baseProps, usersState: 'loading' });

  const pin = inputsOfType(tree, 'password');
  assert.equal(pin.length, 1, 'field PIN harus ada sejak frame pertama');
  assert.notEqual(pin[0].props.disabled, true, 'field PIN tidak boleh disabled saat loading');

  const search = inputsOfType(tree, 'text');
  assert.equal(search.length, 1, 'kotak pencarian nama harus tetap dirender saat loading');
  assert.notEqual(search[0].props.disabled, true, 'kotak pencarian tidak boleh disabled saat loading');

  assert.notEqual(submitButton(tree).props.disabled, true, 'tombol Masuk tidak boleh disabled saat loading');

  // Tidak ada overlay penutup layar (fixed inset-0) yang bisa menelan tap.
  const overlays = findAll(tree, (n) => typeof n.props.className === 'string' && /fixed\s+inset-0/.test(n.props.className));
  assert.equal(overlays.length, 0, 'tidak boleh ada overlay full-screen di layar login');

  assert.match(allText(tree), /Memuat daftar guru/, 'status loading harus diberi tahu, bukan diam');
});

// ---- 5: struktur form sama persis di semua state daftar guru, jadi tidak
// ada field yang tiba-tiba hilang/muncul saat respons datang. ----
test('LoginScreen: struktur form tidak berubah antara loading / ready / error', () => {
  const shape = (state) => {
    const tree = render('LoginScreen', { ...baseProps, usersState: state, users: state === 'ready' ? USERS : [] });
    return {
      pin: inputsOfType(tree, 'password').length,
      search: inputsOfType(tree, 'text').length,
      submit: submitButton(tree) ? 1 : 0,
    };
  };
  const loading = shape('loading');
  eq(shape('ready'), loading);
  eq(shape('error'), loading);
});

// ---- 4: daftar guru gagal dimuat → mode legacy tetap jalan + ada feedback. ----
test('LoginScreen: getLoginUsers gagal → fallback legacy + pesan + tombol coba lagi', () => {
  let retried = 0;
  const tree = render('LoginScreen', { ...baseProps, usersState: 'error', onRetryUsers: () => { retried++; } });

  assert.equal(inputsOfType(tree, 'password').length, 1, 'login password-saja harus tetap tersedia');
  assert.notEqual(submitButton(tree).props.disabled, true);

  const text = allText(tree);
  assert.match(text, /gagal dimuat/i, 'kegagalan harus diberi tahu, tidak diam-diam');
  assert.match(text, /password saja tetap bisa/i);

  const retryBtn = findAll(tree, (n) => n.type === 'button' && /Coba lagi/.test(allText(n)))[0];
  assert.ok(retryBtn, 'harus ada tombol "Coba lagi"');
  retryBtn.props.onClick();
  assert.equal(retried, 1);
});

// ---- 3 & 6: daftar sukses → selector pencarian tampil dan 1-2 huruf bekerja. ----
test('LoginScreen: getLoginUsers sukses → hasil pencarian 1-2 huruf tampil', () => {
  // overrides[0] = state `query` di dalam LoginScreen.
  const tree = render('LoginScreen', { ...baseProps, usersState: 'ready', users: USERS }, ['ka']);
  const text = allText(tree);
  assert.match(text, /Kartina/);
  assert.match(text, /Kasman/);
  assert.doesNotMatch(text, /Siti Aminah/, 'yang tidak cocok tidak boleh ikut tampil');

  const oneChar = render('LoginScreen', { ...baseProps, usersState: 'ready', users: USERS }, ['e']);
  assert.match(allText(oneChar), /Bu Eka/, 'pencarian 1 huruf harus bekerja');
});

test('LoginScreen: tanpa ketikan, daftar hasil tidak dibuka', () => {
  const tree = render('LoginScreen', { ...baseProps, usersState: 'ready', users: USERS }, ['']);
  assert.doesNotMatch(allText(tree), /Kartina/);
});

test('LoginScreen: memilih guru mengirim {id,name} lalu menutup daftar hasil', () => {
  let picked = null;
  const tree = render(
    'LoginScreen',
    { ...baseProps, usersState: 'ready', users: USERS, setSelectedTeacher: (t) => { picked = t; } },
    ['kar']
  );
  const row = findAll(tree, (n) => n.type === 'button' && n.props.type === 'button' && /Kartina/.test(allText(n)))[0];
  assert.ok(row, 'hasil pencarian harus bisa diketuk');
  row.props.onClick();
  eq(picked, { id: 'G01', name: 'Kartina' });

  // Setelah terpilih: nama tampil, daftar hasil tidak ada lagi, PIN tetap ada.
  const after = render('LoginScreen', { ...baseProps, usersState: 'ready', users: USERS, selectedTeacher: { id: 'G01', name: 'Kartina' } }, ['kar']);
  assert.match(allText(after), /Kartina/);
  assert.equal(inputsOfType(after, 'text').length, 0, 'kotak pencarian diganti kartu guru terpilih');
  assert.equal(inputsOfType(after, 'password').length, 1);
  assert.match(allText(after), /Ganti/, 'harus bisa mengganti pilihan');
});

// Bawaan papan ketik = HURUF: yang dibagikan admin ke guru adalah password
// (boleh berhuruf), bukan PIN angka. Sakelar ABC/123 yang dulu ada di sini
// (dua tombol, yang aktif tersorot) sudah DIHAPUS atas permintaan eksplisit --
// guru yang password-nya angka semua tetap bisa ketik lewat tombol angka
// bawaan di keyboard huruf standar.
test('LoginScreen: password memakai keyboard huruf & tap target hasil pencarian nyaman', () => {
  const tree = render('LoginScreen', { ...baseProps, usersState: 'ready', users: USERS }, ['ka']);
  assert.equal(inputsOfType(tree, 'password')[0].props.inputMode, 'text');
  assert.match(inputsOfType(tree, 'password')[0].props.placeholder, /password/i, 'placeholder harus konsisten menyebut password');
  assert.doesNotMatch(allText(tree), /PIN/, 'layar login tidak lagi menyebut PIN sama sekali');

  const rows = findAll(tree, (n) => n.type === 'button' && n.props.type === 'button' && /Kartina|Kasman/.test(allText(n)));
  assert.ok(rows.length >= 2);
  rows.forEach((r) => assert.match(r.props.className, /min-h-\[48px\]/, 'baris hasil harus >=48px tingginya'));
});

test('LoginScreen: role/jabatan tidak pernah ikut tampil', () => {
  const usersWithExtras = [{ id: 'G01', name: 'Kartina', role: 'admin', jabatan: 'Waka Kesiswaan', salt: 'abc', password: 'x' }];
  const tree = render('LoginScreen', { ...baseProps, usersState: 'ready', users: usersWithExtras }, ['ka']);
  const text = allText(tree);
  assert.match(text, /Kartina/);
  assert.doesNotMatch(text, /admin|Waka Kesiswaan|abc/);
});

// ---- filterLoginUsers murni ----
test('filterLoginUsers: case-insensitive, hanya {id,name}, aman untuk input aneh', () => {
  const filterLoginUsers = get('filterLoginUsers');

  eq(filterLoginUsers(USERS, 'KARTINA'), [{ id: 'G01', name: 'Kartina' }]);
  eq(filterLoginUsers(USERS, '  kar  '), [{ id: 'G01', name: 'Kartina' }]);
  eq(filterLoginUsers(USERS, ''), []);
  eq(filterLoginUsers(USERS, null), []);
  eq(filterLoginUsers(undefined, 'ka'), []);
  eq(filterLoginUsers(null, 'ka'), []);
  eq(filterLoginUsers([null, { id: '', name: 'X' }, { id: 'G9' }], 'x'), []);

  // Cocok di awal nama diprioritaskan.
  eq(filterLoginUsers([{ id: '1', name: 'Bu Eka' }, { id: '2', name: 'Ekawati' }], 'eka').map((u) => u.name), ['Ekawati', 'Bu Eka']);

  // Field tambahan dari server dibuang.
  const dirty = [{ id: 'G01', name: 'Kartina', role: 'admin', salt: 'zzz' }];
  eq(Object.keys(filterLoginUsers(dirty, 'ka')[0]).sort(), ['id', 'name']);

  // Batas jumlah hasil.
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'G' + i, name: 'Guru ' + i }));
  assert.equal(filterLoginUsers(many, 'guru').length, 8);
  assert.equal(filterLoginUsers(many, 'guru', 3).length, 3);
});

// ---- filterStudents murni (Gerbang/Pelanggaran/Upacara) ----
// Laporan lapangan: ketik "Ter" memunculkan "Pretty Puteri" (cocok di
// tengah, "pu-TER-i") di ATAS "Terra De Langit Muslim" (cocok di awal
// nama) -- karena sebelumnya cuma .filter() tanpa urutan relevansi.
test('filterStudents: kecocokan paling awal menang, nama/kelas/NISN semua diperiksa', () => {
  const filterStudents = get('filterStudents');

  const students = [
    { nisn: '1', name: 'Pretty Puteri', class: 'XI A' },
    { nisn: '2', name: 'Terra De Langit Muslim', class: 'XI G' },
  ];
  eq(filterStudents(students, 'Ter').map((s) => s.name), ['Terra De Langit Muslim', 'Pretty Puteri']);

  // Cocok di kelas/NISN tetap ikut, diurut sama-sama berdasar posisi.
  const mixed = [
    { nisn: '100', name: 'Rahma', class: 'XI B' },
    { nisn: '200', name: 'Zahra', class: 'X A1' },
  ];
  eq(filterStudents(mixed, 'a1').map((s) => s.name), ['Zahra']);

  eq(filterStudents([], 'apa saja'), []);
  eq(filterStudents(students, ''), []);
  eq(filterStudents(null, 'ter'), []);
  eq(filterStudents(undefined, 'ter'), []);
});

// ---- 7: guru terpilih benar-benar terkirim sebagai teacherId ----
test('buildLoginPayload: teacherId hanya ikut kalau guru dipilih', () => {
  const buildLoginPayload = get('buildLoginPayload');

  eq(buildLoginPayload('1234', { id: 'G01', name: 'Kartina' }, 'TOK'), {
    action: 'login', password: '1234', token: 'TOK', teacherId: 'G01',
  });
  eq(buildLoginPayload('1234', null, 'TOK'), { action: 'login', password: '1234', token: 'TOK' });
  eq(buildLoginPayload('1234', { name: 'Tanpa ID' }, 'TOK'), { action: 'login', password: '1234', token: 'TOK' });
});

// ---- Akar bug: sesi kedaluwarsa tidak boleh dipakai me-render "sudah login" ----
test('loadStoredSession: sesi kedaluwarsa & sesi tanpa stempel ditolak', () => {
  const loadStoredSession = get('loadStoredSession');
  const userJson = JSON.stringify({ id: 'G01', name: 'Kartina', role: 'guru' });

  storage = {};
  eq(loadStoredSession(), { token: null, user: null, expired: false });

  // Sesi masih hidup → dipakai.
  storage = { sigap_session_token: 'T', sigap_user: userJson, sigap_session_expires: String(Date.now() + 60000) };
  const live = loadStoredSession();
  assert.equal(live.token, 'T');
  assert.equal(live.user.name, 'Kartina');
  assert.equal(live.expired, false);

  // Sesi lewat umur → TIDAK dipakai, dan ditandai expired supaya layar login
  // bisa menjelaskan kenapa.
  storage = { sigap_session_token: 'T', sigap_user: userJson, sigap_session_expires: String(Date.now() - 1) };
  eq(loadStoredSession(), { token: null, user: null, expired: true });

  // Sesi dari versi lama (tanpa stempel) → diperlakukan kedaluwarsa.
  storage = { sigap_session_token: 'T', sigap_user: userJson };
  eq(loadStoredSession(), { token: null, user: null, expired: true });

  // JSON rusak tidak boleh melempar.
  storage = { sigap_session_token: 'T', sigap_user: '{bukan json', sigap_session_expires: String(Date.now() + 60000) };
  eq(loadStoredSession(), { token: null, user: null, expired: false });
});

test('App: sesi kedaluwarsa → langsung layar login, bukan tampilan "sudah login"', () => {
  storage = {
    sigap_session_token: 'T',
    sigap_user: JSON.stringify({ id: 'G01', name: 'Kartina', role: 'guru' }),
    sigap_session_expires: String(Date.now() - 1),
  };
  const tree = render('App', {});
  const login = findAll(tree, (n) => n.type === get('LoginScreen'));
  assert.equal(login.length, 1, 'harus render LoginScreen, bukan Header/tab');
  assert.equal(findAll(tree, (n) => n.type === get('Header')).length, 0, 'nama guru tidak boleh sempat tampil di Header');
  assert.match(login[0].props.error, /Sesi sebelumnya sudah berakhir/);
});

// ---- 8 & 9: alur submit login ----
test('App: double tap tombol Masuk hanya mengirim satu request login', async () => {
  let resolveJson;
  fetchImpl = () => new Promise((resolve) => { resolveJson = () => resolve({ json: () => Promise.resolve({ status: 'error', message: 'Password salah!' }) }); });

  const tree = render('App', {});
  const onLogin = findAll(tree, (n) => n.type === get('LoginScreen'))[0].props.onLogin;

  let prevented = 0;
  const evt = { preventDefault: () => { prevented++; } };
  onLogin(evt);
  onLogin(evt);
  onLogin(evt);

  const loginPosts = fetchCalls.filter((c) => c[1] && c[1].method === 'POST');
  assert.equal(loginPosts.length, 1, 'tap ke-2 & ke-3 harus diabaikan selagi request pertama jalan');
  assert.equal(prevented, 3, 'submit form tetap harus dicegah reload halaman');

  // Setelah request selesai, tombol bisa dipakai lagi (PIN salah → coba lagi).
  resolveJson();
  await new Promise((r) => setTimeout(r, 0));
  onLogin(evt);
  assert.equal(fetchCalls.filter((c) => c[1] && c[1].method === 'POST').length, 2);
});

test('App: login sukses menyimpan sesi + stempel kedaluwarsa', async () => {
  const sixHours = 6 * 60 * 60 * 1000;
  fetchImpl = () => Promise.resolve({
    json: () => Promise.resolve({ status: 'success', sessionToken: 'TOK123', user: { id: 'G01', name: 'Kartina', role: 'guru' } }),
  });

  const tree = render('App', {});
  findAll(tree, (n) => n.type === get('LoginScreen'))[0].props.onLogin({ preventDefault: () => {} });
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(storage.sigap_session_token, 'TOK123');
  assert.match(storage.sigap_user, /Kartina/);
  const expires = parseInt(storage.sigap_session_expires, 10);
  assert.ok(expires > Date.now() + sixHours - 5000 && expires <= Date.now() + sixHours, 'stempel kedaluwarsa harus 6 jam ke depan');
});

test('App: daftar guru ditarik tanpa sessionToken (dipanggil sebelum login)', () => {
  // useEffect di-stub di sandbox ini, jadi fungsinya dipanggil lewat props
  // onRetryUsers — sumber fungsinya sama persis (fetchLoginUsers).
  const tree = render('App', {});
  findAll(tree, (n) => n.type === get('LoginScreen'))[0].props.onRetryUsers();

  const call = fetchCalls[fetchCalls.length - 1][0];
  assert.match(call, /action=getLoginUsers/);
  assert.doesNotMatch(call, /sessionToken/, 'endpoint ini memang dipanggil sebelum ada sesi');
});
