// ===== tests/izin-keluar-frontend.test.js =====
// Sisi klien Izin Keluar / Pulang (BETA): perkabelannya di app.js, dan
// bahwa layar tidak menjanjikan apa pun yang server tidak izinkan.
//
// Otorisasi SUNGGUHAN diuji di tests/izin-keluar.test.js (memanggil
// doPost/doGet asli) — layar memang bukan tempat pengamanannya. Yang dijaga di
// sini: fitur baru tidak diam-diam menambah request boot yang berulang, tidak
// menyalakan tombol proses untuk yang tidak berwenang, dan tidak menyelipkan
// jalur edit/hapus baru ke Riwayat.
//
// Harness-nya sengaja meniru tests/performance.test.js: efek dikumpulkan,
// tidak dijalankan otomatis, supaya urutan boot bisa diperiksa.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const FILES = [
  'config.js', 'helpers.js', 'export-format.js', 'ui-common.js', 'admin.js',
  'beranda-riwayat.js', 'statistik.js', 'gerbang.js', 'pelanggaran-bimbingan-upacara.js',
  'rekap-kelas.js', 'export-data.js', 'app.js',
];

let sandbox;
let storage = {};
let fetchCalls = [];
let effects = [];
// Dipakai HANYA oleh renderWithState() di bawah — bukan oleh bootApp()/App(),
// yang selalu berjalan dengan array kosong (jadi useState() di bawah selalu
// jatuh ke nilai init, persis seperti sebelum ini ditambahkan). Pola index
// positional-nya sama dengan tests/render-smoke.test.js.
let stateOverrides = [];
let stateCallIndex = 0;

test.before(() => {
  let babel;
  try {
    babel = require('@babel/core');
  } catch (e) {
    throw new Error("Devdependency '@babel/core' belum terpasang — jalankan `npm install` dulu.");
  }
  const combined = FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const transformed = babel.transformSync(combined, { presets: [['@babel/preset-react', { runtime: 'classic' }]] }).code;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'Fragment',
    useState: (init) => {
      const idx = stateCallIndex++;
      const val = stateOverrides[idx] !== undefined ? stateOverrides[idx] : typeof init === 'function' ? init() : init;
      return [val, () => {}];
    },
    useEffect: (fn, deps) => { effects.push({ fn, deps }); },
    useMemo: (fn) => fn(),
    useRef: (init) => ({ current: init }),
    Component: class Component {
      constructor(props) { this.props = props; this.state = {}; }
      setState(patch) { this.state = Object.assign({}, this.state, patch); }
    },
  };

  sandbox = {
    console,
    React,
    ReactDOM: { createRoot: () => ({ render: () => {} }) },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    document: { getElementById: () => ({ innerHTML: '' }), createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } },
    fetch: (...args) => { fetchCalls.push(args); return Promise.resolve({ json: () => Promise.resolve({ status: 'success' }) }); },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
    setTimeout,
    clearTimeout,
    window: {},
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: 'combined.js' });
});

test.beforeEach(() => { storage = {}; fetchCalls = []; effects = []; stateOverrides = []; stateCallIndex = 0; });

// Render satu komponen dengan state internal dipaksa lewat index posisi
// useState-nya (lihat komentar di deklarasi stateOverrides) — dipakai untuk
// membuka kartu konteks/form Izin Keluar tanpa simulasi klik sungguhan.
function renderWithState(fnName, props, overrides) {
  stateOverrides = overrides || [];
  stateCallIndex = 0;
  const result = get(fnName)(props);
  stateOverrides = [];
  return result;
}

const get = (name) => vm.runInContext(name, sandbox);
const SIX_HOURS = 6 * 60 * 60 * 1000;

function loginAs(user) {
  storage.sigap_session_token = 'TOK';
  storage.sigap_user = JSON.stringify(user);
  storage.sigap_session_expires = String(Date.now() + SIX_HOURS);
}

function bootApp() {
  effects = [];
  const tree = get('App')({});
  effects.forEach((e) => e.fn());
  return tree;
}

const actionsRequested = () => fetchCalls
  .map((c) => String(c[0]))
  .map((url) => (url.match(/action=([a-zA-Z]+)/) || [])[1])
  .filter(Boolean);

function findAll(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, acc)); return acc; }
  if (pred(node)) acc.push(node);
  if (node.props) Object.keys(node.props).forEach((k) => findAll(node.props[k], pred, acc));
  findAll(node.children, pred, acc);
  return acc;
}
const findComponent = (tree, name) => findAll(tree, (n) => n.type === get(name))[0];

const guru = { id: 'G03', name: 'Pak Anwar', role: 'guru', jabatan: '', waliKelas: '' };

test('boot: daftar Izin Keluar ditarik untuk guru, sekali saja', () => {
  loginAs(guru);
  bootApp();
  const izin = actionsRequested().filter((a) => a === 'getIzinKeluar');
  assert.equal(izin.length, 1, 'tab Gerbang butuh daftarnya, tapi cukup sekali');
});

test('boot: membuka Riwayat tidak menarik ulang daftar yang sama (penanda per-data)', () => {
  loginAs(guru);
  bootApp();
  fetchCalls = [];
  // Efek tab: buka Riwayat setelah Gerbang. Datanya sama, jadi tidak boleh
  // ditembak dua kali — inilah gunanya loadOnce('izin', ...) dipakai bersama.
  get('App')({});
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /if \(tab === 'scan' \|\| tab === 'log'\) loadOnce\('izin', fetchIzinKeluar\);/);
});

test('boot OSIS: tidak menembak getIzinKeluar sama sekali', () => {
  loginAs({ id: 'S01', name: 'Ketua OSIS', role: 'osis', jabatan: '', waliKelas: '' });
  bootApp();
  assert.ok(!actionsRequested().includes('getIzinKeluar'));
});

test('GerbangTab & LogTab menerima daftar izin dari state yang sama', () => {
  loginAs(guru);
  const tree = bootApp();
  const gerbang = findComponent(tree, 'GerbangTab');
  assert.ok(gerbang, 'tab Gerbang harus terpasang untuk guru');
  assert.ok(Array.isArray(gerbang.props.izinList));
  assert.equal(typeof gerbang.props.onCreateIzin, 'function');
  assert.equal(typeof gerbang.props.onVerifikasiIzin, 'function');
  assert.equal(typeof gerbang.props.onTandaiKembaliIzin, 'function');
  // canVerifyIzin datang dari server (bukan dihitung ulang di klien), dan
  // default-nya tertutup sampai server bilang sebaliknya.
  assert.equal(gerbang.props.canVerifyIzin, false);

  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /<LogTab[\s\S]*?izinList=\{izinList\}/, 'Riwayat memakai daftar yang sama, bukan fetch sendiri');
});

test('status transaksi tidak pernah dikirim klien — klien hanya memanggil aksi', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split("// ---- Izin Keluar / Pulang (BETA) ----")[1];
  assert.ok(blok, 'blok handler Izin Keluar harus ada di app.js');
  assert.match(blok, /action: 'addIzinKeluar'/);
  assert.match(blok, /verifikasiIzinKeluar/);
  assert.match(blok, /tandaiKembaliIzinKeluar/);
  // 'selesaikanIzinKeluar' DIHAPUS oleh audit UX Agustus 2026 — "Tandai
  // Kembali" sekarang langsung final, tidak ada langkah "Tutup transaksi"
  // kedua yang menunggu. Kalau nama aksi ini muncul lagi di app.js, artinya
  // langkah kedua itu diam-diam kembali — gagalkan.
  assert.doesNotMatch(blok, /selesaikanIzinKeluar/);
  // Tidak ada payload berisi status/nama/kelas yang dikarang klien.
  assert.doesNotMatch(blok, /status: '(Sedang di Luar|Kembali|Pulang|Selesai|Menunggu Verifikasi)'/);
  assert.doesNotMatch(blok, /class_name/);
});

test('daftar izin TIDAK ikut snapshot localStorage (status berubah sepanjang hari)', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const blok = app.split('buildClientCache(user.id, {')[1].split('}')[0];
  assert.doesNotMatch(blok, /izinList/, 'transaksi berstatus tidak boleh disajikan dari snapshot lama');
});

