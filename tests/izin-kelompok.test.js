// ===== tests/izin-kelompok.test.js =====
// IZIN KELOMPOK: satu kegiatan, banyak peserta — diuji lewat doPost()/doGet()
// yang SUNGGUHAN (Utils.gs+Auth.gs+Code.gs di vm, layanan Apps Script di-stub).
//
// Yang paling penting dijaga di sini, dan gampang rusak diam-diam:
//   1. Kelompok itu KONTEKS, bukan status. Setiap peserta tetap punya status
//      sendiri, dan aksi rombongan tidak boleh menyeret siswa yang tidak
//      dicentang.
//   2. Aksi massal bukan celah: tiap peserta tetap lewat penjaga transisi yang
//      sama dengan aksi per siswa.
//   3. Daftar peserta dari klien tidak dipercaya — nama & kelas dari
//      Master_Siswa, id yang bukan milik kegiatan ditolak.
//
// Kewenangan (Guru Piket dari Jadwal_Piket, Izin Khusus, dst.) memakai
// mekanisme yang sama persis dengan izin individual — lihat
// tests/izin-keluar.test.js untuk aturan dasarnya.
//
// TIDAK ADA satu pun test di sini yang menyentuh printer/pencetakan.

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
const HARI_LAIN = HARI[(now.getDay() + 3) % 7];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  pemberiIzin: { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' },
  piketPagi: { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', jabatan: '', waliKelas: '' },
  piketSiang: { id: 'G11', name: 'Bu Piket Siang', role: 'guru', jabatan: '', waliKelas: '' },
  bukanPiket: { id: 'G12', name: 'Pak Bukan Piket', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

// 8 peserta seminar (contoh nyata di spesifikasi) + 1 siswa di luar rombongan.
const SISWA = [
  ['1001', 'Ahmad', 'XI A'],
  ['1002', 'Budi', 'XI A'],
  ['1003', 'Citra', 'XI B'],
  ['1004', 'Deni', 'XI B'],
  ['1005', 'Eka', 'XII C'],
  ['1006', 'Fajar', 'XII C'],
  ['1007', 'Gita', 'XII C'],
  ['1008', 'Hana', 'XII C'],
  ['2001', 'Indra', 'X D'],
];
const PESERTA_SEMINAR = ['1001', '1002', '1003', '1004', '1005', '1006', '1007', '1008'];

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

function loadServer(opts) {
  const options = opts || {};
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, '', 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], options.tanpaJadwalPiket ? [] : (options.jadwalPiketRows || [
      [HARI_INI, 'G10'], [HARI_INI, 'G11'], [HARI_LAIN, 'G12'],
    ])),
    Izin_Keluar: makeSheet(IZIN_HEADER, []),
    Izin_Kelompok: makeSheet(KELOMPOK_HEADER, []),
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
  // Peserta satu kegiatan, dibaca dari sheet (bukan dari respons) — supaya yang
  // diperiksa benar-benar apa yang tersimpan.
  const peserta = (idKelompok) => izinRows().filter((r) => String(r[20]) === String(idKelompok))
    .map((r) => ({ id: String(r[4]), nisn: String(r[1]), name: String(r[2]), class: String(r[3]), status: String(r[7]), row: r }));
  const statusPeserta = (idKelompok) => {
    const peta = {};
    peserta(idKelompok).forEach((p) => { peta[p.name] = p.status; });
    return peta;
  };

  return { sandbox, sheets, tokens, post, get, izinRows, kelompokRows, auditRows, peserta, statusPeserta, cacheStore };
}

// Ajukan kegiatan (jalur normal). Mengembalikan respons apa adanya.
const ajukan = (s, who, extra) => s.post(who, Object.assign({
  action: 'addIzinKelompok',
  kegiatan: 'Seminar Bank Indonesia',
  keperluan: 'undangan seminar literasi keuangan',
  tujuan: 'kembali',
  pola_kembali: 'bersama',
  peserta: PESERTA_SEMINAR.map((n) => ({ nisn: n })),
}, extra || {}));

// Ajukan + verifikasi seluruh rombongan → semua 'Sedang di Luar'.
function rombonganDiLuar(s, extra) {
  const buat = ajukan(s, 'wali', extra);
  assert.equal(buat.status, 'success');
  const ver = s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.status, 'success');
  return buat;
}

// ============================================================
// 1-4. MEMBUAT IZIN KELOMPOK
// ============================================================

test('membuat izin kelompok: satu kegiatan induk + satu baris per siswa', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  assert.equal(buat.status, 'success');
  assert.equal(buat.jumlahPeserta, 8);
  assert.equal(buat.izinStatus, 'Menunggu Verifikasi');

  // 1 baris kegiatan, 8 baris peserta — bukan 8 kegiatan, bukan 1 baris gemuk.
  assert.equal(s.kelompokRows().length, 1);
  assert.equal(s.izinRows().length, 8);

  const kel = s.kelompokRows()[0];
  assert.equal(kel[2], 'Seminar Bank Indonesia');
  assert.equal(kel[5], 'bersama');
  assert.equal(kel[6], 8, 'jumlah peserta tercatat di baris kegiatan');
  assert.equal(kel[9], 'Bu Kartina', 'pemberi persetujuan dari sesi');

  // Tiap peserta = baris Izin_Keluar biasa dengan kunci kegiatan di kolom 21.
  s.peserta(buat.id).forEach((p) => {
    assert.equal(p.status, 'Menunggu Verifikasi');
    assert.equal(String(p.row[20]), buat.id);
    assert.equal(p.row[10], 'Bu Kartina');
    assert.equal(p.row[16], '', 'waktu keluar belum diisi sebelum verifikasi');
  });
});

