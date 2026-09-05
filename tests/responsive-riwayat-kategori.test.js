// ===== tests/responsive-riwayat-kategori.test.js =====
// Audit UX 360-480px (persiapan lomba inovasi, September 2026): switcher
// kategori Riwayat (LogTab, di beranda-riwayat.js) memakai grid-cols-4 untuk
// 4 label ("Terlambat"/"Pelanggaran"/"Surat"/"Izin Keluar") -- persis bug
// yang sudah didokumentasikan & diperbaiki lebih dulu untuk DashboardTab (di
// file yang sama, ganti ke grid 2x2) karena label sekata seperti
// "Pelanggaran" nyaris tidak muat di kolom ke-4 pada layar 360-375px. Test
// ini murni statis (grep sumber) -- tidak ada renderer viewport sungguhan di
// test suite ini (lihat render-smoke.test.js), jadi verifikasi visual di
// browser/perangkat nyata tetap perlu dilakukan manual sebelum rilis.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');

function functionBody(src, fnName) {
  const start = src.indexOf(`function ${fnName}(`);
  assert.ok(start !== -1, `fungsi ${fnName} tidak ditemukan`);
  // Potong sampai fungsi TOP-LEVEL berikutnya dimulai (cukup untuk file ini,
  // yang tiap fungsi komponennya dideklarasikan di kolom yang sama).
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {7}function \w+\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

test('LogTab: switcher kategori Riwayat pakai grid-cols-2 (2x2), bukan grid-cols-4', () => {
  const body = functionBody(source, 'LogTab');
  assert.doesNotMatch(body, /grid-cols-4/,
    'grid-cols-4 untuk switcher kategori berisiko memotong label sekata ("Pelanggaran"/"Izin Keluar") di layar 360-375px');
  assert.match(body, /grid grid-cols-2 gap-1\.5 bg-white border border-slate-200 rounded-2xl p-1\.5/,
    'switcher kategori LogTab harus 2x2, konsisten dengan perbaikan yang sama di DashboardTab');
});

test('DashboardTab: kartu ringkasan 2x2 tidak ikut berubah (regresi)', () => {
  const body = functionBody(source, 'DashboardTab');
  assert.match(body, /grid grid-cols-2 gap-2\.5/, 'DashboardTab harus tetap 2x2 seperti sebelumnya');
  assert.doesNotMatch(body, /grid-cols-4/);
});

test('Semua 4 kategori (Terlambat/Pelanggaran/Surat/Izin Keluar) tetap ada di LogTab setelah perubahan layout', () => {
  const body = functionBody(source, 'LogTab');
  ['Terlambat', 'Pelanggaran', 'Surat', 'Izin Keluar'].forEach((label) => {
    assert.match(body, new RegExp(label.replace(' ', '\\s')), `kategori "${label}" harus tetap ada, layout berubah tapi isi tidak boleh hilang`);
  });
});
