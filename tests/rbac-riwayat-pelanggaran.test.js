// ===== tests/rbac-riwayat-pelanggaran.test.js =====
// Cakupan baca Keterlambatan & Pelanggaran, ditegakkan DI SERVER.
//
// Ditulis setelah temuan di Preview PR #36: getLogs mengirim SELURUH
// Log_Gerbang (riwayat seluruh sekolah) ke setiap pemanggil non-OSIS, dan
// browser yang memutuskan apa yang ditampilkan — jadi guru biasa bisa membaca
// riwayat kelas mana pun lewat Inspect/Network. File ini memanggil doGet()
// yang SUNGGUHAN (Utils.gs+Auth.gs+Code.gs di vm, layanan Apps Script di-stub)
// dan memeriksa ISI RESPONS, bukan tampilan — kalau penyaringan pindah lagi
// ke frontend, test ini merah.
//
// Aturan yang dijaga:
// Aturan final:
//   KETERLAMBATAN & SURAT
//     Guru       : hari ini = SEKOLAH; riwayat = MILIK SENDIRI HARI INI saja
//                  (jadi tidak ada riwayat hari sebelumnya sama sekali —
//                  "OWN-hari-ini" seluruhnya tercakup klausa hari ini)
//     Wali kelas : hari ini = SEKOLAH; riwayat = KELASNYA (tanggal berapa pun)
//                  + MILIK SENDIRI HARI INI. Catatan lintas kelas yang ia buat
//                  KEMARIN tidak boleh ikut hanya karena ia yang mencatat.
//     BK/Admin   : seluruh sekolah
//     OSIS       : ditolak
//   PELANGGARAN (sengaja BERBEDA, tidak diubah)
//     Guru       : MILIK SENDIRI, tanpa batas tanggal
//     Wali kelas : KELASNYA + MILIK SENDIRI, tanpa batas tanggal
//     BK/Admin   : seluruh sekolah / OSIS ditolak

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

function makeSheet(header, rows) {
  const data = [header.slice()].concat(rows.map((r) => r.slice()));
  return {
    appended: [],
    getLastRow: () => data.length,
    getLastColumn: () => header.length,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange: (row, col, numRows, numCols) => ({
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
      setValue: () => {}, setValues: () => {}, clearContent: () => {},
    }),
    appendRow(row) { data.push(row.slice()); this.appended.push(row.slice()); },
  };
}

// ⚠️ Waktu fixture TIDAK boleh dihitung sebagai "sekian menit yang lalu".
// Versi pertama file ini memakai `now - 90 menit` untuk baris "hari ini", dan
// itu jatuh ke HARI KEMARIN setiap kali suite dijalankan antara 00:00 dan
// 01:30 waktu runner — persis yang terjadi saat CI jalan pukul 01:29 UTC
// setelah merge: 2 test merah tanpa ada satu baris kode produksi pun berubah.
// (Jebakan yang sama pernah dibereskan di tests/rekap-upacara.test.js.)
//
// Sekarang baris "hari ini" ditempatkan pada pecahan waktu yang sudah berlalu
// SEJAK TENGAH MALAM lokal, jadi selalu jatuh di hari yang sama berapa pun jam
// suite dijalankan — termasuk pukul 00:00:01 — dan urutannya tetap menaik
// (getRowsSince mengandalkan itu).
const now = new Date();
const TENGAH_MALAM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
const SEJAK_TENGAH_MALAM = Math.max(1, now.getTime() - TENGAH_MALAM);
const SLOT_HARI_INI = 6;
// slot 1..5 -> menaik, selalu di antara tengah malam dan sekarang.
const hariIni = (slot) => new Date(TENGAH_MALAM + Math.floor((SEJAK_TENGAH_MALAM * slot) / SLOT_HARI_INI));
const kemarin = (hariLalu) => new Date(now.getTime() - hariLalu * 24 * 3600 * 1000);

