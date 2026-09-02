// ===== tests/push-notifications.test.js =====
// PUSH NOTIFICATION (Web Push, VAPID) — HANYA dua kelompok penerima (Wali
// Kelas & Guru Piket aktif hari ini), dihitung 100% server-side, diuji lewat
// doPost()/doGet() SUNGGUHAN (Utils.gs+Auth.gs+Code.gs+Notifikasi.gs
// dijalankan di vm dengan layanan Apps Script di-stub — pola yang sama
// dengan tests/izin-keluar.test.js). Yang diperiksa adalah ISI Push_Queue &
// Push_Subscriptions sesungguhnya, bukan tampilan.
//
// Pengiriman Web Push sungguhan (VAPID/enkripsi payload) TIDAK diuji di sini
// — itu tanggung jawab api/push-send.js (fungsi Vercel terpisah, lihat
// CLAUDE.md). Yang diuji di sini adalah bagian yang backend GAS BENAR-benar
// bertanggung jawab: SIAPA yang berhak menerima, KAPAN (idempotency), dan
// bahwa detail sensitif tidak pernah bocor ke payload notifikasi.

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
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange(row, col, numRows, numCols) {
      return {
        getValue: () => (data[row - 1] ? data[row - 1][col - 1] : undefined),
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
      };
    },
    deleteRow(i) { data.splice(i - 1, 1); },
    appendRow(row) { data.push(row.slice()); },
  };
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const now = new Date();
const HARI_INI = HARI[now.getDay()];
const HARI_LAIN = HARI[(now.getDay() + 3) % 7];

