// ===== tests/authorization.test.js =====
// Bukti bahwa RBAC v1 ditegakkan DI SERVER, bukan di UI.
//
// Beda dari test lain di repo ini yang banyak memeriksa teks sumber: di sini
// Code.gs/Auth.gs/Utils.gs yang SUNGGUHAN dijalankan di dalam vm dengan
// SpreadsheetApp/CacheService/ContentService/LockService palsu, lalu doGet()
// dan doPost() benar-benar dipanggil dan PAYLOAD-nya yang diperiksa. Kalau
// suatu saat ada yang memindahkan filter scope ke frontend, test ini merah —
// sementara test yang cuma mencocokkan regex sumber bisa saja tetap hijau.
//
// Yang dibuktikan: baris yang tidak berhak dilihat seorang pengguna TIDAK
// PERNAH ikut terkirim dalam respons, bukan sekadar tidak dirender.
//
// Jalankan: node --test tests/authorization.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const API_TOKEN = 'test-token-123';

// ---------------------------------------------------------------------------
// Spreadsheet palsu
// ---------------------------------------------------------------------------

function makeSheet(name, rows) {
  return {
    _name: name,
    _rows: rows.map((r) => r.slice()),
    getName() { return this._name; },
    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
    getDataRange() {
      const self = this;
      return { getValues: () => self._rows.map((r) => r.slice()) };
    },
    getRange(row, col, numRows, numCols) {
      const self = this;
      const nR = numRows === undefined ? 1 : numRows;
      const nC = numCols === undefined ? 1 : numCols;
      return {
        getValues() {
          const out = [];
          for (let r = row; r < row + nR; r++) {
            const src = self._rows[r - 1] || [];
            const line = [];
            for (let c = col; c < col + nC; c++) line.push(src[c - 1] === undefined ? '' : src[c - 1]);
            out.push(line);
          }
          return out;
        },
        getValue() {
          const src = self._rows[row - 1] || [];
          return src[col - 1];
        },
        setValue(v) {
          while (self._rows.length < row) self._rows.push([]);
          const line = self._rows[row - 1];
          while (line.length < col) line.push('');
          line[col - 1] = v;
        },
        setValues(vals) {
          vals.forEach((line, ri) => {
            const target = row + ri;
            while (self._rows.length < target) self._rows.push([]);
            const dest = self._rows[target - 1];
            line.forEach((v, ci) => {
              while (dest.length < col + ci) dest.push('');
              dest[col + ci - 1] = v;
            });
          });
        },
        clearContent() {
          for (let r = row; r < row + nR; r++) {
            const line = self._rows[r - 1];
            if (!line) continue;
            for (let c = col; c < col + nC; c++) line[c - 1] = '';
          }
        },
      };
    },
    appendRow(r) { this._rows.push(r.slice()); },
    deleteRow(i) { this._rows.splice(i - 1, 1); },
  };
}

// Tanggal relatif hari test dijalankan — jangan pernah pakai tanggal tetap:
// aturan "hari ini = SCHOOL" dibandingkan terhadap new Date() di server.
function daysAgo(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour === undefined ? 7 : hour, 0, 0, 0);
  return d;
}

