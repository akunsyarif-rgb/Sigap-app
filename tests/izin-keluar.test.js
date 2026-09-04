// ===== tests/izin-keluar.test.js =====
// IZIN KELUAR / PULANG (BETA) — alur, status, kewenangan, dan integritasnya,
// diuji lewat doPost()/doGet() yang SUNGGUHAN (Utils.gs+Auth.gs+Code.gs
// dijalankan di vm dengan layanan Apps Script di-stub). Yang diperiksa adalah
// ISI RESPONS & ISI SHEET — bukan tampilan; kalau suatu saat pengecekan
// dipindah ke frontend, file ini merah.
//
// Prosedur yang dijaga (SAMA dengan prosedur sekolah, tidak dipangkas):
//   Guru pemberi persetujuan -> persetujuan  ->  Guru Piket -> verifikasi -> keluar
// Jalur khusus (guru yang menangani siswa tidak tersedia) TIDAK memalsukan
// persetujuan siapa pun: ia tercatat eksplisit sebagai 'khusus' + alasannya.
//
// Istilah yang dipakai adalah "guru yang memberikan persetujuan" — BUKAN "guru
// mapel pada jam tersebut". SIGAP tidak punya data jadwal mengajar dan tidak
// akan menambahkannya (jadwal aktual berubah sewaktu-waktu), jadi peran
// seperti itu tidak bisa diverifikasi; yang diuji di sini adalah bahwa server
// merekam identitas pemberi persetujuan DARI SESI, dan tidak pernah menerima
// klaim peran dari klien.
//
// TIDAK ADA satu pun test di sini yang menyentuh printer/pencetakan — jenis
// printer, media, ukuran, dan cara koneksinya memang belum ditentukan sekolah.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// Sheet tiruan yang BENAR-BENAR menyimpan hasil tulis (setValues/appendRow) —
// beda dari mock di tests/rbac-*.test.js yang read-only, karena di sini yang
// diuji justru perubahan statusnya.
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
    // appendRowsBatch() melebarkan sheet dulu kalau barisnya kurang — mock ini
    // meniru itu supaya jalur tulis massal benar-benar teruji, bukan dilewati.
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

// Waktu fixture ditempatkan pada pecahan waktu yang sudah berlalu SEJAK TENGAH
// MALAM lokal, bukan "sekian jam yang lalu" — jebakan yang sama pernah bikin
// tests/rbac-riwayat-pelanggaran.test.js & rekap-upacara.test.js merah kalau
// suite jalan lewat tengah malam.
const now = new Date();
const TENGAH_MALAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
const SEJAK_TENGAH_MALAM = Math.max(1, now.getTime() - TENGAH_MALAM);
const hariIniJam = (slot) => new Date(TENGAH_MALAM + Math.floor((SEJAK_TENGAH_MALAM * slot) / 8));
const hariLalu = (n) => new Date(now.getTime() - n * 24 * 3600 * 1000);

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI_INI = HARI[now.getDay()];
const HARI_LAIN = HARI[(now.getDay() + 3) % 7];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  // Wali kelas XI B — pemberi persetujuan jalur normal untuk anak perwaliannya.
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' },
  // Guru biasa yang BUKAN wali kelas siswa terkait dan bukan piket — tetap sah
  // memberikan persetujuan. SIGAP tidak punya data jadwal mengajar, jadi tidak
  // ada peran "guru mapel jam ini" yang bisa diverifikasi; yang dicatat adalah
  // siapa yang menyetujui. Lihat catatan di action addIzinKeluar (Code.gs).
  pemberiIzin: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  piketPagi: { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', jabatan: '', waliKelas: '' },
  piketSiang: { id: 'G11', name: 'Bu Piket Siang', role: 'guru', jabatan: '', waliKelas: '' },
  // Guru yang TIDAK piket hari ini (piket di hari lain) — tidak boleh
  // memverifikasi apa pun.
  bukanPiket: { id: 'G12', name: 'Pak Bukan Piket', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

const SISWA = [
  ['1001', 'Rahma', 'XI B'],
  ['2002', 'Budi', 'XI A'],
  ['3003', 'Citra', 'XII C'],
  ['4004', 'Dedi', 'XII C'],
];

const IZIN_HEADER = [
  'Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
  'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID',
];

// Baris riwayat untuk menguji cakupan baca (bukan alur) — dua transaksi yang
// sudah TERTUTUP dari hari-hari sebelumnya, di kelas yang berbeda.
const IZIN_FIXTURE = [
  [hariLalu(6), '1001', 'Rahma', 'XI B', 'LAMA-XIB', 'kontrol gigi', 'kembali', 'Selesai', 'normal', '',
    'Bu Kartina', 'G02', hariLalu(6), 'Pak Piket Pagi', 'G10', hariLalu(6), hariLalu(6), hariLalu(6), 'Pak Piket Pagi', 'G10'],
  [hariLalu(4), '3003', 'Citra', 'XII C', 'LAMA-XIIC', 'acara keluarga', 'pulang', 'Selesai', 'normal', '',
    'Pak Anwar', 'G03', hariLalu(4), 'Bu Piket Siang', 'G11', hariLalu(4), hariLalu(4), '', '', ''],
  [hariIniJam(1), '4004', 'Dedi', 'XII C', 'HARIINI-SELESAI', 'ke bank', 'pulang', 'Pulang', 'normal', '',
    'Pak Anwar', 'G03', hariIniJam(1), 'Pak Piket Pagi', 'G10', hariIniJam(1), hariIniJam(1), '', '', ''],
];

function loadServer(opts) {
  const options = opts || {};
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], options.tanpaJadwalPiket ? [] : (options.jadwalPiketRows || [
      [HARI_INI, 'G10'],
      [HARI_INI, 'G11'], // dua guru piket di hari yang sama = pergantian shift
      [HARI_LAIN, 'G12'],
    ])),
    Izin_Keluar: makeSheet(IZIN_HEADER, options.tanpaIzinFixture ? [] : IZIN_FIXTURE),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'],
      [[hariIniJam(2), '1001', 'Rahma', 'XI B', 'Hujan', 'Pak Piket Pagi']]),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'],
      [[hariIniJam(2), '2002', 'Budi', 'XI A', 'Sakit', 'demam', '', 'Bu BK']]),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'],
      [[hariIniJam(2), '3003', 'Citra', 'XII C', 'Atribut', 'Teguran', '', 'Pak Anwar']]),
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

  const izinRows = () => sheets.Izin_Keluar._data.slice(1).filter((r) => r[4]);
  const izinById = (id) => izinRows().find((r) => String(r[4]) === String(id));
  const auditRows = () => sheets.Audit_Log._data.slice(1);

  return { sandbox, sheets, tokens, post, get, izinRows, izinById, auditRows, cacheStore };
}

// Persetujuan awal (jalur normal). Mengembalikan id transaksi.
const setujui = (s, who, nisn, tujuan, keperluan) =>
  s.post(who, { action: 'addIzinKeluar', nisn: nisn, tujuan: tujuan || 'kembali', keperluan: keperluan || 'keperluan keluarga' });

// ============================================================
// 1-2. ALUR NORMAL: dua tahap tetap dua tahap
// ============================================================

test('alur normal: persetujuan wali kelas -> verifikasi Piket -> keluar', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol ke puskesmas');
  assert.equal(buat.status, 'success');
  // Persetujuan guru SAJA belum membuat siswa boleh keluar.
  assert.equal(buat.izinStatus, 'Menunggu Verifikasi');
  let row = s.izinById(buat.id);
  assert.equal(row[10], 'Bu Kartina', 'pemberi persetujuan tercatat');
  assert.equal(row[13], '', 'belum ada pemberi verifikasi');
  assert.equal(row[16], '', 'waktu keluar belum diisi sebelum verifikasi');

  const ver = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'success');
  assert.equal(ver.izinStatus, 'Sedang di Luar');
  row = s.izinById(buat.id);
  assert.equal(row[7], 'Sedang di Luar');
  assert.equal(row[13], 'Pak Piket Pagi', 'pemberi verifikasi tercatat');
  assert.ok(row[15], 'waktu verifikasi terisi');
  assert.ok(row[16], 'waktu keluar terisi saat verifikasi, bukan saat persetujuan');
});