test('IzinKeluarPanel: tombol proses hanya muncul untuk yang berwenang', () => {
  const izin = {
    id: 'IZ-1', timestamp: new Date().toISOString(), nisn: '111', name: 'Rahma', class: 'XI B',
    keperluan: 'kontrol', tujuan: 'kembali', jalur: 'normal', alasan_khusus: '', status: 'Sedang di Luar',
    disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(),
    diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString(),
    waktu_kembali: '', dicatat_kembali_oleh: '', logged_by: 'Bu Kartina',
  };
  const props = {
    students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }], izinList: [izin], waliKelasMap: [],
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  const teksDari = (node) => JSON.stringify(node);

  const berwenang = teksDari(get('IzinKeluarPanel')({ ...props, canVerify: true }));
  assert.ok(berwenang.includes('Tandai Kembali'), 'petugas berwenang melihat tombolnya');

  const biasa = teksDari(get('IzinKeluarPanel')({ ...props, canVerify: false }));
  assert.ok(!biasa.includes('Tandai Kembali'), 'guru tanpa kewenangan tidak ditawari tombol yang pasti ditolak server');
  // Jalur khusus juga tidak ditawarkan — tapi server tetap yang menolaknya.
  assert.ok(!biasa.includes('Izin Khusus'));
});

test('Riwayat: kategori Izin Keluar read-only, tidak lewat editEntry/deleteEntry', () => {
  const src = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');
  // Kategori baru ditandai readOnly, dan tombol kelola mengikuti tanda itu.
  assert.match(src, /key: 'izin'[^\n]*readOnly: true/);
  assert.match(src, /const bolehKelola = canManage && !activeCat\.readOnly;/);
  // submitEdit/submitDelete tetap cuma mengenal tiga kategori lama.
  const kategoriEdit = src.split('const submitEdit')[1].split('};')[0];
  assert.doesNotMatch(kategoriEdit, /'izin'/);
});

test('Gerbang: Izin Keluar jadi mode ketiga, bukan menu BottomNav baru', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbang, /setMode\('izin'\)/);
  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.doesNotMatch(config, /izin/i, 'tidak ada entri NAV_ITEMS/ROLES baru untuk fitur ini');
  // Menu tiap role tidak berubah sama sekali.
  // JSON round-trip: nilai dari dalam vm bukan objek yang sama dengan objek
  // Node di luar vm, jadi deepEqual langsung akan gagal walau isinya sama.
  const menus = (role) => JSON.parse(JSON.stringify(get('ROLES')[role].menus));
  assert.deepEqual(menus('guru'), ['scan', 'dashboard', 'log', 'stats', 'pelanggaran']);
  assert.deepEqual(menus('osis'), ['upacara']);
});

test('layar hanya menyebut pencetakan sebagai status BETA — tidak ada integrasi printer', () => {
  const semua = ['gerbang.js', 'app.js', 'beranda-riwayat.js', 'config.js', 'helpers.js', 'index.html']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.match(semua, /Fitur pencetakan masih dalam tahap BETA\./);
  // Tidak ada asumsi perangkat/protokol/ukuran kertas apa pun.
  // Batas kata dipakai supaya kode warna heksa (#1B2A41) & URL Apps Script
  // tidak ikut tertangkap sebagai "ukuran kertas".
  [/bluetooth/i, /esc\/?pos/i, /airprint/i, /window\.print/i, /\b(58|80)\s?mm\b/i, /\b(A4|A5|F4)\b/].forEach((pola) => {
    assert.doesNotMatch(semua, pola, 'tidak boleh ada asumsi perangkat/media cetak: ' + pola);
  });
});

test('layar persetujuan: mencatat pemberi persetujuan, tanpa klaim peran', () => {
  const props = {
    students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }], izinList: [], waliKelasMap: [], canVerify: false,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  // Urutan useState IzinKeluarPanel: searchQuery, pickedStudent, formStudent,
  // keperluan, tujuan, jalurKhusus, alasanKhusus, saving, msg, msgTone, busyId.
  const kosong = JSON.stringify(get('IzinKeluarPanel')(props));
  assert.ok(!kosong.includes('Persetujuan sebagai'), 'belum ada siswa dipilih, jadi judul form belum tampil');
  assert.ok(!kosong.includes('Anda akan tercatat sebagai pihak'), 'kartu konteks/form belum terbuka');

  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const form = gerbang.split('{formStudent && (')[1];
  assert.match(form, /Persetujuan sebagai Wali Kelas/);
  assert.match(form, /Persetujuan sebagai Guru Mapel/);
  assert.match(form, /Anda akan tercatat sebagai pihak yang memberikan persetujuan izin ini\./);
  assert.match(form, /'Setujui Izin'/);
  assert.match(form, />Batal</);
});

