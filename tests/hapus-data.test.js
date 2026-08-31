// ===== tests/hapus-data.test.js =====
// Pemeliharaan Data > Hapus Data — evolusi dari aksi lama 'deleteSurat'
// ("Hapus Data Surat per Bulan/Tahun": satu sheet, satu bulan/tahun, tanpa
// pratinjau) menjadi Tanggal Mulai - Tanggal Selesai bebas, beberapa jenis
// data sekaligus, dengan pratinjau WAJIB (action 'previewHapusData' di
// doGet) sebelum eksekusi (action 'hapusDataPeriode' di doPost).
//
// Sama seperti tests/izin-keluar.test.js & tests/export-backend.test.js,
// file ini memuat Utils.gs/Auth.gs/Code.gs yang SUNGGUHAN lewat
// vm.runInContext dengan layanan Apps Script di-stub, lalu memanggil
// doGet()/doPost() persis seperti Web App memanggilnya — jadi yang diuji
// benar-benar kode yang nanti jalan di Apps Script, termasuk urutan
// pemeriksaannya (sesi -> otorisasi -> validasi periode -> validasi jenis ->
// konfirmasi -> hitung ulang & hapus), bukan tiruan logikanya.
//
// Yang dijaga file ini:
// - hanya admin yang boleh melihat pratinjau ATAU menghapus (BK/guru/OSIS
//   ditolak, walau BK punya akses Export Data untuk jenis yang sama)
// - periode kosong/tidak valid & tanggal mulai > selesai ditolak
// - tidak ada jenis data yang ditolak
// - pratinjau menghitung tanpa menghapus apa pun (0 data & beberapa kategori)
// - eksekusi HANYA menghapus baris dalam rentang, kategori lain & data di
//   luar periode tetap aman
// - manipulasi payload klien (jenis tidak dikenal, confirm hilang/palsu)
//   tidak diterima begitu saja
// - double-click/double request bersifat idempotent (permintaan kedua tidak
//   menghapus apa pun lagi)
// - race condition pratinjau vs eksekusi: eksekusi menghitung ULANG dari
//   sheet, bukan memakai angka pratinjau yang sudah basi
// - setiap percobaan (berhasil/ditolak/kosong) tercatat di Audit Log, tanpa
//   nama/NISN siswa
// - Export Data yang sudah ada tetap berfungsi berdampingan (tidak rusak)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// Sheet tiruan yang BENAR-BENAR menyimpan hasil tulis (deleteRow/appendRow) —
// sama persis dengan mock di tests/izin-keluar.test.js, karena di sini yang
// diuji justru baris mana yang hilang/tetap ada.
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
        setValues(vals) {
          for (let r = 0; r < vals.length; r++) {
            while (data.length < row + r) data.push([]);
            for (let c = 0; c < vals[r].length; c++) data[row + r - 1][col + c - 1] = vals[r][c];
          }
        },
        clearContent() {},
      };
    },
    deleteRow(i) { data.splice(i - 1, 1); },
    appendRow(row) { data.push(row.slice()); },
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

const D = (iso) => new Date(iso);

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

function buildSheets() {
  return {
    // Baris Januari (dalam rentang uji "01-31 Jan 2026") + satu baris
    // Desember 2025 & satu baris Februari 2026 (di luar rentang, harus
    // selalu aman) per sheet.
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
        [D('2025-12-08T09:00:00'), '1001', 'Rahma', 'XI A', 'Atribut', 'Teguran Lisan', 'dasi', 'Bu Kartina'],
        [D('2026-01-09T09:00:00'), '2002', 'Budi', 'XI B', 'Bolos', 'Panggilan Ortu', '', 'Pak Anwar'],
      ]
    ),
    Surat_Masuk: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'],
      [
        [D('2026-01-10T08:00:00'), '1001', 'Rahma', 'XI A', 'Sakit', 'demam', '', 'Bu Kartina'],
        [D('2026-02-01T08:00:00'), '2002', 'Budi', 'XI B', 'Sakit', 'flu', '', 'Pak Anwar'],
      ]
    ),
    Izin_Keluar: makeSheet(
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
        'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan', 'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID',
        'Waktu_Verifikasi', 'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID', 'ID_Kelompok'],
      [
        [D('2026-01-14T09:00:00'), '1001', 'Rahma', 'XI A', 'IZ-1', 'kontrol', 'kembali', 'Selesai', 'normal', '',
          'Bu Kartina', 'G02', D('2026-01-14T09:00:00'), 'Pak Piket', 'G10', D('2026-01-14T09:05:00'),
          D('2026-01-14T09:05:00'), D('2026-01-14T11:30:00'), 'Bu Piket', 'G11', ''],
        [D('2026-03-01T08:00:00'), '2002', 'Budi', 'XI B', 'IZ-2', 'lain', 'kembali', 'Selesai', 'normal', '',
          'Pak Anwar', 'G03', D('2026-03-01T08:00:00'), 'Pak Piket', 'G10', D('2026-03-01T08:05:00'),
          D('2026-03-01T08:05:00'), D('2026-03-01T09:00:00'), 'Pak Piket', 'G10', ''],
      ]
    ),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
}

