// ===== tests/change-password.test.js =====
// Ganti password sendiri (action 'changeMyPassword', Code.gs) — dipakai
// SEMUA role yang sudah login (guru/BK/OSIS/admin), beda dari 'updatePassword'
// yang admin-only dan menimpa password guru LAIN tanpa perlu tahu password
// lamanya. Sebelum fitur ini ada, guru biasa tidak punya cara mengganti
// password sendiri selain minta admin reset lewat Kelola > Guru & Akun.
//
// Sama seperti tests/hapus-data.test.js & tests/izin-keluar.test.js, file ini
// memuat Utils.gs/Auth.gs/Code.gs SUNGGUHAN lewat vm.runInContext dengan
// layanan Apps Script di-stub, lalu memanggil doPost() persis seperti Web App
// memanggilnya.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// Meniru hashPasswordSalted (Utils.gs): sha256(salt + ':' + password), hex —
// dipakai untuk menyiapkan fixture Master_Guru dengan hash yang BENAR-BENAR
// cocok dengan apa yang akan dihitung ulang oleh verifyPassword sungguhan.
function saltedHash(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}
// Meniru hashPasswordLegacy (Utils.gs): sha256(lowercase+trim), tanpa salt —
// dipakai untuk memastikan akun format lama pun bisa ganti password sendiri.
function legacyHash(password) {
  return crypto.createHash('sha256').update(password.toLowerCase().trim()).digest('hex');
}

function makeSheet(header, rows) {
  const data = [header.slice()].concat((rows || []).map((r) => r.slice()));
  return {
    _data: data,
    getLastRow: () => data.length,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange(row, col, numRows, numCols) {
      return {
        getValues: () => {
          const out = [];
          for (let r = row; r < row + (numRows || 1); r++) {
            const src = data[r - 1] || [];
            const line = [];
            for (let c = col; c < col + (numCols || 1); c++) line.push(src[c - 1] === undefined ? '' : src[c - 1]);
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
      };
    },
    appendRow(row) { data.push(row.slice()); },
    getMaxRows: () => Math.max(data.length, 1000),
    insertRowsAfter(after, howMany) { for (let i = 0; i < howMany; i++) data.push([]); },
  };
}

// Master_Guru: id, name, hash, role, jabatan, status, kelasWali, salt.
function buildSheets() {
  return {
    Master_Guru: makeSheet(
      ['ID', 'Nama', 'Password', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      [
        ['G03', 'Pak Anwar', saltedHash('Sigap123', 'saltAnwar'), 'guru', '', '', '', 'saltAnwar'],
        ['G02', 'Bu Kartina', legacyHash('Sigap123'), 'guru', '', '', 'XI A', ''],
        ['G00', 'Pak Admin', saltedHash('AdminPass1', 'saltAdmin'), 'admin', '', '', '', 'saltAdmin'],
      ]
    ),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
}

const USERS = {
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
};

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
  ['Utils.gs', 'Auth.gs', 'Notifikasi.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const tokens = {};
  Object.keys(USERS).forEach((k) => { tokens[k] = vm.runInContext('createSession', sandbox)(USERS[k]); });
  const doPost = vm.runInContext('doPost', sandbox);

  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, body)) },
  }).text);

  // Sama seperti post(), tapi menerima TOKEN literal alih-alih key 'who' --
  // dibutuhkan untuk menguji sesi "device/tab lain" yang tokennya sengaja
  // dibuat manual lewat createSession() langsung, bukan lewat tokens[] di atas.
  const postWithToken = (tok, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: tok }, body)) },
  }).text);

  const login = (teacherId, password) => post('__login__', { action: 'login', teacherId, password });

  const changePassword = (who, { oldPassword, newPassword }) => post(who, { action: 'changeMyPassword', oldPassword, newPassword });

  return { sandbox, sheets, tokens, post, postWithToken, login, changePassword, audit: () => sheets.Audit_Log._data.slice(1) };
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

test('Ganti Password: password lama benar & baru valid -> berhasil, hash+salt baru tersimpan', () => {
  const s = loadServer();
  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.equal(res.status, 'success');

  const row = s.sheets.Master_Guru._data[1]; // baris G03
  const newSalt = row[7];
  assert.notEqual(newSalt, 'saltAnwar', 'salt harus diganti, bukan dipakai ulang');
  assert.equal(row[2], saltedHash('PasswordBaru1', newSalt), 'hash baru harus cocok dengan salt barunya sendiri');
});