// Log_Gerbang: [Timestamp, NISN, Nama, Kelas, Alasan, Dicatat_Oleh] (urut menaik)
const LATE_ROWS = [
  [kemarin(20), '1001', 'Rahma', 'XI A', 'Kesiangan', 'Bu Kartina'],   // lama, XI A, ditulis wali XI A
  [kemarin(15), '2002', 'Budi', 'XI B', 'Hujan', 'Pak Anwar'],         // lama, XI B, ditulis guru biasa
  [kemarin(10), '2002', 'Budi', 'XI B', 'Macet', 'Bu Kartina'],        // lama, XI B, ditulis wali XI A (miliknya)
  [kemarin(5), '1001', 'Rahma', 'XI A', 'Ban bocor', 'Pak Anwar'],     // lama, XI A, ditulis guru biasa
  [kemarin(3), '3003', 'Citra', 'XII C', 'Kesiangan', 'Bu BK'],        // lama, kelas lain, ditulis BK
  [hariIni(1), '3003', 'Citra', 'XII C', 'Hujan', 'Bu BK'],           // HARI INI, kelas lain
  [hariIni(2), '2002', 'Budi', 'XI B', 'Kesiangan', 'Bu BK'],         // HARI INI, kelas lain
  [hariIni(3), '1001', 'Rahma', 'XI A', 'Macet', 'Pak Anwar'],        // HARI INI, dicatat guru biasa (OWN hari ini)
  [hariIni(4), '3003', 'Citra', 'XII C', 'Hujan', 'Bu Kartina'],      // HARI INI, kelas lain, dicatat wali XI A (OWN hari ini)
];

// Surat_Masuk: [Timestamp, NISN, Nama, Kelas, Jenis, Keterangan, Foto_URL, Dicatat_Oleh]
const SURAT_ROWS = [
  [kemarin(12), '1001', 'Rahma', 'XI A', 'Sakit', 'demam', '', 'Bu BK'],          // lama, kelas wali
  [kemarin(11), '2002', 'Budi', 'XI B', 'Izin', 'acara keluarga', '', 'Pak Anwar'], // lama, kelas lain, milik guru biasa
  [kemarin(4), '2002', 'Budi', 'XI B', 'Sakit', 'flu', '', 'Bu Kartina'],         // lama, kelas lain, milik wali XI A
  [kemarin(2), '3003', 'Citra', 'XII C', 'Izin', 'lomba', '', 'Bu BK'],           // lama, kelas lain
  [hariIni(1), '3003', 'Citra', 'XII C', 'Sakit', 'demam', '', 'Bu BK'],         // HARI INI, kelas lain
  [hariIni(2), '2002', 'Budi', 'XI B', 'Izin', 'ke dokter', '', 'Pak Anwar'],    // HARI INI, milik guru biasa
  [hariIni(3), '1001', 'Rahma', 'XI A', 'Sakit', 'pusing', '', 'Bu Kartina'],    // HARI INI, kelas wali
];

// Pelanggaran: [Timestamp, NISN, Nama, Kelas, Jenis, Sanksi, Catatan, Dicatat_Oleh]
const PELANGGARAN_ROWS = [
  [kemarin(9), '1001', 'Rahma', 'XI A', 'Atribut', 'Teguran', '', 'Bu Kartina'],
  [kemarin(8), '2002', 'Budi', 'XI B', 'Bolos', 'Panggilan Ortu', '', 'Bu BK'],
  [kemarin(7), '3003', 'Citra', 'XII C', 'Terlambat', 'Teguran', '', 'Pak Anwar'],  // guru biasa, kelas lain (miliknya)
  [kemarin(6), '2002', 'Budi', 'XI B', 'Atribut', 'Teguran', '', 'Bu Kartina'],     // wali XI A menulis untuk XI B
  [hariIni(2), '3003', 'Citra', 'XII C', 'Bolos', 'Teguran', '', 'Bu BK'],         // hari ini, kelas lain, milik BK
];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guru: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

function loadServer() {
  const sheets = {
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], LATE_ROWS),
    Surat_Masuk: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'], SURAT_ROWS),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], PELANGGARAN_ROWS),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, getUuid: () => crypto.randomUUID(),
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
        insertSheet: (n) => { sheets[n] = makeSheet(['x'], []); return sheets[n]; },
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
  const doGet = vm.runInContext('doGet', sandbox);
  const call = (params) => JSON.parse(doGet({ parameter: params }).text);
  const as = (who, params) => call(Object.assign({ token: 'TOKEN-OK', sessionToken: tokens[who] }, params));
  return { sandbox, sheets, tokens, call, as, cacheStore };
}

const isHariIni = (ts) => new Date(ts).toDateString() === now.toDateString();
const ringkas = (rows) => rows.map((r) => `${r.name}/${r.class}/${r.logged_by}${isHariIni(r.timestamp) ? '/HARIINI' : ''}`);

