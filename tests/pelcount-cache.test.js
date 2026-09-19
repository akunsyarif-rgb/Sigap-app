// ===== tests/pelcount-cache.test.js =====
// Cache per-NISN untuk getPelanggaranMatchedForStudent (Utils.gs), dipakai
// action 'getPelanggaranCountForStudent' (peringatan "sudah Nx tercatat" di
// PelanggaranTab, pelanggaran-bimbingan-upacara.js). Pola sama persis dengan
// tests/latehist-cache.test.js -- lihat catatan di Utils.gs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

function makeSheet(header, rows) {
  const data = [header.slice()].concat((rows || []).map((r) => r.slice()));
  return {
    _data: data,
    getRangeCalls: 0,
    getLastRow: () => data.length,
    getLastColumn: () => header.length,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange(row, col, numRows, numCols) {
      this.getRangeCalls++;
      return {
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
        setValue: () => {}, setValues: () => {}, setNumberFormat() { return this; }, clearContent: () => {},
      };
    },
    appendRow(row) { data.push(row.slice()); },
    deleteRow(i) { data.splice(i - 1, 1); },
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

const now = new Date();
const kemarin = (hariLalu) => new Date(now.getTime() - hariLalu * 24 * 3600 * 1000);

// Pelanggaran: [Timestamp, NISN, Nama, Kelas, Jenis, Sanksi, Catatan, Dicatat_Oleh]
const PELANGGARAN_ROWS = [
  [kemarin(20), '1001', 'Rahma', 'XI A', 'Atribut', 'Teguran', '', 'Bu Kartina'],
  [kemarin(15), '1001', 'Rahma', 'XI A', 'Bolos', 'Panggilan Ortu', '', 'Pak Anwar'],
  [kemarin(10), '1001', 'Rahma', 'XI A', 'Merokok', 'Teguran', '', 'Bu Kartina'],
  [kemarin(5), '2002', 'Budi', 'XI B', 'Atribut', 'Teguran', '', 'Pak Anwar'],
];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
};

function loadServer() {
  const sheets = {
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], PELANGGARAN_ROWS),
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], [['1001', 'Rahma', 'XI A'], ['2002', 'Budi', 'XI B']]),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, getUuid: () => crypto.randomUUID(),
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
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { sheets[n] = makeSheet(['x'], []); return sheets[n]; },
      }),
    },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  ['Utils.gs', 'Auth.gs', 'Notifikasi.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const tokens = {};
  Object.keys(USERS).forEach((k) => { tokens[k] = vm.runInContext('createSession', sandbox)(USERS[k]); });
  const doGet = vm.runInContext('doGet', sandbox);
  const doPost = vm.runInContext('doPost', sandbox);
  const get = (who, params) => JSON.parse(doGet({
    parameter: Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, params),
  }).text);
  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, body)) },
  }).text);
  return { sandbox, sheets, tokens, get, post, cacheStore };
}

test('getPelanggaranCountForStudent: cache hit TIDAK men-scan sheet lagi', () => {
  const s = loadServer();

  const first = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(first.status, 'success');
  assert.equal(first.count, 3, 'total sebenarnya siswa 1001 = 3 baris');
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 1);

  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'pelcount_1001'));

  const second = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.deepEqual(second, first);
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 1, 'cache hit TIDAK boleh scan sheet lagi');
});

test('getPelanggaranCountForStudent: cache dibuang setelah siswa yang sama dapat catatan pelanggaran baru', () => {
  const s = loadServer();

  const before = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(before.count, 3);
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 1);

  const rec = s.post('guru', { action: 'addPelanggaran', nisn: '1001', name: 'Rahma', class_name: 'XI A', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran' });
  assert.equal(rec.status, 'success');
  assert.ok(!Object.prototype.hasOwnProperty.call(s.cacheStore, 'pelcount_1001'), 'cache pelcount_1001 harus dibuang setelah catatan baru');

  const after = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(after.count, 4, 'angka harus langsung akurat, bukan basi sampai TTL 5 menit habis');
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 2, 'cache miss setelah invalidasi -> scan tambahan sekali');
});

test('getPelanggaranCountForStudent: cache tetap MENTAH (raw) -- guru biasa & wali kelas dapat angka sesuai cakupannya masing-masing dari 1x scan', () => {
  const s = loadServer();
  const admin = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(admin.count, 3, 'admin: seluruh sekolah');

  // Pak Anwar (guru biasa) hanya menulis 1 dari 3 baris NISN 1001 (kemarin(15))
  // -- Pelanggaran TIDAK dibatasi tanggal untuk OWN, jadi guru biasa harus
  // tetap dapat catatannya sendiri, bukan 0 dan bukan 3.
  const guru = s.get('guru', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(guru.count, 1, 'guru biasa cuma dapat catatan miliknya sendiri, bukan cakupan admin dari cache');

  const wali = s.get('wali', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(wali.count, 3, 'wali kelas XI A dapat seluruh kelasnya (semua baris NISN 1001 kebetulan XI A)');

  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 1, 'sheet cuma di-scan sekali walau dipanggil 3 pemakai berbeda cakupan');
});

test('getPelanggaranCountForStudent: cache dibuang lewat editEntry/deleteEntry kategori pelanggaran', () => {
  const s = loadServer();
  s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '2002' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'pelcount_2002'));

  const target = s.sheets.Pelanggaran._data[4]; // baris NISN 2002 (index 4: header + 4 baris sebelumnya)
  const del = s.post('admin', { action: 'deleteEntry', category: 'pelanggaran', nisn: '2002', timestamp: target[0], name: 'Budi' });
  assert.equal(del.status, 'success');
  assert.ok(!Object.prototype.hasOwnProperty.call(s.cacheStore, 'pelcount_2002'), 'cache harus dibuang setelah baris dihapus');
});

test('getPelanggaranCountForStudent: NISN kosong/null/undefined TIDAK pernah masuk cache (selalu scan langsung)', () => {
  const s = loadServer();

  const kosong1 = s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '' });
  assert.equal(kosong1.status, 'success');
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 1);
  assert.ok(Object.keys(s.cacheStore).every((k) => !k.startsWith('pelcount_')), 'NISN kosong tidak boleh menulis key cache pelcount_ apa pun');

  s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '' });
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 2, 'NISN kosong harus scan ulang tiap kali, tidak pernah cache hit');

  s.get('admin', { action: 'getPelanggaranCountForStudent' });
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 3);
  assert.ok(Object.keys(s.cacheStore).every((k) => !k.startsWith('pelcount_')), 'NISN undefined juga tidak boleh menulis key cache pelcount_ apa pun');

  // NISN sungguhan tetap ke-cache seperti biasa sesudahnya.
  s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'pelcount_1001'));
  s.get('admin', { action: 'getPelanggaranCountForStudent', nisn: '1001' });
  assert.equal(s.sheets.Pelanggaran.getRangeCalls, 4, 'NISN sungguhan tetap cache hit, tidak scan ulang');
});
