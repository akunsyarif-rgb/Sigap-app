// ===== tests/gerbang-mode-accent.test.js =====
// Aksen warna per mode Gerbang (terlambat/surat/izin) — GERBANG_MODE_ACCENT di
// gerbang.js. Tujuan: mencegah guru salah mode. Perubahan HANYA visual: tes di
// sini juga menjaga bahwa tombol aksi (Button, Simpan) tidak ikut diwarnai.
// Sandbox sama seperti survey-fixes.test.js: React palsu, komponen anak tidak
// dibuka, useState bisa di-override per indeks posisi.

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


// ================= Aksen warna per mode Gerbang =================

const EXPECTED_HEX = { terlambat: '#9E2F28', surat: '#1F5278', izin: '#2F6B4F' };
const waliKelasMap = [{ class: 'XI B', waliKelasName: 'Kartina', waliKelasId: 'G01' }];
const siswa = { nisn: '111', name: 'Rahma', class: 'XI B' };
const gerbangProps = { students: [siswa], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: false, waliKelasMap, izinList: [], kelompokList: [], canVerifyIzin: false };

function accent() {
  return JSON.parse(JSON.stringify(get('GERBANG_MODE_ACCENT')));
}

// Tiga tab sakelar = satu-satunya tombol di GerbangTab yang memakai aria-pressed.
function tabs(tree) {
  return findAll(tree, (n) => n.type === 'button' && n.props['aria-pressed'] !== undefined);
}

test('GERBANG_MODE_ACCENT: tiga kunci, hex sesuai & berbeda, kelas lengkap memakai hex mode-nya sendiri', () => {
  const a = accent();
  assert.deepEqual(Object.keys(a).sort(), ['izin', 'surat', 'terlambat']);
  const hexes = Object.keys(a).map((k) => a[k].hex);
  assert.equal(new Set(hexes.map((h) => h.toLowerCase())).size, 3, 'hex tiap mode harus berbeda');
  for (const [mode, hex] of Object.entries(EXPECTED_HEX)) {
    assert.equal(a[mode].hex, hex, `hex ${mode}`);
    for (const [key, cls] of Object.entries(a[mode])) {
      if (key === 'hex') continue;
      assert.ok(cls.includes(hex), `${mode}.${key} harus memakai ${hex}`);
      for (const other of Object.values(EXPECTED_HEX)) {
        if (other !== hex) assert.ok(!cls.includes(other), `${mode}.${key} tidak boleh memakai warna mode lain`);
      }
    }
  }
  // Kelas harus ditulis lengkap di sumber (Tailwind CDN memindai nama kelas
  // utuh), bukan dirakit dari hex lewat template string.
  const src = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const blok = src.slice(src.indexOf('const GERBANG_MODE_ACCENT'), src.indexOf('};', src.indexOf('const GERBANG_MODE_ACCENT')));
  assert.ok(!blok.includes('${'), 'tidak boleh ada template string di GERBANG_MODE_ACCENT');
});

test('GerbangTab: tab aktif memakai kelas aksen mode-nya, tab lain netral + titik warna mode; aria-pressed sesuai', () => {
  const a = accent();
  const order = ['terlambat', 'surat', 'izin'];
  for (const mode of order) {
    const t = tabs(render('GerbangTab', gerbangProps, [mode]));
    assert.equal(t.length, 3, 'harus ada tiga tab');
    t.forEach((btn, i) => {
      const m = order[i];
      const cls = btn.props.className;
      assert.match(cls, /\brelative\b/, 'semua tab perlu relative (titik & badge absolute)');
      assert.match(cls, /\bpy-3\.5\b/, 'tap target tetap');
      assert.ok(!/bg-sky text-white/.test(cls), 'kelas aktif lama (blok biru pekat) tidak boleh kembali');
      const dots = findAll(btn, (n) => n.type === 'span' && /rounded-full/.test(n.props.className || '') && /top-1\.5 left-1\.5/.test(n.props.className || ''));
      if (m === mode) {
        assert.ok(cls.includes(a[m].tabActive), `tab aktif ${m} harus memakai aksen ${m}`);
        assert.equal(btn.props['aria-pressed'], true);
        assert.equal(dots.length, 0, 'tab aktif tidak butuh titik');
      } else {
        order.forEach((o) => assert.ok(!cls.includes(a[o].tabActive), `tab tidak aktif ${m} tidak boleh memakai aksen ${o}`));
        assert.match(cls, /\btext-slate-500\b/);
        assert.equal(btn.props['aria-pressed'], false);
        assert.equal(dots.length, 1, `tab tidak aktif ${m} punya satu titik`);
        assert.ok(dots[0].props.className.includes(a[m].dot), `titik ${m} berwarna mode-nya`);
      }
    });
  }
});

test('GerbangTab: titik di kiri atas tidak menggeser badge izinBadge (tetap kanan atas, kelas tidak berubah)', () => {
  const izinList = [{ id: 'IZ1', nisn: '111', name: 'Rahma', class: 'XI B', status: 'Menunggu Verifikasi', timestamp: new Date().toISOString() }];
  const tree = render('GerbangTab', { ...gerbangProps, izinList, canVerifyIzin: true }, ['terlambat']);
  const izinTab = tabs(tree)[2];
  const badge = findAll(izinTab, (n) => n.type === 'span' && /-top-1\.5 -right-1\.5/.test(n.props.className || ''));
  assert.equal(badge.length, 1, 'badge hitungan harus ada');
  assert.match(badge[0].props.className, /bg-crimson text-white/, 'warna badge saat tab tidak aktif tidak berubah');
  const dot = findAll(izinTab, (n) => n.type === 'span' && /top-1\.5 left-1\.5/.test(n.props.className || ''));
  assert.equal(dot.length, 1);
});