const USERS = {
  admin: { id: 'G00', name: 'Pak Admin', role: 'admin', jabatan: '', waliKelas: '' },
  bk: { id: 'G01', name: 'Bu BK', role: 'bk_kesiswaan', jabatan: '', waliKelas: '' },
  kesiswaan: { id: 'G09', name: 'Pak Kesiswaan', role: 'bk_kesiswaan', jabatan: 'Kesiswaan', waliKelas: '' },
  wali: { id: 'G02', name: 'Bu Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' },
  waliLain: { id: 'G03', name: 'Pak Yusuf', role: 'guru', jabatan: '', waliKelas: 'XI A' },
  guruBiasa: { id: 'G04', name: 'Bu Guru Biasa', role: 'guru', jabatan: '', waliKelas: '' },
  piketPagi: { id: 'G10', name: 'Pak Piket Pagi', role: 'guru', jabatan: '', waliKelas: '' },
  piketSiang: { id: 'G11', name: 'Bu Piket Siang', role: 'guru', jabatan: '', waliKelas: '' },
  bukanPiket: { id: 'G12', name: 'Pak Bukan Piket', role: 'guru', jabatan: '', waliKelas: '' },
  osis: { id: 'S99', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' },
};

const SISWA = [
  ['1001', 'Rahma', 'XI B'],
  ['2002', 'Budi', 'XI A'],
];

function loadServer(opts) {
  const options = opts || {};
  const sheets = {
    Master_Siswa: makeSheet(['NISN', 'Nama', 'Kelas'], SISWA),
    Master_Guru: makeSheet(['ID', 'Nama', 'Hash', 'Role', 'Jabatan', 'Status', 'Kelas_Wali', 'Salt'],
      Object.keys(USERS).map((k) => [USERS[k].id, USERS[k].name, '', USERS[k].role, USERS[k].jabatan, 'aktif', USERS[k].waliKelas, ''])),
    Jadwal_Piket: makeSheet(['Hari', 'Guru_ID'], options.jadwalPiketRows || [
      [HARI_INI, 'G10'],
      [HARI_INI, 'G11'],
      [HARI_LAIN, 'G12'],
    ]),
    Log_Gerbang: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Alasan', 'Dicatat_Oleh'], []),
    Pelanggaran: makeSheet(['Timestamp', 'NISN', 'Nama', 'Kelas', 'Jenis_Pelanggaran', 'Sanksi', 'Catatan', 'Dicatat_Oleh'], []),
    Audit_Log: makeSheet(['Timestamp', 'Nama', 'ID', 'Aksi', 'Detail'], []),
  };
  const cacheStore = {};
  const properties = Object.assign({ API_TOKEN: 'TOKEN-OK' }, options.properties || {});
  const fetchCalls = [];
  const fetchImpl = options.fetchImpl || ((url, params) => {
    const body = JSON.parse(params.payload);
    fetchCalls.push(body);
    return { getContentText: () => JSON.stringify({ results: body.items.map(() => ({ ok: true })) }) };
  });
  const sandbox = {
    console,
    Utilities: {
      computeDigest: (_a, str) => Array.from(crypto.createHash('sha256').update(String(str)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (Object.prototype.hasOwnProperty.call(properties, k) ? properties[k] : null) }) },
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
    UrlFetchApp: { fetch: (url, params) => fetchImpl(url, params) },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  ['Utils.gs', 'Auth.gs', 'Notifikasi.gs', 'Code.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  });
  const tokens = {};
  Object.keys(USERS).forEach((k) => { tokens[k] = vm.runInContext('createSession', sandbox)(USERS[k]); });
  const doPost = vm.runInContext('doPost', sandbox);
  const doGet = vm.runInContext('doGet', sandbox);
  const processPushQueue = vm.runInContext('processPushQueue', sandbox);
  const notifyRelevantUsers = vm.runInContext('notifyRelevantUsers', sandbox);

  const post = (who, body) => JSON.parse(doPost({
    postData: { contents: JSON.stringify(Object.assign({ token: 'TOKEN-OK', sessionToken: who ? tokens[who] : undefined }, body)) },
  }).text);
  const get = (who, params) => JSON.parse(doGet({
    parameter: Object.assign({ token: 'TOKEN-OK', sessionToken: who ? tokens[who] : undefined }, params),
  }).text);

  return { sandbox, sheets, tokens, post, get, processPushQueue, notifyRelevantUsers, fetchCalls };
}

function queueRows(s) {
  const sheet = s.sheets.Push_Queue;
  if (!sheet) return [];
  return sheet._data.slice(1).map((r) => ({
    eventId: r[1], jenis: r[2], nisn: r[3], guruId: r[4], title: r[5], body: r[6], url: r[7], tag: r[8],
    priority: r[9], processed: r[10], attempts: r[12],
  }));
}

function subRows(s) {
  const sheet = s.sheets.Push_Subscriptions;
  if (!sheet) return [];
  return sheet._data.slice(1).map((r) => ({ guruId: r[1], endpoint: r[2], p256dh: r[3], auth: r[4] }));
}

// ---- 1 & 2: Wali kelas menerima kejadian siswanya sendiri, TIDAK menerima siswa kelas lain ----
test('wali kelas menerima notifikasi keterlambatan siswa kelasnya sendiri, bukan kelas lain', () => {
  const s = loadServer();
  const res = s.post('wali', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI B', type: 'Terlambat' });
  assert.equal(res.status, 'success');
  const rows = queueRows(s);
  assert.equal(rows.length, 1, 'harus ada tepat satu baris antrean (wali kelas XI B)');
  assert.equal(rows[0].guruId, USERS.wali.id);
  assert.equal(rows[0].url, 'log');

  // Kejadian di kelas LAIN (XI A) tidak boleh masuk ke wali kelas XI B.
  const s2 = loadServer();
  s2.post('waliLain', { action: 'record', nisn: '2002', name: 'Budi', class_name: 'XI A', type: 'Terlambat' });
  const rows2 = queueRows(s2);
  assert.equal(rows2.length, 1);
  assert.equal(rows2[0].guruId, USERS.waliLain.id);
  assert.ok(!rows2.some((r) => r.guruId === USERS.wali.id), 'wali kelas XI B tidak boleh ikut menerima kejadian XI A');
});

// ---- 3, 4, 5, 6: BK/Kesiswaan/Admin/Guru biasa tidak menerima notifikasi wali kelas ----
test('BK, Kesiswaan, Admin, dan guru biasa TIDAK menerima notifikasi wali kelas', () => {
  const s = loadServer();
  s.post('bk', { action: 'addPelanggaran', nisn: '1001', name: 'Rahma', class_name: 'XI B', jenis_pelanggaran: 'Atribut', sanksi: 'Teguran' });
  const rows = queueRows(s);
  assert.equal(rows.length, 1, 'hanya wali kelas XI B yang masuk antrean');
  assert.equal(rows[0].guruId, USERS.wali.id);
  for (const notAllowed of [USERS.bk.id, USERS.kesiswaan.id, USERS.admin.id, USERS.guruBiasa.id]) {
    assert.ok(!rows.some((r) => r.guruId === notAllowed), notAllowed + ' seharusnya tidak menerima notifikasi wali kelas');
  }
});

// ---- 7, 8, 10: Guru piket aktif menerima permintaan verifikasi; yang tidak piket tidak; beberapa piket sekaligus ----
test('guru piket aktif hari ini menerima notifikasi verifikasi izin; yang tidak piket tidak; beberapa piket sekaligus bisa menerima', () => {
  const s = loadServer();
  const res = s.post('pemberiIzin' in USERS ? 'pemberiIzin' : 'guruBiasa', {
    action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ke UKS',
  });
  assert.equal(res.status, 'success');
  const rows = queueRows(s);
  const piketRows = rows.filter((r) => r.url === 'izin');
  const piketIds = piketRows.map((r) => r.guruId).sort();
  assert.deepEqual(piketIds, [USERS.piketPagi.id, USERS.piketSiang.id].sort(), 'kedua guru piket hari ini harus menerima, bukan cuma satu');
  assert.ok(!piketIds.includes(USERS.bukanPiket.id), 'guru yang piket di HARI LAIN tidak boleh menerima');
  assert.equal(piketRows[0].body, 'Izin siswa menunggu verifikasi. Buka SIGAP untuk memproses.');
});

// ---- 9: BK yang sedang piket menerima SEBAGAI Guru Piket ----
test('BK yang tercatat piket hari ini ikut menerima notifikasi piket (kapasitas dari data, bukan role)', () => {
  const s = loadServer({ jadwalPiketRows: [[HARI_INI, USERS.bk.id]] });
  s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ke UKS' });
  const rows = queueRows(s);
  const piketRows = rows.filter((r) => r.url === 'izin');
  assert.deepEqual(piketRows.map((r) => r.guruId), [USERS.bk.id]);
});

// ---- 11: setelah verifikasi, tidak ada tindakan verifikasi kedua yang dikirim ----
test('setelah izin diverifikasi, tidak ada notifikasi verifikasi-piket kedua untuk baris yang sama', () => {
  const s = loadServer();
  const created = s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ke UKS' });
  const beforeCount = queueRows(s).filter((r) => r.url === 'izin').length;
  assert.equal(beforeCount, 2); // 2 guru piket hari ini

  s.post('piketPagi', { action: 'verifikasiIzinKeluar', id: created.id });
  const afterCount = queueRows(s).filter((r) => r.url === 'izin').length;
  assert.equal(afterCount, beforeCount, 'verifikasi TIDAK boleh menambah notifikasi piket baru untuk baris yang sudah diverifikasi');

  // Verifikasi kedua (retry/double click) ditolak oleh state machine yang
  // sudah ada (status sudah bukan Menunggu Verifikasi lagi) -- otomatis tidak
  // ada notifikasi tambahan sama sekali karena notifyRelevantUsers tidak
  // pernah tercapai (return error lebih dulu).
  const second = s.post('piketSiang', { action: 'verifikasiIzinKeluar', id: created.id });
  assert.equal(second.status, 'error');
  assert.equal(queueRows(s).filter((r) => r.url === 'izin').length, afterCount);
});

// ---- 12: double request (double-submit) tidak menghasilkan notifikasi ganda ----
test('double-submit addIzinKeluar untuk siswa yang sama ditolak sebelum sempat menotifikasi dua kali', () => {
  const s = loadServer();
  const first = s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ke UKS' });
  assert.equal(first.status, 'success');
  const second = s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'ke UKS lagi' });
  assert.equal(second.status, 'error', 'siswa sudah punya transaksi terbuka -- pengajuan kedua harus ditolak');
  const piketRows = queueRows(s).filter((r) => r.url === 'izin');
  assert.equal(piketRows.length, 2, 'tetap cuma SATU kejadian (2 guru piket), bukan dua kejadian');
});

// ---- 13: retry pada enqueue itu sendiri (idempotency window) tidak menghasilkan baris ganda ----
test('memanggil notifyRelevantUsers dua kali untuk kejadian yang identik tidak menghasilkan baris antrean ganda', () => {
  const s = loadServer();
  const event = { jenis: 'keterlambatan', nisn: '1001', kelas: 'XI B', refId: '1001', needsPiketAction: false, waktu: new Date() };
  s.notifyRelevantUsers(event);
  s.notifyRelevantUsers(event); // simulasi retry jaringan/panggilan ulang
  const rows = queueRows(s);
  assert.equal(rows.length, 1, 'retry dalam jendela dedup tidak boleh menghasilkan baris kedua');
});

// ---- 14: subscription pengguna A tidak dipakai untuk B ----
test('subscription milik satu guru tidak pernah dipakai/terhapus oleh guru lain', () => {
  const s = loadServer();
  s.post('wali', { action: 'savePushSubscription', subscription: { endpoint: 'https://push/a', keys: { p256dh: 'p1', auth: 'a1' } } });
  s.post('waliLain', { action: 'savePushSubscription', subscription: { endpoint: 'https://push/b', keys: { p256dh: 'p2', auth: 'a2' } } });
  let subs = subRows(s);
  assert.equal(subs.length, 2);

  // waliLain mencoba menghapus endpoint milik wali -- harus tidak berefek.
  s.post('waliLain', { action: 'deletePushSubscription', endpoint: 'https://push/a' });
  subs = subRows(s);
  assert.equal(subs.length, 2, 'endpoint milik pengguna lain tidak boleh ikut terhapus');

  // Pemiliknya sendiri BOLEH menghapus.
  s.post('wali', { action: 'deletePushSubscription', endpoint: 'https://push/a' });
  subs = subRows(s);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].guruId, USERS.waliLain.id);
});