test('memilih beberapa siswa: nama & kelas diambil dari Master_Siswa', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali', {
    peserta: [
      { nisn: '1001', name: 'Nama Karangan', class: 'XII C' },
      { nisn: '1003', name: 'Palsu', class: 'X A' },
    ],
  });
  const daftar = s.peserta(buat.id);
  assert.deepEqual(daftar.map((p) => `${p.name}/${p.class}`), ['Ahmad/XI A', 'Citra/XI B']);
});

test('peserta duplikat tidak menghasilkan dua baris untuk siswa yang sama', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali', {
    peserta: [{ nisn: '1001' }, { nisn: '1002' }, { nisn: '1001' }, { nisn: '1002' }, { nisn: '1001' }],
  });
  assert.equal(buat.status, 'success');
  assert.equal(buat.jumlahPeserta, 2);
  assert.equal(s.peserta(buat.id).length, 2);
  assert.equal(s.kelompokRows()[0][6], 2, 'jumlah peserta ikut menghitung setelah duplikat dibuang');
});

test('peserta kosong / kegiatan kosong / keperluan kosong ditolak', () => {
  const s = loadServer();
  assert.match(ajukan(s, 'wali', { peserta: [] }).message, /minimal satu siswa/i);
  assert.match(ajukan(s, 'wali', { peserta: [{ nisn: '   ' }] }).message, /minimal satu siswa/i);
  assert.match(ajukan(s, 'wali', { kegiatan: '  ' }).message, /[Kk]egiatan/);
  assert.match(ajukan(s, 'wali', { keperluan: '' }).message, /[Kk]eperluan/);
  assert.match(ajukan(s, 'wali', { tujuan: 'terbang' }).message, /[Tt]ujuan/);
  assert.equal(s.kelompokRows().length, 0, 'tidak ada kegiatan yang tersimpan saat ditolak');
  assert.equal(s.izinRows().length, 0, 'tidak ada baris peserta yang tersimpan saat ditolak');
});

test('satu peserta bermasalah membatalkan SELURUH pengajuan (tidak ada kelompok separuh jadi)', () => {
  const s = loadServer();
  // NISN yang tidak ada di Master_Siswa.
  const nisnPalsu = ajukan(s, 'wali', { peserta: [{ nisn: '1001' }, { nisn: '9999' }] });
  assert.equal(nisnPalsu.status, 'error');
  assert.equal(s.izinRows().length, 0, 'Ahmad pun tidak boleh ikut tersimpan');

  // Siswa yang sudah punya transaksi berjalan.
  s.post('wali', { action: 'addIzinKeluar', nisn: '1002', tujuan: 'kembali', keperluan: 'ke dokter' });
  const bentrok = ajukan(s, 'wali');
  assert.equal(bentrok.status, 'error');
  assert.match(bentrok.message, /Budi/);
  assert.equal(s.kelompokRows().length, 0);
  assert.equal(s.izinRows().length, 1, 'cuma izin individual Budi yang ada, kegiatan batal seluruhnya');
});

test('satu siswa tidak bisa punya dua transaksi aktif, termasuk lewat dua kegiatan', () => {
  const s = loadServer();
  const pertama = rombonganDiLuar(s);
  const kedua = ajukan(s, 'pemberiIzin', { kegiatan: 'Lomba Cerdas Cermat' });
  assert.equal(kedua.status, 'error');
  assert.match(kedua.message, /Ahmad/);
  assert.equal(s.kelompokRows().length, 1);
  assert.equal(s.peserta(pertama.id).length, 8);

  // Izin individual untuk peserta yang sedang di luar juga ditolak.
  const individu = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'pulang', keperluan: 'dijemput' });
  assert.equal(individu.status, 'error');
  assert.match(individu.message, /masih di luar/i);
});

// ============================================================
// 5-6. VERIFIKASI GURU PIKET & STATUS INDIVIDUAL
// ============================================================

test('verifikasi kelompok oleh Guru Piket: semua peserta keluar, status tetap per siswa', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  const ver = s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.status, 'success');
  assert.equal(ver.jumlahDiverifikasi, 8);
  assert.equal(ver.izinStatus, 'Sedang di Luar');

  s.peserta(buat.id).forEach((p) => {
    assert.equal(p.status, 'Sedang di Luar', p.name);
    assert.equal(p.row[13], 'Pak Piket Pagi', 'verifier tercatat di baris tiap siswa');
    assert.ok(p.row[16], 'waktu keluar dicap saat verifikasi, sama seperti individual');
  });
  // Baris kegiatan ikut menyimpan verifier sebagai konteks — TAPI tidak ada
  // kolom status kelompok yang menggantikan status siswa.
  const kel = s.kelompokRows()[0];
  assert.equal(kel[12], 'Pak Piket Pagi');
  assert.ok(!KELOMPOK_HEADER.some((h) => /^Status/i.test(h)), 'sheet kegiatan tidak boleh punya kolom status');
});

