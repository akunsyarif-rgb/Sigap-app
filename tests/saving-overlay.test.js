// ===== tests/saving-overlay.test.js =====
// Overlay "Menyimpan..." global (audit UX September 2026) -- SATU indikator
// loading untuk SEMUA aksi tulis (Catat Terlambat/Surat/Pelanggaran/
// Bimbingan/Upacara, Izin Keluar & Kelompok tiap tahap, Hapus di semua tab,
// Kelola Guru & Akun, Ganti Password), menggantikan state saving/busy/
// loading per-tombol yang sebelumnya tersebar di banyak komponen.
//
// isSavingOverlayActive()/showSavingOverlay()/hideSavingOverlay() adalah
// fungsi & variabel MODULE-LEVEL biasa (bukan React Context) yang didefinisikan
// di ui-common.js -- dites di sini sebagai fungsi murni dengan menjalankan
// ui-common.js di vm sandbox minimal (React di-stub SEPERTI render-smoke.test.js).
// Pengkabelan di app.js (showSavingOverlay/hideSavingOverlay dipanggil di
// setiap handler fetch aksi tulis) dites lewat pemeriksaan statis source --
// itu satu-satunya cara memverifikasi TIAP TITIK yang dimaksud "ganti loading
// state jadi overlay global" tanpa menjalankan App() penuh (butuh sesi/data
// lengkap, lihat catatan di render-smoke.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

test('isSavingOverlayActive/showSavingOverlay/hideSavingOverlay: state machine dasar', () => {
  const sandbox = { console, useState: () => [false, () => {}], useEffect: () => {} };
  // Cukup jalankan definisi ui-common.js -- tidak perlu Babel/JSX karena yang
  // diuji di sini murni fungsi non-JSX (isSavingOverlayActive dkk), tapi file
  // ini seluruhnya JSX jadi tetap perlu ditranspile.
  const babel = require('@babel/core');
  const src = fs.readFileSync(path.join(ROOT, 'ui-common.js'), 'utf8');
  const transformed = babel.transformSync(src, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'ui-common.js' });

  const isActive = vm.runInContext('isSavingOverlayActive', sandbox);
  const show = vm.runInContext('showSavingOverlay', sandbox);
  const hide = vm.runInContext('hideSavingOverlay', sandbox);

  assert.equal(isActive(), false, 'default: tidak aktif');
  show();
  assert.equal(isActive(), true, 'setelah show(): aktif');
  hide();
  assert.equal(isActive(), false, 'setelah hide(): tidak aktif lagi');

  // Dipanggil berkali-kali (tap ganda skenario) tidak boleh macet di suatu
  // state -- show()+show()+hide() harus tetap balik ke tidak aktif dengan
  // SATU hide (booleannya tunggal, bukan counter -- lihat catatan di
  // ui-common.js soal kenapa).
  show(); show();
  hide();
  assert.equal(isActive(), false);
});

