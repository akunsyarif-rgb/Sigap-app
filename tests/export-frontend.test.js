// ===== tests/export-frontend.test.js =====
// Sisi klien fitur Export Data:
// 1. BERKAS — PDF & XLSX dibuat sendiri (tanpa pustaka luar, lihat komentar di
//    export-format.js), jadi kebenaran strukturnya wajib diuji: PDF diperiksa
//    sampai ke tabel xref-nya, XLSX dibongkar ulang sebagai ZIP di test ini
//    (metode "store", jadi isinya bisa dibaca tanpa dependency apa pun) lalu
//    XML sheet-nya dicocokkan.
// 2. LAYAR — daftar pilihan di ExportTab hanya boleh mencerminkan aturan
//    server. Yang diuji di sini: cerminnya tidak melenceng (jenis laporan
//    sinkron dengan EXPORT_JENIS di Utils.gs), wali kelas tidak bisa memilih
//    kelas lain, dan gating menu di app.js/config.js.
//
// Otorisasi SUNGGUHAN diuji di tests/export-backend.test.js — layar ini
// memang bukan tempat pengamanannya.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

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
  'app.js',
];

let sandbox;
let stateOverrides = [];
let stateCallIndex = 0;
let downloads = [];
let storage = {};

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
    useEffect: () => {},
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
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }),
    // Blob palsu menyimpan byte-nya supaya downloadBytes() bisa diperiksa.
    Blob: function (parts, opts) { this.parts = parts; this.type = (opts || {}).type; downloads.push(this); },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout,
    clearTimeout,
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

test.beforeEach(() => {
  stateOverrides = [];
  stateCallIndex = 0;
  downloads = [];
  storage = {};
  vm.runInContext('React', sandbox).__resetStore();
});

const get = (name) => vm.runInContext(name, sandbox);

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
const allText = (node) => flatten(node).filter((n) => n.text !== undefined).map((n) => n.text).join(' ').replace(/\s+/g, ' ').trim();
const findAll = (node, pred) => flatten(node).filter((n) => n.type !== undefined && pred(n));
const buttonWithText = (node, label) =>
  findAll(node, (n) => (n.type === 'button' || n.type === get('Button')) && allText(n).trim() === label)[0];

// ---- Laporan contoh, bentuknya persis seperti yang dikirim Code.gs ----
const report = (over) => Object.assign({
  jenis: 'pelanggaran',
  jenisLabel: 'Pelanggaran',
  judul: 'LAPORAN PELANGGARAN',
  sekolah: 'SMAN 2 Tarakan',
  columns: ['Tanggal', 'Nama', 'Kelas', 'Jenis Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat Oleh'],
  rows: [
    ['08/01/2026', 'Rahma', 'XI A', 'Atribut', 'Teguran Lisan', 'dasi & <topi>', 'Bu Kartina'],
    ['09/01/2026', 'Budi (kelas "B")', 'XI B', 'Bolos', 'Panggilan Ortu', '', 'Pak Anwar'],
  ],
  total: 2,
  periodeLabel: '01/01/2026 - 31/01/2026',
  scopeLabel: 'XI A',
  dibuatPada: '24/08/2026 09:30',
}, over || {});

const bytesToBuffer = (bytes) => Buffer.from(bytes);
const asLatin1 = (bytes) => bytesToBuffer(bytes).toString('latin1');

// ---- Pembaca ZIP minimal (khusus entri "store", tanpa dependency) ----
function readZip(bytes) {
  const buf = bytesToBuffer(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > -1, 'EOCD (akhir arsip ZIP) harus ada');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, 'signature central directory');
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    assert.equal(method, 0, 'entri disimpan tanpa kompresi (store)');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.slice(dataStart, dataStart + size);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `CRC32 entri ${name} harus cocok`);
    files[name] = data.toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ================= FORMAT: PDF =================

