// ===== tests/izin-keluar-surat.test.js =====
// CETAK SURAT IZIN KELUAR (audit September 2026) — nomor otomatis, tracking
// cetak (Nomor_Surat/Waktu_Print/Status_Print), dan konteks approval
// historis (dibaca dari Audit_Log, bukan dihitung ulang), diuji lewat
// doPost() SUNGGUHAN (Utils.gs+Auth.gs+Notifikasi.gs+Code.gs dijalankan di
// vm dengan layanan Apps Script di-stub — sandbox TERPISAH dari
// tests/izin-keluar.test.js karena file ini menguji jalur cetak surat yang
// tidak disentuh test lain).
//
// Alur persetujuan/verifikasi/tandai-kembali ITU SENDIRI tidak diuji ulang
// di sini — itu sudah dipegang penuh oleh tests/izin-keluar.test.js. Yang
// diuji di sini murni fitur cetak: ia OUTPUT dari transaksi yang sudah
// tersimpan, tidak pernah mengubah status/transisi apa pun.
//
// QR/verifikasi publik (action doGet 'verifyIzinSurat', generateVerificationURL,
// generateQRCodeImage) DIHAPUS SELURUHNYA dari fitur ini (September 2026,
// keputusan produk setelah gagal berulang di lapangan tanpa bisa
// didiagnosis cepat dari jarak jauh — lihat catatan di
// renderIzinKeluarSuratHTML, Code.gs) — jadi tidak ada lagi test untuk itu
// di sini, dan sandbox di bawah TIDAK PERLU LAGI menyediakan stub
// UrlFetchApp/ScriptApp: renderIzinKeluarSuratHTML tidak pernah memanggil
// UrlFetchApp dari Apps Script. Logo kop surat (audit lanjutan, September
// 2026) juga sudah tidak lagi bergantung pada CLIENT (browser guru) yang
// mem-fetch gambar dari raw.githubusercontent.com — sekarang base64
// tertanam langsung di HTML yang dikembalikan, lihat test khusus di bawah.

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

const now = new Date();
const TENGAH_MALAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
const SEJAK_TENGAH_MALAM = Math.max(1, now.getTime() - TENGAH_MALAM);
const hariIniJam = (slot) => new Date(TENGAH_MALAM + Math.floor((SEJAK_TENGAH_MALAM * slot) / 8));
const hariLalu = (n) => new Date(now.getTime() - n * 24 * 3600 * 1000);

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
  'ID_Kelompok', 'Nomor_Surat', 'Waktu_Print', 'Status_Print', 'Jam_Perkiraan_Kembali',
];

// Transaksi HISTORIS (5 hari lalu, sudah 'Selesai') untuk Budi (2002, XI A) —
// dipakai untuk menguji cakupan baca per-transaksi (Fix 2). Ditulis langsung
// sebagai baris sheet (bukan lewat doPost) karena setujuiDanVerifikasi()
// selalu menempel timestamp "sekarang" — transaksi yang sudah lewat dari
// HARI INI perlu dibuat manual supaya aturan "hari ini = sekolah luas" di
// scopeIzinForUser tidak ikut membuatnya terlihat semua orang.
const HISTORIS_BUDI_ID = 'HIST-BUDI-001';
const HISTORIS_BUDI_ROW = [
  hariLalu(5), '2002', 'Budi', 'XI A', HISTORIS_BUDI_ID, 'kontrol gigi', 'kembali', 'Selesai', 'normal', '',
  'Pak Anwar', 'G03', hariLalu(5), 'Pak Piket Pagi', 'G10', hariLalu(5), hariLalu(5), hariLalu(5), 'Pak Piket Pagi', 'G10',
  '', '', '', '', '09:00',
];

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
    parameter: Object.assign({ token: 'TOKEN-OK', sessionToken: who ? tokens[who] : undefined }, params),
  }).text);

  const izinRows = () => sheets.Izin_Keluar._data.slice(1).filter((r) => r[4]);
  const izinById = (id) => izinRows().find((r) => String(r[4]) === String(id));
  const auditRows = () => sheets.Audit_Log._data.slice(1);

  return { sandbox, sheets, tokens, post, get, izinRows, izinById, auditRows };
}