function loadServer(sheetsOverride) {
  const sheets = sheetsOverride || buildSheets();
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
  ['Utils.gs', 'Auth.gs', 'Code.gs'].forEach((f) => {
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

  const preview = (who, { jenis, start, end }) => get(who, { action: 'previewHapusData', jenis: (jenis || []).join(','), start, end });
  const hapus = (who, { jenis, start, end, confirm }) => post(who, { action: 'hapusDataPeriode', jenis, start, end, confirm });

  return { sandbox, sheets, tokens, post, get, preview, hapus, audit: () => sheets.Audit_Log.appended || sheets.Audit_Log._data.slice(1) };
}

const JAN = { start: '2026-01-01', end: '2026-01-31' };

// ================= OTORISASI =================

test('Hapus Data: hanya admin yang boleh melihat pratinjau', () => {
  const s = loadServer();
  const admin = s.preview('admin', { jenis: ['keterlambatan'], ...JAN });
  assert.equal(admin.status, 'success');

  ['bk', 'wali', 'guru', 'osis'].forEach((who) => {
    const res = s.preview(who, { jenis: ['keterlambatan'], ...JAN });
    assert.equal(res.status, 'error', who + ' tidak boleh melihat pratinjau hapus data');
    assert.equal(res.counts, undefined);
  });
});

test('Hapus Data: hanya admin yang boleh mengeksekusi — BK TIDAK cukup, walau BK punya akses Export Data untuk jenis yang sama', () => {
  const s = loadServer();
  ['bk', 'wali', 'guru', 'osis'].forEach((who) => {
    const res = s.hapus(who, { jenis: ['keterlambatan'], ...JAN, confirm: true });
    assert.equal(res.status, 'error', who + ' tidak boleh menghapus data');
    assert.match(res.message, /admin/i);
  });
  // Tidak ada satu baris pun yang hilang akibat percobaan-percobaan di atas.
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6);
});

// ================= VALIDASI PERIODE & JENIS =================

test('Hapus Data: periode kosong/tidak valid ditolak', () => {
  const s = loadServer();
  assert.equal(s.preview('admin', { jenis: ['keterlambatan'], start: '', end: '' }).status, 'error');
  assert.equal(s.preview('admin', { jenis: ['keterlambatan'], start: '2026-02-31', end: '2026-03-01' }).status, 'error', 'tanggal yang tidak ada di kalender ditolak');
  assert.equal(s.hapus('admin', { jenis: ['keterlambatan'], start: '', end: '', confirm: true }).status, 'error');
});

test('Hapus Data: tanggal mulai lebih besar dari tanggal selesai ditolak', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['keterlambatan'], start: '2026-01-31', end: '2026-01-01', confirm: true });
  assert.equal(res.status, 'error');
  assert.match(res.message, /tidak boleh melewati/i);
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6, 'tidak ada yang terhapus');
});

test('Hapus Data: tidak ada jenis data dipilih ditolak', () => {
  const s = loadServer();
  assert.equal(s.preview('admin', { jenis: [], ...JAN }).status, 'error');
  assert.equal(s.hapus('admin', { jenis: [], ...JAN, confirm: true }).status, 'error');
  // Jenis yang tidak dikenal (typo/field lama) diperlakukan sama seperti
  // tidak memilih apa pun — dibuang diam-diam, bukan diproses.
  assert.equal(s.preview('admin', { jenis: ['auditlog', 'bimbingan'], ...JAN }).status, 'error');
});

test('Hapus Data: konfirmasi eksplisit wajib — tanpa confirm:true, eksekusi ditolak dan tidak menghapus apa pun', () => {
  const s = loadServer();
  const tanpaConfirm = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN });
  assert.equal(tanpaConfirm.status, 'error');
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6);

  const confirmPalsu = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: false });
  assert.equal(confirmPalsu.status, 'error');
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6);
});

// ================= PRATINJAU =================

test('Hapus Data: pratinjau menghasilkan nol data untuk periode yang tidak ada catatannya, dan tidak menghapus apa pun', () => {
  const s = loadServer();
  const res = s.preview('admin', { jenis: ['keterlambatan', 'pelanggaran', 'surat', 'izin'], start: '2020-01-01', end: '2020-01-31' });
  assert.equal(res.status, 'success');
  assert.equal(res.total, 0);
  assert.deepEqual(res.counts, { keterlambatan: 0, pelanggaran: 0, surat: 0, izin: 0 });
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6, 'pratinjau murni baca, tidak menghapus apa pun');
});

