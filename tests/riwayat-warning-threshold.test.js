// ===== tests/riwayat-warning-threshold.test.js =====
// Peringatan riwayat (Surat & Pelanggaran) yang muncul saat guru mencatat --
// lihat RIWAYAT_WARNING_THRESHOLD di config.js untuk kenapa ambangnya harus
// satu tempat, dan komentar di gerbang.js/pelanggaran-bimbingan-upacara.js
// untuk lokasi tampilnya. Yang dipin di sini:
//   - 0..threshold-1 catatan sebelumnya -> peringatan TIDAK tampil sama sekali
//   - >= threshold -> peringatan tampil
//   - mengubah RIWAYAT_WARNING_THRESHOLD di config.js mengubah PERILAKU
//     sungguhan (bukti bahwa hanya ada SATU angka yang mengatur ini, bukan
//     tersebar), tanpa perlu mengubah kode di gerbang.js/pelanggaran-*.js
//   - peringatan tidak pernah memblokir Simpan (non-blocking)

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

let babel;
try {
  babel = require('@babel/core');
} catch (e) {
  throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
}

const COMBINED_SOURCE = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const THRESHOLD_DECL = /const RIWAYAT_WARNING_THRESHOLD = \d+;/;

// Bangun satu sandbox VM terisolasi, opsional dengan RIWAYAT_WARNING_THRESHOLD
// yang ditimpa (untuk membuktikan angka itu benar-benar satu-satunya sumber
// kebenaran, bukan dicek lewat cara lain). Setiap sandbox punya store useState
// sendiri (bukan berbagi module-level state seperti custom-input.test.js) --
// supaya sandbox threshold=3 (default) dan threshold lain tidak saling
// mempengaruhi kalau dijalankan berdampingan.
function buildSandbox(thresholdOverride) {
  let source = COMBINED_SOURCE;
  if (thresholdOverride !== undefined) {
    assert.match(source, THRESHOLD_DECL, 'RIWAYAT_WARNING_THRESHOLD harus dideklarasikan persis "const RIWAYAT_WARNING_THRESHOLD = <angka>;" di config.js');
    source = source.replace(THRESHOLD_DECL, `const RIWAYAT_WARNING_THRESHOLD = ${thresholdOverride};`);
  }
  const transformed = babel.transformSync(source, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  let store = [];
  let stateOverrides = [];
  let stateCallIndex = 0;

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

  const sandbox = {
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

  const get = (name) => vm.runInContext(name, sandbox);

  return {
    get,
    setOverrides: (overrides) => { stateOverrides = overrides; },
    // Render ulang komponen yang sama sambil mempertahankan store (meniru
    // re-render React setelah setState) -- pola yang sama dengan
    // custom-input.test.js.
    rerender: (fnName, props) => { stateCallIndex = 0; return get(fnName)(props); },
  };
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
// {count}x jadi tiga simpul teks terpisah lewat JSX ("Sudah ", "4", "x tercatat
// sebelumnya") -- allText() menggabungkannya dengan spasi tambahan di antara
// tiap simpul, jadi "Sudah 4x ..." di JSX terlihat "Sudah  4 x ..." di sini.
// Regex ini yang menoleransi spasi ekstra itu, bukan longgar terhadap ANGKA-nya.
const sudahTercatatSebelumnya = (count) => new RegExp(`Sudah\\s*${count}\\s*x tercatat sebelumnya`);
const findAll = (node, pred) => flatten(node).filter((n) => n.type !== undefined && pred(n));
const buttonWithText = (sb, node, label) =>
  findAll(node, (n) => (n.type === 'button' || n.type === sb.get('Button')) && allText(n).trim() === label)[0];

const student = { nisn: '111', name: 'Rahma', class: 'XI B' };

function suratEntries(n, nisn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ timestamp: new Date().toISOString(), nisn, name: 'Rahma', class: 'XI B', jenis: 'Sakit', keterangan: '', logged_by: 'Bu Kartina' });
  }
  return out;
}
function pelanggaranEntries(n, nisn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ timestamp: new Date().toISOString(), nisn, name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: '', logged_by: 'Bu Kartina' });
  }
  return out;
}

const gerbangProps = (suratList) => ({
  students: [student], allLogs: [], pelanggaranList: [], onSelectLate: () => {},
  suratList, onAddSurat: () => {}, isAdminUser: false, waliKelasMap: [],
  izinList: [], kelompokList: [], canVerifyIzin: false,
  onCreateIzin: () => {}, onVerifikasiIzin: () => {}, onTandaiKembaliIzin: () => {}, onTandaiPulangIzin: () => {},
  onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {},
  myWaliKelas: '', onGenerateSurat: () => {},
});