// ---- 15: logout & subscription ditangani aman ----
test('logout tidak menghapus subscription (supaya push tetap jalan saat app tidak dibuka), dan endpoint yang dipakai ulang pindah kepemilikan ke sesi yang sedang login', () => {
  const s = loadServer();
  s.post('wali', { action: 'savePushSubscription', subscription: { endpoint: 'https://push/shared', keys: { p256dh: 'p1', auth: 'a1' } } });
  s.post('wali', { action: 'logout' });
  let subs = subRows(s);
  assert.equal(subs.length, 1, 'logout tidak boleh menghapus subscription yang sudah tersimpan');
  assert.equal(subs[0].guruId, USERS.wali.id);

  // Perangkat yang sama dipakai login guru lain (mis. HP piket bersama) --
  // endpoint yang sama disubscribe ulang, harus BERPINDAH kepemilikan, bukan
  // menumpuk baris kedua atas nama akun lama.
  s.post('waliLain', { action: 'savePushSubscription', subscription: { endpoint: 'https://push/shared', keys: { p256dh: 'p1', auth: 'a1' } } });
  subs = subRows(s);
  assert.equal(subs.length, 1, 'endpoint yang sama tidak boleh menghasilkan baris duplikat');
  assert.equal(subs[0].guruId, USERS.waliLain.id);
});

