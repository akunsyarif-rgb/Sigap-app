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

function loadAuthContext() {
  // Utilities.computeDigest Apps Script mengembalikan array BYTE BERTANDA
  // (-128..127), bukan 0..255 — makanya bytesToHex() di Utils.gs punya
  // konversi eksplisit `byte < 0 ? byte + 256 : byte`. Stub ini meniru
  // perilaku bertanda itu supaya hasil hash cocok dengan yang akan
  // dihasilkan Apps Script sungguhan, byte demi byte.
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
        getProperty: (key) => (key === 'API_TOKEN' ? 'test-token-123' : null),
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

test('isSameDayServer (Utils.gs): bandingkan tanggal, abaikan jam/menit', () => {
  const ctx = loadAuthContext();
  const isSameDayServer = vm.runInContext('isSameDayServer', ctx);
  const pagi = new Date(2026, 0, 15, 6, 0, 0);
  const malam = new Date(2026, 0, 15, 23, 0, 0);
  const besok = new Date(2026, 0, 16, 6, 0, 0);
  assert.equal(isSameDayServer(pagi, malam), true);
  assert.equal(isSameDayServer(pagi, besok), false);
});