test('verifikasi sebagian: yang tidak dicentang tetap Menunggu Verifikasi', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  const semua = s.peserta(buat.id);
  const berangkat = semua.slice(0, 6).map((p) => p.id);

  const ver = s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id, pesertaIds: berangkat });
  assert.equal(ver.jumlahDiverifikasi, 6);

  const status = s.statusPeserta(buat.id);
  assert.equal(Object.values(status).filter((v) => v === 'Sedang di Luar').length, 6);
  assert.equal(status['Gita'], 'Menunggu Verifikasi');
  assert.equal(status['Hana'], 'Menunggu Verifikasi', 'tidak dicentang ≠ diam-diam dianggap keluar');

  // Sisanya masih bisa diverifikasi menyusul.
  const susulan = s.post('piketSiang', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(susulan.jumlahDiverifikasi, 2);
  assert.equal(s.statusPeserta(buat.id)['Hana'], 'Sedang di Luar');
});

test('verifikasi kelompok ditolak untuk yang tidak berwenang', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  ['bukanPiket', 'pemberiIzin', 'osis'].forEach((who) => {
    const res = s.post(who, { action: 'verifikasiIzinKelompok', id: buat.id });
    assert.equal(res.status, 'error', who);
  });
  Object.values(s.statusPeserta(buat.id)).forEach((st) => assert.equal(st, 'Menunggu Verifikasi'));
  // admin & BK tetap boleh (mekanisme existing, tidak diubah).
  assert.equal(s.post('bk', { action: 'verifikasiIzinKelompok', id: buat.id }).status, 'success');
});

test('verifikasi kelompok dua kali ditolak', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const lagi = s.post('piketSiang', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(lagi.status, 'error');
  assert.match(lagi.message, /menunggu verifikasi/i);
});

// ============================================================
// 7-9. POLA KEMBALI BERSAMA & INDIVIDUAL
// ============================================================

test('kembali bersama: hanya siswa yang dicentang berubah, sisanya tetap di luar', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const semua = s.peserta(buat.id);
  const kembali = semua.filter((p) => p.name !== 'Deni').map((p) => p.id);

  const res = s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: kembali });
  assert.equal(res.status, 'success');
  assert.equal(res.jumlahKembali, 7);
  assert.equal(res.jumlahBelumKembali, 1);

  const status = s.statusPeserta(buat.id);
  // Selesai langsung, satu langkah — bukan singgah dulu di 'Kembali'
  // menunggu penutupan administratif terpisah (dihapus, audit UX Agustus 2026).
  assert.equal(Object.values(status).filter((v) => v === 'Selesai').length, 7);
  assert.equal(status['Deni'], 'Sedang di Luar', 'yang belum kembali TIDAK boleh ikut berubah');
  // Siapa yang mencatat kembali tersimpan per siswa.
  s.peserta(buat.id).filter((p) => p.status === 'Selesai').forEach((p) => {
    assert.equal(p.row[18], 'Bu Piket Siang');
    assert.ok(p.row[17], 'waktu kembali terisi');
  });
});

test('kembali bersama TIDAK boleh mengubah semua tanpa daftar konfirmasi', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  [undefined, [], 'semua'].forEach((ids) => {
    const res = s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: ids });
    assert.equal(res.status, 'error', JSON.stringify(ids));
    assert.match(res.message, /[Pp]ilih dulu/);
  });
  Object.values(s.statusPeserta(buat.id)).forEach((st) => assert.equal(st, 'Sedang di Luar'));
});

test('sisa rombongan bisa ditandai kembali menyusul', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const semua = s.peserta(buat.id);
  s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: semua.filter((p) => p.name !== 'Deni').map((p) => p.id) });

  const deni = s.peserta(buat.id).find((p) => p.name === 'Deni');
  const susulan = s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: [deni.id] });
  assert.equal(susulan.status, 'success');
  assert.equal(susulan.jumlahBelumKembali, 0);
  Object.values(s.statusPeserta(buat.id)).forEach((st) => assert.equal(st, 'Selesai'));
});

test('pola individual: tiap peserta ditandai kembali sendiri lewat aksi izin individual', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s, { pola_kembali: 'individual' });
  assert.equal(s.kelompokRows()[0][5], 'individual');

  const ahmad = s.peserta(buat.id).find((p) => p.name === 'Ahmad');
  // Aksi per siswa yang SUDAH ADA — tidak ada jalur baru untuk pola individual.
  // Langsung Selesai (satu langkah), sama seperti izin individual biasa.
  const res = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: ahmad.id });
  assert.equal(res.izinStatus, 'Selesai');

  const status = s.statusPeserta(buat.id);
  assert.equal(status['Ahmad'], 'Selesai');
  assert.equal(Object.values(status).filter((v) => v === 'Sedang di Luar').length, 7,
    'menandai satu siswa tidak boleh menyentuh anggota lain');
});

