// ===== tests/gerbang-mode-accent.test.js =====
// Aksen warna per mode Gerbang (terlambat/surat/izin) — GERBANG_MODE_ACCENT di
// gerbang.js. Tujuan: mencegah guru salah mode. Perubahan HANYA visual: tes di
// sini juga menjaga bahwa tombol aksi (Button, Simpan) tidak ikut diwarnai.
// Sandbox sama seperti survey-fixes.test.js: React palsu, komponen anak tidak
// dibuka, useState bisa di-override per indeks posisi.
//
// Revisi (uji HP, putaran kedua): titik warna di tab tidak aktif dan garis
// kiri 3px di kolom cari DIHAPUS (terbaca sebagai lencana notifikasi / bulan
// sabit kaku) — diganti garis bawah tipis (tab) dan bingkai 1px (kolom cari).
// Lihat CLAUDE.md, bagian "Gerbang mode accents", untuk alasan lengkapnya.

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
// rgba yang harus dipakai tabInactive (garis bawah tipis) — dari hex yang sama.
const EXPECTED_RGBA = { terlambat: 'rgba(158,47,40,0.35)', surat: 'rgba(31,82,120,0.35)', izin: 'rgba(47,107,79,0.35)' };
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

test('GERBANG_MODE_ACCENT: tiga kunci, hex sesuai & berbeda, kelas lengkap memakai warna mode-nya sendiri', () => {
  const a = accent();
  assert.deepEqual(Object.keys(a).sort(), ['izin', 'surat', 'terlambat']);
  const hexes = Object.keys(a).map((k) => a[k].hex);
  assert.equal(new Set(hexes.map((h) => h.toLowerCase())).size, 3, 'hex tiap mode harus berbeda');
  assert.equal(new Set(Object.values(EXPECTED_RGBA)).size, 3, 'rgba tiap mode harus berbeda');
  for (const [mode, hex] of Object.entries(EXPECTED_HEX)) {
    assert.equal(a[mode].hex, hex, `hex ${mode}`);
    // tabInactive dicek lewat rgba (bukan hex) -- garis bawah tipis sengaja
    // pakai rgba eksplisit, bukan token bg-[hex]/opacity, lihat CLAUDE.md.
    assert.ok(a[mode].tabInactive.includes(EXPECTED_RGBA[mode]), `${mode}.tabInactive harus memakai rgba ${mode}`);
    for (const [key, cls] of Object.entries(a[mode])) {
      if (key === 'hex' || key === 'tabInactive') continue;
      assert.ok(cls.includes(hex), `${mode}.${key} harus memakai ${hex}`);
      for (const other of Object.values(EXPECTED_HEX)) {
        if (other !== hex) assert.ok(!cls.includes(other), `${mode}.${key} tidak boleh memakai warna mode lain`);
      }
    }
    for (const [otherMode, rgba] of Object.entries(EXPECTED_RGBA)) {
      if (otherMode !== mode) assert.ok(!a[mode].tabInactive.includes(rgba), `${mode}.tabInactive tidak boleh memakai rgba mode lain`);
    }
  }
  // "dot" (titik) sudah dicabut sepenuhnya dari konstanta.
  Object.values(a).forEach((m) => assert.equal(m.dot, undefined, 'field dot tidak boleh ada lagi'));
  // "searchBorder" (garis kiri 3px) diganti searchFrame (bingkai 1px).
  assert.ok(a.terlambat.searchFrame, 'searchFrame harus ada');
  assert.equal(a.terlambat.searchBorder, undefined, 'searchBorder (garis kiri) tidak boleh ada lagi');
  // Kelas harus ditulis lengkap di sumber (Tailwind CDN memindai nama kelas
  // utuh), bukan dirakit dari hex lewat template string.
  const src = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const blok = src.slice(src.indexOf('const GERBANG_MODE_ACCENT'), src.indexOf('};', src.indexOf('const GERBANG_MODE_ACCENT')));
  assert.ok(!blok.includes('${'), 'tidak boleh ada template string di GERBANG_MODE_ACCENT');
});