test('alur normal: persetujuan guru NON-wali-kelas -> verifikasi Piket -> keluar', () => {
  const s = loadServer();
  // Pak Anwar bukan wali kelas siswa ini dan tidak punya hubungan yang bisa
  // dibuktikan sistem dengan jam pelajaran saat itu — persetujuannya tetap sah,
  // dan yang tersimpan adalah namanya sebagai pemberi persetujuan.
  const buat = setujui(s, 'pemberiIzin', '3003', 'kembali', 'lomba di luar sekolah');
  assert.equal(buat.status, 'success');
  assert.equal(buat.izinStatus, 'Menunggu Verifikasi');
  assert.equal(s.izinById(buat.id)[10], 'Pak Anwar');

  assert.equal(s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buat.id }).izinStatus, 'Sedang di Luar');
});

// ============================================================
// 3-5. TUJUAN & PENANDAAN KEMBALI
// ============================================================

test('tujuan "Pulang": final setelah diverifikasi, tidak perlu ditandai kembali maupun ditutup', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'pulang', 'dijemput orang tua, sakit');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }).izinStatus, 'Pulang');

  const kembali = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(kembali.status, 'error', 'siswa PULANG tidak boleh ditandai kembali');
  assert.match(kembali.message, /PULANG|pulang/);
  assert.equal(s.izinById(buat.id)[7], 'Pulang', 'status tidak berubah karena permintaan yang ditolak — dan TIDAK ada aksi penutupan terpisah yang dibutuhkan lagi (dihapus, lihat blok audit UX di bawah)');
});

test('tujuan "Kembali": Sedang di Luar -> Selesai, satu langkah', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'ambil berkas di rumah');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  const kembali = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(kembali.izinStatus, 'Selesai');
  const row = s.izinById(buat.id);
  assert.ok(row[17], 'waktu kembali terisi');
  assert.equal(row[18], 'Pak Piket Pagi', 'siapa yang mencatat kembali tersimpan');
  assert.equal(row[7], 'Selesai', 'tidak ada aksi kedua yang menunggu');
});

test('yang menandai kembali TIDAK harus pemberi izin — cukup petugas berwenang', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '2002', 'kembali', 'ke koperasi');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  // Bukan Bu Kartina (pemberi izin), bukan Pak Piket Pagi (yang verifikasi).
  const kembali = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(kembali.status, 'success');
  assert.equal(s.izinById(buat.id)[18], 'Bu Piket Siang');
});

// ============================================================
// 6. PERGANTIAN GURU PIKET DI HARI YANG SAMA
// ============================================================

test('pergantian Guru Piket hari yang sama: keduanya berwenang, yang bukan piket tidak', () => {
  const s = loadServer();
  const a = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  const b = setujui(s, 'pemberiIzin', '2002', 'kembali', 'urusan keluarga');

  // Shift pagi memverifikasi transaksi pertama...
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: a.id }).status, 'success');
  // ...shift siang memverifikasi transaksi kedua di hari yang sama.
  assert.equal(s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: b.id }).status, 'success');
  // ...dan shift siang boleh menandai kembali transaksi yang diverifikasi shift pagi.
  assert.equal(s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: a.id }).status, 'success');

  // Guru yang piketnya di hari LAIN tetap ditolak hari ini.
  const tolak = s.post('bukanPiket', { action: 'tandaiKembaliIzinKeluar', id: b.id });
  assert.equal(tolak.status, 'error');
  assert.match(tolak.message, /Guru Piket/);
  assert.equal(s.izinById(b.id)[7], 'Sedang di Luar', 'status tidak berubah oleh permintaan yang ditolak');
});

// ============================================================
// 7-8. JALUR KHUSUS
// ============================================================

test('Izin Khusus: hanya petugas berwenang, dan tidak memalsukan persetujuan siapa pun', () => {
  const s = loadServer();
  const khusus = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '3003', tujuan: 'pulang',
    keperluan: 'sakit, harus segera dijemput', jalur: 'khusus',
    alasan_khusus: 'Guru yang menangani siswa tidak ada di sekolah, siswa demam tinggi',
  });
  assert.equal(khusus.status, 'success');
  // Jalur khusus = petugas piket menyetujui sekaligus memverifikasi, jadi
  // siswa memang langsung tercatat keluar.
  assert.equal(khusus.izinStatus, 'Pulang');

  const row = s.izinById(khusus.id);
  assert.equal(row[8], 'khusus', 'jalur ditandai eksplisit');
  assert.equal(row[10], 'Pak Piket Pagi', 'pemberi persetujuan = petugas piket itu sendiri');
  assert.equal(row[13], 'Pak Piket Pagi', 'pemberi verifikasi = orang yang sama');
  // Tidak ada nama guru lain yang ditempelkan seolah ikut menyetujui.
  assert.ok(!JSON.stringify(row).includes('Bu Kartina'));
  assert.ok(!JSON.stringify(row).includes('Pak Anwar'));
});

test('Izin Khusus WAJIB mencatat alasan pengecualian', () => {
  const s = loadServer();
  const tanpaAlasan = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '3003', tujuan: 'pulang', keperluan: 'sakit', jalur: 'khusus', alasan_khusus: '   ',
  });
  assert.equal(tanpaAlasan.status, 'error');
  assert.match(tanpaAlasan.message, /[Aa]lasan/);
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length, 'tidak ada baris yang ditulis saat ditolak');

  const oke = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '3003', tujuan: 'pulang', keperluan: 'sakit',
    jalur: 'khusus', alasan_khusus: 'Guru yang menangani siswa tidak di tempat',
  });
  assert.equal(s.izinById(oke.id)[9], 'Guru yang menangani siswa tidak di tempat');
});

test('Izin Khusus tertutup untuk yang tidak berwenang, dan alasan tidak menempel di jalur normal', () => {
  const s = loadServer();
  const tolak = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'x',
    jalur: 'khusus', alasan_khusus: 'saya buru-buru',
  });
  assert.equal(tolak.status, 'error');
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length, 'permintaan yang ditolak tidak menulis baris apa pun');

  // Alasan pengecualian yang dikirim pada transaksi NORMAL tidak disimpan —
  // kalau ikut tersimpan, baris normal bisa terbaca seolah pengecualian.
  const normal = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol',
    jalur: 'normal', alasan_khusus: 'ini bukan pengecualian',
  });
  const row = s.izinById(normal.id);
  assert.equal(row[8], 'normal');
  assert.equal(row[9], '');
});

// ============================================================
// 9. ROLE / AUTHORIZATION (ditegakkan server, bukan tombol tersembunyi)
// ============================================================

test('OSIS ditolak di semua aksi Izin Keluar, baca maupun tulis', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  assert.equal(s.post('osis', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'x' }).status, 'error');
  assert.equal(s.post('osis', { action: 'verifikasiIzinKeluar', id: buat.id }).status, 'error');
  assert.equal(s.post('osis', { action: 'tandaiKembaliIzinKeluar', id: buat.id }).status, 'error');
  const baca = s.get('osis', { action: 'getIzinKeluar' });
  assert.equal(baca.status, 'error');
  assert.equal(baca.izin, undefined, 'tidak ada satu baris pun yang ikut terkirim');
});

test('guru non-piket boleh MENYETUJUI tapi tidak boleh memverifikasi/menutup', () => {
  const s = loadServer();
  const buat = setujui(s, 'bukanPiket', '1001');
  assert.equal(buat.status, 'success', 'persetujuan awal memang hak semua guru non-OSIS');

  ['verifikasiIzinKeluar', 'tandaiKembaliIzinKeluar', 'tandaiPulangIzinKeluar'].forEach((aksi) => {
    const res = s.post('bukanPiket', { action: aksi, id: buat.id });
    assert.equal(res.status, 'error', aksi + ' harus ditolak untuk yang tidak bertugas');
  });
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi');
  assert.equal(s.get('bukanPiket', { action: 'getIzinKeluar' }).canVerify, false);
});