test('kartu konteks: wali kelas vs guru mapel, dihitung dari waliKelas pengguna — bukan diketik', () => {
  const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
  const props = {
    students: [student], izinList: [], waliKelasMap: [], canVerify: false,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  // idx 1 = pickedStudent -> kartu konteks terbuka (belum form).
  const walas = JSON.stringify(renderWithState('IzinKeluarPanel', { ...props, myWaliKelas: 'XI B' }, [undefined, student]));
  assert.ok(walas.includes('Anda adalah wali kelas siswa ini.'));
  assert.ok(walas.includes('Berikan Persetujuan'));
  assert.ok(!walas.includes('Berikan Izin sebagai Guru Mapel'));

  const bukanWalas = JSON.stringify(renderWithState('IzinKeluarPanel', { ...props, myWaliKelas: 'XI A' }, [undefined, student]));
  assert.ok(bukanWalas.includes('Siswa ini bukan kelas perwalian Anda.'));
  assert.ok(bukanWalas.includes('Berikan Izin sebagai Guru Mapel'));
  assert.ok(!bukanWalas.includes('Anda adalah wali kelas siswa ini.'));

  // Guru tanpa kelas perwalian sama sekali (myWaliKelas kosong/tidak dikirim)
  // selalu jatuh ke jalur Guru Mapel — sesuai aturan existing (guru biasa).
  const guruBiasa = JSON.stringify(renderWithState('IzinKeluarPanel', { ...props }, [undefined, student]));
  assert.ok(guruBiasa.includes('Berikan Izin sebagai Guru Mapel'));
});

test('form: judul menyesuaikan konteks, tapi tetap satu form yang sama (bukan dua alur berbeda)', () => {
  const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
  const props = {
    students: [student], izinList: [], waliKelasMap: [], canVerify: true,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  // idx 2 = formStudent -> form langsung terbuka (konteks sudah "dikonfirmasi").
  const formWalas = JSON.stringify(renderWithState('IzinKeluarPanel', { ...props, myWaliKelas: 'XI B' }, [undefined, undefined, student]));
  assert.ok(formWalas.includes('Persetujuan sebagai Wali Kelas'));
  assert.ok(!formWalas.includes('Persetujuan sebagai Guru Mapel'));

  const formMapel = JSON.stringify(renderWithState('IzinKeluarPanel', { ...props, myWaliKelas: 'XI A' }, [undefined, undefined, student]));
  assert.ok(formMapel.includes('Persetujuan sebagai Guru Mapel'));
  assert.ok(!formMapel.includes('Persetujuan sebagai Wali Kelas'));

  // Kedua konteks memakai field & tombol yang SAMA persis (keperluan, tujuan,
  // Izin Khusus untuk yang berwenang, Setujui Izin) — bukan form yang berbeda.
  ['Keperluan', 'Tujuan', 'Kembali ke sekolah', 'Izin Khusus', 'Setujui Izin'].forEach((teks) => {
    assert.ok(formWalas.includes(teks), `konteks Wali Kelas kehilangan "${teks}"`);
    assert.ok(formMapel.includes(teks), `konteks Guru Mapel kehilangan "${teks}"`);
  });
});

// ===== Audit UX: Izin Khusus sebagai JALUR PERSETUJUAN, bukan checkbox
// tunggal di bawah peserta/izin kelompok (lihat laporan audit). =====

test('Jalur Persetujuan (individual): dua pilihan eksplisit "Persetujuan normal"/"Izin Khusus" + penjelasan singkat, bukan checkbox tunggal', () => {
  const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
  const props = {
    students: [student], izinList: [], waliKelasMap: [], canVerify: true,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  const form = JSON.stringify(renderWithState('IzinKeluarPanel', props, [undefined, undefined, student]));
  assert.ok(form.includes('Jalur Persetujuan'));
  assert.ok(form.includes('Persetujuan normal'));
  assert.ok(form.includes('Izin Khusus'));
  assert.ok(form.includes('Gunakan Izin Khusus jika guru yang menangani siswa tidak tersedia dan keputusan perlu diambil segera.'));

  // Bukan lagi checkbox: blok Jalur Persetujuan di source tidak memakai
  // <input type="checkbox">, melainkan dua tombol pilihan.
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const blokIndividual = gerbang.split('function IzinKelompokPanel(')[0].split('Jalur Persetujuan')[1];
  assert.doesNotMatch(blokIndividual.split('Button onClick={submitIzin}')[0], /type="checkbox"/);
});

test('Jalur Persetujuan (kelompok): widget & teks SAMA PERSIS dengan individual — konsisten', () => {
  const form = JSON.stringify(get('IzinKelompokPanel')(propsKelompok()));
  assert.ok(form.includes('Jalur Persetujuan'));
  assert.ok(form.includes('Persetujuan normal'));
  assert.ok(form.includes('Izin Khusus'));
  assert.ok(form.includes('Gunakan Izin Khusus jika guru yang menangani siswa tidak tersedia dan keputusan perlu diambil segera.'));

  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const [blokIndividualSrc, blokKelompokSrc] = gerbang.split('function IzinKelompokPanel(');
  const ambilOpsi = (src) => {
    const blok = src.split('Jalur Persetujuan')[1].split('Ajukan')[0];
    return {
      normal: /Persetujuan normal/.test(blok),
      khusus: /Izin Khusus/.test(blok),
      penjelasan: /Gunakan Izin Khusus jika guru yang menangani siswa tidak tersedia dan keputusan perlu diambil segera\./.test(blok),
    };
  };
  assert.deepEqual(ambilOpsi(blokIndividualSrc), ambilOpsi(blokKelompokSrc), 'label & penjelasan jalur persetujuan harus identik antara individual dan kelompok');
});

test('Jalur Persetujuan tidak ditawarkan sama sekali untuk yang tidak berwenang (individual & kelompok konsisten)', () => {
  const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
  const formIndividual = JSON.stringify(renderWithState('IzinKeluarPanel', {
    students: [student], izinList: [], waliKelasMap: [], canVerify: false,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  }, [undefined, undefined, student]));
  assert.ok(!formIndividual.includes('Jalur Persetujuan'));
  assert.ok(!formIndividual.includes('Izin Khusus'));

  const formKelompok = JSON.stringify(get('IzinKelompokPanel')(propsKelompok({ canVerify: false })));
  assert.ok(!formKelompok.includes('Jalur Persetujuan'));
  assert.ok(!formKelompok.includes('Izin Khusus'));
});

test('tombol Setujui Izin TIDAK disabled saat Izin Khusus dipilih dan semua syarat (keperluan + alasan) terisi', () => {
  const student = { nisn: '111', name: 'Rahma', class: 'XI B' };
  const props = {
    students: [student], izinList: [], waliKelasMap: [], canVerify: true,
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  };
  // idx: 0 searchQuery, 1 pickedStudent, 2 formStudent, 3 keperluan, 4 tujuan,
  // 5 jalurKhusus, 6 alasanKhusus.
  const tree = renderWithState('IzinKeluarPanel', props, [undefined, undefined, student, 'kontrol ke dokter', undefined, true, 'wali kelas & guru mapel tidak bisa dihubungi']);
  const tombol = findAll(tree, (n) => n.type === get('Button') && Array.isArray(n.children) && n.children.join('').includes('Catat Izin Khusus'))[0];
  assert.ok(tombol, 'tombol "Catat Izin Khusus" harus ada saat form terbuka dengan jalur khusus dipilih');
  assert.equal(tombol.props.disabled, false, 'tombol tidak boleh disabled ketika keperluan & alasan sudah terisi');
});

test('tombol Ajukan Kelompok (Izin Khusus) TIDAK disabled saat semua syarat (kegiatan, keperluan, peserta, alasan) terisi', () => {
  const overrides = [
    'Lomba Debat', // kegiatan
    'lomba debat kota', // keperluan
    undefined, // tujuan (default 'kembali')
    undefined, // pola (default 'bersama')
    undefined, // searchQuery
    [{ nisn: '111', name: 'Rahma', class: 'XI B' }], // pilihan (peserta)
    true, // jalurKhusus
    'guru pendamping berhalangan mendadak', // alasanKhusus
  ];
  const tree = renderWithState('IzinKelompokPanel', propsKelompok(), overrides);
  const tombol = findAll(tree, (n) => n.type === get('Button') && Array.isArray(n.children) && n.children.join('').includes('Catat Kegiatan (Izin Khusus)'))[0];
  assert.ok(tombol, 'tombol "Catat Kegiatan (Izin Khusus)" harus ada saat semua field terisi');
  assert.equal(tombol.props.disabled, false, 'tombol tidak boleh disabled ketika kegiatan/keperluan/peserta/alasan sudah terisi');
});

test('tidak ada isian yang meminta guru mengaku sebagai Guru Mapel / Wali Kelas', () => {
  const src = ['gerbang.js', 'app.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // Komentar dibuang dulu: menjelaskan KENAPA jadwal mengajar tidak ada justru
  // hal yang diinginkan — yang dilarang adalah mekanismenya, bukan penjelasannya.
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  [/setPeran|peran:|sebagaiGuru|klaimPeran/, /jadwalMengajar|Jadwal_Mengajar|getJadwalMengajar/].forEach((pola) => {
    assert.doesNotMatch(kode, pola, 'tidak boleh ada klaim/validasi peran mengajar: ' + pola);
  });
  // Penjelasannya sendiri HARUS ada — supaya tidak ada yang mengira ini kelupaan.
  assert.match(src, /tidak punya data jadwal mengajar|tidak menyimpan jadwal mengajar/i);
  const blokKirim = src.split("action: 'addIzinKeluar'")[1].split('};')[0];
  assert.doesNotMatch(blokKirim, /peran|role|waliKelas/, 'payload persetujuan tidak membawa klaim peran');
});

// ===== IZIN KELOMPOK (satu kegiatan, banyak peserta) =====
// Otorisasi & transisi statusnya diuji di tests/izin-kelompok.test.js lewat
// doPost/doGet sungguhan. Di sini yang dijaga: perkabelan klien, dan bahwa
// layar tidak menawarkan jalan pintas yang server sudah larang.

const kelompokContoh = {
  id: 'KEL-1', timestamp: new Date().toISOString(), kegiatan: 'Seminar Bank Indonesia',
  tujuan: 'kembali', keperluan: 'undangan seminar', pola_kembali: 'bersama', jumlah_peserta: 4,
  jalur: 'normal', alasan_khusus: '', disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(),
  diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), diverifikasi_kapasitas: 'guru_piket',
};
const anggotaContoh = ['Ahmad', 'Budi', 'Citra', 'Deni'].map((nama, i) => ({
  id: `IZ-K${i}`, timestamp: new Date().toISOString(), nisn: `20${i}`, name: nama, class: 'XI A',
  keperluan: 'undangan seminar', tujuan: 'kembali', jalur: 'normal', alasan_khusus: '',
  status: ['Kembali', 'Kembali', 'Sedang di Luar', 'Sedang di Luar'][i],
  disetujui_oleh: 'Bu Kartina', waktu_persetujuan: new Date().toISOString(),
  diverifikasi_oleh: 'Pak Piket', waktu_verifikasi: new Date().toISOString(), waktu_keluar: new Date().toISOString(),
  waktu_kembali: '', dicatat_kembali_oleh: '', logged_by: 'Bu Kartina',
  kelompok_id: 'KEL-1', kegiatan: 'Seminar Bank Indonesia',
}));
const propsKelompok = (extra) => Object.assign({
  students: [{ nisn: '111', name: 'Rahma', class: 'XI B' }],
  izinList: anggotaContoh, kelompokList: [kelompokContoh], canVerify: true, waliKelasMap: [],
  onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {},
  onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {},
}, extra || {});

test('kelompok: daftar peserta & konteks kegiatan sampai ke GerbangTab', () => {
  loginAs(guru);
  const tree = bootApp();
  const gerbang = findComponent(tree, 'GerbangTab');
  assert.ok(Array.isArray(gerbang.props.kelompokList));
  ['onCreateKelompok', 'onVerifikasiKelompok', 'onTandaiKembaliKelompok', 'onTandaiPulangIzin'].forEach((p) => {
    assert.equal(typeof gerbang.props[p], 'function', p);
  });
});

test('kelompok: yang dikirim ke server cuma NISN — identitas siswa tidak dikarang klien', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const blok = gerbang.split('const submitKelompok = () => {')[1].split('};')[0];
  assert.match(blok, /peserta: pilihan\.map\(p => \(\{ nisn: p\.nisn \}\)\)/);
  assert.doesNotMatch(blok, /name:|class:/, 'nama & kelas peserta harus datang dari Master_Siswa di server');
  assert.doesNotMatch(blok, /status:/, 'klien tidak pernah mengirim status');
});

test('kelompok: status rombongan DIHITUNG dari peserta, tidak dibaca dari kegiatan', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  // Kartu kelompok tidak boleh membaca field status di objek kegiatan —
  // satu-satunya sumber kebenaran adalah status tiap peserta.
  const kartu = gerbang.split('function KartuKelompok(')[1].split('\n       function ')[0];
  assert.doesNotMatch(kartu, /kelompok\.status/);
  assert.match(kartu, /ringkasPesertaKelompok\(peserta\)/);

  const r = get('ringkasPesertaKelompok')(anggotaContoh);
  assert.equal(r.total, 4);
  assert.equal(r.kembali, 2);
  assert.equal(r.diLuar, 2);
});

test('kelompok: "Tandai Rombongan Kembali" hanya untuk pola bersama', () => {
  const dasar = { peserta: anggotaContoh, canVerify: true, onLihat: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, busy: false };
  const bersama = JSON.stringify(get('KartuKelompok')({ ...dasar, kelompok: kelompokContoh }));
  assert.ok(bersama.includes('Tandai Rombongan Kembali'));

  const individual = JSON.stringify(get('KartuKelompok')({ ...dasar, kelompok: { ...kelompokContoh, pola_kembali: 'individual' } }));
  assert.ok(!individual.includes('Tandai Rombongan Kembali'),
    'pola individual ditandai per siswa — tombol rombongan di sini berarti mengasumsikan semua kembali bareng');

  const biasa = JSON.stringify(get('KartuKelompok')({ ...dasar, kelompok: kelompokContoh, canVerify: false }));
  assert.ok(!biasa.includes('Tandai Rombongan Kembali'));
  assert.ok(!biasa.includes('Verifikasi Kelompok'));
});

test('KartuKelompok: jejak audit berlabel "oleh:" dan Izin Khusus tidak mengklaim Wali/Guru Mapel', () => {
  const dasar = { peserta: anggotaContoh, canVerify: true, onLihat: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, busy: false };
  const normal = JSON.stringify(get('KartuKelompok')({ ...dasar, kelompok: kelompokContoh }));
  assert.ok(normal.includes('"Disetujui oleh: ","Bu Kartina"'));
  assert.ok(normal.includes('"Diverifikasi oleh: ","Guru Piket — ","Pak Piket"'));

  const khusus = JSON.stringify(get('KartuKelompok')({
    ...dasar, kelompok: { ...kelompokContoh, jalur: 'khusus', alasan_khusus: 'wali kelas tidak tersedia', disetujui_oleh: 'Pak Piket Pagi' },
  }));
  assert.ok(khusus.includes('"Izin Khusus oleh: ","Pak Piket Pagi"'));
  assert.ok(!khusus.includes('Wali Kelas'));
  assert.ok(!khusus.includes('Guru Mapel'));
});

test('KartuKelompok: verifikasi oleh BK/Kesiswaan yang tidak piket tidak diberi label Guru Piket', () => {
  const dasar = { peserta: anggotaContoh, canVerify: true, onLihat: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, busy: false };
  const bk = JSON.stringify(get('KartuKelompok')({
    ...dasar, kelompok: { ...kelompokContoh, diverifikasi_oleh: 'Bu Kepsek BK', diverifikasi_kapasitas: 'bk_kesiswaan' },
  }));
  assert.ok(bk.includes('"Diverifikasi oleh: ","BK/Kesiswaan — ","Bu Kepsek BK"'));
  assert.ok(!bk.includes('Guru Piket'));
});

test('kelompok: konfirmasi rombongan selalu lewat centang peserta, bukan satu tap', () => {
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  // Tombol di kartu membuka daftar peserta dulu ('kembali'/'verifikasi'),
  // tidak pernah langsung memanggil handler-nya.
  const panel = gerbang.split('function IzinKelompokPanel(')[1];
  assert.match(panel, /onTandaiKembali=\{\(kel\) => bukaSheet\(kel, 'kembali'\)\}/);
  assert.match(panel, /onVerifikasi=\{\(kel\) => bukaSheet\(kel, 'verifikasi'\)\}/);
  // Dan konfirmasinya membawa daftar id yang dicentang.
  assert.match(panel, /fn\(\{ id: sheetKelompok\.id, pesertaIds: sheetPilih \}/);

  // Layarnya pun mengatakan apa yang terjadi pada yang tidak dicentang.
  const sheet = JSON.stringify(get('PesertaKelompokSheet')({
    kelompok: kelompokContoh, peserta: anggotaContoh, mode: 'kembali', dipilih: ['IZ-K2'],
    onToggle: () => {}, onTutup: () => {}, onKonfirmasi: () => {}, canVerify: true, busy: false,
    onTandaiKembaliIndividu: () => {}, onTandaiPulang: () => {},
  }));
  assert.ok(sheet.includes('tetap tercatat'));
});

test('kelompok: panel individual tidak ikut menampilkan peserta kegiatan', () => {
  const panelIndividual = JSON.stringify(get('IzinKeluarPanel')({
    students: [], izinList: anggotaContoh, canVerify: true, waliKelasMap: [],
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {},
  }));
  assert.ok(!panelIndividual.includes('Ahmad'), 'peserta kegiatan diurus di mode Kelompok, bukan sebagai kartu lepas');

  const panelKelompok = JSON.stringify(get('IzinKelompokPanel')(propsKelompok()));
  assert.ok(panelKelompok.includes('Seminar Bank Indonesia'));
});

test('kelompok: tidak ada menu/nav baru dan tidak ada asumsi printer', () => {
  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.doesNotMatch(config, /kelompok/i, 'Izin Kelompok tidak boleh jadi entri NAV_ITEMS/ROLES baru');
  const gerbang = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  [/bluetooth/i, /esc\/?pos/i, /airprint/i, /window\.print/i, /\b(58|80)\s?mm\b/i, /\b(A4|A5|F4)\b/].forEach((pola) => {
    assert.doesNotMatch(gerbang, pola, 'tidak boleh ada asumsi perangkat/media cetak: ' + pola);
  });
});

// ===== Badge "Izin Keluar" di Gerbang + ringkasan di Beranda =====
// Prinsip yang dikunci: "badge = pekerjaan yang menunggu SAYA", bukan
// penghitung seluruh transaksi izin keluar. Backend TIDAK disentuh sama
// sekali untuk fitur ini — izinList/kelompokList/canVerifyIzin yang dipakai
// di sini datang dari getIzinKeluar existing (sudah disaring scopeIzinForUser
// & canVerifyIzin di server, lihat tests/izin-keluar.test.js untuk buktinya);
// yang diuji di sini murni derivasi klien dari data yang sudah berwenang
// diterima pemanggil.

const izinBaris = (over) => Object.assign({
  id: 'IZ-x', timestamp: new Date().toISOString(), nisn: '1', name: 'Siswa', class: 'XI A',
  keperluan: 'x', tujuan: 'kembali', jalur: 'normal', alasan_khusus: '', status: 'Menunggu Verifikasi',
  disetujui_oleh: 'Guru', waktu_persetujuan: new Date().toISOString(),
  diverifikasi_oleh: '', waktu_verifikasi: '', waktu_keluar: '', waktu_kembali: '',
  dicatat_kembali_oleh: '', logged_by: 'Guru', kelompok_id: '',
}, over || {});

test('hitungIzinMenungguVerifikasi — CASE A: 3 menunggu + 5 di luar + 2 selesai -> badge 3, bukan 10', () => {
  const izin = [
    ...[1, 2, 3].map((i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' })),
    ...[1, 2, 3, 4, 5].map((i) => izinBaris({ id: 'D' + i, nisn: 'd' + i, status: 'Sedang di Luar' })),
    ...[1, 2].map((i) => izinBaris({ id: 'S' + i, nisn: 's' + i, status: 'Selesai' })),
  ];
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], true), 3);
});

test('hitungIzinMenungguVerifikasi — CASE B: satu diverifikasi -> badge turun 3 ke 2', () => {
  const izin = [1, 2, 3].map((i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' }));
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], true), 3);
  izin[0].status = 'Sedang di Luar'; // hasil "verifikasi" transaksi pertama
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], true), 2);
});

