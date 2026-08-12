// ===== tests/authorization.test.js =====
// Batas keamanan Sprint 2A: sesi membuktikan IDENTITAS, Master_Guru yang
// menentukan HAK AKSES. Test ini memuat Utils.gs & Auth.gs yang sungguhan
// (pola sama seperti password.test.js) dengan SpreadsheetApp distub jadi array
// baris biasa — yang diuji di sini logika otorisasinya, bukan Sheets API-nya.
//
// Kenapa ini penting sampai perlu file test sendiri: sesi SIGAP hidup 6 jam,
// jadi tanpa pembacaan ulang, "nonaktifkan akun" (tindakan yang dipakai admin
// justru saat ada masalah SEKARANG) baru berefek setelah setengah hari kerja.
// Jalankan: npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

// Baris Master_Guru: A=ID, B=Nama, C=hash, D=role, E=jabatan, F=status,
// G=Kelas_Wali, H=salt, I=Login_Mode (lihat GURU_COL di Auth.gs).
function guruRow(id, name, role, status, kelasWali) {
  return [id, name, 'hash', role, '', status || 'aktif', kelasWali || '', 'salt', 'pin'];
}

const HEADER = ['ID', 'Nama', 'Password', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt', 'Login_Mode'];

function loadContext(masterGuruRows) {
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
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

  // Baris sheet disimpan di variabel yang bisa diubah TENGAH test — persis
  // meniru admin yang mengedit Master_Guru saat sesi guru masih hidup.
  const state = { rows: [HEADER].concat(masterGuruRows) };
  const ss = {
    getSheetByName: () => ({ getDataRange: () => ({ getValues: () => state.rows }) }),
  };
  const call = (fnName) => vm.runInContext(fnName, sandbox);
  return { sandbox, state, ss, call };
}

// Bikin sesi sungguhan lewat createSession() (bukan objek karangan), supaya
// yang diuji benar-benar jalur token -> CacheService -> getSessionUser.
function login(ctx, row) {
  return ctx.call('createSession')(ctx.call('buildSessionUser')(row));
}

test('otorisasi: guru aktif + aksi yang boleh -> DIIZINKAN', () => {
  const row = guruRow('G01', 'Kartina', 'guru', 'aktif', 'XI B');
  const ctx = loadContext([row]);
  const token = login(ctx, row);
  const auth = ctx.call('resolveAuthorizedUser')(ctx.ss, token);
  assert.equal(auth.ok, true);
  assert.equal(auth.user.name, 'Kartina');
  assert.equal(ctx.call('isOsisRole')(auth.user.role), false); // lolos gerbang aksi tulis harian
});

test('otorisasi: akun DINONAKTIFKAN saat sesi lama masih hidup -> aksi sensitif DITOLAK', () => {
  const row = guruRow('G01', 'Kartina', 'guru', 'aktif');
  const ctx = loadContext([row]);
  const token = login(ctx, row); // login jam 07.00, sesi masih valid 6 jam
  assert.equal(ctx.call('resolveAuthorizedUser')(ctx.ss, token).ok, true);

  ctx.state.rows[1][5] = 'nonaktif'; // admin menonaktifkan jam 07.05
  const auth = ctx.call('resolveAuthorizedUser')(ctx.ss, token);
  assert.equal(auth.ok, false);
  assert.equal(auth.reason, 'disabled');
  // Sesi lamanya sendiri masih ada di cache — itu justru inti masalahnya:
  // tanpa pembacaan ulang, token ini akan terus diterima sampai 6 jam habis.
  assert.notEqual(ctx.call('getSessionUser')(token), null);
});

test('otorisasi: akun dihapus dari Master_Guru -> DITOLAK dengan alasan sendiri', () => {
  const row = guruRow('G01', 'Kartina', 'guru');
  const ctx = loadContext([row]);
  const token = login(ctx, row);
  ctx.state.rows = [HEADER]; // baris dihapus manual di Sheet
  const auth = ctx.call('resolveAuthorizedUser')(ctx.ss, token);
  assert.equal(auth.ok, false);
  assert.equal(auth.reason, 'gone');
});

test('otorisasi: token kosong/kedaluwarsa -> DITOLAK sebelum menyentuh sheet', () => {
  const ctx = loadContext([guruRow('G01', 'Kartina', 'guru')]);
  assert.equal(ctx.call('resolveAuthorizedUser')(ctx.ss, '').reason, 'session');
  assert.equal(ctx.call('resolveAuthorizedUser')(ctx.ss, 'token-ngasal').reason, 'session');
});

test('otorisasi: guru mencoba aksi admin -> DITOLAK; admin -> DIIZINKAN', () => {
  const guru = guruRow('G01', 'Kartina', 'guru');
  const admin = guruRow('G02', 'Bahar', 'admin');
  const ctx = loadContext([guru, admin]);
  const isAdminRole = ctx.call('isAdminRole');
  assert.equal(isAdminRole(ctx.call('resolveAuthorizedUser')(ctx.ss, login(ctx, guru)).user.role), false);
  assert.equal(isAdminRole(ctx.call('resolveAuthorizedUser')(ctx.ss, login(ctx, admin)).user.role), true);
});

test('otorisasi: BK/Kesiswaan pada aksi yang memang haknya -> DIIZINKAN, tapi bukan aksi admin', () => {
  const bk = guruRow('G03', 'Ratna', 'bk_kesiswaan');
  const ctx = loadContext([bk]);
  const user = ctx.call('resolveAuthorizedUser')(ctx.ss, login(ctx, bk)).user;
  assert.equal(ctx.call('isBkRole')(user.role), true); // mis. getBimbingan, Audit Log
  assert.equal(ctx.call('isAdminRole')(user.role), false); // tapi tetap tidak bisa reset PIN
});

test('otorisasi: role diturunkan admin -> guru, hak admin hilang di request BERIKUTNYA', () => {
  const row = guruRow('G02', 'Bahar', 'admin');
  const ctx = loadContext([row]);
  const token = login(ctx, row); // sesi ini menyimpan snapshot role 'admin'
  const isAdminRole = ctx.call('isAdminRole');
  assert.equal(isAdminRole(ctx.call('resolveAuthorizedUser')(ctx.ss, token).user.role), true);

  ctx.state.rows[1][3] = 'guru'; // admin lain menurunkan rolenya
  assert.equal(isAdminRole(ctx.call('resolveAuthorizedUser')(ctx.ss, token).user.role), false);
  // Sesi lama TETAP mengaku admin — buktinya kenapa role tidak boleh diambil
  // dari sesi. Sengaja diassert supaya kalau suatu saat ada yang "menghemat"
  // pembacaan sheet dan kembali memakai isi sesi, test ini merah.
  assert.equal(ctx.call('getSessionUser')(token).role, 'admin');
});

test('otorisasi: klaim role dari request TIDAK menaikkan hak akses', () => {
  const guru = guruRow('G01', 'Kartina', 'guru');
  const ctx = loadContext([guru]);
  const token = login(ctx, guru);
  // Frontend jahat mengirim { role: 'admin', jabatan: 'Kepala Sekolah' } —
  // resolveAuthorizedUser cuma menerima sessionToken, tidak ada jalan masuk
  // bagi klaim dari body request untuk ikut menentukan hasil.
  const auth = ctx.call('resolveAuthorizedUser')(ctx.ss, token);
  assert.equal(auth.user.role, 'guru');
  assert.equal(ctx.call('isAdminRole')(auth.user.role), false);
});

test('otorisasi: kelas wali diambil dari sheet — dicopot dari wali kelas = akses kelas itu hilang', () => {
  const row = guruRow('G01', 'Kartina', 'guru', 'aktif', 'XI B');
  const ctx = loadContext([row]);
  const token = login(ctx, row);
  const sameClass = ctx.call('sameClass');
  const isBkRole = ctx.call('isBkRole');
  // Bentuk penjagaan yang sama dengan ajukanTindakLanjut/getPelanggaran di
  // Code.gs: BK boleh semua kelas, guru biasa hanya kelas perwaliannya.
  const boleh = (user, kelas) => isBkRole(user.role) || (!!user.waliKelas && sameClass(kelas, user.waliKelas));

  let user = ctx.call('resolveAuthorizedUser')(ctx.ss, token).user;
  assert.equal(boleh(user, 'XI B'), true);
  assert.equal(boleh(user, 'XII A'), false); // kelas lain: tidak pernah boleh

  ctx.state.rows[1][6] = ''; // admin mencopot status wali kelas
  user = ctx.call('resolveAuthorizedUser')(ctx.ss, token).user;
  assert.equal(boleh(user, 'XI B'), false);
});

test('otorisasi: hanya alasan "session" yang memicu logout otomatis di frontend', () => {
  const ctx = loadContext([guruRow('G01', 'Kartina', 'guru')]);
  const authErrorMessage = ctx.call('authErrorMessage');
  // checkSession() di app.js memulangkan pengguna ke layar login begitu pesan
  // mengandung "sesi berakhir". Akun yang DINONAKTIFKAN sengaja TIDAK memakai
  // kalimat itu: memulangkan ke layar login cuma bikin guru mencoba login
  // berulang kali tanpa tahu sebabnya.
  assert.match(authErrorMessage('session'), /sesi berakhir/i);
  assert.doesNotMatch(authErrorMessage('disabled'), /sesi berakhir/i);
  assert.match(authErrorMessage('disabled'), /dinonaktifkan/i);
  assert.doesNotMatch(authErrorMessage('gone'), /sesi berakhir/i);
});

test('otorisasi: objek user hasil pembacaan ulang tetap tanpa hash/salt', () => {
  const ctx = loadContext([guruRow('G01', 'Kartina', 'guru', 'aktif', 'XI B')]);
  const token = login(ctx, guruRow('G01', 'Kartina', 'guru', 'aktif', 'XI B'));
  const serialized = JSON.stringify(ctx.call('resolveAuthorizedUser')(ctx.ss, token).user);
  assert.equal(serialized.includes('hash'), false);
  assert.equal(serialized.includes('salt'), false);
});
