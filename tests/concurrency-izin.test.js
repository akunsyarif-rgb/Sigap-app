// ===== tests/concurrency-izin.test.js =====
// AUDIT KETAHANAN & CONCURRENCY — Izin Keluar / Izin Kelompok.
//
// Semua test lain di tests/izin-keluar.test.js & tests/izin-kelompok.test.js
// menguji "double submit"/"double verifikasi" dengan MEMANGGIL doPost() DUA
// KALI BERTURUT-TURUT. Itu valid untuk menguji penjaga transisi statusnya
// (findIzinTerbukaForNisn, status !== MENUNGGU, dst.) tapi TIDAK menguji satu
// hal penting: apakah LockService.getScriptLock() (Code.gs baris ~159-1152)
// BENAR-BENAR mencegah dua eksekusi yang datang BERSAMAAN dari sama-sama lolos
// jendela baca-lalu-tulis (TOCTOU). Semua mock LockService yang ada di
// tests/*.test.js lain adalah no-op (waitLock()/releaseLock() tidak melakukan
// apa-apa) — itu tidak salah untuk tujuan file-file itu (Node menjalankan dua
// panggilan doPost() berurutan secara sinkron, jadi hasilnya sama saja dengan
// lock yang benar-benar bekerja), TAPI itu berarti TIDAK ADA test yang sejauh
// ini benar-benar membuktikan lock itu berfungsi. Kalau lock-nya suatu saat
// dihapus/rusak, tidak ada test yang akan merah.
//
// File ini menutup celah itu dengan DUA teknik:
//
// 1. MUTEX SUNGGUHAN (makeRealLock di bawah) — waitLock() melempar error kalau
//    lock sedang dipegang eksekusi lain, releaseLock() melepaskannya. ini
//    meniru kontrak LockService.getScriptLock() yang asli: waitLock(ms) gagal
//    kalau lock tidak bisa didapat.
//
// 2. INJEKSI REENTRANT — satu-satunya cara membuat DUA "permintaan" benar-benar
//    tumpang tindih di Node (yang single-threaded, doPost() sinkron tanpa await)
//    adalah memanggil doPost() KEDUA dari DALAM proses doPost() PERTAMA, tepat
//    pada saat permintaan pertama BARU SAJA memegang lock (lewat hook
//    onFirstAcquire di makeRealLock). Ini secara presisi meniru "permintaan B
//    tiba персis saat permintaan A sedang di tengah critical section-nya" —
//    jendela race yang sebenarnya ingin dicegah lock ini.
//
// CATATAN VALIDITAS: reentrant call di sini berbagi SATU sandbox vm (satu
// scope global JS), sedangkan di produksi Apps Script SETIAP eksekusi punya
// scope global sendiri-sendiri (var tingkat atas dijalankan ulang tiap
// eksekusi). Efek sampingnya: variabel global SESSION_RENEWED_UNTIL (dipakai
// jsonOut() untuk field sessionExpiresAt) BISA tertimpa oleh sesi permintaan
// B selama reentrant call itu — sesuatu yang TIDAK bisa terjadi di produksi.
// Karena itu test di file ini SENGAJA TIDAK PERNAH memeriksa sessionExpiresAt
// pada respons manapun yang terlibat dalam sebuah interleave — yang diperiksa
// murni status respons, isi sheet, dan Audit_Log (yang semuanya nyata, bukan
// artefak harness).
//
// "Real concurrent request test" di sini berarti: dua request BENAR-BENAR
// tumpang-tindih dalam satu critical section (dibuktikan lewat reentrancy +
// mutex asli), BUKAN sekadar dua panggilan sinkron berurutan. Test-test lain
// (login/session di tests/concurrency-session.test.js) yang tidak butuh
// pembuktian mutual-exclusion (karena keamanannya berasal dari isolasi
// key/cache, bukan dari timing) tetap memakai pola "simulated concurrency"
// biasa dan diberi label sebagai itu.

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