// getRowsSince() melakukan binary search dan MENGANDAIKAN timestamp menaik,
// jadi urutan baris fixture ini (lama -> baru) memang harus dipertahankan.
function buildSpreadsheet() {
  const sheets = {
    Master_Guru: makeSheet('Master_Guru', [
      ['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      ['G1', 'Guru Satu', 'x', 'guru', '', '', '', 's'],
      ['G2', 'Guru Dua', 'x', 'guru', '', '', '', 's'],
      ['W1', 'Wali XI A', 'x', 'guru', '', '', 'XI A', 's'],
      ['B1', 'Bu BK', 'x', 'bk_kesiswaan', '', '', '', 's'],
      ['A1', 'Pak Admin', 'x', 'admin', '', '', '', 's'],
      ['O1', 'Osis Satu', 'x', 'osis', '', '', '', 's'],
    ]),
    Master_Siswa: makeSheet('Master_Siswa', [
      ['NISN', 'Nama', 'Kelas'],
      ['1001', 'Ani', 'XI.A (KESEHATAN I)'],
      ['1002', 'Budi', 'XII B'],
      ['1003', 'Citra', 'X C'],
    ]),
    // Timestamp | NISN | Nama | Kelas | Type | Dicatat_Oleh
    Log_Gerbang: makeSheet('Log_Gerbang', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'],
      [daysAgo(9), '1002', 'Budi', 'XII B', 'Bangun kesiangan', 'Guru Dua'],
      [daysAgo(8), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'Macet', 'Guru Dua'],
      [daysAgo(7), '1003', 'Citra', 'X C', 'Macet', 'Guru Satu'],
      [daysAgo(6), '1003', 'Citra', 'X C', 'Ban bocor', 'Wali XI A'],
      [daysAgo(0, 6), '1002', 'Budi', 'XII B', 'Kesiangan', 'Guru Dua'],
      [daysAgo(0, 7), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'Macet', 'Bu BK'],
    ]),
    // Timestamp | NISN | Nama | Kelas | Jenis | Keterangan | Foto_URL | Dicatat_Oleh
    Surat_Masuk: makeSheet('Surat_Masuk', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis', 'Keterangan', 'Foto_URL', 'Dicatat_Oleh'],
      [daysAgo(5), '1002', 'Budi', 'XII B', 'Sakit', 'RAHASIA-DBD-BUDI', '', 'Guru Dua'],
      [daysAgo(4), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'Izin', 'RAHASIA-ACARA-ANI', '', 'Guru Dua'],
      [daysAgo(3), '1003', 'Citra', 'X C', 'Sakit', 'RAHASIA-TIFUS-CITRA', '', 'Guru Satu'],
      [daysAgo(0, 8), '1002', 'Budi', 'XII B', 'Sakit', 'RAHASIA-DEMAM-BUDI', '', 'Guru Dua'],
    ]),
    // Timestamp | NISN | Nama | Kelas | Jenis | Sanksi | Catatan | Dicatat_Oleh
    Pelanggaran: makeSheet('Pelanggaran', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'],
      [daysAgo(5), '1002', 'Budi', 'XII B', 'Merokok', 'Teguran', 'CATATAN-BUDI', 'Guru Dua'],
      [daysAgo(4), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'Atribut', 'Teguran', 'CATATAN-ANI', 'Guru Dua'],
      [daysAgo(3), '1003', 'Citra', 'X C', 'Bolos', 'Panggilan', 'CATATAN-CITRA', 'Guru Satu'],
      [daysAgo(2), '1002', 'Budi', 'XII B', 'Terlambat', 'Teguran', 'CATATAN-BUDI-2', 'Wali XI A'],
    ]),
    // Timestamp | NISN | Nama | Kelas | Jenis | Catatan | Dicatat_Oleh | Dicatat_Oleh_ID
    Pelanggaran_Upacara: makeSheet('Pelanggaran_Upacara', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Catatan', 'Dicatat_Oleh', 'Dicatat_Oleh_ID'],
      [daysAgo(5), '1002', 'Budi', 'XII B', 'Atribut Tidak Lengkap', 'CATATAN-UPACARA-BUDI', 'Osis Satu', 'O1'],
      [daysAgo(4), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'Tidak Tertib', 'CATATAN-UPACARA-ANI', 'Osis Satu', 'O1'],
      [daysAgo(3), '1003', 'Citra', 'X C', 'Terlambat Baris', 'CATATAN-UPACARA-CITRA', 'Bu BK', 'B1'],
    ]),
    Bimbingan_Khusus: makeSheet('Bimbingan_Khusus', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Catatan', 'Dicatat_Oleh'],
      [daysAgo(5), '1002', 'Budi', 'XII B', 'BIMBINGAN-RAHASIA-BUDI', 'Bu BK'],
    ]),
    Tindak_Lanjut: makeSheet('Tindak_Lanjut', [
      ['Timestamp', 'NISN', 'Nama', 'Kelas', 'Catatan', 'Diajukan_Oleh', 'Status', 'Disetujui_Oleh', 'Tanggal_Disetujui'],
      [daysAgo(5), '1002', 'Budi', 'XII B', 'TL-BUDI', 'Bu BK', 'menunggu', '', ''],
      [daysAgo(4), '1001', 'Ani', 'XI.A (KESEHATAN I)', 'TL-ANI', 'Wali XI A', 'menunggu', '', ''],
    ]),
    Audit_Log: makeSheet('Audit_Log', [
      ['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'],
      [daysAgo(5), 'Pak Admin', 'A1', 'Reset Password', 'JEJAK-AUDIT-RAHASIA'],
    ]),
    Jadwal_Piket: makeSheet('Jadwal_Piket', [['Hari', 'Guru_ID'], ['Senin', 'G1']]),
  };
  return {
    _sheets: sheets,
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { sheets[n] = makeSheet(n, []); return sheets[n]; },
  };
}