test('admin & BK selalu berwenang memverifikasi, termasuk saat Jadwal_Piket kosong', () => {
  const s = loadServer({ tanpaJadwalPiket: true });
  const a = setujui(s, 'wali', '1001');
  const b = setujui(s, 'pemberiIzin', '2002');
  assert.equal(s.post('admin', { action: 'verifikasiIzinKeluar', id: a.id }).status, 'success');
  assert.equal(s.post('bk', { action: 'verifikasiIzinKeluar', id: b.id }).status, 'success');
  // Tanpa jadwal piket, guru biasa memang tidak punya kewenangan itu.
  assert.equal(s.get('piketPagi', { action: 'getIzinKeluar' }).canVerify, false);
  assert.equal(s.get('admin', { action: 'getIzinKeluar' }).canVerify, true);
});

// ============================================================
// AUDIT KAPASITAS VERIFIKASI: "Guru Piket" vs "BK/Kesiswaan" — Agustus 2026
//
// Bug yang diperbaiki: akun BK/Kesiswaan SELALU boleh memverifikasi
// (keputusan produk yang TIDAK berubah di sini — tanpa itu sekolah bisa
// terkunci kalau Jadwal_Piket kosong/piket berhalangan), TAPI sebelum audit
// ini kartu & Audit Log-nya menulis "Guru Piket" untuk SEMUA verifikasi
// tanpa syarat — seorang BK yang mengambil alih TANPA sedang piket tercatat
// seolah-olah dia memang petugas piket hari itu.
//
// Kapasitas SEKARANG ditentukan dari SESI + Jadwal_Piket HARI INI
// (izinKapasitasVerifikasi, Utils.gs) — piket dicek LEBIH DULU, jadi
// SIAPA PUN (guru biasa/wali kelas/BK/admin) yang kebetulan piket hari ini
// bertindak sebagai "Guru Piket"; yang TIDAK piket baru jatuh ke BK/admin
// sebagai kapasitas cadangan ("BK/Kesiswaan"), dan guru biasa/wali kelas
// yang tidak piket tetap ditolak sepenuhnya — TIDAK ada yang diperketat
// dari sisi izin, cuma labelnya yang sekarang jujur.
// ============================================================

// Jadwal_Piket di mana Bu Kartina (wali kelas, G02) DAN Bu BK (G01) turut
// piket hari ini, di samping G10/G11 seperti fixture default — dipakai
// KHUSUS test kapasitas ini supaya tidak mengubah asumsi test lain yang
// sudah menyandarkan diri pada "Bu Kartina/Bu BK TIDAK piket hari ini"
// (mis. test Izin Khusus di atas).
const jadwalDenganWalasDanBk = [
  [HARI_INI, 'G10'], [HARI_INI, 'G11'], [HARI_INI, 'G02'], [HARI_INI, 'G01'], [HARI_LAIN, 'G12'],
];

test('kapasitas: guru biasa yang piket -> boleh, tercatat Guru Piket', () => {
  const s = loadServer();
  const buat = setujui(s, 'pemberiIzin', '1001');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }); // G10, piket hari ini di fixture default
  const kembali = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(kembali.status, 'success');

  const baris = s.izinById(buat.id);
  assert.equal(baris[13], 'Pak Piket Pagi'); // Diverifikasi_Oleh

  const izinGet = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet.diverifikasi_kapasitas, 'guru_piket');
  assert.equal(izinGet.dicatat_kembali_kapasitas, 'guru_piket');

  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Keluar').pop();
  assert.match(String(aksi[4]), /kapasitas=Guru Piket/);
  const aksiKembali = s.auditRows().filter((r) => String(r[3]) === 'Tandai Kembali Izin Keluar').pop();
  assert.match(String(aksiKembali[4]), /kapasitas=Guru Piket/);
});

test('kapasitas: wali kelas yang piket -> boleh, tercatat Guru Piket (bukan role wali kelas yang menentukan)', () => {
  const s = loadServer({ jadwalPiketRows: jadwalDenganWalasDanBk });
  const buat = setujui(s, 'pemberiIzin', '2002');
  const ver = s.post('wali', { action: 'verifikasiIzinKeluar', id: buat.id }); // Bu Kartina, G02, piket di fixture ini
  assert.equal(ver.status, 'success');

  const izinGet = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet.diverifikasi_kapasitas, 'guru_piket');
  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Keluar').pop();
  assert.match(String(aksi[4]), /kapasitas=Guru Piket/);
});

test('kapasitas: BK/Kesiswaan yang piket -> boleh, tercatat Guru Piket (bukan role BK yang menentukan)', () => {
  const s = loadServer({ jadwalPiketRows: jadwalDenganWalasDanBk });
  const buat = setujui(s, 'pemberiIzin', '3003');
  const ver = s.post('bk', { action: 'verifikasiIzinKeluar', id: buat.id }); // Bu BK, G01, piket di fixture ini
  assert.equal(ver.status, 'success');

  const izinGet = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet.diverifikasi_kapasitas, 'guru_piket');
  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Keluar').pop();
  assert.match(String(aksi[4]), /kapasitas=Guru Piket/);
});

test('kapasitas: BK/Kesiswaan yang TIDAK piket -> tetap boleh sebagai backup, tercatat BK/Kesiswaan (BUKAN Guru Piket)', () => {
  const s = loadServer(); // fixture default: Bu BK (G01) TIDAK ada di Jadwal_Piket hari ini
  const buat = setujui(s, 'pemberiIzin', '1001');
  const ver = s.post('bk', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'success', 'BK tetap boleh mengambil alih walau tidak piket');

  const izinGet = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet.diverifikasi_kapasitas, 'bk_kesiswaan', 'TIDAK boleh tercatat guru_piket');

  const kembali = s.post('bk', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(kembali.status, 'success');
  const izinGet2 = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet2.dicatat_kembali_kapasitas, 'bk_kesiswaan');

  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Keluar').pop();
  assert.match(String(aksi[4]), /kapasitas=BK\/Kesiswaan/);
  assert.doesNotMatch(String(aksi[4]), /kapasitas=Guru Piket/);
});

test('kapasitas: wali kelas yang TIDAK piket -> ditolak sepenuhnya (bukan cuma tidak diberi label Guru Piket)', () => {
  const s = loadServer(); // fixture default: Bu Kartina (G02) TIDAK piket hari ini
  const buat = setujui(s, 'pemberiIzin', '1001');
  const ver = s.post('wali', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi', 'tidak ada perubahan status oleh permintaan yang ditolak');
  assert.equal(s.get('wali', { action: 'getIzinKeluar' }).canVerify, false);
});

test('kapasitas: guru biasa yang TIDAK piket -> ditolak sepenuhnya', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001');
  const ver = s.post('bukanPiket', { action: 'verifikasiIzinKeluar', id: buat.id }); // G12, piket HARI_LAIN saja
  assert.equal(ver.status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi');
});

test('kapasitas: OSIS ditolak sepenuhnya, bukan diberi kapasitas apa pun', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001');
  const ver = s.post('osis', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.status, 'error');
  assert.equal(s.get('osis', { action: 'getIzinKeluar' }).status, 'error', 'OSIS tetap ditolak baca izin keluar sama sekali');
});

test('kapasitas: client mencoba memalsukan kapasitas -> diabaikan total, server yang menentukan', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001');

  // Guru yang tidak berwenang mengaku "guru_piket" lewat body request —
  // tetap ditolak, klaim tidak pernah dibaca.
  const gagal = s.post('bukanPiket', { action: 'verifikasiIzinKeluar', id: buat.id, kapasitas: 'guru_piket', role: 'guru_piket' });
  assert.equal(gagal.status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi');

  // BK yang tidak piket mengklaim "guru_piket" lewat body request — TETAP
  // diproses (BK memang berwenang lewat jalur backup), tapi label yang
  // TERCATAT adalah yang DIHITUNG SERVER (bk_kesiswaan), bukan klaim klien.
  const berhasil = s.post('bk', { action: 'verifikasiIzinKeluar', id: buat.id, kapasitas: 'guru_piket' });
  assert.equal(berhasil.status, 'success');
  const izinGet = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === buat.id);
  assert.equal(izinGet.diverifikasi_kapasitas, 'bk_kesiswaan', 'klaim kapasitas dari klien tidak mengubah apa yang tercatat');
  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Keluar').pop();
  assert.match(String(aksi[4]), /kapasitas=BK\/Kesiswaan/);
});

