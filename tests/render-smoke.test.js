// ===== tests/render-smoke.test.js =====
// SIGAP tidak pakai bundler/build step (sengaja — lihat komentar di
// index.html) — jadi tidak ada cara "normal" untuk tes komponen React-nya.
// Test ini menggabungkan 10 file .js persis seperti index.html memuatnya di
// browser sungguhan, transpile dengan Babel (sama seperti runtime), lalu
// jalankan tiap fungsi komponen dengan props contoh di sandbox vm minimal
// (bukan renderer sungguhan — cukup untuk menjalankan SEMUA baris kode di
// badan fungsi sebelum `return (<jsx>)`, tempat bug nyata biasanya muncul:
// nama field API yang berubah, variabel yang seharusnya array tapi
// undefined, dst). Kalau salah satu case ini gagal, kemungkinan besar
// aplikasi sungguhan akan menampilkan layar "Ada yang salah" (ErrorBoundary)
// untuk skenario itu.
//
// Butuh devDependency @babel/core & @babel/preset-react — jalankan
// `npm install` sekali sebelum `npm test` / `node --test tests/`. Ini
// TIDAK memengaruhi cara aplikasi di-deploy (index.html tetap tanpa build
// step di production, lihat komentar di sana) — cuma dipakai lokal untuk
// menjalankan test ini.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// URUTAN INI HARUS SAMA PERSIS dengan array `files` di index.html — kalau
// index.html berubah urutannya, ubah juga di sini.
const FILES = [
  'config.js',
  'helpers.js',
  'ui-common.js',
  'admin.js',
  'beranda-riwayat.js',
  'statistik.js',
  'gerbang.js',
  'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js',
  'app.js',
];

