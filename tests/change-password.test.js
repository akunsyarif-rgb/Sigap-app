// ===== tests/change-password.test.js =====
// Fitur GANTI PASSWORD (self-service, Profil/Akun -> Keamanan) diuji lewat
// doPost()/doGet() yang SUNGGUHAN (Utils.gs+Auth.gs+Code.gs dijalankan di vm
// dengan layanan Apps Script di-stub) — sama seperti tests/izin-keluar.test.js
// & tests/concurrency-session.test.js. Yang diperiksa adalah ISI RESPONS &
// ISI SHEET (Master_Guru, Audit_Log) serta CacheService, bukan tampilan.
//
// Yang dijaga file ini (lihat juga catatan panjang di Auth.gs/Code.gs):
// - password lama diverifikasi SERVER-SIDE lewat verifyPassword() yang
//   SUDAH ADA (bukan mekanisme hashing baru)
// - identitas akun yang diubah SELALU dari sessionUser.id (server), tidak
//   pernah dari payload — targetId/userId palsu di body tidak berpengaruh
// - kebijakan password baru (panjang minimum, konfirmasi cocok, beda dari
//   password lama)
// - password TIDAK PERNAH tercatat plaintext di Audit Log
// - ganti password mencabut SEMUA sesi user itu (termasuk device/tab lain),
//   TANPA menyentuh sesi user lain sama sekali
// - login dengan password baru berhasil, password lama gagal
// - rate-limit tulis per-sesi (checkWriteRateLimit, sudah ada) berlaku juga
//   di action ini

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

const PASSWORD_A = 'RahasiaGuruA1';
const PASSWORD_B = 'RahasiaGuruB2';

const USER_DEFS = [
  { id: 'G00', name: 'Pak Admin', role: 'admin', waliKelas: '', password: PASSWORD_A },
  { id: 'G02', name: 'Bu Kartina', role: 'guru', waliKelas: 'XI A', password: PASSWORD_A },
  { id: 'G03', name: 'Pak Anwar', role: 'guru', waliKelas: '', password: PASSWORD_B },
  { id: 'S99', name: 'Ketua OSIS', role: 'osis', waliKelas: '', password: PASSWORD_A },
];

