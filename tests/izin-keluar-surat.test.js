// ===== tests/izin-keluar-surat.test.js =====
// CETAK SURAT IZIN KELUAR (audit September 2026) — nomor otomatis, tracking
// cetak (Nomor_Surat/Waktu_Print/Status_Print), konteks approval historis
// (dibaca dari Audit_Log, bukan dihitung ulang), dan verifikasi QR publik
// (action doGet 'verifyIzinSurat'), diuji lewat doPost()/doGet() SUNGGUHAN
// (Utils.gs+Auth.gs+Notifikasi.gs+Code.gs dijalankan di vm dengan layanan
// Apps Script di-stub — sandbox TERPISAH dari tests/izin-keluar.test.js
// supaya stub UrlFetchApp/ScriptApp/Utilities.base64Encode di sini tidak
// perlu ditambahkan ke setiap test file lain yang tidak pernah menyentuh
// jalur ini).
//
// Alur persetujuan/verifikasi/tandai-kembali ITU SENDIRI tidak diuji ulang
// di sini — itu sudah dipegang penuh oleh tests/izin-keluar.test.js. Yang
// diuji di sini murni fitur cetak: ia OUTPUT dari transaksi yang sudah
// tersimpan, tidak pernah mengubah status/transisi apa pun.

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

const now = new Date();
const TENGAH_MALAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
const SEJAK_TENGAH_MALAM = Math.max(1, now.getTime() - TENGAH_MALAM);
const hariIniJam = (slot) => new Date(TENGAH_MALAM + Math.floor((SEJAK_TENGAH_MALAM * slot) / 8));

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI_INI = HARI[now.getDay()];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' },
  pemberiIzin: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  piket: { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

const SISWA = [
  ['1001', 'Rahma', 'XI B'],
  ['2002', 'Budi', 'XI A'],
];

const IZIN_HEADER = [
  'Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
  'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID',
  'ID_Kelompok', 'Nomor_Surat', 'Waktu_Print', 'Status_Print',
];

// Fake blob PNG kecil — cukup untuk membuktikan base64 encode/embed jalan,
// isinya sendiri tidak diperiksa (bukan tugas test ini memvalidasi format PNG).
const FAKE_QR_BYTES = Buffer.from('fake-qr-png-bytes');

function loadServer(opts) {
  const options = opts || {};
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], [[HARI_INI, 'G10']]),
    Izin_Keluar: makeSheet(IZIN_HEADER, options.izinRows || []),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  let urlFetchCalls = 0;
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
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
    // Endpoint /exec dari deployment aktif — dipakai generateVerificationURL.
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE-DEPLOY/exec' }) },
    // Fetch QR (goqr.me) — TIDAK benar-benar memanggil jaringan, cukup
    // membuktikan generateQRCodeImage memproses respons sukses dengan benar.
    UrlFetchApp: {
      fetch: (url, opts2) => {
        urlFetchCalls++;
        if (options.qrFetchFails) return { getResponseCode: () => 500, getBlob: () => ({ getBytes: () => [] }) };
        return { getResponseCode: () => 200, getBlob: () => ({ getBytes: () => FAKE_QR_BYTES }) };
      },
    },
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
    parameter: Object.assign({ token: 'TOKEN-OK', sessionToken: who ? tokens[who] : undefined }, params),
  }).text);
  const getNoSession = (params) => JSON.parse(doGet({ parameter: Object.assign({ token: 'TOKEN-OK' }, params) }).text);

  const izinRows = () => sheets.Izin_Keluar._data.slice(1).filter((r) => r[4]);
  const izinById = (id) => izinRows().find((r) => String(r[4]) === String(id));
  const auditRows = () => sheets.Audit_Log._data.slice(1);
  const urlFetchCallCount = () => urlFetchCalls;

  return { sandbox, sheets, tokens, post, get, getNoSession, izinRows, izinById, auditRows, urlFetchCallCount };
}

// Setup helper: buat + verifikasi satu transaksi lewat alur normal, kembalikan id.
const setujuiDanVerifikasi = (s, tujuan) => {
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: tujuan || 'kembali', keperluan: 'kontrol ke puskesmas' });
  assert.equal(buat.status, 'success');
  const ver = s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'success');
  return buat.id;
};

// ============================================================
// Status yang boleh/tidak boleh dicetak
// ============================================================

test('generateIzinKeluarSurat: menolak status "Menunggu Verifikasi" (belum diverifikasi)', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ambil dokumen' });
  const cetak = s.post('wali', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'error');
  assert.match(cetak.message, /diverifikasi/i);
  assert.ok(!s.izinById(buat.id)[21], 'Nomor_Surat tidak boleh terisi untuk transaksi yang ditolak');
});

