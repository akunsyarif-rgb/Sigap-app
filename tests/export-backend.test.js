// ===== tests/export-backend.test.js =====
// Otorisasi & validasi fitur Export Data DI SERVER — bukan di UI.
//
// Sama seperti tests/password.test.js, file ini memuat Utils.gs/Auth.gs/Code.gs
// yang SUNGGUHAN lewat vm.runInContext dengan layanan Apps Script di-stub,
// lalu memanggil doGet() persis seperti Web App memanggilnya. Jadi yang diuji
// benar-benar kode yang nanti jalan di Apps Script, termasuk URUTAN
// pemeriksaannya (sesi -> rate limit -> otorisasi -> validasi filter -> baca
// data), bukan tiruan logikanya.
//
// Yang dijaga file ini:
// - siapa boleh mengekspor apa (admin/BK/wali kelas/guru biasa/OSIS)
// - scope kelas dari klien tidak dipercaya
// - filter tanggal divalidasi, rentang terbalik/ngawur ditolak
// - tidak ada data sensitif (NISN, Foto_URL, ID pencatat) yang ikut keluar
// - permintaan yang ditolak tidak pernah membawa satu baris data pun
// - setiap percobaan export tercatat di Audit Log, tanpa isi data siswa

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// ---- Sheet palsu: array 2 dimensi + API seperlunya yang dipakai Code.gs ----
function makeSheet(header, rows) {
  const data = [header.slice()].concat(rows.map((r) => r.slice()));
  return {
    appended: [],
    getLastRow: () => data.length,
    getLastColumn: () => header.length,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        const out = [];
        for (let r = row; r < row + numRows; r++) {
          const src = data[r - 1] || [];
          const line = [];
          for (let c = col; c < col + numCols; c++) line.push(src[c - 1] === undefined ? '' : src[c - 1]);
          out.push(line);
        }
        return out;
      },
      setValue: () => {},
      setValues: () => {},
      clearContent: () => {},
    }),
    appendRow(row) { data.push(row.slice()); this.appended.push(row.slice()); },
  };
}

const D = (iso) => new Date(iso);

// Data contoh: dua kelas, beberapa kategori, urut menaik seperti sheet asli
// (getRowsSince mengandalkan urutan timestamp menaik — binary search).
function buildSpreadsheet() {
  const sheets = {
    Log_Gerbang: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'],
      [
        [D('2025-12-20T07:10:00'), '1001', 'Rahma', 'XI A', 'Kesiangan', 'Bu Kartina'],
        [D('2026-01-05T07:05:00'), '1001', 'Rahma', 'XI A', 'Kesiangan', 'Bu Kartina'],
        [D('2026-01-06T07:20:00'), '2002', 'Budi', 'XI B', 'Ban bocor', 'Pak Anwar'],
        [D('2026-01-20T07:15:00'), '1001', 'Rahma', 'XI A', 'Hujan', 'Bu Kartina'],
        [D('2026-02-10T07:15:00'), '2002', 'Budi', 'XI B', 'Hujan', 'Pak Anwar'],
      ]
    ),
    Pelanggaran: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'],
      [
        [D('2026-01-08T09:00:00'), '1001', 'Rahma', 'XI A', 'Atribut', 'Teguran Lisan', 'dasi', 'Bu Kartina'],
        [D('2026-01-09T09:00:00'), '2002', 'Budi', 'XI B', 'Bolos', 'Panggilan Ortu', '', 'Pak Anwar'],
      ]
    ),
    Surat_Masuk: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'],
      [
        [D('2026-01-10T08:00:00'), '1001', 'Rahma', 'XI A', 'Sakit', 'demam', 'https://drive.google.com/RAHASIA', 'Bu Kartina'],
      ]
    ),
    Bimbingan_Khusus: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Catatan', 'Dicatat_Oleh'],
      [[D('2026-01-11T10:00:00'), '1001', 'Rahma', 'XI A', 'perlu pendampingan', 'Bu BK']]
    ),
    Pelanggaran_Upacara: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Catatan', 'Dicatat_Oleh', 'Dicatat_Oleh_ID'],
      [
        [D('2026-01-12T07:30:00'), '1001', 'Rahma', 'XI A', 'Atribut Tidak Lengkap', '', 'OSIS A', 'S99'],
        [D('2026-01-12T07:31:00'), '2002', 'Budi', 'XI B', 'Tidak Tertib', '', 'OSIS A', 'S99'],
      ]
    ),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  return sheets;
}

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  waliA: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