test('Hapus Data: pratinjau menghitung beberapa kategori sekaligus dengan benar', () => {
  const s = loadServer();
  const res = s.preview('admin', { jenis: ['keterlambatan', 'pelanggaran', 'surat'], ...JAN });
  assert.equal(res.status, 'success');
  assert.equal(res.counts.keterlambatan, 3, 'tiga baris Log_Gerbang di Januari 2026');
  assert.equal(res.counts.pelanggaran, 1, 'satu baris Pelanggaran di Januari 2026');
  assert.equal(res.counts.surat, 1, 'satu baris Surat_Masuk di Januari 2026');
  assert.equal(res.total, 5);
  // Jenis yang tidak diminta tidak ikut dihitung.
  assert.equal(res.counts.izin, undefined);
});

// ================= EKSEKUSI: HANYA MENGHAPUS DALAM RENTANG =================

test('Hapus Data: eksekusi hanya menghapus baris dalam rentang, data di luar periode tetap aman', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  assert.equal(res.status, 'success');
  assert.equal(res.counts.keterlambatan, 3);
  assert.equal(res.total, 3);

  const sisa = s.sheets.Log_Gerbang._data.slice(1).map((r) => r[0].toISOString());
  assert.equal(sisa.length, 2, '6 baris awal - 3 terhapus = 2 tersisa');
  assert.ok(sisa.includes(D('2025-12-20T07:10:00').toISOString()), 'baris Desember (sebelum periode) tetap ada');
  assert.ok(sisa.includes(D('2026-02-10T07:15:00').toISOString()), 'baris Februari (sesudah periode) tetap ada');
});

test('Hapus Data: menghapus satu kategori tidak memengaruhi kategori lain', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['pelanggaran'], ...JAN, confirm: true });
  assert.equal(res.status, 'success');
  assert.equal(res.counts.pelanggaran, 1);
  assert.equal(res.total, 1);

  // Log_Gerbang, Surat_Masuk, Izin_Keluar semuanya utuh persis seperti fixture awal.
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 6);
  assert.equal(s.sheets.Surat_Masuk.getLastRow(), 3);
  assert.equal(s.sheets.Izin_Keluar.getLastRow(), 3);
});

test('Hapus Data: beberapa kategori sekaligus dalam satu eksekusi', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['keterlambatan', 'surat'], ...JAN, confirm: true });
  assert.equal(res.status, 'success');
  assert.equal(res.counts.keterlambatan, 3);
  assert.equal(res.counts.surat, 1);
  assert.equal(res.total, 4);
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 3, '5 data + header - 3 terhapus = 3 tersisa (termasuk header)');
  assert.equal(s.sheets.Surat_Masuk.getLastRow(), 2, '2 data + header - 1 terhapus = 2 tersisa (termasuk header)');
  // Kategori yang tidak diminta (Pelanggaran) tidak tersentuh.
  assert.equal(s.sheets.Pelanggaran.getLastRow(), 3);
});

// ================= MANIPULASI PAYLOAD =================

test('Hapus Data: jenis tidak dikenal dari klien dibuang, bukan diproses atau membuat sheet baru', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['keterlambatan', 'sheet_rahasia', 'auditlog'], ...JAN, confirm: true });
  assert.equal(res.status, 'success');
  assert.deepEqual(Object.keys(res.counts), ['keterlambatan']);
  assert.equal(res.counts.keterlambatan, 3);
  assert.equal(s.sheets.Audit_Log.getLastRow() >= 1, true);
  // Audit_Log sendiri tidak pernah ikut jadi sasaran penghapusan.
  assert.ok(s.sheets.Audit_Log.getLastRow() >= 1, 'Audit_Log tetap ada, tidak terhapus oleh aksi ini');
});

test('Hapus Data: string jenis tunggal (bukan array) tetap diterima — kompatibel dengan query string doGet', () => {
  const s = loadServer();
  const res = s.get('admin', { action: 'previewHapusData', jenis: 'keterlambatan', ...JAN });
  assert.equal(res.status, 'success');
  assert.equal(res.counts.keterlambatan, 3);
});

// ================= DOUBLE-CLICK / IDEMPOTENT =================

test('Hapus Data: double-click/double request bersifat idempotent — permintaan kedua tidak menghapus apa pun lagi', () => {
  const s = loadServer();
  const pertama = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  assert.equal(pertama.total, 3);
  const kedua = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  assert.equal(kedua.status, 'success');
  assert.equal(kedua.total, 0, 'baris yang sama sudah terhapus di permintaan pertama');
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 3);
});

