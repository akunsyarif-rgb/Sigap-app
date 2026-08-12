// ===== tests/password.test.js =====
// Muat LANGSUNG Utils.gs & Auth.gs yang sungguhan (bukan port/tulis ulang
// logikanya di sini) lewat vm.runInContext, dengan Utilities.computeDigest
// di-stub pakai node:crypto (SHA-256, algoritma sama persis) — supaya test
// ini benar-benar menguji kode yang jalan di Apps Script, dan akan MERAH
// kalau Auth.gs/Utils.gs berubah dengan cara yang mematahkan verifikasi
// password (skenario paling berbahaya kalau sampai lolos tanpa ketahuan:
// guru mendadak tidak bisa login).
// Jalankan: npm test   (atau langsung: node --test tests/*.test.js)
// Tanpa dependency npm apa pun — cuma modul bawaan Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

function loadAuthContext(propsOverride) {
  // Utilities.computeDigest Apps Script mengembalikan array BYTE BERTANDA
  // (-128..127), bukan 0..255 — makanya bytesToHex() di Utils.gs punya
  // konversi eksplisit `byte < 0 ? byte + 256 : byte`. Stub ini meniru
  // perilaku bertanda itu supaya hasil hash cocok dengan yang akan
  // dihasilkan Apps Script sungguhan, byte demi byte.
  // scriptProperties bisa di-override per test (dipakai menguji sakelar
  // ALLOW_LEGACY_LOGIN), dan CacheService distub jadi Map biasa — cukup untuk
  // menguji logika rate limit, yang menarik di situ hitungan & bentuk key-nya,
  // bukan penyimpanannya.
  const props = Object.assign({ API_TOKEN: 'test-token-123' }, propsOverride || {});
  const cacheStore = new Map();
  const sandbox = {
    Utilities: {
      computeDigest: (_algo, str) => {
        const buf = crypto.createHash('sha256').update(str).digest();
        return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cacheStore.has(key) ? cacheStore.get(key) : null),
        put: (key, value) => cacheStore.set(key, value),
        remove: (key) => cacheStore.delete(key),
      }),
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8'), sandbox, { filename: 'Utils.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Auth.gs'), 'utf8'), sandbox, { filename: 'Auth.gs' });
  return sandbox;
}

test('hash password: skema lama tetap tidak peka besar/kecil huruf (kompatibilitas mundur akun lama)', () => {
  const ctx = loadAuthContext();
  const legacyHash = vm.runInContext('hashPasswordLegacy', ctx)('Sigap123');
  assert.equal(vm.runInContext('verifyPassword', ctx)('Sigap123', legacyHash, '').matched, true);
  assert.equal(vm.runInContext('verifyPassword', ctx)('sigap123', legacyHash, '').matched, true);
  assert.equal(vm.runInContext('verifyPassword', ctx)('SALAH', legacyHash, ''), null);
});

test('hash password: match lewat skema lama menandai needsMigration', () => {
  const ctx = loadAuthContext();
  const legacyHash = vm.runInContext('hashPasswordLegacy', ctx)('Sigap123');
  const result = vm.runInContext('verifyPassword', ctx)('Sigap123', legacyHash, '');
  assert.equal(result.needsMigration, true);
});

test('hash password: skema baru (salted) PEKA besar/kecil huruf', () => {
  const ctx = loadAuthContext();
  const hashSalted = vm.runInContext('hashPasswordSalted', ctx);
  const salt = 'testsalt';
  const hash = hashSalted('Sigap123', salt);
  assert.equal(vm.runInContext('verifyPassword', ctx)('Sigap123', hash, salt).matched, true);
  assert.equal(vm.runInContext('verifyPassword', ctx)('sigap123', hash, salt), null);
});

test('hash password: match lewat skema baru TIDAK menandai needsMigration lagi', () => {
  const ctx = loadAuthContext();
  const hashSalted = vm.runInContext('hashPasswordSalted', ctx);
  const salt = 'testsalt';
  const hash = hashSalted('Sigap123', salt);
  assert.equal(vm.runInContext('verifyPassword', ctx)('Sigap123', hash, salt).needsMigration, false);
});

test('hash password: salt beda -> hash beda walau password sama (inti kenapa salt ditambahkan)', () => {
  const ctx = loadAuthContext();
  const hashSalted = vm.runInContext('hashPasswordSalted', ctx);
  assert.notEqual(hashSalted('samapassword', 'saltA'), hashSalted('samapassword', 'saltB'));
});