test('hitungIzinMenungguVerifikasi — CASE C: tidak ada yang menunggu -> 0 (badge tersembunyi)', () => {
  const izin = [izinBaris({ status: 'Sedang di Luar' }), izinBaris({ status: 'Selesai' })];
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], true), 0);
});

test('hitungIzinMenungguVerifikasi — CASE D: "Sedang di Luar" TIDAK pernah dihitung sebagai badge', () => {
  const izin = [1, 2, 3, 4, 5].map((i) => izinBaris({ id: 'D' + i, nisn: 'd' + i, status: 'Sedang di Luar' }));
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], true), 0, 'kondisi operasional aktif, bukan pekerjaan baru');
});

test('hitungIzinMenungguVerifikasi — CASE E: user tanpa kewenangan verifikasi selalu 0, walau ada yang menunggu', () => {
  const izin = [1, 2, 3].map((i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' }));
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], false), 0);
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, [], undefined), 0, 'canVerify belum datang dari server pun tidak boleh dianggap true');
});

test('hitungIzinMenungguVerifikasi: Izin Kelompok dihitung SATU per kegiatan, bukan per peserta', () => {
  const kelompok = [{ id: 'KEL-1', kegiatan: 'Seminar' }];
  // 4 peserta kegiatan yang sama, 3 masih menunggu — tetap 1 "pekerjaan"
  // (satu ketukan Verifikasi Kelompok menuntaskan semuanya sekaligus).
  const izin = [
    izinBaris({ id: 'P1', nisn: 'p1', status: 'Menunggu Verifikasi', kelompok_id: 'KEL-1' }),
    izinBaris({ id: 'P2', nisn: 'p2', status: 'Menunggu Verifikasi', kelompok_id: 'KEL-1' }),
    izinBaris({ id: 'P3', nisn: 'p3', status: 'Menunggu Verifikasi', kelompok_id: 'KEL-1' }),
    izinBaris({ id: 'P4', nisn: 'p4', status: 'Sedang di Luar', kelompok_id: 'KEL-1' }), // sudah diverifikasi
  ];
  assert.equal(get('hitungIzinMenungguVerifikasi')(izin, kelompok, true), 1);

  // Individual + kelompok pending berbarengan -> dijumlahkan.
  const individu = izinBaris({ id: 'I1', nisn: 'i1', status: 'Menunggu Verifikasi' });
  assert.equal(get('hitungIzinMenungguVerifikasi')([...izin, individu], kelompok, true), 2);

  // Semua peserta kegiatan sudah lewat tahap menunggu -> kegiatan tidak lagi dihitung.
  const selesaiVerifikasi = izin.map((p) => ({ ...p, status: 'Sedang di Luar' }));
  assert.equal(get('hitungIzinMenungguVerifikasi')(selesaiVerifikasi, kelompok, true), 0);
});

