// ===== app.js =====
// Komponen utama App(): login, sesi, fetch data, semua handler simpan,
// dan render seluruh tampilan. Dimuat PALING TERAKHIR.

       // Sesi login disimpan di localStorage supaya tidak logout tiap refresh —
       // sesi di server (CacheService) hidup 6 jam sejak login (lihat
       // createSession di Auth.gs); localStorage cuma "mengingat" token itu,
       // validitas sebenarnya tetap ditentukan server di setiap panggilan API.
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
       const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // samakan dengan TTL createSession() di Auth.gs

       function loadStoredSession() {
           try {
               const token = localStorage.getItem('sigap_session_token');
               const rawUser = localStorage.getItem('sigap_user');
               if (!token || !rawUser) return { token: null, user: null, expired: false };
               const expiresAt = parseInt(localStorage.getItem('sigap_session_expires') || '0', 10);
               // Tanpa stempel = sesi dari versi lama aplikasi. Umurnya tidak
               // bisa diketahui, jadi diperlakukan sebagai kedaluwarsa: sekali
               // login ulang jauh lebih baik daripada mengulang bug di atas.
               if (!expiresAt || Date.now() >= expiresAt) return { token: null, user: null, expired: true };
               return { token, user: JSON.parse(rawUser), expired: false };
           } catch (e) {}
           return { token: null, user: null, expired: false };
       }

       function App() {
           const storedSession = loadStoredSession();
           const [user, setUser] = useState(storedSession.user);
           const [sessionToken, setSessionToken] = useState(storedSession.token);
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

           const [activeTab, setActiveTab] = useState(null);
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
           const [students, setStudents] = useState([]);
           const [allLogs, setAllLogs] = useState([]);
           const [loadingLogs, setLoadingLogs] = useState(false);

           const [teachers, setTeachers] = useState([]);
           const [loadingTeacherAction, setLoadingTeacherAction] = useState(false);
           const [suratList, setSuratList] = useState([]);
           const [pelanggaranList, setPelanggaranList] = useState([]);
           const [bimbinganList, setBimbinganList] = useState([]);
           const [upacaraList, setUpacaraList] = useState([]);
           const [auditLog, setAuditLog] = useState([]);
           const [jadwalPiket, setJadwalPiket] = useState([]);
           const [waliKelasMap, setWaliKelasMap] = useState([]);
           const [tindakLanjutList, setTindakLanjutList] = useState([]);
           const [slowConnection, setSlowConnection] = useState(false);

           // 4 kemungkinan role: admin, bk_kesiswaan, guru, osis — default ke 'guru' kalau role tidak dikenali
           const roleKey = user && ROLES[String(user.role).toLowerCase().trim()] ? String(user.role).toLowerCase().trim() : 'guru';
           const roleConfig = ROLES[roleKey];

           // Siapa boleh lihat detail per-kelas (Rekap Kelas & daftar pelanggaran):
           // admin/BK/Kesiswaan (semua kelas) ATAU guru yang jadi wali kelas
           // (kelasnya sendiri saja). Guru biasa non-wali-kelas: tidak dapat.
           // Beda dengan canViewRanking (Statistik) yang TIDAK punya pengecualian
           // wali kelas — itu sengaja, lihat statistik.js.
           const canSeeClassDetail = roleConfig.canViewRanking || !!(user && user.waliKelas);

           // Menu 'rekap' cuma statis untuk admin/bk_kesiswaan di config.js —
           // untuk guru yang kebetulan wali kelas, ditambahkan di sini secara
           // runtime (bukan per-role, tapi per-orang, tergantung user.waliKelas).
           const effectiveMenus = roleKey === 'guru' && user && user.waliKelas && !roleConfig.menus.includes('rekap')
               ? [...roleConfig.menus, 'rekap']
               : roleConfig.menus;

           // Dipakai baik untuk logout manual maupun logout paksa (sesi expired)
           // — bedanya cuma pesan yang ditampilkan di layar login.
           const clearSession = (errorMessage) => {
               try {
                   localStorage.removeItem('sigap_session_token');
                   localStorage.removeItem('sigap_user');
                   localStorage.removeItem('sigap_session_expires');
               } catch (e) {}
               setUser(null);
               setSessionToken(null);
               setLoginError(errorMessage || '');
           };

           // Dipasang di setiap respons API (lewat .then(checkSession) setelah
           // res.json()) — kalau server bilang sesi sudah tidak valid, langsung
           // kembalikan ke layar login dengan pesan yang jelas, alih-alih
           // diam-diam gagal (list kosong tanpa penjelasan).
           const checkSession = (data) => {
               if (data && data.status === 'error' && /sesi berakhir/i.test(data.message || '')) {
                   clearSession(data.message || 'Sesi berakhir, silakan login ulang.');
               }
               return data;
           };

           const fetchTeachers = () => {
               if (roleKey !== 'admin') return;
               fetch(`${API_URL}?action=getTeachers&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json()).then(checkSession)
                   .then(data => { if (data.status === 'success') setTeachers(data.teachers); });
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

           const fetchAuditLog = () => {
               if (roleKey !== 'admin' && roleKey !== 'bk_kesiswaan') return;
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

           useEffect(() => {
               if (user) {
                   setActiveTab(roleConfig.menus[0]);
                   if (roleKey === 'osis') {
                       // OSIS cuma butuh cari siswa + riwayat upacara mereka sendiri —
                       // tidak perlu (dan tidak diizinkan server) menarik data lain
                       fetchStudentsOnly();
                       fetchUpacara();
                   } else {
                       fetchData();
                       fetchJadwalPiket();
                       fetchWaliKelasMap();
                       if (roleKey === 'admin') fetchTeachers();
                       // fetchAuditLog sempat lupa dipanggil di sini — fungsinya sudah
                       // ada sejak lama, tapi tidak pernah dieksekusi, jadi tab Audit
                       // Log selalu kosong walau sheet Audit_Log sendiri terisi normal.
                       if (roleKey === 'admin' || roleKey === 'bk_kesiswaan') { fetchBimbingan(); fetchUpacara(); fetchAuditLog(); }
                       if (roleKey === 'admin' || roleKey === 'bk_kesiswaan' || user.waliKelas) fetchTindakLanjut();
                   }
               }
           }, [user]);

           const fetchData = () => {
               setLoadingLogs(true);
               setSlowConnection(false);
               const slowTimer = setTimeout(() => setSlowConnection(true), 3000);
               fetch(`${API_URL}?action=getStudents&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => { if (data.status === 'success') setStudents(data.students); });
               fetch(`${API_URL}?action=getLogs&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(checkSession).then(data => {
                   if (data.status === 'success') setAllLogs(data.logs);
                   setLoadingLogs(false);
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
                           setUser(data.user);
                           setSessionToken(data.sessionToken);
                           try {
                               localStorage.setItem('sigap_session_token', data.sessionToken);
                               localStorage.setItem('sigap_user', JSON.stringify(data.user));
                               // Stempel ini yang dipakai loadStoredSession()
                               // supaya sesi mati tidak pernah dirender lagi.
                               localStorage.setItem('sigap_session_expires', String(Date.now() + SESSION_MAX_AGE_MS));
                           } catch (e) {}
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
                           setTeachers(prev => [...prev, { id: payload.newId, name: payload.newName, role: payload.newRole, jabatan: payload.newJabatan || '', status: 'aktif', kelasWali: '' }]);
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
                           <Header user={user} roleLabel={user.jabatan || roleConfig.label} onLogout={handleLogout} fontScale={fontScale} onFontScaleChange={changeFontScale} />

                           {toast && (
                               <div className="fixed bottom-24 inset-x-0 z-50 px-4 flex justify-center pointer-events-none">
                                   <div className="bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl animate-pop">
                                       {toast}
                                   </div>
                               </div>
                           )}

                           {slowConnection && loadingLogs && (
                               <div className="fixed top-16 inset-x-0 z-40 px-4">
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
                                   <RekapKelasTab students={students} allLogs={allLogs} pelanggaranList={pelanggaranList} waliKelasMap={waliKelasMap} isPrivileged={roleConfig.canViewRanking} myWaliKelas={user.waliKelas || ''} />
                               )}
                               {activeTab === 'kelola' && effectiveMenus.includes('kelola') && (
                                   <KelolaTab teachers={teachers} students={students} jadwalPiket={jadwalPiket} onAddTeacher={handleAddTeacher} onUpdatePassword={handleUpdatePassword} onUpdateJabatan={handleUpdateJabatan} onToggleStatus={handleToggleStatus} onUpdateRole={handleUpdateRole} onUpdateWaliKelas={handleUpdateWaliKelas} onSetJadwalPiket={handleSetJadwalPiket} onDeleteSurat={handleDeleteSurat} loading={loadingTeacherAction} />
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
                               {activeTab === 'upacara' && effectiveMenus.includes('upacara') && (
                                   <UpacaraTab students={students} upacaraList={upacaraList} onAddUpacara={handleAddUpacara} isOsis={roleKey === 'osis'} />
                               )}
                           </div>

                           {selectedStudent && (
                               <RecordModal student={selectedStudent} customReason={customReasonInput} setCustomReason={setCustomReasonInput} onRecord={handleRecord} onClose={() => setSelectedStudent(null)} allLogs={allLogs} />
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
                   const token = localStorage.getItem('sigap_session_token');
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
                           <div className="text-4xl mb-3">⚠️</div>
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