// ============================================================
// 10. SALAH SATU PESERTA PULANG
// ============================================================

test('satu peserta pulang, sisanya kembali — status masing-masing berdiri sendiri', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const deni = s.peserta(buat.id).find((p) => p.name === 'Deni');

  // Deni ternyata langsung pulang seusai kegiatan.
  assert.equal(s.post('piketPagi', { action: 'tandaiPulangIzinKeluar', id: deni.id }).izinStatus, 'Pulang');
  // Siswa yang sudah Pulang TIDAK bisa ditandai kembali — penjaga lama tetap berlaku.
  const salah = s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: deni.id });
  assert.equal(salah.status, 'error');
  assert.match(salah.message, /PULANG|pulang/);

  // ...dan aksi rombongan pun tidak bisa menariknya kembali.
  const lewatRombongan = s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: [deni.id] });
  assert.equal(lewatRombongan.status, 'error');
  assert.match(lewatRombongan.message, /Deni/);

  // Sisanya tetap bisa ditandai kembali seperti biasa.
  const sisanya = s.peserta(buat.id).filter((p) => p.status === 'Sedang di Luar').map((p) => p.id);
  const res = s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: sisanya });
  assert.equal(res.jumlahKembali, 7);

  const status = s.statusPeserta(buat.id);
  // Deni final di 'Pulang' (tidak pernah butuh penutupan terpisah), sisanya
  // final di 'Selesai' — dua hasil berbeda, dua kata status berbeda, TAPI
  // keduanya sudah FINAL dalam satu langkah masing-masing.
  assert.equal(status['Deni'], 'Pulang');
  assert.equal(Object.values(status).filter((v) => v === 'Selesai').length, 7);

  // Sudah terkunci — tidak ada aksi lanjutan apa pun untuk Deni.
  assert.equal(s.post('bk', { action: 'tandaiKembaliIzinKeluar', id: deni.id }).status, 'error');
  assert.equal(s.post('bk', { action: 'tandaiPulangIzinKeluar', id: deni.id }).status, 'error');
});

test('tandai pulang butuh kewenangan piket & hanya dari status Sedang di Luar', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  const ahmad = s.peserta(buat.id).find((p) => p.name === 'Ahmad');
  // Belum diverifikasi -> belum keluar -> belum bisa dinyatakan pulang.
  assert.equal(s.post('piketPagi', { action: 'tandaiPulangIzinKeluar', id: ahmad.id }).status, 'error');

  s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(s.post('bukanPiket', { action: 'tandaiPulangIzinKeluar', id: ahmad.id }).status, 'error');
  assert.equal(s.statusPeserta(buat.id)['Ahmad'], 'Sedang di Luar');
});

test('kegiatan bertujuan Pulang: selesai setelah verifikasi, tanpa pola kembali', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali', { tujuan: 'pulang', kegiatan: 'Pulang bersama karena banjir', pola_kembali: 'bersama' });
  assert.equal(s.kelompokRows()[0][5], '', 'pola kembali tidak berlaku kalau tidak ada yang kembali');

  const ver = s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.izinStatus, 'Pulang');
  Object.values(s.statusPeserta(buat.id)).forEach((st) => assert.equal(st, 'Pulang'));

  const semua = s.peserta(buat.id);
  const salah = s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: [semua[0].id] });
  assert.equal(salah.status, 'error');
});

// ============================================================
// 11-12. MANIPULASI PARAMETER & IZIN KHUSUS
// ============================================================

test('id peserta dari kegiatan LAIN ditolak, tidak ada status yang berubah', () => {
  const s = loadServer();
  const a = rombonganDiLuar(s);
  const b = s.post('pemberiIzin', {
    action: 'addIzinKelompok', kegiatan: 'Kunjungan Museum', keperluan: 'studi lapangan',
    tujuan: 'kembali', pola_kembali: 'bersama', peserta: [{ nisn: '2001' }],
  });
  s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: b.id });

  const indra = s.peserta(b.id)[0];
  const res = s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: a.id, pesertaIds: [indra.id] });
  assert.equal(res.status, 'error');
  assert.match(res.message, /bukan bagian dari kegiatan/i);
  assert.equal(s.statusPeserta(b.id)['Indra'], 'Sedang di Luar', 'kegiatan lain tidak ikut berubah');
  Object.values(s.statusPeserta(a.id)).forEach((st) => assert.equal(st, 'Sedang di Luar'));

  // Sama untuk verifikasi.
  const c = ajukan(s, 'pemberiIzin', { kegiatan: 'Lomba', peserta: [{ nisn: '2001' }] });
  assert.equal(c.status, 'error', 'Indra masih di luar, jadi kegiatan baru memang ditolak');
});

test('status & identitas yang dikarang klien diabaikan', () => {
  const s = loadServer();
  const buat = ajukan(s, 'pemberiIzin', {
    status: 'Sedang di Luar', disetujui_oleh: 'Kepala Sekolah', jumlah_peserta: 99,
    diverifikasi_oleh: 'Pak Piket Pagi',
  });
  const kel = s.kelompokRows()[0];
  assert.equal(kel[6], 8, 'jumlah peserta dihitung server, bukan dikirim klien');
  assert.equal(kel[9], 'Pak Anwar');
  assert.equal(kel[12], '', 'belum ada verifikasi, apa pun yang diklaim klien');
  Object.values(s.statusPeserta(buat.id)).forEach((st) => assert.equal(st, 'Menunggu Verifikasi'));
});