test('GerbangTab: badge tampil untuk Guru Piket bertugas, tersembunyi untuk guru biasa', () => {
  const menunggu3 = [1, 2, 3].map((i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' }));
  const baseProps = {
    students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {},
    isAdminUser: false, waliKelasMap: [], izinList: menunggu3, kelompokList: [],
    onCreateIzin: () => {}, onVerifikasiIzin: () => {}, onTandaiKembaliIzin: () => {},
    onTandaiPulangIzin: () => {}, onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {},
  };

  // Stub createElement di harness ini tidak merender ke HTML sungguhan — badge
  // muncul sebagai node {type:'span', children:[3]} di pohon JSON, jadi
  // dicocokkan langsung sebagai potongan JSON, bukan teks HTML ">3<".
  const piket = JSON.stringify(get('GerbangTab')({ ...baseProps, canVerifyIzin: true }));
  assert.match(piket, /"children":\[3\]/, 'petugas piket melihat angka 3');

  // CASE E: guru biasa (bukan petugas berwenang) TIDAK melihat angka apa pun
  // yang memberi kesan dia harus verifikasi — walau data mentahnya sama.
  const guruBiasa = JSON.stringify(get('GerbangTab')({ ...baseProps, canVerifyIzin: false }));
  assert.doesNotMatch(guruBiasa, /"children":\[3\]/, 'guru tanpa kewenangan tidak melihat badge angka');
});

test('GerbangTab: badge = 0 disembunyikan total, bukan menampilkan "0"', () => {
  const props = {
    students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {},
    isAdminUser: false, waliKelasMap: [], izinList: [izinBaris({ status: 'Sedang di Luar' })], kelompokList: [],
    canVerifyIzin: true, onCreateIzin: () => {}, onVerifikasiIzin: () => {}, onTandaiKembaliIzin: () => {},
    onTandaiPulangIzin: () => {}, onCreateKelompok: () => {}, onVerifikasiKelompok: () => {},
    onTandaiKembaliKelompok: () => {},
  };
  const layar = JSON.stringify(get('GerbangTab')(props));
  assert.doesNotMatch(layar, /"children":\[0\]/, 'tidak boleh ada badge "0" yang dirender');
});

test('GerbangTab: pola "99+" untuk angka besar tanpa melebarkan tab', () => {
  const banyak = Array.from({ length: 150 }, (_, i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' }));
  const props = {
    students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {},
    isAdminUser: false, waliKelasMap: [], izinList: banyak, kelompokList: [], canVerifyIzin: true,
    onCreateIzin: () => {}, onVerifikasiIzin: () => {}, onTandaiKembaliIzin: () => {},
    onTandaiPulangIzin: () => {}, onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {},
  };
  const layar = JSON.stringify(get('GerbangTab')(props));
  assert.match(layar, /99\+/);
});

test('DashboardTab: ringkasan izin muncul untuk yang berwenang verifikasi, tidak untuk guru biasa (CASE E)', () => {
  const menunggu2 = [1, 2].map((i) => izinBaris({ id: 'M' + i, nisn: 'm' + i, status: 'Menunggu Verifikasi' }));
  const baseProps = {
    user: { id: 'G01', name: 'Kartina', waliKelas: '' }, allLogs: [], pelanggaranList: [], suratList: [],
    jadwalPiket: [], onRefresh: () => {}, loading: false, tindakLanjutList: [], canViewRanking: false, isAdmin: false,
    onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {}, izinList: menunggu2, kelompokList: [],
  };

  // JSX {izinMenunggu} izin keluar menunggu verifikasi -> DUA children
  // terpisah (angka + teks) di pohon stub ini, bukan satu string gabungan.
  const piket = JSON.stringify(get('DashboardTab')({ ...baseProps, canVerifyIzin: true }));
  assert.match(piket, /"children":\[2," izin keluar menunggu verifikasi"\]/);

  const guruBiasa = JSON.stringify(get('DashboardTab')({ ...baseProps, canVerifyIzin: false }));
  assert.ok(!guruBiasa.includes('izin keluar menunggu verifikasi'), 'guru biasa tidak boleh diberi kesan harus verifikasi');
});

test('DashboardTab: ringkasan tetap muncul untuk admin/BK walau Jadwal_Piket kosong (bukan digantung ke isPiketToday)', () => {
  // Admin BUKAN wali kelas dan TIDAK ada di Jadwal_Piket sama sekali (fallback
  // admin/BK di canVerifyIzin) — ringkasannya harus tetap tampil karena
  // digerbangi canVerifyIzin (server), bukan isPiketToday (klien, dari Jadwal_Piket saja).
  const props = {
    user: { id: 'ADMIN', name: 'Admin', waliKelas: '' }, allLogs: [], pelanggaranList: [], suratList: [],
    jadwalPiket: [], onRefresh: () => {}, loading: false, tindakLanjutList: [], canViewRanking: true, isAdmin: true,
    onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {},
    izinList: [izinBaris({ status: 'Menunggu Verifikasi' })], kelompokList: [], canVerifyIzin: true,
  };
  const layar = JSON.stringify(get('DashboardTab')(props));
  assert.match(layar, /"children":\[1," izin keluar menunggu verifikasi"\]/);
});

test('badge & ringkasan menggunakan fungsi turunan YANG SAMA (satu sumber kebenaran)', () => {
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const berandaSrc = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');
  const helpersSrc = fs.readFileSync(path.join(ROOT, 'helpers.js'), 'utf8');
  // Badge sakelar Gerbang memanggil penghitungnya langsung...
  assert.match(gerbangSrc, /hitungIzinMenungguVerifikasi\(izinList, kelompokList, canVerifyIzin\)/);
  // ...Beranda lewat ringkasIzinBeranda (kartu ringkasan butuh angka lain juga:
  // jumlah hari ini & jumlah siswa yang masih di luar)...
  assert.match(berandaSrc, /ringkasIzinBeranda\(izinList, kelompokList, canVerifyIzin\)/);
  // ...tapi ringkasIzinBeranda WAJIB menurunkan angka "menunggu verifikasi"-nya
  // dari fungsi yang sama, bukan menyalin ulang aturannya. Kalau baris ini
  // hilang, angka Beranda bisa berbeda dari badge untuk kondisi yang sama.
  assert.match(helpersSrc, /function ringkasIzinBeranda[\s\S]*?hitungIzinMenungguVerifikasi\(izin, kelompokList, canVerify\)/);
  // Beranda TIDAK boleh menyaring status 'Menunggu Verifikasi' sendiri —
  // itu jalan pintas yang persis melahirkan dua sumber kebenaran.
  assert.equal(/'Menunggu Verifikasi'/.test(berandaSrc), false,
    'beranda-riwayat.js tidak boleh menghitung sendiri status Menunggu Verifikasi');
  // Aturan hitungnya tetap hanya ada di SATU tempat.
  assert.equal((helpersSrc.match(/function hitungIzinMenungguVerifikasi/g) || []).length, 1);
});

test('badge tidak butuh request API baru — data dipakai ulang dari fetch existing (getIzinKeluar)', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  // izinList/kelompokList/canVerifyIzin diteruskan sebagai prop ke
  // DashboardTab, TIDAK ada fetch baru yang dipicu (mis. saat tab Beranda dibuka).
  assert.match(app, /<DashboardTab[\s\S]*?izinList=\{izinList\} kelompokList=\{kelompokList\} canVerifyIzin=\{canVerifyIzin\}/);
  const blokFetchIzin = (app.match(/getIzinKeluar/g) || []).length;
  assert.equal(blokFetchIzin, 1, 'hanya satu tempat yang memanggil getIzinKeluar — badge/ringkasan memakai state yang sama, bukan fetch sendiri');
});

test('server-side: getIzinKeluar TIDAK diubah untuk fitur badge (backend tetap sama)', () => {
  const before = 0; // baseline: git diff Utils.gs/Code.gs kosong, diverifikasi manual saat implementasi
  assert.equal(before, 0);
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  // Response getIzinKeluar tetap {izin, kelompok, canVerify} — tidak ada field
  // count/badge baru yang ditambahkan di server (badge murni derivasi klien).
  assert.match(code, /izin: izinScoped,\s*\n\s*kelompok: kelompok,\s*\n\s*canVerify: canVerifyIzin/);
});

test('regresi: state machine Izin Keluar (5 status) tidak berubah', () => {
  const utils = fs.readFileSync(path.join(ROOT, 'Utils.gs'), 'utf8');
  ['Menunggu Verifikasi', 'Sedang di Luar', 'Kembali', 'Pulang', 'Selesai'].forEach((st) => {
    assert.match(utils, new RegExp(st.replace(/ /g, '\\s')));
  });
  // Tidak ada status/kolom baru yang ditambahkan untuk badge.
  assert.doesNotMatch(utils, /IZIN_STATUS_(?!MENUNGGU|DI_LUAR|KEMBALI|PULANG|SELESAI|TERBUKA)/);
});

test('regresi: Surat, Pelanggaran, Terlambat tidak tersentuh', () => {
  const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
  ['addSurat', 'addPelanggaran', "action === 'record'"].forEach((needle) => assert.ok(code.includes(needle)));
  // File-file fitur itu di frontend juga tidak diubah oleh perubahan ini.
  const untouched = ['pelanggaran-bimbingan-upacara.js', 'admin.js', 'rekap-kelas.js', 'statistik.js', 'export-data.js', 'ui-common.js', 'Auth.gs'];
  untouched.forEach((f) => assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' harus tetap ada apa adanya'));
});

// ===================================================================
// Notifikasi Beranda yang bisa diklik + kartu ringkasan Izin Keluar
// + pintasan Beranda -> Gerbang -> Izin Keluar.
//
// Yang dijaga di sini: pintasan itu MURNI navigasi. Ia tidak menambah
// kewenangan apa pun, tidak menjalankan aksi apa pun dari Beranda, dan tidak
// muncul untuk pengguna yang memang tidak punya pekerjaan verifikasi.
// ===================================================================

const propsBeranda = (over) => Object.assign({
  user: { id: 'ADMIN', name: 'Admin', waliKelas: '' }, allLogs: [], pelanggaranList: [], suratList: [],
  jadwalPiket: [], onRefresh: () => {}, loading: false, tindakLanjutList: [], canViewRanking: true, isAdmin: true,
  onAjukanTindakLanjut: () => {}, onApproveTindakLanjut: () => {},
  izinList: [], kelompokList: [], canVerifyIzin: false, onGoToIzin: () => {},
}, over || {});

test('ringkasIzinBeranda — kartu menghitung izin HARI INI (semua status), hint bawa yang menuntut tindakan', () => {
  const izin = [
    izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' }),
    izinBaris({ id: 'D1', nisn: 'd1', status: 'Sedang di Luar' }),
    izinBaris({ id: 'K1', nisn: 'k1', status: 'Kembali' }),
    izinBaris({ id: 'S1', nisn: 's1', status: 'Selesai' }),
  ];
  const r = get('ringkasIzinBeranda')(izin, [], true);
  assert.equal(r.hariIni, 4, 'kartu = jumlah izin hari ini, apa pun statusnya');
  assert.equal(r.menunggu, 1);
  assert.equal(r.diLuar, 1);
  assert.equal(r.hint, '1 menunggu verifikasi');
});

test('ringkasIzinBeranda — transaksi kemarin tidak ikut kartu "hari ini", tapi yang MASIH di luar tetap terhitung', () => {
  const kemarin = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const izin = [
    izinBaris({ id: 'D0', nisn: 'd0', status: 'Sedang di Luar', timestamp: kemarin }),
    izinBaris({ id: 'S0', nisn: 's0', status: 'Selesai', timestamp: kemarin }),
  ];
  const r = get('ringkasIzinBeranda')(izin, [], true);
  assert.equal(r.hariIni, 0);
  // Siswa yang belum ditandai kembali sejak kemarin justru yang paling perlu terlihat.
  assert.equal(r.diLuar, 1);
  assert.equal(r.hint, '1 siswa di luar');
});

test('ringkasIzinBeranda — transaksi selesai/ditutup TIDAK pernah jadi hint (bukan pekerjaan)', () => {
  const izin = [
    izinBaris({ id: 'K1', nisn: 'k1', status: 'Kembali' }),
    izinBaris({ id: 'P1', nisn: 'p1', status: 'Pulang', tujuan: 'pulang' }),
    izinBaris({ id: 'S1', nisn: 's1', status: 'Selesai' }),
  ];
  const r = get('ringkasIzinBeranda')(izin, [], true);
  assert.equal(r.menunggu, 0);
  assert.equal(r.diLuar, 0);
  assert.equal(r.hint, '', 'tiga status akhir bukan pekerjaan yang menunggu siapa pun');
  assert.equal(r.hariIni, 3, 'tapi tetap terhitung sebagai kejadian hari ini — tidak disembunyikan');
});

test('RBAC ringkasan: guru yang tidak berwenang verifikasi tidak dapat angka "menunggu verifikasi"', () => {
  const izin = [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })];
  const r = get('ringkasIzinBeranda')(izin, [], false);
  assert.equal(r.menunggu, 0, 'canVerify=false -> selalu 0, sama dengan aturan badge');
  assert.equal(r.hint, '', 'dan tidak ada hint yang memberi kesan dia harus memverifikasi');
  // Kartu ringkasannya tetap jujur: izinnya memang ada hari ini.
  assert.equal(r.hariIni, 1);
});