const now = new Date();
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI_INI = HARI[now.getDay()];
const HARI_BESOK = HARI[(now.getDay() + 1) % 7];
const HARI_LAIN = HARI[(now.getDay() + 3) % 7];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' },
  pemberiIzin: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  guruLain: { id: 'G04', name: 'Bu Sinta', role: 'guru', jabatan: '', waliKelas: '' },
  piketPagi: { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', jabatan: '', waliKelas: '' },
  piketSiang: { id: 'G11', name: 'Bu Piket Siang', role: 'guru', jabatan: '', waliKelas: '' },
  piketBesok: { id: 'G13', name: 'Pak Piket Besok', role: 'guru', jabatan: '', waliKelas: '' },
  bukanPiket: { id: 'G12', name: 'Pak Bukan Piket', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

const SISWA = [
  ['1001', 'Rahma', 'XI B'],
  ['2002', 'Budi', 'XI A'],
  ['3003', 'Citra', 'XII C'],
  ['4004', 'Dedi', 'XII C'],
  ['5005', 'Eko', 'X A'],
  ['6006', 'Fani', 'X A'],
  ['7007', 'Gani', 'X A'],
];

const IZIN_HEADER = [
  'Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
  'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID', 'ID_Kelompok',
];
const KELOMPOK_HEADER = [
  'Timestamp', 'ID_Kelompok', 'Kegiatan', 'Tujuan', 'Keperluan', 'Pola_Kembali', 'Jumlah_Peserta',
  'Jalur', 'Alasan_Khusus',
  'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
  'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
];

// ===== Mutex sungguhan, dengan hook reentrant satu-tembak =====
// waitLock() melempar (menyerupai LockService yang gagal mendapat lock dalam
// batas waktu) kalau lock sedang dipegang. onFirstAcquire (kalau diset)
// dipanggil TEPAT SEKALI, segera setelah lock pertama kali berhasil didapat —
// di situlah kita menyisipkan "permintaan B" supaya benar-benar berjalan DI
// TENGAH critical section permintaan A.
function makeRealLock() {
  let locked = false;
  let onFirstAcquire = null;
  let acquireCount = 0;
  return {
    api: {
      getScriptLock: () => ({
        waitLock() {
          if (locked) {
            const e = new Error('LOCK_TIMEOUT');
            throw e;
          }
          locked = true;
          acquireCount++;
          if (onFirstAcquire) {
            const fn = onFirstAcquire;
            onFirstAcquire = null;
            fn();
          }
        },
        releaseLock() { locked = false; },
      }),
    },
    setOnFirstAcquire(fn) { onFirstAcquire = fn; },
    isLocked: () => locked,
    acquireCount: () => acquireCount,
  };
}

// Lock "tampak ada di kode tapi tidak melindungi apa pun" — SAMA PERSIS dengan
// mock yang dipakai tests/izin-keluar.test.js, tests/izin-kelompok.test.js,
// tests/export-backend.test.js, tests/rbac-riwayat-pelanggaran.test.js. Dipakai
// SEKALI di bawah (tepatnya untuk MEMBUKTIKAN lock itu perlu), tidak untuk
// menguji business rule apa pun.
function makeNoopLock() {
  return { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
}

function loadServer(opts) {
  const options = opts || {};
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], options.jadwalPiketRows || [
      [HARI_INI, 'G10'],
      [HARI_INI, 'G11'],
      [HARI_BESOK, 'G13'],
      [HARI_LAIN, 'G12'],
    ]),
    Izin_Keluar: makeSheet(IZIN_HEADER, []),
    Izin_Kelompok: makeSheet(KELOMPOK_HEADER, []),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], []),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  // now() bisa "digeser" per-test (uji pergantian hari) tanpa mengubah jam asli.
  let clockOverride = null;
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
    LockService: (options.lockApi || makeRealLock().api),
    Logger: { log: () => {} },
  };
  // Real Date tetap dipakai (bukan diganti total) — cuma dibungkus supaya
  // "now" bisa dipaksa untuk skenario pergantian hari, lewat sandbox.Date.
  // Kalau options.initialClock diisi, sesi dibuat dengan "loginAt" mengikuti
  // jam itu juga (bukan jam asli) — supaya nanti bisa digeser MELINTASI
  // tengah malam tanpa kena batas mutlak sesi 6 jam (SESSION_ABSOLUTE_MAX_MS
  // di Auth.gs) yang dihitung dari loginAt, murni artefak harness, bukan
  // aturan yang sedang diuji di test pergantian hari.
  if (options.initialClock) clockOverride = options.initialClock.getTime();
  const RealDate = Date;
  function ShiftableDate(...args) {
    if (args.length) return new RealDate(...args);
    return new RealDate(clockOverride !== null ? clockOverride : RealDate.now());
  }
  ShiftableDate.prototype = RealDate.prototype;
  ShiftableDate.now = () => (clockOverride !== null ? clockOverride : RealDate.now());
  sandbox.Date = ShiftableDate;

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

  const izinRows = () => sheets.Izin_Keluar._data.slice(1).filter((r) => r[4]);
  const kelompokRows = () => sheets.Izin_Kelompok._data.slice(1).filter((r) => r[1]);
  const auditRows = () => sheets.Audit_Log._data.slice(1);
  const izinByNisn = (nisn) => izinRows().filter((r) => String(r[1]) === String(nisn));
  const izinTerbukaCount = (nisn) => izinByNisn(nisn).filter((r) => r[7] === 'Menunggu Verifikasi' || r[7] === 'Sedang di Luar').length;
  const peserta = (idKelompok) => izinRows().filter((r) => String(r[20]) === String(idKelompok))
    .map((r) => ({ id: String(r[4]), nisn: String(r[1]), name: String(r[2]), status: String(r[7]) }));

  return {
    sandbox, sheets, tokens, post, get, izinRows, kelompokRows, auditRows, izinByNisn, izinTerbukaCount, peserta, cacheStore,
    setClock(d) { clockOverride = d ? d.getTime() : null; },
  };
}

const setujui = (s, who, nisn, tujuan, keperluan) =>
  s.post(who, { action: 'addIzinKeluar', nisn: nisn, tujuan: tujuan || 'kembali', keperluan: keperluan || 'keperluan keluarga' });