test('Ganti Password: password lama salah -> ditolak, tidak ada yang berubah', () => {
  const s = loadServer();
  const before = s.sheets.Master_Guru._data[1].slice();
  const res = s.changePassword('guru', { oldPassword: 'SALAH', newPassword: 'PasswordBaru1' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /password lama/i);
  assert.deepEqual(s.sheets.Master_Guru._data[1], before);
});

test('Ganti Password: password baru kosong atau kurang dari 6 karakter ditolak', () => {
  const s = loadServer();
  assert.equal(s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: '' }).status, 'error');
  assert.equal(s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: '12345' }).status, 'error');
  // Tidak ada perubahan apa pun akibat percobaan yang ditolak di atas.
  assert.equal(s.sheets.Master_Guru._data[1][7], 'saltAnwar');
});

test('Ganti Password: akun format lama (belum ada salt) tetap bisa ganti password sendiri, langsung termigrasi', () => {
  const s = loadServer();
  const res = s.changePassword('wali', { oldPassword: 'Sigap123', newPassword: 'PasswordBaruWali1' });
  assert.equal(res.status, 'success');
  const row = s.sheets.Master_Guru._data[2]; // baris G02
  assert.notEqual(row[7], '', 'akun lama tanpa salt sekarang harus punya salt baru');
  assert.equal(row[2], saltedHash('PasswordBaruWali1', row[7]));
});

test('Ganti Password: hanya mengubah baris akun sendiri, akun lain tidak tersentuh', () => {
  const s = loadServer();
  const adminBefore = s.sheets.Master_Guru._data[3].slice();
  s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.deepEqual(s.sheets.Master_Guru._data[3], adminBefore, 'baris admin tidak boleh ikut berubah');

  // Password lama guru TIDAK bisa dipakai untuk ganti password admin (beda akun,
  // beda sesi) -- dicoba lewat sesi admin sendiri supaya jelas gagal karena
  // password lama admin memang berbeda, bukan karena salah sesi.
  const wrongOld = s.changePassword('admin', { oldPassword: 'Sigap123', newPassword: 'AdminBaru1' });
  assert.equal(wrongOld.status, 'error');
});

test('Ganti Password: setelah berhasil, password lama tidak lagi berlaku dan password baru berlaku', () => {
  const s = loadServer();
  const first = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.equal(first.status, 'success');

  // Sesi yang dipakai untuk ganti password ini SENDIRI ikut tercabut
  // seketika (lihat "sesi lain ikut tercabut" di bawah) -- guru harus login
  // ulang dengan password BARU sebelum bisa memanggil aksi apa pun lagi,
  // termasuk mencoba ganti password lagi. tokens.guru diperbarui di sini
  // supaya s.changePassword('guru', ...) berikutnya otomatis memakai sesi
  // yang baru, bukan token lama yang sudah mati.
  const relogin = s.login('G03', 'PasswordBaru1');
  assert.equal(relogin.status, 'success', 'password baru harus bisa dipakai login ulang setelah sesi lama tercabut');
  s.tokens.guru = relogin.sessionToken;

  const reuseOld = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru2' });
  assert.equal(reuseOld.status, 'error', 'password lama yang sudah diganti tidak boleh diterima lagi');

  const useNew = s.changePassword('guru', { oldPassword: 'PasswordBaru1', newPassword: 'PasswordBaru2' });
  assert.equal(useNew.status, 'success', 'password baru dari langkah sebelumnya sekarang harus diterima');
});

// ================= PENGAMAN BARU: password baru != password lama =================

test('Ganti Password: password baru sama dengan password lama ditolak, tidak ada yang berubah', () => {
  const s = loadServer();
  const before = s.sheets.Master_Guru._data[1].slice(); // baris G03 (guru, skema salted)
  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'Sigap123' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /tidak boleh sama/i);
  assert.deepEqual(s.sheets.Master_Guru._data[1], before, 'tidak boleh ada perubahan sama sekali saat ditolak');
});

test('Ganti Password: password baru dianggap "sama" walau beda besar/kecil huruf untuk akun skema legacy (case-insensitive)', () => {
  const s = loadServer();
  // Baris G02 (wali) memakai legacyHash -- skema lama membandingkan password
  // yang sudah di-lowercase, jadi "Sigap123" dan "sigap123" adalah password
  // yang SAMA di skema itu. Perbandingan lewat verifyPassword() (bukan
  // String equality literal) harus ikut menangkap ini, bukan cuma menolak
  // kecocokan string persis.
  const res = s.changePassword('wali', { oldPassword: 'Sigap123', newPassword: 'sigap123' });
  assert.equal(res.status, 'error');
  assert.match(res.message, /tidak boleh sama/i);
});

test('Ganti Password: password baru yang BEDA dari lama tetap diterima seperti biasa (bukan regresi jadi selalu ditolak)', () => {
  const s = loadServer();
  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaruBeda1' });
  assert.equal(res.status, 'success');
});

// ================= PENGAMAN BARU: sesi lain (device/tab lain) ikut tercabut =================