test('PDF: struktur berkas sah (header, objek, tabel xref, EOF)', () => {
  const bytes = get('buildPdfBytes')(report());
  const text = asLatin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4'), 'harus diawali penanda PDF');
  assert.ok(text.trimEnd().endsWith('%%EOF'));

  // Setiap offset di tabel xref harus benar-benar menunjuk ke awal objeknya —
  // ini yang membedakan "PDF yang kebetulan mirip" dari PDF yang bisa dibuka.
  const startxref = parseInt(text.slice(text.lastIndexOf('startxref') + 9).trim(), 10);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const lines = text.slice(startxref).split('\n');
  const count = parseInt(lines[1].split(' ')[1], 10);
  for (let n = 1; n < count; n++) {
    const off = parseInt(lines[1 + n + 1].slice(0, 10), 10);
    assert.equal(text.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `offset objek ${n} harus tepat`);
  }
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/BaseFont \/Helvetica\b/);
  assert.match(text, /\/BaseFont \/Helvetica-Bold/);
});

test('PDF: kop laporan memuat identitas, judul, periode, cakupan, jumlah & tanggal cetak', () => {
  const text = asLatin1(get('buildPdfBytes')(report()));
  assert.match(text, /SIGAP - SMAN 2 Tarakan/);
  assert.match(text, /LAPORAN PELANGGARAN/);
  assert.match(text, /Periode      : 01\/01\/2026 - 31\/01\/2026/);
  assert.match(text, /Kelas\/Cakupan: XI A/);
  assert.match(text, /Jumlah Record: 2/);
  assert.match(text, /Dibuat       : 24\/08\/2026 09:30/);
  assert.match(text, /Halaman 1 dari 1/);
  // Header tabel & isi baris ikut tercetak.
  assert.match(text, /\(Jenis Pelanggaran\) Tj/);
  assert.match(text, /\(Rahma\) Tj/);
  assert.match(text, /\(Teguran Lisan\) Tj/);
});

test('PDF: data panjang dipecah ke beberapa halaman & jumlah halaman konsisten', () => {
  const rows = Array.from({ length: 200 }, (_, i) => [`0${(i % 9) + 1}/01/2026`, `Siswa ${i}`, 'XI A', 'Atribut', 'Teguran', '', 'Bu Kartina']);
  const text = asLatin1(get('buildPdfBytes')(report({ rows, total: rows.length })));
  const pages = (text.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages > 1, 'data 200 baris harus lebih dari satu halaman');
  const countMatch = /\/Type \/Pages \/Kids \[([^\]]*)\] \/Count (\d+)/.exec(text);
  assert.ok(countMatch);
  assert.equal(parseInt(countMatch[2], 10), pages, '/Count harus sama dengan jumlah objek halaman');
  assert.equal(countMatch[1].trim().split(/\s+R\s*/).filter(Boolean).length, pages, 'setiap halaman terdaftar di /Kids');
  assert.match(text, new RegExp(`Halaman ${pages} dari ${pages}`));
  assert.match(text, /\\\(lanjutan\\\)/, 'halaman lanjutan mengulang judul (tanda kurung di PDF ditulis ter-escape)');
});

test('PDF: laporan kosong tetap berkas sah dan mengatakan tidak ada data', () => {
  const bytes = get('buildPdfBytes')(report({ rows: [], total: 0 }));
  const text = asLatin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /Tidak ada data pada periode & cakupan ini/);
  assert.match(text, /Jumlah Record: 0/);
});