// ================= KETERLAMBATAN =================

test('getLogs: admin & BK tetap melihat seluruh sekolah', () => {
  const s = loadServer();
  ['admin', 'bk'].forEach((who) => {
    const res = s.as(who, { action: 'getLogs' });
    assert.equal(res.status, 'success');
    assert.equal(res.logs.length, LATE_ROWS.length, `${who} harus melihat semua baris`);
  });
});

test('getLogs: guru biasa TIDAK punya riwayat hari sebelumnya — termasuk catatannya sendiri', () => {
  const s = loadServer();
  const res = s.as('guru', { action: 'getLogs' });
  assert.equal(res.status, 'success');

  const riwayat = res.logs.filter((l) => !isHariIni(l.timestamp));
  assert.deepEqual(riwayat, [], 'guru biasa tidak boleh menerima satu pun baris hari sebelumnya');
  // Termasuk baris yang DIA SENDIRI catat kemarin untuk siswa kelas lain —
  // inilah yang membedakan OWN-hari-ini dari OWN.
  assert.ok(!ringkas(res.logs).includes('Budi/XI B/Pak Anwar'), 'catatan sendiri dari kemarin tidak boleh ikut');
  assert.ok(!ringkas(res.logs).includes('Rahma/XI A/Pak Anwar'), 'catatan sendiri dari kemarin tidak boleh ikut');
});

test('getLogs: guru biasa tetap melihat catatan MILIKNYA SENDIRI hari ini', () => {
  const s = loadServer();
  const daftar = ringkas(s.as('guru', { action: 'getLogs' }).logs);
  assert.ok(daftar.includes('Rahma/XI A/Pak Anwar/HARIINI'), 'OWN hari ini harus terlihat');
});

test('getLogs: keterlambatan HARI INI tetap seluruh sekolah untuk guru biasa (alur gerbang)', () => {
  const s = loadServer();
  const res = s.as('guru', { action: 'getLogs' });
  const hariIniRows = res.logs.filter((l) => isHariIni(l.timestamp));
  const semuaHariIni = LATE_ROWS.filter((r) => isHariIni(r[0]));
  assert.equal(hariIniRows.length, semuaHariIni.length,
    'guru piket harus melihat SEMUA catatan hari ini supaya tidak mencatat siswa yang sama dua kali');
  assert.ok(hariIniRows.some((l) => l.logged_by === 'Bu BK' && l.class === 'XII C'));
});

test('getLogs: wali kelas = KELASNYA (tanggal berapa pun) + hari ini seluruh sekolah', () => {
  const s = loadServer();
  const daftar = ringkas(s.as('wali', { action: 'getLogs' }).logs);

  assert.ok(daftar.includes('Rahma/XI A/Bu Kartina'), 'riwayat kelas perwalian harus ikut');
  assert.ok(daftar.includes('Rahma/XI A/Pak Anwar'), 'riwayat kelas perwalian walau dicatat guru lain');
  assert.ok(daftar.includes('Citra/XII C/Bu Kartina/HARIINI'), 'catatannya sendiri hari ini untuk kelas lain tetap terlihat');
  assert.ok(daftar.includes('Citra/XII C/Bu BK/HARIINI'), 'hari ini tetap seluruh sekolah');
});

test('getLogs: wali kelas TIDAK menyimpan riwayat kelas lain hanya karena pernah mencatatnya', () => {
  const s = loadServer();
  const daftar = ringkas(s.as('wali', { action: 'getLogs' }).logs);
  // kemarin(10): Budi (XI B) dicatat Bu Kartina sendiri — kelas lain, hari sebelumnya.
  assert.ok(!daftar.includes('Budi/XI B/Bu Kartina'), 'catatan sendiri lintas kelas dari hari sebelumnya harus hilang');
  assert.ok(!daftar.includes('Budi/XI B/Pak Anwar'), 'riwayat kelas lain milik guru lain tetap tertutup');
  assert.ok(!daftar.includes('Citra/XII C/Bu BK'), 'riwayat kelas lain tetap tertutup');
  s.as('wali', { action: 'getLogs' }).logs.filter((l) => !isHariIni(l.timestamp))
    .forEach((l) => assert.ok(l.class === 'XI A', `baris non-hari-ini di luar kelas perwalian bocor: ${JSON.stringify(l)}`));
});