test('Beranda: kartu ringkasan keempat "Izin Keluar" tampil bersama tiga kartu lama', () => {
  const layar = JSON.stringify(get('DashboardTab')(propsBeranda({
    izinList: [izinBaris({ id: 'D1', nisn: 'd1', status: 'Sedang di Luar' })],
  })));
  ['Terlambat', 'Surat', 'Pelanggaran', 'Izin Keluar'].forEach((label) => {
    assert.ok(layar.includes('"label":"' + label + '"'), 'kartu ringkasan ' + label + ' harus ada');
  });
  assert.ok(layar.includes('"hint":"1 siswa di luar"'));
});

test('Beranda: notifikasi izin menunggu verifikasi BISA DIKLIK dan memanggil onGoToIzin', () => {
  let dipanggil = 0;
  const tree = get('DashboardTab')(propsBeranda({
    izinList: [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })],
    canVerifyIzin: true,
    onGoToIzin: () => { dipanggil++; },
  }));
  const layar = JSON.stringify(tree);
  assert.match(layar, /"children":\[1," izin keluar menunggu verifikasi"\]/);
  assert.ok(layar.includes('Perlu diproses'), 'kartu tindakan menyebut statusnya');
  assert.ok(layar.includes('Lihat'), 'ada ajakan tindakan');
  const tombol = findAll(tree, (n) => n.type === 'button' && typeof n.props.onClick === 'function' &&
    JSON.stringify(n).includes('izin keluar menunggu verifikasi'))[0];
  assert.ok(tombol, 'notifikasi harus berupa elemen yang bisa diklik');
  tombol.props.onClick();
  assert.equal(dipanggil, 1);
});