test('GerbangTab: tab aktif TIDAK berubah (kelas lama persis sama); tab tidak aktif pakai garis bawah tipis, BUKAN titik', () => {
  const a = accent();
  const order = ['terlambat', 'surat', 'izin'];
  for (const mode of order) {
    const t = tabs(render('GerbangTab', gerbangProps, [mode]));
    assert.equal(t.length, 3, 'harus ada tiga tab');
    t.forEach((btn, i) => {
      const m = order[i];
      const cls = btn.props.className;
      assert.match(cls, /\brelative\b/, 'semua tab perlu relative (badge izinBadge absolute)');
      assert.match(cls, /\bpy-3\.5\b/, 'tap target tetap');
      assert.ok(!/bg-sky text-white/.test(cls), 'kelas aktif lama (blok biru pekat) tidak boleh kembali');
      // Titik/lencana DIHAPUS total -- tidak boleh ada span rounded-full
      // absolut di pojok kiri atas tab mana pun, aktif atau tidak.
      const dots = findAll(btn, (n) => n.type === 'span' && /rounded-full/.test(n.props.className || '') && /top-1\.5 left-1\.5/.test(n.props.className || ''));
      assert.equal(dots.length, 0, `tab ${m}: tidak boleh ada elemen titik/lencana`);
      if (m === mode) {
        // Tab AKTIF: kelas persis sama seperti sebelum revisi ini -- tidak berubah.
        assert.equal(cls, `relative py-3.5 px-2 rounded-xl text-xs font-bold transition ${a[m].tabActive}`);
        assert.equal(btn.props['aria-pressed'], true);
      } else {
        order.forEach((o) => assert.ok(!cls.includes(a[o].tabActive), `tab tidak aktif ${m} tidak boleh memakai aksen ${o}`));
        assert.match(cls, /\btext-slate-500\b/, 'teks tab tidak aktif tetap netral, tidak dinuansai');
        assert.equal(btn.props['aria-pressed'], false);
        assert.ok(cls.includes(a[m].tabInactive), `tab tidak aktif ${m} harus memakai garis bawah tipis mode-nya`);
        order.forEach((o) => { if (o !== m) assert.ok(!cls.includes(a[o].tabInactive), `tab ${m} tidak boleh memakai garis bawah mode lain (${o})`); });
      }
    });
  }
});

test('GerbangTab: badge izinBadge di tab Izin Keluar sama sekali tidak berubah (tetap kanan atas, tanpa titik di kiri)', () => {
  const izinList = [{ id: 'IZ1', nisn: '111', name: 'Rahma', class: 'XI B', status: 'Menunggu Verifikasi', timestamp: new Date().toISOString() }];
  const tree = render('GerbangTab', { ...gerbangProps, izinList, canVerifyIzin: true }, ['terlambat']);
  const izinTab = tabs(tree)[2];
  const badge = findAll(izinTab, (n) => n.type === 'span' && /-top-1\.5 -right-1\.5/.test(n.props.className || ''));
  assert.equal(badge.length, 1, 'badge hitungan harus ada');
  assert.match(badge[0].props.className, /bg-crimson text-white/, 'warna badge saat tab tidak aktif tidak berubah');
  assert.equal(allText(badge[0]).trim(), '1');
  // Tidak ada elemen titik di pojok kiri sama sekali sekarang.
  const dot = findAll(izinTab, (n) => n.type === 'span' && /top-1\.5 left-1\.5/.test(n.props.className || ''));
  assert.equal(dot.length, 0, 'titik sudah dicabut, tidak ada lagi elemen di pojok kiri atas');
});

test('GerbangTab: kolom cari siswa punya bingkai 1px warna mode (terlambat vs surat), TANPA garis kiri 3px, label tidak berubah', () => {
  const a = accent();
  for (const mode of ['terlambat', 'surat']) {
    const tree = render('GerbangTab', gerbangProps, [mode]);
    const input = findAll(tree, (n) => n.type === 'input' && n.props.placeholder === 'Ketik nama, kelas, atau NISN...')[0];
    const cls = input.props.className;
    assert.ok(cls.includes(a[mode].searchFrame), `bingkai 1px ${mode}`);
    assert.doesNotMatch(cls, /border-l-\[3px\]/, 'garis kiri 3px (percobaan pertama) tidak boleh ada lagi');
    assert.doesNotMatch(cls, /\bborder-2\b/, 'lebar border netral lama (border-2) harus dilepas supaya tidak bentrok dengan bingkai 1px');
    assert.doesNotMatch(cls, /border-slate-200/, 'warna border netral lama harus dilepas -- bingkai sekarang bernuansa mode');
    const lain = mode === 'surat' ? 'terlambat' : 'surat';
    assert.ok(!cls.includes(a[lain].searchFrame));
    // Kelas focus dibiarkan seperti semula (focus:border-sky) -- pilihan
    // paling sederhana, lihat CLAUDE.md/laporan.
    assert.match(cls, /focus:border-sky/, 'kelas focus tidak diubah');
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