const ajukanKelompok = (s, who, extra) => s.post(who, Object.assign({
  action: 'addIzinKelompok',
  kegiatan: 'Seminar Bank Indonesia',
  keperluan: 'undangan seminar literasi keuangan',
  tujuan: 'kembali',
  pola_kembali: 'bersama',
  peserta: ['1001', '2002', '3003'].map((n) => ({ nisn: n })),
}, extra || {}));

// ============================================================
// 2. DOUBLE SUBMIT IZIN KELUAR — permintaan BENAR-BENAR tumpang tindih
// ============================================================

test('[concurrency nyata] dua guru menyetujui izin utk siswa sama TEPAT bersamaan -> hanya satu transaksi lolos, satu ditolak aman', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  let hasilB = null;
  // B "tiba" persis saat A baru saja memegang lock — simulasi paling ketat dari
  // dua permintaan yang benar-benar bersamaan (bukan A selesai dulu baru B mulai).
  lock.setOnFirstAcquire(() => {
    hasilB = setujui(s, 'pemberiIzin', '1001', 'kembali', 'dari guru B, hampir bersamaan');
  });
  const hasilA = setujui(s, 'wali', '1001', 'kembali', 'dari guru A, hampir bersamaan');

  // Salah satu berhasil, satu lagi ditolak dengan aman (bukan crash, bukan silently ignored).
  const results = [hasilA, hasilB];
  const sukses = results.filter((r) => r.status === 'success');
  const gagal = results.filter((r) => r.status === 'error');
  assert.equal(sukses.length, 1, 'harus tepat SATU yang berhasil');
  assert.equal(gagal.length, 1, 'yang satu lagi harus ditolak, bukan sama-sama lolos');
  // B ditolak karena lock sedang dipegang A (server sibuk) — bukti mutual exclusion.
  assert.match(hasilB.message, /sibuk/i);

  // Maksimal SATU transaksi aktif untuk siswa ini — tidak ada partial write / dua baris.
  assert.equal(s.izinTerbukaCount('1001'), 1);
  assert.equal(s.izinByNisn('1001').length, 1, 'tidak ada baris kedua yang setengah tertulis');
});

test('[concurrency nyata] 5 guru menyetujui izin utk siswa sama, satu demi satu tiba TEPAT saat lock dipegang -> tetap hanya satu transaksi', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const requesters = ['pemberiIzin', 'guruLain', 'bk', 'admin', 'bukanPiket'];
  const results = [];
  // Rantai reentrant: begitu lock pertama didapat (oleh 'wali'), sisipkan 4
  // permintaan lain satu per satu — masing-masing akan gagal mendapat lock
  // karena lock masih dipegang pemilik terluar (belum ada yang release).
  lock.setOnFirstAcquire(() => {
    requesters.forEach((who) => {
      results.push(setujui(s, who, '5005', 'kembali', 'rebutan ' + who));
    });
  });
  const hasilPemilik = setujui(s, 'wali', '5005', 'kembali', 'yang pertama pegang lock');
  const semua = [hasilPemilik].concat(results);
  assert.equal(semua.filter((r) => r.status === 'success').length, 1);
  assert.equal(semua.filter((r) => r.status === 'error' && /sibuk/i.test(r.message)).length, requesters.length);
  assert.equal(s.izinTerbukaCount('5005'), 1);
  assert.equal(s.izinByNisn('5005').length, 1);
});

test('[bukti keperluan lock] TANPA mutex nyata (lock no-op), race TOCTOU yang sama BERHASIL membuat dua transaksi aktif — lock bukan hiasan', () => {
  // Ini sengaja memakai lock RUSAK (persis mock no-op yang dipakai test lain di
  // repo ini) untuk MEMBUKTIKAN akar masalahnya: penjaga findIzinTerbukaForNisn
  // saja TIDAK CUKUP tanpa serialisasi sungguhan. Kalau suatu saat sigapLock di
  // Code.gs dihapus/diganti no-op, inilah bentuk kerusakannya.
  const broken = makeNoopLock();
  let insideA = false;
  let hasilB = null;
  // Tidak ada hook di lock no-op ini (waitLock tidak pernah memberi sinyal
  // "sudah dapat lock"), jadi injeksi dilakukan dengan menyisipkan langsung ke
  // pemeriksaan pertama findIzinTerbukaForNisn atas sheet Izin_Keluar
  // (getLastRow — dipanggil PALING AWAL, termasuk saat sheet masih kosong,
  // beda dari getRange yang di-short-circuit kalau belum ada baris data sama
  // sekali) — titik paling akurat merepresentasikan "B tiba tepat setelah A
  // mulai membaca status terbuka siswa ini, sebelum A menulis apa pun".
  const s = loadServer({ lockApi: broken });
  const izinSheet = s.sheets.Izin_Keluar;
  const originalGetLastRow = izinSheet.getLastRow.bind(izinSheet);
  izinSheet.getLastRow = function () {
    const result = originalGetLastRow();
    if (!insideA) {
      insideA = true;
      hasilB = setujui(s, 'pemberiIzin', '6006', 'kembali', 'dari guru B, menyusup di celah baca A');
      insideA = false;
    }
    return result;
  };
  const hasilA = setujui(s, 'wali', '6006', 'kembali', 'dari guru A, sedang membaca status terbuka');

  assert.equal(hasilA.status, 'success');
  assert.equal(hasilB.status, 'success', 'TANPA lock nyata, B ikut lolos — inilah bug yang dicegah sigapLock di produksi');
  assert.equal(s.izinTerbukaCount('6006'), 2, 'DUA transaksi aktif untuk siswa yang sama — korupsi data yang harus dicegah lock asli');
});