test('PDF: karakter khusus di-escape, karakter di luar Latin-1 tidak merusak berkas', () => {
  const rows = [['01/01/2026', 'Budi (A) \\ "kutip"', 'XI B', 'Bolos 😀 中文', 'Teguran', '', 'Pak Anwar']];
  const bytes = get('buildPdfBytes')(report({ rows, total: 1 }));
  const text = asLatin1(bytes);
  assert.match(text, /Budi \\\(A\\\) \\\\/, 'kurung & backslash harus di-escape');
  // Semua byte tetap 1-byte (tidak ada karakter > 255 yang bocor ke stream).
  assert.ok(Array.from(bytes).every((b) => b >= 0 && b <= 255));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

// ================= FORMAT: XLSX =================

test('XLSX: arsip berisi seluruh bagian wajib & bisa dibongkar ulang', () => {
  const files = readZip(get('buildXlsxBytes')(report()));
  ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']
    .forEach((name) => assert.ok(files[name], `bagian ${name} harus ada`));
  assert.match(files['xl/workbook.xml'], /<sheet name="Pelanggaran"/);
});

test('XLSX: header kolom & satu record per baris, dengan blok periode/cakupan di atasnya', () => {
  const sheet = readZip(get('buildXlsxBytes')(report()))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /SMAN 2 Tarakan - SIGAP/);
  assert.match(sheet, /LAPORAN PELANGGARAN/);
  assert.match(sheet, /Periode<\/t>/);
  assert.match(sheet, /01\/01\/2026 - 31\/01\/2026/);
  assert.match(sheet, /Kelas\/Cakupan/);
  // Baris 9 = header tabel, baris 10 & 11 = dua record.
  assert.match(sheet, /<row r="9">.*Jenis Pelanggaran.*<\/row>/);
  assert.match(sheet, /<c r="A10"[^>]*><is><t[^>]*>08\/01\/2026<\/t>/);
  assert.match(sheet, /<c r="A11"[^>]*><is><t[^>]*>09\/01\/2026<\/t>/);
  assert.ok(!/<row r="12">/.test(sheet), 'tidak ada baris tambahan di luar data');
});

test('XLSX: teks di-escape sebagai XML yang sah (& < > kutip)', () => {
  const sheet = readZip(get('buildXlsxBytes')(report()))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /dasi &amp; &lt;topi&gt;/);
  assert.match(sheet, /Budi \(kelas &quot;B&quot;\)/);
  assert.ok(!/dasi & </.test(sheet), 'karakter mentah tidak boleh lolos ke XML');
});

test('XLSX: angka Rekap Siswa ditulis sebagai angka, bukan teks', () => {
  const rekap = report({
    jenis: 'rekap', jenisLabel: 'Rekap Siswa', judul: 'REKAP SISWA',
    columns: ['Nama', 'Kelas', 'Terlambat', 'Pelanggaran', 'Surat/Izin', 'Upacara', 'Total'],
    rows: [['Rahma', 'XI A', 2, 1, 1, 1, 5]], total: 1,
  });
  const sheet = readZip(get('buildXlsxBytes')(rekap))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="C10"[^>]*><v>2<\/v><\/c>/, 'kolom hitungan harus sel numerik');
  assert.match(sheet, /<c r="G10"[^>]*><v>5<\/v><\/c>/);
});

test('XLSX: nama sheet dibersihkan dari karakter terlarang & dipotong 31 karakter', () => {
  const sanitize = get('sanitizeSheetName');
  assert.equal(sanitize('Surat/Izin'), 'Surat-Izin');
  assert.equal(sanitize('a:b\\c/d?e*f[g]h'), 'a-b-c-d-e-f-g-h');
  assert.equal(sanitize('x'.repeat(50)).length, 31);
  assert.equal(sanitize(''), 'Laporan');
});

test('Nama berkas: memuat jenis, cakupan, periode, dan ekstensi yang benar', () => {
  const build = get('buildExportFilename');
  assert.equal(build(report(), 'pdf', '2026-01-01', '2026-01-31'), 'SIGAP_Pelanggaran_XI_A_2026-01-01_sd_2026-01-31.pdf');
  assert.equal(build(report({ scopeLabel: 'Semua Kelas' }), 'xlsx', '2026-01-01', '2026-01-31'), 'SIGAP_Pelanggaran_Semua_Kelas_2026-01-01_sd_2026-01-31.xlsx');
});

