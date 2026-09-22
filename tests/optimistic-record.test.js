// ===== tests/optimistic-record.test.js =====
// Optimistic update untuk handleRecord (app.js) -- audit kecepatan September
// 2026 (lihat CLAUDE.md/laporan Fase 1: action 'record' butuh ~10 panggilan
// Sheets/Cache API berurutan di dalam satu lock, jadi menunggu fetch selesai
// sebelum allLogs di-update artinya guru menatap overlay lebih lama dari yang
// perlu SEKADAR untuk melihat entry-nya masuk daftar).
//
// App() sendiri TIDAK dirender di sini -- butuh session/data lengkap yang
// belum ada harness-nya di test suite ini (sama alasan seperti catatan di
// push-frontend.test.js soal NotifikasiTab/App()). Ini pemeriksaan STATIS
// atas urutan & bentuk kode di app.js, yang tetap gagal-merah kalau urutan
// optimistic-add/replace/rollback berubah atau hilang -- pola yang sama
// dipakai saving-overlay.test.js untuk memverifikasi pengkabelan handler
// tanpa harus me-render App() penuh.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const marker = 'const handleRecord = (';
const idx = src.indexOf(marker);
const potongan = src.slice(idx, idx + 3500);
const akhirFungsi = potongan.indexOf('\n           };');
const handleRecordSrc = akhirFungsi !== -1 ? potongan.slice(0, akhirFungsi) : potongan;

test('app.js: handleRecord ditemukan', () => {
  assert.notEqual(idx, -1, 'handleRecord harus ada di app.js');
  assert.notEqual(akhirFungsi, -1, 'batas akhir fungsi handleRecord harus ketemu dalam jendela pencarian');
});

test('handleRecord: entry optimistic ditambah ke allLogs SEBELUM fetch dikirim, ditandai _optimisticId', () => {
  const fetchIdx = handleRecordSrc.indexOf('fetch(API_URL');
  const optimisticAddIdx = handleRecordSrc.indexOf('setAllLogs(prev => [optimisticEntry, ...prev])');
  assert.notEqual(optimisticAddIdx, -1, 'harus ada setAllLogs yang menambah optimisticEntry di depan daftar');
  assert.notEqual(fetchIdx, -1, 'harus ada pemanggilan fetch(API_URL...)');
  assert.ok(optimisticAddIdx < fetchIdx, 'penambahan entry optimistic harus terjadi SEBELUM fetch dikirim, bukan sesudah respons datang');
  assert.match(handleRecordSrc, /_optimisticId:\s*optimisticId/, 'optimisticEntry harus ditandai _optimisticId supaya bisa ditemukan lagi persis saat replace/rollback');
});

test('handleRecord: entry optimistic DIGANTI (bukan ditambah lagi) saat server sukses, pakai timestamp dari server', () => {
  assert.match(
    handleRecordSrc,
    /setAllLogs\(prev => prev\.map\(item => item\._optimisticId === optimisticId \? newEntry : item\)\)/,
    'saat sukses, entry optimistic harus diganti lewat .map() yang mencocokkan _optimisticId -- bukan appendRow (setAllLogs(prev => [newEntry, ...prev])) yang bikin dobel'
  );
  // Regresi lama (record-then-delete-timestamp.test.js): timestamp entry
  // pengganti harus dari respons server (data.timestamp), bukan Date() client.
  assert.match(handleRecordSrc, /timestamp:\s*data\.timestamp\s*\|\|\s*new Date\(\)/, 'entry pengganti (sukses) harus pakai timestamp dari server, sama seperti sebelum optimistic update ditambahkan');
});

test('handleRecord: rollback (hapus entry optimistic) saat server menolak (mis. duplikat)', () => {
  // Ambil potongan cabang else (server menjawab tapi status != success).
  const successIdx = handleRecordSrc.indexOf("data.status === 'success'");
  const elseIdx = handleRecordSrc.indexOf('} else {', successIdx);
  const catchIdx = handleRecordSrc.indexOf('.catch(');
  assert.notEqual(successIdx, -1);
  assert.notEqual(elseIdx, -1);
  const elseBranch = handleRecordSrc.slice(elseIdx, catchIdx);
  assert.match(
    elseBranch,
    /setAllLogs\(prev => prev\.filter\(item => item\._optimisticId !== optimisticId\)\)/,
    'cabang gagal (server menolak) harus membuang entry optimistic lewat .filter(), bukan membiarkannya nyangkut di daftar'
  );
});

test('handleRecord: rollback juga terjadi saat koneksi gagal/timeout (.catch)', () => {
  const catchIdx = handleRecordSrc.indexOf('.catch(');
  const finallyIdx = handleRecordSrc.indexOf('.finally(');
  assert.notEqual(catchIdx, -1, 'harus ada .catch() untuk koneksi gagal/timeout');
  assert.notEqual(finallyIdx, -1, 'harus ada .finally() di ujung rantai fetch');
  const catchBranch = handleRecordSrc.slice(catchIdx, finallyIdx);
  assert.match(
    catchBranch,
    /setAllLogs\(prev => prev\.filter\(item => item\._optimisticId !== optimisticId\)\)/,
    '.catch() (network gagal/AbortError) harus ikut membuang entry optimistic -- server tidak pernah mengonfirmasi, entry tidak boleh dianggap tersimpan'
  );
});

test('handleRecord: SavingOverlay TIDAK disentuh oleh perubahan ini -- showSavingOverlay sebelum fetch, hideSavingOverlay di .finally()', () => {
  // Regresi generik ini sudah dipin tests/saving-overlay.test.js untuk semua
  // handler tulis (termasuk handleRecord) -- diulang di sini secara sempit
  // supaya PR yang menyentuh optimistic update tidak diam-diam menghapus
  // overlay-nya sambil lolos test lain.
  const showIdx = handleRecordSrc.indexOf('showSavingOverlay()');
  const fetchIdx = handleRecordSrc.indexOf('fetch(API_URL');
  assert.notEqual(showIdx, -1);
  assert.ok(showIdx < fetchIdx, 'showSavingOverlay() harus tetap dipanggil sebelum fetch, persis seperti sebelum optimistic update ditambahkan');
  assert.match(handleRecordSrc, /\.finally\(\(\) => \{ clearTimeout\(timeoutId\); hideSavingOverlay\(\); \}\)/, 'hideSavingOverlay() harus tetap di .finally(), tidak dipindah ke cabang sukses saja');
});