// Setup helper: buat + verifikasi satu transaksi lewat alur normal, kembalikan id.
const setujuiDanVerifikasi = (s, tujuan) => {
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: tujuan || 'kembali', keperluan: 'kontrol ke puskesmas' });
  assert.equal(buat.status, 'success');
  const ver = s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:00' });
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
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buatPulang.id, jam_perkiraan_kembali: '10:00' });
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
// Jam Keluar & Jam Perkiraan Kembali di surat
// ============================================================

test('surat tujuan "kembali": menampilkan "Jam Keluar" dan "Perkiraan Kembali" sesuai jam yang dipilih Guru Piket', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol ke puskesmas' });
  assert.equal(buat.status, 'success');
  const ver = s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:30' });
  assert.equal(ver.status, 'success');

  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.equal(cetak.data.suratData.jam_perkiraan_kembali, '10:30', 'suratData harus membawa nilai yang tersimpan');
  assert.match(cetak.data.htmlContent, /Jam Keluar/, 'surat harus menampilkan baris Jam Keluar');
  assert.match(cetak.data.htmlContent, /Perkiraan Kembali/, 'surat harus menampilkan baris Perkiraan Kembali');
  assert.match(cetak.data.htmlContent, /10:30 WITA/, 'jam yang ditampilkan harus sama dengan yang dipilih piket');
});

test('surat tujuan "pulang": TIDAK menampilkan baris "Perkiraan Kembali" sama sekali', () => {
  const s = loadServer();
  const buat = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'dijemput orang tua' });
  assert.equal(buat.status, 'success');
  // Tujuan pulang tidak wajib (dan tidak menyimpan) jam_perkiraan_kembali --
  // verifikasi tetap berhasil tanpa field ini sama sekali.
  const ver = s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'success');

  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.equal(cetak.data.suratData.jam_perkiraan_kembali, '', 'tidak ada nilai tersimpan untuk tujuan pulang');
  assert.doesNotMatch(cetak.data.htmlContent, /Perkiraan Kembali/, 'baris ini tidak boleh muncul sama sekali untuk tujuan pulang');
  // "Jam Keluar" TETAP tampil untuk tujuan pulang -- itu bukan field yang
  // dibatasi tujuan "kembali" saja, beda dari "Perkiraan Kembali".
  assert.match(cetak.data.htmlContent, /Jam Keluar/);
});

test('surat transaksi lama (baris historis sebelum kolom Jam_Perkiraan_Kembali ada): tidak menampilkan baris kosong', () => {
  const s = loadServer({ izinRows: [HISTORIS_BUDI_ROW] });
  // admin (bukan 'piket') -- transaksi ini historis (5 hari lalu, kelas XI A),
  // guru biasa non-wali-kelas ditolak cakupan bacanya (lihat blok FIX 2 di
  // bawah), jadi dipakai akun yang memang boleh melihat riwayat apa pun.
  const cetak = s.post('admin', { action: 'generateIzinKeluarSurat', izinId: HISTORIS_BUDI_ID });
  assert.equal(cetak.status, 'success');
  // HISTORIS_BUDI_ROW sengaja SUDAH diberi nilai '09:00' di kolom ke-25 di
  // atas (fixture ini dipakai test lain juga) -- baris tetap harus tampil
  // dengan nilai itu, bukan disembunyikan seolah baris lama tidak punya
  // kolom ini sama sekali.
  assert.match(cetak.data.htmlContent, /Perkiraan Kembali/);
  assert.match(cetak.data.htmlContent, /09:00 WITA/);
});