test('Ganti Password: SEMUA sesi lain milik user yang SAMA (device/tab lain) ikut tercabut, termasuk sesi yang dipakai ganti password itu sendiri', () => {
  const s = loadServer();
  // Simulasikan DUA device/tab yang sudah login duluan sebagai akun yang
  // sama (G03), sebelum salah satunya dipakai mengganti password.
  const tabSatu = s.tokens.guru;
  const tabDua = vm.runInContext('createSession', s.sandbox)(USERS.guru);
  assert.notEqual(tabSatu, tabDua);
  tickMs(); // pisahkan waktu login dari waktu ganti password (lihat catatan tickMs di atas)

  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.equal(res.status, 'success');

  // Tab dua (device/tab lain, TIDAK terlibat aksi ganti password) harus
  // tercabut -- ini "invalidasi seluruh sesi milik user" yang diminta,
  // dicapai lewat penanda per-user (markPasswordChanged), BUKAN dengan
  // mencabut token satu-satu (memang tidak ada indeks untuk itu).
  const cekTabDua = s.postWithToken(tabDua, { action: 'changeMyPassword', oldPassword: 'PasswordBaru1', newPassword: 'PasswordLain1' });
  assert.equal(cekTabDua.status, 'error');
  assert.match(cekTabDua.message, /sesi berakhir/i);

  // Tab satu (sesi yang DIPAKAI untuk ganti password) juga ikut tercabut
  // seketika -- keputusan produk yang disetujui: bukan cuma "sesi lain",
  // device yang mengganti password sendiri pun harus login ulang.
  const cekTabSatu = s.postWithToken(tabSatu, { action: 'changeMyPassword', oldPassword: 'PasswordBaru1', newPassword: 'PasswordLain1' });
  assert.equal(cekTabSatu.status, 'error');
  assert.match(cekTabSatu.message, /sesi berakhir/i);
});

test('Ganti Password: TIDAK menyentuh/mencabut sesi milik user LAIN -- bukan solusi global "keluarkan semua orang"', () => {
  const s = loadServer();
  const tokenWaliSebelum = s.tokens.wali; // Bu Kartina, tidak terlibat sama sekali
  const tokenAdminSebelum = s.tokens.admin; // Admin, tidak terlibat sama sekali

  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.equal(res.status, 'success');

  // Sesi Bu Kartina & Admin tetap sah sepenuhnya -- dibuktikan lewat aksi
  // yang sama (changeMyPassword) supaya bandingannya adil dengan test di
  // atas: kalau sesi mereka masih hidup, permintaan ini akan lolos gerbang
  // sesi dan gagal karena alasan LAIN (password lama salah), bukan "sesi
  // berakhir".
  const cekWali = s.postWithToken(tokenWaliSebelum, { action: 'changeMyPassword', oldPassword: 'SALAH_SENGAJA', newPassword: 'x' });
  assert.doesNotMatch(cekWali.message || '', /sesi berakhir/i);
  assert.match(cekWali.message || '', /password lama/i);

  const cekAdmin = s.postWithToken(tokenAdminSebelum, { action: 'changeMyPassword', oldPassword: 'SALAH_SENGAJA', newPassword: 'x' });
  assert.doesNotMatch(cekAdmin.message || '', /sesi berakhir/i);
  assert.match(cekAdmin.message || '', /password lama/i);
});

test('Ganti Password: sesi BARU milik user yang sama, dibuat SETELAH ganti password, tetap valid (penanda tidak mengunci user itu selamanya)', () => {
  const s = loadServer();
  const res = s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  assert.equal(res.status, 'success');

  const loginUlang = s.login('G03', 'PasswordBaru1');
  assert.equal(loginUlang.status, 'success');
  // Sesi baru ini (loginAt setelah perubahan password) tidak boleh ikut
  // tercabut -- dibuktikan lewat percobaan ganti password lagi yang harus
  // lolos gerbang sesi (gagal/berhasil tergantung isian, bukan "sesi berakhir").
  const cek = s.postWithToken(loginUlang.sessionToken, { action: 'changeMyPassword', oldPassword: 'PasswordBaru1', newPassword: 'PasswordBaru2' });
  assert.equal(cek.status, 'success', 'sesi BARU (loginAt setelah perubahan password) tidak boleh ikut tercabut');
});

test('Ganti Password: setiap percobaan (berhasil/gagal) tercatat di Audit Log tanpa memuat password', () => {
  const s = loadServer();
  s.changePassword('guru', { oldPassword: 'Sigap123', newPassword: 'PasswordBaru1' });
  const rows = s.audit();
  const last = rows[rows.length - 1];
  assert.equal(last[1], 'Pak Anwar');
  assert.equal(last[3], 'Ganti Password Sendiri');
  assert.doesNotMatch(last[4], /Sigap123|PasswordBaru1/);
});