test('kapasitas: beberapa Guru Piket pada hari yang sama -> semuanya valid, masing-masing tercatat Guru Piket', () => {
  const s = loadServer(); // fixture default: G10 & G11 sama-sama piket hari ini (pergantian shift)
  const a = setujui(s, 'pemberiIzin', '1001');
  const b = setujui(s, 'pemberiIzin', '2002');

  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: a.id }).status, 'success');
  assert.equal(s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: b.id }).status, 'success');

  const izinA = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === a.id);
  const izinB = s.get('admin', { action: 'getIzinKeluar' }).izin.find((i) => i.id === b.id);
  assert.equal(izinA.diverifikasi_kapasitas, 'guru_piket');
  assert.equal(izinB.diverifikasi_kapasitas, 'guru_piket');
  assert.equal(izinA.diverifikasi_oleh, 'Pak Piket Pagi');
  assert.equal(izinB.diverifikasi_oleh, 'Bu Piket Siang');
});

test('kapasitas: canVerifyIzin tidak berselisih dengan izinKapasitasVerifikasi (satu sumber kebenaran)', () => {
  const s = loadServer();
  // Boolean canVerify HARUS persis (kapasitas !== null) untuk setiap kombinasi.
  [['piketPagi', true], ['wali', false], ['bukanPiket', false], ['bk', true], ['admin', true]]
    .forEach(([who, expected]) => {
      assert.equal(s.get(who, { action: 'getIzinKeluar' }).canVerify, expected, who);
    });
  // OSIS ditolak baca izin keluar sama sekali (tidak ada canVerify untuk dibandingkan).
  assert.equal(s.get('osis', { action: 'getIzinKeluar' }).status, 'error');
});

// ============================================================
// 10. TRANSISI STATUS TIDAK VALID
// ============================================================

test('transisi status tidak valid ditolak server', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali');

  // Belum diverifikasi -> belum bisa ditandai kembali.
  assert.equal(s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id }).status, 'error');

  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  // Verifikasi kedua ditolak.
  assert.equal(s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buat.id }).status, 'error');

  // Tandai Kembali langsung membawa transaksi ini ke status final (Selesai)
  // dalam satu langkah — tidak ada langkah "Tutup transaksi" kedua lagi.
  s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(s.izinById(buat.id)[7], 'Selesai');

  // Transaksi final tidak bisa disentuh aksi mana pun lagi.
  ['verifikasiIzinKeluar', 'tandaiKembaliIzinKeluar', 'tandaiPulangIzinKeluar'].forEach((aksi) => {
    assert.equal(s.post('admin', { action: aksi, id: buat.id }).status, 'error', aksi + ' pada transaksi Selesai');
  });
  assert.equal(s.izinById(buat.id)[7], 'Selesai');
});

// ============================================================
// 11. DOUBLE SUBMIT
// ============================================================

test('double submit tidak membuat transaksi ganda', () => {
  const s = loadServer();
  const jumlahAwal = s.izinRows().length;
  const pertama = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  const kedua = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  assert.equal(pertama.status, 'success');
  assert.equal(kedua.status, 'error', 'permintaan kedua untuk siswa yang sama ditolak');
  assert.equal(s.izinRows().length, jumlahAwal + 1);

  // Juga saat siswanya sudah di luar (bukan cuma saat menunggu verifikasi).
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: pertama.id });
  const ketiga = setujui(s, 'pemberiIzin', '1001', 'pulang', 'dijemput');
  assert.equal(ketiga.status, 'error');
  assert.match(ketiga.message, /masih di luar/i);
  assert.equal(s.izinRows().length, jumlahAwal + 1);

  // Verifikasi yang ditekan dua kali cuma menghasilkan satu perubahan status.
  const v1 = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: pertama.id });
  const v2 = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: pertama.id });
  assert.equal(v1.status, 'success');
  assert.equal(v2.status, 'error');

  // Setelah transaksi lama tertutup, siswa yang sama boleh dibuatkan izin baru.
  assert.equal(setujui(s, 'wali', '1001', 'kembali', 'keperluan lain').status, 'success');
});

// ============================================================
// 12. MANIPULASI PARAMETER DARI KLIEN
// ============================================================

test('nama, kelas, dan status dari klien tidak dipercaya', () => {
  const s = loadServer();
  const buat = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001',
    name: 'Nama Karangan', class_name: 'XII C', // diabaikan — diambil dari Master_Siswa
    status: 'Sedang di Luar',                    // diabaikan — status ditentukan server
    tujuan: 'kembali', keperluan: 'kontrol',
    disetujui_oleh: 'Kepala Sekolah',            // diabaikan — diambil dari sesi
  });
  const row = s.izinById(buat.id);
  assert.equal(row[2], 'Rahma');
  assert.equal(row[3], 'XI B');
  assert.equal(row[7], 'Menunggu Verifikasi');
  assert.equal(row[10], 'Pak Anwar');
});

test('NISN yang tidak ada di data induk ditolak', () => {
  const s = loadServer();
  const res = s.post('wali', { action: 'addIzinKeluar', nisn: '9999', tujuan: 'kembali', keperluan: 'x' });
  assert.equal(res.status, 'error');
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length);
});

test('tujuan & keperluan divalidasi server', () => {
  const s = loadServer();
  assert.equal(s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'terbang', keperluan: 'x' }).status, 'error');
  assert.equal(s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: '   ' }).status, 'error');
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length);
});

test('id transaksi yang tidak dikenal ditolak, dan tidak mengenai baris lain', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: 'id-karangan' }).status, 'error');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: '' }).status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi', 'baris lain tidak ikut berubah');
});

// ============================================================
// 13. AUDIT TRAIL
// ============================================================

test('setiap tahap meninggalkan jejak di Audit_Log', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol gigi');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });

  const aksi = s.auditRows().map((r) => r[3]);
  assert.ok(aksi.includes('Persetujuan Izin Keluar'));
  assert.ok(aksi.includes('Verifikasi Izin Keluar'));
  assert.ok(aksi.includes('Tandai Kembali Izin Keluar'));
  // Tidak ada jejak "Selesaikan Izin Keluar" terpisah lagi — Tandai Kembali
  // SUDAH jejak finalnya, satu langkah, satu baris audit.
  assert.ok(!aksi.includes('Selesaikan Izin Keluar'));

  // Nama pelakunya ikut tercatat di kolom Nama, bukan cuma di teks detail.
  const byAksi = (nama) => s.auditRows().find((r) => r[3] === nama);
  assert.equal(byAksi('Persetujuan Izin Keluar')[1], 'Bu Kartina');
  assert.equal(byAksi('Verifikasi Izin Keluar')[1], 'Pak Piket Pagi');
  assert.equal(byAksi('Tandai Kembali Izin Keluar')[1], 'Bu Piket Siang');
  // Baris "Tandai Kembali" itu sendiri sudah menyebut status finalnya.
  assert.match(String(byAksi('Tandai Kembali Izin Keluar')[4]), /status=Selesai/);
});

test('Izin Khusus tercatat sebagai jalur khusus + alasannya di Audit_Log', () => {
  const s = loadServer();
  s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '3003', tujuan: 'pulang', keperluan: 'sakit',
    jalur: 'khusus', alasan_khusus: 'Guru yang menangani siswa tidak ada di sekolah',
  });
  const baris = s.auditRows().find((r) => r[3] === 'Izin Keluar Khusus');
  assert.ok(baris, 'aksi jalur khusus tidak boleh tercatat dengan nama yang sama seperti jalur normal');
  assert.match(String(baris[4]), /jalur=khusus/);
  assert.match(String(baris[4]), /Guru yang menangani siswa tidak ada di sekolah/);
  assert.equal(baris[1], 'Pak Piket Pagi');
});

