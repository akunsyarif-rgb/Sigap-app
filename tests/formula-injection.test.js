// ===== tests/formula-injection.test.js =====
// Formula/CSV Injection: field bebas teks yang ditulis ke Sheet HARUS lolos
// lewat sanitizeSheetValue() (Utils.gs) kalau karakter pertamanya =, +, -,
// atau @ — kalau tidak, membuka sheet-nya di Google Sheets/Excel akan
// MENGEKSEKUSI teks itu sebagai formula. Lihat CLAUDE.md bagian investigasi
// keamanan untuk daftar 8 titik tulis yang diperiksa di sini.
//
// Dijalankan lewat doPost() SUNGGUHAN (Utils.gs+Auth.gs+Notifikasi.gs+Code.gs
// di vm, layanan Apps Script di-stub) — pola sama seperti tests/izin-keluar.test.js
// — supaya yang diuji benar-benar baris yang ditulis ke Sheet, bukan cuma
// fungsi sanitizeSheetValue() dalam isolasi.

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
    getLastRow: () => data.length,
    getLastColumn: () => header.length,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange(row, col, numRows, numCols) {
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
        setValue(v) { while (data.length < row) data.push([]); data[row - 1][col - 1] = v; },
        setNumberFormat() { return this; },
        setValues(vals) {
          for (let r = 0; r < vals.length; r++) {
            while (data.length < row + r) data.push([]);
            for (let c = 0; c < vals[r].length; c++) data[row + r - 1][col + c - 1] = vals[r][c];
          }
        },
        clearContent() {
          for (let r = row; r < row + numRows; r++) {
            for (let c = col; c < col + numCols; c++) if (data[r - 1]) data[r - 1][c - 1] = '';
          }
        },
      };
    },
    deleteRow(i) { data.splice(i - 1, 1); },
    appendRow(row) { data.push(row.slice()); },
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  guru: { id: 'G02', name: 'Pak Guru', role: 'guru', jabatan: '', waliKelas: '' },
};

const SISWA = [
  ['1001', 'Rahma', 'XI B'],
  ['2002', 'Budi', 'XI A'],
  ['3003', 'Citra', 'XII C'],
];

function loadServer() {
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], []),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], []),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
    Izin_Keluar: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus'], []),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
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
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => { sheets[n] = makeSheet(['kosong'], []); sheets[n]._data.length = 0; return sheets[n]; },
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
  const doPost = vm.runInContext('doPost', sandbox);

  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, body)) },
  }).text);

  const lastRow = (sheetName) => sheets[sheetName]._data[sheets[sheetName]._data.length - 1];

  return { sandbox, sheets, tokens, post, lastRow };
}

// Payload yang, kalau ditulis mentah ke sel Sheet, dibaca Google Sheets/Excel
// sebagai AWAL formula, bukan teks.
const PAYLOAD_BERBAHAYA = ['=1+1', '+CMD|"/c calc"!A1', '-2+3', '@SUM(1+1)'];

test('record (Keterlambatan): alasan custom berbahaya diberi prefix kutip satu', () => {
  PAYLOAD_BERBAHAYA.forEach((payload, i) => {
    const s = loadServer();
    const res = s.post('guru', { action: 'record', nisn: SISWA[i % SISWA.length][0], name: SISWA[i % SISWA.length][1], class_name: SISWA[i % SISWA.length][2], type: payload });
    assert.equal(res.status, 'success');
    const row = s.lastRow('Log_Gerbang');
    assert.equal(row[4], "'" + payload, 'kolom Alasan/type harus diberi prefix kutip satu');
  });
});

test('addSurat: keterangan & jenis berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('guru', { action: 'addSurat', nisn: '1001', name: 'Rahma', class_name: 'XI B', jenis: '=HYPERLINK("http://evil")', keterangan: '+CMD|demam' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Surat_Masuk');
  assert.equal(row[4], "'=HYPERLINK(\"http://evil\")");
  assert.equal(row[5], "'+CMD|demam");
});

test('addPelanggaran (individual): sanksi & catatan berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('guru', { action: 'addPelanggaran', nisn: '2002', name: 'Budi', class_name: 'XI A', jenis_pelanggaran: 'Atribut', sanksi: '-2+3', catatan: '@SUM(A1:A9)' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Pelanggaran');
  assert.equal(row[5], "'-2+3");
  assert.equal(row[6], "'@SUM(A1:A9)");
});

test('addPelanggaranKelompok: sanksi & catatan per-siswa berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('guru', {
    action: 'addPelanggaranKelompok',
    siswa: [{ nisn: '1001', jenis_pelanggaran: 'Atribut', sanksi: '=1+1', catatan: '+CMD|x' }],
  });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Pelanggaran');
  assert.equal(row[5], "'=1+1");
  assert.equal(row[6], "'+CMD|x");
});