// ---------------------------------------------------------------------------
// Konteks Apps Script palsu
// ---------------------------------------------------------------------------

function loadContext() {
  const cache = new Map();
  const ss = buildSpreadsheet();
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        _text: text,
        setMimeType() { return this; },
        getContent() { return this._text; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      computeDigest: (_a, str) => {
        const buf = crypto.createHash('sha256').update(str).digest();
        return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k === 'API_TOKEN' ? API_TOKEN : null) }),
    },
    Logger: { log() {} },
  };
  vm.createContext(sandbox);
  ['Utils.gs', 'Auth.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });

  const USERS = {
    guru: { id: 'G1', name: 'Guru Satu', role: 'guru', jabatan: '', waliKelas: '' },
    guru2: { id: 'G2', name: 'Guru Dua', role: 'guru', jabatan: '', waliKelas: '' },
    wali: { id: 'W1', name: 'Wali XI A', role: 'guru', jabatan: '', waliKelas: 'XI A' },
    bk: { id: 'B1', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
    admin: { id: 'A1', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
    osis: { id: 'O1', name: 'Osis Satu', role: 'osis', jabatan: '', waliKelas: '' },
  };
  const createSession = vm.runInContext('createSession', sandbox);
  const tokens = {};
  Object.keys(USERS).forEach((k) => { tokens[k] = createSession(USERS[k]); });

  const doGet = vm.runInContext('doGet', sandbox);
  const doPost = vm.runInContext('doPost', sandbox);

  return {
    ss,
    tokens,
    USERS,
    // who = kunci USERS, atau null untuk tanpa sesi
    get(action, who, extra) {
      const parameter = Object.assign(
        { action, token: API_TOKEN },
        who ? { sessionToken: tokens[who] } : {},
        extra || {}
      );
      return JSON.parse(doGet({ parameter }).getContent());
    },
    post(body) {
      return JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
    },
  };
}

const names = (rows) => rows.map((r) => r.name);
const unique = (arr) => [...new Set(arr)];

// ===========================================================================
// GURU BIASA
// ===========================================================================

test('Guru: keterlambatan HARI INI tetap se-sekolah, termasuk catatan guru lain', () => {
  const ctx = loadContext();
  const res = ctx.get('getLogs', 'guru');
  assert.equal(res.status, 'success');

  const today = new Date();
  const isToday = (t) => new Date(t).toDateString() === today.toDateString();
  const hariIni = res.logs.filter((l) => isToday(l.timestamp));

  // Dua baris hari ini di fixture, keduanya dicatat orang lain (Guru Dua & Bu BK).
  assert.equal(hariIni.length, 2, 'guru harus melihat SEMUA keterlambatan hari ini');
  assert.deepEqual(unique(hariIni.map((l) => l.logged_by)).sort(), ['Bu BK', 'Guru Dua']);
});

test('Guru: HISTORI keterlambatan hanya miliknya sendiri (OWN)', () => {
  const ctx = loadContext();
  const res = ctx.get('getLogs', 'guru');
  const today = new Date();
  const histori = res.logs.filter((l) => new Date(l.timestamp).toDateString() !== today.toDateString());

  assert.ok(histori.length > 0, 'fixture harus punya baris histori');
  assert.deepEqual(unique(histori.map((l) => l.logged_by)), ['Guru Satu']);
  // Baris histori milik guru lain tidak boleh ikut terkirim SAMA SEKALI.
  assert.equal(histori.some((l) => l.logged_by === 'Guru Dua'), false);
  assert.equal(histori.some((l) => l.logged_by === 'Wali XI A'), false);
});

test('Guru: surat hanya OWN — keterangan siswa lain tidak pernah sampai ke browser', () => {
  const ctx = loadContext();
  const res = ctx.get('getSurat', 'guru');
  assert.equal(res.status, 'success');
  assert.deepEqual(unique(res.surat.map((s) => s.logged_by)), ['Guru Satu']);

  // Bukti kebocoran diperiksa pada payload MENTAH, bukan pada objek yang
  // sudah dipetakan — kalau keterangan orang lain ikut terkirim di field
  // mana pun, string rahasianya akan muncul di sini.
  const raw = JSON.stringify(res);
  assert.equal(raw.includes('RAHASIA-TIFUS-CITRA'), true, 'suratnya sendiri harus tetap utuh');
  assert.equal(raw.includes('RAHASIA-DBD-BUDI'), false);
  assert.equal(raw.includes('RAHASIA-ACARA-ANI'), false);
  assert.equal(raw.includes('RAHASIA-DEMAM-BUDI'), false, 'surat hari ini pun bukan pengecualian untuk guru');
});

test('Guru: pelanggaran hanya OWN', () => {
  const ctx = loadContext();
  const res = ctx.get('getPelanggaran', 'guru');
  assert.equal(res.status, 'success');
  assert.deepEqual(unique(res.pelanggaran.map((p) => p.logged_by)), ['Guru Satu']);
  const raw = JSON.stringify(res);
  assert.equal(raw.includes('CATATAN-CITRA'), true);
  assert.equal(raw.includes('CATATAN-BUDI'), false);
  assert.equal(raw.includes('CATATAN-ANI'), false);
});

test('Guru: Audit Log DITOLAK', () => {
  const ctx = loadContext();
  const res = ctx.get('getAuditLog', 'guru');
  assert.equal(res.status, 'error');
  assert.equal(res.message, 'Unauthorized');
  assert.equal(JSON.stringify(res).includes('JEJAK-AUDIT-RAHASIA'), false);
});

// ===========================================================================
// WALI KELAS
// ===========================================================================

test('Wali Kelas: melihat kelasnya sendiri DAN catatannya sendiri di kelas lain (CLASS ∪ OWN)', () => {
  const ctx = loadContext();
  const res = ctx.get('getPelanggaran', 'wali');
  assert.equal(res.status, 'success');

  const raw = JSON.stringify(res);
  // Kelasnya sendiri — ditulis guru lain. Nama kelas di sheet ditulis
  // "XI.A (KESEHATAN I)" sementara Kelas_Wali-nya "XI A": sameClass() yang
  // menjembatani, dan itu memang harus tetap bekerja.
  assert.equal(raw.includes('CATATAN-ANI'), true, 'baris kelas perwaliannya harus terlihat');
  // Catatannya sendiri untuk siswa kelas LAIN (XII B) — inilah bagian OWN
  // yang sebelumnya hilang karena percabangannya eksklusif.
  assert.equal(raw.includes('CATATAN-BUDI-2'), true, 'catatan miliknya sendiri di kelas lain harus terlihat');
  // Kelas lain yang bukan catatannya: tidak boleh.
  assert.equal(raw.includes('CATATAN-CITRA'), false);
  assert.equal(raw.includes('"CATATAN-BUDI"'), false);
});

test('Wali Kelas: histori keterlambatan = kelasnya ∪ miliknya, kelas lain tidak ikut', () => {
  const ctx = loadContext();
  const res = ctx.get('getLogs', 'wali');
  const today = new Date();
  const histori = res.logs.filter((l) => new Date(l.timestamp).toDateString() !== today.toDateString());

  // Ani (XI.A, dicatat Guru Dua) = kelasnya. Citra (X C, dicatat Wali XI A) = miliknya.
  assert.equal(histori.some((l) => l.name === 'Ani'), true);
  assert.equal(histori.some((l) => l.name === 'Citra' && l.logged_by === 'Wali XI A'), true);
  // Citra yang dicatat Guru Satu (kelas lain, bukan miliknya) tidak boleh ikut.
  assert.equal(histori.some((l) => l.logged_by === 'Guru Satu'), false);
  // Budi (XII B, dicatat Guru Dua) tidak boleh ikut.
  assert.equal(histori.some((l) => l.name === 'Budi'), false);
});

test('Wali Kelas: menerima keterangan surat LENGKAP untuk kelasnya', () => {
  const ctx = loadContext();
  const res = ctx.get('getSurat', 'wali');
  const ani = res.surat.find((s) => s.name === 'Ani');
  assert.ok(ani, 'surat siswa kelas perwaliannya harus terkirim');
  assert.equal(ani.keterangan, 'RAHASIA-ACARA-ANI', 'keterangan tidak boleh dipangkas untuk wali kelas');
  // Tapi kelas lain tetap tidak ikut.
  assert.equal(JSON.stringify(res).includes('RAHASIA-DBD-BUDI'), false);
});

test('Wali Kelas: Audit Log DITOLAK', () => {
  const ctx = loadContext();
  const res = ctx.get('getAuditLog', 'wali');
  assert.equal(res.status, 'error');
  assert.equal(JSON.stringify(res).includes('JEJAK-AUDIT-RAHASIA'), false);
});

// ===========================================================================
// BK / KESISWAAN
// ===========================================================================

test('BK/Kesiswaan: SCHOOL untuk keterlambatan, surat (keterangan lengkap) & pelanggaran', () => {
  const ctx = loadContext();

  const logs = ctx.get('getLogs', 'bk');
  assert.equal(logs.logs.length, 6, 'BK melihat seluruh Log_Gerbang');

  const surat = ctx.get('getSurat', 'bk');
  assert.equal(surat.surat.length, 4);
  const rawSurat = JSON.stringify(surat);
  ['RAHASIA-DBD-BUDI', 'RAHASIA-ACARA-ANI', 'RAHASIA-TIFUS-CITRA'].forEach((k) => {
    assert.equal(rawSurat.includes(k), true, `BK harus menerima keterangan lengkap: ${k}`);
  });

  const pel = ctx.get('getPelanggaran', 'bk');
  assert.equal(pel.pelanggaran.length, 4);
});

test('BK/Kesiswaan: Audit Log DITOLAK (ADMIN ONLY)', () => {
  const ctx = loadContext();
  const res = ctx.get('getAuditLog', 'bk');
  assert.equal(res.status, 'error');
  assert.equal(res.message, 'Unauthorized');
  assert.equal(JSON.stringify(res).includes('JEJAK-AUDIT-RAHASIA'), false);
});

// ===========================================================================
// OSIS
// ===========================================================================

test('OSIS: rekap upacara se-sekolah TANPA nisn dan TANPA catatan naratif', () => {
  const ctx = loadContext();
  const res = ctx.get('getPelanggaranUpacara', 'osis');
  assert.equal(res.status, 'success');
  assert.equal(res.upacara.length, 3, 'OSIS tetap melihat seluruh sekolah untuk upacara');

  res.upacara.forEach((u) => {
    assert.equal('nisn' in u, false, 'nisn tidak boleh dikirim ke OSIS');
    assert.equal('catatan' in u, false, 'catatan naratif tidak boleh dikirim ke OSIS');
    // Yang memang dibutuhkan untuk tugas upacara tetap ada.
    assert.ok(u.name && u.class && u.jenis_pelanggaran && u.timestamp);
  });

  const raw = JSON.stringify(res);
  assert.equal(raw.includes('CATATAN-UPACARA-BUDI'), false);
  assert.equal(raw.includes('1001'), false, 'NISN siswa tidak boleh muncul di payload OSIS');
});

test('OSIS: seluruh kategori disiplin lain DITOLAK', () => {
  const ctx = loadContext();
  const terlarang = [
    'getLogs', 'getSurat', 'getPelanggaran', 'getPelanggaranCountForStudent',
    'getStudentLateHistory', 'getBimbingan', 'getTindakLanjut', 'getAuditLog',
    'getTeachers', 'getJadwalPiket', 'getWaliKelasMap',
  ];
  terlarang.forEach((action) => {
    const res = ctx.get(action, 'osis', { nisn: '1001' });
    assert.equal(res.status, 'error', `${action} harus menolak OSIS`);
    assert.equal(res.message, 'Unauthorized', `${action} harus menolak OSIS`);
  });
});

test('OSIS: tetap dapat daftar siswa (dibutuhkan untuk MENCATAT upacara)', () => {
  const ctx = loadContext();
  const res = ctx.get('getStudents', 'osis');
  assert.equal(res.status, 'success');
  // nisn di sini memang diperlukan: itu identitas yang ditulis
  // addPelanggaranUpacara ke sheet. Yang dipangkas adalah nisn di jalur BACA
  // rekap (test di atas), bukan di jalur pencatatan.
  assert.ok(res.students.length > 0);
  assert.ok(res.students[0].nisn);
});

// ===========================================================================
// ADMIN
// ===========================================================================

test('Admin: seluruh scope administratif + Audit Log', () => {
  const ctx = loadContext();
  assert.equal(ctx.get('getLogs', 'admin').logs.length, 6);
  assert.equal(ctx.get('getSurat', 'admin').surat.length, 4);
  assert.equal(ctx.get('getPelanggaran', 'admin').pelanggaran.length, 4);
  assert.equal(ctx.get('getTeachers', 'admin').status, 'success');
  assert.equal(ctx.get('getBimbingan', 'admin').status, 'success');

  const audit = ctx.get('getAuditLog', 'admin');
  assert.equal(audit.status, 'success');
  assert.equal(JSON.stringify(audit).includes('JEJAK-AUDIT-RAHASIA'), true);
});

test('Admin: rekap upacara tetap membawa nisn & catatan (bukan payload OSIS)', () => {
  const ctx = loadContext();
  const res = ctx.get('getPelanggaranUpacara', 'admin');
  assert.equal(res.upacara.length, 3);
  assert.ok(res.upacara[0].nisn, 'admin tetap menerima nisn');
  assert.equal(JSON.stringify(res).includes('CATATAN-UPACARA-BUDI'), true);
});

// ===========================================================================
// TIDAK ADA JALUR ALTERNATIF KE AUDIT LOG
// ===========================================================================

test('Tidak ada endpoint doGet lain yang membocorkan Audit Log ke non-admin', () => {
  const ctx = loadContext();
  // Semua action doGet yang ada, ditembak sebagai BK/Kesiswaan (role non-admin
  // paling berhak) — tidak satu pun boleh memuat isi Audit_Log.
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  const doGetSource = code.slice(code.indexOf('function doGet'));
  const actions = unique(
    [...doGetSource.matchAll(/action === '([a-zA-Z]+)'/g)].map((m) => m[1])
  );
  assert.ok(actions.length >= 10, 'daftar action doGet harus terdeteksi');

  ['bk', 'wali', 'guru'].forEach((who) => {
    actions.forEach((action) => {
      const res = ctx.get(action, who, { nisn: '1001' });
      assert.equal(
        JSON.stringify(res).includes('JEJAK-AUDIT-RAHASIA'), false,
        `${action} membocorkan Audit Log ke ${who}`
      );
    });
  });
});

test('getTodayData sudah tidak ada dan tidak mengembalikan data apa pun', () => {
  const ctx = loadContext();
  const res = ctx.get('getTodayData', 'guru');
  assert.equal(res.status, 'active', 'action tak dikenal jatuh ke ping status');
  assert.equal('todayLate' in res, false);
  assert.equal('todaySurat' in res, false);
  assert.equal('lateForBanner' in res, false);
  assert.equal(JSON.stringify(res).includes('RAHASIA'), false);
  // Dan memang sudah tidak ada handler-nya di sumber.
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  assert.equal(code.includes("if (action === 'getTodayData')"), false);
});

// ===========================================================================
// NEGATIVE TESTS — IDOR / BOLA / MANIPULASI PARAMETER
// ===========================================================================

test('IDOR studentId: getStudentLateHistory untuk NISN di luar scope mengembalikan kosong', () => {
  const ctx = loadContext();

  // Guru Satu tidak pernah mencatat Budi (1002) -> harus kosong.
  const guru = ctx.get('getStudentLateHistory', 'guru', { nisn: '1002' });
  assert.equal(guru.status, 'success');
  assert.deepEqual(guru.history, []);

  // Tapi siswa yang memang dia catat tetap terbaca — bukan diblokir buta.
  const milikSendiri = ctx.get('getStudentLateHistory', 'guru', { nisn: '1003' });
  assert.equal(milikSendiri.history.length, 1);
  assert.equal(milikSendiri.history[0].logged_by, 'Guru Satu');

  // BK tetap dapat seluruhnya.
  const bk = ctx.get('getStudentLateHistory', 'bk', { nisn: '1002' });
  assert.equal(bk.history.length, 2);
});

test('IDOR studentId: hitungan pelanggaran di-scope, tidak bisa dipakai enumerasi', () => {
  const ctx = loadContext();

  // Guru Satu cuma mencatat Citra (1003). NISN lain harus 0, bukan total sekolah.
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'guru', { nisn: '1003' }).count, 1);
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'guru', { nisn: '1002' }).count, 0);
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'guru', { nisn: '1001' }).count, 0);

  // Wali XI A: Ani (kelasnya) = 1, Budi = 1 (baris yang DIA tulis sendiri,
  // bukan baris Guru Dua) — CLASS ∪ OWN, bukan total sekolah (yang = 2).
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'wali', { nisn: '1001' }).count, 1);
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'wali', { nisn: '1002' }).count, 1);

  // BK melihat total sesungguhnya.
  assert.equal(ctx.get('getPelanggaranCountForStudent', 'bk', { nisn: '1002' }).count, 2);
});

