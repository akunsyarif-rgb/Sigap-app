'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'surat-izin-html.js'), 'utf8')
  .replace(/^const /gm, 'var '), ctx);
const base = { nomor_surat: 'IK-TEST-001', nama_siswa: 'A <b>', kelas: 'X-1', keperluan: 'Sakit', tujuan: 'Pulang',
  jalur: 'normal', disetujui_oleh: 'Guru', konteks_persetujuan: 'Wali Kelas', waktu_persetujuan: '2026-10-18T00:18:00.000Z',
  diverifikasi_oleh: 'Piket', waktu_verifikasi: '2026-10-18T00:30:00.000Z', waktu_keluar: '2026-10-18T00:30:00.000Z',
  status_izin_label: 'Keluar', tgl_cetak: 'Minggu, 18 Oktober 2026', jam_cetak: '08:40 WITA' };
test('jam dikonversi ke WITA (UTC+8), HTML di-escape', () => {
  const h = ctx.renderIzinKeluarSuratHTML(base);
  assert.match(h, /08:18 WITA/);
  assert.match(h, /A &lt;b&gt;/);
  assert.match(h, /Tarakan, 18 Oktober 2026/);
  assert.match(h, /Pulang \(tidak kembali ke sekolah\)/);
});
test('jalur khusus menampilkan alasan pengecualian', () => {
  const h = ctx.renderIzinKeluarSuratHTML({ ...base, jalur: 'khusus', alasan_khusus: 'Lomba' });
  assert.match(h, /Izin Khusus oleh/);
  assert.match(h, /Lomba/);
});