function loadServer() {
  const guruRows = USER_DEFS.map((u) => {
    const salt = crypto.randomUUID().replace(/-/g, '');
    const hash = saltedHash(u.password, salt);
    return [u.id, u.name, hash, u.role, '', 'aktif', u.waliKelas, salt];
  });
  const sheets = {
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'], guruRows),
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], []),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], []),
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
  ['Utils.gs', 'Auth.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const doPost = vm.runInContext('doPost', sandbox);
  const doGet = vm.runInContext('doGet', sandbox);

  const rawPost = (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK' }, body)) } }).text);
  const rawGet = (params) => JSON.parse(doGet({ parameter: Object.assign({ token: 'TOKEN-OK' }, params) }).text);
  const login = (teacherId, password) => rawPost({ action: 'login', teacherId: teacherId, password: password });
  const post = (token, body) => rawPost(Object.assign({ sessionToken: token }, body));
  const get = (token, params) => rawGet(Object.assign({ sessionToken: token }, params));

  // .slice() pada BARIS itu sendiri (bukan cuma array luarnya) -- baris di
  // dalam _data dimutasi in-place oleh setValue() sheet tiruan, jadi tanpa
  // clone ini "snapshot sebelum" hanya referensi ke array yang sama dan akan
  // ikut berubah begitu Code.gs menulis, membuat perbandingan before/after
  // selalu terlihat "sama" walau sebenarnya sudah ditulis ulang.
  const guruRow = (id) => {
    const row = sheets.Master_Guru._data.slice(1).find((r) => String(r[0]) === String(id));
    return row ? row.slice() : row;
  };
  const auditRows = () => sheets.Audit_Log._data.slice(1);

  return { sandbox, sheets, cacheStore, rawPost, rawGet, login, post, get, guruRow, auditRows, USER_DEFS };
}

// Auth.gs membandingkan loginAt vs changedAt dengan resolusi milidetik
// (Date.now()) -- di produksi dua request HTTP berbeda (login lalu ganti
// password) SELALU terpisah beberapa milidetik oleh latensi jaringan sendiri,
// jadi tidak pernah benar-benar "tepat sama". Test di sini memanggil doPost()
// langsung tanpa jaringan sama sekali (berurutan dalam satu tick JS), jadi
// dua panggilan bisa saja jatuh di milidetik yang SAMA persis -- tickMs()
// mensimulasikan pemisahan waktu yang di produksi selalu ada secara alami,
// supaya urutan sebab-akibat (login SEBELUM vs SETELAH perubahan password)
// tidak ambigu di test.
function tickMs() {
  const start = Date.now();
  while (Date.now() === start) { /* spin sampai milidetik berikutnya */ }
}

const changePayload = (overrides) => Object.assign({
  action: 'changePassword',
  oldPassword: PASSWORD_A,
  newPassword: 'PasswordBaru9',
  confirmPassword: 'PasswordBaru9',
}, overrides || {});

// ================= HAPPY PATH =================

test('changePassword: berhasil -> hash & salt di Master_Guru berubah, login lama gagal, login baru berhasil', () => {
  const s = loadServer();
  const before = s.guruRow('G02');
  const tokenLama = s.login('G02', PASSWORD_A).sessionToken;

  const res = s.post(tokenLama, changePayload());
  assert.equal(res.status, 'success');
  assert.match(res.message, /login kembali/i);

  const after = s.guruRow('G02');
  assert.notEqual(after[2], before[2], 'hash password harus berubah');
  assert.notEqual(after[7], before[7], 'salt harus ikut diganti (bukan reuse)');

  const loginLama = s.login('G02', PASSWORD_A);
  assert.equal(loginLama.status, 'error');
  assert.match(loginLama.message, /password salah/i);

  const loginBaru = s.login('G02', 'PasswordBaru9');
  assert.equal(loginBaru.status, 'success');
  assert.equal(loginBaru.user.name, 'Bu Kartina');
});

test('changePassword: OSIS (role non-admin/BK) tetap boleh ganti password sendiri -- fitur self-service, bukan gerbang role', () => {
  const s = loadServer();
  const token = s.login('S99', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload());
  assert.equal(res.status, 'success');
  assert.equal(s.login('S99', 'PasswordBaru9').status, 'success');
});

// ================= VALIDASI =================

test('changePassword: password lama salah -> ditolak, sheet tidak berubah, tidak membeberkan detail berlebihan', () => {
  const s = loadServer();
  const before = s.guruRow('G02');
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload({ oldPassword: 'password-ngasal' }));
  assert.equal(res.status, 'error');
  assert.match(res.message, /password saat ini salah/i);
  // Pesan tidak boleh membeberkan detail lain (mis. menyebut akun/ID/nama).
  assert.doesNotMatch(res.message, /G02|Kartina/);
  assert.deepEqual(s.guruRow('G02'), before, 'tidak ada perubahan ke sheet sama sekali');
});

test('changePassword: konfirmasi password baru berbeda -> ditolak, sheet tidak berubah', () => {
  const s = loadServer();
  const before = s.guruRow('G02');
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload({ newPassword: 'PasswordBaru9', confirmPassword: 'PasswordLain8' }));
  assert.equal(res.status, 'error');
  assert.match(res.message, /konfirmasi/i);
  assert.deepEqual(s.guruRow('G02'), before);
});

test('changePassword: password baru terlalu pendek (tidak memenuhi policy) -> ditolak', () => {
  const s = loadServer();
  const before = s.guruRow('G02');
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload({ newPassword: 'ab', confirmPassword: 'ab' }));
  assert.equal(res.status, 'error');
  assert.match(res.message, /minimal/i);
  assert.deepEqual(s.guruRow('G02'), before);
});

test('changePassword: password baru sama dengan password lama -> ditolak', () => {
  const s = loadServer();
  const before = s.guruRow('G02');
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload({ newPassword: PASSWORD_A, confirmPassword: PASSWORD_A }));
  assert.equal(res.status, 'error');
  assert.match(res.message, /tidak boleh sama/i);
  assert.deepEqual(s.guruRow('G02'), before);
});

test('changePassword: field kosong (salah satu/semua) -> ditolak dengan pesan wajib diisi', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res1 = s.post(token, changePayload({ oldPassword: '' }));
  assert.equal(res1.status, 'error');
  const res2 = s.post(token, changePayload({ newPassword: '', confirmPassword: '' }));
  assert.equal(res2.status, 'error');
});

// ================= MANIPULASI / KEAMANAN =================