test('GerbangTab: kolom cari siswa punya garis kiri warna mode (terlambat vs surat), label tidak berubah', () => {
  const a = accent();
  for (const mode of ['terlambat', 'surat']) {
    const tree = render('GerbangTab', gerbangProps, [mode]);
    const input = findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Ketik nama, kelas, atau NISN...')[0];
    assert.ok(input.props.className.includes(a[mode].searchBorder), `garis kiri ${mode}`);
    assert.match(input.props.className, /border-2 border-slate-200/, 'border lain tetap netral');
    const lain = mode === 'surat' ? 'terlambat' : 'surat';
    assert.ok(!input.props.className.includes(a[lain].searchBorder));
  }
  assert.match(allText(render('GerbangTab', gerbangProps, ['terlambat'])), /Cari siswa untuk mencatat keterlambatan/);
  assert.match(allText(render('GerbangTab', gerbangProps, ['surat'])), /Cari siswa untuk membuat surat/);
});

test('RecordModal & modal Catat Surat Masuk: garis atas + chip judul warna mode, judul teks tetap', () => {
  const a = accent();
  const rec = render('RecordModal', { student: siswa, customReason: '', setCustomReason: () => {}, onRecord: () => {}, onClose: () => {}, allLogs: [] });
  const recCard = findAll(rec, (n) => typeof n.props.className === 'string' && n.props.className.includes('animate-pop'))[0];
  assert.ok(recCard.props.className.includes(a.terlambat.sheetTop));
  const recH3 = findAll(rec, (n) => n.type === 'h3')[0];
  assert.ok(recH3.props.className.includes(a.terlambat.chip));
  assert.match(recH3.props.className, /uppercase tracking-widest/);
  assert.equal(allText(recH3).trim(), 'Catat Keterlambatan');

  // idx 0 mode, 1 searchQuery, 2 pickerStudent, 3 suratStudent
  const surat = render('GerbangTab', gerbangProps, ['surat', undefined, undefined, siswa]);
  const h3 = findAll(surat, (n) => n.type === 'h3' && allText(n).includes('Catat Surat Masuk'))[0];
  assert.ok(h3.props.className.includes(a.surat.chip));
  assert.equal(allText(h3).trim(), 'Catat Surat Masuk');
  const card = findAll(surat, (n) => typeof n.props.className === 'string' && n.props.className.includes('animate-pop my-4'))[0];
  assert.ok(card.props.className.includes(a.surat.sheetTop));
});

test('IzinKeluarTab: kartu info bernada hijau, teks tetap', () => {
  const a = accent();
  const tree = render('IzinKeluarTab', { students: [], izinList: [], kelompokList: [], canVerify: false, waliKelasMap });
  const card = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.includes(a.izin.card));
  assert.equal(card.length, 1);
  assert.ok(!card[0].props.className.includes('sky-dim'), 'nada biru lama sudah diganti');
  assert.match(allText(card[0]), /Izin Keluar/);
  assert.match(allText(card[0]).replace(/\s+/g, ' '), /persetujuan guru dulu, lalu verifikasi Guru Piket/);
});

// ---- Kontrak "hanya visual": tombol aksi tidak ikut diwarnai ----
test('Button & tombol Simpan tidak berubah (aksen tidak menyentuh tombol aksi)', () => {
  const Button = get('Button');
  const primary = render('Button', { children: 'Simpan' });
  assert.equal(primary.props.className, 'font-semibold transition active:scale-95 disabled:opacity-40 disabled:active:scale-100 inline-flex items-center justify-center gap-1.5 bg-sky hover:bg-sky-light text-white shadow-sm py-3.5 px-5 rounded-xl text-sm ');
  const danger = render('Button', { children: 'Hapus', variant: 'danger' });
  assert.match(danger.props.className, /bg-crimson hover:bg-crimson-dim text-white/);

  const surat = render('GerbangTab', gerbangProps, ['surat', undefined, undefined, siswa]);
  const btns = findAll(surat, (n) => n.type === Button);
  const simpan = btns.find((b) => allText(b).trim() === 'Simpan');
  assert.equal(simpan.props.className, 'w-full');
  assert.equal(simpan.props.variant, undefined, 'Simpan tetap varian primary');
  const hex = Object.values(EXPECTED_HEX);
  btns.forEach((b) => hex.forEach((h) => assert.ok(!String(b.props.className || '').includes(h), 'Button tidak boleh memakai aksen mode')));

  const rec = render('RecordModal', { student: siswa, customReason: '', setCustomReason: () => {}, onRecord: () => {}, onClose: () => {}, allLogs: [] });
  const simpanRec = findAll(rec, (n) => n.type === 'button' && allText(n).trim() === 'Simpan')[0];
  assert.equal(simpanRec.props.className, 'bg-sky hover:bg-sky-light disabled:opacity-30 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition');
});