test('getLogs: OSIS ditolak dan tidak menerima baris apa pun', () => {
  const s = loadServer();
  const res = s.as('osis', { action: 'getLogs' });
  assert.equal(res.status, 'error');
  assert.equal(res.logs, undefined);
});

test('getLogs: cache tidak bocor antar pengguna (guru setelah admin tetap dibatasi)', () => {
  const s = loadServer();
  const adminRes = s.as('admin', { action: 'getLogs' });   // mengisi cache lebih dulu
  assert.equal(adminRes.logs.length, LATE_ROWS.length);
  const guruRes = s.as('guru', { action: 'getLogs' });      // membaca cache yang sama
  assert.ok(guruRes.logs.length < adminRes.logs.length, 'guru tidak boleh menerima daftar milik admin dari cache');
  guruRes.logs.filter((l) => !isHariIni(l.timestamp)).forEach((l) => assert.equal(l.logged_by, 'Pak Anwar'));
});

test('getLogs: parameter karangan dari klien tidak bisa memperluas cakupan', () => {
  const s = loadServer();
  const jujur = s.as('guru', { action: 'getLogs' });
  const nakal = s.as('guru', {
    action: 'getLogs', role: 'admin', waliKelas: 'XI A', kelas: 'XI A', classId: 'XI A',
    class: 'XI A', scope: 'school', studentId: '1001', nisn: '1001', recordId: '1',
    logged_by: 'Bu Kartina', name: 'Bu Kartina', id: 'G02',
  });
  assert.deepEqual(ringkas(nakal.logs), ringkas(jujur.logs), 'parameter tambahan tidak boleh mengubah hasil');
});

// ================= SURAT / IZIN =================
// Aturannya SAMA PERSIS dengan keterlambatan (fungsi cakupan yang sama).

test('getSurat: admin & BK seluruh sekolah, lengkap dengan keterangannya', () => {
  const s = loadServer();
  ['admin', 'bk'].forEach((who) => {
    const res = s.as(who, { action: 'getSurat' });
    assert.equal(res.status, 'success');
    assert.equal(res.surat.length, SURAT_ROWS.length, `${who} harus melihat semua surat`);
  });
  const bk = s.as('bk', { action: 'getSurat' });
  assert.ok(bk.surat.some((x) => x.keterangan === 'acara keluarga'), 'BK boleh melihat keterangan lengkap');
});

test('getSurat: guru biasa melihat surat HARI INI seluruh sekolah', () => {
  const s = loadServer();
  const res = s.as('guru', { action: 'getSurat' });
  const hariIniRows = res.surat.filter((x) => isHariIni(x.timestamp));
  assert.equal(hariIniRows.length, SURAT_ROWS.filter((r) => isHariIni(r[0])).length,
    'surat hari ini terbuka untuk semua guru (alur gerbang: cek siapa sudah menyerahkan surat)');
  assert.ok(hariIniRows.some((x) => x.class === 'XII C'), 'termasuk kelas lain');
});

test('getSurat: guru biasa TIDAK melihat surat hari sebelumnya — termasuk miliknya', () => {
  const s = loadServer();
  const res = s.as('guru', { action: 'getSurat' });
  assert.deepEqual(res.surat.filter((x) => !isHariIni(x.timestamp)), [],
    'tidak boleh ada satu pun surat hari sebelumnya');
  assert.ok(!ringkas(res.surat).includes('Budi/XI B/Pak Anwar'), 'surat miliknya sendiri dari kemarin ikut tertutup');
  assert.ok(!JSON.stringify(res.surat).includes('acara keluarga'), 'keterangan surat lama tidak ikut terkirim');
});

test('getSurat: guru biasa tetap melihat surat MILIKNYA SENDIRI hari ini', () => {
  const s = loadServer();
  const daftar = ringkas(s.as('guru', { action: 'getSurat' }).surat);
  assert.ok(daftar.includes('Budi/XI B/Pak Anwar/HARIINI'), 'OWN hari ini harus terlihat');
});

test('getSurat: wali kelas = riwayat KELASNYA + hari ini seluruh sekolah', () => {
  const s = loadServer();
  const daftar = ringkas(s.as('wali', { action: 'getSurat' }).surat);
  assert.ok(daftar.includes('Rahma/XI A/Bu BK'), 'riwayat surat kelas perwalian ikut walau dicatat orang lain');
  assert.ok(daftar.includes('Rahma/XI A/Bu Kartina/HARIINI'));
  assert.ok(daftar.includes('Citra/XII C/Bu BK/HARIINI'), 'hari ini tetap seluruh sekolah');
});