test('Manipulasi classId/waliKelas lewat query TIDAK memperluas scope', () => {
  const ctx = loadContext();
  const jahat = { kelas: 'XII B', class: 'XII B', waliKelas: 'XII B', class_name: 'XII B', scope: 'school' };

  const logs = ctx.get('getLogs', 'guru', jahat);
  const today = new Date();
  const histori = logs.logs.filter((l) => new Date(l.timestamp).toDateString() !== today.toDateString());
  assert.deepEqual(unique(histori.map((l) => l.logged_by)), ['Guru Satu']);

  const surat = ctx.get('getSurat', 'guru', jahat);
  assert.equal(JSON.stringify(surat).includes('RAHASIA-DBD-BUDI'), false);
});

test('Manipulasi requesterId/role lewat query maupun body TIDAK menaikkan hak akses', () => {
  const ctx = loadContext();

  // doGet: role & requesterId dipalsukan.
  const palsu = { requesterId: 'A1', role: 'admin', isAdmin: 'true', user: 'Pak Admin' };
  const audit = ctx.get('getAuditLog', 'guru', palsu);
  assert.equal(audit.status, 'error');
  assert.equal(JSON.stringify(audit).includes('JEJAK-AUDIT-RAHASIA'), false);

  const teachers = ctx.get('getTeachers', 'guru', palsu);
  assert.equal(teachers.status, 'error');

  // doPost: aksi admin dengan requesterId palsu tetap ditolak — role dibaca
  // dari record sesi di server, bukan dari body.
  const res = ctx.post({
    action: 'updateRole', token: API_TOKEN, sessionToken: ctx.tokens.guru,
    requesterId: 'A1', role: 'admin', targetId: 'G2', newRole: 'admin',
  });
  assert.equal(res.status, 'error');
  assert.match(res.message, /Hanya admin/);
  // Sheet tidak berubah.
  assert.equal(ctx.ss.getSheetByName('Master_Guru')._rows[2][3], 'guru');
});

