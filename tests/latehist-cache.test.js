// ===== tests/latehist-cache.test.js =====
// Cache per-NISN untuk getLateHistoryForStudent (Utils.gs), dipakai action
// 'getStudentLateHistory' (badge "sudah Nx terlambat" di form Catat
// Terlambat, gerbang.js RecordModal). Sebelum ini, tiap kali modal dibuka
// untuk seorang siswa, fungsi ini men-scan ULANG SELURUH Log_Gerbang (linear
// terhadap total riwayat sekolah), lihat catatan di Utils.gs.
//
// Yang diuji lewat doPost()/doGet() SUNGGUHAN (Utils.gs+Auth.gs+Code.gs di
// vm, layanan Apps Script di-stub — pola yang sama dengan
// tests/rbac-riwayat-pelanggaran.test.js):
//   1. Cache hit tidak men-scan sheet lagi (getRange tidak dipanggil ulang).
//   2. Cache dibuang begitu siswa yang sama dapat catatan baru lewat action
//      'record', supaya badge tidak basi.
//   3. Data yang dikembalikan tetap akurat (tidak ada regresi ke aturan RBAC
//      yang sudah ada di getStudentLateHistory).

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

// Log_Gerbang: [Timestamp, NISN, Nama, Kelas, Alasan, Dicatat_Oleh]
const LATE_ROWS = [
  [kemarin(20), '1001', 'Rahma', 'XI A', 'Kesiangan', 'Bu Kartina'],
  [kemarin(15), '1001', 'Rahma', 'XI A', 'Ban bocor', 'Pak Anwar'],
  [kemarin(10), '1001', 'Rahma', 'XI A', 'Macet', 'Bu Kartina'],
  [kemarin(5), '2002', 'Budi', 'XI B', 'Hujan', 'Pak Anwar'],
];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
};

function loadServer() {
  const sheets = {
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], LATE_ROWS),
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

test('getStudentLateHistory: cache hit TIDAK men-scan sheet lagi', () => {
  const s = loadServer();

  const first = s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(first.status, 'success');
  assert.equal(first.count, 3, 'total sebenarnya siswa 1001 = 3 baris');
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1, 'panggilan pertama harus scan sheet sekali');

  // Cache sudah terisi dengan key latehist_<nisn>.
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'));

  const second = s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.deepEqual(second, first, 'hasil cache hit harus identik dengan hasil scan pertama');
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1, 'panggilan kedua (cache hit) TIDAK boleh scan sheet lagi');
});

test('getStudentLateHistory: cache TIDAK bocor antar-NISN (key terpisah, tetap 1 scan per NISN baru)', () => {
  const s = loadServer();
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1);

  const budi = s.get('admin', { action: 'getStudentLateHistory', nisn: '2002' });
  assert.equal(budi.count, 1, 'total sebenarnya siswa 2002 = 1 baris');
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 2, 'NISN berbeda = cache miss, scan baru');
});

test('getStudentLateHistory: cache dibuang setelah siswa yang sama dapat catatan baru (action record)', () => {
  const s = loadServer();

  const before = s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(before.count, 3);
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1);

  const rec = s.post('guru', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Terlambat bangun' });
  assert.equal(rec.status, 'success');
  // Cache untuk NISN ini harus sudah dibuang oleh action 'record'.
  assert.ok(!Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'), 'cache latehist_1001 harus dibuang setelah record baru');
  // action 'record' sendiri juga membaca Log_Gerbang sekali (cek duplikat
  // hari ini lewat getRowsSince, jalur terpisah -- lihat Code.gs) -- jadi
  // hitungan naik ke 2 di titik ini, bukan lagi karena getLateHistoryForStudent.
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 2);

  const after = s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(after.count, 4, 'badge harus langsung akurat, bukan basi sampai TTL 5 menit habis');
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 3, 'cache miss setelah invalidasi -> satu scan tambahan oleh getLateHistoryForStudent');
});