test('generateIzinKeluarSurat: menolak izinId yang tidak ada', () => {
  const s = loadServer();
  const cetak = s.post('wali', { action: 'generateIzinKeluarSurat', izinId: 'tidak-ada-id-ini' });
  assert.equal(cetak.status, 'error');
});

test('generateIzinKeluarSurat: OSIS ditolak', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'kembali');
  const cetak = s.post('osis', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.equal(cetak.status, 'error');
});

test('generateIzinKeluarSurat: sukses untuk status "Sedang di Luar"', () => {
  const s = loadServer();
  const idDiLuar = setujuiDanVerifikasi(s, 'kembali');
  const cetakDiLuar = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: idDiLuar });
  assert.equal(cetakDiLuar.status, 'success');
  assert.match(cetakDiLuar.data.htmlContent, /Sedang di Luar Sekolah/);
});

test('generateIzinKeluarSurat: sukses untuk status "Pulang" dan "Selesai"', () => {
  const s = loadServer();
  // Budi (2002) untuk tujuan pulang -- final langsung setelah verifikasi.
  const buatPulang = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'dijemput' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buatPulang.id });
  const cetakPulang = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buatPulang.id });
  assert.equal(cetakPulang.status, 'success');
  assert.match(cetakPulang.data.htmlContent, /Pulang/);

  // Rahma (1001) untuk tujuan kembali -> ditandai kembali -> 'Selesai'.
  const idKembali = setujuiDanVerifikasi(s, 'kembali');
  s.post('piket', { action: 'tandaiKembaliIzinKeluar', id: idKembali });
  const cetakSelesai = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: idKembali });
  assert.equal(cetakSelesai.status, 'success');
});

// ============================================================
// Nomor otomatis: format, urutan per hari, idempotency
// ============================================================

test('nomor surat: format IK-YYYYMMDD-NNN dan bertambah untuk transaksi berikutnya di hari yang sama', () => {
  const s = loadServer();
  const idA = setujuiDanVerifikasi(s, 'pulang');
  const cetakA = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: idA });
  assert.equal(cetakA.status, 'success');
  assert.match(cetakA.data.nomorSurat, /^IK-\d{8}-001$/);
  assert.equal(s.izinById(idA)[21], cetakA.data.nomorSurat, 'Nomor_Surat tersimpan di sheet');
  assert.equal(s.izinById(idA)[23], 'Sudah', 'Status_Print = Sudah');
  assert.ok(s.izinById(idA)[22], 'Waktu_Print terisi');

  const buatB = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'urusan keluarga' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buatB.id });
  const cetakB = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buatB.id });
  assert.equal(cetakB.status, 'success');
  assert.match(cetakB.data.nomorSurat, /^IK-\d{8}-002$/, 'urut kedua di hari yang sama harus 002');
});

test('nomor surat: idempotent -- cetak 2x transaksi yang sama, nomor TIDAK berubah', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  const pertama = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const kedua = s.post('wali', { action: 'generateIzinKeluarSurat', izinId: id }); // dicetak ulang orang lain, kapan saja
  assert.equal(pertama.data.nomorSurat, kedua.data.nomorSurat, 'nomor surat harus sama pada cetak ulang');
  assert.equal(s.izinRows().filter((r) => String(r[4]) === String(id)).length, 1, 'tidak ada baris baru/duplikat');
});

test('nomor surat: Waktu_Print diperbarui pada setiap cetak ulang (mencerminkan cetak TERAKHIR)', async () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const waktuPertama = new Date(s.izinById(id)[22]).getTime();
  await new Promise((r) => setTimeout(r, 5));
  s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const waktuKedua = new Date(s.izinById(id)[22]).getTime();
  assert.ok(waktuKedua >= waktuPertama, 'Waktu_Print cetak kedua tidak lebih lama dari yang pertama');
});

test('Audit Log mencatat setiap generateIzinKeluarSurat dengan nomor surat di Detail', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  const hasil = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const baris = s.auditRows().find((r) => r[3] === 'generateIzinKeluarSurat');
  assert.ok(baris, 'ada baris audit untuk generateIzinKeluarSurat');
  assert.match(baris[4], new RegExp('nomor=' + hasil.data.nomorSurat));
});

// ============================================================
// Konteks approval historis (Audit_Log, bukan hitung ulang)
// ============================================================