test('generateExportFile: menghasilkan unduhan dengan tipe berkas yang benar', () => {
  const generate = get('generateExportFile');
  const namaPdf = generate(report(), 'pdf', '2026-01-01', '2026-01-31');
  assert.match(namaPdf, /\.pdf$/);
  assert.equal(downloads[0].type, 'application/pdf');
  const namaXlsx = generate(report(), 'xlsx', '2026-01-01', '2026-01-31');
  assert.match(namaXlsx, /\.xlsx$/);
  assert.equal(downloads[1].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // Isi Blob = byte berkas, bukan string kosong.
  assert.ok(downloads[0].parts[0].length > 500);
});

// ================= LAYAR & GATING =================

test('Pilihan jenis laporan di layar sinkron dengan EXPORT_JENIS di Utils.gs', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const blok = utils.split('var EXPORT_JENIS = {')[1].split('\nfunction asText')[0];
  const kunciServer = (blok.match(/^  ([a-z]+): \{/gm) || []).map((m) => m.trim().replace(': {', ''));
  // JSON round-trip: nilai dari sandbox vm punya prototype realm lain,
  // jadi dibandingkan sebagai data biasa, bukan identitas objeknya.
  const kunciUi = JSON.parse(JSON.stringify(get('EXPORT_JENIS_UI'))).map((j) => j.key);
  assert.deepEqual(kunciUi.slice().sort(), kunciServer.slice().sort(), 'daftar jenis di UI & server tidak boleh melenceng');
});

test('canAccessExport: admin & BK ya, wali kelas ya, guru biasa & OSIS tidak', () => {
  const can = get('canAccessExport');
  assert.equal(can('admin', ''), true);
  assert.equal(can('bk_kesiswaan', ''), true);
  assert.equal(can('guru', 'XI A'), true);
  assert.equal(can('guru', ''), false);
  assert.equal(can('guru', '   '), false);
  assert.equal(can('osis', ''), false);
  assert.equal(can('osis', 'XI A'), false);
});

test('exportJenisOptions: Bimbingan Khusus hanya untuk admin/BK', () => {
  const options = get('exportJenisOptions');
  assert.ok(options(true).some((j) => j.key === 'bimbingan'));
  assert.ok(!options(false).some((j) => j.key === 'bimbingan'));
  assert.ok(options(false).some((j) => j.key === 'keterlambatan'));
});

test('validateExportForm: menolak filter yang jelas salah sebelum menembak server', () => {
  const validate = get('validateExportForm');
  assert.equal(validate({ jenis: 'keterlambatan', start: '2026-01-01', end: '2026-01-31', format: 'pdf' }), '');
  assert.match(validate({ jenis: '', start: '2026-01-01', end: '2026-01-31', format: 'pdf' }), /jenis data/i);
  assert.match(validate({ jenis: 'keterlambatan', start: '', end: '2026-01-31', format: 'pdf' }), /tanggal/i);
  assert.match(validate({ jenis: 'keterlambatan', start: '2026-02-01', end: '2026-01-01', format: 'pdf' }), /melewati/i);
  assert.match(validate({ jenis: 'keterlambatan', start: '2026-01-01', end: '2026-01-31', format: 'csv' }), /format/i);
});

test('ExportTab (admin): bisa memilih semua kelas atau satu kelas', () => {
  const tree = render('ExportTab', { isBk: true, waliKelas: '', classes: ['XI B', 'XI A', 'XI A'], onGenerate: () => {} });
  const selects = findAll(tree, (n) => n.type === 'select');
  assert.equal(selects.length, 2, 'ada dropdown jenis data & kelas');
  const opsiKelas = findAll(selects[1], (n) => n.type === 'option').map((o) => o.props.value);
  assert.deepEqual(opsiKelas, ['', 'XI A', 'XI B'], 'kelas unik & urut, dengan pilihan Semua Kelas');
});

test('ExportTab (wali kelas): cakupan terkunci, tanpa dropdown kelas & tanpa "Semua Kelas"', () => {
  const tree = render('ExportTab', { isBk: false, waliKelas: 'XI A', classes: ['XI A', 'XI B'], onGenerate: () => {} });
  const selects = findAll(tree, (n) => n.type === 'select');
  assert.equal(selects.length, 1, 'hanya dropdown jenis data');
  const text = allText(tree);
  assert.match(text, /XI A/);
  assert.match(text, /Kelas perwalian Anda/);
  assert.ok(!text.includes('Semua Kelas'));
  // Bimbingan Khusus tidak ditawarkan ke wali kelas.
  const opsiJenis = findAll(selects[0], (n) => n.type === 'option').map((o) => o.props.value);
  assert.ok(!opsiJenis.includes('bimbingan'));
});

test('ExportTab: wali kelas tetap mengirim kelasnya sendiri walau state kelas diubah', () => {
  let dikirim = null;
  // urutan useState: jenis, kelas, start, end, format, busy, msg
  const tree = render(
    'ExportTab',
    { isBk: false, waliKelas: 'XI A', classes: ['XI A', 'XI B'], onGenerate: (payload) => { dikirim = payload; } },
    ['pelanggaran', 'XI B', '2026-01-01', '2026-01-31', 'xlsx']
  );
  buttonWithText(tree, 'Generate & Download').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(dikirim)), { jenis: 'pelanggaran', kelas: 'XI A', start: '2026-01-01', end: '2026-01-31', format: 'xlsx' });
});

