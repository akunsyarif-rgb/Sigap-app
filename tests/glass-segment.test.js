// ===== tests/glass-segment.test.js =====
// Pil kaca bergaya iOS 26 (BottomNav + GlassSegment): posisi pil, status aktif,
// dan KEPUTUSAN di mana animasi ini dipasang / tidak dipasang.
//
// Posisi pil dihitung murni dari indeks (slot flex-1 sama lebar, pil selebar
// satu slot, translateX(indeks * 100%)), jadi cukup dibaca dari style elemen —
// tidak perlu browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let sandbox;

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
  }
  const combined = ['config.js', 'helpers.js', 'export-format.js', 'ui-common.js'].map(read).join('\n');
  const code = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {},
  };
  sandbox = { console, React, window: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: {}, setTimeout, clearTimeout };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'combined.js' });
});

const get = (name) => vm.runInContext(name, sandbox);

function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== 'object') return;
  visit(node);
  walk(node.children, visit);
}
const findAll = (tree, pred) => {
  const out = [];
  walk(tree, (n) => { if (pred(n)) out.push(n); });
  return out;
};
const pill = (tree) => findAll(tree, (n) => n.type === 'span' && /nav-glass-pill/.test(n.props.className || ''))[0];
const buttons = (tree) => findAll(tree, (n) => n.type === 'button');

const ITEMS4 = [
  { key: 'terlambat', label: 'Terlambat' },
  { key: 'pelanggaran', label: 'Pelanggaran' },
  { key: 'surat', label: 'Surat' },
  { key: 'izin', label: 'Izin Keluar' },
];

// ---- GlassSegment ----
test('GlassSegment: pil berada di slot item aktif (translateX = indeks * 100%)', () => {
  ITEMS4.forEach((it, i) => {
    const tree = get('GlassSegment')({ items: ITEMS4, value: it.key, onChange: () => {} });
    const p = pill(tree);
    assert.ok(p, 'pil harus ada');
    assert.equal(p.props.style.transform, `translateX(${i * 100}%)`);
    assert.equal(p.props.style.opacity, 1);
    assert.match(p.props.style.width, /\/ 4\)$/, 'lebar pil = satu dari 4 slot');
  });
});

test('GlassSegment: jumlah slot mengikuti jumlah item (2 dan 3 item)', () => {
  const dua = [{ key: 'catat', label: 'Catat' }, { key: 'rekap', label: 'Rekap' }];
  const tiga = ITEMS4.slice(0, 3);
  assert.match(pill(get('GlassSegment')({ items: dua, value: 'rekap', onChange() {} })).props.style.width, /\/ 2\)$/);
  assert.equal(pill(get('GlassSegment')({ items: dua, value: 'rekap', onChange() {} })).props.style.transform, 'translateX(100%)');
  assert.match(pill(get('GlassSegment')({ items: tiga, value: 'surat', onChange() {} })).props.style.width, /\/ 3\)$/);
  assert.equal(pill(get('GlassSegment')({ items: tiga, value: 'surat', onChange() {} })).props.style.transform, 'translateX(200%)');
});

test('GlassSegment: hanya item aktif yang aria-pressed dan berwarna aksen', () => {
  const tree = get('GlassSegment')({ items: ITEMS4, value: 'surat', onChange: () => {} });
  const bs = buttons(tree);
  assert.equal(bs.length, 4);
  bs.forEach((b, i) => {
    const aktif = ITEMS4[i].key === 'surat';
    assert.equal(b.props['aria-pressed'], aktif);
    assert.equal(/text-sky-dim/.test(b.props.className), aktif);
    assert.doesNotMatch(b.props.className, /bg-sky text-white/, 'blok biru pekat lama tidak boleh kembali');
  });
});