test('getSurat: wali kelas TIDAK menyimpan surat kelas lain hanya karena pernah mencatatnya', () => {
  const s = loadServer();
  const res = s.as('wali', { action: 'getSurat' });
  // kemarin(4): surat Budi (XI B) dicatat Bu Kartina sendiri.
  assert.ok(!ringkas(res.surat).includes('Budi/XI B/Bu Kartina'), 'surat sendiri lintas kelas dari hari sebelumnya harus hilang');
  res.surat.filter((x) => !isHariIni(x.timestamp))
    .forEach((x) => assert.equal(x.class, 'XI A', `surat non-hari-ini di luar kelas perwalian bocor: ${JSON.stringify(x)}`));
});

test('getSurat: OSIS ditolak', () => {
  const s = loadServer();
  const res = s.as('osis', { action: 'getSurat' });
  assert.equal(res.status, 'error');
  assert.equal(res.surat, undefined);
});

test('getSurat: cache tidak bocor antar pengguna', () => {
  const s = loadServer();
  s.as('admin', { action: 'getSurat' });                    // isi cache dengan daftar penuh
  const guru = s.as('guru', { action: 'getSurat' });
  assert.ok(guru.surat.every((x) => isHariIni(x.timestamp)), 'guru tidak boleh menerima daftar penuh dari cache');
  const wali = s.as('wali', { action: 'getSurat' });
  assert.ok(!ringkas(wali.surat).includes('Citra/XII C/Bu BK'), 'wali kelas tidak menerima riwayat kelas lain dari cache');
});

// ================= PELANGGARAN =================

test('getPelanggaran: admin & BK seluruh sekolah', () => {
  const s = loadServer();
  ['admin', 'bk'].forEach((who) => {
    const res = s.as(who, { action: 'getPelanggaran' });
    assert.equal(res.pelanggaran.length, PELANGGARAN_ROWS.length, `${who} harus melihat semua`);
  });
});

test('getPelanggaran: guru biasa HANYA catatan yang ia tulis sendiri', () => {
  const s = loadServer();
  const res = s.as('guru', { action: 'getPelanggaran' });
  assert.ok(res.pelanggaran.length > 0);
  res.pelanggaran.forEach((p) => assert.equal(p.logged_by, 'Pak Anwar', `pelanggaran milik orang lain bocor: ${JSON.stringify(p)}`));
  // Termasuk yang HARI INI milik orang lain — pelanggaran tidak punya
  // pengecualian "hari ini seluruh sekolah" seperti gerbang.
  assert.ok(!res.pelanggaran.some((p) => isHariIni(p.timestamp) && p.logged_by !== 'Pak Anwar'));
});

test('getPelanggaran: wali kelas = kelasnya + catatan sendiri, bukan kelas lain milik orang lain', () => {
  const s = loadServer();
  const res = s.as('wali', { action: 'getPelanggaran' });
  const daftar = ringkas(res.pelanggaran);
  assert.ok(daftar.includes('Rahma/XI A/Bu Kartina'), 'kelas perwalian ikut');
  assert.ok(daftar.includes('Budi/XI B/Bu Kartina'), 'catatan sendiri di kelas lain ikut (CLASS ∪ OWN)');
  assert.ok(!daftar.includes('Budi/XI B/Bu BK'), 'pelanggaran kelas lain milik orang lain TIDAK boleh ikut');
  assert.ok(!daftar.some((d) => d.startsWith('Citra/XII C')), 'kelas lain TIDAK boleh ikut');
});

test('getPelanggaran: OSIS ditolak', () => {
  const s = loadServer();
  const res = s.as('osis', { action: 'getPelanggaran' });
  assert.equal(res.status, 'error');
  assert.equal(res.pelanggaran, undefined);
});

test('getPelanggaran: cache tidak bocor antar pengguna', () => {
  const s = loadServer();
  s.as('bk', { action: 'getPelanggaran' });                    // isi cache dengan daftar penuh
  const guru = s.as('guru', { action: 'getPelanggaran' });
  guru.pelanggaran.forEach((p) => assert.equal(p.logged_by, 'Pak Anwar'));
  const wali = s.as('wali', { action: 'getPelanggaran' });
  assert.ok(!ringkas(wali.pelanggaran).some((d) => d.startsWith('Citra/XII C')));
});