function loadServer() {
  const sheets = buildSpreadsheet();
  const cacheStore = {};
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_algo, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'API_TOKEN' ? 'TOKEN-OK' : null) }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = String(v); },
        remove: (k) => { delete cacheStore[k]; },
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => { sheets[name] = makeSheet(['x'], []); return sheets[name]; },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ text: text, setMimeType() { return this; } }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  ['Utils.gs', 'Auth.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });

  // Sesi dibuat lewat createSession() yang sungguhan, bukan ditanam manual.
  const tokens = {};
  Object.keys(USERS).forEach((key) => {
    tokens[key] = vm.runInContext('createSession', sandbox)(USERS[key]);
  });

  const doGet = vm.runInContext('doGet', sandbox);
  const call = (params) => JSON.parse(doGet({ parameter: params }).text);
  const exportAs = (who, params) =>
    call(Object.assign(
      { action: 'exportData', token: 'TOKEN-OK', sessionToken: tokens[who], jenis: 'keterlambatan', start: '2026-01-01', end: '2026-01-31', format: 'pdf' },
      params || {}
    ));

  return { sandbox, sheets, tokens, call, exportAs, audit: () => sheets.Audit_Log.appended };
}

const namaKolom = (report, name) => report.columns.indexOf(name);
const semuaSel = (report) => report.rows.map((r) => r.map(String).join(' | ')).join('\n');

// ================= AUTHORIZATION =================

test('Export: admin boleh mengekspor seluruh sekolah', () => {
  const s = loadServer();
  const res = s.exportAs('admin');
  assert.equal(res.status, 'success');
  assert.equal(res.report.total, 3, 'tiga keterlambatan berada di dalam periode Januari');
  assert.match(semuaSel(res.report), /XI A/);
  assert.match(semuaSel(res.report), /XI B/);
});

test('Export: BK/Kesiswaan boleh mengekspor semua jenis, termasuk Bimbingan Khusus', () => {
  const s = loadServer();
  ['keterlambatan', 'pelanggaran', 'surat', 'upacara', 'bimbingan', 'rekap'].forEach((jenis) => {
    const res = s.exportAs('bk', { jenis });
    assert.equal(res.status, 'success', `BK harus boleh export ${jenis}: ${res.message}`);
  });
});

test('Export: wali kelas hanya mendapat kelas perwaliannya, walau tidak memilih kelas', () => {
  const s = loadServer();
  const res = s.exportAs('waliA', { kelas: '' });
  assert.equal(res.status, 'success');
  assert.equal(res.report.scopeLabel, 'XI A');
  assert.equal(res.report.total, 2);
  assert.doesNotMatch(semuaSel(res.report), /XI B/, 'kelas lain tidak boleh ikut');
  assert.doesNotMatch(semuaSel(res.report), /Budi/);
});

test('Export: guru biasa (bukan wali kelas) tidak mendapat akses export sama sekali', () => {
  const s = loadServer();
  ['keterlambatan', 'pelanggaran', 'surat', 'upacara', 'bimbingan', 'rekap'].forEach((jenis) => {
    const res = s.exportAs('guru', { jenis });
    assert.equal(res.status, 'error', `guru biasa tidak boleh export ${jenis}`);
    assert.equal(res.report, undefined);
  });
});

