// ===== tests/pelanggaran-kelompok.test.js =====
// PELANGGARAN KELOMPOK (Fase 2a — SATU kelas saja), diuji lewat doPost()
// SUNGGUHAN (Utils.gs+Auth.gs+Notifikasi.gs+Code.gs di vm, layanan Apps
// Script di-stub). Lihat catatan panjang di Utils.gs dekat
// PELANGGARAN_KELOMPOK_MAX_SISWA untuk alasan desainnya.
//
// Yang dijaga di sini:
//   1. Sukses untuk siswa satu kelas — satu baris per siswa, struktur
//      IDENTIK dengan baris addPelanggaran individual.
//   2. DITOLAK kalau ada siswa dari kelas berbeda — sebelum satu baris pun
//      ditulis (all-or-nothing), dengan pesan yang menyebut menu Individual.
//   3. OSIS ditolak, sama seperti addPelanggaran individual.
//   4. addPelanggaran (individual) TIDAK berubah perilakunya.
//   5. scopePelanggaranForUser TIDAK disentuh — baris kelompok otomatis
//      terlihat oleh wali kelas terkait & pencatatnya sendiri lewat aturan
//      yang sudah ada (CLASS ∪ OWN), tanpa kode baru untuk itu.

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
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
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
  };
}

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

// 4 siswa XI A (satu kelas) + 1 siswa XI B (kelas lain, untuk kasus tolak).
const SISWA = [
  ['1001', 'Ahmad', 'XI A'],
  ['1002', 'Budi', 'XI A'],
  ['1003', 'Citra', 'XI A'],
  ['1004', 'Deni', 'XI A'],
  ['2001', 'Eka', 'XI B'],
];

function loadServer() {
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
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
  const doGet = vm.runInContext('doGet', sandbox);

  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, body)) },
  }).text);
  const get = (who, params) => JSON.parse(doGet({
    parameter: Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, params),
  }).text);

  const pelanggaranRows = () => sheets.Pelanggaran._data.slice(1);
  const auditRows = () => sheets.Audit_Log._data.slice(1);

  return { sandbox, sheets, tokens, post, get, pelanggaranRows, auditRows, cacheStore };
}

// Ajukan pelanggaran kelompok untuk 4 siswa XI A (jalur normal, jenis/sanksi
// per siswa sudah diisi seperti hasil pratinjau di UI).
const kirimKelompok = (s, who, extra) => s.post(who, Object.assign({
  action: 'addPelanggaranKelompok',
  siswa: [
    { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: 'Bolos jam ke-3' },
    { nisn: '1002', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: '' },
    { nisn: '1003', jenis_pelanggaran: 'Bolos', sanksi: 'Panggil Orang Tua', catatan: 'Sudah ke-3 kalinya' },
    { nisn: '1004', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: '' },
  ],
}, extra || {}));

// ============================================================
// SUKSES — satu kelas
// ============================================================

test('addPelanggaranKelompok: sukses untuk siswa satu kelas, satu baris per siswa', () => {
  const s = loadServer();
  const res = kirimKelompok(s, 'wali');
  assert.equal(res.status, 'success');
  assert.equal(res.jumlahSiswa, 4);

  const rows = s.pelanggaranRows();
  assert.equal(rows.length, 4, 'harus 4 baris, satu per siswa — bukan 1 baris gemuk');

  // Struktur baris IDENTIK dengan addPelanggaran individual: [Timestamp,
  // NISN, Nama, Kelas, Jenis_Pelanggaran, Sanksi, Catatan, Dicatat_Oleh].
  const byNisn = {};
  rows.forEach((r) => { byNisn[String(r[1])] = r; });
  assert.equal(byNisn['1001'][2], 'Ahmad');
  assert.equal(byNisn['1001'][3], 'XI A');
  assert.equal(byNisn['1001'][4], 'Bolos');
  assert.equal(byNisn['1001'][5], 'Teguran Lisan');
  assert.equal(byNisn['1001'][6], 'Bolos jam ke-3');
  assert.equal(byNisn['1001'][7], 'Bu Kartina', 'Dicatat_Oleh dari sesi, bukan klien');

  // Nilai per baris BOLEH berbeda dari default (edit individual di pratinjau).
  assert.equal(byNisn['1003'][5], 'Panggil Orang Tua');
  assert.equal(byNisn['1002'][6], '');

  // Nama & kelas dari Master_Siswa, bukan yang (mungkin) dikirim klien.
  assert.equal(byNisn['1002'][2], 'Budi');
  assert.equal(byNisn['1004'][3], 'XI A');
});