test('SavingOverlay: null saat tidak aktif, render logo+teks saat aktif -- lewat show()/hide() SUNGGUHAN, bukan dipaksa lewat prop', () => {
  const babel = require('@babel/core');
  const src = fs.readFileSync(path.join(ROOT, 'ui-common.js'), 'utf8');
  const transformed = babel.transformSync(src, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  // Stub React yang MENYIMPAN nilai state antar render (sama pola dengan
  // tests/custom-input.test.js) -- perlu supaya listener yang didaftarkan
  // useEffect pada render pertama benar-benar mengubah apa yang dibaca
  // render berikutnya, meniru siklus render React sungguhan.
  let store = [];
  let stateCallIndex = 0;
  let effectsRan = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => {
      const idx = stateCallIndex++;
      if (!(idx in store)) store[idx] = typeof init === 'function' ? init() : init;
      return [store[idx], (v) => { store[idx] = typeof v === 'function' ? v(store[idx]) : v; }];
    },
    // Efek hanya perlu jalan SEKALI (di "mount" pertama) supaya listener
    // tidak didaftarkan berkali-kali tiap render -- persis semantik React
    // useEffect(fn, []) sungguhan.
    useEffect: (fn) => { if (!effectsRan[0]) { effectsRan[0] = fn(); } },
  };
  const sandbox = { console, React, useState: React.useState, useEffect: React.useEffect };
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'ui-common.js' });

  const SavingOverlay = vm.runInContext('SavingOverlay', sandbox);
  const show = vm.runInContext('showSavingOverlay', sandbox);
  const hide = vm.runInContext('hideSavingOverlay', sandbox);
  const render = () => { stateCallIndex = 0; return SavingOverlay(); };

  const idleTree = render();
  assert.equal(idleTree, null, 'overlay harus null (tidak render apa pun) saat tidak ada aksi tulis berjalan');

  show(); // memicu listener yang didaftarkan useEffect pada render pertama
  const activeTree = render();
  const flat = JSON.stringify(activeTree);
  assert.ok(flat.includes('IMG_1966.jpeg'), 'overlay harus menampilkan logo sekolah yang SUDAH ADA di project (IMG_1966.jpeg), bukan aset baru');
  assert.ok(flat.includes('animate-spin-slow'), 'logo harus berputar lewat class CSS animate-spin-slow (transform murni, bukan GIF)');
  assert.ok(flat.includes('Menyimpan...'), 'teks "Menyimpan..." harus tampil di bawah logo');
  assert.ok(flat.includes('bg-black/30'), 'overlay harus dim ringan (bg-black/30), bukan blur berat');
  assert.ok(!flat.includes('backdrop-blur'), 'overlay TIDAK boleh pakai backdrop-blur (dim ringan saja sesuai desain)');
  assert.match(flat, /z-\[100\]/, 'overlay harus di atas modal biasa (z-50) supaya benar-benar mengunci interaksi');

  hide();
  const idleAgainTree = render();
  assert.equal(idleAgainTree, null, 'overlay harus kembali null setelah hide()');
});

test('app.js: SavingOverlay dipasang sekali di root App()', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const matches = src.match(/<SavingOverlay\s*\/>/g) || [];
  assert.equal(matches.length, 1, 'SavingOverlay harus dipasang TEPAT SEKALI (reusable, bukan diduplikasi per tab)');
});

// Daftar handler aksi TULIS di app.js yang harus memicu overlay global --
// mencakup Catat Terlambat/Surat/Pelanggaran/Bimbingan/Upacara, Izin Keluar
// (semua tahap: buat/verifikasi/tandai kembali/tandai pulang/hapus/cetak
// surat, individual maupun kelompok), Hapus/Edit di Riwayat, Hapus Data
// massal, dan seluruh aksi tulis Kelola Guru & Akun (termasuk yang sudah
// dikerjakan di commit sebelumnya: Nama/Wali Kelas/Password/Role/Jabatan/
// Jadwal Piket/status aktif-nonaktif/tambah/hapus guru) + Ganti Password.
const HANDLERS_HARUS_PAKAI_OVERLAY = [
  'handleChangeMyPassword',
  'handleRecord',
  'handleAddTeacher',
  'handleUpdatePassword',
  'handleUpdateJabatan',
  'handleToggleStatus',
  'handleUpdateRole',
  'handleUpdateWaliKelas',
  'handleUpdateTeacherName',
  'handleDeleteTeacher',
  'handleSetJadwalPiket',
  'handleAjukanTindakLanjut',
  'handleApproveTindakLanjut',
  'handleAddSurat',
  'handleHapusData',
  'handleAddPelanggaran',
  'handleAddPelanggaranKelompok',
  'handleAddBimbingan',
  'handleEditEntry',
  'handleDeleteEntry',
  'handleAddUpacara',
  'handleCreateIzin',
  'handleIzinAction', // jalur bersama verifikasi/tandaiKembali/tandaiPulang/hapus izin individual
  'handleGenerateIzinSurat',
  'handleCreateKelompok',
  'handleVerifikasiKelompok',
  'handleTandaiKembaliKelompok',
];