test('Pelanggaran TIDAK ikut aturan OWN-hari-ini (sengaja berbeda dari keterlambatan/surat)', () => {
  const s = loadServer();
  // Guru biasa tetap melihat pelanggaran yang ia catat KEMARIN.
  const guru = s.as('guru', { action: 'getPelanggaran' });
  const lamaMilikGuru = guru.pelanggaran.filter((p) => !isHariIni(p.timestamp));
  assert.ok(lamaMilikGuru.length > 0, 'OWN pelanggaran tanpa batas tanggal harus dipertahankan');
  lamaMilikGuru.forEach((p) => assert.equal(p.logged_by, 'Pak Anwar'));

  // Wali kelas tetap melihat pelanggaran yang ia catat kemarin untuk kelas lain.
  const wali = s.as('wali', { action: 'getPelanggaran' });
  assert.ok(ringkas(wali.pelanggaran).includes('Budi/XI B/Bu Kartina'),
    'CLASS ∪ OWN pelanggaran (tanpa batas tanggal) harus tetap berlaku');

  // Dan fungsi cakupannya memang terpisah dari yang dipakai keterlambatan/surat.
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const blok = utils.split('function scopePelanggaranForUser(')[1].split('\n}')[0];
  assert.match(blok, /ownsRow\(p, sessionUser\)/, 'pelanggaran tetap memakai klausa OWN');
  assert.doesNotMatch(blok, /isSameDayServer/, 'pelanggaran tidak boleh dibatasi per tanggal');
});

// ================= RIWAYAT 1 SISWA (parameter nisn/studentId) =================