// GerbangTab useState order: mode(0) searchQuery(1) pickerStudent(2)
// suratStudent(3) jenis(4) keterangan(5) msg(6) savingSurat(7) now(8) msgTone(9)
const overridesForSuratStudent = (s) => [undefined, undefined, undefined, s];

const pelanggaranProps = (pelanggaranList, canSeeClassDetail) => ({
  students: [student], pelanggaranList, onAddPelanggaran: () => {}, onAddBimbingan: () => {},
  canSeeClassDetail, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap: [],
});

// PelanggaranTab useState order: searchQuery(0) selectedStudent(1) jenis(2)
// jenisCustom(3) sanksi(4) sanksiCustom(5) catatan(6) msg(7) bimbinganTarget(8)
// bimbinganCatatan(9) sortMode(10) otherTotalCount(11)
const overridesForSelectedStudent = (s) => [undefined, s];
const overridesForOtherTotalCount = (s, count) => {
  const arr = [undefined, s];
  arr[11] = count;
  return arr;
};

// ============================================================
// A. Surat (GerbangTab)
// ============================================================
test('Surat: 0 catatan sebelumnya -> peringatan tidak tampil', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSuratStudent(student));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(0, '111')));
  assert.doesNotMatch(allText(tree), /tercatat sebelumnya/);
});

test('Surat: 1-2 catatan sebelumnya (di bawah ambang) -> peringatan tidak tampil', () => {
  const sb = buildSandbox();
  [1, 2].forEach((n) => {
    sb.setOverrides(overridesForSuratStudent(student));
    const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(n, '111')));
    assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, `${n} catatan belum boleh memicu peringatan`);
  });
});

test('Surat: tepat 3 catatan (ambang default) -> peringatan tampil', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSuratStudent(student));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(3, '111')));
  assert.match(allText(tree), sudahTercatatSebelumnya(3));
});

test('Surat: 4+ catatan (di atas ambang) -> peringatan tampil', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSuratStudent(student));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(5, '111')));
  assert.match(allText(tree), sudahTercatatSebelumnya(5));
});

test('Surat: peringatan tidak pernah memblokir Simpan (non-blocking)', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSuratStudent(student));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(5, '111')));
  const simpanBtn = buttonWithText(sb, tree, 'Simpan');
  assert.ok(simpanBtn, 'tombol Simpan harus tetap ada walau peringatan tampil');
  assert.notEqual(simpanBtn.props.disabled, true, 'Simpan tidak boleh disabled hanya karena riwayat panjang');
});

test('Surat: peringatan hanya menghitung riwayat siswa yang sedang dibuka (tidak bocor ke siswa lain)', () => {
  const sb = buildSandbox();
  const suratList = [...suratEntries(4, '111'), ...suratEntries(1, '222')];
  sb.setOverrides(overridesForSuratStudent({ nisn: '222', name: 'Budi', class: 'XI A' }));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratList));
  assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, 'siswa 222 baru 1 catatan, belum boleh memicu peringatan');
});

// ============================================================
// B. Pelanggaran (PelanggaranTab) — canSeeClassDetail (admin/BK/wali kelas)
// ============================================================
test('Pelanggaran (detail): 0-2 catatan -> peringatan tidak tampil', () => {
  const sb = buildSandbox();
  [0, 1, 2].forEach((n) => {
    sb.setOverrides(overridesForSelectedStudent(student));
    const tree = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(n, '111'), true));
    assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, `${n} catatan belum boleh memicu peringatan`);
  });
});

test('Pelanggaran (detail): tepat 3 (ambang default) -> peringatan tampil', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSelectedStudent(student));
  const tree = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(3, '111'), true));
  assert.match(allText(tree), sudahTercatatSebelumnya(3));
});

test('Pelanggaran (detail): 4+ -> peringatan tampil', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSelectedStudent(student));
  const tree = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(6, '111'), true));
  assert.match(allText(tree), sudahTercatatSebelumnya(6));
});

test('Pelanggaran (detail): peringatan tidak memblokir Simpan', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForSelectedStudent(student));
  const tree = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(6, '111'), true));
  const simpanBtn = buttonWithText(sb, tree, 'Simpan');
  assert.ok(simpanBtn);
  // Simpan disabled hanya kalau jenis/sanksi belum dipilih -- bukan karena riwayat.
  assert.equal(simpanBtn.props.disabled, true, 'tetap disabled karena jenis/sanksi belum dipilih di test ini (bukan karena peringatan)');
  // Buktikan alasannya benar-benar jenis/sanksi, bukan peringatan: begitu
  // keduanya dipilih, Simpan langsung aktif walau peringatan tetap tampil.
  const jenisBtn = buttonWithText(sb, tree, 'Bolos');
  jenisBtn.props.onClick();
  let tree2 = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(6, '111'), true));
  buttonWithText(sb, tree2, 'Teguran Lisan').props.onClick();
  tree2 = sb.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(6, '111'), true));
  assert.match(allText(tree2), sudahTercatatSebelumnya(6), 'peringatan tetap tampil');
  assert.notEqual(buttonWithText(sb, tree2, 'Simpan').props.disabled, true, 'Simpan aktif begitu jenis & sanksi terisi, peringatan tidak menahannya');
});

