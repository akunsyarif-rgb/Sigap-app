// ===== app.js =====
// Komponen utama App(): login, sesi, fetch data, semua handler simpan,
// dan render seluruh tampilan. Dimuat PALING TERAKHIR.

       function App() {
           const [user, setUser] = useState(null);
           const [sessionToken, setSessionToken] = useState(null);
           const [passwordInput, setPasswordInput] = useState('');
           const [loadingLogin, setLoadingLogin] = useState(false);
           const [loginError, setLoginError] = useState('');

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

           // 4 kemungkinan role: admin, bk_kesiswaan, guru, osis — default ke 'guru' kalau role tidak dikenali
           const roleKey = user && ROLES[String(user.role).toLowerCase().trim()] ? String(user.role).toLowerCase().trim() : 'guru';
           const roleConfig = ROLES[roleKey];

           const fetchTeachers = () => {
               if (roleKey !== 'admin') return;
               fetch(`${API_URL}?action=getTeachers&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json())
                   .then(data => { if (data.status === 'success') setTeachers(data.teachers); });
           };

           const fetchBimbingan = () => {
               if (roleKey !== 'admin' && roleKey !== 'bk_kesiswaan') return;
               fetch(`${API_URL}?action=getBimbingan&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json())
                   .then(data => { if (data.status === 'success') setBimbinganList(data.bimbingan); });
           };

           const fetchUpacara = () => {
               fetch(`${API_URL}?action=getPelanggaranUpacara&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json())
                   .then(data => { if (data.status === 'success') setUpacaraList(data.upacara); });
           };

           const fetchStudentsOnly = () => {
               fetch(`${API_URL}?action=getStudents&token=${API_TOKEN}&sessionToken=${sessionToken}`)
                   .then(res => res.json())
                   .then(data => { if (data.status === 'success') setStudents(data.students); });
           };

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
                       if (roleKey === 'admin') fetchTeachers();
                       if (roleKey === 'admin' || roleKey === 'bk_kesiswaan') { fetchBimbingan(); fetchUpacara(); }
                   }
               }
           }, [user]);

           const fetchData = () => {
               setLoadingLogs(true);
               fetch(`${API_URL}?action=getStudents&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(data => { if (data.status === 'success') setStudents(data.students); });
               fetch(`${API_URL}?action=getLogs&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(data => {
                   if (data.status === 'success') setAllLogs(data.logs);
                   setLoadingLogs(false);
               }).catch(() => setLoadingLogs(false));
               fetch(`${API_URL}?action=getSurat&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(data => { if (data.status === 'success') setSuratList(data.surat); });
               fetch(`${API_URL}?action=getPelanggaran&token=${API_TOKEN}&sessionToken=${sessionToken}`).then(res => res.json()).then(data => { if (data.status === 'success') setPelanggaranList(data.pelanggaran); });
           };

           const handleLogin = (e) => {
               e.preventDefault();
               setLoadingLogin(true);
               setLoginError('');
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'login', password: passwordInput, token: API_TOKEN }) })
                   .then(res => res.json())
                   .then(data => {
                       setLoadingLogin(false);
                       if (data.status === 'success') { setUser(data.user); setSessionToken(data.sessionToken); }
                       else setLoginError(data.message || 'Password salah!');
                   })
                   .catch(() => { setLoadingLogin(false); setLoginError('Koneksi Gagal. Coba lagi.'); });
           };

           const handleRecord = (type) => {
               const finalType = type === 'Custom' ? (customReasonInput.trim() || 'Lainnya') : type;
               const newEntry = { timestamp: new Date(), nisn: selectedStudent.nisn, name: selectedStudent.name, class: selectedStudent.class, type: finalType, logged_by: user.name };
               const payload = { action: 'record', nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, type: finalType, sessionToken: sessionToken, token: API_TOKEN };
               fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
                   .then(res => res.json())
                   .then(data => {
                       if (data.status === 'success') setAllLogs(prev => [newEntry, ...prev]);
                       else setToast('Gagal menyimpan, coba lagi.');
                   })
                   .catch(() => setToast('Koneksi gagal, coba lagi.'));
               setToast(`Berhasil mencatat: ${selectedStudent.name}`);
               setSelectedStudent(null); setCustomReasonInput('');
               setTimeout(() => setToast(null), 3000);
           };

           const handleAddTeacher = (payload, callback) => {
               setLoadingTeacherAction(true);
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addTeacher', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json())
                   .then(data => {
                       setLoadingTeacherAction(false);
                       if (data.status === 'success') {
                           setTeachers(prev => [...prev, { id: payload.newId, name: payload.newName, role: payload.newRole }]);
                           callback(true, 'Guru berhasil ditambahkan.');
                       } else callback(false, data.message || 'Gagal menambah guru.');
                   })
                   .catch(() => { setLoadingTeacherAction(false); callback(false, 'Koneksi gagal, coba lagi.'); });
           };

           const handleUpdatePassword = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updatePassword', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json())
                   .then(data => {
                       if (data.status === 'success') callback(true, 'Password berhasil diubah.');
                       else callback(false, data.message || 'Gagal mengubah password.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleAddSurat = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addSurat', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json())
                   .then(data => {
                       if (data.status === 'success') {
                           const newEntry = { timestamp: new Date(), nisn: payload.nisn, name: payload.name, class: payload.class_name, jenis: payload.jenis, keterangan: payload.keterangan || '', foto_url: data.fotoUrl || '', logged_by: user.name };
                           setSuratList(prev => [newEntry, ...prev]);
                           callback(true, 'Surat berhasil dicatat.');
                       } else callback(false, data.message || 'Gagal mencatat surat.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleDeleteSurat = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteSurat', sessionToken: sessionToken, token: API_TOKEN, ...payload }) })
                   .then(res => res.json())
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
                   .then(res => res.json())
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
                   .then(res => res.json())
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
                   .then(data => {
                       if (data.status === 'success') {
                           if (payload.category === 'terlambat') {
                               setAllLogs(prev => prev.map(item => sameEntry(item, payload) ? { ...item, type: payload.type } : item));
                           } else if (payload.category === 'pelanggaran') {
                               setPelanggaranList(prev => prev.map(item => sameEntry(item, payload) ? { ...item, jenis_pelanggaran: payload.jenis_pelanggaran, sanksi: payload.sanksi, catatan: payload.catatan } : item));
                           } else if (payload.category === 'surat') {
                               setSuratList(prev => prev.map(item => sameEntry(item, payload) ? { ...item, jenis: payload.jenis, keterangan: payload.keterangan } : item));
                               if (payload.fotoBase64) fetchData(); // foto baru butuh URL asli dari server, sinkronkan ulang
                           }
                           callback(true, 'Berhasil diperbarui.');
                       } else callback(false, data.message || 'Gagal memperbarui data.');
                   })
                   .catch(() => callback(false, 'Koneksi gagal, coba lagi.'));
           };

           const handleDeleteEntry = (payload, callback) => {
               fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteEntry', token: API_TOKEN, sessionToken: sessionToken, ...payload }) })
                   .then(res => res.json())
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
                   .then(res => res.json())
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
                       <LoginScreen onLogin={handleLogin} loading={loadingLogin} error={loginError} password={passwordInput} setPassword={setPasswordInput} />
                   ) : (
                       <div className="min-h-screen bg-slate-100 text-slate-900 relative select-none">
                           <Header user={user} roleLabel={roleConfig.label} onLogout={() => { setUser(null); setSessionToken(null); }} fontScale={fontScale} onFontScaleChange={changeFontScale} />

                           {toast && (
                               <div className="fixed bottom-24 inset-x-0 z-50 px-4">
                                   <div className="max-w-2xl mx-auto bg-sky text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center justify-between animate-pop border border-sky-light">
                                       <span>{toast}</span>
                                       <span className="font-bold bg-sky-dim px-2 py-1 rounded-lg">OK</span>
                                   </div>
                               </div>
                           )}

                           <div className="max-w-2xl mx-auto px-4 pt-20 pb-24">
                               {activeTab === 'scan' && roleConfig.menus.includes('scan') && (
                                   <GerbangTab students={students} allLogs={allLogs} onSelectLate={setSelectedStudent} suratList={suratList} onAddSurat={handleAddSurat} onDeleteSurat={handleDeleteSurat} isAdminUser={roleKey === 'admin'} />
                               )}
                               {activeTab === 'dashboard' && (
                                   <DashboardTab allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} onRefresh={fetchData} loading={loadingLogs} />
                               )}
                               {activeTab === 'log' && roleConfig.menus.includes('log') && (
                                   <LogTab
                                       allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} initialCategory={riwayatCategory}
                                       canManage={roleKey === 'admin' || roleKey === 'bk_kesiswaan'} isAdmin={roleKey === 'admin'}
                                       onEditEntry={handleEditEntry} onDeleteEntry={handleDeleteEntry}
                                   />
                               )}
                               {activeTab === 'stats' && roleConfig.menus.includes('stats') && <StatsTab allLogs={allLogs} pelanggaranList={pelanggaranList} suratList={suratList} canExport={roleConfig.canExport} />}
                               {activeTab === 'kelola' && roleConfig.menus.includes('kelola') && (
                                   <KelolaTab teachers={teachers} onAddTeacher={handleAddTeacher} onUpdatePassword={handleUpdatePassword} loading={loadingTeacherAction} />
                               )}
                               {activeTab === 'pelanggaran' && roleConfig.menus.includes('pelanggaran') && (
                                   <PelanggaranTab students={students} pelanggaranList={pelanggaranList} onAddPelanggaran={handleAddPelanggaran} onAddBimbingan={handleAddBimbingan} />
                               )}
                               {activeTab === 'bimbingan' && roleConfig.menus.includes('bimbingan') && (
                                   <BimbinganTab bimbinganList={bimbinganList} />
                               )}
                               {activeTab === 'upacara' && roleConfig.menus.includes('upacara') && (
                                   <UpacaraTab students={students} upacaraList={upacaraList} onAddUpacara={handleAddUpacara} isOsis={roleKey === 'osis'} />
                               )}
                           </div>

                           {selectedStudent && (
                               <RecordModal student={selectedStudent} customReason={customReasonInput} setCustomReason={setCustomReasonInput} onRecord={handleRecord} onClose={() => setSelectedStudent(null)} allLogs={allLogs} />
                           )}

                           <BottomNav menus={roleConfig.menus} primaryMenus={roleConfig.primaryMenus} activeTab={activeTab} setActiveTab={setActiveTab} />
                       </div>
                   )}
               </div>
           );
       }

       ReactDOM.createRoot(document.getElementById('root')).render(<App />);