test('changePassword: user tidak dapat mengganti akun lain -- targetId/userId palsu di payload diabaikan total', () => {
  const s = loadServer();
  const beforeA = s.guruRow('G02'); // Bu Kartina
  const beforeB = s.guruRow('G03'); // Pak Anwar
  const tokenA = s.login('G02', PASSWORD_A).sessionToken;

  // Coba berbagai nama field yang mungkin disangka dibaca server untuk
  // menyasar akun lain -- semuanya harus diabaikan, aksi selalu menyasar
  // akun pemilik sessionToken (G02).
  const res = s.post(tokenA, changePayload({ targetId: 'G03', userId: 'G03', id: 'G03' }));
  assert.equal(res.status, 'success');

  // Akun G03 (Pak Anwar) sama sekali tidak tersentuh.
  assert.deepEqual(s.guruRow('G03'), beforeB);
  assert.equal(s.login('G03', PASSWORD_B).status, 'success', 'password Pak Anwar tidak berubah');

  // Yang berubah cuma akun pemilik token (G02).
  assert.notEqual(s.guruRow('G02')[2], beforeA[2]);
  assert.equal(s.login('G02', 'PasswordBaru9').status, 'success');
});

test('changePassword: token/session palsu -> ditolak seperti aksi lain (Sesi berakhir)', () => {
  const s = loadServer();
  const res = s.post('token-yang-tidak-pernah-ada', changePayload());
  assert.equal(res.status, 'error');
  assert.match(res.message, /sesi berakhir/i);
});

test('changePassword: token API salah -> Unauthorized, tidak sampai menyentuh sesi/sheet sama sekali', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const doPost = vm.runInContext('doPost', s.sandbox);
  const bad = JSON.parse(doPost({
    postData: {
      contents: JSON.stringify({
        token: 'TOKEN-SALAH', sessionToken: token, action: 'changePassword',
        oldPassword: PASSWORD_A, newPassword: 'PasswordBaru9', confirmPassword: 'PasswordBaru9',
      }),
    },
  }).text);
  assert.equal(bad.status, 'error');
  assert.match(bad.message, /unauthorized/i);
  assert.equal(s.login('G02', PASSWORD_A).status, 'success', 'password tidak berubah sama sekali');
});

test('changePassword: request setelah sesi sudah invalid (logout dulu) -> ditolak', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  assert.equal(s.post(token, { action: 'logout' }).status, 'success');
  const res = s.post(token, changePayload());
  assert.equal(res.status, 'error');
  assert.match(res.message, /sesi berakhir/i);
});

test('changePassword: request berulang cepat (brute-force password lama lewat sesi valid) kena rate-limit tulis per-sesi yang sudah ada (30/menit)', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  let lastRes = null;
  // WRITE_RATE_MAX = 30/menit per sesi (Utils.gs) -- semua percobaan di sini
  // sengaja pakai oldPassword SALAH supaya tidak ada satu pun yang berhasil
  // mengubah password (fokus murni ke pengujian limiter, bukan alur sukses).
  for (let i = 0; i < 35; i++) {
    lastRes = s.post(token, changePayload({ oldPassword: 'salah-' + i }));
  }
  assert.equal(lastRes.status, 'error');
  assert.match(lastRes.message, /terlalu banyak aksi/i);
});

// ================= INVALIDASI SESI (inti audit) =================

test('changePassword: sesi (token) yang dipakai untuk ganti password sendiri langsung tercabut seketika', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload());
  assert.equal(res.status, 'success');

  const cekLagi = s.post(token, { action: 'record', nisn: '1', name: 'x', class_name: 'y', type: 'z' });
  assert.equal(cekLagi.status, 'error');
  assert.match(cekLagi.message, /sesi berakhir/i);
});

test('changePassword: SEMUA sesi lain milik user yang SAMA (device/tab lain) ikut tercabut, walau dibuat sebelum ganti password', () => {
  const s = loadServer();
  const tabSatu = s.login('G02', PASSWORD_A).sessionToken;
  const tabDua = s.login('G02', PASSWORD_A).sessionToken;
  assert.notEqual(tabSatu, tabDua);
  tickMs(); // pisahkan waktu login dari waktu ganti password (lihat catatan tickMs di atas)

  // Ganti password dari tab satu.
  const res = s.post(tabSatu, changePayload());
  assert.equal(res.status, 'success');

  // Tab dua (device/tab lain, TIDAK terlibat aksi ganti password) juga harus
  // tercabut -- inilah "invalidasi seluruh sesi milik user" yang diminta
  // audit, dicapai lewat penanda per-user (markPasswordChanged), BUKAN
  // dengan mencabut token satu-satu.
  const cekTabDua = s.post(tabDua, { action: 'record', nisn: '1', name: 'x', class_name: 'y', type: 'z' });
  assert.equal(cekTabDua.status, 'error');
  assert.match(cekTabDua.message, /sesi berakhir/i);
});

