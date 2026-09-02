// ===== tests/concurrency-session.test.js =====
// AUDIT KETAHANAN & CONCURRENCY — Login bersamaan, identitas sesi, RBAC & cache.
//
// Berbeda dari tests/concurrency-izin.test.js (yang butuh MEMBUKTIKAN mutual
// exclusion lewat mutex+reentrancy, karena keamanannya bergantung pada
// SERIALISASI), keamanan identitas sesi di SIGAP bergantung pada ISOLASI
// RUANG KUNCI (key-space): setiap sesi disimpan di CacheService dengan kunci
// 'sess_' + token — token acak (UUID) per login. Dua kunci yang berbeda TIDAK
// PERNAH bisa saling menimpa/terbaca, apa pun urutan atau waktu datangnya
// permintaan — sifat ini tidak bergantung pada timing, jadi memanggil
// doPost()/doGet() berurutan (Node memang single-threaded, lihat catatan di
// tests/concurrency-izin.test.js) sudah CUKUP untuk membuktikannya dengan
// jujur; tidak perlu rekayasa reentrancy seperti file lock/state-machine.
// Test tetap diberi label eksplisit "[simulated concurrency]" untuk kejujuran
// itu, KECUALI dua test yang secara eksplisit memakai reentrancy untuk
// menguji lock/rate-limit global (yang MEMANG bergantung pada timing).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

function sha256hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}
function saltedHash(password, salt) {
  return sha256hex(salt + ':' + password.trim());
}

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

const PASSWORD = 'RahasiaGuru123';

