// ===== app.js =====
// Komponen utama App(): login, sesi, fetch data, semua handler simpan,
// dan render seluruh tampilan. Dimuat PALING TERAKHIR.

       // Sesi login disimpan di localStorage supaya tidak logout tiap refresh.
       // Sesi di server (CacheService) hidup MAKSIMAL 6 jam sejak login; batas
       // itu sekarang ditegakkan eksplisit lewat loginAt di dalam record sesi
       // (lihat createSession/getSessionUser di Auth.gs). localStorage cuma
       // "mengingat" token itu — validitas sebenarnya tetap ditentukan server di
       // setiap panggilan API.
       //
       // ⚠️ BUG YANG PERNAH TERJADI — jangan diulang: dulu `user` dipulihkan
       // dari localStorage TANPA cek umur sama sekali. Karena sesi server mati
       // setelah 6 jam sementara localStorage tidak pernah kedaluwarsa, membuka
       // aplikasi keesokan harinya me-render tampilan "sudah login" lengkap
       // dengan NAMA guru di Header — padahal semua datanya kosong dan tidak
       // ada yang bisa dikerjakan. Beberapa detik kemudian respons pertama dari
       // Apps Script datang berisi "Sesi berakhir", checkSession() memaksa
       // logout, nama itu hilang begitu saja, dan barulah layar login muncul.
       // Itulah "form tidak bisa diklik lalu nama hilang sendiri" yang
       // dilaporkan guru. Stempel kedaluwarsa di bawah ini yang mencegahnya:
       // sesi yang sudah lewat umur tidak pernah dipakai untuk render sama
       // sekali, jadi aplikasi langsung membuka layar login yang bisa dipakai.
       //
       // SESSION_MAX_AGE_MS + bentuk record-nya sekarang ada di helpers.js
       // (buildSessionRecord/parseSessionRecord) supaya bisa dites langsung
       // tanpa React — lihat blok "Sesi login: SATU record utuh" di sana untuk
       // alasan kenapa tiga kunci terpisah diganti satu record.

       function loadStoredSession() {
           try {
               const stored = parseSessionRecord(localStorage.getItem(SESSION_STORAGE_KEY));
               if (stored.token || stored.expired) return stored;
               // Belum ada record baru — coba format tiga-kunci lama, supaya
               // deploy ini tidak melogout guru yang saat itu sedang login.
               // Yang berhasil dibaca langsung ditulis ulang sebagai satu
               // record dan kunci lamanya dibuang (migrasi sekali jalan).
               const legacy = parseLegacySession(
                   localStorage.getItem(SESSION_LEGACY_KEYS.token),
                   localStorage.getItem(SESSION_LEGACY_KEYS.user),
                   localStorage.getItem(SESSION_LEGACY_KEYS.expires)
               );
               if (legacy.token) saveStoredSession(legacy.token, legacy.user, legacy.expiresAt, legacy.loginAt);
               else if (legacy.expired) removeLegacySessionKeys();
               return legacy;
           } catch (e) {}
           return { token: null, user: null, expired: false, expiresAt: 0, loginAt: 0 };
       }

       // SATU setItem — tidak ada lagi keadaan "token tersimpan tapi stempelnya
       // tidak", yang dulu terbaca sebagai sesi kedaluwarsa palsu.
       function saveStoredSession(token, user, expiresAt, loginAt) {
           try {
               localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(buildSessionRecord(token, user, expiresAt, loginAt)));
               removeLegacySessionKeys();
               return true;
           } catch (e) {
               // Kuota penuh / mode privat. Sesi tetap hidup di memori untuk
               // pemakaian sekarang; yang hilang cuma kemampuan bertahan
               // melewati reload — dan itu jauh lebih baik daripada
               // meninggalkan record separuh jadi yang bikin logout palsu.
               return false;
           }
       }

       function removeLegacySessionKeys() {
           try {
               localStorage.removeItem(SESSION_LEGACY_KEYS.token);
               localStorage.removeItem(SESSION_LEGACY_KEYS.user);
               localStorage.removeItem(SESSION_LEGACY_KEYS.expires);
           } catch (e) {}
       }

       // 4 kemungkinan role: admin, bk_kesiswaan, guru, osis — default ke 'guru'
       // kalau role tidak dikenali. Dipakai App() dan juga nilai awal activeTab,
       // makanya ditarik keluar jadi satu fungsi (dulu logikanya ditulis dua
       // kali dan sempat beda).
       function resolveRoleKey(user) {
           const key = String((user && user.role) || '').toLowerCase().trim();
           return ROLES[key] ? key : 'guru';
       }

       function App() {
           // useState dengan initializer fungsi = dijalankan SEKALI saat mount,
           // bukan tiap render. Sebelumnya loadStoredSession() dipanggil langsung
           // di badan App(), jadi setiap perubahan state apa pun memicu baca
           // localStorage + JSON.parse ulang secara percuma.
           const [storedSession] = useState(loadStoredSession);
           // Snapshot data terakhir milik pengguna ini. null kalau tidak ada,
           // beda pengguna, versi cache berbeda, atau sesinya sudah lewat umur —
           // jadi cache tidak akan pernah membuat orang terlihat masih login.
           const [bootCache] = useState(() => {
               if (!storedSession.user) return null;
               try { return readClientCache(localStorage.getItem(CLIENT_CACHE_KEY), storedSession.user.id); } catch (e) { return null; }
           });
           const bootData = (bootCache && bootCache.data) || {};

           const [user, setUser] = useState(storedSession.user);
           const [sessionToken, setSessionToken] = useState(storedSession.token);
           // Batas akhir sesi yang sedang dipegang. Dipakai untuk menstempel
           // snapshot data (lihat efek cache di bawah), dan disinkronkan ke
           // angka dari server setiap kali respons membawa sessionExpiresAt.
           const sessionExpiresAt = useRef(storedSession.expiresAt || 0);
           const sessionLoginAt = useRef(storedSession.loginAt || 0);
           // Token yang SEDANG aktif, terbaca seketika (bukan menunggu render
           // berikutnya seperti state). Inilah pembanding yang dipakai penjaga
           // sesi untuk membedakan jawaban milik sesi sekarang dari jawaban
           // basi milik sesi sebelumnya — lihat shouldClearSessionForResponse()
           // di helpers.js.
           const activeSessionToken = useRef(storedSession.token);
           const [passwordInput, setPasswordInput] = useState('');
           const [loadingLogin, setLoadingLogin] = useState(false);
           const [loginError, setLoginError] = useState(storedSession.expired ? 'Sesi sebelumnya sudah berakhir. Silakan login ulang.' : '');

           // Daftar nama guru untuk pencarian di layar login. 'loading' dari
           // awal supaya LoginScreen tahu bedanya "belum datang" dan "gagal" —
           // keduanya tetap membiarkan form bisa dipakai (mode legacy PIN saja).
           const [loginUsers, setLoginUsers] = useState([]);
           const [loginUsersState, setLoginUsersState] = useState('loading');
           const [selectedTeacher, setSelectedTeacher] = useState(null);
           // Penjaga double-tap tombol Masuk. Pakai ref, bukan loadingLogin:
           // state React baru terlihat di render berikutnya, jadi dua tap cepat
           // di frame yang sama masih sama-sama lolos kalau mengandalkan state.
           const loginInFlight = useRef(false);
           // Tab sekunder yang datanya sudah pernah ditarik sesi ini. Ref,
           // bukan state: harus terbaca seketika saat tab berpindah, bukan di
           // render berikutnya — kalau tidak, pindah tab bolak-balik menembak
           // request berulang.
           const loadedTabs = useRef({});

           // Langsung ke tab pertama milik role-nya, bukan null. Kalau null,
           // frame pertama setelah refresh merender cangkang kosong walaupun
           // datanya sudah siap dari snapshot — baru terisi setelah efek boot
           // jalan. Untuk pengguna yang baru login (belum ada storedSession)
           // tetap null, dan diisi efek boot seperti sebelumnya.
           const [activeTab, setActiveTab] = useState(() => (
               storedSession.user ? ROLES[resolveRoleKey(storedSession.user)].menus[0] : null
           ));
           const [fontScale, setFontScale] = useState(() => {
               try { return parseFloat(localStorage.getItem('sigap_font_scale')) || 1; } catch (e) { return 1; }
           });
           const FONT_SCALE_STEPS = [1, 1.15, 1.3, 1.45];
           const changeFontScale = (direction) => {
               const currentIndex = FONT_SCALE_STEPS.indexOf(fontScale);
               const idx = currentIndex === -1 ? 0 : currentIndex;
               const nextIndex = Math.min(FONT_SCALE_STEPS.length - 1, Math.max(0, idx + direction));
               const next = FONT_SCALE_STEPS[nextIndex];
               setFontScale(next);
               try { localStorage.setItem('sigap_font_scale', String(next)); } catch (e) {}
           };
           const [riwayatCategory, setRiwayatCategory] = useState('terlambat');
           const [selectedStudent, setSelectedStudent] = useState(null);
           const [customReasonInput, setCustomReasonInput] = useState('');
           const [toast, setToast] = useState(null);
           // Nilai awal diambil dari cache klien kalau ada (lihat bootCache di
           // atas) — inilah yang membuat refresh langsung menampilkan layar
           // terakhir alih-alih layar kosong sambil menunggu Apps Script.
           const [students, setStudents] = useState(bootData.students || []);
           const [allLogs, setAllLogs] = useState(bootData.allLogs || []);
           const [loadingLogs, setLoadingLogs] = useState(false);
           // true = yang sedang tampil berasal dari cache dan BELUM disegarkan
           // dari server. Dipakai banner "memperbarui data" supaya data lama
           // tidak pernah tersaji diam-diam sebagai data final.
           const [fromCache, setFromCache] = useState(!!bootCache);
           const [cacheTruncated] = useState(!!(bootCache && bootCache.truncated));

           const [teachers, setTeachers] = useState([]);
           const [loadingTeacherAction, setLoadingTeacherAction] = useState(false);
           const [suratList, setSuratList] = useState(bootData.suratList || []);
           const [pelanggaranList, setPelanggaranList] = useState(bootData.pelanggaranList || []);
           const [bimbinganList, setBimbinganList] = useState([]);
           const [upacaraList, setUpacaraList] = useState([]);
           const [auditLog, setAuditLog] = useState([]);
           const [jadwalPiket, setJadwalPiket] = useState(bootData.jadwalPiket || []);
           const [waliKelasMap, setWaliKelasMap] = useState(bootData.waliKelasMap || []);
           const [tindakLanjutList, setTindakLanjutList] = useState(bootData.tindakLanjutList || []);
           const [slowConnection, setSlowConnection] = useState(false);

           const roleKey = resolveRoleKey(user);
           const roleConfig = ROLES[roleKey];

           // Siapa boleh lihat detail per-kelas (Rekap Kelas & daftar pelanggaran):
           // admin/BK/Kesiswaan (semua kelas) ATAU guru yang jadi wali kelas
           // (kelasnya sendiri saja). Guru biasa non-wali-kelas: tidak dapat.
           // Beda dengan canViewRanking (Statistik) yang TIDAK punya pengecualian
           // wali kelas — itu sengaja, lihat statistik.js.
           const canSeeClassDetail = roleConfig.canViewRanking || !!(user && user.waliKelas);

           // Menu 'rekap' & 'export' cuma statis untuk admin/bk_kesiswaan di
           // config.js — untuk guru yang kebetulan wali kelas, ditambahkan di
           // sini secara runtime (bukan per-role, tapi per-orang, tergantung
           // user.waliKelas). Guru biasa non-wali-kelas tidak dapat keduanya,
           // dan server menegakkan hal yang sama sendiri (getPelanggaranUpacara
           // untuk rekap, resolveExportAccess untuk export) — menu yang tidak
           // muncul di sini BUKAN pengamanannya.
           const waliKelasExtraMenus = ['rekap', 'export'].filter(m => !roleConfig.menus.includes(m));
           const effectiveMenus = roleKey === 'guru' && user && user.waliKelas && waliKelasExtraMenus.length
               ? [...roleConfig.menus, ...waliKelasExtraMenus]
               : roleConfig.menus;

           // Dipakai baik untuk logout manual maupun logout paksa (sesi expired)
           // — bedanya cuma pesan yang ditampilkan di layar login.
           const clearSession = (errorMessage) => {
               // Dinolkan LEBIH DULU dan lewat ref, bukan state: mulai detik
               // ini juga setiap jawaban yang masih dalam perjalanan harus
               // langsung terbaca sebagai milik sesi lama, tidak menunggu
               // render berikutnya.
               activeSessionToken.current = null;
               sessionExpiresAt.current = 0;
               sessionLoginAt.current = 0;
               try {
                   localStorage.removeItem(SESSION_STORAGE_KEY);
                   removeLegacySessionKeys();
                   // Data operasional ikut dibuang saat logout/sesi habis —
                   // HP yang dipakai bergantian tidak boleh menyisakan daftar
                   // siswa & catatan pelanggaran milik guru sebelumnya.
                   localStorage.removeItem(CLIENT_CACHE_KEY);
               } catch (e) {}
               setUser(null);
               setSessionToken(null);
               setLoginError(errorMessage || '');
               // Data tab sekunder sekarang lazy-load, jadi tidak lagi otomatis
               // tertimpa saat ada yang login berikutnya. Harus dibuang eksplisit
               // di sini — kalau tidak, guru B yang login setelah guru A di HP
               // yang sama bisa melihat sisa daftar milik guru A.
               loadedTabs.current = {};
               setTeachers([]);
               setBimbinganList([]);
               setUpacaraList([]);
               setAuditLog([]);
           };

           // Dipasang di setiap respons API (lewat .then(checkSession) setelah
           // res.json()) — kalau server bilang sesi sudah tidak valid, langsung
           // kembalikan ke layar login dengan pesan yang jelas, alih-alih
           // diam-diam gagal (list kosong tanpa penjelasan).
           //
           // ⚠️ BUG YANG PERNAH TERJADI — jangan diulang: dulu penjaga ini cuma
           // mencocokkan TEKS pesannya. Karena setiap request membawa token
           // dari render tempat ia ditembakkan, sementara jawabannya baru
           // datang belasan detik kemudian, jawaban "Sesi berakhir" milik sesi
           // LAMA bisa mendarat setelah guru berhasil login ulang — dan ikut
           // menghapus sesi BARU yang baru berumur beberapa detik. Gejalanya:
           // "login berhasil, lalu langsung logout lagi dengan pesan sesi
           // habis", berulang setiap kali dicoba, paling sering saat aplikasi
           // dibuka dari ikon Home Screen (satu-satunya alur yang rutin memulai
           // dari sesi tersimpan yang sudah mati di server, sehingga 7 request
           // boot menembak dengan token mati lalu ekornya mendarat belakangan).
           //
           // `sessionToken` di bawah adalah token yang BENAR-BENAR dipakai
           // request ini: penjaga dan URL fetch-nya dibuat di render yang sama,
           // jadi keduanya pasti melihat token yang sama.
           const tokenUsedForRequest = sessionToken;
           const checkSession = (data) => {
               if (shouldClearSessionForResponse(data, tokenUsedForRequest, activeSessionToken.current)) {
                   clearSession(data.message || 'Sesi berakhir, silakan login ulang.');
                   return data;
               }
               // Server mengabarkan sesi baru saja diperpanjang (backend yang
               // belum di-deploy ulang tidak mengirim field ini — lihat
               // nextSessionExpiry di helpers.js).
               if (data && data.sessionExpiresAt && user && tokenUsedForRequest && tokenUsedForRequest === activeSessionToken.current) {
                   const extended = nextSessionExpiry(sessionExpiresAt.current, data.sessionExpiresAt);
                   if (extended > sessionExpiresAt.current) {
                       sessionExpiresAt.current = extended;
                       saveStoredSession(tokenUsedForRequest, user, extended, sessionLoginAt.current);
                   }
               }
               return data;
           };

           const fetchTeachers = () => {
               if (roleKey !== 'admin') return;
               fetch(`${API_URL}?action=getTeachers&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status !== 'success') return;
                       // Diurut lagi di sini (bukan cuma andalkan urutan dari server) --
                       // getTeachers di Code.gs SUDAH mengurutkan abjad, tapi itu kode
                       // Apps Script yang baru aktif setelah di-clasp-deploy manual (lihat
                       // CLAUDE.md), jadi backend produksi yang masih lama akan tetap
                       // kirim urutan baris Sheet apa adanya sampai deploy itu terjadi.
                       // Sort di sini membuat urutan abjad langsung benar di frontend
                       // tanpa bergantung pada kapan deploy backend-nya dilakukan.
                       const sorted = [...data.teachers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
                       setTeachers(sorted);
                   });
           };

           const fetchBimbingan = () => {
               if (roleKey !== 'admin' && roleKey !== 'bk_kesiswaan') return;
               fetch(`${API_URL}?action=getBimbingan&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setBimbinganList(data.bimbingan); });
           };

           const fetchUpacara = () => {
               fetch(`${API_URL}?action=getPelanggaranUpacara&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setUpacaraList(data.upacara); });
           };

           const fetchStudentsOnly = () => {
               fetch(`${API_URL}?action=getStudents&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setStudents(data.students); });
           };

           // On-demand, 1 siswa per panggilan — dipakai peringatan "sudah Nx
           // tercatat" di modal Catat Pelanggaran untuk guru yang tidak lihat
           // daftar pelanggaran lengkap. Cuma kirim angka (lihat Code.gs).
           const fetchPelanggaranCount = (nisn) => {
               return fetch(`${API_URL}?action=getPelanggaranCountForStudent&nisn=${encodeURIComponent(nisn)}&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => data.status === 'success' ? data.count : 0)
                   .catch(() => 0);
           };

           // Jumlah keterlambatan 1 siswa (angka saja) — dipakai peringatan
           // "sudah Nx terlambat" di modal Catat Terlambat. Sejak riwayat
           // dibatasi per cakupan di server (lihat scopeLateLogsForUser di
           // Utils.gs), allLogs milik guru biasa TIDAK lagi memuat catatan guru
           // lain, jadi hitungan dari allLogs saja akan mengecil diam-diam dan
           // peringatannya tidak muncul saat seharusnya muncul.
           const fetchStudentLateCount = (nisn) => {
               return fetch(`${API_URL}?action=getStudentLateHistory&nisn=${encodeURIComponent(nisn)}&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => (data.status === 'success' && typeof data.count === 'number') ? data.count : 0)
                   .catch(() => 0);
           };

           const fetchAuditLog = () => {
               // Admin-only, mengikuti getAuditLog di Code.gs — tanpa ini BK
               // menembak request yang pasti dijawab Unauthorized.
               if (roleKey !== 'admin') return;
               fetch(`${API_URL}?action=getAuditLog&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setAuditLog(data.auditLog); });
           };

           // Jadwal Piket & peta Wali Kelas — referensi kecil, sama untuk semua
           // role non-OSIS, dipakai Dashboard (konteks harian) & Rekap Kelas.
           const fetchJadwalPiket = () => {
               fetch(`${API_URL}?action=getJadwalPiket&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setJadwalPiket(data.jadwal); });
           };

           const fetchWaliKelasMap = () => {
               fetch(`${API_URL}?action=getWaliKelasMap&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setWaliKelasMap(data.waliKelasMap); });
           };

           // Tindak Lanjut siswa sering terlambat — cuma ditarik untuk admin/BK
           // atau guru yang jadi wali kelas (server juga membatasi hal yang sama,
           // ini cuma menghindari fetch percuma untuk guru biasa non-wali-kelas).
           const fetchTindakLanjut = () => {
               fetch(`${API_URL}?action=getTindakLanjut&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setTindakLanjutList(data.tindakLanjut); });
           };

           // Tidak butuh sesi (dipanggil justru sebelum login) — lihat
           // getLoginUsers di doGet Code.gs. Kegagalannya BUKAN kondisi fatal:
           // layar login tetap jalan penuh dalam mode legacy (PIN saja).
           const fetchLoginUsers = () => {
               setLoginUsersState('loading');
               fetch(`${API_URL}?action=getLoginUsers&token=${API_TOKEN}`)
                   .then(res => res.json())
                   .then(data => {
                       if (data && data.status === 'success' && Array.isArray(data.users) && data.users.length > 0) {
                           setLoginUsers(data.users.map(u => ({ id: u.id, name: u.name })));
                           setLoginUsersState('ready');
                       } else {
                           setLoginUsers([]);
                           setLoginUsersState('error');
                       }
                   })
                   .catch(() => { setLoginUsers([]); setLoginUsersState('error'); });
           };

           // Ditarik saat layar login tampil (termasuk setelah sesi habis),
           // tidak saat sudah login — daftarnya tidak dipakai di dalam aplikasi.
           useEffect(() => {
               if (!user) fetchLoginUsers();
           }, [user]);

           // Data yang HANYA dipakai satu tab tidak ikut ditarik saat boot.
           // Sebelumnya seorang admin memicu 11 request Apps Script sekaligus
           // begitu login — 4 di antaranya (Kelola Guru, Bimbingan, Audit Log,
           // Upacara) untuk tab yang belum tentu dibuka hari itu, dan 4 itu
           // justru yang paling mahal karena TIDAK punya cache di server sama
           // sekali. Sekarang ditarik saat tabnya pertama kali dibuka, dan
           // ditandai di loadedTabs supaya pindah-pindah tab tidak menarik
           // ulang data yang sudah ada (ref, bukan state: harus terbaca
           // seketika, bukan di render berikutnya).
           // Penanda dipasang per DATA, bukan per tab: data upacara dipakai dua
           // tab (menu Upacara dan kategori Upacara di Rekap Kelas), jadi kalau
           // penandanya per-tab, membuka keduanya akan menarik data yang sama
           // dua kali.
           const loadOnce = (key, fn) => {
               if (loadedTabs.current[key]) return;
               loadedTabs.current[key] = true;
               fn();
           };
           const ensureTabData = (tab) => {
               if (!tab) return;
               if (tab === 'kelola') loadOnce('teachers', fetchTeachers);
               else if (tab === 'bimbingan') loadOnce('bimbingan', fetchBimbingan);
               else if (tab === 'auditlog') loadOnce('auditlog', fetchAuditLog);
               else if (tab === 'upacara') loadOnce('upacara', fetchUpacara);
               // Rekap Kelas butuh data upacara untuk kategori Upacara-nya.
               // Server membatasi isinya sendiri (wali kelas = kelasnya saja),
               // jadi guru biasa non-wali-kelas tidak pernah sampai ke sini
               // karena menu 'rekap' memang tidak muncul untuk mereka.
               else if (tab === 'rekap') loadOnce('upacara', fetchUpacara);
           };

           useEffect(() => { ensureTabData(activeTab); }, [activeTab]);

           useEffect(() => {
               if (user) {
                   const firstTab = roleConfig.menus[0];
                   setActiveTab(firstTab);
                   // Lewat ensureTabData, BUKAN fetch langsung — saat refresh,
                   // activeTab sudah terisi dari awal sehingga efek tab sudah
                   // menariknya duluan. Memanggil fetch langsung di sini membuat
                   // request yang sama ditembak dua kali.
                   ensureTabData(firstTab);
                   if (roleKey === 'osis') {
                       // OSIS cuma butuh cari siswa + riwayat upacara mereka sendiri —
                       // tidak perlu (dan tidak diizinkan server) menarik data lain.
                       fetchStudentsOnly();
                   } else {
                       fetchData();
                       fetchJadwalPiket();
                       fetchWaliKelasMap();
                       if (roleKey === 'admin' || roleKey === 'bk_kesiswaan' || user.waliKelas) fetchTindakLanjut();
                   }
               }
           }, [user]);

           // Snapshot ke localStorage setiap kali dataset inti berubah, supaya
           // refresh berikutnya punya sesuatu untuk ditampilkan seketika.
           // Sengaja TIDAK menyimpan bimbingan/auditlog/upacara: itu data tab
           // sekunder yang sekarang lazy-load, tidak dibutuhkan saat boot.
           // Ditunda 1 detik dan di-reset tiap ada perubahan baru: saat boot,
           // 4 respons datang beruntun dalam hitungan detik dan tanpa jeda ini
           // snapshot ratusan KB akan ditulis 4x berturut-turut. localStorage
           // itu sinkron — di HP kelas menengah itu terasa sebagai patah-patah
           // persis saat data mulai tampil.
           useEffect(() => {
               if (!user) return;
               const timer = setTimeout(() => {
                   try {
                       // Masa berlaku diambil dari ref, bukan dibaca ulang dari
                       // localStorage: ref-lah yang ikut diperpanjang saat
                       // server memperpanjang sesi, jadi cache tidak pernah
                       // distempel lebih pendek daripada sesinya sendiri.
                       const expiresAt = sessionExpiresAt.current;
                       if (!expiresAt) return;
                       const snapshot = buildClientCache(user.id, { students, allLogs, suratList, pelanggaranList, jadwalPiket, waliKelasMap, tindakLanjutList }, expiresAt);
                       localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(snapshot));
                   } catch (e) {
                       // Kuota localStorage penuh / mode privat — cache cuma
                       // percepatan, aplikasi harus tetap jalan normal tanpanya.
                   }
               }, 1000);
               return () => clearTimeout(timer);
           }, [user, students, allLogs, suratList, pelanggaranList, jadwalPiket, waliKelasMap, tindakLanjutList]);

           const fetchData = () => {
               setLoadingLogs(true);
               setSlowConnection(false);
               const slowTimer = setTimeout(() => setSlowConnection(true), 3000);
               fetch(`${API_URL}?action=getStudents&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => { if (data.status === 'success') setStudents(data.students); });
               fetch(`${API_URL}?action=getLogs&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => {
                   if (data.status === 'success') setAllLogs(data.logs);
                   setLoadingLogs(false);
                   // Sinkronisasi latar selesai — yang tampil sekarang data
                   // server, bukan cache lagi, jadi banner boleh hilang.
                   setFromCache(false);
                   clearTimeout(slowTimer);
                   setSlowConnection(false);
               }).catch(() => { setLoadingLogs(false); clearTimeout(slowTimer); setSlowConnection(false); });
               fetch(`${API_URL}?action=getSurat&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => { if (data.status === 'success') setSuratList(data.surat); });
               fetch(`${API_URL}?action=getPelanggaran&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => { if (data.status === 'success') setPelanggaranList(data.pelanggaran); });
           };

           const handleLogin = (e) => {
               if (e && e.preventDefault) e.preventDefault();
               // Tap kedua saat request pertama masih jalan = diabaikan, bukan
               // request login kedua (Apps Script lambat, guru sering menekan
               // tombolnya dua kali).
               if (loginInFlight.current) return;
               loginInFlight.current = true;
               setLoadingLogin(true);
               setLoginError('');
               fetch(API_URL, { method: 'POST', body: JSON.stringify(buildLoginPayload(passwordInput, selectedTeacher, API_TOKEN)) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       loginInFlight.current = false;
                       setLoadingLogin(false);
                       if (data.status === 'success') {
                           const loginAt = Date.now();
                           // Stempel ini yang dipakai loadStoredSession() supaya
                           // sesi mati tidak pernah dirender lagi. Kalau server
                           // sudah versi baru ia ikut mengabarkan masa berlaku
                           // hasil perpanjangannya sendiri; kalau belum, 6 jam
                           // sejak login persis seperti sebelumnya.
                           const expiresAt = nextSessionExpiry(loginAt + SESSION_MAX_AGE_MS, data.sessionExpiresAt, loginAt);
                           // Ref dulu, baru state: penjaga sesi harus langsung
                           // mengenali token baru ini sebagai yang aktif,
                           // supaya jawaban basi milik sesi sebelumnya yang
                           // mendarat sedetik lagi tidak ikut menghapusnya.
                           activeSessionToken.current = data.sessionToken;
                           sessionExpiresAt.current = expiresAt;
                           sessionLoginAt.current = loginAt;
                           setUser(data.user);
                           setSessionToken(data.sessionToken);
                           saveStoredSession(data.sessionToken, data.user, expiresAt, loginAt);
                       } else setLoginError(data.message || 'Password salah!');
                   })
                   .catch(() => { loginInFlight.current = false; setLoadingLogin(false); setLoginError('Koneksi Gagal. Coba lagi.'); });
           };

           const handleLogout = () => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'logout', sessionToken: sessionToken, token: API_TOKEN }) }).catch(() => {});
               clearSession();
           };

           const handleRecord = (type) => {
               const finalType = type === 'Custom' ? (customReasonInput.trim() || 'Lainnya') : type;
               const newEntry = { timestamp: new Date(), nisn: selectedStudent.nisn, name: selectedStudent.name, class: selectedStudent.class, type: finalType, logged_by: user.name };
               const payload = { action: 'record', nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, type: finalType, sessionToken: sessionToken, token: API_TOKEN };
               fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') setAllLogs(prev => [newEntry, ...prev]);
                       else setToast('Gagal menyimpan, coba lagi.');
                   })
                   .catch(() => setToast('Koneksi gagal, coba lagi.'));
               setToast(`✓ ${selectedStudent.name} berhasil dicatat`);
               setSelectedStudent(null); setCustomReasonInput('');
               setTimeout(() => setToast(null), 2000);
           };

           const handleAddTeacher = (payload, callback) => {
               setLoadingTeacherAction(true);
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addTeacher', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       setLoadingTeacherAction(false);
                       if (data.status === 'success') {
                           // Server (getTeachers) sudah urut abjad — susun ulang di sini
                           // juga supaya guru baru langsung muncul di posisi yang benar,
                           // bukan nyempil di akhir daftar sampai refresh berikutnya.
                           setTeachers(prev => [...prev, { id: payload.newId, name: payload.newName, role: payload.newRole, jabatan: payload.newJabatan || '', status: 'aktif', kelasWali: '' }].sort((a, b) => String(a.name).localeCompare(String(b.name))));
                           callback(true, '✓ Guru berhasil ditambahkan.');
                       } else callback(false, data.message || 'Gagal menambah guru.');
                   })
                   .catch(() => { setLoadingTeacherAction(false); callback(false, 'Koneksi gagal, coba lagi.'); });
           };

           const handleUpdatePassword = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updatePassword', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') callback(true, 'Password berhasil diubah.');
                       else callback(false, data.message || 'Gagal mengubah password.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleUpdateJabatan = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateJabatan', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.map(t => t.id === payload.targetId ? { ...t, jabatan: payload.newJabatan } : t));
                           callback(true, '✓ Jabatan berhasil diubah.');
                       } else callback(false, data.message || 'Gagal mengubah jabatan.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleToggleStatus = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'toggleTeacherStatus', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.map(t => t.id === payload.targetId ? { ...t, status: data.newStatus } : t));
                           callback(true, data.newStatus === 'nonaktif' ? '✓ Akun dinonaktifkan.' : '✓ Akun diaktifkan kembali.');
                       } else callback(false, data.message || 'Gagal mengubah status akun.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleUpdateRole = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateRole', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.map(t => t.id === payload.targetId ? { ...t, role: payload.newRole } : t));
                           callback(true, '✓ Role berhasil diubah.');
                       } else callback(false, data.message || 'Gagal mengubah role.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleUpdateWaliKelas = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateWaliKelas', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.map(t => t.id === payload.targetId ? { ...t, kelasWali: payload.newKelasWali } : t));
                           fetchWaliKelasMap();
                           callback(true, '✓ Kelas wali berhasil diubah.');
                       } else callback(false, data.message || 'Gagal mengubah kelas wali.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleUpdateTeacherName = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateTeacherName', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.map(t => t.id === payload.targetId ? { ...t, name: payload.newName } : t).sort((a, b) => String(a.name).localeCompare(String(b.name))));
                           callback(true, '✓ Nama berhasil diubah.');
                       } else callback(false, data.message || 'Gagal mengubah nama.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           // Hapus permanen — beda dari handleToggleStatus (nonaktifkan). Server
           // yang menolak kalau target masih wali kelas aktif / akun sendiri,
           // lihat komentar action 'deleteTeacher' di Code.gs.
           const handleDeleteTeacher = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteTeacher', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           setTeachers(prev => prev.filter(t => t.id !== payload.targetId));
                           callback(true, '✓ Guru berhasil dihapus.');
                       } else callback(false, data.message || 'Gagal menghapus guru.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           // payload.schedule = [{ hari, guruId }, ...] — kirim seluruh jadwal
           // seminggu sekaligus (bukan per-baris), lalu tarik ulang biar nama
           // guru & urutan selalu sinkron dengan yang tersimpan di server.
           const handleSetJadwalPiket = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'setJadwalPiket', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           fetchJadwalPiket();
                           callback(true, '✓ Jadwal piket berhasil disimpan.');
                       } else callback(false, data.message || 'Gagal menyimpan jadwal piket.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAjukanTindakLanjut = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'ajukanTindakLanjut', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           fetchTindakLanjut();
                           callback(true, '✓ Diajukan, menunggu persetujuan admin.');
                       } else callback(false, data.message || 'Gagal mengajukan tindak lanjut.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleApproveTindakLanjut = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'approveTindakLanjut', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           fetchTindakLanjut();
                           callback(true, '✓ Disetujui, dihapus dari peringatan.');
                       } else callback(false, data.message || 'Gagal menyetujui tindak lanjut.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAddSurat = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addSurat', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           const newEntry = { timestamp: new Date(), nisn: payload.nisn, name: payload.name, class: payload.class_name, jenis: payload.jenis, keterangan: payload.keterangan || '', logged_by: user.name };
                           setSuratList(prev => [newEntry, ...prev]);
                           callback(true, 'Surat berhasil dicatat.');
                       } else callback(false, data.message || 'Gagal mencatat surat.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleDeleteSurat = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteSurat', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           const month = parseInt(payload.month, 10);
                           const year = parseInt(payload.year, 10);
                           setSuratList(prev => prev.filter(s => {
                               const dt = parseTimestamp(s.timestamp);
                               return !((dt.getMonth() + 1) === month && dt.getFullYear() === year);
                           }));
                           callback(true, `Berhasil hapus ${data.deletedCount || 0} data.`);
                       } else callback(false, data.message || 'Gagal menghapus data.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAddPelanggaran = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addPelanggaran', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           const newEntry = { timestamp: new Date(), nisn: payload.nisn, name: payload.name, class: payload.class_name, jenis_pelanggaran: payload.jenis_pelanggaran, sanksi: payload.sanksi, catatan: payload.catatan || '', logged_by: user.name };
                           setPelanggaranList(prev => [newEntry, ...prev]);
                           callback(true, 'Pelanggaran berhasil dicatat.');
                       } else callback(false, data.message || 'Gagal mencatat pelanggaran.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAddBimbingan = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addBimbingan', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           if (roleKey === 'admin' || roleKey === 'bk_kesiswaan') {
                               const newEntry = { timestamp: new Date(), nisn: payload.nisn, name: payload.name, class: payload.class_name, catatan: payload.catatan, logged_by: user.name };
                               setBimbinganList(prev => [newEntry, ...prev]);
                           }
                           callback(true, 'Berhasil dicatat (hanya Admin/BK bisa lihat).');
                       } else callback(false, data.message || 'Gagal mencatat.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           // Cocokkan baris lokal lewat NISN + Timestamp (sama seperti server),
           // supaya update/hapus di state tidak butuh fetch ulang seluruh data.
           const sameEntry = (item, payload) => item.nisn === payload.nisn && parseTimestamp(item.timestamp).getTime() === parseTimestamp(payload.timestamp).getTime();

           const handleEditEntry = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'editEntry', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json())
                   .then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           if (payload.category === 'terlambat') {
                               setAllLogs(prev => prev.map(item => sameEntry(item, payload) ? { ...item, type: payload.type } : item));
                           } else if (payload.category === 'pelanggaran') {
                               setPelanggaranList(prev => prev.map(item => sameEntry(item, payload) ? { ...item, jenis_pelanggaran: payload.jenis_pelanggaran, sanksi: payload.sanksi, catatan: payload.catatan } : item));
                           } else if (payload.category === 'surat') {
                               setSuratList(prev => prev.map(item => sameEntry(item, payload) ? { ...item, jenis: payload.jenis, keterangan: payload.keterangan } : item));
                           }
                           callback(true, 'Berhasil diperbarui.');
                       } else callback(false, data.message || 'Gagal memperbarui data.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleDeleteEntry = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteEntry', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json())
                   .then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           if (payload.category === 'terlambat') setAllLogs(prev => prev.filter(item => !sameEntry(item, payload)));
                           else if (payload.category === 'pelanggaran') setPelanggaranList(prev => prev.filter(item => !sameEntry(item, payload)));
                           else if (payload.category === 'surat') setSuratList(prev => prev.filter(item => !sameEntry(item, payload)));
                           callback(true, 'Berhasil dihapus.');
                       } else callback(false, data.message || 'Gagal menghapus data.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           // ---- Export Data (laporan PDF/Excel) ----
           // Server yang menentukan isi laporan: hak akses, kelas yang boleh
           // ikut, periode, dan kolom apa saja yang keluar (aksi 'exportData'
           // di Code.gs). Di sini TIDAK ada penyaringan tambahan dan TIDAK ada
           // data lain dari state aplikasi yang ikut ditempel ke berkas — yang
           // dibungkus persis apa yang server kirim.
           const handleExportData = (payload, callback) => {
               const query = [
                   'action=exportData',
                   'jenis=' + encodeURIComponent(payload.jenis || ''),
                   'kelas=' + encodeURIComponent(payload.kelas || ''),
                   'start=' + encodeURIComponent(payload.start || ''),
                   'end=' + encodeURIComponent(payload.end || ''),
                   'format=' + encodeURIComponent(payload.format || ''),
                   'token=' + API_TOKEN,
                   'sessionToken=' + sessionToken,
               ].join('&');
               fetch(`${API_URL}?${query}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status !== 'success' || !data.report) {
                           callback(false, data.message || 'Gagal membuat laporan.');
                           return;
                       }
                       if (!data.report.total) {
                           // Tidak ada data BUKAN error server — dan tidak ada
                           // berkas kosong yang diunduh diam-diam.
                           callback(false, 'Tidak ada data pada periode & cakupan ini.');
                           return;
                       }
                       try {
                           const filename = generateExportFile(data.report, payload.format, payload.start, payload.end);
                           callback(true, `✓ ${filename} berhasil dibuat (${data.report.total} baris).`);
                       } catch (err) {
                           // Pesan sengaja umum: detail teknis tidak dibawa ke
                           // layar guru, dan isi data tidak pernah ikut pesan error.
                           callback(false, 'Gagal menyiapkan berkas di perangkat ini. Coba format satunya.');
                       }
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAddUpacara = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addPelanggaranUpacara', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json()).then(checkSession)
                   .then(data => {
                       if (data.status === 'success') {
                           const newEntry = { timestamp: new Date(), nisn: payload.nisn, name: payload.name, class: payload.class_name, jenis_pelanggaran: payload.jenis_pelanggaran, catatan: payload.catatan || '', logged_by: user.name };
                           setUpacaraList(prev => [newEntry, ...prev]);
                           callback(true, 'Pelanggaran upacara berhasil dicatat.');
                       } else callback(false, data.message || 'Gagal mencatat.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           return (
               <div style={{ zoom: fontScale }}>
                   {!user ? (
                       <LoginScreen
                           onLogin={handleLogin} loading={loadingLogin} error={loginError}
                           password={passwordInput} setPassword={setPasswordInput}
                           users={loginUsers} usersState={loginUsersState} onRetryUsers={fetchLoginUsers}
                           selectedTeacher={selectedTeacher} setSelectedTeacher={setSelectedTeacher}
                       />
                   ) : (
                       <div className="min-h-screen bg-slate-100 text-slate-900 relative select-none">
                           <Header user={user} roleLabel={user.jabatan || roleConfig.label} onLogout={handleLogout} fontScale={fontScale} onFontScaleChange={changeFontScale} activeTab={activeTab} />

                           {toast && (
                               <div className="fixed bottom-24 inset-x-0 z-50 px-4 flex justify-center pointer-events-none">
                                   <div className="bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl animate-pop">
                                       {toast}
                                   </div>
                               </div>
                           )}

                           {/* Data dari cache TIDAK pernah disajikan diam-diam seolah
                               final — selama banner ini tampil, yang terlihat adalah
                               snapshot terakhir dan sinkronisasi masih jalan. Banner
                               ini menggantikan slowConnection saat keduanya aktif,
                               karena pesannya lebih tepat: aplikasi sudah bisa
                               dipakai, cuma datanya belum tentu terbaru. */}
                           {fromCache ? (
                               <div className="fixed top-16 inset-x-0 z-40 px-4 pointer-events-none">
                                   <div className="max-w-2xl mx-auto bg-sky-dim/10 text-sky-dim text-[11px] px-4 py-2 rounded-xl shadow-md border border-sky-dim/30 text-center animate-pop">
                                       Menampilkan data tersimpan — sedang memperbarui...{cacheTruncated ? ' (riwayat lama menyusul)' : ''}
                                   </div>
                               </div>
                           ) : slowConnection && loadingLogs && (
                               <div className="fixed top-16 inset-x-0 z-40 px-4 pointer-events-none">
                                   <div className="max-w-2xl mx-auto bg-amber-50 text-amber-700 text-[11px] px-4 py-2 rounded-xl shadow-md border border-amber-200 text-center animate-pop">
                                       Masih mengambil data... koneksi internet sedang lambat.
                                   </div>
                               </div>
                           )}

                           <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
                               {activeTab === 'scan' && effectiveMenus.includes('scan') && (
                                   <GerbangTab students={students} allLogs={allLogs} pelanggaranList={pelanggaranList} onSelectLate={setSelectedStudent} suratList={suratList} onAddSurat={handleAddSurat} isAdminUser={roleKey === 'admin'} waliKelasMap={waliKelasMap} />
                               )}
                               {activeTab === 'dashboard' && (
                                   <DashboardTab user={user} allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} jadwalPiket={jadwalPiket} onRefresh={fetchData} loading={loadingLogs} tindakLanjutList={tindakLanjutList} canViewRanking={roleConfig.canViewRanking} isAdmin={roleKey === 'admin'} onAjukanTindakLanjut={handleAjukanTindakLanjut} onApproveTindakLanjut={handleApproveTindakLanjut} />
                               )}
                               {activeTab === 'log' && effectiveMenus.includes('log') && (
                                   <LogTab
                                       allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} initialCategory={riwayatCategory}
                                       canManage={roleKey !== 'osis'} isAdmin={roleKey === 'admin'} isBk={roleKey === 'admin' || roleKey === 'bk_kesiswaan'} currentUserName={user.name}
                                       onEditEntry={handleEditEntry} onDeleteEntry={handleDeleteEntry}
                                   />
                               )}
                               {activeTab === 'stats' && effectiveMenus.includes('stats') && <StatsTab allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} canExport={roleConfig.canExport} canViewRanking={roleConfig.canViewRanking} />}
                               {activeTab === 'rekap' && effectiveMenus.includes('rekap') && canSeeClassDetail && (
                                   <RekapKelasTab students={students} allLogs={allLogs} pelanggaranList={pelanggaranList} upacaraList={upacaraList} waliKelasMap={waliKelasMap} isPrivileged={roleConfig.canViewRanking} myWaliKelas={user.waliKelas || ''} />
                               )}
                               {activeTab === 'kelola' && effectiveMenus.includes('kelola') && (
                                   <KelolaTab teachers={teachers} students={students} jadwalPiket={jadwalPiket} onAddTeacher={handleAddTeacher} onUpdatePassword={handleUpdatePassword} onUpdateJabatan={handleUpdateJabatan} onToggleStatus={handleToggleStatus} onUpdateRole={handleUpdateRole} onUpdateWaliKelas={handleUpdateWaliKelas} onUpdateName={handleUpdateTeacherName} onDeleteTeacher={handleDeleteTeacher} onSetJadwalPiket={handleSetJadwalPiket} onDeleteSurat={handleDeleteSurat} loading={loadingTeacherAction} />
                               )}
                               {activeTab === 'auditlog' && effectiveMenus.includes('auditlog') && (
                                   <AuditLogTab auditLog={auditLog} />
                               )}
                               {activeTab === 'pelanggaran' && effectiveMenus.includes('pelanggaran') && (
                                   <PelanggaranTab students={students} pelanggaranList={pelanggaranList} onAddPelanggaran={handleAddPelanggaran} onAddBimbingan={handleAddBimbingan} canSeeClassDetail={canSeeClassDetail} onGetPelanggaranCount={fetchPelanggaranCount} waliKelasMap={waliKelasMap} />
                               )}
                               {activeTab === 'bimbingan' && effectiveMenus.includes('bimbingan') && (
                                   <BimbinganTab bimbinganList={bimbinganList} />
                               )}
                               {activeTab === 'export' && effectiveMenus.includes('export') && canAccessExport(roleKey, user.waliKelas) && (
                                   <ExportTab
                                       isBk={roleKey === 'admin' || roleKey === 'bk_kesiswaan'}
                                       waliKelas={user.waliKelas || ''}
                                       classes={students.map(s => s.class)}
                                       onGenerate={handleExportData}
                                   />
                               )}
                               {activeTab === 'upacara' && effectiveMenus.includes('upacara') && (
                                   <UpacaraTab students={students} upacaraList={upacaraList} onAddUpacara={handleAddUpacara} isOsis={roleKey === 'osis'} canSeeRekap={roleKey === 'admin' || roleKey === 'bk_kesiswaan' || roleKey === 'osis'} />
                               )}
                           </div>

                           {selectedStudent && (
                               <RecordModal student={selectedStudent} customReason={customReasonInput} setCustomReason={setCustomReasonInput} onRecord={handleRecord} onClose={() => setSelectedStudent(null)} allLogs={allLogs} onGetLateCount={fetchStudentLateCount} />
                           )}

                           <BottomNav menus={effectiveMenus} primaryMenus={roleConfig.primaryMenus} activeTab={activeTab} setActiveTab={setActiveTab} />
                       </div>
                   )}
               </div>
           );
       }

       // Satu-satunya class component di seluruh SIGAP — React mengharuskan
       // Error Boundary berbentuk class (belum ada padanan hook resminya).
       // Tanpa ini, satu error render di mana pun (field API berubah nama,
       // prop yang seharusnya array tapi undefined, dsb.) membuat React
       // melepas SELURUH pohon komponen — layar putih kosong total, tanpa
       // pesan, tanpa jalan pulih selain refresh manual. Ditemukan langsung
       // saat uji coba: satu `jadwalPiket.filter(...)` tanpa jaga-jaga
       // melumpuhkan Gerbang, navigasi, semuanya — bukan cuma Beranda yang
       // sedang error.
       class ErrorBoundary extends React.Component {
           constructor(props) {
               super(props);
               this.state = { hasError: false };
           }
           static getDerivedStateFromError() {
               return { hasError: true };
           }
           componentDidCatch(error, info) {
               console.error('SIGAP gagal render:', error, info.componentStack);
               // ErrorBoundary ada DI LUAR <App/>, jadi tidak bisa akses
               // sessionToken lewat props/state React — ambil langsung dari
               // localStorage (sumber yang sama dipakai loadStoredSession()).
               // Aksi 'logClientError' di Code.gs sengaja tidak butuh sesi
               // valid, supaya laporan tetap masuk walau render gagal PAS
               // sesi baru saja habis. Kalau kirim laporan ini sendiri gagal
               // (offline dsb.), diamkan saja — sudah ada fallback console.error di atas.
               try {
                   const token = parseSessionRecord(localStorage.getItem(SESSION_STORAGE_KEY)).token
                       || localStorage.getItem(SESSION_LEGACY_KEYS.token);
                   fetch(API_URL, {
                       method: 'POST',
                       body: JSON.stringify({
                           action: 'logClientError',
                           token: API_TOKEN,
                           sessionToken: token,
                           message: String((error && error.message) || error),
                           detail: String((info && info.componentStack) || ''),
                           page: window.location.href,
                       }),
                   }).catch(() => {});
               } catch (e) {}
           }
           render() {
               if (this.state.hasError) {
                   return (
                       <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-center">
                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-10 w-10 text-crimson mb-3" />
                           <h1 className="font-display text-lg font-extrabold text-slate-900 mb-1">Ada yang salah</h1>
                           <p className="text-sm text-slate-500 mb-5 max-w-xs">Halaman ini gagal dimuat. Coba muat ulang — kalau terus terjadi, hubungi admin.</p>
                           <Button onClick={() => window.location.reload()} className="px-8">Muat Ulang</Button>
                       </div>
                   );
               }
               return this.props.children;
           }
       }

       ReactDOM.createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