test('Export: OSIS ditolak untuk semua jenis laporan', () => {
  const s = loadServer();
  ['keterlambatan', 'upacara', 'rekap'].forEach((jenis) => {
    const res = s.exportAs('osis', { jenis });
    assert.equal(res.status, 'error');
    assert.match(res.message, /akses/i);
    assert.equal(res.report, undefined);
  });
});

test('Export: wali kelas TIDAK bisa mengekspor Bimbingan Khusus (tetap admin/BK-only)', () => {
  const s = loadServer();
  const res = s.exportAs('waliA', { jenis: 'bimbingan' });
  assert.equal(res.status, 'error');
  assert.equal(res.report, undefined);
});

// ================= SECURITY =================

test('Export: mengganti scope ke kelas lain ditolak, bukan diam-diam dikoreksi', () => {
  const s = loadServer();
  const res = s.exportAs('waliA', { kelas: 'XI B' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /kelas perwalian/i);
  assert.equal(res.report, undefined, 'permintaan yang ditolak tidak boleh membawa data apa pun');
});

test('Export: role palsu di query string tidak berpengaruh — server memakai sesi', () => {
  const s = loadServer();
  const res = s.exportAs('guru', { role: 'admin', user: 'admin', waliKelas: 'XI A', isAdmin: 'true' });
  assert.equal(res.status, 'error');
  assert.equal(res.report, undefined);
});

test('Export: sesi tidak valid / token API salah ditolak sebelum apa pun dibaca', () => {
  const s = loadServer();
  const tanpaSesi = s.call({ action: 'exportData', token: 'TOKEN-OK', sessionToken: 'palsu', jenis: 'keterlambatan', start: '2026-01-01', end: '2026-01-31', format: 'pdf' });
  assert.equal(tanpaSesi.status, 'error');
  assert.match(tanpaSesi.message, /Sesi berakhir/);
  assert.equal(tanpaSesi.report, undefined);

  const tokenSalah = s.call({ action: 'exportData', token: 'SALAH', sessionToken: s.tokens.admin, jenis: 'keterlambatan', start: '2026-01-01', end: '2026-01-31', format: 'pdf' });
  assert.equal(tokenSalah.status, 'error');
  assert.match(tokenSalah.message, /Unauthorized/);
  assert.equal(tokenSalah.report, undefined);
});

test('Export: field sensitif tidak pernah ikut ke hasil (NISN, Foto_URL, ID pencatat)', () => {
  const s = loadServer();
  const surat = s.exportAs('admin', { jenis: 'surat' });
  assert.equal(surat.status, 'success');
  const suratText = JSON.stringify(surat.report);
  assert.doesNotMatch(suratText, /drive\.google\.com/, 'Foto_URL tidak boleh ikut');
  assert.doesNotMatch(suratText, /1001/, 'NISN tidak boleh ikut');
  assert.equal(namaKolom(surat.report, 'NISN'), -1);

  const upacara = s.exportAs('admin', { jenis: 'upacara' });
  const upacaraText = JSON.stringify(upacara.report);
  assert.doesNotMatch(upacaraText, /"S99"/, 'Dicatat_Oleh_ID tidak boleh ikut');
  assert.doesNotMatch(upacaraText, /2002/);

  const rekap = s.exportAs('admin', { jenis: 'rekap' });
  assert.doesNotMatch(JSON.stringify(rekap.report), /1001|2002/, 'Rekap Siswa mengelompokkan per NISN tapi tidak mengeluarkannya');
});

test('Export: kelas yang tidak dikenal menghasilkan 0 baris, bukan seluruh sekolah', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { kelas: 'XII Z' });
  assert.equal(res.status, 'success');
  assert.equal(res.report.total, 0);
  assert.deepEqual(res.report.rows, []);
});

test('Export: nilai kelas raksasa dari klien dipotong, tidak membanjiri Audit Log/kop laporan', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { kelas: 'X'.repeat(5000) });
  assert.equal(res.status, 'success');
  assert.ok(res.report.scopeLabel.length <= 60, 'cakupan yang tercetak di laporan dibatasi');
  assert.equal(res.report.total, 0, 'kelas karangan tetap tidak mencocokkan apa pun');
  assert.ok(String(s.audit()[0][4]).length < 200, 'baris Audit Log tetap ringkas');
});