test('IDOR recordId: guru tidak bisa mengedit/menghapus catatan milik guru lain', () => {
  const ctx = loadContext();
  const sheet = ctx.ss.getSheetByName('Pelanggaran');
  const barisGuruDua = sheet._rows[1]; // Budi, dicatat Guru Dua
  const jumlahAwal = sheet._rows.length;

  const edit = ctx.post({
    action: 'editEntry', token: API_TOKEN, sessionToken: ctx.tokens.guru,
    category: 'pelanggaran', nisn: barisGuruDua[1], timestamp: barisGuruDua[0],
    name: 'Budi', jenis_pelanggaran: 'DIUBAH', sanksi: 'DIUBAH', catatan: 'DIUBAH',
  });
  assert.equal(edit.status, 'error');
  assert.equal(sheet._rows[1][4], 'Merokok', 'baris milik guru lain tidak boleh berubah');

  const hapus = ctx.post({
    action: 'deleteEntry', token: API_TOKEN, sessionToken: ctx.tokens.guru,
    category: 'pelanggaran', nisn: barisGuruDua[1], timestamp: barisGuruDua[0], name: 'Budi',
  });
  assert.equal(hapus.status, 'error');
  assert.equal(sheet._rows.length, jumlahAwal, 'tidak ada baris yang boleh terhapus');
});