test('getStudentLateHistory: record untuk NISN LAIN tidak membuang cache NISN yang tidak terkait', () => {
  const s = loadServer();
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'));

  s.post('guru', { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI B', type: 'Hujan' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'), 'cache siswa lain tidak boleh ikut terbuang');
  // action 'record' membaca Log_Gerbang sekali sendiri (cek duplikat hari
  // ini via getRowsSince) -- naik jadi 2, bukan dari getLateHistoryForStudent.
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 2);

  // Cache hit tetap dipakai untuk NISN 1001, tidak scan ulang oleh
  // getLateHistoryForStudent.
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 2);
});

test('getStudentLateHistory: cache tetap MENTAH (raw), RBAC tidak berubah lintas pemanggil berbeda cakupan', () => {
  const s = loadServer();
  // Isi cache dulu lewat pemanggil sekolah-lebar (admin) -- kalau cache
  // menyimpan hasil yang SUDAH disaring untuk admin, guru biasa yang
  // memanggil berikutnya akan salah dapat riwayat lintas-kelas yang bukan
  // haknya (ini persis celah yang diperingatkan CLAUDE.md soal
  // today_logs/pelanggaran_list_raw).
  const admin = s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(admin.count, 3, 'admin: seluruh sekolah');

  const guru = s.get('guru', { action: 'getStudentLateHistory', nisn: '1001' });
  // Pak Anwar (guru biasa, bukan wali XI A) hanya berhak lihat baris HARI INI
  // -- semua baris fixture 1001 adalah hari-hari lalu, jadi guru biasa harus
  // dapat 0, BUKAN 3 (bukti cache bukan hasil admin yang dibagikan ulang).
  assert.equal(guru.count, 0, 'guru biasa tidak boleh mewarisi cakupan admin dari cache');
  assert.equal(guru.history.length, 0);

  const wali = s.get('wali', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(wali.count, 3, 'wali kelas XI A tetap dapat riwayat penuh kelasnya, dari cache yang sama');

  // Sheet cuma di-scan sekali walau dipanggil 3 pemakai berbeda, penyaringan
  // per-pemanggil terjadi SETELAH ambil dari cache, bukan sebelum disimpan.
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1);
});

test('getStudentLateHistory: cache dibuang lewat editEntry/deleteEntry kategori terlambat', () => {
  const s = loadServer();
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'));

  const target = s.sheets.Log_Gerbang._data[3]; // baris kemarin(5), NISN 1001
  const del = s.post('admin', { action: 'deleteEntry', category: 'terlambat', nisn: '1001', timestamp: target[0], name: 'Rahma' });
  assert.equal(del.status, 'success');
  assert.ok(!Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'), 'cache harus dibuang setelah baris dihapus');
});

test('getStudentLateHistory: NISN kosong/null/undefined TIDAK pernah masuk cache (selalu scan langsung)', () => {
  const s = loadServer();

  const kosong1 = s.get('admin', { action: 'getStudentLateHistory', nisn: '' });
  assert.equal(kosong1.status, 'success');
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 1);
  assert.ok(Object.keys(s.cacheStore).every((k) => !k.startsWith('latehist_')), 'NISN kosong tidak boleh menulis key cache latehist_ apa pun');

  // Request kedua ber-NISN kosong juga -- kalau ada cache key generik
  // (mis. "latehist_"), panggilan ini akan cache-hit dan TIDAK scan lagi.
  // Harus tetap scan, karena tidak pernah di-cache sama sekali.
  s.get('admin', { action: 'getStudentLateHistory', nisn: '' });
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 2, 'NISN kosong harus scan ulang tiap kali, tidak pernah cache hit');

  // Tanpa parameter nisn sama sekali (undefined) -- perilaku sama.
  s.get('admin', { action: 'getStudentLateHistory' });
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 3);
  assert.ok(Object.keys(s.cacheStore).every((k) => !k.startsWith('latehist_')), 'NISN undefined juga tidak boleh menulis key cache latehist_ apa pun');

  // NISN sungguhan tetap ke-cache seperti biasa setelah ini (bukti fungsi
  // skip-cache-nya spesifik ke kosong/null/undefined, bukan mematikan cache
  // untuk semua orang).
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.ok(Object.prototype.hasOwnProperty.call(s.cacheStore, 'latehist_1001'));
  s.get('admin', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(s.sheets.Log_Gerbang.getRangeCalls, 4, 'NISN sungguhan tetap cache hit, tidak scan ulang');
});