test('Export: jenis laporan yang tidak dikenali ditolak (tidak ada sheet acak yang bisa dipilih)', () => {
  const s = loadServer();
  ['Master_Guru', 'Audit_Log', '../Master_Guru', ''].forEach((jenis) => {
    const res = s.exportAs('admin', { jenis });
    assert.equal(res.status, 'error', `jenis "${jenis}" harus ditolak`);
    assert.equal(res.report, undefined);
  });
});

// ================= FILTER =================

test('Export: hanya baris di dalam periode yang ikut', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { start: '2026-01-06', end: '2026-01-06' });
  assert.equal(res.report.total, 1);
  assert.match(semuaSel(res.report), /Budi/);
  assert.doesNotMatch(semuaSel(res.report), /Rahma/);
  // Baris Desember & Februari (di luar rentang) tidak pernah ikut.
  const januari = s.exportAs('admin', { start: '2026-01-01', end: '2026-01-31' });
  assert.doesNotMatch(semuaSel(januari.report), /20\/12\/2025|10\/02\/2026/);
});

test('Export: tanggal terbalik ditolak', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { start: '2026-01-31', end: '2026-01-01' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /tidak boleh melewati/i);
  assert.equal(res.report, undefined);
});

test('Export: tanggal kosong / format ngawur / tanggal tidak ada di kalender ditolak', () => {
  const s = loadServer();
  [
    { start: '', end: '' },
    { start: '01-01-2026', end: '31-01-2026' },
    { start: '2026-02-31', end: '2026-03-01' },
    { start: '2026-13-01', end: '2026-13-05' },
    { start: 'DROP TABLE', end: '2026-01-31' },
  ].forEach((params) => {
    const res = s.exportAs('admin', params);
    assert.equal(res.status, 'error', `harus ditolak: ${JSON.stringify(params)}`);
    assert.equal(res.report, undefined);
  });
});

test('Export: rentang lebih dari setahun ditolak (lindungi Apps Script & ukuran berkas)', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { start: '2024-01-01', end: '2026-01-31' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /terlalu panjang/i);
});

test('Export: format selain pdf/xlsx ditolak', () => {
  const s = loadServer();
  ['', 'docx', 'csv', 'html'].forEach((format) => {
    const res = s.exportAs('admin', { format });
    assert.equal(res.status, 'error', `format ${format} harus ditolak`);
  });
});

test('Export: periode tanpa data menghasilkan respons aman (0 baris, bukan error/bocor)', () => {
  const s = loadServer();
  const res = s.exportAs('admin', { start: '2026-03-01', end: '2026-03-31' });
  assert.equal(res.status, 'success');
  assert.equal(res.report.total, 0);
  assert.deepEqual(res.report.rows, []);
  assert.ok(res.report.columns.length > 0, 'struktur laporan tetap utuh');
});

test('Export: Rekap Siswa menghitung gabungan kategori per siswa dalam periode & scope', () => {
  const s = loadServer();
  const res = s.exportAs('waliA', { jenis: 'rekap' });
  assert.equal(res.status, 'success');
  assert.deepEqual(res.report.columns, ['Nama', 'Kelas', 'Terlambat', 'Pelanggaran', 'Surat/Izin', 'Upacara', 'Total']);
  assert.equal(res.report.rows.length, 1, 'hanya siswa kelas perwalian');
  const [nama, kelas, terlambat, pelanggaran, surat, upacara, total] = res.report.rows[0];
  assert.equal(nama, 'Rahma');
  assert.equal(kelas, 'XI A');
  assert.deepEqual([terlambat, pelanggaran, surat, upacara, total], [2, 1, 1, 1, 5]);
});

// ================= AUDIT LOG =================