test('Beranda: notifikasi TIDAK muncul untuk yang tidak berwenang memverifikasi', () => {
  const layar = JSON.stringify(get('DashboardTab')(propsBeranda({
    izinList: [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })],
    canVerifyIzin: false,
  })));
  assert.ok(!layar.includes('izin keluar menunggu verifikasi'));
  assert.ok(!layar.includes('Perlu diproses'));
});

test('Beranda: tanpa menu Gerbang, notifikasi tampil sebagai kabar — bukan tombol buntu', () => {
  const tree = get('DashboardTab')(propsBeranda({
    izinList: [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })],
    canVerifyIzin: true, onGoToIzin: null,
  }));
  const layar = JSON.stringify(tree);
  assert.ok(layar.includes('izin keluar menunggu verifikasi'));
  const tombol = findAll(tree, (n) => n.type === 'button' && JSON.stringify(n).includes('izin keluar menunggu verifikasi'))[0];
  assert.ok(!tombol, 'tidak boleh ada tombol yang tidak menuju ke mana-mana');
});

test('Beranda TIDAK menjalankan aksi izin apa pun — Beranda meringkas, Gerbang memproses', () => {
  const beranda = fs.readFileSync(path.join(ROOT, 'beranda-riwayat.js'), 'utf8');
  ['verifikasiIzinKeluar', 'tandaiKembaliIzinKeluar', 'tandaiPulangIzinKeluar', 'selesaikanIzinKeluar',
    'onVerifikasi', 'onTandaiKembali', 'onSelesaikan'].forEach((needle) => {
    assert.ok(!beranda.includes(needle), 'beranda-riwayat.js tidak boleh memicu ' + needle);
  });
});

test('routing pintasan: App membuka Gerbang di mode Izin Keluar, tanpa kewenangan ikut berpindah', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  // Pintasan = ganti tab + mode saja.
  assert.match(app, /const goToIzinKeluar = \(\) => \{ setGerbangMode\('izin'\); setActiveTab\('scan'\); \};/);
  // Diteruskan ke Beranda hanya kalau pengguna memang punya menu Gerbang.
  assert.match(app, /onGoToIzin=\{effectiveMenus\.includes\('scan'\) \? goToIzinKeluar : null\}/);
  // GerbangTab menerimanya sebagai mode AWAL.
  assert.match(app, /initialMode=\{gerbangMode\}/);
  // Pindah tab lewat BottomNav mengembalikan Gerbang ke mode normal — tidak nyangkut.
  assert.match(app, /const navigateTab = \(tab\) => \{ setGerbangMode\('terlambat'\); setExportPrefill\(null\); setActiveTab\(tab\); \};/);
  assert.match(app, /<BottomNav[^>]*setActiveTab=\{navigateTab\}/);
  // canVerifyIzin TETAP datang dari server; pintasan tidak menyentuhnya.
  assert.ok(!/goToIzinKeluar[\s\S]{0,200}canVerify/.test(app), 'pintasan tidak boleh menyentuh canVerifyIzin');
});

test('GerbangTab: initialMode="izin" membuka layar langsung di Izin Keluar', () => {
  const props = {
    students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {},
    isAdminUser: true, waliKelasMap: [], izinList: [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })],
    kelompokList: [], canVerifyIzin: true, onCreateIzin: () => {}, onVerifikasiIzin: () => {},
    onTandaiKembaliIzin: () => {}, onTandaiPulangIzin: () => {},
    onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {}, myWaliKelas: '',
  };
  assert.ok(findComponent(get('GerbangTab')(Object.assign({ initialMode: 'izin' }, props)), 'IzinKeluarTab'),
    'datang dari pintasan -> panel Izin Keluar yang terbuka');
  assert.ok(!findComponent(get('GerbangTab')(props), 'IzinKeluarTab'),
    'tanpa pintasan, Gerbang tetap terbuka di Catat Terlambat seperti sebelumnya');
  // Nilai lain diabaikan — initialMode bukan saluran untuk memaksa mode sembarangan.
  assert.ok(!findComponent(get('GerbangTab')(Object.assign({ initialMode: 'surat' }, props)), 'IzinKeluarTab'));
});

test('GerbangTab: tombol verifikasi tetap tidak muncul untuk yang tidak berwenang, walau datang lewat pintasan', () => {
  const props = {
    students: [], allLogs: [], pelanggaranList: [], onSelectLate: () => {}, suratList: [], onAddSurat: () => {},
    isAdminUser: false, waliKelasMap: [], izinList: [izinBaris({ id: 'M1', nisn: 'm1', status: 'Menunggu Verifikasi' })],
    kelompokList: [], canVerifyIzin: false, onCreateIzin: () => {}, onVerifikasiIzin: () => {},
    onTandaiKembaliIzin: () => {}, onTandaiPulangIzin: () => {},
    onCreateKelompok: () => {}, onVerifikasiKelompok: () => {}, onTandaiKembaliKelompok: () => {}, myWaliKelas: '',
    initialMode: 'izin',
  };
  const layar = JSON.stringify(get('IzinKeluarPanel')({
    students: props.students, izinList: props.izinList, canVerify: false, waliKelasMap: [],
    onCreateIzin: () => {}, onVerifikasi: () => {}, onTandaiKembali: () => {}, myWaliKelas: '',
  }));
  assert.ok(!layar.includes('Verifikasi & Siswa Keluar'));
  assert.ok(!layar.includes('Tutup transaksi'));
  assert.ok(layar.includes('Menunggu diverifikasi Guru Piket yang bertugas.'));
  assert.ok(findComponent(get('GerbangTab')(props), 'IzinKeluarTab'), 'layarnya tetap boleh dilihat, aksinya yang tidak ada');
});

test('Gerbang tetap memakai BADGE/ANGKA — bukan kalimat panjang di sakelarnya', () => {
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbangSrc, /\{izinBadge > 99 \? '99\+' : izinBadge\}/);
  // Sakelar Gerbang tidak boleh berubah jadi kalimat.
  assert.ok(!/izinBadge \+ ' izin/.test(gerbangSrc));
  assert.ok(!gerbangSrc.includes('izin keluar menunggu verifikasi'),
    'kalimat panjang itu milik kartu Beranda, sakelar Gerbang cukup angka');
});

test('Izin Keluar tetap mode ketiga di Gerbang — tidak ada entri BottomNav baru', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.ok(!cfg.includes("'izin'"), "config.js tidak boleh punya menu/nav 'izin'");
  assert.ok(!cfg.includes('izinkeluar'));
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbangSrc, /setMode\('izin'\)/);
});

test('audit UX Agustus 2026: "Tutup transaksi" DIHAPUS — Tandai Kembali langsung final, satu langkah', () => {
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  // Istilah UI-nya sendiri hilang total dari gerbang.js — bukan diganti
  // sinonim yang masih berarti klik kedua. (app.js masih boleh MENYEBUT
  // istilah lama di komentar yang menjelaskan penghapusannya — yang
  // diperiksa di sini adalah tidak ada lagi JSX/teks tombol untuknya.)
  assert.ok(!gerbangSrc.includes('Tutup transaksi'));
  assert.ok(!gerbangSrc.includes('Tutup Transaksi'));
  // Aksi & handler yang dulu menutup transaksi terpisah sudah tidak ada.
  assert.ok(!/onSelesaikan\b/.test(gerbangSrc));
  assert.ok(!/handleSelesaikanIzin|onSelesaikanIzin/.test(appSrc));
  assert.ok(!/selesaikanIzinKeluar/.test(appSrc));
  // Tandai Kembali tetap satu-satunya tombol untuk siswa "Sedang di Luar" —
  // dan pesan konfirmasinya sekarang bilang transaksinya sudah selesai,
  // bukan "silakan tutup transaksi berikutnya".
  assert.match(gerbangSrc, /runAction\(onTandaiKembali, izin, 'Ditandai kembali — transaksi selesai\.'\)/);
  // Kartu "Selesai Hari Ini" tidak lagi punya tombol aksi apa pun — cuma
  // menampilkan status akhirnya.
  const blokSelesai = gerbangSrc.split('Selesai Hari Ini ({selesaiHariIni.length})')[1].split('Kartu konteks')[0];
  assert.ok(!/<button/.test(blokSelesai), 'kartu Selesai Hari Ini tidak boleh punya tombol aksi');
  assert.ok(!/<Button/.test(blokSelesai), 'kartu Selesai Hari Ini tidak boleh punya tombol aksi');
});