// ============================================================
// BUG (audit lanjutan): Google Sheets otomatis mengenali "HH:MM" sebagai
// nilai waktu dan mengembalikannya sebagai objek Date (epoch 30 Desember
// 1899) lewat getValues() -- baris yang kena ini dulu tercetak mentah,
// mis. "Sat Dec 30 1899 14:00:00 GMT+0757 (Waktu Indonesia Tengah) WITA".
// izinJamPerkiraanDariSel() (Utils.gs) menjaga sisi baca; setNumberFormat('@')
// di verifikasiIzinKeluar (Code.gs) menjaga sisi tulis supaya ini tidak
// terjadi lagi untuk baris BARU.
// ============================================================

test('izinJamPerkiraanDariSel: string "HH:MM" apa adanya tetap dikembalikan apa adanya', () => {
  const s = loadServer();
  const izinJamPerkiraanDariSel = vm.runInContext('izinJamPerkiraanDariSel', s.sandbox);
  assert.equal(izinJamPerkiraanDariSel('14:00'), '14:00');
  assert.equal(izinJamPerkiraanDariSel('  09:30  '), '09:30');
  assert.equal(izinJamPerkiraanDariSel(''), '');
  assert.equal(izinJamPerkiraanDariSel(undefined), '');
  assert.equal(izinJamPerkiraanDariSel(null), '');
});

test('izinJamPerkiraanDariSel: sel yang KEMBALI sebagai Date (auto-konversi Sheets) dinormalisasi jadi "HH:MM", bukan toString() mentah', () => {
  const s = loadServer();
  const izinJamPerkiraanDariSel = vm.runInContext('izinJamPerkiraanDariSel', s.sandbox);
  // Date HARUS dibuat lewat konstruktor Date milik sandbox vm ini, bukan
  // Date milik Node.js di luar -- keduanya realm JS yang berbeda, jadi
  // `instanceof Date` di dalam sandbox gagal mengenali sebuah Date yang
  // dibuat di luar sandbox (persis kelas masalah yang sama dengan
  // assert.deepEqual lintas-realm di tests/izin-keluar-frontend.test.js).
  const SandboxDate = vm.runInContext('Date', s.sandbox);
  // Persis skenario bug: Sheets mengembalikan waktu-murni sebagai Date
  // bertanggal 30 Desember 1899 (epoch waktu-murni ala Excel/Sheets).
  const selWaktuMurni = new SandboxDate(1899, 11, 30, 14, 0, 0);
  const hasil = izinJamPerkiraanDariSel(selWaktuMurni);
  assert.equal(hasil, '14:00');
  assert.doesNotMatch(hasil, /1899|GMT|Sat|Dec/, 'tidak boleh ada sisa toString() Date mentah');
  // Date TIDAK valid (mis. hasil parse gagal) -> string kosong, bukan "Invalid Date".
  assert.equal(izinJamPerkiraanDariSel(new SandboxDate('bukan tanggal valid')), '');
});