test('Audit: export berhasil tercatat lengkap dengan metadata, tanpa isi data siswa', () => {
  const s = loadServer();
  s.exportAs('waliA', { jenis: 'pelanggaran', format: 'xlsx' });
  const rows = s.audit();
  assert.equal(rows.length, 1);
  const [, nama, id, aksi, detail] = rows[0];
  assert.equal(nama, 'Bu Kartina');
  assert.equal(id, 'G02');
  assert.equal(aksi, 'Export Data');
  assert.match(detail, /jenis=pelanggaran/);
  assert.match(detail, /periode=01\/01\/2026 - 31\/01\/2026/);
  assert.match(detail, /cakupan=XI A/);
  assert.match(detail, /format=xlsx/);
  assert.match(detail, /baris=1/);
  assert.match(detail, /status=berhasil/);
  // Tidak boleh ada nama/NISN siswa atau isi catatan di Audit Log.
  assert.doesNotMatch(detail, /Rahma|1001|dasi/);
});

test('Audit: export yang ditolak & filter tidak valid ikut tercatat', () => {
  const s = loadServer();
  s.exportAs('waliA', { kelas: 'XI B' });                       // ditolak otorisasi
  s.exportAs('osis');                                            // ditolak role
  s.exportAs('admin', { start: '2026-02-01', end: '2026-01-01' }); // filter tidak valid
  const aksi = s.audit().map((r) => r[3]);
  assert.equal(aksi.filter((a) => a === 'Export Data Ditolak').length, 3);
  const detail = s.audit().map((r) => r[4]).join('\n');
  assert.match(detail, /status=ditolak/);
  assert.match(detail, /status=filter tidak valid/);
});

test('Audit: periode kosong tercatat sebagai "tidak ada data", bukan sebagai export berhasil', () => {
  const s = loadServer();
  s.exportAs('admin', { start: '2026-03-01', end: '2026-03-31' });
  assert.equal(s.audit()[0][3], 'Export Data Kosong');
  assert.match(s.audit()[0][4], /status=tidak ada data/);
});

test('Audit Log tetap tertutup untuk guru, wali kelas, dan OSIS', () => {
  const s = loadServer();
  ['guru', 'waliA', 'osis'].forEach((who) => {
    const res = s.call({ action: 'getAuditLog', token: 'TOKEN-OK', sessionToken: s.tokens[who] });
    assert.equal(res.status, 'error', `${who} tidak boleh melihat Audit Log`);
    assert.equal(res.auditLog, undefined);
  });
});

// ================= RATE LIMIT & URUTAN PEMERIKSAAN =================

test('Export: dibatasi per sesi supaya Audit Log & Sheets API tidak bisa dibanjiri', () => {
  const s = loadServer();
  const max = vm.runInContext('EXPORT_RATE_MAX', s.sandbox);
  let terakhir;
  for (let i = 0; i < max + 1; i++) terakhir = s.exportAs('admin');
  assert.equal(terakhir.status, 'error');
  assert.match(terakhir.message, /Terlalu banyak permintaan export/);
});

test('Code.gs: otorisasi & validasi dijalankan SEBELUM sheet dibaca', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const blok = code.split("if (action === 'exportData')")[1].split('function debugBannerData')[0];
  const posAkses = blok.indexOf('resolveExportAccess(');
  const posPeriode = blok.indexOf('validateExportPeriod(');
  const posBaca = blok.indexOf('getSheetByName(');
  assert.ok(posAkses > -1 && posPeriode > -1 && posBaca > -1);
  assert.ok(posAkses < posPeriode, 'otorisasi harus mendahului validasi filter');
  assert.ok(posPeriode < posBaca, 'sheet baru boleh dibaca setelah filter tervalidasi');
  // Kelas yang dipakai untuk menyaring HARUS berasal dari hasil otorisasi,
  // bukan langsung dari parameter klien.
  assert.match(blok, /exportAccess\.kelasFilter/);
  assert.doesNotMatch(blok.split('resolveExportAccess(')[1] || '', /e\.parameter\.kelas[^)]*\)\s*;?\s*$/);
});
