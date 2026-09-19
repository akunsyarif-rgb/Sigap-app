// ===== tests/record-then-delete-timestamp.test.js =====
// Regresi untuk bug "Data tidak ditemukan (mungkin sudah diubah/dihapus
// pengguna lain)" saat hapus/edit dilakukan SEGERA setelah simpan.
//
// Akar masalah (lihat catatan di sekitar findRowByNisnTimestamp, Utils.gs,
// dan handleRecord/handleAddSurat/handleAddPelanggaran, app.js): dulu klien
// membuat timestamp SENDIRI (new Date() di browser, sebelum fetch dikirim)
// untuk entry yang baru disimpan, padahal server menulis Timestamp-nya
// SENDIRI (new Date() lain, saat appendRow) -- dua nilai itu bisa beda
// beberapa ratus ms sampai detik (network + antre sigapLock). editEntry/
// deleteEntry mencari baris lewat findRowByNisnTimestamp yang mencocokkan
// milidetik PERSIS, jadi kalau klien kirim timestamp client-nya sendiri,
// baris tidak pernah ketemu.
//
// Fix: action 'record'/'addSurat'/'addPelanggaran' sekarang mengembalikan
// `timestamp` (nilai PERSIS yang ditulis ke sheet) di respons sukses --
// klien wajib pakai nilai itu, bukan Date() sendiri, untuk edit/hapus
// berikutnya.
//
// Test ini mensimulasikan alur ASLI ujung-ke-ujung lewat doPost() sungguhan
// (bukan cek kode sumber): record/addSurat/addPelanggaran -> ambil
// `timestamp` dari respons -> LANGSUNG pakai nilai itu untuk
// deleteEntry/editEntry -> harus sukses. Kalau nanti ada yang refactor salah
// satu action catat itu dan lupa balikin `timestamp` lagi (atau balikin nilai
// yang tidak PERSIS sama dengan yang ditulis ke sheet), assert timestamp di
// bawah gagal duluan dengan pesan jelas, sebelum sempat menyesatkan ke
// kegagalan "Data tidak ditemukan" yang seolah-olah soal lain.

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
        getValue: () => { const src = data[row - 1] || []; return src[col - 1] === undefined ? '' : src[col - 1]; },
        setValue: (v) => { if (!data[row - 1]) data[row - 1] = []; data[row - 1][col - 1] = v; },
        setValues: () => {}, setNumberFormat() { return this; }, clearContent: () => {},
      };
    },
    appendRow(row) { data.push(row.slice()); },
    deleteRow(i) { data.splice(i - 1, 1); },
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

const USERS = {
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
};

function loadServer() {
  const sheets = {
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], []),
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], [['1001', 'Rahma', 'XI A']]),
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
  const doPost = vm.runInContext('doPost', sandbox);
  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, body)) },
  }).text);
  return { sheets, post };
}

test('record -> hapus SEGERA pakai timestamp dari respons -> sukses (bukan "Data tidak ditemukan")', () => {
  const s = loadServer();

  const rec = s.post('guru', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Kesiangan' });
  assert.equal(rec.status, 'success');
  // Kalau action 'record' nanti lupa mengembalikan timestamp lagi, assert ini
  // yang gagal duluan -- bukan delete-nya, supaya penyebabnya jelas.
  assert.ok(rec.timestamp, 'respons record harus menyertakan timestamp asli hasil appendRow');

  const del = s.post('guru', { action: 'deleteEntry', category: 'terlambat', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp });
  assert.equal(del.status, 'success', 'hapus segera setelah simpan, pakai timestamp dari respons, harus sukses');
  assert.equal(s.sheets.Log_Gerbang._data.length, 1, 'baris harus benar-benar terhapus (cuma sisa header)');
});

test('record -> edit SEGERA pakai timestamp dari respons -> sukses', () => {
  const s = loadServer();

  const rec = s.post('guru', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Kesiangan' });
  assert.ok(rec.timestamp);

  const edit = s.post('guru', { action: 'editEntry', category: 'terlambat', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp, type: 'Ban bocor' });
  assert.equal(edit.status, 'success', 'edit segera setelah simpan, pakai timestamp dari respons, harus sukses');
  assert.equal(s.sheets.Log_Gerbang._data[1][4], 'Ban bocor', 'kolom Alasan harus benar-benar berubah');
});

test('addSurat -> hapus & edit SEGERA pakai timestamp dari respons -> sukses', () => {
  const s = loadServer();

  const rec = s.post('guru', { action: 'addSurat', nisn: '1001', name: 'Rahma', class_name: 'XI A', jenis: 'Sakit', keterangan: 'Demam' });
  assert.equal(rec.status, 'success');
  assert.ok(rec.timestamp, 'respons addSurat harus menyertakan timestamp asli hasil appendRow');

  const edit = s.post('guru', { action: 'editEntry', category: 'surat', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp, jenis: 'Izin', keterangan: 'Acara keluarga' });
  assert.equal(edit.status, 'success');

  const del = s.post('guru', { action: 'deleteEntry', category: 'surat', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp });
  assert.equal(del.status, 'success');
  assert.equal(s.sheets.Surat_Masuk._data.length, 1);
});

test('addPelanggaran -> hapus & edit SEGERA pakai timestamp dari respons -> sukses', () => {
  const s = loadServer();

  const rec = s.post('guru', { action: 'addPelanggaran', nisn: '1001', name: 'Rahma', class_name: 'XI A', jenis_pelanggaran: 'Atribut', sanksi: 'Teguran' });
  assert.equal(rec.status, 'success');
  assert.ok(rec.timestamp, 'respons addPelanggaran harus menyertakan timestamp asli hasil appendRow');

  const edit = s.post('guru', { action: 'editEntry', category: 'pelanggaran', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp, jenis_pelanggaran: 'Bolos', sanksi: 'Panggilan Ortu', catatan: 'Bolos jam ke-3' });
  assert.equal(edit.status, 'success');

  const del = s.post('guru', { action: 'deleteEntry', category: 'pelanggaran', nisn: '1001', name: 'Rahma', timestamp: rec.timestamp });
  assert.equal(del.status, 'success');
  assert.equal(s.sheets.Pelanggaran._data.length, 1);
});

// Bukti negatif: kalau klien MEMANG kirim timestamp yang dia buat sendiri
// (bukan dari respons server) dan itu beda dari yang tertulis di sheet,
// hasilnya harus tetap gagal dengan pesan yang sama seperti sebelum fix --
// ini menegaskan test di atas benar-benar menguji mekanismenya, bukan
// kebetulan lolos karena server tidak lagi memvalidasi ketat.
test('kontrol negatif: timestamp client yang beda (bukan dari respons server) tetap ditolak "Data tidak ditemukan"', () => {
  const s = loadServer();

  const rec = s.post('guru', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Kesiangan' });
  assert.equal(rec.status, 'success');

  const timestampClientPalsu = new Date(new Date(rec.timestamp).getTime() + 250).toISOString();
  const del = s.post('guru', { action: 'deleteEntry', category: 'terlambat', nisn: '1001', name: 'Rahma', timestamp: timestampClientPalsu });
  assert.equal(del.status, 'error');
  assert.match(del.message, /Data tidak ditemukan/);
});