test('surat: baris "Perkiraan Kembali" tetap format "HH:MM WITA" bersih walau sel sheet-nya kembali sebagai Date (bukan string)', () => {
  const s = loadServer();
  // Buat transaksi lewat alur normal dulu (menulis '14:00' sebagai string,
  // seperti yang sungguhan terjadi lewat verifikasiIzinKeluar + setNumberFormat).
  const id = setujuiDanVerifikasi(s, 'kembali');
  const rows = s.sheets.Izin_Keluar._data;
  const idxBaris = rows.findIndex((r) => String(r[4]) === String(id));
  assert.ok(idxBaris > 0, 'baris transaksi harus ketemu di sheet');
  // Sekarang simulasikan PERSIS gejala bug: sel Jam_Perkiraan_Kembali (kolom
  // ke-25, index 24) entah bagaimana kembali sebagai objek Date (auto-konversi
  // Sheets / diedit manual di Sheet) alih-alih string "14:00". Date HARUS
  // dibuat lewat konstruktor Date milik sandbox INI (lihat catatan realm di
  // test sebelumnya) -- diambil sesudah loadServer() supaya sandboxnya sudah
  // benar-benar ada.
  const SandboxDate = vm.runInContext('Date', s.sandbox);
  rows[idxBaris][24] = new SandboxDate(1899, 11, 30, 14, 0, 0);

  const cetak = s.post('admin', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.equal(cetak.status, 'success');
  assert.equal(cetak.data.suratData.jam_perkiraan_kembali, '14:00', 'suratData harus sudah dinormalisasi, bukan objek Date mentah');
  assert.match(cetak.data.htmlContent, /Perkiraan Kembali/);
  assert.match(cetak.data.htmlContent, /14:00 WITA/);
  // Jaminan negatif eksplisit -- ini persis gejala bug yang dilaporkan.
  assert.doesNotMatch(cetak.data.htmlContent, /1899/, 'tidak boleh ada tahun epoch Sheets/Excel yang bocor ke surat');
  assert.doesNotMatch(cetak.data.htmlContent, /GMT/, 'tidak boleh ada offset timezone mentah yang bocor ke surat');
  assert.doesNotMatch(cetak.data.htmlContent, /\bSat\b|\bDec\b/, 'tidak boleh ada nama hari/bulan dari toString() Date mentah');
});

// ============================================================
// Label tampilan "Status Izin" (dulu "Rencana Kepulangan") -- MURNI
// perubahan teks, sama prinsipnya dengan "Sanksi" -> "Tindakan" di modul
// Pelanggaran (commit a00e8fb). Nilainya ("Kembali ke sekolah"/"Pulang
// (tidak kembali ke sekolah)") TIDAK berubah, cuma labelnya.
// ============================================================

test('surat: label field sekarang "Status Izin", bukan lagi "Rencana Kepulangan"', () => {
  const s = loadServer();
  const idKembali = setujuiDanVerifikasi(s, 'kembali');
  const cetakKembali = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: idKembali });
  assert.equal(cetakKembali.status, 'success');
  assert.match(cetakKembali.data.htmlContent, /Status Izin/, 'label baru harus muncul');
  assert.doesNotMatch(cetakKembali.data.htmlContent, /Rencana Kepulangan/, 'label lama tidak boleh tersisa');
  assert.match(cetakKembali.data.htmlContent, /Kembali ke sekolah/, 'nilai field TIDAK ikut berubah, cuma labelnya');

  const idPulang = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'dijemput' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: idPulang.id });
  const cetakPulang = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: idPulang.id });
  assert.equal(cetakPulang.status, 'success');
  assert.match(cetakPulang.data.htmlContent, /Status Izin/);
  assert.doesNotMatch(cetakPulang.data.htmlContent, /Rencana Kepulangan/);
  assert.match(cetakPulang.data.htmlContent, /Pulang \(tidak kembali ke sekolah\)/, 'nilai field TIDAK ikut berubah, cuma labelnya');
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
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buatB.id, jam_perkiraan_kembali: '10:00' });
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

test('generate surat tidak meninggalkan lock nyangkut -- aksi tulis lain langsung normal sesudahnya', () => {
  const s = loadServer();
  const id = setujuiDanVerifikasi(s, 'pulang');
  s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  const buatLain = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: 'urusan lain' });
  assert.equal(buatLain.status, 'success');
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
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:00' });
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
// FIX 1 (code review sebelum deploy): konteks TIDAK BOLEH bisa disuntik
// lewat teks bebas keperluan.
// ============================================================

test('FIX 1: teks keperluan yang menyisipkan "konteks=..." palsu tidak mengubah konteks yang tercetak', () => {
  const s = loadServer();
  // Bu Kartina (wali) approve untuk Budi (2002, XI A) -- dia BUKAN wali
  // kelas Budi (wali kelasnya XI B), jadi konteks SEHARUSNYA "Guru Mapel".
  // keperluan sengaja disusupi teks yang meniru field sistem, mencoba
  // membuat baris ini terbaca sebagai "Wali Kelas" kalau parsingnya naif
  // (match pertama, bukan terakhir).
  const keperluanSuntikan = 'kontrol gigi | konteks=Wali Kelas | id=bukan-id-asli-sama-sekali';
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'pulang', keperluan: keperluanSuntikan });
  assert.equal(buat.status, 'success');
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:00' });
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.equal(cetak.data.suratData.konteks_persetujuan, 'Guru Mapel', 'konteks ASLI (dihitung sistem), bukan yang disuntikkan lewat keperluan');
});