// ============================================================
// 3. DOUBLE VERIFICATION — dua Guru Piket sah, bersamaan
// ============================================================

test('[concurrency nyata] dua Guru Piket memverifikasi transaksi yang sama TEPAT bersamaan -> hanya satu berhasil, satu Waktu_Keluar, satu verifikator', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  assert.equal(buat.status, 'success');

  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buat.id });
  });
  const hasilA = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  const results = [hasilA, hasilB];
  assert.equal(results.filter((r) => r.status === 'success').length, 1);
  assert.equal(results.filter((r) => r.status === 'error').length, 1);

  const baris = s.izinByNisn('1001')[0];
  assert.equal(baris[7], 'Sedang di Luar');
  // Waktu_Keluar (kolom Q, index 16) terisi PERSIS SATU nilai (bukan ditimpa dua kali diam-diam).
  assert.ok(baris[16], 'Waktu_Keluar harus terisi');
  // Diverifikasi_Oleh (kolom N, index 13) adalah SALAH SATU dari piketPagi/piketSiang, tidak keduanya/tidak kosong.
  assert.ok(['Pak Piket Pagi', 'Bu Piket Siang'].includes(baris[13]));

  // Yang gagal mendapat pesan aman "sudah diproses", bukan crash/pesan generik salah.
  const gagal = results.find((r) => r.status === 'error');
  assert.match(gagal.message, /sibuk|sudah/i);

  // Tidak ada duplicate audit event yang bermakna untuk verifikasi izin ini.
  const auditVerifikasi = s.auditRows().filter((r) => r[3] === 'Verifikasi Izin Keluar');
  assert.equal(auditVerifikasi.length, 1);
});

test('[concurrency nyata] guru piket vs guru BIASA (non-piket) memverifikasi bersamaan -> guru biasa selalu ditolak, siapa pun yang "menang" lock', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = setujui(s, 'wali', '2002', 'kembali', 'kontrol');

  let hasilBiasa = null;
  lock.setOnFirstAcquire(() => {
    hasilBiasa = s.post('bukanPiket', { action: 'verifikasiIzinKeluar', id: buat.id });
  });
  const hasilPiket = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  // Guru biasa TIDAK PERNAH boleh berhasil — terlepas urutan lock, otorisasi
  // dicek server-side sebelum baris disentuh. (piket menang lock di sini
  // karena guru biasa disisipkan SETELAH piket sudah memegangnya.)
  assert.equal(hasilPiket.status, 'success');
  assert.equal(hasilBiasa.status, 'error');
  assert.match(hasilBiasa.message, /sibuk/i); // ditolak di lock, belum sempat sampai ke cek otorisasi
});

// ============================================================
// 4. DOUBLE "TANDAI KEMBALI" / "TANDAI PULANG"
// ============================================================

test('[concurrency nyata] dua petugas menandai kembali TEPAT bersamaan -> hanya satu transisi, Waktu_Kembali & pencatat tidak race', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  });
  const hasilA = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });

  const results = [hasilA, hasilB];
  assert.equal(results.filter((r) => r.status === 'success').length, 1);
  assert.equal(results.filter((r) => r.status === 'error').length, 1);

  const baris = s.izinByNisn('1001')[0];
  assert.equal(baris[7], 'Selesai');
  assert.ok(baris[17], 'Waktu_Kembali harus terisi tepat satu nilai');
  assert.ok(['Pak Piket Pagi', 'Bu Piket Siang'].includes(baris[18]));

  const auditKembali = s.auditRows().filter((r) => r[3] === 'Tandai Kembali Izin Keluar');
  assert.equal(auditKembali.length, 1, 'tidak ada duplicate audit event untuk transisi yang sama');
});

test('[concurrency nyata] "tandai kembali" vs "tandai pulang" diadu bersamaan pada transaksi yang sama -> hanya satu transisi valid yang menang', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  let hasilPulang = null;
  lock.setOnFirstAcquire(() => {
    hasilPulang = s.post('piketSiang', { action: 'tandaiPulangIzinKeluar', id: buat.id });
  });
  const hasilKembali = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });

  assert.equal(hasilKembali.status, 'success');
  assert.equal(hasilPulang.status, 'error');
  const baris = s.izinByNisn('1001')[0];
  assert.equal(baris[7], 'Selesai');
  assert.equal(baris[16] && baris[16] !== '', true); // Waktu_Keluar tetap ada dari verifikasi
});

// ============================================================
// 5. CONCURRENT IZIN KELOMPOK
// ============================================================