test('GlassSegment: menekan item memanggil onChange dengan key-nya', () => {
  const dipanggil = [];
  const tree = get('GlassSegment')({ items: ITEMS4, value: 'terlambat', onChange: (k) => dipanggil.push(k) });
  buttons(tree)[2].props.onClick();
  assert.deepEqual(dipanggil, ['surat']);
});

test('GlassSegment: nilai yang tidak dikenal menyembunyikan pil, bukan melempar error', () => {
  const tree = get('GlassSegment')({ items: ITEMS4, value: 'tidak-ada', onChange: () => {} });
  assert.equal(pill(tree).props.style.opacity, 0);
});

// ---- BottomNav ----
test('BottomNav: pil mengikuti tab primer aktif dan "Lainnya" menjadi slot terakhir', () => {
  const menus = ['scan', 'dashboard', 'log', 'pelanggaran', 'stats', 'kelola'];
  const primary = ['scan', 'dashboard', 'log', 'pelanggaran'];
  const nav = (activeTab) => get('BottomNav')({ menus, primaryMenus: primary, activeTab, setActiveTab: () => {} });

  assert.equal(pill(nav('scan')).props.style.transform, 'translateX(0%)');
  assert.equal(pill(nav('log')).props.style.transform, 'translateX(200%)');
  // 4 primer + Lainnya = 5 slot; tab sekunder aktif -> slot ke-5 (indeks 4)
  assert.equal(pill(nav('kelola')).props.style.transform, 'translateX(400%)');
  assert.match(pill(nav('kelola')).props.style.width, /\/ 5\)$/);
  // tab di luar menu (mis. "tentang") -> pil disembunyikan
  assert.equal(pill(nav('tentang')).props.style.opacity, 0);
});

test('BottomNav: peran satu menu (OSIS) hanya punya satu slot', () => {
  const tree = get('BottomNav')({ menus: ['upacara'], primaryMenus: ['upacara'], activeTab: 'upacara', setActiveTab: () => {} });
  assert.match(pill(tree).props.style.width, /\/ 1\)$/);
  assert.equal(pill(tree).props.style.transform, 'translateX(0%)');
});

// ---- Keputusan penempatan (jangan dipaksakan ke tempat yang tidak pas) ----
test('GlassSegment dipasang di Riwayat, Statistik, dan Catat/Rekap Upacara', () => {
  assert.match(read('beranda-riwayat.js'), /<GlassSegment items=\{categories\}/);
  assert.match(read('statistik.js'), /<GlassSegment items=\{categories\}/);
  assert.match(read('pelanggaran-bimbingan-upacara.js'), /<GlassSegment items=\{\[\{ key: 'catat'/);
});

test('GlassSegment TIDAK dipasang di Gerbang (warna pembeda per mode) dan chip periode (lebar berbeda)', () => {
  assert.doesNotMatch(read('gerbang.js'), /GlassSegment/, 'mode Gerbang punya sistem aksen sendiri yang dikunci tes lain');
  ['beranda-riwayat.js', 'statistik.js', 'rekap-kelas.js'].forEach((f) => {
    const src = read(f);
    const makeChip = src.match(/PERIOD[A-Z_]*|periods?\s*=\s*\[/);
    assert.ok(src.includes('setPeriod'), `${f} masih punya chip periode`);
    // chip periode tidak boleh dibungkus GlassSegment
    assert.doesNotMatch(src, /<GlassSegment[^>]*setPeriod/, `${f}: chip periode tidak boleh memakai GlassSegment`);
    void makeChip;
  });
});

test('CSS pil kaca ada di index.html dan menghormati prefers-reduced-motion', () => {
  const html = read('index.html');
  assert.match(html, /\.nav-glass-pill\s*\{/);
  assert.match(html, /\.seg-glass-pill\s*\{/);
  assert.match(html, /@keyframes navBounce/);
  assert.match(html, /prefers-reduced-motion: reduce\)\s*\{[\s\S]{0,400}?\.nav-icon-active\s*\{\s*animation:\s*none;/);
});