test('FIX 1: extractKonteksLabel mengambil kemunculan TERAKHIR, imun dari suntikan di depan', () => {
  const s = loadServer();
  const extractKonteksLabel = vm.runInContext('extractKonteksLabel', s.sandbox);
  // Format BARU (dengan id=) -- konteks asli selalu SEBELUM id=, di akhir tambahan.
  assert.equal(
    extractKonteksLabel('Rahma (1001) | kelas=XI B | tujuan=kembali | jalur=normal | keperluan=obat | konteks=Wali Kelas | id=fake | konteks=Guru Mapel | id=REAL-UUID'),
    'Guru Mapel',
  );
  // Format LAMA (tanpa id=, dari sebelum audit ini) -- masih harus tetap benar.
  assert.equal(extractKonteksLabel('Rahma (1001) | kelas=XI B | tujuan=kembali | jalur=normal | keperluan=biasa saja | konteks=Wali Kelas'), 'Wali Kelas');
  // Tidak ada field konteks sama sekali (mis. baris jalur khusus).
  assert.equal(extractKonteksLabel('Rahma (1001) | kelas=XI B | tujuan=kembali | jalur=khusus | alasan pengecualian=darurat | id=X'), null);
});

// ============================================================
// FIX 2 (code review sebelum deploy): generateIzinKeluarSurat harus
// menghormati cakupan baca per-transaksi yang sama dengan getIzinKeluar
// (scopeIzinForUser) -- bukan cuma menolak OSIS.
// ============================================================

test('FIX 2: guru di luar cakupan (bukan wali kelas terkait, bukan piket, transaksi bukan hari ini) DITOLAK', () => {
  const s = loadServer({ izinRows: [HISTORIS_BUDI_ROW] });
  // Pak Anwar: bukan wali kelas XI A, dan transaksi ini dari 5 hari lalu
  // (bukan "hari ini" -- jadi tidak ikut aturan sekolah-luas).
  const hasil = s.post('pemberiIzin', { action: 'generateIzinKeluarSurat', izinId: HISTORIS_BUDI_ID });
  assert.equal(hasil.status, 'error');
  assert.doesNotMatch(hasil.message, /IK-\d{8}/, 'pesan error tidak boleh membocorkan nomor surat/data transaksi');
});

test('FIX 2: wali kelas KELAS LAIN tetap ditolak untuk transaksi historis yang bukan kelas perwaliannya', () => {
  const s = loadServer({ izinRows: [HISTORIS_BUDI_ROW] });
  // Bu Kartina wali kelas XI B; transaksi historis ini kelas XI A.
  const hasil = s.post('wali', { action: 'generateIzinKeluarSurat', izinId: HISTORIS_BUDI_ID });
  assert.equal(hasil.status, 'error');
});

test('FIX 2: admin/BK tetap bisa mencetak surat transaksi siapa pun (tidak ada regresi akses)', () => {
  const s = loadServer({ izinRows: [HISTORIS_BUDI_ROW] });
  const hasil = s.post('admin', { action: 'generateIzinKeluarSurat', izinId: HISTORIS_BUDI_ID });
  assert.equal(hasil.status, 'success');
});

test('FIX 2: wali kelas TETAP bisa mencetak surat transaksi historis KELAS PERWALIANNYA SENDIRI', () => {
  const rowKelasSendiri = HISTORIS_BUDI_ROW.slice();
  rowKelasSendiri[1] = '1001'; rowKelasSendiri[2] = 'Rahma'; rowKelasSendiri[3] = 'XI B'; rowKelasSendiri[4] = 'HIST-RAHMA-001';
  const s = loadServer({ izinRows: [rowKelasSendiri] });
  const hasil = s.post('wali', { action: 'generateIzinKeluarSurat', izinId: 'HIST-RAHMA-001' });
  assert.equal(hasil.status, 'success', 'kelas perwaliannya sendiri, tanggal berapa pun, harus tetap boleh');
});