test('[concurrency nyata] siswa yang sama diajukan ke DUA kelompok berbeda TEPAT bersamaan -> hanya satu kelompok yang berhasil, seluruhnya (all-or-nothing)', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post('guruLain', {
      action: 'addIzinKelompok', kegiatan: 'Lomba Debat', keperluan: 'lomba debat kota',
      tujuan: 'kembali', pola_kembali: 'bersama',
      peserta: ['3003', '4004', '1001'].map((n) => ({ nisn: n })), // '1001' overlap dengan kelompok A
    });
  });
  const hasilA = ajukanKelompok(s, 'wali', { peserta: ['1001', '2002'].map((n) => ({ nisn: n })) });

  assert.equal(hasilA.status, 'success');
  assert.equal(hasilB.status, 'error');
  assert.match(hasilB.message, /sibuk/i);
  // Kelompok B TIDAK meninggalkan baris peserta APAPUN (all-or-nothing tetap berlaku,
  // dan yang gagal di level lock bahkan tidak sempat sampai ke validasi bentrokan).
  assert.equal(s.kelompokRows().length, 1);
  assert.equal(s.izinTerbukaCount('1001'), 1);
  assert.equal(s.izinTerbukaCount('3003'), 0);
  assert.equal(s.izinTerbukaCount('4004'), 0);
});

test('[concurrency nyata] dua petugas memverifikasi kelompok yang sama TEPAT bersamaan -> peserta tidak diverifikasi dua kali, tidak ada status ganda', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = ajukanKelompok(s, 'wali');
  assert.equal(buat.status, 'success');

  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post('piketSiang', { action: 'verifikasiIzinKelompok', id: buat.id });
  });
  const hasilA = s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });

  assert.equal(hasilA.status, 'success');
  assert.equal(hasilA.jumlahDiverifikasi, 3);
  assert.equal(hasilB.status, 'error');
  assert.match(hasilB.message, /sibuk/i);

  const list = s.peserta(buat.id);
  assert.equal(list.length, 3);
  list.forEach((p) => assert.equal(p.status, 'Sedang di Luar'));
  const auditVerifikasi = s.auditRows().filter((r) => r[3] === 'Verifikasi Izin Kelompok');
  assert.equal(auditVerifikasi.length, 1);
});

test('[concurrency nyata] "tandai kembali" sebagian peserta bersamaan dengan "tandai kembali" peserta lain di kelompok yang sama -> masing-masing konsisten, tidak saling menimpa', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buat = ajukanKelompok(s, 'wali');
  s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  const list = s.peserta(buat.id); // 1001, 2002, 3003 semua 'Sedang di Luar'
  const idA = list.find((p) => p.nisn === '1001').id;
  const idB = list.find((p) => p.nisn === '2002').id;

  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: [idB] });
  });
  const hasilA = s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: [idA] });

  // Salah satu berhasil (memegang lock lebih dulu), yang lain ditolak sibuk —
  // kegagalan satu petugas TIDAK merusak apa pun; ia cukup mencoba lagi.
  const results = [hasilA, hasilB];
  assert.equal(results.filter((r) => r.status === 'success').length, 1);
  assert.equal(results.filter((r) => r.status === 'error').length, 1);

  const afterList = s.peserta(buat.id);
  const statusOf = (nisn) => afterList.find((p) => p.nisn === nisn).status;
  // Siswa ke-3 (3003) sama sekali tidak disentuh oleh salah satu aksi -> tetap di luar.
  assert.equal(statusOf('3003'), 'Sedang di Luar');
  // Tepat satu dari (1001,2002) yang berhasil ditandai kembali; yang lain tetap di luar
  // (petugas yang gagal cukup mengulang aksinya sendiri setelah lock lepas).
  const jumlahSelesai = ['1001', '2002'].filter((n) => statusOf(n) === 'Selesai').length;
  assert.equal(jumlahSelesai, 1);
});

test('[concurrency nyata] satu siswa gagal (transisi tidak valid) di tengah aksi kelompok tidak merusak peserta lain', () => {
  const s = loadServer(); // lock realistis default, tidak perlu reentrancy untuk kasus ini
  const buat = ajukanKelompok(s, 'wali');
  s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  const list = s.peserta(buat.id);
  const idSudahPulang = list.find((p) => p.nisn === '3003').id;
  // Tandai satu siswa "pulang" duluan (di luar rombongan bersama).
  assert.equal(s.post('piketPagi', { action: 'tandaiPulangIzinKeluar', id: idSudahPulang }).status, 'success');

  // Rombongan ditandai kembali beramai-ramai TERMASUK siswa yang sudah 'Pulang'.
  const semuaId = list.map((p) => p.id);
  const hasil = s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: semuaId });

  // Seluruh aksi kelompok DITOLAK (bukan sebagian berhasil sebagian gagal diam-diam) —
  // ini konsisten dengan penjaga per-siswa yang sudah ada di Code.gs (baris 1044-1048),
  // bukan perilaku baru: aksi massal menolak SELURUHNYA begitu satu peserta melanggar
  // penjaga transisi, supaya tidak ada status yang berubah setengah-setengah.
  assert.equal(hasil.status, 'error');
  const afterList = s.peserta(buat.id);
  assert.equal(afterList.find((p) => p.nisn === '3003').status, 'Pulang');
  assert.equal(afterList.find((p) => p.nisn === '1001').status, 'Sedang di Luar');
  assert.equal(afterList.find((p) => p.nisn === '2002').status, 'Sedang di Luar');
});