test('konteks_persetujuan: Wali Kelas untuk approver yang memang wali kelas siswa itu', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang'); // disetujui oleh 'wali' (Bu Kartina, wali kelas XI B == kelas Rahma)
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.equal(cetak.data.suratData.konteks_persetujuan, 'Wali Kelas');
});

test('konteks_persetujuan: Guru Mapel untuk approver yang bukan wali kelas siswa itu', () => {
  const s = loadServer();
  const buat = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'acara' }); // Pak Anwar bukan wali kelas Budi
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id });
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.data.suratData.konteks_persetujuan, 'Guru Mapel');
});

test('konteks_persetujuan: kosong untuk jalur khusus (dilabel "Izin Khusus oleh" di surat, bukan Wali Kelas/Guru Mapel)', () => {
  const s = loadServer();
  const buat = s.post('piket', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: 'darurat', jalur: 'khusus', alasan_khusus: 'wali kelas tidak tersedia' });
  assert.equal(buat.status, 'success');
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.equal(cetak.data.suratData.konteks_persetujuan, '');
  assert.match(cetak.data.htmlContent, /Izin Khusus oleh/);
  assert.doesNotMatch(cetak.data.htmlContent, /Wali Kelas|Guru Mapel/);
});

// ============================================================
// Keamanan HTML: keperluan/alasan bebas-teks harus di-escape
// ============================================================

test('renderIzinKeluarSuratHTML meng-escape keperluan yang mengandung tag HTML', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: '<script>alert(1)</script>' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id });
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.ok(!cetak.data.htmlContent.includes('<script>alert(1)</script>'), 'tag mentah tidak boleh lolos ke HTML surat');
  assert.ok(cetak.data.htmlContent.includes('&lt;script&gt;'), 'harus muncul dalam bentuk yang sudah di-escape');
});

// ============================================================
// QR & verifikasi publik (doGet verifyIzinSurat)
// ============================================================

test('surat memuat QR (data URI base64, bukan <img src> ke layanan luar) saat fetch QR sukses', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.match(cetak.data.htmlContent, /data:image\/png;base64,/);
  assert.ok(!/<img[^>]+src="https:\/\/api\.qrserver\.com/.test(cetak.data.htmlContent), 'tidak boleh ada <img> yang menunjuk langsung ke layanan QR luar');
  assert.equal(s.urlFetchCallCount(), 1, 'layanan QR luar hanya dihubungi SEKALI oleh server, bukan oleh setiap viewer');
});

test('surat tetap valid (tanpa QR) kalau fetch QR gagal -- pencetakan tidak boleh gagal karenanya', () => {
  const s = loadServer({ qrFetchFails: true });
  const id = setujuiDanVerifikasi(s, 'pulang');
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.equal(cetak.status, 'success', 'pembuatan surat tetap sukses walau QR gagal');
  assert.ok(!cetak.data.htmlContent.includes('data:image/png;base64,'));
});

test('verifyIzinSurat: valid untuk nomor yang cocok, TIDAK butuh sesi (dipindai siapa saja)', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const hasil = s.getNoSession({ action: 'verifyIzinSurat', id: id, nomor: cetak.data.nomorSurat });
  assert.equal(hasil.status, 'success');
  assert.equal(hasil.valid, true);
  assert.equal(hasil.nama, 'Rahma');
});

test('verifyIzinSurat: tidak valid kalau nomor tidak cocok (mencegah tebak-ID)', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const hasil = s.getNoSession({ action: 'verifyIzinSurat', id: id, nomor: 'IK-00000000-999' });
  assert.equal(hasil.valid, false);
});

test('verifyIzinSurat: tidak valid untuk id yang tidak ada', () => {
  const s = loadServer();
  const hasil = s.getNoSession({ action: 'verifyIzinSurat', id: 'ngawur', nomor: 'IK-00000000-001' });
  assert.equal(hasil.valid, false);
});

// ============================================================
// generateVerificationURL: endpoint /exec deployment aktif, bukan pola yang tidak valid
// ============================================================

test('QR menunjuk ke endpoint doGet verifyIzinSurat pada deployment aktif (ScriptApp.getService().getUrl())', () => {
  const s = loadServer();
  const generateVerificationURL = vm.runInContext('generateVerificationURL', s.sandbox);
  const url = generateVerificationURL('abc-123', 'IK-20260101-001');
  assert.match(url, /^https:\/\/script\.google\.com\/macros\/s\/FAKE-DEPLOY\/exec\?/);
  assert.match(url, /action=verifyIzinSurat/);
  assert.match(url, /id=abc-123/);
  assert.match(url, /nomor=IK-20260101-001/);
});