test('generateSalt: tidak pernah menghasilkan salt kosong atau kebetulan sama 2x berturut-turut', () => {
  const ctx = loadAuthContext();
  const generateSalt = vm.runInContext('generateSalt', ctx);
  const a = generateSalt();
  const b = generateSalt();
  assert.ok(a && a.length > 0);
  assert.notEqual(a, b);
});

test('checkToken: token API yang benar diterima, yang salah/kosong ditolak', () => {
  const ctx = loadAuthContext();
  const checkToken = vm.runInContext('checkToken', ctx);
  assert.equal(checkToken('test-token-123'), true);
  assert.equal(checkToken('token-ngasal'), false);
  assert.equal(!!checkToken(''), false);
  assert.equal(!!checkToken(undefined), false);
});

test('normalizeRole & isAdminRole/isBkRole/isOsisRole: toleran spasi & besar-kecil huruf', () => {
  const ctx = loadAuthContext();
  const isAdminRole = vm.runInContext('isAdminRole', ctx);
  const isBkRole = vm.runInContext('isBkRole', ctx);
  const isOsisRole = vm.runInContext('isOsisRole', ctx);
  assert.equal(isAdminRole(' Admin '), true);
  assert.equal(isAdminRole('ADMIN'), true);
  assert.equal(isAdminRole('guru'), false);
  assert.equal(isBkRole('bk_kesiswaan'), true);
  assert.equal(isBkRole('admin'), true); // admin otomatis punya hak BK juga
  assert.equal(isBkRole('guru'), false);
  assert.equal(isOsisRole('OSIS'), true);
  assert.equal(isOsisRole('admin'), false);
});

test('sameClass (Utils.gs): toleran format berbeda antara catatan lama vs Master_Siswa', () => {
  const ctx = loadAuthContext();
  const sameClass = vm.runInContext('sameClass', ctx);
  assert.equal(sameClass('XI A', 'XI A'), true);
  assert.equal(sameClass('XI A', 'XI.A (KESEHATAN I)'), true);
  assert.equal(sameClass('xi-a', 'XI A'), true);
  assert.equal(sameClass('XI A', 'XI B'), false);
});

// ===== Login Nama + PIN =====

test('validatePin: menerima PIN 4-6 digit yang wajar', () => {
  const ctx = loadAuthContext();
  const validatePin = vm.runInContext('validatePin', ctx);
  assert.equal(validatePin('4271').ok, true);
  assert.equal(validatePin('90218').ok, true);
  assert.equal(validatePin('730154').ok, true);
});

test('validatePin: menolak PIN non-angka, terlalu pendek, atau terlalu panjang', () => {
  const ctx = loadAuthContext();
  const validatePin = vm.runInContext('validatePin', ctx);
  assert.equal(validatePin('sigap123').ok, false);
  assert.equal(validatePin('42a1').ok, false);
  assert.equal(validatePin('421').ok, false);
  assert.equal(validatePin('4271905').ok, false);
  assert.equal(validatePin('').ok, false);
  assert.equal(validatePin(null).ok, false);
  assert.equal(validatePin(undefined).ok, false);
});

test('validatePin: menolak pola paling gampang ditebak (semua sama / berurutan)', () => {
  const ctx = loadAuthContext();
  const validatePin = vm.runInContext('validatePin', ctx);
  assert.equal(validatePin('1111').ok, false);
  assert.equal(validatePin('0000').ok, false);
  assert.equal(validatePin('1234').ok, false);
  assert.equal(validatePin('456789').ok, false);
  assert.equal(validatePin('4321').ok, false);
  // Bukan pola berurutan penuh — harus tetap diterima
  assert.equal(validatePin('1235').ok, true);
});

test('findTeacherRowById: lookup langsung, toleran spasi & besar-kecil huruf', () => {
  const ctx = loadAuthContext();
  const findTeacherRowById = vm.runInContext('findTeacherRowById', ctx);
  const rows = [
    ['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt', 'Login_Mode'],
    ['G01', 'Kartina', 'hash1', 'guru', '', 'aktif', 'XI B', 'salt1', 'pin'],
    ['G02', 'Bahar', 'hash2', 'admin', '', '', '', 'salt2', ''],
  ];
  assert.equal(findTeacherRowById(rows, 'G02').rowIndex, 3); // 1-based, siap dipakai getRange
  assert.equal(findTeacherRowById(rows, ' g02 ').row[1], 'Bahar');
  assert.equal(findTeacherRowById(rows, 'G99'), null);
  assert.equal(findTeacherRowById(rows, ''), null);
  assert.equal(findTeacherRowById(rows, null), null);
});