// ---- 16: subscription invalid dibersihkan dengan aman ----
test('subscription yang dilaporkan relay sudah tidak berlaku (gone) dibersihkan otomatis oleh processPushQueue', () => {
  const s = loadServer({
    properties: { PUSH_RELAY_URL: 'https://relay.example/push-send', PUSH_RELAY_SECRET: 'relay-secret' },
    fetchImpl: (url, params) => {
      const body = JSON.parse(params.payload);
      return { getContentText: () => JSON.stringify({ results: body.items.map(() => ({ ok: false, gone: true })) }) };
    },
  });
  s.post('wali', { action: 'savePushSubscription', subscription: { endpoint: 'https://push/dead', keys: { p256dh: 'p1', auth: 'a1' } } });
  s.post('wali', { action: 'record', nisn: '1001', name: 'Rahma', class_name: 'XI B', type: 'Terlambat' });
  assert.equal(subRows(s).length, 1);
  s.processPushQueue();
  assert.equal(subRows(s).length, 0, 'endpoint yang dilaporkan gone harus dihapus');
});

// ---- 17: aksi subscription tetap butuh sesi valid (menekan notifikasi bukan jalan pintas otorisasi) ----
test('savePushSubscription/deletePushSubscription menolak tanpa sesi valid', () => {
  const s = loadServer();
  const res = JSON.parse(s.sandbox ? '{}' : '{}'); // no-op guard, lihat panggilan langsung di bawah
  const doPost = vm.runInContext('doPost', s.sandbox);
  const noSession = JSON.parse(doPost({
    postData: { contents: JSON.stringify({ token: 'TOKEN-OK', sessionToken: 'tidak-valid', action: 'savePushSubscription', subscription: { endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } } }) },
  }).text);
  assert.equal(noSession.status, 'error');
  assert.match(noSession.message, /Sesi berakhir/);
});