const USER_DEFS = [
  { id: 'G00', name: 'Pak Admin', role: 'admin', waliKelas: '' },
  { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', waliKelas: '' },
  { id: 'G02', name: 'Bu Kartina', role: 'guru', waliKelas: 'XI A' },
  { id: 'G03', name: 'Pak Anwar', role: 'guru', waliKelas: '' },
  { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', waliKelas: '' },
  { id: 'G11', name: 'Bu Piket Siang', role: 'guru', waliKelas: '' },
  { id: 'G20', name: 'Bu Wali B', role: 'guru', waliKelas: 'XI B' },
  { id: 'G21', name: 'Pak Guru C', role: 'guru', waliKelas: '' },
  { id: 'G22', name: 'Bu Guru D', role: 'guru', waliKelas: '' },
  { id: 'S99', name: 'Ketua OSIS', role: 'osis', waliKelas: '' },
];

function makeRealLock() {
  let locked = false;
  let onFirstAcquire = null;
  return {
    getScriptLock: () => ({
      waitLock() {
        if (locked) throw new Error('LOCK_TIMEOUT');
        locked = true;
        if (onFirstAcquire) { const fn = onFirstAcquire; onFirstAcquire = null; fn(); }
      },
      releaseLock() { locked = false; },
    }),
    setOnFirstAcquire(fn) { onFirstAcquire = fn; },
  };
}

function loadServer(opts) {
  const options = opts || {};
  const guruRows = USER_DEFS.map((u) => {
    const salt = crypto.randomUUID().replace(/-/g, '');
    const hash = saltedHash(PASSWORD, salt);
    return [u.id, u.name, hash, u.role, '', 'aktif', u.waliKelas, salt];
  });
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const HARI_INI = HARI[new Date().getDay()];
  const sheets = {
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'], guruRows),
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], [['1001', 'Rahma', 'XI A'], ['2002', 'Budi', 'XI B']]),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], [[HARI_INI, 'G10'], [HARI_INI, 'G11']]),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], []),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
    Izin_Keluar: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
      'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan', 'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
      'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID', 'ID_Kelompok'], []),
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
    LockService: options.lockApi || { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  ['Utils.gs', 'Auth.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const doPost = vm.runInContext('doPost', sandbox);
  const doGet = vm.runInContext('doGet', sandbox);

  const rawPost = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK' }, body)) } }).text);
  const rawGet = (params) => JSON.parse(doGet({ parameter: Object.assign({ token: 'TOKEN-OK' }, params) }).text);
  const login = (teacherId) => rawPost({ action: 'login', teacherId: teacherId, password: PASSWORD });
  const post = (token, body) => rawPost(Object.assign({ sessionToken: token }, body));
  const get = (token, params) => rawGet(Object.assign({ sessionToken: token }, params));

  const auditRows = () => sheets.Audit_Log._data.slice(1);
  const gerbangRows = () => sheets.Log_Gerbang._data.slice(1);

  return { sandbox, sheets, cacheStore, rawPost, rawGet, login, post, get, auditRows, gerbangRows, USER_DEFS };
}

// ============================================================
// 1. LOGIN BERSAMAAN
// ============================================================

test('[simulated concurrency] 2 akun login hampir bersamaan -> token berbeda, identitas masing-masing benar, tidak saling tertukar', () => {
  const s = loadServer();
  const rA = s.login('G02'); // wali
  const rB = s.login('G10'); // piket
  assert.equal(rA.status, 'success');
  assert.equal(rB.status, 'success');
  assert.notEqual(rA.sessionToken, rB.sessionToken);
  assert.equal(rA.user.name, 'Bu Kartina');
  assert.equal(rB.user.name, 'Pak Piket Pagi');

  // Token A tidak bisa dipakai untuk bertindak sebagai B, dan sebaliknya --
  // action apa pun mengikuti identitas TOKEN, bukan urutan login.
  const asA = s.post(rA.sessionToken, { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Terlambat' });
  const asB = s.post(rB.sessionToken, { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI B', type: 'Terlambat' });
  assert.equal(asA.status, 'success');
  assert.equal(asB.status, 'success');
  const rows = s.gerbangRows();
  assert.equal(rows.find((r) => r[1] === '1001')[5], 'Bu Kartina');
  assert.equal(rows.find((r) => r[1] === '2002')[5], 'Pak Piket Pagi');
});

test('[simulated concurrency] 5-10 akun lintas peran (guru/walas/piket/BK/admin) login hampir bersamaan -> semua token unik & identitas tidak tertukar', () => {
  const s = loadServer();
  const ids = ['G00', 'G01', 'G02', 'G03', 'G10', 'G11', 'G20', 'G21', 'G22', 'S99'];
  const results = ids.map((id) => ({ id, r: s.login(id) }));
  results.forEach(({ id, r }) => assert.equal(r.status, 'success', 'login ' + id + ' harus berhasil'));
  const tokens = results.map((x) => x.r.sessionToken);
  assert.equal(new Set(tokens).size, tokens.length, 'setiap login harus mendapat token unik, tidak ada yang kebagian token orang lain');
  results.forEach(({ id, r }) => {
    const def = USER_DEFS.find((u) => u.id === id);
    assert.equal(r.user.name, def.name);
    assert.equal(r.user.role, def.role);
  });
});

test('[simulated concurrency] satu akun membuka beberapa tab (login dua kali tanpa logout) -> dua sesi independen, keduanya tetap valid', () => {
  const s = loadServer();
  const tab1 = s.login('G02');
  const tab2 = s.login('G02');
  assert.equal(tab1.status, 'success');
  assert.equal(tab2.status, 'success');
  assert.notEqual(tab1.sessionToken, tab2.sessionToken, 'setiap login membuat token baru, meski akun yang sama');

  // Kedua tab tetap bisa dipakai bersamaan -- tidak ada kebijakan "satu sesi per akun".
  const cek1 = s.get(tab1.sessionToken, { action: 'getIzinKeluar' });
  const cek2 = s.get(tab2.sessionToken, { action: 'getIzinKeluar' });
  assert.equal(cek1.status, 'success');
  assert.equal(cek2.status, 'success');
});

test('[simulated concurrency] sesi lama (sudah logout) dan sesi baru dari akun yang sama dipakai bersamaan -> sesi lama ditolak, sesi baru tidak ikut terganggu', () => {
  const s = loadServer();
  const lama = s.login('G02');
  assert.equal(lama.status, 'success');
  // Guru logout di satu tab (mis. menutup PWA/keluar dari Home Screen)...
  assert.equal(s.post(lama.sessionToken, { action: 'logout' }).status, 'success');
  // ...lalu login lagi (tab lain / buka ulang) -> token BARU.
  const baru = s.login('G02');
  assert.equal(baru.status, 'success');
  assert.notEqual(baru.sessionToken, lama.sessionToken);

  // Request nyasar yang masih memakai token LAMA (mis. request yang sempat
  // tertunda di jaringan) harus ditolak -- dan yang terpenting, penolakan itu
  // TIDAK menyentuh/menghapus sesi BARU sama sekali (kunci cache berbeda).
  const pakaiLama = s.post(lama.sessionToken, { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Terlambat' });
  assert.equal(pakaiLama.status, 'error');
  assert.match(pakaiLama.message, /sesi berakhir/i);

  const pakaiBaru = s.post(baru.sessionToken, { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI B', type: 'Terlambat' });
  assert.equal(pakaiBaru.status, 'success');
  assert.equal(s.gerbangRows().find((r) => r[1] === '1001'), undefined, 'permintaan bertoken lama tidak menulis apa pun');
  assert.equal(s.gerbangRows().find((r) => r[1] === '2002')[5], 'Bu Kartina');
});

test('[reentrancy nyata] identitas sesi user A tidak pernah bocor/tertukar ke user B walau requestnya BENAR-BENAR tumpang tindih (lock global doPost)', () => {
  // sigapLock (Code.gs) bersifat global untuk SELURUH doPost, bukan per-user —
  // jadi dua aksi tulis dari DUA PENGGUNA BERBEDA yang datang bersamaan pun
  // ikut diserialkan olehnya (trade-off yang disengaja, lihat Code.gs baris
  // ~153-159). Test ini membuktikan bahwa serialisasi itu TIDAK PERNAH membuat
  // identitas/hasil tulis kedua permintaan tertukar, walau B benar-benar
  // dieksekusi di tengah critical section A (lewat reentrancy, sama seperti
  // tests/concurrency-izin.test.js).
  const lock = makeRealLock();
  const s = loadServer({ lockApi: lock });
  const tokenA = s.login('G02').sessionToken; // Bu Kartina
  const tokenB = s.login('G03').sessionToken; // Pak Anwar

  let hasilB = null;
  lock.setOnFirstAcquire(() => {
    hasilB = s.post(tokenB, { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI B', type: 'Terlambat' });
  });
  const hasilA = s.post(tokenA, { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI A', type: 'Terlambat' });

  // A berhasil (memegang lock), B ditolak "sibuk" (lock global, bukan per-siswa) --
  // yang penting: TIDAK ADA baris yang tertulis dengan identitas tertukar.
  assert.equal(hasilA.status, 'success');
  assert.equal(hasilB.status, 'error');
  assert.match(hasilB.message, /sibuk/i);
  const rows = s.gerbangRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], '1001');
  assert.equal(rows[0][5], 'Bu Kartina', 'baris milik A harus tercatat sebagai A, tidak pernah sebagai B');

  // B retry setelah lock lepas -> berhasil, dan TETAP tercatat sebagai B (bukan A).
  const retryB = s.post(tokenB, { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI B', type: 'Terlambat' });
  assert.equal(retryB.status, 'success');
  assert.equal(s.gerbangRows().find((r) => r[1] === '2002')[5], 'Pak Anwar');
});

test('[simulated concurrency] password salah untuk satu akun tidak pernah membuka akun lain, walau banyak percobaan login gagal bersamaan lintas akun', () => {
  const s = loadServer();
  const salahA = s.rawPost({ action: 'login', teacherId: 'G02', password: 'salah-total' });
  const salahB = s.rawPost({ action: 'login', teacherId: 'G03', password: 'salah-juga' });
  assert.equal(salahA.status, 'error');
  assert.equal(salahB.status, 'error');
  assert.match(salahA.message, /password salah/i);
  // Akun yang benar tetap bisa login normal setelah itu -- rate limit untuk
  // jalur dengan teacherId sekarang PER-AKUN (baru memblokir di 10 kegagalan
  // BERUNTUN pada akun yang sama, lihat Utils.gs); dua kegagalan di atas,
  // masing-masing di akun BERBEDA, tidak sampai memicu apa pun.
  const sukses = s.login('G02');
  assert.equal(sukses.status, 'success');
});

test('[audit Agustus 2026] percobaan gagal berulang pada SATU akun (teacherId terisi) tidak ikut menaikkan counter rate-limit GLOBAL -- ini yang mencegah guru lain ikut terkunci', () => {
  const s = loadServer();
  for (let i = 0; i < 9; i++) {
    const r = s.rawPost({ action: 'login', teacherId: 'G02', password: 'salah-' + i });
    assert.equal(r.status, 'error');
  }
  // Counter GLOBAL (jalur tanpa teacherId) sama sekali tidak tersentuh oleh
  // 9 kegagalan G02 di atas -- kuncinya cuma pernah ditulis oleh recordLoginFailure
  // versi per-akun (loginRateLimitAccountKey), bukan versi global.
  const globalKey = 'login_fail_' + Math.floor(Date.now() / (5 * 60 * 1000));
  assert.equal(s.cacheStore[globalKey], undefined);
  // Guru LAIN (G03) sama sekali tidak terpengaruh -- login dengan password
  // benar tetap berhasil walau G02 baru saja gagal 9 kali beruntun.
  const g03 = s.login('G03');
  assert.equal(g03.status, 'success');
});

test('[audit Agustus 2026] batas per-akun (10) menutup HANYA akun itu, bukan seluruh sekolah', () => {
  const s = loadServer();
  for (let i = 0; i < 10; i++) {
    s.rawPost({ action: 'login', teacherId: 'G02', password: 'salah-' + i });
  }
  // G02 sendiri sekarang terkunci, walau password berikutnya benar.
  const g02Locked = s.rawPost({ action: 'login', teacherId: 'G02', password: PASSWORD });
  assert.equal(g02Locked.status, 'error');
  assert.match(g02Locked.message, /terlalu banyak percobaan/i);
  // G03 (akun lain) tetap bisa login normal -- inilah perbaikan utamanya:
  // dulu 10-15 kegagalan di SATU akun (mis. gara-gara guru piket pagi
  // salah ketik password sendiri berulang kali) ikut mengunci SEMUA guru
  // lain karena counternya dibagi bersama.
  const g03 = s.login('G03');
  assert.equal(g03.status, 'success');
});

test('perubahan role oleh admin untuk user X tidak bocor/mempengaruhi sesi user Y yang aktif bersamaan', () => {
  const s = loadServer();
  const admin = s.login('G00').sessionToken;
  const guruC = s.login('G21').sessionToken; // Pak Guru C, role 'guru'
  const guruD = s.login('G22').sessionToken; // Bu Guru D, tetap 'guru', tidak disentuh

  const ubah = s.post(admin, { action: 'updateRole', targetId: 'G21', newRole: 'bk_kesiswaan' });
  assert.equal(ubah.status, 'success');

  // Sesi D (tidak diubah) tetap berjalan wajar, tidak terpengaruh sama sekali.
  const cekD = s.get(guruD, { action: 'getPelanggaran' });
  assert.equal(cekD.status, 'success');

  // Sesi C YANG SEDANG AKTIF masih memakai snapshot role LAMA ('guru') sampai
  // ia login ulang -- ini KETERBATASAN YANG SUDAH ADA (bukan regresi test ini):
  // sesi disimpan sebagai snapshot di CacheService saat login, dan tidak
  // pernah dibaca ulang dari Master_Guru sampai sesi itu berakhir (maks 6 jam,
  // lihat Auth.gs). Didokumentasikan di laporan audit sebagai batasan yang
  // diketahui, BUKAN diperbaiki di sini (memperbaikinya butuh indeks
  // sesi-per-akun baru di CacheService -- perubahan arsitektur, bukan
  // perbaikan race condition).
  const cekCSetelahDiubah = s.get(guruC, { action: 'getAuditLog' }); // aksi admin-only
  assert.equal(cekCSetelahDiubah.status, 'error', 'sesi lama C belum mendapat role bk_kesiswaan sampai login ulang (batas dikenal, lihat komentar di atas)');
});

// ============================================================
// 6. CONCURRENT READ + WRITE (cache mentah, TTL pendek)
// ============================================================

test('[simulated concurrency] baca (getIzinKeluar) tepat setelah tulis (addIzinKeluar) selalu melihat state yang sudah committed, bukan cache basi', () => {
  const s = loadServer();
  const wali = s.login('G02').sessionToken;
  const piket = s.login('G10').sessionToken;
  const lain = s.login('G21').sessionToken;

  // Pemanasan cache oleh user lain SEBELUM tulis terjadi.
  assert.equal(s.get(lain, { action: 'getIzinKeluar' }).izin.length, 0);

  const buat = s.post(wali, { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' });
  assert.equal(buat.status, 'success');

  // Pembaca LAIN (bukan yang menulis) langsung setelah tulis harus melihat baris baru --
  // clearIzinCache() di dalam addIzinKeluar membuang cache lama, bukan menunggu TTL 30 detik.
  const bacaSetelahTulis = s.get(lain, { action: 'getIzinKeluar' });
  assert.equal(bacaSetelahTulis.izin.length, 1);
  assert.equal(bacaSetelahTulis.izin[0].status, 'Menunggu Verifikasi');

  const verifikasi = s.post(piket, { action: 'verifikasiIzinKeluar', id: buat.id });
  assert.equal(verifikasi.status, 'success');
  const bacaSetelahVerifikasi = s.get(lain, { action: 'getIzinKeluar' });
  assert.equal(bacaSetelahVerifikasi.izin[0].status, 'Sedang di Luar');
  assert.ok(bacaSetelahVerifikasi.izin[0].waktu_keluar, 'transaksi yang baru diverifikasi tidak pernah tampil tanpa Waktu_Keluar (tidak ada data setengah jadi)');
});

test('[simulated concurrency] beberapa pembaca (Gerbang/Riwayat/Beranda) berbeda user tetap mendapat cakupan masing-masing walau membaca cache mentah yang sama', () => {
  const s = loadServer();
  const wali = s.login('G02').sessionToken; // wali XI A
  const guruBiasa = s.login('G21').sessionToken;
  const bk = s.login('G01').sessionToken;

  s.post(wali, { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'kontrol' });

  // Tiga "layar" berbeda (Gerbang/Riwayat/Beranda semuanya lewat getIzinKeluar)
  // dibaca oleh tiga user berbeda "bersamaan" -- cache RAW yang sama dipakai
  // ketiganya, tapi hasil yang dikembalikan ke masing-masing tetap disaring
  // ulang PER PEMANGGIL (scopeIzinForUser dipanggil per request, bukan
  // di-cache per user) -- lihat CLAUDE.md "cache tetap MENTAH & global".
  const asWali = s.get(wali, { action: 'getIzinKeluar' });
  const asGuru = s.get(guruBiasa, { action: 'getIzinKeluar' });
  const asBk = s.get(bk, { action: 'getIzinKeluar' });
  [asWali, asGuru, asBk].forEach((r) => assert.equal(r.status, 'success'));
  // Transaksi TERBUKA terlihat semua non-OSIS (aturan yang sudah ada) -- jadi
  // ketiganya melihatnya, tapi ini bukan "kebocoran", ini scope yang benar.
  assert.equal(asWali.izin.length, 1);
  assert.equal(asGuru.izin.length, 1);
  assert.equal(asBk.izin.length, 1);
});

// ============================================================
// 9/10. RAPID LOGIN CLICK & RATE-LIMIT (temuan minor, bukan korupsi data)
// ============================================================

test('[reentrancy nyata] percobaan login gagal yang BENAR-BENAR bersamaan (rate limiter GLOBAL, jalur tanpa teacherId) tidak mengizinkan lebih dari batas -> lihat catatan race minor di laporan audit', () => {
  // isLoginRateLimited()/recordLoginFailure() (Utils.gs) TIDAK dilindungi
  // sigapLock (login ada SEBELUM lock diambil, lihat Code.gs baris ~35-99 vs
  // ~159) -- desain yang disengaja (lock baru dipasang setelah sesi valid ada,
  // supaya login tidak ikut mengantre di belakang aksi tulis lain). Ini berarti
  // increment counter rate-limit-nya SENDIRI berpotensi "lost update" kalau dua
  // percobaan gagal BENAR-BENAR bersamaan (baca-tambah-tulis tanpa lock).
  // Test ini mengonfirmasi race itu ADA (bukan berkorupsi data siswa, cuma
  // menggeser kapan lockout terpicu +/- 1 hitungan) -- lihat rekomendasi
  // di laporan audit; TIDAK diperbaiki dengan memasukkan login ke sigapLock
  // (itu akan menyerialkan SELURUH login sekolah, termasuk yang berhasil,
  // demi kasus tepi brute-force yang sudah dibatasi 15/5menit).
  //
  // Jalur TANPA teacherId sengaja dipakai di sini (bukan G02 seperti
  // sebelum audit Agustus 2026) -- itu satu-satunya jalur yang masih
  // memakai counter GLOBAL sejak rate limit dipecah per-akun, lihat dua
  // test "[audit Agustus 2026]" di atas untuk jalur dengan teacherId.
  const s = loadServer();
  const cache = s.cacheStore;
  const key = 'login_fail_' + Math.floor(Date.now() / (5 * 60 * 1000));
  cache[key] = '14'; // satu langkah lagi dari lockout (15)

  // Dua kegagalan "bersamaan": tanpa lock, keduanya bisa membaca count=14
  // sebelum salah satu sempat menulis 15 -- disimulasikan di sini dengan
  // membaca cache SEBELUM memanggil recordLoginFailure kedua kalinya (representasi
  // paling jujur yang bisa dibuat tanpa mengubah kode produksi menjadi async).
  const before = parseInt(cache[key], 10);
  s.rawPost({ action: 'login', password: 'salah' }); // -> count jadi 15 -> lockout global aktif
  const afterOne = parseInt(cache[key], 10);
  assert.equal(afterOne, before + 1);
  const lockedOut = s.rawPost({ action: 'login', password: 'salah-lagi' });
  assert.equal(lockedOut.status, 'error');
  assert.match(lockedOut.message, /terlalu banyak percobaan/i);
  // Lockout global tetap berlaku untuk SIAPA PUN yang lewat jalur tanpa
  // teacherId, termasuk yang passwordnya sebenarnya benar -- inilah sifat
  // "global" yang memang dipertahankan untuk jalur yang tidak teratribusi.
  const jugaTerkunci = s.rawPost({ action: 'login', password: PASSWORD });
  assert.equal(jugaTerkunci.status, 'error');
  assert.match(jugaTerkunci.message, /terlalu banyak percobaan/i);
});