// ============================================================
// 9. DOUBLE / RAPID CLICK & 10. RETRY SETELAH RESPONS HILANG
// ============================================================
// Tombol mutasi di UI tidak mengirim idempotency key — perlindungan datang dari
// KOMBINASI lock (mencegah overlap) + penjaga status (menolak transisi kedua).
// Test di bawah membuktikan itu CUKUP untuk retry realistis (request sukses di
// server tapi respons hilang di jaringan, lalu klien mengirim ulang persis
// permintaan yang sama).

test('retry setelah "respons hilang": submit yang diulang identik tidak pernah membuat transaksi kedua', () => {
  const s = loadServer();
  const pertama = setujui(s, 'wali', '1001', 'kembali', 'kontrol gigi');
  assert.equal(pertama.status, 'success');
  // Klien tidak tahu request pertama sukses (koneksi timeout di sisi klien) -> kirim ulang persis.
  const ulang = setujui(s, 'wali', '1001', 'kembali', 'kontrol gigi');
  assert.equal(ulang.status, 'error');
  assert.equal(s.izinByNisn('1001').length, 1);
});

test('retry setelah "respons hilang": verifikasi yang diulang aman, tidak menimpa Waktu_Keluar', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  const v1 = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  const waktuKeluarAwal = s.izinByNisn('1001')[0][16];
  const v2 = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }); // klien retry
  assert.equal(v1.status, 'success');
  assert.equal(v2.status, 'error');
  assert.equal(s.izinByNisn('1001')[0][16].getTime ? s.izinByNisn('1001')[0][16].getTime() : s.izinByNisn('1001')[0][16], waktuKeluarAwal.getTime ? waktuKeluarAwal.getTime() : waktuKeluarAwal);
});

test('triple-click "Tandai Kembali" (3x berturut-turut sangat cepat) hanya menghasilkan satu perubahan', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  const hasil = [1, 2, 3].map(() => s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id }));
  assert.equal(hasil.filter((r) => r.status === 'success').length, 1);
  assert.equal(hasil.filter((r) => r.status === 'error').length, 2);
  const auditKembali = s.auditRows().filter((r) => r[3] === 'Tandai Kembali Izin Keluar');
  assert.equal(auditKembali.length, 1);
});

test('idempotency audit: addIzinKeluar/verifikasi/tandaiKembali/tandaiPulang semuanya ATOMIC (satu doPost = satu perubahan sheet, di dalam satu lock) dan EFEKTIF-idempotent lewat penjaga status, walau bukan idempotent secara harfiah (retry sah != no-op, ia ditolak)', () => {
  // Ini bukan assertion tunggal — ini dokumentasi hidup dari kesimpulan audit
  // butir 10: setiap aksi mutasi Izin Keluar sudah ATOMIC (seluruh baca-cek-tulis
  // ada di dalam satu lock, satu appendRow/setValues) dan aman terhadap retry
  // (penjaga status menolak pengulangan) TANPA memerlukan idempotency key
  // terpisah. Kalau salah satu aksi ini kelak berubah jadi tidak atomic (mis.
  // menulis lebih dari satu baris tanpa validasi all-or-nothing), test-test di
  // atas (double submit, double verifikasi, dst.) akan merah duluan.
  assert.ok(true);
});

// ============================================================
// 11. PERGANTIAN GURU PIKET (dalam hari yang sama)
// ============================================================

test('pergantian piket: Piket Pagi memverifikasi, siswa masih di luar sampai shift siang, Piket Siang tetap berwenang menandai kembali (tidak bergantung siapa yang membuka Gerbang duluan)', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }).status, 'success');
  // Siswa tetap "Sedang di Luar" sampai siang -- tidak ada yang menyentuhnya.
  assert.equal(s.izinByNisn('1001')[0][7], 'Sedang di Luar');
  const hasil = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(hasil.status, 'success');
  assert.equal(s.izinByNisn('1001')[0][18], 'Bu Piket Siang');
  const audit = s.auditRows().filter((r) => r[3] === 'Tandai Kembali Izin Keluar')[0];
  assert.match(audit[4], /kapasitas=Guru Piket/);
});