test('peserta melebihi batas ditolak sebelum satu baris pun ditulis', () => {
  const s = loadServer();
  const banyak = [];
  for (let i = 0; i < 61; i++) banyak.push({ nisn: 'X' + i });
  const res = ajukan(s, 'wali', { peserta: banyak });
  assert.equal(res.status, 'error');
  assert.match(res.message, /maksimal/i);
  assert.equal(s.izinRows().length, 0);
});

test('Izin Khusus kelompok: hanya petugas berwenang, alasan wajib, ditandai eksplisit', () => {
  const s = loadServer();
  const tolak = ajukan(s, 'pemberiIzin', { jalur: 'khusus', alasan_khusus: 'buru-buru' });
  assert.equal(tolak.status, 'error');
  assert.equal(s.kelompokRows().length, 0);

  const tanpaAlasan = ajukan(s, 'piketPagi', { jalur: 'khusus', alasan_khusus: '  ' });
  assert.equal(tanpaAlasan.status, 'error');
  assert.equal(s.kelompokRows().length, 0);

  const oke = ajukan(s, 'piketPagi', { jalur: 'khusus', alasan_khusus: 'Guru pendamping mendadak tidak bisa dihubungi' });
  assert.equal(oke.status, 'success');
  assert.equal(oke.izinStatus, 'Sedang di Luar', 'jalur khusus = disetujui & diverifikasi sekaligus');
  const kel = s.kelompokRows()[0];
  assert.equal(kel[7], 'khusus');
  assert.equal(kel[8], 'Guru pendamping mendadak tidak bisa dihubungi');
  assert.equal(kel[9], 'Pak Piket Pagi', 'tidak memalsukan persetujuan guru lain');
  s.peserta(oke.id).forEach((p) => {
    assert.equal(p.row[8], 'khusus');
    assert.equal(p.status, 'Sedang di Luar');
  });

  // Alasan pengecualian pada kegiatan NORMAL tidak ikut tersimpan.
  const s2 = loadServer();
  const normal = ajukan(s2, 'wali', { jalur: 'normal', alasan_khusus: 'ini bukan pengecualian' });
  assert.equal(s2.kelompokRows()[0][8], '');
  assert.equal(s2.peserta(normal.id)[0].row[9], '');
});

test('OSIS ditolak di semua aksi kelompok', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  ['addIzinKelompok', 'verifikasiIzinKelompok', 'tandaiKembaliKelompok'].forEach((aksi) => {
    const res = s.post('osis', { action: aksi, id: buat.id, kegiatan: 'X', keperluan: 'Y', tujuan: 'kembali', peserta: [{ nisn: '2001' }], pesertaIds: [] });
    assert.equal(res.status, 'error', aksi);
  });
  assert.equal(s.get('osis', { action: 'getIzinKeluar' }).kelompok, undefined);
});

// ============================================================
// 13. AUDIT TRAIL
// ============================================================

test('jejak kegiatan lengkap di Audit_Log, termasuk pengecualian yang belum kembali', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const semua = s.peserta(buat.id);
  s.post('piketSiang', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: semua.filter((p) => p.name !== 'Deni').map((p) => p.id) });

  const byAksi = (nama) => s.auditRows().find((r) => r[3] === nama);
  const persetujuan = byAksi('Persetujuan Izin Kelompok');
  assert.ok(persetujuan);
  assert.equal(persetujuan[1], 'Bu Kartina');
  assert.match(String(persetujuan[4]), /kegiatan=Seminar Bank Indonesia/);
  assert.match(String(persetujuan[4]), /peserta=8/);
  assert.match(String(persetujuan[4]), /pola=bersama/);
  assert.match(String(persetujuan[4]), /Ahmad/);

  const verifikasi = byAksi('Verifikasi Izin Kelompok');
  assert.equal(verifikasi[1], 'Pak Piket Pagi');
  assert.match(String(verifikasi[4]), /diverifikasi=8/);

  const rombongan = byAksi('Tandai Rombongan Kembali');
  assert.equal(rombongan[1], 'Bu Piket Siang');
  assert.match(String(rombongan[4]), /kembali=7/);
  assert.match(String(rombongan[4]), /belum kembali=1/);
  assert.match(String(rombongan[4]), /Deni/, 'pengecualian harus bisa ditelusuri namanya');
});

test('jalur khusus & tandai pulang punya nama aksi sendiri di Audit_Log', () => {
  const s = loadServer();
  const khusus = ajukan(s, 'piketPagi', { jalur: 'khusus', alasan_khusus: 'kondisi mendesak' });
  const ahmad = s.peserta(khusus.id).find((p) => p.name === 'Ahmad');
  s.post('piketPagi', { action: 'tandaiPulangIzinKeluar', id: ahmad.id });

  const aksi = s.auditRows().map((r) => r[3]);
  assert.ok(aksi.includes('Izin Kelompok Khusus'));
  assert.ok(!aksi.includes('Persetujuan Izin Kelompok'), 'jalur khusus tidak boleh tercatat seperti jalur normal');
  assert.ok(aksi.includes('Tandai Pulang Izin Keluar'));
  assert.match(String(s.auditRows().find((r) => r[3] === 'Izin Kelompok Khusus')[4]), /kondisi mendesak/);
});