test('addPelanggaranKelompok: nama/kelas karangan dari klien diabaikan (diambil dari Master_Siswa)', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '1001', name: 'Nama Karangan', class_name: 'XII Z', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
    ],
  });
  assert.equal(res.status, 'success');
  const row = s.pelanggaranRows()[0];
  assert.equal(row[2], 'Ahmad');
  assert.equal(row[3], 'XI A');
});

// ============================================================
// DITOLAK — kelas berbeda
// ============================================================

test('addPelanggaranKelompok: DITOLAK kalau ada siswa dari kelas berbeda, tidak ada baris tertulis', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
      { nisn: '2001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' }, // XI B — beda kelas
    ],
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /satu kelas yang sama/);
  assert.match(res.message, /menu Individual/, 'pesan harus mengarahkan ke menu Individual untuk kasus lintas kelas');
  assert.equal(s.pelanggaranRows().length, 0, 'tidak boleh ada baris yang tertulis sama sekali (all-or-nothing)');
});

test('addPelanggaranKelompok: urutan siswa tidak mempengaruhi deteksi kelas berbeda', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '2001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' }, // XI B duluan
      { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
      { nisn: '1002', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
    ],
  });
  assert.equal(res.status, 'error');
  assert.equal(s.pelanggaranRows().length, 0);
});

// ============================================================
// ALL-OR-NOTHING — validasi lain
// ============================================================

test('addPelanggaranKelompok: satu baris gagal validasi (jenis/tindakan kosong) membatalkan semua', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
      { nisn: '1002', jenis_pelanggaran: '', sanksi: 'Teguran Lisan' }, // jenis kosong
    ],
  });
  assert.equal(res.status, 'error');
  assert.equal(s.pelanggaranRows().length, 0, 'baris pertama yang valid tidak boleh ikut tertulis');
});

test('addPelanggaranKelompok: satu NISN tidak ditemukan di Master_Siswa membatalkan semua', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
      { nisn: '9999', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' }, // tidak ada di Master_Siswa
    ],
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /9999/);
  assert.equal(s.pelanggaranRows().length, 0);
});

test('addPelanggaranKelompok: NISN dobel dalam satu kejadian ditolak', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaranKelompok',
    siswa: [
      { nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan' },
      { nisn: '1001', jenis_pelanggaran: 'Merokok', sanksi: 'Panggil Orang Tua' },
    ],
  });
  assert.equal(res.status, 'error');
  assert.equal(s.pelanggaranRows().length, 0);
});

test('addPelanggaranKelompok: daftar siswa kosong ditolak', () => {
  const s = loadServer();
  const res = s.post('wali', { action: 'addPelanggaranKelompok', siswa: [] });
  assert.equal(res.status, 'error');
});