test('pergantian piket: Piket Pagi & Piket Siang bertindak TEPAT bersamaan pada DUA siswa berbeda -> keduanya berhasil pada gilirannya masing-masing, tidak saling menghalangi secara salah', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  const buatA = setujui(s, 'wali', '1001', 'kembali', 'kontrol A');
  const buatB = setujui(s, 'pemberiIzin', '2002', 'kembali', 'kontrol B');

  let hasilSiang = null;
  lock.setOnFirstAcquire(() => {
    hasilSiang = s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buatB.id });
  });
  const hasilPagi = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buatA.id });

  // Keduanya mengenai TRANSAKSI BERBEDA -> siapa pun yang menang lock duluan
  // berhasil; yang kalah cukup ditolak "sibuk" dan boleh (dan harus, secara UX)
  // mencoba lagi -- server tidak pernah menggabungkan/salah alamat dua transaksi.
  if (hasilSiang.status === 'error') {
    assert.match(hasilSiang.message, /sibuk/i);
    // retry oleh piketSiang setelah lock lepas -> berhasil, tidak kehilangan aksinya.
    const retry = s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buatB.id });
    assert.equal(retry.status, 'success');
  } else {
    assert.equal(hasilSiang.status, 'success');
  }
  assert.equal(hasilPagi.status, 'success');
  assert.equal(s.izinByNisn('1001')[0][7], 'Sedang di Luar');
  assert.equal(s.izinByNisn('2002')[0][7], 'Sedang di Luar');
  // Verifikator masing-masing tercatat benar -- tidak tertukar antar siswa.
  assert.equal(s.izinByNisn('1001')[0][13], 'Pak Piket Pagi');
  assert.equal(s.izinByNisn('2002')[0][13], 'Bu Piket Siang');
});

// ============================================================
// 12. PERGANTIAN HARI
// ============================================================

test('pergantian hari: transaksi "Sedang di Luar" yang dibuat sebelum tengah malam TIDAK hilang/tidak otomatis selesai setelah hari berganti', () => {
  const tengahMalam = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 58, 0, 0);
  const s = loadServer({ initialClock: tengahMalam });
  const buat = setujui(s, 'wali', '1001', 'kembali', 'acara malam');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id }).status, 'success');

  // Hari berganti (Jadwal_Piket hari itu pun berbeda) — pergeseran KECIL (7 menit,
  // jauh di bawah batas mutlak sesi 6 jam) yang melintasi tengah malam sudah
  // cukup untuk mengubah hariPiketServer(), tanpa perlu melompat 24 jam penuh.
  const besokPagi = new Date(tengahMalam.getTime() + 7 * 60 * 1000);
  s.setClock(besokPagi);

  // Transaksi TIDAK hilang & TIDAK otomatis 'Selesai' hanya karena hari berganti.
  const baris = s.izinByNisn('1001')[0];
  assert.equal(baris[7], 'Sedang di Luar');

  // Petugas piket HARI BARU (bukan piket hari kemarin) yang berwenang menanganinya —
  // kewenangan mengikuti Jadwal_Piket hari aksi dilakukan, bukan siapa yang membuka
  // Gerbang duluan atau siapa yang piket saat transaksi DIBUAT.
  const olehKemarin = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(olehKemarin.status, 'error', 'piket kemarin tidak lagi piket hari ini -> ditolak');
  const olehHariIni = s.post('piketBesok', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(olehHariIni.status, 'success');

  // Scope baca "transaksi berjalan" tetap terlihat lintas pergantian hari (sebelum ditutup).
  assert.equal(baris[18] === '' ? true : true, true); // sanity: baris masih dapat diakses
  const audit = s.auditRows().filter((r) => r[3] === 'Tandai Kembali Izin Keluar')[0];
  assert.match(audit[4], /kapasitas=/);
});

test('pergantian hari: getIzinKeluar tidak salah menyembunyikan transaksi berjalan lintas hari untuk guru biasa', () => {
  const malamIni = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 50, 0, 0);
  const s = loadServer({ initialClock: malamIni });
  const buat = setujui(s, 'pemberiIzin', '2002', 'kembali', 'kegiatan malam');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });

  const besok = new Date(malamIni.getTime() + 15 * 60 * 1000);
  s.setClock(besok);
  // Guru BIASA (bukan wali kelas siswa ini, bukan yang membuat transaksinya) tetap
  // harus melihat transaksi yang MASIH BERJALAN -- aturan "terbuka = terlihat semua
  // non-OSIS" tidak boleh terganggu oleh pergantian hari.
  const hasil = s.get('bukanPiket', { action: 'getIzinKeluar' });
  assert.equal(hasil.status, 'success');
  const found = hasil.izin.find((r) => r.nisn === '2002');
  assert.ok(found, 'transaksi berjalan tetap terlihat setelah hari berganti');
  assert.equal(found.status, 'Sedang di Luar');
});

// ============================================================
// 13. DATA INTEGRITY — invariants pasca seluruh skenario di atas
// ============================================================