test('Sesi & token: tanpa sesi valid tidak ada data disiplin yang keluar', () => {
  const ctx = loadContext();

  // sessionToken kosong / karangan.
  ['getLogs', 'getSurat', 'getPelanggaran', 'getAuditLog', 'getPelanggaranUpacara'].forEach((action) => {
    const tanpaSesi = ctx.get(action, null);
    assert.equal(tanpaSesi.status, 'error', `${action} tanpa sesi harus ditolak`);
    const sesiPalsu = ctx.get(action, null, { sessionToken: 'token-karangan' });
    assert.equal(sesiPalsu.status, 'error', `${action} dengan sesi palsu harus ditolak`);
    assert.equal(JSON.stringify(sesiPalsu).includes('RAHASIA'), false);
  });

  // API_TOKEN salah -> Unauthorized, bahkan dengan sessionToken admin yang sah.
  const tokenSalah = ctx.get('getLogs', 'admin', { token: 'token-salah' });
  assert.equal(tokenSalah.status, 'error');
  assert.equal(tokenSalah.message, 'Unauthorized');
  assert.equal('logs' in tokenSalah, false);
});

test('Upacara: guru biasa hanya OWN, wali kelas CLASS ∪ OWN', () => {
  const ctx = loadContext();

  // Guru biasa tidak pernah mencatat upacara -> kosong, bukan seluruh sekolah.
  const guru = ctx.get('getPelanggaranUpacara', 'guru');
  assert.equal(guru.status, 'success');
  assert.deepEqual(guru.upacara, []);

  // Wali XI A: baris Ani (kelasnya) ikut, baris kelas lain tidak.
  const wali = ctx.get('getPelanggaranUpacara', 'wali');
  assert.deepEqual(names(wali.upacara), ['Ani']);
  assert.equal(JSON.stringify(wali).includes('CATATAN-UPACARA-CITRA'), false);
});