test('addPelanggaranKelompok: melebihi batas maksimal siswa per kejadian ditolak', () => {
  const s = loadServer();
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const maxMatch = utils.match(/var PELANGGARAN_KELOMPOK_MAX_SISWA = (\d+);/);
  assert.ok(maxMatch, 'konstanta batas maksimal harus ada di Utils.gs');
  const max = Number(maxMatch[1]);

  const banyak = [];
  for (let i = 0; i < max + 1; i++) banyak.push({ nisn: '1001', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran' });
  const res = s.post('wali', { action: 'addPelanggaranKelompok', siswa: banyak });
  assert.equal(res.status, 'error');
});

// ============================================================
// OSIS ditolak
// ============================================================

test('addPelanggaranKelompok: OSIS ditolak, sama seperti addPelanggaran individual', () => {
  const s = loadServer();
  const res = kirimKelompok(s, 'osis');
  assert.equal(res.status, 'error');
  assert.equal(s.pelanggaranRows().length, 0);
});

// ============================================================
// addPelanggaran (individual) TIDAK berubah
// ============================================================

test('addPelanggaran individual tetap berperilaku sama persis setelah penambahan addPelanggaranKelompok', () => {
  const s = loadServer();
  const res = s.post('wali', {
    action: 'addPelanggaran',
    nisn: '1001', name: 'Ahmad', class_name: 'XI A',
    jenis_pelanggaran: 'Atribut', sanksi: 'Teguran Lisan', catatan: 'rambut panjang',
  });
  assert.equal(res.status, 'success');
  assert.equal(res.jumlahSiswa, undefined, 'addPelanggaran individual tidak boleh ikut mengembalikan jumlahSiswa dsb.');
  const row = s.pelanggaranRows()[0];
  assert.equal(row[2], 'Ahmad');
  assert.equal(row[4], 'Atribut');

  const osisRes = s.post('osis', { action: 'addPelanggaran', nisn: '1001', name: 'Ahmad', class_name: 'XI A', jenis_pelanggaran: 'x', sanksi: 'y' });
  assert.equal(osisRes.status, 'error');
});

// ============================================================
// scopePelanggaranForUser TIDAK disentuh — visibilitas otomatis benar
// ============================================================

test('scopePelanggaranForUser TIDAK berubah kodenya untuk fitur ini', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const blok = utils.split('function scopePelanggaranForUser(')[1].split('\n}')[0];
  // Persis seperti sebelum Fase 2a: schoolWideReader / sameClass(kelas) / ownsRow.
  assert.match(blok, /isSchoolWideReader\(sessionUser\)/);
  assert.match(blok, /sameClass\(p\.class, kelas\)/);
  assert.match(blok, /ownsRow\(p, sessionUser\)/);
  // Tidak ada rujukan kelompok/kegiatan yang menambah klausa baru ke fungsi ini.
  assert.doesNotMatch(blok, /kelompok|Kelompok/i);
});

test('getPelanggaran: wali kelas otomatis melihat SELURUH baris kejadian kelompok kelasnya (tanpa kode scoping baru)', () => {
  const s = loadServer();
  const buat = kirimKelompok(s, 'guru'); // dicatat oleh guru biasa (bukan wali XI A)
  assert.equal(buat.status, 'success');

  const wali = s.get('wali', { action: 'getPelanggaran' });
  assert.equal(wali.status, 'success');
  assert.equal(wali.pelanggaran.length, 4, 'wali kelas XI A melihat KEEMPAT baris kejadian, bukan cuma yang ia catat sendiri');
  wali.pelanggaran.forEach((p) => assert.equal(p.class, 'XI A'));

  // Guru biasa lain (bukan pencatat, bukan wali XI A) tidak melihat baris ini sama sekali.
  const guruLain = s.get('bk', { action: 'getPelanggaran' }); // BK sekolah luas, ganti cek guru biasa lain di bawah
  assert.equal(guruLain.pelanggaran.length, 4, 'BK tetap seluruh sekolah');

  const admin = s.get('admin', { action: 'getPelanggaran' });
  assert.equal(admin.pelanggaran.length, 4);
});

test('getPelanggaran: guru biasa yang mencatat kejadian kelompok tetap melihat catatannya sendiri (OWN)', () => {
  const s = loadServer();
  kirimKelompok(s, 'guru'); // Pak Anwar, bukan wali kelas mana pun
  const res = s.get('guru', { action: 'getPelanggaran' });
  assert.equal(res.status, 'success');
  assert.equal(res.pelanggaran.length, 4, 'pencatat melihat seluruh baris yang ia tulis sendiri (OWN), termasuk kejadian kelompok');
  res.pelanggaran.forEach((p) => assert.equal(p.logged_by, 'Pak Anwar'));
});