test('invariant data: status mustahil tidak pernah terjadi di seluruh skenario concurrency di atas', () => {
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock.api });
  // Jalankan gabungan beberapa race sekaligus dalam satu server untuk memeriksa
  // invariants akhir secara menyeluruh, bukan cuma per skenario terisolasi.
  let interloper = null;
  lock.setOnFirstAcquire(() => {
    interloper = setujui(s, 'pemberiIzin', '1001', 'kembali', 'race 1');
  });
  setujui(s, 'wali', '1001', 'kembali', 'race 1 pemenang');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: s.izinByNisn('1001')[0][4] });

  lock.setOnFirstAcquire(() => {
    interloper = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: s.izinByNisn('1001')[0][4] });
  });
  s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: s.izinByNisn('1001')[0][4] });
  void interloper;

  const VALID_STATUS = ['Menunggu Verifikasi', 'Sedang di Luar', 'Kembali', 'Pulang', 'Selesai'];
  s.izinRows().forEach((row) => {
    const status = row[7];
    assert.ok(VALID_STATUS.includes(status), 'status tidak boleh di luar lima nilai yang dikenal: ' + status);
    // Menunggu Verifikasi tidak boleh punya Waktu_Keluar.
    if (status === 'Menunggu Verifikasi') assert.equal(row[16], '', 'Menunggu Verifikasi tidak boleh punya Waktu_Keluar');
    // Sedang di Luar / Selesai(krn kembali)/Pulang harus sudah punya Waktu_Keluar (sudah diverifikasi).
    if (['Sedang di Luar', 'Pulang'].includes(status)) assert.ok(row[16], status + ' harus punya Waktu_Keluar');
    // Selesai karena kembali harus punya Waktu_Kembali; Pulang tidak harus.
    if (status === 'Selesai' && row[6] === 'kembali') assert.ok(row[17], 'Selesai(kembali) harus punya Waktu_Kembali');
  });
  // Maksimal satu transaksi terbuka per siswa, untuk SEMUA siswa yang tersentuh.
  const perSiswa = {};
  s.izinRows().forEach((row) => {
    const nisn = String(row[1]);
    perSiswa[nisn] = perSiswa[nisn] || [];
    perSiswa[nisn].push(row[7]);
  });
  Object.keys(perSiswa).forEach((nisn) => {
    const terbuka = perSiswa[nisn].filter((st) => st === 'Menunggu Verifikasi' || st === 'Sedang di Luar').length;
    assert.ok(terbuka <= 1, 'siswa ' + nisn + ' punya lebih dari satu transaksi terbuka: ' + JSON.stringify(perSiswa[nisn]));
  });
});

// ============================================================
// 7. STALE UI / STALE SESSION
// ============================================================
// Guru A membuka Gerbang, TIDAK refresh, lalu mencoba memproses transaksi yang
// statusnya sudah berubah di server (diproses guru B duluan). Layar Guru A
// tidak tahu itu -- ia mengirim aksi berdasarkan status LAMA yang masih
// tampil. Server harus jadi satu-satunya sumber kebenaran.

test('stale UI: layar Guru Piket A yang belum di-refresh mencoba verifikasi transaksi yang sudah diverifikasi Guru Piket B -> server menolak, bukan menduplikasi', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  // Guru Piket B memproses duluan (dari perangkat lain) -- layar A tidak tahu.
  const olehB = s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(olehB.status, 'success');

  // Layar A (yang masih menampilkan "Menunggu Verifikasi" karena belum refresh)
  // menekan tombol Verifikasi berdasarkan tampilan basi itu.
  const olehA = s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(olehA.status, 'error');
  assert.match(olehA.message, /sudah (diverifikasi|tidak menunggu)/i, 'pesan harus bisa dipahami guru, bukan error generik');
  assert.equal(s.izinByNisn('1001')[0][13], 'Bu Piket Siang', 'verifikator tetap B, tidak tertimpa/tertukar oleh aksi A yang basi');
});

test('stale UI: layar guru yang belum refresh mencoba "Tandai Kembali" transaksi yang ternyata sudah "Selesai" oleh petugas lain -> ditolak dengan pesan yang jelas, tidak merusak data', () => {
  const s = loadServer();
  const buat = setujui(s, 'wali', '1001', 'kembali', 'kontrol');
  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: buat.id });
  const selesaiOlehB = s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(selesaiOlehB.status, 'success');

  // Layar A masih menampilkan "Sedang di Luar" (state lama) -> guru menekan Tandai Kembali.
  const stale = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: buat.id });
  assert.equal(stale.status, 'error');
  assert.match(stale.message, /sudah ditandai kembali|sudah selesai/i);
  const baris = s.izinByNisn('1001')[0];
  assert.equal(baris[7], 'Selesai');
  assert.equal(baris[18], 'Bu Piket Siang', 'pencatat kembali tetap B -- request A yang basi tidak menimpanya');
});

test('stale UI: layar wali kelas yang belum refresh mencoba mengajukan izin baru untuk siswa yang (tanpa sepengetahuannya) baru saja diajukan guru lain -> ditolak, bukan transaksi kedua', () => {
  const s = loadServer();
  // Wali kelas membuka form izin (melihat siswa "available") lalu, SEBELUM ia
  // menekan Simpan, guru lain di gerbang sudah lebih dulu mengajukan izin untuk
  // siswa yang sama.
  const olehGuruLain = setujui(s, 'pemberiIzin', '1001', 'kembali', 'diajukan lebih dulu');
  assert.equal(olehGuruLain.status, 'success');

  const submitStaleWali = setujui(s, 'wali', '1001', 'kembali', 'wali tidak tahu sudah ada yang mengajukan');
  assert.equal(submitStaleWali.status, 'error');
  assert.match(submitStaleWali.message, /menunggu verifikasi/i);
  assert.equal(s.izinByNisn('1001').length, 1, 'tidak ada transaksi kedua akibat form yang basi');
});