test('buildSessionUser: TIDAK PERNAH menyertakan hash/salt (objek ini dikirim ke frontend)', () => {
  const ctx = loadAuthContext();
  const buildSessionUser = vm.runInContext('buildSessionUser', ctx);
  const row = ['G01', 'Kartina', 'hash-rahasia', 'guru', 'Wali Kelas', 'aktif', 'XI B', 'salt-rahasia', 'pin'];
  const serialized = JSON.stringify(buildSessionUser(row));
  // Dibandingkan lewat hasil JSON.parse, bukan objek mentah: objek dari
  // sandbox vm punya prototype realm lain, jadi deepEqual strict selalu gagal
  // walau isinya identik. Sekalian ini persis bentuk yang diterima frontend.
  assert.deepEqual(JSON.parse(serialized), { id: 'G01', name: 'Kartina', role: 'guru', jabatan: 'Wali Kelas', waliKelas: 'XI B' });
  assert.equal(serialized.includes('hash-rahasia'), false);
  assert.equal(serialized.includes('salt-rahasia'), false);
});

test('isTeacherRowDisabled: hanya "nonaktif" yang dianggap nonaktif', () => {
  const ctx = loadAuthContext();
  const isTeacherRowDisabled = vm.runInContext('isTeacherRowDisabled', ctx);
  assert.equal(isTeacherRowDisabled(['G01', 'A', '', '', '', ' Nonaktif ']), true);
  assert.equal(isTeacherRowDisabled(['G01', 'A', '', '', '', 'aktif']), false);
  assert.equal(isTeacherRowDisabled(['G01', 'A', '', '', '', '']), false);
});

test('rate limit per akun: mengunci setelah 5 gagal, dan HANYA akun itu', () => {
  const ctx = loadAuthContext();
  const isLimited = vm.runInContext('isAccountLoginRateLimited', ctx);
  const recordFail = vm.runInContext('recordAccountLoginFailure', ctx);
  for (let i = 0; i < 5; i++) recordFail('G01');
  assert.equal(isLimited('G01'), true);
  assert.equal(isLimited('G02'), false); // guru lain tidak ikut terkunci
});

test('rate limit per akun: login berhasil menolkan hitungan gagal sebelumnya', () => {
  const ctx = loadAuthContext();
  const isLimited = vm.runInContext('isAccountLoginRateLimited', ctx);
  const recordFail = vm.runInContext('recordAccountLoginFailure', ctx);
  const clearFail = vm.runInContext('clearAccountLoginFailures', ctx);
  for (let i = 0; i < 4; i++) recordFail('G01');
  clearFail('G01');
  assert.equal(recordFail('G01'), 1); // mulai dari nol lagi, bukan lanjut ke 5
  assert.equal(isLimited('G01'), false);
});

test('rate limit per akun: key tidak peka besar-kecil huruf (G01 dan g01 akun yang sama)', () => {
  const ctx = loadAuthContext();
  const isLimited = vm.runInContext('isAccountLoginRateLimited', ctx);
  const recordFail = vm.runInContext('recordAccountLoginFailure', ctx);
  for (let i = 0; i < 5; i++) recordFail('G01');
  assert.equal(isLimited('g01'), true);
});

test('isLegacyLoginEnabled: default AKTIF, hanya "false" yang mematikan', () => {
  assert.equal(vm.runInContext('isLegacyLoginEnabled', loadAuthContext())(), true);
  assert.equal(vm.runInContext('isLegacyLoginEnabled', loadAuthContext({ ALLOW_LEGACY_LOGIN: 'true' }))(), true);
  assert.equal(vm.runInContext('isLegacyLoginEnabled', loadAuthContext({ ALLOW_LEGACY_LOGIN: 'False' }))(), false);
});

test('PIN yang diverifikasi lewat skema salted: benar diterima, mirip ditolak', () => {
  const ctx = loadAuthContext();
  const hashSalted = vm.runInContext('hashPasswordSalted', ctx);
  const verifyPassword = vm.runInContext('verifyPassword', ctx);
  const salt = 'saltguru';
  const hash = hashSalted('4271', salt);
  assert.equal(verifyPassword('4271', hash, salt).matched, true);
  assert.equal(verifyPassword('4272', hash, salt), null);
  assert.equal(verifyPassword('', hash, salt), null);
});

test('isSameDayServer (Utils.gs): bandingkan tanggal, abaikan jam/menit', () => {
  const ctx = loadAuthContext();
  const isSameDayServer = vm.runInContext('isSameDayServer', ctx);
  const pagi = new Date(2026, 0, 15, 6, 0, 0);
  const malam = new Date(2026, 0, 15, 23, 0, 0);
  const besok = new Date(2026, 0, 16, 6, 0, 0);
  assert.equal(isSameDayServer(pagi, malam), true);
  assert.equal(isSameDayServer(pagi, besok), false);
});