test('addBimbingan: catatan berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('bk', { action: 'addBimbingan', nisn: '3003', name: 'Citra', class_name: 'XII C', catatan: '=SUM(1+1)' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Bimbingan_Khusus');
  assert.equal(row[4], "'=SUM(1+1)");
});

test('addPelanggaranUpacara: catatan berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('bk', { action: 'addPelanggaranUpacara', nisn: '1001', name: 'Rahma', class_name: 'XI B', jenis_pelanggaran: 'Terlambat Baris', catatan: '@SUM(1+1)' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Pelanggaran_Upacara');
  assert.equal(row[5], "'@SUM(1+1)");
});

test('ajukanTindakLanjut: catatan berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('bk', { action: 'ajukanTindakLanjut', nisn: '2002', name: 'Budi', class_name: 'XI A', catatan: '-2+3' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Tindak_Lanjut');
  assert.equal(row[4], "'-2+3");
});

test('addIzinKeluar: keperluan & alasan_khusus (jalur khusus) berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('bk', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: '=1+1', jalur: 'khusus', alasan_khusus: '+CMD|x' });
  assert.equal(res.status, 'success');
  const row = s.lastRow('Izin_Keluar');
  assert.equal(row[5], "'=1+1", 'kolom Keperluan');
  assert.equal(row[9], "'+CMD|x", 'kolom Alasan_Khusus');
});

test('addIzinKelompok: kegiatan, keperluan & alasan_khusus berbahaya diberi prefix kutip satu', () => {
  const s = loadServer();
  const res = s.post('bk', {
    action: 'addIzinKelompok',
    kegiatan: '@SUM(1+1)',
    tujuan: 'kembali',
    keperluan: '=1+1',
    jalur: 'khusus',
    alasan_khusus: '-2+3',
    peserta: [{ nisn: '2002' }],
  });
  assert.equal(res.status, 'success');
  const kelRow = s.lastRow('Izin_Kelompok');
  assert.equal(kelRow[2], "'@SUM(1+1)", 'kolom Kegiatan di Izin_Kelompok');
  assert.equal(kelRow[4], "'=1+1", 'kolom Keperluan di Izin_Kelompok');
  assert.equal(kelRow[8], "'-2+3", 'kolom Alasan_Khusus di Izin_Kelompok');
  const pesertaRow = s.lastRow('Izin_Keluar');
  assert.equal(pesertaRow[5], "'=1+1", 'kolom Keperluan di baris peserta Izin_Keluar');
  assert.equal(pesertaRow[9], "'-2+3", 'kolom Alasan_Khusus di baris peserta Izin_Keluar');
});

// ---- Anti false-positive: teks normal (tidak diawali =+-@) tidak boleh
// berubah sama sekali — sanitizeSheetValue tidak boleh menyentuh data sehari-hari. ----
test('teks normal (tidak diawali =, +, -, @) tidak diubah sama sekali', () => {
  const s = loadServer();
  const res1 = s.post('guru', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI B', type: 'Terlambat bangun' });
  assert.equal(res1.status, 'success');
  assert.equal(s.lastRow('Log_Gerbang')[4], 'Terlambat bangun');

  const res2 = s.post('guru', { action: 'addPelanggaran', nisn: '2002', name: 'Budi', class_name: 'XI A', jenis_pelanggaran: 'Atribut', sanksi: 'Teguran lisan', catatan: 'Tidak pakai dasi, sudah ditegur.' });
  assert.equal(res2.status, 'success');
  const row2 = s.lastRow('Pelanggaran');
  assert.equal(row2[5], 'Teguran lisan');
  assert.equal(row2[6], 'Tidak pakai dasi, sudah ditegur.');

  const res3 = s.post('bk', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol ke puskesmas' });
  assert.equal(res3.status, 'success');
  assert.equal(s.lastRow('Izin_Keluar')[5], 'kontrol ke puskesmas');
});

test('sanitizeSheetValue: kasus tepi (kosong, undefined, angka, hanya prefix di tengah)', () => {
  const s = loadServer();
  const sanitize = vm.runInContext('sanitizeSheetValue', s.sandbox);
  assert.equal(sanitize(''), '');
  assert.equal(sanitize(undefined), '');
  assert.equal(sanitize(null), '');
  assert.equal(sanitize('biasa = tidak diawali'), 'biasa = tidak diawali');
  assert.equal(sanitize('=bahaya'), "'=bahaya");
  assert.equal(sanitize('+bahaya'), "'+bahaya");
  assert.equal(sanitize('-bahaya'), "'-bahaya");
  assert.equal(sanitize('@bahaya'), "'@bahaya");
});