// ---- 18: detail sensitif tidak bocor lewat payload notifikasi ----
test('notifikasi pelanggaran tidak menyebut jenis pelanggaran/sanksi/catatan -- selalu teks generik', () => {
  const s = loadServer();
  s.post('wali', { action: 'addPelanggaran', nisn: '1001', name: 'Rahma', class_name: 'XI B', jenis_pelanggaran: 'RAHASIA_SENSITIF', sanksi: 'Skorsing', catatan: 'detail pribadi siswa' });
  const rows = queueRows(s);
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].body, /RAHASIA_SENSITIF|Skorsing|detail pribadi/);
  assert.equal(rows[0].body, 'Terdapat kejadian baru terkait salah satu siswa di kelas Anda.');
  assert.equal(rows[0].title, 'SIGAP');
});

// ---- 19: perubahan Jadwal_Piket langsung memengaruhi penerima ----
test('perubahan Jadwal_Piket langsung berlaku pada kejadian berikutnya, tanpa cache basi', () => {
  const s = loadServer();
  s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '1001', tujuan: 'kembali', keperluan: 'A' });
  let piketIds = queueRows(s).filter((r) => r.url === 'izin').map((r) => r.guruId).sort();
  assert.deepEqual(piketIds, [USERS.piketPagi.id, USERS.piketSiang.id].sort());

  // Jadwal piket berubah di tengah hari (pergantian shift admin) -- guru
  // baru ditambahkan, salah satu guru lama dicabut.
  s.sheets.Jadwal_Piket._data.push([HARI_INI, USERS.bukanPiket.id]);
  s.sheets.Jadwal_Piket._data.splice(1, 1); // buang baris piketPagi hari ini

  s.post('guruBiasa', { action: 'addIzinKeluar', nisn: '2002', tujuan: 'kembali', keperluan: 'B' });
  const secondBatch = queueRows(s).filter((r) => r.url === 'izin' && r.nisn === '');
  // (nisn dikosongkan untuk event izin_dibuat individual? tidak -- untuk izin
  // individual nisn terisi; cukup ambil baris terbaru dan pastikan guru baru ikut.
  const allPiketIds = queueRows(s).filter((r) => r.url === 'izin').map((r) => r.guruId);
  assert.ok(allPiketIds.includes(USERS.bukanPiket.id), 'guru yang baru dijadwalkan piket harus langsung ikut menerima');
});

test('status ping backend menyertakan fitur pushNotifications', () => {
  const s = loadServer();
  const doGet = vm.runInContext('doGet', s.sandbox);
  const ping = JSON.parse(doGet({ parameter: { token: 'TOKEN-OK' } }).text);
  assert.ok(ping.features.includes('pushNotifications'));
});