test('Audit Log tetap Admin-only — fitur baru tidak melonggarkannya', () => {
  const s = loadServer();
  assert.equal(s.get('bk', { action: 'getAuditLog' }).status, 'error');
  assert.equal(s.get('piketPagi', { action: 'getAuditLog' }).status, 'error');
  assert.equal(s.get('admin', { action: 'getAuditLog' }).status, 'success');
});

// ============================================================
// 14. INTEGRASI RIWAYAT / CAKUPAN BACA
// ============================================================

const ringkas = (list) => list.map((i) => `${i.name}/${i.class}/${i.status}`);

test('getIzinKeluar: admin & BK melihat seluruh sekolah', () => {
  const s = loadServer();
  ['admin', 'bk'].forEach((who) => {
    const res = s.get(who, { action: 'getIzinKeluar' });
    assert.equal(res.status, 'success');
    assert.equal(res.izin.length, IZIN_FIXTURE.length, who + ' harus melihat semua baris');
  });
});

test('getIzinKeluar: transaksi BERJALAN terlihat semua guru (petugas piket harus bisa menandai kembali)', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '3003', 'kembali', 'lomba'); // siswa XII C
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  // Pak Anwar bukan wali kelas XII C dan bukan yang menyetujui, tapi transaksi
  // ini masih berjalan — sama seperti "hari ini seluruh sekolah" pada alur gerbang.
  const daftar = ringkas(s.get('pemberiIzin', { action: 'getIzinKeluar' }).izin);
  assert.ok(daftar.includes('Citra/XII C/Sedang di Luar'));
});

test('getIzinKeluar: riwayat TERTUTUP tidak memperluas hak baca guru biasa', () => {
  const s = loadServer();
  const daftar = ringkas(s.get('pemberiIzin', { action: 'getIzinKeluar' }).izin);
  // Dua baris fixture dari hari-hari sebelumnya (sudah Selesai) tidak boleh ikut.
  assert.ok(!daftar.includes('Rahma/XI B/Selesai'));
  assert.ok(!daftar.includes('Citra/XII C/Selesai'));
  // Yang tertutup HARI INI tetap terlihat — aturan yang sama dengan
  // Keterlambatan & Surat, bukan aturan baru.
  assert.ok(daftar.includes('Dedi/XII C/Pulang'));
});

test('getIzinKeluar: wali kelas melihat riwayat kelasnya, bukan kelas lain', () => {
  const s = loadServer();
  const daftar = ringkas(s.get('wali', { action: 'getIzinKeluar' }).izin);
  assert.ok(daftar.includes('Rahma/XI B/Selesai'), 'riwayat kelas perwalian ikut');
  assert.ok(!daftar.includes('Citra/XII C/Selesai'), 'riwayat kelas lain tetap tertutup');
});

test('getIzinKeluar: cache mentah & global — daftar satu guru tidak bocor ke guru lain', () => {
  const s = loadServer();
  // Guru biasa memanggil DULU (mengisi cache), baru admin.
  const guru = s.get('pemberiIzin', { action: 'getIzinKeluar' });
  const adm = s.get('admin', { action: 'getIzinKeluar' });
  assert.ok(guru.izin.length < adm.izin.length, 'hasil guru biasa lebih sempit');
  assert.equal(adm.izin.length, IZIN_FIXTURE.length, 'admin tidak menerima sisa hasil filter guru');
  // Yang di-cache harus daftar MENTAH, bukan hasil yang sudah difilter.
  assert.equal(JSON.parse(s.cacheStore.izin_keluar_raw).length, IZIN_FIXTURE.length);
});

// ============================================================
// 15. REGRESI FITUR LAIN
// ============================================================

test('Gerbang, Surat & Pelanggaran tidak terpengaruh fitur baru', () => {
  const s = loadServer();
  setujui(s, 'wali', '1001', 'kembali', 'kontrol');

  assert.equal(s.get('admin', { action: 'getLogs' }).logs.length, 1);
  assert.equal(s.get('admin', { action: 'getSurat' }).surat.length, 1);
  assert.equal(s.get('admin', { action: 'getPelanggaran' }).pelanggaran.length, 1);
  // Aksi lama tetap jalan seperti biasa.
  assert.equal(s.post('piketPagi', { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI A', type: 'Hujan' }).status, 'success');
  assert.equal(s.post('piketPagi', { action: 'addSurat', nisn: '3003', name: 'Citra', class_name: 'XII C', jenis: 'Sakit', keterangan: 'flu' }).status, 'success');
});

test('Izin Keluar tidak bisa diubah/dihapus lewat editEntry/deleteEntry', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  const row = s.izinById(buat.id);

  const edit = s.post('admin', { action: 'editEntry', category: 'izin', nisn: '1001', timestamp: row[0], name: 'Rahma' });
  assert.equal(edit.status, 'error');
  assert.match(edit.message, /[Kk]ategori/);
  const hapus = s.post('admin', { action: 'deleteEntry', category: 'izin', nisn: '1001', timestamp: row[0], name: 'Rahma' });
  assert.equal(hapus.status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi', 'baris izin tetap utuh');
});

test('penanda versi backend ikut naik & menyebut fitur baru', () => {
  const s = loadServer();
  const ping = JSON.parse(vm.runInContext('doGet', s.sandbox)({ parameter: { token: 'TOKEN-OK' } }).text);
  assert.equal(ping.status, 'active');
  assert.ok(ping.features.includes('izinKeluar'), 'status ping harus bisa membedakan deployment lama & baru');
  // Fitur lama tidak boleh hilang dari daftar.
  ['exportData', 'scopedLogs', 'adminOnlyAuditLog'].forEach((f) => assert.ok(ping.features.includes(f)));
});

// ============================================================
// 16. TIDAK ADA MEKANISME JADWAL MENGAJAR — dan tidak boleh ada
// ============================================================
// Keputusan yang disengaja: jadwal mengajar aktual berubah sewaktu-waktu, jadi
// "guru mata pelajaran pada jam tersebut" TIDAK bisa diverifikasi sistem ini.
// Yang direkam cukup identitas pemberi persetujuan (dari sesi) + waktunya.
// Test ini yang menahan supaya nanti tidak ada yang "melengkapi" fitur ini
// dengan sheet/mapping/endpoint jadwal mengajar atau role baru.

test('server tidak punya sheet/mapping/endpoint jadwal mengajar', () => {
  const src = ['Utils.gs', 'Code.gs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  [/Jadwal_Mengajar/i, /jadwalMengajar/i, /jam_?mengajar/i, /getJadwalMengajar/i, /mapel[A-Z_]/].forEach((pola) => {
    assert.doesNotMatch(src, pola, 'tidak boleh ada mekanisme jadwal mengajar: ' + pola);
  });
  // Kewenangan piket tetap dari mekanisme yang SUDAH ADA, bukan yang baru.
  assert.match(src, /getSheetByName\('Jadwal_Piket'\)/);
});

test('persetujuan tidak membaca klaim peran apa pun dari klien', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const blok = code.split("if (action === 'addIzinKeluar')")[1].split("if (action === 'verifikasiIzinKeluar')")[0];
  // Satu-satunya field yang dibaca dari body permintaan.
  const dibaca = [...new Set((blok.match(/data\.[a-zA-Z_]+/g) || []))].sort();
  assert.deepEqual(dibaca, ['data.alasan_khusus', 'data.jalur', 'data.keperluan', 'data.nisn', 'data.tujuan']);
  // Identitas pemberi persetujuan datang dari SESI, bukan dari klien.
  assert.match(blok, /sessionUser\.name/);
  assert.match(blok, /sessionUser\.id/);
});

test('klaim peran yang tetap dikirim klien tidak mengubah apa pun', () => {
  const s = loadServer();
  // Guru biasa mengaku-ngaku wali kelas / guru mapel jam itu. Tidak ada
  // pengaruhnya: hasilnya sama persis dengan permintaan tanpa klaim apa pun,
  // dan yang tersimpan tetap identitas sesinya.
  const buat = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol',
    peran: 'wali_kelas', role: 'admin', sebagai: 'Guru Mapel', jamKe: 3, waliKelas: 'XI B',
  });
  assert.equal(buat.status, 'success');
  const row = s.izinById(buat.id);
  assert.equal(row[10], 'Pak Anwar', 'pemberi persetujuan tetap dari sesi');
  assert.equal(row[11], 'G03');
  assert.equal(row[7], 'Menunggu Verifikasi', 'klaim peran tidak mempercepat satu langkah pun');
  // Tidak ada satu pun klaim itu yang ikut tersimpan ke baris.
  assert.ok(!JSON.stringify(row).includes('wali_kelas'));
  assert.ok(!JSON.stringify(row).includes('Guru Mapel'));
});