let sandbox;
let stateOverrides = [];
let stateCallIndex = 0;

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error(
      "Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu di root repo sebelum menjalankan test ini."
    );
  }

  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  // Stub React/DOM yang cukup untuk MENJALANKAN badan fungsi komponen (bukan
  // renderer sungguhan) — createElement cuma mencatat, tidak rekursif ke
  // children. useState() bisa dipaksa mengembalikan nilai tertentu lewat
  // stateOverrides (dipakai buka modal/bottom sheet yang butuh state != awal).
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: (init) => {
      const idx = stateCallIndex++;
      const val = stateOverrides[idx] !== undefined ? stateOverrides[idx] : typeof init === 'function' ? init() : init;
      return [val, () => {}];
    },
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {
      constructor(props) {
        this.props = props;
        this.state = {};
      }
      setState(patch) {
        this.state = Object.assign({}, this.state, patch);
      }
    },
  };
  const ReactDOM = { createRoot: () => ({ render: () => {} }) };

  sandbox = {
    console,
    React,
    ReactDOM,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
const logEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan', logged_by: 'Bu Kartina' };
const pelanggaranEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Bolos', sanksi: 'Teguran Lisan', catatan: '', logged_by: 'Bu Kartina' };
const suratEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis: 'Sakit', keterangan: '', foto_url: '', logged_by: 'Bu Kartina' };
const teacher = { id: 'G01', name: 'Kartina', role: 'guru', jabatan: '', status: 'aktif', kelasWali: 'XI B' };
const jadwal = [{ hari: 'Senin', guruId: 'G01', guruName: 'Kartina' }];
const waliKelasMap = [{ class: 'XI B', waliKelasName: 'Kartina', waliKelasId: 'G01' }];
const user = { id: 'G01', name: 'Kartina', role: 'guru', jabatan: '', waliKelas: 'XI B' };
const tindakLanjutEntry = { timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', catatan: 'Sudah dipanggil', diajukanOleh: 'Kartina', status: 'menunggu', disetujuiOleh: '', tanggalDisetujui: '' };
const manyLateLogs = [0, 10, 20].map((daysAgo) => ({ timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan', logged_by: 'Bu Kartina' }));

const cases = [
  ['DashboardTab', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }],
  ['DashboardTab (admin)', { user: { ...user, waliKelas: '' }, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: true, isAdmin: true, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab'],
  ['DashboardTab (jadwalPiket kosong/tidak terdefinisi)', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: undefined, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab'],
  ['DashboardTab (modal tindak lanjut terbuka)', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab', [undefined, student]],
  ['RekapKelasTab (privileged)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], waliKelasMap, isPrivileged: true, myWaliKelas: '' }, 'RekapKelasTab'],
  ['RekapKelasTab (wali kelas)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], waliKelasMap, isPrivileged: false, myWaliKelas: 'XI B' }, 'RekapKelasTab'],
  // Perilaku detail layar Login (interaktif saat loading, fallback legacy,
  // pencarian nama) diuji terpisah di tests/login.test.js — di sini cukup
  // memastikan ketiga state daftar guru tidak bikin render meledak.
  ['LoginScreen', { onLogin: () => {}, loading: false, error: '', password: '', setPassword: () => {}, users: [], usersState: 'loading', onRetryUsers: () => {}, selectedTeacher: null, setSelectedTeacher: () => {} }],
  ['LoginScreen (daftar guru siap, sedang mencari)', { onLogin: () => {}, loading: false, error: '', password: '', setPassword: () => {}, users: [{ id: 'G01', name: 'Kartina' }], usersState: 'ready', onRetryUsers: () => {}, selectedTeacher: null, setSelectedTeacher: () => {} }, 'LoginScreen', ['ka']],
  ['LoginScreen (guru sudah dipilih)', { onLogin: () => {}, loading: false, error: '', password: '', setPassword: () => {}, users: [{ id: 'G01', name: 'Kartina' }], usersState: 'ready', onRetryUsers: () => {}, selectedTeacher: { id: 'G01', name: 'Kartina' }, setSelectedTeacher: () => {} }, 'LoginScreen'],
  ['LoginScreen (daftar guru gagal dimuat)', { onLogin: () => {}, loading: false, error: 'Password salah!', password: '', setPassword: () => {}, users: [], usersState: 'error', onRetryUsers: () => {}, selectedTeacher: null, setSelectedTeacher: () => {} }, 'LoginScreen'],
  // Props lama (tanpa daftar guru sama sekali) — memastikan LoginScreen tidak
  // pecah kalau dipanggil tanpa prop baru.
  ['LoginScreen (tanpa prop daftar guru)', { onLogin: () => {}, loading: false, error: '', password: '', setPassword: () => {} }, 'LoginScreen'],
  ['StatsTab', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], canExport: true, canViewRanking: true }],
  ['StatsTab (guru, no ranking)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], canExport: false, canViewRanking: false }, 'StatsTab'],
  ['LogTab (admin)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: true, isBk: true, currentUserName: 'Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab'],
  ['LogTab (filter drawer terbuka)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: true, isBk: true, currentUserName: 'Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, true]],
  ['LogTab (modal edit terbuka)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: true, isBk: true, currentUserName: 'Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, logEntry]],
  ['LogTab (modal hapus terbuka)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: true, isBk: true, currentUserName: 'Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, logEntry]],
  ['LogTab (guru, own record)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: false, isBk: false, currentUserName: 'Bu Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab'],
  ['LogTab (guru, others record)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], initialCategory: 'terlambat', canManage: true, isAdmin: false, isBk: false, currentUserName: 'Guru Lain', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab'],
  ['RecordModal', { student, customReason: '', setCustomReason: () => {}, onRecord: () => {}, onClose: () => {}, allLogs: [logEntry] }],
  ['KelolaTab', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }],
  ['KelolaTab (view: Kelola Guru)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['guru']],
  ['KelolaTab (view: Jadwal Piket)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['jadwal']],
  ['KelolaTab (view: Pemeliharaan Data)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['surat']],
  ['KelolaTab (bottom sheet Tambah Guru terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['guru', true]],
  ['KelolaTab (modal reset password terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  // idx 15 = nameTarget (lihat urutan useState di KelolaTab: view..waliKelasInput
  // baru nameTarget/nameInput/confirmDeleteGuru/deletingGuru, lalu msg dst).
  ['KelolaTab (modal edit nama terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  ['KelolaTab (konfirmasi hapus guru terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onDeleteSurat: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  ['AuditLogTab', { auditLog: [{ timestamp: new Date().toISOString(), name: 'Kartina', action: 'Login', detail: '' }] }],
  ['GerbangTab', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }],
  ['GerbangTab (mode terlambat, picker: belum dicatat)', { students: [student], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', [undefined, undefined, student]],
  ['GerbangTab (mode terlambat, picker: sudah dicatat)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', [undefined, undefined, student]],
  ['GerbangTab (mode surat, picker: belum dicatat)', { students: [student], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', ['surat', undefined, student]],
  ['GerbangTab (mode surat, picker: sudah dicatat)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', ['surat', undefined, student]],
  ['PelanggaranTab (privileged)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap }, 'PelanggaranTab'],
  ['PelanggaranTab (self-only)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: false, onGetPelanggaranCount: () => Promise.resolve(2), waliKelasMap }, 'PelanggaranTab'],
  ['PelanggaranTab (modal terbuka)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap }, 'PelanggaranTab', [undefined, student]],
  ['BimbinganTab', { bimbinganList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', catatan: 'Perlu bimbingan', logged_by: 'Bu Kartina' }] }],
  ['UpacaraTab (osis)', { students: [student], upacaraList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Tidak Tertib', catatan: '', logged_by: 'OSIS' }], onAddUpacara: () => {}, isOsis: true }, 'UpacaraTab'],
];

for (const [label, props, fnNameOverride, overrides] of cases) {
  test(`render: ${label}`, () => {
    const fnName = fnNameOverride || label;
    stateOverrides = overrides || [];
    stateCallIndex = 0;
    const fn = vm.runInContext(fnName, sandbox);
    assert.doesNotThrow(() => fn(props));
  });
}