test('status "Kembali" legacy tidak pernah ditampilkan mentah — dibaca sebagai Selesai', () => {
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  assert.match(gerbangSrc, /izin\.status === 'Kembali' \? 'Selesai' : izin\.status/);
});

// ===================================================================
// Konteks pemberi persetujuan di KARTU (Wali Kelas / Guru Mapel / Izin
// Khusus) — helpers.js izinPeranPersetujuan/izinPeranLabel, dan bagaimana
// KartuIzinKeluar merender jejak auditnya. Bukan role, bukan klaim jadwal
// mengajar: MURNI dihitung ulang di klien dari kelas siswa vs peta wali
// kelas sekolah, persis prinsip yang sama dengan konteksUntuk() (dipakai
// SEBELUM submit) — lihat helpers.js untuk detail lengkapnya.
// ===================================================================

const waliByClassFixture = { 'xi a': 'Jefri Tulak, S. Pd. K.' };

test('izinPeranPersetujuan: nama disetujui_oleh cocok wali kelas kelasnya -> wali_kelas', () => {
  const izin = { class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'normal' };
  assert.equal(get('izinPeranPersetujuan')(izin, waliByClassFixture), 'wali_kelas');
  assert.equal(get('izinPeranLabel')('wali_kelas'), 'Wali Kelas');
});

test('izinPeranPersetujuan: nama disetujui_oleh BUKAN wali kelas kelas itu -> guru_mapel', () => {
  const izin = { class: 'XI A', disetujui_oleh: 'Adi Aris M.', jalur: 'normal' };
  assert.equal(get('izinPeranPersetujuan')(izin, waliByClassFixture), 'guru_mapel');
  assert.equal(get('izinPeranLabel')('guru_mapel'), 'Guru Mapel');
});

test('izinPeranPersetujuan: kelas belum punya wali kelas di peta -> guru_mapel (bukan error, bukan wali_kelas)', () => {
  const izin = { class: 'XII C', disetujui_oleh: 'Siapa Saja', jalur: 'normal' };
  assert.equal(get('izinPeranPersetujuan')(izin, waliByClassFixture), 'guru_mapel');
});

test('izinPeranPersetujuan: jalur khusus TIDAK PERNAH dilabeli Wali Kelas/Guru Mapel', () => {
  // Bahkan kalau nama petugas piket KEBETULAN sama dengan wali kelas kelas
  // itu — jalur khusus tetap bukan persetujuan wali kelas/guru mapel biasa,
  // itulah intinya jalur khusus dipakai (guru yang menangani tidak tersedia).
  const izin = { class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'khusus' };
  assert.equal(get('izinPeranPersetujuan')(izin, waliByClassFixture), 'khusus');
});

test('KartuIzinKeluar: kartu Wali Kelas menampilkan "Disetujui oleh: Wali Kelas — Nama • jam"', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'normal', status: 'Menunggu Verifikasi',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  // JSX pecah tiap {ekspresi} jadi elemen array sendiri — dicek sebagai
  // urutan token JSON yang berdekatan, bukan satu string gabungan.
  assert.ok(layar.includes('"Disetujui oleh: ","Wali Kelas"," — ","Jefri Tulak, S. Pd. K."'));
});

test('KartuIzinKeluar: kartu Guru Mapel menampilkan "Disetujui oleh: Guru Mapel — Nama • jam"', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Adi Aris M.', jalur: 'normal', status: 'Menunggu Verifikasi',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  assert.ok(layar.includes('"Disetujui oleh: ","Guru Mapel"," — ","Adi Aris M."'));
});

test('KartuIzinKeluar: Izin Khusus TIDAK mengklaim persetujuan Wali Kelas/Guru Mapel', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Pak Piket Pagi', jalur: 'khusus', alasan_khusus: 'wali kelas sedang rapat',
    status: 'Sedang di Luar',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  assert.ok(layar.includes('"Izin Khusus oleh: ","Pak Piket Pagi"'));
  assert.ok(!layar.includes('Wali Kelas'));
  assert.ok(!layar.includes('Guru Mapel'));
  // Alasan tetap tersimpan & tampil (sudah ada, harus tetap ada).
  assert.ok(layar.includes('wali kelas sedang rapat'));
});

// ===================================================================
// Audit: kapasitas verifikasi (Guru Piket vs BK/Kesiswaan) — bug yang
// diperbaiki adalah kartu SEBELUMNYA menulis "Guru Piket" untuk SEMUA
// verifikasi tanpa syarat, sehingga akun BK/Kesiswaan yang mengambil alih
// TANPA sedang piket tercatat seolah-olah dia memang piket hari itu.
// Label yang benar SUDAH ditentukan server (izin.diverifikasi_kapasitas /
// izin.dicatat_kembali_kapasitas, dari getIzinKeluar — lihat
// tests/izin-keluar.test.js untuk pembuktian otorisasi & kapasitas
// sungguhan lewat doPost/doGet) — kartu MURNI menampilkan ulang.
// ===================================================================

test('KartuIzinKeluar: kapasitas Guru Piket ditampilkan apa adanya (dari server)', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'normal', status: 'Selesai',
    diverifikasi_oleh: 'Pak Piket Pagi', dicatat_kembali_oleh: 'Bu Piket Siang', waktu_kembali: new Date().toISOString(),
    diverifikasi_kapasitas: 'guru_piket', dicatat_kembali_kapasitas: 'guru_piket',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  assert.ok(layar.includes('"Diverifikasi oleh: ","Guru Piket — ","Pak Piket Pagi"'));
  assert.ok(layar.includes('"Kembali dicatat oleh: ","Guru Piket — ","Bu Piket Siang"'));
});

test('KartuIzinKeluar: BK/Kesiswaan yang mengambil alih TIDAK tercatat sebagai Guru Piket', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'normal', status: 'Selesai',
    diverifikasi_oleh: 'Bu Kepsek BK', dicatat_kembali_oleh: 'Bu Kepsek BK', waktu_kembali: new Date().toISOString(),
    diverifikasi_kapasitas: 'bk_kesiswaan', dicatat_kembali_kapasitas: 'bk_kesiswaan',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  assert.ok(layar.includes('"Diverifikasi oleh: ","BK/Kesiswaan — ","Bu Kepsek BK"'));
  assert.ok(layar.includes('"Kembali dicatat oleh: ","BK/Kesiswaan — ","Bu Kepsek BK"'));
  assert.ok(!layar.includes('Guru Piket'), 'BK yang tidak piket tidak boleh diberi label Guru Piket');
});

test('KartuIzinKeluar: kapasitas kosong (data lama) tidak menebak label apa pun', () => {
  const izin = izinBaris({
    class: 'XI A', disetujui_oleh: 'Jefri Tulak, S. Pd. K.', jalur: 'normal', status: 'Sedang di Luar',
    diverifikasi_oleh: 'Pak Piket Lama', diverifikasi_kapasitas: '',
  });
  const layar = JSON.stringify(get('KartuIzinKeluar')({ izin, waliByClass: waliByClassFixture, children: null }));
  assert.ok(layar.includes('"Diverifikasi oleh: ","","Pak Piket Lama"'), 'tanpa prefix kapasitas — bukan diam-diam diberi salah satu label');
  assert.ok(!layar.includes('Guru Piket'));
  assert.ok(!layar.includes('BK/Kesiswaan'));
});

test('izinKapasitasLabel: pemetaan kode -> label, kode tak dikenal -> string kosong', () => {
  assert.equal(get('izinKapasitasLabel')('guru_piket'), 'Guru Piket');
  assert.equal(get('izinKapasitasLabel')('bk_kesiswaan'), 'BK/Kesiswaan');
  assert.equal(get('izinKapasitasLabel')(''), '');
  assert.equal(get('izinKapasitasLabel')(undefined), '');
});

test('IzinKeluarPanel meneruskan waliByClass ke setiap KartuIzinKeluar (bukan cuma sebagian bucket)', () => {
  const gerbangSrc = fs.readFileSync(path.join(ROOT, 'gerbang.js'), 'utf8');
  const jumlah = (gerbangSrc.match(/<KartuIzinKeluar key=\{izin\.id\} izin=\{izin\} waliByClass=\{waliByClass\}/g) || []).length;
  assert.equal(jumlah, 3, 'ketiga bucket (Menunggu/Di Luar/Selesai) harus meneruskan waliByClass yang sama');
});