test('Audit Log tetap Admin-only', () => {
  const s = loadServer();
  rombonganDiLuar(s);
  assert.equal(s.get('bk', { action: 'getAuditLog' }).status, 'error');
  assert.equal(s.get('piketPagi', { action: 'getAuditLog' }).status, 'error');
  assert.equal(s.get('admin', { action: 'getAuditLog' }).status, 'success');
});

// ============================================================
// 14. INTEGRASI RIWAYAT / CAKUPAN BACA
// ============================================================

test('getIzinKeluar mengirim baris peserta + konteks kegiatannya', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const res = s.get('admin', { action: 'getIzinKeluar' });
  assert.equal(res.izin.length, 8);
  assert.equal(res.kelompok.length, 1);
  assert.equal(res.kelompok[0].kegiatan, 'Seminar Bank Indonesia');
  assert.equal(res.kelompok[0].jumlah_peserta, 8);
  // Nama kegiatan ditempelkan ke tiap peserta saat dikirim (bukan disimpan ulang).
  res.izin.forEach((i) => {
    assert.equal(i.kelompok_id, buat.id);
    assert.equal(i.kegiatan, 'Seminar Bank Indonesia');
  });
  const barisSheet = s.peserta(buat.id)[0].row;
  assert.ok(!barisSheet.includes('Seminar Bank Indonesia'), 'nama kegiatan tidak diduplikasi ke baris siswa');
});

test('kegiatan hanya terkirim ke orang yang boleh melihat pesertanya', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  // Transaksi masih berjalan = terlihat semua guru non-OSIS (aturan yang sudah ada).
  assert.equal(s.get('pemberiIzin', { action: 'getIzinKeluar' }).kelompok.length, 1);

  // Setelah semua peserta ditutup, riwayatnya ikut aturan lama: guru biasa
  // tetap melihatnya HARI INI, tapi kegiatan tanpa peserta yang terlihat tidak
  // pernah ikut terkirim.
  const semua = s.peserta(buat.id);
  s.post('piketPagi', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: semua.map((p) => p.id) });
  const guru = s.get('pemberiIzin', { action: 'getIzinKeluar' });
  assert.equal(guru.kelompok.length, 1, 'masih hari ini, jadi masih terlihat');
  assert.equal(guru.izin.length, 8);
});

test('cache kelompok mentah & global — hasil satu guru tidak bocor ke guru lain', () => {
  const s = loadServer();
  rombonganDiLuar(s);
  const guru = s.get('pemberiIzin', { action: 'getIzinKeluar' });
  const adm = s.get('admin', { action: 'getIzinKeluar' });
  assert.equal(JSON.parse(s.cacheStore.izin_kelompok_raw).length, 1, 'yang di-cache daftar mentah');
  assert.equal(adm.kelompok.length, 1);
  assert.equal(guru.kelompok.length, 1);
});

// ============================================================
// 15. REGRESI
// ============================================================

test('izin INDIVIDUAL tetap bekerja penuh berdampingan dengan kelompok', () => {
  const s = loadServer();
  const kelompok = rombonganDiLuar(s);

  // Alur individual lengkap: setuju -> verifikasi -> kembali (langsung final).
  const individu = s.post('pemberiIzin', { action: 'addIzinKeluar', nisn: '2001', tujuan: 'kembali', keperluan: 'ke puskesmas' });
  assert.equal(individu.izinStatus, 'Menunggu Verifikasi');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: individu.id }).izinStatus, 'Sedang di Luar');
  assert.equal(s.post('piketSiang', { action: 'tandaiKembaliIzinKeluar', id: individu.id }).izinStatus, 'Selesai');

  // Baris individual tidak punya kunci kegiatan, dan rombongan tidak tersentuh.
  const barisIndra = s.izinRows().find((r) => String(r[1]) === '2001');
  assert.equal(String(barisIndra[20] || ''), '');
  Object.values(s.statusPeserta(kelompok.id)).forEach((st) => assert.equal(st, 'Sedang di Luar'));
});

test('aksi izin individual tidak bisa dipakai menembus penjaga kelompok', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  const ahmad = s.peserta(buat.id).find((p) => p.name === 'Ahmad');
  // Peserta yang belum diverifikasi tetap tidak bisa ditandai kembali.
  assert.equal(s.post('piketPagi', { action: 'tandaiKembaliIzinKeluar', id: ahmad.id }).status, 'error');
  // Verifikasi per siswa tetap sah (peserta = baris izin biasa) dan hanya
  // mengubah siswa itu saja.
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: ahmad.id }).izinStatus, 'Sedang di Luar');
  const status = s.statusPeserta(buat.id);
  assert.equal(status['Ahmad'], 'Sedang di Luar');
  assert.equal(Object.values(status).filter((v) => v === 'Menunggu Verifikasi').length, 7);
});