test('changePassword: TIDAK menyentuh/mencabut sesi milik user LAIN -- bukan solusi global "keluarkan semua orang"', () => {
  const s = loadServer();
  const tokenA = s.login('G02', PASSWORD_A).sessionToken; // Bu Kartina, akan ganti password
  const tokenLain = s.login('G03', PASSWORD_B).sessionToken; // Pak Anwar, tidak terlibat sama sekali
  const tokenAdmin = s.login('G00', PASSWORD_A).sessionToken; // Admin, tidak terlibat sama sekali

  const res = s.post(tokenA, changePayload());
  assert.equal(res.status, 'success');

  // Sesi Pak Anwar & Admin tetap sah sepenuhnya -- BUKAN logout global.
  const cekLain = s.get(tokenLain, { action: 'getPelanggaran' });
  assert.equal(cekLain.status, 'success');
  const cekAdmin = s.get(tokenAdmin, { action: 'getAuditLog' });
  assert.equal(cekAdmin.status, 'success');
});

test('changePassword: sesi user LAIN yang login SETELAH perubahan password tetap valid (penanda tidak mengunci user itu selamanya)', () => {
  const s = loadServer();
  const tokenA = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(tokenA, changePayload());
  assert.equal(res.status, 'success');

  // Login baru milik user lain (G03) SETELAH G02 ganti password harus tetap
  // mulus -- penanda pwdchanged_G02 tidak boleh "bocor" memengaruhi user lain.
  const tokenBaruLain = s.login('G03', PASSWORD_B).sessionToken;
  const cek = s.get(tokenBaruLain, { action: 'getPelanggaran' });
  assert.equal(cek.status, 'success');
});

test('changePassword: user yang sama login ULANG setelah ganti password -> sesi baru itu sendiri tetap valid (penanda tidak mengunci diri sendiri selamanya)', () => {
  const s = loadServer();
  const tokenLama = s.login('G02', PASSWORD_A).sessionToken;
  assert.equal(s.post(tokenLama, changePayload()).status, 'success');

  const loginUlang = s.login('G02', 'PasswordBaru9');
  assert.equal(loginUlang.status, 'success');
  const cek = s.get(loginUlang.sessionToken, { action: 'getPelanggaran' });
  assert.equal(cek.status, 'success', 'sesi BARU (loginAt setelah perubahan password) tidak boleh ikut tercabut');
});

// ================= AUDIT LOG =================

test('changePassword: tercatat di Audit Log TANPA password lama/baru dalam bentuk apa pun', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  const res = s.post(token, changePayload());
  assert.equal(res.status, 'success');

  const rows = s.auditRows();
  const entry = rows.find((r) => r[3] === 'Ganti Password');
  assert.ok(entry, 'harus ada satu baris Audit Log untuk aksi ini');
  assert.equal(entry[1], 'Bu Kartina');
  assert.equal(entry[2], 'G02');
  const detailText = String(entry[4]);
  assert.doesNotMatch(detailText, new RegExp(PASSWORD_A));
  assert.doesNotMatch(detailText, /PasswordBaru9/);
  // Seluruh baris (semua kolom) dipastikan bersih, bukan cuma kolom Detail.
  rows.filter((r) => r[3] === 'Ganti Password').forEach((r) => {
    const line = r.join(' | ');
    assert.doesNotMatch(line, new RegExp(PASSWORD_A));
    assert.doesNotMatch(line, /PasswordBaru9/);
  });
});

test('changePassword: percobaan GAGAL (password lama salah) tidak ikut mencatat password ke Audit Log', () => {
  const s = loadServer();
  const token = s.login('G02', PASSWORD_A).sessionToken;
  s.post(token, changePayload({ oldPassword: 'tebakan-salah-xyz' }));
  const rows = s.auditRows();
  const line = rows.map((r) => r.join(' | ')).join('\n');
  assert.doesNotMatch(line, /tebakan-salah-xyz/);
  assert.doesNotMatch(line, /PasswordBaru9/);
});