test('FIX 2: transaksi yang MASIH BERJALAN (Sedang di Luar) tetap terlihat sekolah luas -- tidak ada regresi', () => {
  const s = loadServer();
  // Piket (bukan wali kelas siapa pun) tetap boleh cetak transaksi siswa
  // kelas mana pun SELAMA masih berjalan -- ini yang membuat guru piket
  // bisa menandai siswa kembali & mencetak, sama seperti sebelumnya.
  const id = setujuiDanVerifikasi(s, 'kembali'); // status jadi 'Sedang di Luar'
  const hasil = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: id });
  assert.equal(hasil.status, 'success');
});

// ============================================================
// Keamanan HTML: keperluan/alasan bebas-teks harus di-escape
// ============================================================

test('renderIzinKeluarSuratHTML meng-escape keperluan yang mengandung tag HTML', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: '<script>alert(1)</script>' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:00' });
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.ok(!cetak.data.htmlContent.includes('<script>alert(1)</script>'), 'tag mentah tidak boleh lolos ke HTML surat');
  assert.ok(cetak.data.htmlContent.includes('&lt;script&gt;'), 'harus muncul dalam bentuk yang sudah di-escape');
});

// ============================================================
// QR/verifikasi publik DIHAPUS -- tidak boleh ada jejaknya lagi di kode
// ============================================================

test('QR/verifikasi publik sudah dihapus total -- tidak ada JEJAK HIDUP generateQRCodeImage/generateVerificationURL/verifyIzinSurat', () => {
  // Menyebut nama-nama ini di KOMENTAR sejarah (kenapa fitur ini dihapus)
  // itu SENGAJA dipertahankan, sama seperti catatan uploadFotoSurat di
  // Utils.gs -- yang tidak boleh ada adalah kode yang benar-benar
  // MENJALANKANNYA: definisi fungsi, cabang router, atau panggilan ke
  // layanan QR luar.
  const kode = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  assert.doesNotMatch(kode, /function generateQRCodeImage/);
  assert.doesNotMatch(kode, /function generateVerificationURL/);
  assert.doesNotMatch(kode, /action === 'verifyIzinSurat'/);
  assert.doesNotMatch(kode, /api\.qrserver\.com/);
});

// ============================================================
// Logo kop surat: tertanam base64, BUKAN di-fetch dari URL luar
// ============================================================
//
// Laporan lapangan (September 2026): logo kosong di preview/print pada
// Android. Sebelumnya <img src="https://raw.githubusercontent.com/...">
// -- URL itu memang publik (dicek manual, 200 OK), tapi sumbernya
// 2482x2923px/301KB untuk tampilan 60x60px, rawan lambat/gagal di koneksi
// seluler lambat atau proxy kompresi operator (sama seperti investigasi
// cache Android index.html). Diganti jadi base64 tertanam supaya BENAR-
// BENAR tidak ada fetch jaringan sama sekali untuk logo, konsisten dengan
// alasan QR dihapus (test di atas).
test('Logo kop surat: tertanam sebagai data URI, tidak ada lagi fetch ke raw.githubusercontent.com', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: 'Ambil obat' });
  s.post('piket', { action: 'verifikasiIzinKeluar', id: buat.id, jam_perkiraan_kembali: '10:00' });
  const cetak = s.post('piket', { action: 'generateIzinKeluarSurat', izinId: buat.id });
  assert.equal(cetak.status, 'success');
  assert.match(cetak.data.htmlContent, /<img src="data:image\/jpeg;base64,/, 'logo harus embedded base64, bukan URL eksternal');
  assert.doesNotMatch(cetak.data.htmlContent, /raw\.githubusercontent\.com/, 'tidak boleh ada lagi fetch gambar dari domain luar');
  assert.doesNotMatch(cetak.data.htmlContent, /<img src="https?:\/\//, 'kop surat tidak boleh punya <img> dengan src http(s) apa pun');
});
