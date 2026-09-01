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
  'export-format.js',
  'ui-common.js',
  'admin.js',
  'beranda-riwayat.js',
  'statistik.js',
  'gerbang.js',
  'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js',
  'export-data.js',
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
// Izin Keluar (BETA) — satu transaksi per status operasional.
const izinBase = { nisn: '111', name: 'Rahma', class: 'XI B', keperluan: 'kontrol ke puskesmas', tujuan: 'kembali', jalur: 'normal', alasan_khusus: '', disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(), diverifikasi_oleh: '', waktu_verifikasi: '', waktu_keluar: '', waktu_kembali: '', dicatat_kembali_oleh: '', logged_by: 'Bu Kartina' };
const izinMenunggu = { ...izinBase, id: 'IZ-1', timestamp: new Date().toISOString(), status: 'Menunggu Verifikasi' };
const izinDiLuar = { ...izinBase, id: 'IZ-2', timestamp: new Date().toISOString(), status: 'Sedang di Luar', diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString() };
const izinKembali = { ...izinBase, id: 'IZ-3', timestamp: new Date().toISOString(), status: 'Kembali', diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString(), waktu_kembali: new Date().toISOString(), dicatat_kembali_oleh: 'Bu Piket Siang' };
const izinKhusus = { ...izinBase, id: 'IZ-4', timestamp: new Date().toISOString(), status: 'Pulang', tujuan: 'pulang', jalur: 'khusus', alasan_khusus: 'Guru yang menangani siswa tidak di sekolah', diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString() };
const izinSemua = [izinMenunggu, izinDiLuar, izinKembali, izinKhusus];
// Izin Kelompok — satu kegiatan, 4 peserta dengan status yang sengaja berbeda
// (inti fiturnya: kelompok itu konteks, status tetap per siswa).
const kelompok = { id: 'KEL-1', timestamp: new Date().toISOString(), kegiatan: 'Seminar Bank Indonesia', tujuan: 'kembali', keperluan: 'undangan seminar literasi keuangan', pola_kembali: 'bersama', jumlah_peserta: 4, jalur: 'normal', alasan_khusus: '', disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(), diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString() };
const kelompokKhusus = { ...kelompok, id: 'KEL-2', kegiatan: 'Lomba Mendadak', jalur: 'khusus', alasan_khusus: 'Guru pendamping tidak bisa dihubungi', pola_kembali: 'individual' };
const anggota = ['Ahmad', 'Budi', 'Citra', 'Deni'].map((nama, i) => ({
  ...izinBase, id: `IZ-K${i}`, nisn: `20${i}`, name: nama, class: i < 2 ? 'XI A' : 'XI B',
  timestamp: new Date().toISOString(), kelompok_id: 'KEL-1', kegiatan: 'Seminar Bank Indonesia',
  status: ['Kembali', 'Kembali', 'Sedang di Luar', 'Menunggu Verifikasi'][i],
}));
const kelompokHandlers = { onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {}, onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {} };
const izinHandlers = { onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, onSelesaikan: () => {} };
const manyLateLogs = [0, 10, 20].map((daysAgo) => ({ timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', type: 'Hujan', logged_by: 'Bu Kartina' }));

// Urutan useState KelolaTab lewat idx 26 (confirmAddGuru) sama seperti
// sebelumnya (lihat komentar idx 15/25/26 di atas); Pemeliharaan Data > Hapus
// Data menambah HANYA hooks BARU sesudahnya (idx 27 hapusStart .. idx 34
// hapusDeleting), jadi override lama tidak pernah bergeser. idx 32 =
// confirmHapusData -- modal Tahap 2 (pratinjau + konfirmasi) terbuka.
function kelolaHapusOverride(confirmHapusDataValue) {
    const arr = new Array(33).fill(undefined);
    arr[0] = 'surat';
    arr[32] = confirmHapusDataValue;
    return arr;
}

const cases = [
  ['DashboardTab', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }],
  ['DashboardTab (admin)', { user: { ...user, waliKelas: '' }, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: true, isAdmin: true, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab'],
  ['DashboardTab (jadwalPiket kosong/tidak terdefinisi)', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: undefined, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab'],
  ['DashboardTab (modal tindak lanjut terbuka)', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {} }, 'DashboardTab', [undefined, student]],
  ['DashboardTab (ringkasan izin keluar menunggu verifikasi)', { user, allLogs: manyLateLogs, pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], jadwalPiket: jadwal, onRefresh: () => {}, loading: false, tindakLanjutList: [tindakLanjutEntry], canViewRanking: false, isAdmin: false, onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {}, izinList: izinSemua, kelompokList: [kelompok], canVerifyIzin: true }, 'DashboardTab'],
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
  // Prop onGetLateCount opsional (lihat RecordModal di gerbang.js): dua-duanya
  // harus aman — dipasang, dan tidak dipasang seperti kasus di atas.
  ['RecordModal (dengan jumlah dari server)', { student, customReason: '', setCustomReason: () => {}, onRecord: () => {}, onClose: () => {}, allLogs: [logEntry], onGetLateCount: () => Promise.resolve(7) }, 'RecordModal'],
  ['KelolaTab', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }],
  ['KelolaTab (view: Kelola Guru)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['guru']],
  ['KelolaTab (view: Jadwal Piket)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['jadwal']],
  // idx 25 = pickGuruSearch -- daftar guru hasil cari (tap-untuk-tambah) terbuka.
  ['KelolaTab (Jadwal Piket, hasil cari guru terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['jadwal', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Kar']],
  // idx 26 = confirmAddGuru -- dialog konfirmasi tambah guru piket terbuka.
  ['KelolaTab (konfirmasi tambah guru piket terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['jadwal', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { id: 'G01', name: 'Kartina', hari: 'Senin' }]],
  ['KelolaTab (view: Pemeliharaan Data)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['surat']],
  ['KelolaTab (Pemeliharaan Data, modal pratinjau terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', kelolaHapusOverride({ jenis: ['keterlambatan', 'pelanggaran'], start: '2026-07-01', end: '2026-07-31', counts: { keterlambatan: 12, pelanggaran: 3 }, total: 15, periodeLabel: '01/07/2026 - 31/07/2026' })],
  ['KelolaTab (Pemeliharaan Data, modal pratinjau nol data)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', kelolaHapusOverride({ jenis: ['izin'], start: '2026-07-01', end: '2026-07-31', counts: { izin: 0 }, total: 0, periodeLabel: '01/07/2026 - 31/07/2026' })],
  ['KelolaTab (bottom sheet Tambah Guru terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['guru', true]],
  ['KelolaTab (modal reset password terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  // idx 15 = nameTarget (lihat urutan useState di KelolaTab: view..waliKelasInput
  // baru nameTarget/nameInput/confirmDeleteGuru/deletingGuru, lalu msg dst).
  ['KelolaTab (modal edit nama terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  ['KelolaTab (konfirmasi hapus guru terbuka)', { teachers: [teacher], students: [student], jadwalPiket: jadwal, onAddTeacher: () => {}, onUpdatePassword: () => {}, onUpdateJabatan: () => {}, onToggleStatus: () => {}, onUpdateRole: () => {}, onUpdateWaliKelas: () => {}, onUpdateName: () => {}, onDeleteTeacher: () => {}, onSetJadwalPiket: () => {}, onPreviewHapusData: () => {}, onHapusData: () => {}, onGoToExportData: () => {}, loading: false }, 'KelolaTab', ['guru', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, teacher]],
  ['AuditLogTab', { auditLog: [{ timestamp: new Date().toISOString(), name: 'Kartina', action: 'Login', detail: '' }] }],
  ['GerbangTab', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }],
  ['GerbangTab (mode terlambat, picker: belum dicatat)', { students: [student], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', [undefined, undefined, student]],
  ['GerbangTab (mode terlambat, picker: sudah dicatat)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', [undefined, undefined, student]],
  ['GerbangTab (mode surat, picker: belum dicatat)', { students: [student], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', ['surat', undefined, student]],
  ['GerbangTab (mode surat, picker: sudah dicatat)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap }, 'GerbangTab', ['surat', undefined, student]],
  // ---- Izin Keluar / Pulang (BETA) ----
  // Urutan useState IzinKeluarPanel: searchQuery, pickedStudent, formStudent,
  // keperluan, tujuan, jalurKhusus, alasanKhusus, saving, msg, msgTone, busyId.
  ['IzinKeluarPanel (petugas berwenang)', { students: [student], izinList: izinSemua, canVerify: true, waliKelasMap, myWaliKelas: 'XI B', ...izinHandlers }, 'IzinKeluarPanel'],
  ['IzinKeluarPanel (guru biasa, tanpa tombol proses)', { students: [student], izinList: izinSemua, canVerify: false, waliKelasMap, ...izinHandlers }, 'IzinKeluarPanel'],
  ['IzinKeluarPanel (daftar kosong / prop belum datang)', { students: [student], izinList: undefined, canVerify: true, waliKelasMap: undefined, ...izinHandlers }, 'IzinKeluarPanel'],
  ['IzinKeluarPanel (hasil pencarian terbuka, siswa masih punya izin berjalan)', { students: [student], izinList: izinSemua, canVerify: true, waliKelasMap, ...izinHandlers }, 'IzinKeluarPanel', ['Rah']],
  ['IzinKeluarPanel (kartu konteks: wali kelas)', { students: [student], izinList: [], canVerify: true, waliKelasMap, myWaliKelas: 'XI B', ...izinHandlers }, 'IzinKeluarPanel', [undefined, student]],
  ['IzinKeluarPanel (kartu konteks: guru mapel)', { students: [student], izinList: [], canVerify: true, waliKelasMap, myWaliKelas: 'XI A', ...izinHandlers }, 'IzinKeluarPanel', [undefined, student]],
  ['IzinKeluarPanel (form izin terbuka, konteks wali kelas)', { students: [student], izinList: [], canVerify: true, waliKelasMap, myWaliKelas: 'XI B', ...izinHandlers }, 'IzinKeluarPanel', [undefined, undefined, student]],
  ['IzinKeluarPanel (form izin khusus terbuka, konteks guru mapel)', { students: [student], izinList: [], canVerify: true, waliKelasMap, myWaliKelas: 'XI A', ...izinHandlers }, 'IzinKeluarPanel', [undefined, undefined, student, 'sakit', 'pulang', true, 'Guru yang menangani siswa tidak di sekolah']],
  ['KartuIzinKeluar (menunggu verifikasi)', { izin: izinMenunggu, children: null }, 'KartuIzinKeluar'],
  ['KartuIzinKeluar (izin khusus, sudah pulang)', { izin: izinKhusus, children: null }, 'KartuIzinKeluar'],
  ['KartuIzinKeluar (sudah kembali)', { izin: izinKembali, children: null }, 'KartuIzinKeluar'],
  // Urutan useState IzinKelompokPanel: kegiatan, keperluan, tujuan, pola,
  // searchQuery, pilihan, jalurKhusus, alasanKhusus, saving, msg, msgTone,
  // busyId, sheetKelompok, sheetMode, sheetPilih.
  ['IzinKelompokPanel (petugas berwenang)', { students: [student], izinList: anggota, kelompokList: [kelompok, kelompokKhusus], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel'],
  ['IzinKelompokPanel (guru biasa)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: false, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel'],
  ['IzinKelompokPanel (daftar & prop belum datang)', { students: [student], izinList: undefined, kelompokList: undefined, canVerify: true, waliKelasMap: undefined, ...kelompokHandlers }, 'IzinKelompokPanel'],
  ['IzinKelompokPanel (tujuan pulang — tanpa pola kembali)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel', [undefined, undefined, 'pulang']],
  ['IzinKelompokPanel (peserta terpilih + hasil pencarian)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel', ['Seminar', 'undangan', 'kembali', 'bersama', 'Rah', [student]]],
  ['IzinKelompokPanel (jalur khusus dicentang)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel', ['Lomba', 'mendadak', 'kembali', 'bersama', '', [student], true, 'Guru pendamping tidak ada']],
  ['IzinKelompokPanel (daftar peserta terbuka)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, kelompok, 'lihat', []]],
  ['IzinKelompokPanel (konfirmasi rombongan kembali)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, ...kelompokHandlers }, 'IzinKelompokPanel', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, kelompok, 'kembali', ['IZ-K2']]],
  ['KartuKelompok (menunggu + di luar)', { kelompok, peserta: anggota, canVerify: true, onLihat: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, busy: false }, 'KartuKelompok'],
  ['KartuKelompok (izin khusus, pola individual, tanpa peserta)', { kelompok: kelompokKhusus, peserta: [], canVerify: false, onLihat: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, busy: true }, 'KartuKelompok'],
  ['PesertaKelompokSheet (lihat)', { kelompok: kelompokKhusus, peserta: anggota, mode: 'lihat', dipilih: [], onToggle: () => {}, onTutup: () => {}, onKonfirmasi: () => {}, canVerify: true, busy: false, onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {} }, 'PesertaKelompokSheet'],
  ['PesertaKelompokSheet (verifikasi)', { kelompok, peserta: anggota, mode: 'verifikasi', dipilih: ['IZ-K3'], onToggle: () => {}, onTutup: () => {}, onKonfirmasi: () => {}, canVerify: true, busy: false, onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {} }, 'PesertaKelompokSheet'],
  ['PesertaKelompokSheet (tandai rombongan kembali)', { kelompok, peserta: anggota, mode: 'kembali', dipilih: ['IZ-K2'], onToggle: () => {}, onTutup: () => {}, onKonfirmasi: () => {}, canVerify: true, busy: false, onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {} }, 'PesertaKelompokSheet'],
  ['IzinKeluarTab (mode individual)', { students: [student], izinList: izinSemua, kelompokList: [kelompok], canVerify: true, waliKelasMap, myWaliKelas: 'XI B', ...izinHandlers, ...kelompokHandlers, onTandaiPulang: () => {} }, 'IzinKeluarTab'],
  ['IzinKeluarTab (mode kelompok)', { students: [student], izinList: anggota, kelompokList: [kelompok], canVerify: true, waliKelasMap, myWaliKelas: 'XI B', ...izinHandlers, ...kelompokHandlers, onTandaiPulang: () => {} }, 'IzinKeluarTab', ['kelompok']],
  ['GerbangTab (mode Izin Keluar)', { students: [student], allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], onSelectLate: () => {}, suratList: [suratEntry], onAddSurat: () => {}, isAdminUser: true, waliKelasMap, myWaliKelas: 'XI B', izinList: izinSemua, canVerifyIzin: true, onCreateIzin: () => {}, onVerifikasiIzin: () => {}, onTandaiKembaliIzin: () => {}, onSelesaikanIzin: () => {} }, 'GerbangTab', ['izin']],
  ['LogTab (kategori Izin Keluar)', { allLogs: [logEntry], pelanggaranList: [pelanggaranEntry], suratList: [suratEntry], izinList: izinSemua, initialCategory: 'terlambat', canManage: true, isAdmin: true, isBk: true, currentUserName: 'Kartina', onEditEntry: () => {}, onDeleteEntry: () => {} }, 'LogTab', ['izin']],
  ['PelanggaranTab (privileged)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap }, 'PelanggaranTab'],
  ['PelanggaranTab (self-only)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: false, onGetPelanggaranCount: () => Promise.resolve(2), waliKelasMap }, 'PelanggaranTab'],
  ['PelanggaranTab (modal terbuka)', { students: [student], pelanggaranList: [pelanggaranEntry], onAddPelanggaran: () => {}, onAddBimbingan: () => {}, canSeeClassDetail: true, onGetPelanggaranCount: () => Promise.resolve(0), waliKelasMap }, 'PelanggaranTab', [undefined, student]],
  ['BimbinganTab', { bimbinganList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', catatan: 'Perlu bimbingan', logged_by: 'Bu Kartina' }] }],
  ['UpacaraTab (osis)', { students: [student], upacaraList: [{ timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B', jenis_pelanggaran: 'Tidak Tertib', catatan: '', logged_by: 'OSIS' }], onAddUpacara: () => {}, isOsis: true }, 'UpacaraTab'],
  ['ExportTab (admin/BK)', { isBk: true, waliKelas: '', classes: ['XI A', 'XI B'], onGenerate: () => {} }, 'ExportTab'],
  ['ExportTab (wali kelas, cakupan terkunci)', { isBk: false, waliKelas: 'XI B', classes: ['XI A', 'XI B'], onGenerate: () => {} }, 'ExportTab'],
  // idx 5 = busy, idx 6 = msg -- keadaan "sedang generate" & pesan hasil.
  ['ExportTab (sedang generate + pesan gagal)', { isBk: true, waliKelas: '', classes: [], onGenerate: () => {} }, 'ExportTab', [undefined, undefined, undefined, undefined, undefined, true, { ok: false, text: 'Tidak ada data pada periode & cakupan ini.' }]],
  // Prefill dari tombol "Export Data Terlebih Dahulu" di Pemeliharaan Data >
  // Hapus Data (admin.js) lewat goToExportData() -- lihat initialJenis/
  // initialStart/initialEnd di ExportTab (export-data.js).
  ['ExportTab (prefill dari Hapus Data)', { isBk: true, waliKelas: '', classes: ['XI A', 'XI B'], onGenerate: () => {}, initialJenis: 'izin', initialStart: '2026-07-01', initialEnd: '2026-07-31' }, 'ExportTab'],
  ['Header', { user, roleLabel: 'Guru', onLogout: () => {}, onOpenChangePassword: () => {}, fontScale: 1, onFontScaleChange: () => {} }],
  ['Header (menu ukuran tulisan terbuka)', { user, roleLabel: 'Guru', onLogout: () => {}, onOpenChangePassword: () => {}, fontScale: 1, onFontScaleChange: () => {} }, 'Header', [true]],
  ['ChangePasswordModal', { onSubmit: () => {}, onClose: () => {}, loading: false }],
  ['BottomNav (guru, 4 menu primer)', { menus: ['scan', 'dashboard', 'log', 'pelanggaran'], primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], activeTab: 'scan', setActiveTab: () => {} }, 'BottomNav'],
  ['BottomNav (admin, 4 menu primer + Lainnya berisi Kelola)', { menus: ['scan', 'dashboard', 'log', 'stats', 'rekap', 'pelanggaran', 'bimbingan', 'upacara', 'auditlog', 'kelola'], primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], activeTab: 'kelola', setActiveTab: () => {} }, 'BottomNav'],
  ['BottomNav (panel Lainnya terbuka)', { menus: ['scan', 'dashboard', 'log', 'stats', 'rekap', 'pelanggaran', 'bimbingan', 'upacara', 'auditlog', 'kelola'], primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], activeTab: 'kelola', setActiveTab: () => {} }, 'BottomNav', [true]],
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