// ============================================================
// C. Pelanggaran (PelanggaranTab) — guru biasa (bukan wali kelas), hitungan
//    total dari server (otherTotalCount), bukan pelanggaranList lokal.
// ============================================================
test('Pelanggaran (guru biasa): total 0-2 -> peringatan tidak tampil', () => {
  const sb = buildSandbox();
  [0, 1, 2].forEach((n) => {
    sb.setOverrides(overridesForOtherTotalCount(student, n));
    const tree = sb.rerender('PelanggaranTab', pelanggaranProps([], false));
    assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, `total ${n} belum boleh memicu peringatan`);
  });
});

test('Pelanggaran (guru biasa): total >= 3 -> peringatan tampil (dengan label "oleh guru mana pun")', () => {
  const sb = buildSandbox();
  sb.setOverrides(overridesForOtherTotalCount(student, 4));
  const tree = sb.rerender('PelanggaranTab', pelanggaranProps([], false));
  const text = allText(tree);
  assert.match(text, sudahTercatatSebelumnya(4));
  assert.match(text, /oleh guru mana pun/);
});

// ============================================================
// D. Threshold benar-benar terpusat: mengubah RIWAYAT_WARNING_THRESHOLD di
//    config.js (bukan di gerbang.js/pelanggaran-*.js) mengubah perilaku
//    keduanya sekaligus, tanpa perlu menyentuh kode lain.
// ============================================================
test('Konfigurasi threshold diubah (3 -> 5): Surat & Pelanggaran ikut memakai ambang baru', () => {
  // Sandbox TERPISAH per komponen -- store useState berbagi indeks lintas
  // panggilan pada satu sandbox yang sama; me-render GerbangTab lalu
  // PelanggaranTab di sandbox yang SAMA akan membuat hook PelanggaranTab
  // salah membaca sisa store milik GerbangTab (bukan komponen sungguhan,
  // cuma harness pengujian -- lihat catatan store di buildSandbox).
  const sbGerbang = buildSandbox(5);
  const sbPelanggaran = buildSandbox(5);

  // 4 catatan: di bawah ambang baru (5) -> tidak tampil, walau dulunya (default 3) akan tampil.
  sbGerbang.setOverrides(overridesForSuratStudent(student));
  let tree = sbGerbang.rerender('GerbangTab', gerbangProps(suratEntries(4, '111')));
  assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, 'threshold baru = 5, 4 catatan belum boleh memicu peringatan Surat');

  sbPelanggaran.setOverrides(overridesForSelectedStudent(student));
  tree = sbPelanggaran.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(4, '111'), true));
  assert.doesNotMatch(allText(tree), /tercatat sebelumnya/, 'threshold baru = 5, 4 catatan belum boleh memicu peringatan Pelanggaran');

  // 5 catatan: tepat di ambang baru -> tampil. Override ulang lalu render lagi
  // (bukan reuse tree di atas) supaya store-nya konsisten dengan jumlah baru.
  sbGerbang.setOverrides(overridesForSuratStudent(student));
  tree = sbGerbang.rerender('GerbangTab', gerbangProps(suratEntries(5, '111')));
  assert.match(allText(tree), sudahTercatatSebelumnya(5));

  sbPelanggaran.setOverrides(overridesForSelectedStudent(student));
  tree = sbPelanggaran.rerender('PelanggaranTab', pelanggaranProps(pelanggaranEntries(5, '111'), true));
  assert.match(allText(tree), sudahTercatatSebelumnya(5));
});

test('Konfigurasi threshold diubah (3 -> 1): 1 catatan pun langsung memicu peringatan', () => {
  const sb = buildSandbox(1);
  sb.setOverrides(overridesForSuratStudent(student));
  const tree = sb.rerender('GerbangTab', gerbangProps(suratEntries(1, '111')));
  assert.match(allText(tree), sudahTercatatSebelumnya(1));
});

test('RIWAYAT_WARNING_THRESHOLD default bernilai 3 (dokumentasi tugas ini)', () => {
  const sb = buildSandbox();
  assert.equal(sb.get('RIWAYAT_WARNING_THRESHOLD'), 3);
});