test('Gerbang, Surat & Pelanggaran tidak terpengaruh fitur kelompok', () => {
  const s = loadServer();
  rombonganDiLuar(s);
  assert.equal(s.post('piketPagi', { action: 'record', nisn: '2001', name: 'Indra', class_name: 'X D', type: 'Hujan' }).status, 'success');
  assert.equal(s.post('piketPagi', { action: 'addSurat', nisn: '2001', name: 'Indra', class_name: 'X D', jenis: 'Sakit', keterangan: 'flu' }).status, 'success');
  assert.equal(s.post('piketPagi', { action: 'addPelanggaran', nisn: '2001', name: 'Indra', class_name: 'X D', jenis_pelanggaran: 'Atribut', sanksi: 'Teguran' }).status, 'success');
  assert.equal(s.get('admin', { action: 'getLogs' }).logs.length, 1);
  assert.equal(s.get('admin', { action: 'getSurat' }).surat.length, 1);
  assert.equal(s.get('admin', { action: 'getPelanggaran' }).pelanggaran.length, 1);
});

test('kegiatan & pesertanya tidak bisa diubah/dihapus lewat editEntry/deleteEntry', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const ahmad = s.peserta(buat.id).find((p) => p.name === 'Ahmad');
  ['editEntry', 'deleteEntry'].forEach((aksi) => {
    ['izin', 'kelompok', 'izin_kelompok'].forEach((kategori) => {
      const res = s.post('admin', { action: aksi, category: kategori, nisn: '1001', timestamp: ahmad.row[0], name: 'Ahmad' });
      assert.equal(res.status, 'error', `${aksi}/${kategori}`);
    });
  });
  assert.equal(s.statusPeserta(buat.id)['Ahmad'], 'Sedang di Luar');
});

test('kolom Izin_Keluar lama tidak bergeser — ID_Kelompok ditambahkan di ujung', () => {
  const s = loadServer();
  const lama = [
    'Timestamp', 'NISN', 'Nama', 'Kelas', 'ID_Izin', 'Keperluan', 'Tujuan', 'Status', 'Jalur', 'Alasan_Khusus',
    'Disetujui_Oleh', 'Disetujui_Oleh_ID', 'Waktu_Persetujuan',
    'Diverifikasi_Oleh', 'Diverifikasi_Oleh_ID', 'Waktu_Verifikasi',
    'Waktu_Keluar', 'Waktu_Kembali', 'Dicatat_Kembali_Oleh', 'Dicatat_Kembali_Oleh_ID',
  ];
  const headers = JSON.parse(JSON.stringify(vm.runInContext('IZIN_HEADERS', s.sandbox)));
  assert.deepEqual(headers.slice(0, lama.length), lama, 'urutan kolom lama harus persis sama');
  assert.equal(headers[20], 'ID_Kelompok');
  assert.equal(headers.length, 21);
});

test('penanda versi backend naik & menyebut fitur kelompok', () => {
  const s = loadServer();
  const ping = JSON.parse(vm.runInContext('doGet', s.sandbox)({ parameter: { token: 'TOKEN-OK' } }).text);
  assert.ok(ping.features.includes('izinKelompok'));
  ['exportData', 'scopedLogs', 'adminOnlyAuditLog', 'izinKeluar'].forEach((f) => assert.ok(ping.features.includes(f), f));
});

test('tidak ada sheet/mapping jadwal mengajar yang ikut ditambahkan', () => {
  const src = ['Utils.gs', 'Code.gs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  [/Jadwal_Mengajar/i, /jadwalMengajar/i, /getJadwalMengajar/i].forEach((pola) => {
    assert.doesNotMatch(src, pola, 'tidak boleh ada mekanisme jadwal mengajar: ' + pola);
  });
  assert.match(src, /getSheetByName\('Jadwal_Piket'\)/, 'kewenangan piket tetap dari mekanisme yang sudah ada');
});

// ============================================================
// 20. IZIN KHUSUS KELOMPOK — kewenangan lengkap per role (audit eksplisit)
// ============================================================
// Sama seperti section 19 di izin-keluar.test.js: menutup celah CAKUPAN TEST
// (BK/Admin belum pernah diuji eksplisit sukses lewat addIzinKelompok jalur
// khusus, wali kelas non-piket belum diuji ditolak sebagai skenario
// tersendiri) — TANPA mengubah satu baris implementasi pun. Perilakunya
// sudah benar sejak Izin Kelompok pertama kali dibuat (bukti: canVerifyIzin
// dipakai identik untuk addIzinKeluar & addIzinKelompok, lihat Code.gs).

test('BK/Kesiswaan dapat memberikan Izin Khusus untuk kegiatan kelompok', () => {
  const s = loadServer();
  const res = ajukan(s, 'bk', { jalur: 'khusus', alasan_khusus: 'Guru pendamping berhalangan mendadak' });
  assert.equal(res.status, 'success');
  assert.equal(s.kelompokRows()[0][9], 'Bu BK');
});