// ============================================================
// 17. KONTEKS PERSETUJUAN: Wali Kelas vs Guru Mapel
// ============================================================
// MURNI label tampilan/audit, DIHITUNG DI SERVER dari sessionUser.waliKelas +
// kelas siswa (Master_Siswa) — bukan role baru, bukan klaim jadwal mengajar,
// dan tidak pernah menggerbangi otorisasi: siapa boleh menyetujui/verifikasi
// tetap persis aturan lama (semua guru non-OSIS boleh menyetujui siapa pun,
// Guru Piket dari Jadwal_Piket yang memverifikasi).

test('walas menyetujui siswa kelasnya sendiri → konteks Wali Kelas tercatat', () => {
  const s = loadServer();
  s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' }); // Rahma, XI B
  const baris = s.auditRows().find((r) => r[3] === 'Persetujuan Izin Keluar');
  assert.match(String(baris[4]), /konteks=Wali Kelas/);
});

test('walas menyetujui siswa kelas LAIN → konteks Wali Kelas TIDAK tersedia, jatuh ke Guru Mapel', () => {
  const s = loadServer();
  s.post('wali', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'kembali', keperluan: 'kontrol' }); // Budi, XI A — bukan XI B
  const baris = s.auditRows().find((r) => r[3] === 'Persetujuan Izin Keluar');
  assert.match(String(baris[4]), /konteks=Guru Mapel/);
  assert.doesNotMatch(String(baris[4]), /konteks=Wali Kelas/);
});

test('guru biasa (tanpa kelas perwalian) → jalur Guru Mapel tersedia sesuai aturan existing', () => {
  const s = loadServer();
  s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' });
  const baris = s.auditRows().find((r) => r[3] === 'Persetujuan Izin Keluar');
  assert.match(String(baris[4]), /konteks=Guru Mapel/);
});

test('identitas & konteks dihitung dari session — bukan dari klien', () => {
  const s = loadServer();
  const buat = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' });
  assert.equal(buat.konteks, 'wali_kelas');
  const row = s.izinById(buat.id);
  assert.equal(row[10], 'Bu Kartina');
  assert.equal(row[11], 'G02');
});

test('client TIDAK BISA mengubah konteks/role untuk memperoleh kewenangan palsu', () => {
  const s = loadServer();
  // Pak Anwar (bukan wali kelas siapa pun) mengaku 'wali_kelas' dan mencoba
  // menyamar sebagai admin lewat field lepas — semuanya diabaikan.
  const buat = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol',
    konteks: 'wali_kelas', role: 'admin', waliKelas: 'XI B',
  });
  assert.equal(buat.status, 'success');
  assert.equal(buat.konteks, 'guru_mapel', 'server menghitung ulang sendiri, mengabaikan klaim klien');
  const baris = s.auditRows().find((r) => r[3] === 'Persetujuan Izin Keluar');
  assert.match(String(baris[4]), /konteks=Guru Mapel/);
  // Dan otorisasi tetap sama: tetap cuma "Menunggu Verifikasi", tidak ada hak
  // tambahan apa pun yang didapat dari klaim itu.
  assert.equal(s.izinById(buat.id)[7], 'Menunggu Verifikasi');
});

test('persetujuan Guru Mapel tetap harus masuk ke Guru Piket — tidak ada jalan pintas', () => {
  const s = loadServer();
  const buat = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'kembali', keperluan: 'kontrol' });
  assert.equal(buat.izinStatus, 'Menunggu Verifikasi');
  // Guru yang sama (bukan piket) tidak bisa langsung memverifikasi punyanya sendiri.
  assert.equal(s.post('pemberiIzin', { action: 'verifikasiIzinKeluar', id: buat.id }).status, 'error');
  // Guru Piket tetap bisa, sama seperti jalur Wali Kelas.
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }).izinStatus, 'Sedang di Luar');
});

test('konteks tidak ikut ke baris Izin Khusus — jalur khusus sudah punya penandanya sendiri', () => {
  const s = loadServer();
  // Pak Piket Pagi kebetulan bukan wali kelas siapa pun di sini, memakai Izin Khusus.
  const khusus = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: 'sakit',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak ada di sekolah',
  });
  const baris = s.auditRows().find((r) => r[3] === 'Izin Keluar Khusus');
  assert.doesNotMatch(String(baris[4]), /konteks=/, 'Izin Khusus tidak perlu label wali kelas/guru mapel — jalur=khusus sudah cukup jelas');
  assert.match(String(baris[4]), /jalur=khusus/);
});

test('Izin Khusus & verifikasi Guru Piket tetap berjalan tanpa perubahan (regresi)', () => {
  const s = loadServer();
  const khusus = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '3003', tujuan: 'pulang', keperluan: 'sakit',
    jalur: 'khusus', alasan_khusus: 'darurat',
  });
  assert.equal(khusus.status, 'success');
  assert.equal(khusus.izinStatus, 'Pulang');

  const normal = s.post('wali', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' });
  assert.equal(s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: normal.id }).izinStatus, 'Sedang di Luar');
  assert.equal(s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: normal.id }).izinStatus, 'Selesai');
});

test('tidak ada mapping jadwal guru mapel yang ditambahkan untuk fitur konteks ini', () => {
  const src = ['Utils.gs', 'Code.gs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  [/Jadwal_Mengajar/i, /jadwalMengajar/i, /getJadwalMengajar/i, /mapping.*guru.*kelas.*jam/i].forEach((pola) => {
    assert.doesNotMatch(src, pola, 'tidak boleh ada mekanisme jadwal mengajar: ' + pola);
  });
  // Konteks hanya membaca sessionUser.waliKelas + kelas siswa — tidak ada
  // sumber data baru sama sekali.
  assert.match(src, /function izinKonteksPersetujuan\(sessionUser, kelasSiswa\)/);
});

// ============================================================
// 18. BADGE "IZIN KELUAR" DI GERBANG/BERANDA — INPUT DATA UNTUK BADGE KLIEN
// ============================================================
// Badge itu sendiri murni derivasi klien (hitungIzinMenungguVerifikasi,
// helpers.js — lihat tests/izin-keluar-frontend.test.js). Yang dikunci di
// sini adalah bahwa BAHAN badge itu (izin, kelompok, canVerify dari
// getIzinKeluar) tetap benar untuk kasus "beberapa Guru Piket hari yang
// sama" — tidak ada perubahan backend untuk fitur badge, jadi ini murni
// regresi memastikan itu.

test('CASE F: dua Guru Piket hari yang sama sama-sama dapat canVerify=true & angka pending yang identik', () => {
  const s = loadServer();
  setujui(s, 'wali', '1001'); // Menunggu Verifikasi
  setujui(s, 'pemberiIzin', '2002'); // Menunggu Verifikasi

  const lihatPagi = s.get('piketPagi', { action: 'getIzinKeluar' });
  const lihatSiang = s.get('piketSiang', { action: 'getIzinKeluar' });
  assert.equal(lihatPagi.canVerify, true);
  assert.equal(lihatSiang.canVerify, true);

  const pendingPagi = lihatPagi.izin.filter((i) => i.status === 'Menunggu Verifikasi').length;
  const pendingSiang = lihatSiang.izin.filter((i) => i.status === 'Menunggu Verifikasi').length;
  assert.equal(pendingPagi, 2);
  assert.equal(pendingSiang, 2, 'kedua guru piket melihat bahan badge yang sama, bukan cuma salah satu dianggap berwenang');

  // Guru yang bukan piket hari ini tetap canVerify=false — badge-nya nanti 0.
  assert.equal(s.get('bukanPiket', { action: 'getIzinKeluar' }).canVerify, false);
});