// ================= RACE CONDITION: PRATINJAU vs EKSEKUSI =================

test('Hapus Data: eksekusi menghitung ULANG dari sheet, tidak pernah memakai angka pratinjau yang sudah basi', () => {
  const s = loadServer();
  const pratinjau = s.preview('admin', { jenis: ['keterlambatan'], ...JAN });
  assert.equal(pratinjau.total, 3);

  // Simulasikan guru piket mencatat siswa baru SETELAH pratinjau dibaca
  // admin, tapi SEBELUM admin menekan tombol hapus.
  s.sheets.Log_Gerbang.appendRow([D('2026-01-25T07:00:00'), '3003', 'Citra', 'XII C', 'Telat', 'Bu Kartina']);

  const eksekusi = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  assert.equal(eksekusi.status, 'success');
  assert.equal(eksekusi.counts.keterlambatan, 4, 'baris baru yang masuk setelah pratinjau ikut terhitung & terhapus — angka pratinjau tidak pernah dipercaya');
  assert.equal(eksekusi.total, 4);
});

// ================= AUDIT LOG =================

test('Hapus Data: eksekusi berhasil tercatat di Audit Log dengan metadata saja (tanpa nama/NISN siswa)', () => {
  const s = loadServer();
  s.hapus('admin', { jenis: ['keterlambatan', 'surat'], ...JAN, confirm: true });
  const rows = s.audit();
  const last = rows[rows.length - 1];
  assert.equal(last[1], 'Pak Admin');
  assert.equal(last[3], 'Hapus Data Massal');
  assert.match(last[4], /periode=/);
  assert.match(last[4], /total=4/);
  assert.doesNotMatch(last[4], /1001|2002|Rahma|Budi/, 'detail Audit Log tidak boleh memuat nama/NISN siswa');
});

test('Hapus Data: eksekusi tanpa hasil (0 data) tetap tercatat, dengan label berbeda dari yang berhasil menghapus', () => {
  const s = loadServer();
  const res = s.hapus('admin', { jenis: ['keterlambatan'], start: '2020-01-01', end: '2020-01-31', confirm: true });
  assert.equal(res.total, 0);
  const rows = s.audit();
  const last = rows[rows.length - 1];
  assert.equal(last[3], 'Hapus Data Massal Kosong');
});

test('Hapus Data: percobaan yang ditolak (bukan admin, periode tidak valid, jenis kosong) tetap tercatat di Audit Log', () => {
  const s = loadServer();
  s.hapus('guru', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  s.hapus('admin', { jenis: ['keterlambatan'], start: '2026-01-31', end: '2026-01-01', confirm: true });
  s.hapus('admin', { jenis: [], ...JAN, confirm: true });
  const aksi = s.audit().map((r) => r[3]);
  assert.equal(aksi.filter((a) => a === 'Hapus Data Ditolak').length, 3);
});

// ================= KOMPATIBILITAS: EXPORT DATA TIDAK RUSAK =================

test('Hapus Data: fitur Export Data yang sudah ada tetap berfungsi berdampingan (aksi berbeda, tidak saling mengganggu)', () => {
  const s = loadServer();
  const laporan = s.get('admin', { action: 'exportData', jenis: 'keterlambatan', ...JAN, format: 'pdf' });
  assert.equal(laporan.status, 'success');
  assert.equal(laporan.report.total, 3);

  // Setelah Hapus Data berjalan, Export Data tetap berfungsi dan mencerminkan
  // sisa data yang benar (tidak ada state yang bocor antar aksi).
  s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  const laporanSetelah = s.get('admin', { action: 'exportData', jenis: 'keterlambatan', ...JAN, format: 'pdf' });
  assert.equal(laporanSetelah.status, 'success');
  assert.equal(laporanSetelah.report.total, 0);
});

// ================= PAGAR VOLUME =================

test('Hapus Data: volume yang melebihi batas ditolak SEBELUM satu baris pun terhapus', () => {
  const banyak = [];
  for (let i = 0; i < 3005; i++) {
    banyak.push([D('2026-01-01T00:00:00'), String(1000 + i), 'Siswa ' + i, 'XI A', 'Telat', 'Bu Kartina']);
  }
  const sheets = buildSheets();
  sheets.Log_Gerbang = makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], banyak);
  const s = loadServer(sheets);
  const res = s.hapus('admin', { jenis: ['keterlambatan'], ...JAN, confirm: true });
  assert.equal(res.status, 'error');
  assert.match(res.message, /terlalu banyak/i);
  assert.equal(s.sheets.Log_Gerbang.getLastRow(), 3006, 'tidak ada satu baris pun yang terhapus saat pagar volume terpicu');
});