test('Bimbingan Khusus: pola permission existing dipertahankan (BK/admin baca, OSIS ditolak)', () => {
  const ctx = loadContext();
  assert.equal(ctx.get('getBimbingan', 'guru').status, 'error');
  assert.equal(ctx.get('getBimbingan', 'wali').status, 'error');
  assert.equal(ctx.get('getBimbingan', 'osis').status, 'error');
  assert.equal(ctx.get('getBimbingan', 'bk').status, 'success');
  assert.equal(ctx.get('getBimbingan', 'admin').status, 'success');
  assert.equal(JSON.stringify(ctx.get('getBimbingan', 'guru')).includes('BIMBINGAN-RAHASIA-BUDI'), false);
});

test('Cache dibagi mentah, bukan hasil yang sudah difilter untuk orang lain', () => {
  const ctx = loadContext();
  // BK memanggil duluan (mengisi cache dengan SELURUH baris), lalu guru
  // memanggil: guru tetap harus menerima versi ter-scope, bukan isi cache BK.
  const bk = ctx.get('getLogs', 'bk');
  assert.equal(bk.logs.length, 6);

  const guru = ctx.get('getLogs', 'guru');
  const today = new Date();
  const histori = guru.logs.filter((l) => new Date(l.timestamp).toDateString() !== today.toDateString());
  assert.deepEqual(unique(histori.map((l) => l.logged_by)), ['Guru Satu']);

  // Dan sebaliknya: guru duluan tidak boleh membuat BK ikut terpotong.
  const ctx2 = loadContext();
  ctx2.get('getSurat', 'guru');
  assert.equal(ctx2.get('getSurat', 'bk').surat.length, 4);
});