test('backend getIzinKeluar tidak diubah untuk fitur badge (tetap izin/kelompok/canVerify, tanpa field count baru)', () => {
  const s = loadServer();
  const res = s.get('admin', { action: 'getIzinKeluar' });
  // sessionExpiresAt ikut nempel di semua respons via jsonOut (lihat Utils.gs)
  // — bukan sesuatu yang ditambahkan untuk fitur badge, jadi diabaikan di sini.
  const { sessionExpiresAt, ...isi } = res;
  assert.deepEqual(Object.keys(isi).sort(), ['canVerify', 'izin', 'kelompok', 'status'].sort());
});

// ============================================================
// 19. IZIN KHUSUS — kewenangan lengkap per role (audit eksplisit)
// ============================================================
// Backend & frontend Izin Khusus SUDAH benar sebelum blok ini ditambahkan —
// lihat test-test di section 7-8 di atas (petugas piket sukses, guru biasa
// ditolak, alasan wajib, tidak memalsukan persetujuan). Blok ini menutup
// SATU celah CAKUPAN TEST, bukan bug implementasi: BK dan Admin sebelumnya
// tidak pernah diuji secara eksplisit memakai jalur khusus untuk
// addIzinKeluar (cuma "tersirat lolos" lewat isBkRole), dan wali kelas yang
// BUKAN piket hari ini tidak pernah diuji sebagai skenario tersendiri, beda
// dari guru biasa non-wali — penting karena wali kelas gampang mengira
// kepemilikan kelasnya sendiri memberi kewenangan lebih. Tidak ada
// implementasi yang diubah untuk blok ini.

test('Guru Piket bertugas hari ini dapat memberikan Izin Khusus', () => {
  const s = loadServer();
  const res = s.post('piketPagi', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak dapat dihubungi',
  });
  assert.equal(res.status, 'success');
  assert.equal(s.izinById(res.id)[8], 'khusus');
});

test('BK/Kesiswaan dapat memberikan Izin Khusus', () => {
  const s = loadServer();
  const res = s.post('bk', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak dapat dihubungi',
  });
  assert.equal(res.status, 'success');
  assert.equal(s.izinById(res.id)[10], 'Bu BK', 'tercatat atas nama BK sendiri, bukan wali kelas/guru mapel siapa pun');
});

test('Admin dapat memberikan Izin Khusus', () => {
  const s = loadServer();
  const res = s.post('admin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak dapat dihubungi',
  });
  assert.equal(res.status, 'success');
  assert.equal(s.izinById(res.id)[10], 'Pak Admin');
});

test('guru biasa (bukan piket, bukan BK/Admin) ditolak memberikan Izin Khusus', () => {
  const s = loadServer();
  const res = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'saya mau bantu',
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Izin Khusus/);
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length);
});

test('wali kelas yang BUKAN piket hari ini ditolak memberikan Izin Khusus — kepemilikan kelas tidak memberi kewenangan ini', () => {
  const s = loadServer();
  // Bu Kartina wali kelas XI B (siswa 1001 ADA di kelasnya sendiri) tapi
  // TIDAK terjadwal piket hari ini (fixture Jadwal_Piket cuma G10/G11 hari
  // ini). Jadi kelas perwaliannya sendiri pun tidak memberi jalan pintas.
  const res = s.post('wali', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'saya wali kelasnya, biar saya putuskan',
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Izin Khusus/);
  assert.equal(s.izinRows().length, IZIN_FIXTURE.length, 'tidak ada baris yang tersimpan saat ditolak');
});

test('BK/Kesiswaan yang SEDANG PIKET hari ini dapat memberikan Izin Khusus, tercatat sebagai Guru Piket (bukan BK/Kesiswaan)', () => {
  // Audit "Izin Khusus disabled untuk BK piket/Admin": mengunci kombinasi yang
  // sebelumnya TIDAK punya test sendiri — role bk_kesiswaan YANG JUGA terjadwal
  // piket hari ini, memakai jalur khusus untuk MEMBUAT transaksi (bukan cuma
  // memverifikasi, yang sudah dikunci test kapasitas di atas). izinKapasitasVerifikasi
  // mengecek isPiketBertugas LEBIH DULU sebelum fallback isBkRole, jadi kapasitasnya
  // harus 'guru_piket', bukan 'bk_kesiswaan' — canVerifyIzin() (dipakai addIzinKeluar)
  // tetap true di kedua kasus, tapi labelnya harus jujur.
  const s = loadServer({ jadwalPiketRows: jadwalDenganWalasDanBk });
  const res = s.post('bk', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak dapat dihubungi',
  });
  assert.equal(res.status, 'success');
  assert.equal(s.izinById(res.id)[8], 'khusus');
  assert.equal(s.izinById(res.id)[10], 'Bu BK');
  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Izin Keluar Khusus').pop();
  assert.match(String(aksi[4]), /alasan pengecualian=/);
});

test('tombol "Izin Khusus" tidak pernah disabled/gagal untuk Admin karena data Jadwal_Piket — admin selalu lolos canVerifyIzin lepas dari isi Jadwal_Piket', () => {
  // Admin lolos canVerifyIzin() lewat isBkRole() TANPA PERNAH bergantung pada
  // Jadwal_Piket sama sekali (isBkRole('admin') selalu true) — jadi Jadwal_Piket
  // kosong, salah isi, atau formatnya tidak cocok TIDAK PERNAH bisa membuat akun
  // admin ditolak di sini. Dikunci eksplisit karena ini bagian dari root cause
  // yang diaudit (lihat laporan): admin TIDAK PERNAH boleh gagal karena data
  // Jadwal_Piket, apa pun isinya.
  const s = loadServer({ tanpaJadwalPiket: true });
  const res = s.post('admin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'Wali kelas & guru mapel tidak dapat dihubungi',
  });
  assert.equal(res.status, 'success');
});

test('klaim kapasitas/role dari client tidak bisa membuat Izin Khusus lolos untuk pengguna tak berwenang', () => {
  const s = loadServer();
  const res = s.post('pemberiIzin', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'demam',
    jalur: 'khusus', alasan_khusus: 'saya mau bantu',
    kapasitas: 'guru_piket', role: 'admin', canVerify: true, // semua diabaikan server
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Izin Khusus/);
});

test('alur izin normal tetap berjalan utuh setelah audit Izin Khusus ini (regresi)', () => {
  const s = loadServer();
  const normal = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  assert.equal(normal.izinStatus, 'Menunggu Verifikasi');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: normal.id }).izinStatus, 'Sedang di Luar');
  // Tandai Kembali sekarang langsung final — lihat blok audit UX di bawah.
  assert.equal(s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: normal.id }).izinStatus, 'Selesai');
});

// ============================================================
// AUDIT UX AGUSTUS 2026: "TUTUP TRANSAKSI" DIHAPUS
//
// Keputusan produk final: dua langkah (Kembali -> "Tutup transaksi" ->
// Selesai) untuk hasil yang sama-sama "siswa sudah balik" ternyata tidak
// menambah integritas apa pun — 'Kembali' TIDAK PERNAH terhitung transaksi
// terbuka (IZIN_STATUS_TERBUKA cuma [Menunggu Verifikasi, Sedang di Luar]),
// jadi klik kedua itu murni kosmetik sekaligus beban tambahan buat Guru
// Piket. Aksi 'selesaikanIzinKeluar' DIHAPUS dari server. Sekarang:
//
//   tandaiKembaliIzinKeluar  = mencatat KEJADIAN sekaligus MENYELESAIKAN —
//                              status langsung 'Selesai', Waktu_Kembali +
//                              siapa yang mencatat tetap ditulis di baris
//                              yang sama. HANYA dari 'Sedang di Luar'. Satu
//                              langkah, tidak ada aksi administratif kedua.
//   tandaiPulangIzinKeluar / verifikasi dgn tujuan pulang
//                            = 'Pulang' — SUDAH final dengan sendirinya,
//                              tidak pernah butuh penutupan terpisah.
//
// 'Selesai' (siswa balik) dan 'Pulang' (siswa tidak balik) dibedakan lewat
// kolom TUJUAN, bukan lewat nilai Status — audit tetap bisa membedakan
// keduanya walau Status akhirnya berbeda kata ('Selesai' vs 'Pulang').
// ============================================================