test('ExportTab: filter tidak valid tidak pernah sampai ke server', () => {
  let dipanggil = 0;
  const tree = render(
    'ExportTab',
    { isBk: true, waliKelas: '', classes: [], onGenerate: () => { dipanggil++; } },
    ['keterlambatan', '', '2026-02-01', '2026-01-01', 'pdf']
  );
  buttonWithText(tree, 'Generate & Download').props.onClick();
  assert.equal(dipanggil, 0, 'tanggal terbalik dihentikan di layar');
});

test('ExportTab: tombol dinonaktifkan & memberi keterangan saat laporan sedang disiapkan', () => {
  const tree = render(
    'ExportTab',
    { isBk: true, waliKelas: '', classes: [], onGenerate: () => {} },
    ['keterlambatan', '', '2026-01-01', '2026-01-31', 'pdf', true]
  );
  const tombol = findAll(tree, (n) => n.type === get('Button') && /Menyiapkan laporan/.test(allText(n)))[0];
  assert.ok(tombol, 'ada keadaan loading saat generate');
  assert.equal(tombol.props.disabled, true);
});

test('config & app.js: menu Export untuk admin/BK, runtime untuk wali kelas, tidak untuk guru biasa/OSIS', () => {
  const ROLES = get('ROLES');
  assert.ok(ROLES.admin.menus.includes('export'));
  assert.ok(ROLES.bk_kesiswaan.menus.includes('export'));
  assert.ok(!ROLES.guru.menus.includes('export'), 'guru biasa tidak boleh dapat menu export lewat ROLES');
  assert.ok(!ROLES.osis.menus.includes('export'));
  // Tidak menambah ikon di BottomNav utama (ruangnya sudah pas 4 + Lainnya).
  Object.keys(ROLES).forEach((r) => assert.ok(!ROLES[r].primaryMenus.includes('export')));

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /waliKelasExtraMenus = \['rekap', 'export'\]/);
  assert.match(app, /activeTab === 'export' && effectiveMenus\.includes\('export'\) && canAccessExport\(roleKey, user\.waliKelas\)/);
});

test('config & app.js: menu Audit Log hanya untuk Admin', () => {
  const ROLES = get('ROLES');
  assert.ok(ROLES.admin.menus.includes('auditlog'), 'admin tetap punya menu Audit Log');
  assert.ok(!ROLES.bk_kesiswaan.menus.includes('auditlog'), 'BK/Kesiswaan tidak lagi punya menu Audit Log');
  assert.ok(!ROLES.guru.menus.includes('auditlog'));
  assert.ok(!ROLES.osis.menus.includes('auditlog'));
  // Menu 'export' yang baru tidak ikut tercabut dari BK saat menu audit dicabut.
  assert.ok(ROLES.bk_kesiswaan.menus.includes('export'));

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split('const fetchAuditLog = () => {')[1].split('};')[0];
  assert.match(blok, /roleKey !== 'admin'/);
  assert.doesNotMatch(blok, /bk_kesiswaan/, 'BK tidak lagi menembak getAuditLog');
});