test('app.js: setiap handler aksi tulis memanggil showSavingOverlay() sebelum fetch dan hideSavingOverlay() lewat .finally()', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  HANDLERS_HARUS_PAKAI_OVERLAY.forEach((nama) => {
    const marker = `const ${nama} = (`;
    const idx = src.indexOf(marker);
    assert.ok(idx !== -1, `${nama} harus ditemukan di app.js`);
    // Ambil potongan dari deklarasi handler sampai penutup `};` fungsi arrow
    // berikutnya yang sejajar -- cukup ambil beberapa ribu karakter, handler
    // di file ini semuanya pendek (di bawah itu).
    const potongan = src.slice(idx, idx + 3500);
    const akhirFungsi = potongan.indexOf('\n           };');
    const isiFungsi = akhirFungsi !== -1 ? potongan.slice(0, akhirFungsi) : potongan;
    assert.match(isiFungsi, /isSavingOverlayActive\(\)/, `${nama} harus dijaga isSavingOverlayActive() supaya tap ganda tidak mengirim 2 request`);
    assert.match(isiFungsi, /showSavingOverlay\(\)/, `${nama} harus memanggil showSavingOverlay() sebelum fetch`);
    const setelahFinally = isiFungsi.slice(isiFungsi.lastIndexOf('.finally('));
    assert.notEqual(isiFungsi.lastIndexOf('.finally('), -1, `${nama} harus punya .finally() di ujung rantai fetch`);
    assert.match(setelahFinally, /hideSavingOverlay\(\)/, `${nama} harus memanggil hideSavingOverlay() di dalam .finally() (jalan baik sukses MAUPUN gagal)`);
  });
});

// handlePreviewHapusData (pratinjau BACA-saja) dan handleExportData (generate
// laporan, sudah punya indikator "Membuat/Menyiapkan laporan..." sendiri di
// export-data.js) SENGAJA TIDAK dipasangi overlay "Menyimpan..." -- keduanya
// bukan aksi menyimpan data, jadi teks "Menyimpan..." akan menyesatkan.
test('app.js: handlePreviewHapusData & handleExportData SENGAJA tidak pakai overlay (bukan aksi menyimpan)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ['handlePreviewHapusData', 'handleExportData'].forEach((nama) => {
    const marker = `const ${nama} = (`;
    const idx = src.indexOf(marker);
    assert.ok(idx !== -1, `${nama} harus ditemukan di app.js`);
    const potongan = src.slice(idx, idx + 2000);
    const akhirFungsi = potongan.indexOf('\n           };');
    const isiFungsi = akhirFungsi !== -1 ? potongan.slice(0, akhirFungsi) : potongan;
    assert.doesNotMatch(isiFungsi, /showSavingOverlay\(\)/, `${nama} adalah pembacaan/laporan, bukan aksi menyimpan -- tidak boleh memicu overlay "Menyimpan..."`);
  });
});

test('index.html: keyframe animate-spin-slow ada, dihormati prefers-reduced-motion', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /@keyframes spinSlow/);
  assert.match(html, /\.animate-spin-slow\s*\{\s*animation:\s*spinSlow/);
  const reducedMotionBlock = html.split('@media (prefers-reduced-motion: reduce)')[1].split('}')[0];
  assert.match(reducedMotionBlock, /animate-spin-slow/, 'animasi logo harus dimatikan juga untuk prefers-reduced-motion');
});

test('gerbang.js/admin.js/pelanggaran-bimbingan-upacara.js/beranda-riwayat.js: teks loading per-tombol lama (selain overlay) sudah tidak ada', () => {
  const files = ['gerbang.js', 'admin.js', 'pelanggaran-bimbingan-upacara.js', 'beranda-riwayat.js', 'ui-common.js'];
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /'Memproses\.\.\.'/, `${f}: teks "Memproses..." per-tombol lama harus sudah diganti overlay global`);
  });
  // "Menyimpan..." literal HANYA boleh muncul di ui-common.js (di dalam
  // SavingOverlay) -- file lain cuma boleh menyebutnya di KOMENTAR.
  files.filter((f) => f !== 'ui-common.js').forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const kodeSaja = src.replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(kodeSaja, /Menyimpan\.\.\./, `${f}: teks "Menyimpan..." literal di JSX harus sudah dipindah ke overlay global, bukan diulang per-tombol`);
  });
});