test('getStudentLateHistory: guru tidak bisa menarik riwayat siswa lewat NISN', () => {
  const s = loadServer();
  // NISN 1001 (Rahma, XI A): 2 baris hari sebelumnya (Bu Kartina & Pak Anwar)
  // + 1 baris HARI INI (Pak Anwar).
  const guru = s.as('guru', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(guru.status, 'success');
  assert.equal(guru.history.length, 1, 'guru hanya melihat baris hari ini');
  assert.equal(guru.history[0].type, 'Macet');
  assert.ok(guru.history.every((h) => isHariIni(h.timestamp)), 'tidak ada baris hari sebelumnya');
  // Field penyaring tidak ikut terkirim ke klien.
  assert.deepEqual(Object.keys(guru.history[0]).sort(), ['timestamp', 'type']);

  const wali = s.as('wali', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(wali.history.length, 3, 'wali kelas melihat seluruh riwayat siswa kelasnya');

  const bk = s.as('bk', { action: 'getStudentLateHistory', nisn: '3003' });
  assert.equal(bk.history.length, 3, 'BK melihat seluruh sekolah');

  // Siswa kelas lain: guru & wali hanya boleh dapat baris hari ini.
  ['guru', 'wali'].forEach((who) => {
    const res = s.as(who, { action: 'getStudentLateHistory', nisn: '3003' });
    assert.equal(res.history.filter((h) => !isHariIni(h.timestamp)).length, 0,
      `${who} tidak boleh membaca riwayat lama siswa kelas lain`);
  });

  const osis = s.as('osis', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(osis.status, 'error');
});

test('getStudentLateHistory: `count` mengirim JUMLAH saja (peringatan gerbang tetap benar)', () => {
  const s = loadServer();
  // NISN 1001 punya 2 baris (Bu Kartina & Pak Anwar) — guru biasa hanya boleh
  // melihat 1 baris detail, tapi jumlahnya tetap apa adanya supaya peringatan
  // "sudah Nx terlambat" tidak mengecil diam-diam.
  const guru = s.as('guru', { action: 'getStudentLateHistory', nisn: '1001' });
  assert.equal(guru.count, 3, 'jumlah se-sekolah tetap dikirim apa adanya');
  assert.equal(guru.history.length, 1, 'detailnya tetap dibatasi ke hari ini');
  // Yang dikirim benar-benar cuma angka: tidak ada nama pencatat/kelas/alasan
  // milik baris yang tidak boleh dilihat.
  assert.doesNotMatch(JSON.stringify(guru), /Bu Kartina|Ban bocor/);
  assert.equal(typeof guru.count, 'number');
});

test('RecordModal: peringatan memakai jumlah dari server, bukan cuma baris yang terlihat', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbang, /const totalLate = Math\.max\(studentHistory\.length, serverLateCount\)/);
  assert.match(gerbang, /\{totalLate >= 3 && \(/);
  // Prop opsional — tanpa onGetLateCount perilakunya sama seperti sebelumnya.
  assert.match(gerbang, /if \(!onGetLateCount\) return;/);

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /onGetLateCount=\{fetchStudentLateCount\}/);
  const blok = app.split('const fetchStudentLateCount = (nisn) => {')[1].split('};')[0];
  assert.match(blok, /action=getStudentLateHistory/);
  assert.match(blok, /typeof data\.count === 'number'/);
});

// ================= getTodayData (paket hari ini + potongan riwayat) =================

test('getTodayData: bagian hari ini tetap sekolah, lateForBanner & pelanggaran ikut dibatasi', () => {
  const s = loadServer();
  const guru = s.as('guru', { action: 'getTodayData' });
  assert.equal(guru.status, 'success');
  assert.equal(guru.todayLate.length, LATE_ROWS.filter((r) => isHariIni(r[0])).length, 'hari ini tetap seluruh sekolah');
  guru.lateForBanner.filter((l) => !isHariIni(l.timestamp)).forEach((l) => {
    assert.equal(l.logged_by, 'Pak Anwar', 'riwayat banner milik orang lain bocor');
  });
  guru.todayPelanggaran.forEach((p) => assert.equal(p.logged_by, 'Pak Anwar'));

  // Dipanggil lagi setelah cache terisi oleh admin: tetap dibatasi.
  s.as('admin', { action: 'getTodayData' });
  const guruLagi = s.as('guru', { action: 'getTodayData' });
  guruLagi.lateForBanner.filter((l) => !isHariIni(l.timestamp)).forEach((l) => assert.equal(l.logged_by, 'Pak Anwar'));
});

// ================= MANIPULASI PARAMETER =================

test('Security: manipulasi studentId/classId/recordId/tanggal/scope tidak memperluas akses', () => {
  const s = loadServer();
  const nakal = {
    studentId: '2002', nisn: '2002', classId: 'XI B', class: 'XI B', kelas: 'XI B',
    recordId: '3', id: '3', rowIndex: '3', row: '3',
    scope: 'school', all: 'true', full: '1',
    tanggal: '2020-01-01', start: '2020-01-01', end: '2030-12-31', date: '2020-01-01',
    role: 'admin', waliKelas: 'XI B', logged_by: 'Bu BK', requester: 'Bu BK', owner: 'Bu BK',
  };

  ['getLogs', 'getSurat'].forEach((action) => {
    const jujur = s.as('guru', { action });
    const dicurangi = s.as('guru', Object.assign({ action }, nakal));
    const kunci = action === 'getLogs' ? 'logs' : 'surat';
    assert.deepEqual(ringkas(dicurangi[kunci]), ringkas(jujur[kunci]), `${action}: parameter karangan mengubah hasil`);
    assert.ok(dicurangi[kunci].every((r) => isHariIni(r.timestamp)), `${action}: cakupan guru tetap hari ini saja`);
  });

  // Wali kelas tidak bisa berpindah kelas lewat parameter.
  const waliJujur = s.as('wali', { action: 'getLogs' });
  const waliNakal = s.as('wali', Object.assign({ action: 'getLogs' }, nakal));
  assert.deepEqual(ringkas(waliNakal.logs), ringkas(waliJujur.logs));
  waliNakal.logs.filter((l) => !isHariIni(l.timestamp)).forEach((l) => assert.equal(l.class, 'XI A'));

  // studentId pada endpoint yang memang menerimanya tetap dibatasi cakupan.
  const detail = s.as('guru', { action: 'getStudentLateHistory', nisn: '2002', classId: 'XI B', scope: 'school' });
  assert.ok(detail.history.every((h) => isHariIni(h.timestamp)), 'riwayat lama siswa lain tidak boleh terbuka lewat NISN');

  // Tidak ada endpoint GET yang menyerahkan satu baris berdasarkan recordId.
  const acak = s.as('guru', { action: 'getRecord', recordId: '3', id: '3' });
  assert.notEqual(acak.status, 'success');
});

// ================= PENEGAKAN DI SERVER, BUKAN DI BROWSER =================

test('Code.gs: penyaringan cakupan terjadi di server & cache tetap disimpan mentah', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const blok = code.split("if (action === 'getLogs')")[1].split("if (action === 'getTeachers')")[0];
  assert.match(blok, /scopeDailyRecordsForUser\(logsRaw, sessionUser\)/, 'getLogs wajib menyaring per pengguna');
  assert.match(blok, /cache\.put\('today_logs', JSON\.stringify\(logsRaw\), 60\)/, 'yang di-cache harus daftar mentah');
  assert.doesNotMatch(blok, /cache\.put\('today_logs', result/, 'jangan cache hasil yang sudah difilter per orang');

  const pelBlok = code.split("if (action === 'getPelanggaran')")[1].split("if (action === 'getPelanggaranCountForStudent')")[0];
  assert.match(pelBlok, /scopePelanggaranForUser\(pelanggaran, sessionUser\)/);

  const suratBlok = code.split("if (action === 'getSurat')")[1].split("if (action === 'getPelanggaran')")[0];
  assert.match(suratBlok, /scopeDailyRecordsForUser\(suratRaw, sessionUser\)/, 'getSurat wajib menyaring per pengguna');
  assert.match(suratBlok, /cache\.put\('surat_list', JSON\.stringify\(suratRaw\), 60\)/, 'cache surat harus mentah');
  assert.doesNotMatch(suratBlok, /cache\.put\('surat_list', result/, 'jangan cache hasil yang sudah difilter');
});

test('Utils.gs: OWN tetap memakai mekanisme nama pencatat yang sudah ada', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  const blok = utils.split('function ownsRow(')[1].split('\n}')[0];
  assert.match(blok, /row && row\)?\.?logged_by|logged_by/, 'kepemilikan dibaca dari kolom Dicatat_Oleh');
  assert.match(blok, /sessionUser && sessionUser\.name/, 'dibandingkan dengan nama pemilik sesi, mekanisme yang sudah ada');
  // Nama kosong tidak pernah "memiliki" baris apa pun.
  const s = loadServer();
  const ownsRow = vm.runInContext('ownsRow', s.sandbox);
  assert.equal(ownsRow({ logged_by: '' }, { name: '' }), false);
  assert.equal(ownsRow({ logged_by: 'Bu Kartina' }, { name: 'Bu Kartina' }), true);
  assert.equal(ownsRow({ logged_by: 'Bu Kartina' }, { name: 'Pak Anwar' }), false);
});

test('Status ping: memuat penanda versi backend, tetap digembok API_TOKEN', () => {
  const s = loadServer();
  const ping = s.call({ token: 'TOKEN-OK' });
  assert.equal(ping.status, 'active');
  assert.equal(typeof ping.version, 'string');
  assert.ok(ping.version.length > 0, 'versi harus terisi supaya deploy bisa diverifikasi');
  assert.ok(ping.features.includes('scopedLogs'), 'penanda menyebut perbaikan cakupan ini');

  // Tanpa token API tetap ditolak — penanda tidak boleh jadi endpoint terbuka.
  const tanpaToken = s.call({});
  assert.equal(tanpaToken.status, 'error');
  assert.match(tanpaToken.message, /Unauthorized/);
  assert.equal(tanpaToken.version, undefined);

  // Penanda tidak boleh membocorkan apa pun selain label versi & daftar fitur.
  assert.deepEqual(Object.keys(ping).sort(), ['features', 'message', 'status', 'version']);
});

// ================= EXPORT TIDAK IKUT BERUBAH =================

test('Export tetap bekerja seperti sebelumnya setelah pembatasan cakupan ini', () => {
  const s = loadServer();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const params = { action: 'exportData', jenis: 'keterlambatan', start: iso(start), end: iso(now), format: 'pdf' };

  const wali = s.as('wali', params);
  assert.equal(wali.status, 'success');
  assert.equal(wali.report.scopeLabel, 'XI A');
  assert.ok(!JSON.stringify(wali.report.rows).includes('XI B'), 'export wali kelas tetap kelasnya sendiri');

  const guru = s.as('guru', params);
  assert.equal(guru.status, 'error', 'guru biasa tetap tidak punya akses export');

  const admin = s.as('admin', params);
  assert.equal(admin.status, 'success');
  assert.ok(admin.report.total >= 5, 'admin tetap mengekspor seluruh sekolah');
});