test('Tandai Kembali langsung SELESAI dalam satu langkah — tidak ada aksi kedua yang menunggu', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'ambil seragam');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(s.izinById(buat.id)[7], 'Sedang di Luar');

  const hasil = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(hasil.status, 'success');
  assert.equal(hasil.izinStatus, 'Selesai');
  const baris = s.izinById(buat.id);
  assert.equal(baris[7], 'Selesai');
  assert.ok(baris[17], 'Waktu_Kembali tetap terisi walau statusnya langsung Selesai');
  assert.equal(baris[18], 'Bu Piket Siang', 'siapa yang mencatat kembali tetap tersimpan');
  assert.equal(baris[6], 'kembali', 'kolom Tujuan tetap membedakan dari jalur pulang');
});

test('aksi "selesaikanIzinKeluar" sudah tidak ada — bukan cuma ditolak, tapi tidak dikenali', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol gigi');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  const sebelum = s.izinById(buat.id).slice();

  const hasil = s.post('bk', { action: 'selesaikanIzinKeluar', id: buat.id });
  assert.equal(hasil.status, 'error');
  // Bukan pesan spesifik "sudah selesai" (yang tersisa dari state machine
  // lama) — server memang tidak mengenali aksi ini lagi.
  assert.doesNotMatch(String(hasil.message || ''), /menutup transaksi izin/);
  assert.deepEqual(s.izinById(buat.id), sebelum, 'permintaan ke aksi yang tidak ada tidak mengubah apa pun');
});

test('setelah Tandai Kembali, tidak ada aksi lanjutan yang diterima — status final menolak semuanya', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '2002', 'kembali', 'ambil obat');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(s.izinById(buat.id)[7], 'Selesai');

  ['verifikasiIzinKeluar', 'tandaiKembaliIzinKeluar', 'tandaiPulangIzinKeluar'].forEach((aksi) => {
    const hasil = s.post('admin', { action: aksi, id: buat.id });
    assert.equal(hasil.status, 'error', aksi + ' pada transaksi Selesai harus ditolak');
  });
  assert.equal(s.izinById(buat.id)[7], 'Selesai', 'status tidak bergeser oleh permintaan yang ditolak');
});

test('jalur Pulang tidak pernah butuh penutupan terpisah — sudah final sejak diverifikasi', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '3003', 'pulang', 'dijemput orang tua');
  const ver = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(ver.izinStatus, 'Pulang');
  const baris = s.izinById(buat.id);
  assert.equal(baris[7], 'Pulang');
  assert.equal(baris[17], '', 'tidak ada Waktu_Kembali untuk siswa yang memang tidak kembali');
  assert.equal(baris[6], 'pulang', 'Tujuan tetap membedakan dari hasil "kembali"');

  // Tidak ada aksi lanjutan apa pun yang diterima — 'Pulang' sudah final.
  ['tandaiKembaliIzinKeluar', 'tandaiPulangIzinKeluar', 'verifikasiIzinKeluar'].forEach((aksi) => {
    assert.equal(s.post('admin', { action: aksi, id: buat.id }).status, 'error');
  });
});

test('Kewenangan Tandai Kembali = kewenangan verifikasi, BUKAN kepemilikan transaksi', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'urusan keluarga');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  // Pemberi persetujuan awal TIDAK otomatis boleh menandai kembali (dia bukan piket).
  const olehWali = s.post('wali', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(olehWali.status, 'error');
  assert.equal(s.izinById(buat.id)[7], 'Sedang di Luar');

  // Petugas piket shift LAIN — bukan yang menyetujui, bukan yang verifikasi —
  // tetap boleh menandai kembali (pergantian shift, aturan lama tidak berubah).
  assert.equal(s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id }).izinStatus, 'Selesai');
});

test('transaksi yang sudah Selesai tetap terbaca di daftar — tidak disembunyikan, tidak dihapus', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'ambil berkas');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });

  // Admin/BK: seluruh sekolah, termasuk yang sudah Selesai.
  const daftarAdmin = s.get('admin', { action: 'getIzinKeluar' }).izin;
  const baris = daftarAdmin.find((i) => i.id === buat.id);
  assert.ok(baris, 'transaksi yang selesai tetap ada di daftar');
  assert.equal(baris.status, 'Selesai');
  assert.equal(baris.disetujui_oleh, 'Bu Kartina');
  assert.equal(baris.diverifikasi_oleh, 'Pak Piket Pagi');
  assert.ok(baris.waktu_kembali, 'waktu kembali tetap ikut terkirim');

  // Cakupan baca TIDAK berubah gara-gara statusnya selesai: aturan riwayat
  // tertutup yang sudah ada tetap berlaku, tidak ada pelonggaran maupun
  // penyembunyian.
  const daftarWali = s.get('wali', { action: 'getIzinKeluar' }).izin;
  assert.ok(daftarWali.some((i) => i.id === buat.id), 'wali kelas siswa ini tetap melihat riwayatnya');
});

test('lima status, tidak ada status baru yang ditambahkan oleh perubahan ini', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const konstanta = (utils.match(/var IZIN_STATUS_[A-Z_]+ = /g) || []).map((m) => m.replace('var ', '').replace(' = ', ''));
  assert.deepEqual(konstanta.sort(), [
    'IZIN_STATUS_DI_LUAR', 'IZIN_STATUS_KEMBALI', 'IZIN_STATUS_MENUNGGU',
    'IZIN_STATUS_PULANG', 'IZIN_STATUS_SELESAI', 'IZIN_STATUS_TERBUKA',
  ]);
  // Skema Izin_Keluar tetap 24 kolom (21 dari sebelumnya + Nomor_Surat/
  // Waktu_Print/Status_Print milik fitur Cetak Surat Izin, audit September
  // 2026) — audit satu-langkah "Tandai Kembali" yang diuji test ini sendiri
  // TIDAK menambah kolom apa pun.
  assert.match(utils, /var IZIN_NUM_COLS = IZIN_HEADERS\.length; \/\/ 24/);
});

test('tidak ada role "Guru Piket" yang dibuat — kewenangannya tetap dari Jadwal_Piket', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  // Entri ROLES dikenali dari adanya `menus:` — NAV_ITEMS juga memakai
  // `label:` tapi tidak punya daftar menu.
  const roles = (cfg.match(/^\s+(\w+):\s+\{ label:[^\n]*menus:/gm) || []).map((m) => m.trim().split(':')[0]);
  assert.deepEqual(roles.sort(), ['admin', 'bk_kesiswaan', 'guru', 'osis']);
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  assert.match(utils, /function isPiketBertugas/);
  assert.match(utils, /Jadwal_Piket/);
  // 'guru_piket' SEKARANG memang muncul di Utils.gs (IZIN_KAPASITAS_PIKET,
  // audit Agustus 2026) — tapi itu nilai KAPASITAS hasil komputasi, bukan
  // role baru. Yang benar-benar dilarang: role akun dibandingkan/diberi
  // nilai piket secara langsung (sessionUser.role diperiksa terhadap
  // sesuatu selain 'admin'/'bk_kesiswaan'/'guru'/'osis' yang sudah ada).
  assert.ok(!/isPiketRole|role === 'piket'|sessionUser\.role === 'guru_piket'|newRole.*piket/i.test(utils));
  // Kapasitas itu MURNI derivasi Jadwal_Piket + isBkRole — tidak pernah
  // membaca sessionUser.role terhadap nilai piket apa pun.
  assert.match(utils, /function izinKapasitasVerifikasi/);
});