test('Admin dapat memberikan Izin Khusus untuk kegiatan kelompok', () => {
  const s = loadServer();
  const res = ajukan(s, 'admin', { jalur: 'khusus', alasan_khusus: 'Guru pendamping berhalangan mendadak' });
  assert.equal(res.status, 'success');
  assert.equal(s.kelompokRows()[0][9], 'Pak Admin');
});

test('wali kelas yang BUKAN piket hari ini ditolak memberikan Izin Khusus untuk kelompok', () => {
  const s = loadServer();
  const res = ajukan(s, 'wali', { jalur: 'khusus', alasan_khusus: 'saya wali kelasnya, biar saya putuskan' });
  assert.equal(res.status, 'error');
  assert.equal(s.kelompokRows().length, 0, 'tidak ada kegiatan yang tersimpan saat ditolak');
});

test('alur kelompok normal tetap berjalan utuh setelah audit Izin Khusus ini (regresi)', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  assert.equal(buat.status, 'success');
  assert.equal(buat.izinStatus, 'Menunggu Verifikasi');
  assert.equal(s.post('piketPagi', { action: 'verifikasiIzinKelompok', id: buat.id }).status, 'success');
});

// ============================================================
// 21. KAPASITAS VERIFIKASI KELOMPOK: "Guru Piket" vs "BK/Kesiswaan"
//
// Sama seperti izin individual (lihat blok audit di izin-keluar.test.js) —
// verifikasiIzinKelompok & tandaiKembaliKelompok memakai gerbang otorisasi
// yang SAMA (izinKapasitasVerifikasi, Utils.gs), jadi bug & perbaikannya
// juga sama: BK/Kesiswaan yang mengambil alih TANPA sedang piket tidak
// boleh tercatat seolah-olah dia Guru Piket.
// ============================================================

test('kelompok: BK/Kesiswaan yang TIDAK piket tetap boleh verifikasi sebagai backup, tercatat BK/Kesiswaan', () => {
  const s = loadServer(); // fixture default: Bu BK (G01) tidak ada di Jadwal_Piket
  const buat = ajukan(s, 'wali');
  const ver = s.post('bk', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.status, 'success', 'BK tetap boleh mengambil alih walau tidak piket');

  const kel = s.get('admin', { action: 'getIzinKeluar' }).kelompok.find((k) => k.id === buat.id);
  assert.equal(kel.diverifikasi_kapasitas, 'bk_kesiswaan', 'TIDAK boleh tercatat guru_piket');

  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Kelompok').pop();
  assert.match(String(aksi[4]), /kapasitas=BK\/Kesiswaan/);
});

test('kelompok: BK/Kesiswaan yang SEDANG piket -> tercatat Guru Piket', () => {
  const s = loadServer({ jadwalPiketRows: [[HARI_INI, 'G10'], [HARI_INI, 'G11'], [HARI_INI, 'G01'], [HARI_LAIN, 'G12']] });
  const buat = ajukan(s, 'wali');
  const ver = s.post('bk', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.status, 'success');

  const kel = s.get('admin', { action: 'getIzinKeluar' }).kelompok.find((k) => k.id === buat.id);
  assert.equal(kel.diverifikasi_kapasitas, 'guru_piket');

  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Verifikasi Izin Kelompok').pop();
  assert.match(String(aksi[4]), /kapasitas=Guru Piket/);
});

test('kelompok: Tandai Rombongan Kembali oleh BK yang tidak piket tercatat BK/Kesiswaan per peserta', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const semua = s.peserta(buat.id);
  const res = s.post('bk', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: semua.map((p) => p.id) });
  assert.equal(res.status, 'success');

  const izinAdmin = s.get('admin', { action: 'getIzinKeluar' }).izin.filter((i) => i.kelompok_id === buat.id);
  assert.equal(izinAdmin.length, 8);
  izinAdmin.forEach((i) => assert.equal(i.dicatat_kembali_kapasitas, 'bk_kesiswaan'));

  const aksi = s.auditRows().filter((r) => String(r[3]) === 'Tandai Rombongan Kembali').pop();
  assert.match(String(aksi[4]), /kapasitas=BK\/Kesiswaan/);
});

test('kelompok: wali kelas yang tidak piket tetap ditolak memverifikasi kegiatan (tidak diperlonggar oleh audit ini)', () => {
  const s = loadServer();
  const buat = ajukan(s, 'wali');
  const ver = s.post('wali', { action: 'verifikasiIzinKelompok', id: buat.id });
  assert.equal(ver.status, 'error');
});

test('kelompok: client mencoba memalsukan kapasitas tetap diabaikan, server yang menentukan', () => {
  const s = loadServer();
  const buat = rombonganDiLuar(s);
  const res = s.post('bk', { action: 'tandaiKembaliKelompok', id: buat.id, pesertaIds: s.peserta(buat.id).map((p) => p.id), kapasitas: 'guru_piket' });
  assert.equal(res.status, 'success');
  const izinAdmin = s.get('admin', { action: 'getIzinKeluar' }).izin.filter((i) => i.kelompok_id === buat.id);
  izinAdmin.forEach((i) => assert.equal(i.dicatat_kembali_kapasitas, 'bk_kesiswaan', 'klaim klien diabaikan'));
});