test('app.js: laporan tidak disaring ulang di browser — dipakai apa adanya dari server', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split('const handleExportData = (payload, callback) => {')[1].split('const handleAddUpacara')[0];
  assert.match(blok, /action=exportData/);
  assert.match(blok, /generateExportFile\(data\.report, payload\.format/);
  assert.doesNotMatch(blok, /\.filter\(|\.slice\(|allLogs|pelanggaranList|suratList/,
    'berkas hanya boleh dibangun dari data.report milik server');
  // Pesan error ke pengguna tidak boleh membawa detail teknis/isi data.
  assert.doesNotMatch(blok, /err\.message|JSON\.stringify\(|console\.log/);
});

test('App: menu Export muncul untuk wali kelas, tidak untuk guru biasa', () => {
  const masuk = (user) => {
    storage.sigap_session_token = 'TOK';
    storage.sigap_user = JSON.stringify(user);
    storage.sigap_session_expires = String(Date.now() + 6 * 60 * 60 * 1000);
    const tree = render('App', {});
    const nav = findAll(tree, (n) => n.type === get('BottomNav'))[0];
    assert.ok(nav, 'BottomNav harus terpasang saat sudah login');
    return JSON.parse(JSON.stringify(nav.props.menus));
  };

  const waliKelas = masuk({ id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' });
  assert.ok(waliKelas.includes('export'), 'wali kelas mendapat menu Export secara runtime');
  assert.ok(waliKelas.includes('rekap'), 'menu Rekap Kelas yang sudah ada tidak ikut hilang');

  vm.runInContext('React', sandbox).__resetStore();
  storage = {};
  const guruBiasa = masuk({ id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' });
  assert.ok(!guruBiasa.includes('export'), 'guru biasa tidak mendapat menu Export');

  vm.runInContext('React', sandbox).__resetStore();
  storage = {};
  const osis = masuk({ id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' });
  assert.deepEqual(osis, ['upacara'], 'OSIS tetap hanya punya satu menu');
});

// ===== Laporan Izin Keluar (14 kolom) =====
// Laporan terlebar yang ada. Yang diperiksa: penulis PDF & XLSX tetap
// menghasilkan berkas yang bisa dibuka, dan kolom yang sempit dipotong —
// bukan tumpang tindih atau merusak strukturnya.

const laporanIzin = (over) => report(Object.assign({
  jenis: 'izin',
  jenisLabel: 'Izin Keluar',
  judul: 'LAPORAN IZIN KELUAR / PULANG',
  columns: ['Tanggal', 'Nama', 'Kelas', 'Keperluan', 'Tujuan', 'Jalur', 'Alasan Khusus', 'Status',
    'Disetujui Oleh', 'Jam Setuju', 'Verifikator', 'Jam Keluar', 'Jam Kembali', 'Pencatat Kembali'],
  rows: [
    // Nama & kelas sengaja sepanjang data sungguhan — laporan ini yang paling
    // rawan terpotong, jadi fixture-nya tidak boleh lebih pendek dari kenyataan.
    ['14/01/2026', 'Muhammad Rizki Ramadhan', 'XI MIPA 3', 'kontrol ke puskesmas', 'Kembali', 'Normal', '', 'Selesai',
      'Bu Kartina Dewi', '09:00', 'Pak Piket Pagi', '09:05', '11:30', 'Bu Piket Siang'],
    ['15/01/2026', 'Siti Nurhaliza', 'XI IPS 1', 'dijemput orang tua', 'Pulang', 'Normal', '', 'Pulang',
      'Pak Anwar', '10:00', 'Pak Piket Pagi', '10:10', '', ''],
  ],
  total: 2,
}, over || {}));

test('PDF laporan Izin Keluar: 14 kolom tetap menghasilkan berkas yang sah', () => {
  const bytes = get('buildPdfBytes')(laporanIzin());
  const text = asLatin1(bytes);
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /%%EOF\s*$/);
  assert.match(text, /LAPORAN IZIN KELUAR \/ PULANG/);
  // Semua judul kolom tercetak UTUH — bukan sekadar awalannya.
  laporanIzin().columns.forEach((c) => assert.ok(text.includes('(' + c + ') Tj'), 'judul kolom "' + c + '" terpotong/hilang'));
  // Dan isi yang tidak boleh salah baca kalau terpotong: tanggal, nama, kelas.
  ['14/01/2026', 'Muhammad Rizki Ramadhan', 'XI MIPA 3', '15/01/2026', 'Siti Nurhaliza', 'XI IPS 1']
    .forEach((v) => assert.ok(text.includes('(' + v + ') Tj'), 'isi "' + v + '" terpotong — tanggal/nama/kelas yang terpotong = data salah baca'));
});

test('XLSX laporan Izin Keluar: 14 kolom & sel kosong tidak merusak arsip', () => {
  const files = readZip(get('buildXlsxBytes')(laporanIzin()));
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.ok(sheet, 'sheet1.xml harus ada');
  assert.match(sheet, /Pencatat Kembali/);
  assert.match(sheet, /Muhammad Rizki Ramadhan/);
  // Kolom ke-14 = N (A..N), jadi rentangnya harus mencapai N.
  assert.match(sheet, /N\d+/);
});

test('laporan Izin Keluar tidak membawa asumsi pencetakan apa pun', () => {
  const fmt = fs.readFileSync(path.join(ROOT, 'export-format.js'), 'utf8');
  const exp = fs.readFileSync(path.join(ROOT, 'export-data.js'), 'utf8');
  // PDF memang punya MediaBox (itu wajib ada di format PDF), tapi tidak boleh
  // ada asumsi PERANGKAT cetak di mana pun.
  [/bluetooth/i, /esc[-\/]?pos/i, /airprint/i, /window\.print/i, /thermal/i, /58mm/i, /80mm/i]
    .forEach((pola) => {
      assert.ok(!pola.test(fmt), 'export-format.js memuat asumsi printer: ' + pola);
      assert.ok(!pola.test(exp), 'export-data.js memuat asumsi printer: ' + pola);
    });
});

test('laporan sempit (<=10 kolom) tetap memakai ukuran huruf lama — laporan existing tidak berubah', () => {
  const text = asLatin1(get('buildPdfBytes')(report()));
  // 8.5 = PDF_FONT_SIZE, ukuran yang dipakai laporan 6-7 kolom sejak awal.
  assert.match(text, /\/F1 8\.5 Tf/);
  assert.ok(!/\/F1 7 Tf/.test(text), 'laporan sempit tidak boleh ikut mengecil');
  // Laporan lebar yang mengecil.
  const lebar = asLatin1(get('buildPdfBytes')(laporanIzin()));
  assert.match(lebar, /\/F1 7 Tf/);
});

test('kolom yang isinya sangat panjang tetap dipotong — bukan meluber keluar halaman', () => {
  const panjang = report({
    rows: [['08/01/2026', 'Rahma', 'XI A', 'Atribut', 'Teguran Lisan', 'x'.repeat(400), 'Bu Kartina']],
    total: 1,
  });
  const text = asLatin1(get('buildPdfBytes')(panjang));
  assert.ok(!text.includes('x'.repeat(400)), 'isi raksasa harus dipotong');
  assert.match(text, /x+\.\./);
  // Tanggal & nama di baris yang sama tetap utuh.
  assert.ok(text.includes('(08/01/2026) Tj'));
  assert.ok(text.includes('(Rahma) Tj'));
});
