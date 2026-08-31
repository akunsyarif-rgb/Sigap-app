// ===== admin.js =====
// Panel Kelola Guru (khusus Admin): tambah guru baru, reset password, ubah
// jabatan tampilan. Juga berisi AuditLogTab (khusus Admin/BK-Kesiswaan).

       // Dipakai bareng oleh dropdown "Tambah Guru Baru" dan modal "Ubah Role" —
       // satu sumber, supaya value-nya tidak pernah drift dari key ROLES di config.js.
       const ROLE_OPTIONS = [
           { value: 'guru', label: 'Guru' },
           { value: 'bk_kesiswaan', label: 'BK / Kesiswaan' },
           { value: 'osis', label: 'OSIS' },
           { value: 'admin', label: 'Admin' },
       ];

       // Cermin dari HAPUS_DATA_JENIS di Utils.gs (pola yang sama dengan
       // EXPORT_JENIS_UI di export-data.js) — daftar pilihan di layar ini
       // cuma cermin dari yang server izinkan, bukan sumber kebenarannya.
       // Bimbingan Khusus & Pelanggaran Upacara SENGAJA tidak ada di sini —
       // lihat catatan panjang di HAPUS_DATA_JENIS kenapa baru empat jenis
       // ini yang disertakan Pemeliharaan Data > Hapus Data.
       const HAPUS_DATA_JENIS_UI = [
           { key: 'keterlambatan', label: 'Keterlambatan' },
           { key: 'pelanggaran', label: 'Pelanggaran' },
           { key: 'surat', label: 'Surat/Izin' },
           { key: 'izin', label: 'Izin Keluar' },
       ];

       // Kartu hub "Kelola" — satu tombol besar per sub-area (Guru / Jadwal
       // Piket / Pemeliharaan Data), dipakai di layar hub KelolaTab supaya
       // daftar guru yang panjang (54+ guru di sekolah nyata) tidak lagi
       // memaksa scroll panjang untuk sampai ke Jadwal Piket / hapus data.
       function KelolaHubCard({ icon, title, subtitle, onClick }) {
           return (
               <button onClick={onClick} className="w-full bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3.5 text-left hover:border-sky-dim/40 hover:bg-sky-dim/5 transition">
                   <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center flex-shrink-0">
                       <Icon path={icon} className="h-5 w-5 text-navy" />
                   </div>
                   <div className="min-w-0 flex-1">
                       <div className="text-sm font-display font-bold text-slate-900">{title}</div>
                       <div className="text-[11px] text-slate-500">{subtitle}</div>
                   </div>
                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />} className="h-4 w-4 text-slate-400 flex-shrink-0" />
               </button>
           );
       }

       // Header "← Kembali" dipakai di tiap sub-halaman Kelola — pola baru di
       // SIGAP (halaman lain semua datar, pindah lewat BottomNav), jadi
       // dipusatkan di satu komponen kecil supaya konsisten di 3 tempat.
       function KelolaSubHeader({ title, onBack }) {
           return (
               <div className="space-y-1.5">
                   <button onClick={onBack} className="flex items-center gap-1 text-[11px] font-bold text-sky-dim">
                       <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />} className="h-3.5 w-3.5" />
                       Kelola
                   </button>
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{title}</h2>
               </div>
           );
       }

       function KelolaTab({ teachers, students, jadwalPiket, onAddTeacher, onUpdatePassword, onUpdateJabatan, onToggleStatus, onUpdateRole, onUpdateWaliKelas, onUpdateName, onDeleteTeacher, onSetJadwalPiket, onPreviewHapusData, onHapusData, onGoToExportData, loading }) {
           // Hub-and-spoke: 'hub' nampilin 3 kartu, sisanya sub-halaman. Sengaja
           // local state (bukan lewat activeTab/NAV_ITEMS) — KelolaTab di-unmount
           // total tiap ganti tab dari app.js, jadi otomatis reset ke hub tiap
           // masuk ulang menu Kelola, tanpa logic reset manual.
           const [view, setView] = useState('hub');
           const [showAddGuru, setShowAddGuru] = useState(false);
           // Dropdown, bukan ketik manual — supaya nama kelas yang dipilih SELALU
           // persis sama dengan Master_Siswa, tidak ada typo yang bikin Rekap
           // Kelas/laporan wali kelas gagal mencocokkan data (lihat diskusi bug
           // "wali kelas baru tidak lihat laporan kelasnya").
           const kelasOptions = [...new Set(students.map(s => s.class))].sort((a, b) => String(a).localeCompare(String(b)));
           const [newId, setNewId] = useState('');
           const [newName, setNewName] = useState('');
           const [newPassword, setNewPassword] = useState('');
           const [newRole, setNewRole] = useState('guru');
           const [newJabatan, setNewJabatan] = useState('');
           const [resetTarget, setResetTarget] = useState(null);
           const [resetPassword, setResetPassword] = useState('');
           const [jabatanTarget, setJabatanTarget] = useState(null);
           const [jabatanInput, setJabatanInput] = useState('');
           const [roleTarget, setRoleTarget] = useState(null);
           const [roleInput, setRoleInput] = useState('guru');
           const [waliKelasTarget, setWaliKelasTarget] = useState(null);
           const [waliKelasInput, setWaliKelasInput] = useState('');
           const [nameTarget, setNameTarget] = useState(null);
           const [nameInput, setNameInput] = useState('');
           const [confirmDeleteGuru, setConfirmDeleteGuru] = useState(null);
           const [deletingGuru, setDeletingGuru] = useState(false);
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');
           // Daftar Guru: satu-satunya list di SIGAP yang sebelumnya tidak punya
           // kotak cari, padahal pola ini sudah dipakai konsisten di 4 halaman
           // lain (Gerbang, Riwayat, Pelanggaran, Upacara) — jadi sekolah dengan
           // banyak guru tidak perlu scroll manual satu-satu.
           const [searchGuru, setSearchGuru] = useState('');
           const filteredTeachers = searchGuru.trim() === '' ? teachers : teachers.filter(t =>
               t.name.toLowerCase().includes(searchGuru.toLowerCase()) ||
               String(t.id).toLowerCase().includes(searchGuru.toLowerCase())
           );

           const showMsg = (ok, text) => {
               setMsgTone(ok ? 'sky' : 'crimson');
               setMsg(text);
               setTimeout(() => setMsg(''), 3000);
           };

           const submitAdd = (e) => {
               e.preventDefault();
               if (!newId.trim() || !newName.trim() || !newPassword.trim()) return;
               onAddTeacher({ newId: newId.trim(), newName: newName.trim(), newPassword: newPassword.trim(), newRole, newJabatan: newJabatan.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   if (ok) { setNewId(''); setNewName(''); setNewPassword(''); setNewRole('guru'); setNewJabatan(''); setShowAddGuru(false); }
               });
           };

           const submitReset = () => {
               if (!resetPassword.trim() || !resetTarget) return;
               onUpdatePassword({ targetId: resetTarget.id, newPassword: resetPassword.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   setResetTarget(null); setResetPassword('');
               });
           };

           const submitJabatan = () => {
               if (!jabatanTarget) return;
               onUpdateJabatan({ targetId: jabatanTarget.id, newJabatan: jabatanInput.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   setJabatanTarget(null); setJabatanInput('');
               });
           };

           const submitRole = () => {
               if (!roleTarget) return;
               onUpdateRole({ targetId: roleTarget.id, newRole: roleInput }, (ok, text) => {
                   showMsg(ok, text);
                   setRoleTarget(null);
               });
           };

           const submitWaliKelas = () => {
               if (!waliKelasTarget) return;
               onUpdateWaliKelas({ targetId: waliKelasTarget.id, newKelasWali: waliKelasInput.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   setWaliKelasTarget(null); setWaliKelasInput('');
               });
           };

           const submitName = () => {
               if (!nameTarget || !nameInput.trim()) return;
               onUpdateName({ targetId: nameTarget.id, newName: nameInput.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   if (ok) { setNameTarget(null); setNameInput(''); }
               });
           };

           const executeDeleteGuru = () => {
               if (!confirmDeleteGuru) return;
               setDeletingGuru(true);
               onDeleteTeacher({ targetId: confirmDeleteGuru.id }, (ok, text) => {
                   setDeletingGuru(false);
                   showMsg(ok, text);
                   setConfirmDeleteGuru(null);
               });
           };

           // ===== Jadwal Piket mingguan (pola tetap, tanpa pengecualian per
           // tanggal — Blueprint SIGAP v2 memilih ini supaya tetap sederhana) =====
           const HARI_LIST = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
           const [jadwalDraft, setJadwalDraft] = useState(() => jadwalPiket.map(j => ({ hari: j.hari, guruId: j.guruId })));
           const [jadwalDirty, setJadwalDirty] = useState(false);
           const [pickHari, setPickHari] = useState('Senin');
           const [pickGuruSearch, setPickGuruSearch] = useState('');
           const [confirmAddGuru, setConfirmAddGuru] = useState(null);

           useEffect(() => {
               if (!jadwalDirty) setJadwalDraft(jadwalPiket.map(j => ({ hari: j.hari, guruId: j.guruId })));
           }, [jadwalPiket]);

           const guruName = (id) => { const t = teachers.find(t => String(t.id) === String(id)); return t ? t.name : id; };

           // teachers sudah diurut abjad dari server (getTeachers) — cari di sini
           // cuma memfilter, tidak mengurutkan ulang, supaya listnya tetap abjad.
           const activeTeachers = teachers.filter(t => t.status !== 'nonaktif');
           const pickGuruOptions = pickGuruSearch.trim() === '' ? activeTeachers : activeTeachers.filter(t =>
               t.name.toLowerCase().includes(pickGuruSearch.toLowerCase())
           );

           // Tap nama -> minta konfirmasi dulu (bukan langsung tambah) -- guru
           // piket yang namanya mirip gampang ke-tap salah kalau langsung
           // eksekusi. hari di-snapshot di sini (bukan baca ulang pickHari saat
           // konfirmasi ditekan), sama seperti confirmDeleteSurat di bawah,
           // supaya kalau dropdown hari sempat berubah selagi dialog terbuka,
           // yang benar-benar ditambahkan tetap sesuai yang ditampilkan di dialog.
           const requestAddJadwal = (guruId, guruName) => {
               setConfirmAddGuru({ id: guruId, name: guruName, hari: pickHari });
           };

           const executeAddJadwal = () => {
               if (!confirmAddGuru) return;
               const { id, name, hari } = confirmAddGuru;
               setConfirmAddGuru(null);
               if (jadwalDraft.some(j => j.hari === hari && String(j.guruId) === String(id))) {
                   showMsg(false, `${name} sudah ada di jadwal piket ${hari}.`);
                   return;
               }
               setJadwalDraft(prev => [...prev, { hari, guruId: id }]);
               setJadwalDirty(true);
               setPickGuruSearch('');
               showMsg(true, `✓ ${name} ditambahkan ke jadwal piket ${hari}.`);
           };

           const removeJadwalEntry = (hari, guruId) => {
               setJadwalDraft(prev => prev.filter(j => !(j.hari === hari && String(j.guruId) === String(guruId))));
               setJadwalDirty(true);
           };

           const submitJadwal = () => {
               onSetJadwalPiket({ schedule: jadwalDraft }, (ok, text) => {
                   showMsg(ok, text);
                   if (ok) setJadwalDirty(false);
               });
           };

           // ===== Pemeliharaan Data > Hapus Data — evolusi dari "Hapus Data
           // Surat per Bulan/Tahun" yang lama (satu sheet, satu bulan/tahun,
           // tanpa pratinjau, langsung eksekusi begitu tombol ditekan). Alur
           // barunya SELALU dua tahap: Tahap 1 di halaman ini (periode bebas +
           // pilih beberapa jenis data), Tahap 2 di modal confirmHapusData di
           // bawah (jumlah data hasil pratinjau server + centang konfirmasi
           // eksplisit) — tombol hapus di modal itu satu-satunya jalan
           // eksekusi, tidak ada cara langsung menghapus dari Tahap 1. =====
           const [hapusStart, setHapusStart] = useState(() => toDateInputValue(startOfMonth(new Date())));
           const [hapusEnd, setHapusEnd] = useState(() => toDateInputValue(new Date()));
           const [hapusJenis, setHapusJenis] = useState({ keterlambatan: false, pelanggaran: false, surat: false, izin: false });
           const [hapusPreviewMsg, setHapusPreviewMsg] = useState('');
           const [hapusPreviewLoading, setHapusPreviewLoading] = useState(false);
           // confirmHapusData MENYIMPAN snapshot jenis+periode+hasil pratinjau
           // saat pratinjau berhasil dimuat (bukan baca ulang state periode
           // saat eksekusi ditekan) — pola sama seperti confirmDeleteSurat
           // lama, supaya kalau form Tahap 1 sempat berubah selagi modal
           // Tahap 2 terbuka, yang benar-benar dikirim ke server tetap sesuai
           // yang ditampilkan di dialog konfirmasi.
           const [confirmHapusData, setConfirmHapusData] = useState(null);
           const [hapusConfirmChecked, setHapusConfirmChecked] = useState(false);
           const [hapusDeleting, setHapusDeleting] = useState(false);

           const hapusJenisTerpilih = () => HAPUS_DATA_JENIS_UI.map(j => j.key).filter(k => hapusJenis[k]);

           const applyHapusShortcut = (kind) => {
               const now = new Date();
               if (kind === 'hari_ini') {
                   const t = toDateInputValue(now);
                   setHapusStart(t); setHapusEnd(t);
               } else if (kind === 'bulan_ini') {
                   setHapusStart(toDateInputValue(startOfMonth(now)));
                   setHapusEnd(toDateInputValue(now));
               } else if (kind === 'bulan_lalu') {
                   const bulanLalu = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                   setHapusStart(toDateInputValue(startOfMonth(bulanLalu)));
                   setHapusEnd(toDateInputValue(endOfMonth(bulanLalu)));
               }
               setHapusPreviewMsg('');
           };

           const toggleHapusJenis = (key) => {
               setHapusJenis(prev => ({ ...prev, [key]: !prev[key] }));
               setHapusPreviewMsg('');
           };

           // Pratinjau di sini HANYA kenyamanan layar (biar admin tidak perlu
           // ke server dulu untuk tahu formnya belum lengkap) — server TETAP
           // memvalidasi ulang semuanya (lihat previewHapusData di Code.gs),
           // jadi longgar-ketatnya pengecekan di sini tidak pernah jadi celah.
           const requestPreviewHapusData = () => {
               const jenis = hapusJenisTerpilih();
               if (!hapusStart || !hapusEnd) { setHapusPreviewMsg('Isi tanggal mulai dan tanggal selesai.'); return; }
               if (hapusStart > hapusEnd) { setHapusPreviewMsg('Tanggal mulai tidak boleh melewati tanggal selesai.'); return; }
               if (!jenis.length) { setHapusPreviewMsg('Pilih minimal satu jenis data.'); return; }
               setHapusPreviewMsg('');
               setHapusPreviewLoading(true);
               onPreviewHapusData({ jenis, start: hapusStart, end: hapusEnd }, (ok, result) => {
                   setHapusPreviewLoading(false);
                   if (!ok) { setHapusPreviewMsg(typeof result === 'string' ? result : 'Gagal memuat pratinjau.'); return; }
                   setHapusConfirmChecked(false);
                   setConfirmHapusData({
                       jenis, start: hapusStart, end: hapusEnd,
                       counts: result.counts || {}, total: result.total || 0, periodeLabel: result.periodeLabel || '',
                   });
               });
           };

           const executeHapusData = () => {
               if (!confirmHapusData || !hapusConfirmChecked) return;
               setHapusDeleting(true);
               onHapusData({ jenis: confirmHapusData.jenis, start: confirmHapusData.start, end: confirmHapusData.end, confirm: true }, (ok, result) => {
                   setHapusDeleting(false);
                   if (ok) {
                       showMsg(true, `✓ Berhasil menghapus ${result && result.total || 0} data.`);
                       setConfirmHapusData(null);
                       setHapusConfirmChecked(false);
                   } else {
                       showMsg(false, typeof result === 'string' ? result : 'Gagal menghapus data.');
                   }
               });
           };

           return (
               <div className="space-y-5 animate-rise">
                   {view === 'hub' && (
                       <React.Fragment>
                           <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Kelola</h2>
                           {msg && (
                               <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>
                                   {msg}
                               </div>
                           )}
                           <div className="space-y-2.5">
                               <KelolaHubCard
                                   icon={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />}
                                   title="Kelola Guru" subtitle={`Akun, role & wali kelas • ${teachers.length} guru`} onClick={() => setView('guru')}
                               />
                               <KelolaHubCard
                                   icon={<path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />}
                                   title="Jadwal Piket" subtitle="Atur guru piket harian" onClick={() => setView('jadwal')}
                               />
                               <KelolaHubCard
                                   icon={<path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6.75 3.75h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5C21.75 4.254 21.246 3.75 20.625 3.75H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />}
                                   title="Pemeliharaan Data" subtitle="Kelola & hapus data lama" onClick={() => setView('surat')}
                               />
                           </div>
                       </React.Fragment>
                   )}

                   {view === 'guru' && (
                       <React.Fragment>
                           <KelolaSubHeader title="Kelola Guru" onBack={() => setView('hub')} />
                           {msg && (
                               <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>
                                   {msg}
                               </div>
                           )}

                           <Button onClick={() => setShowAddGuru(true)} className="w-full">+ Tambah Guru</Button>

                           <Card>
                               <h3 className="text-xs font-display font-bold text-slate-800 mb-3">Daftar Guru ({teachers.length})</h3>
                               {teachers.length === 0 && <div className="text-xs text-slate-500 py-2">Memuat daftar guru...</div>}
                               {teachers.length > 0 && (
                                   <input type="text" value={searchGuru} onChange={(e) => setSearchGuru(e.target.value)} placeholder="Cari nama atau ID guru..." className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky mb-3" />
                               )}
                               <div className="space-y-2">
                                   {filteredTeachers.length === 0 && teachers.length > 0 && (
                                       <div className="text-xs text-slate-500 py-2 text-center">Tidak ada guru yang cocok dengan pencarian.</div>
                                   )}
                                   {filteredTeachers.map(t => (
                                       <div key={t.id} className="bg-white/60 rounded-xl px-3 py-2.5 space-y-2">
                                           <div className="flex items-center justify-between gap-2">
                                               <div className="min-w-0">
                                                   <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                                       {t.name}
                                                       {t.status === 'nonaktif' && <span className="text-[9px] bg-crimson/10 text-crimson px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">NONAKTIF</span>}
                                                   </div>
                                                   <div className="text-[10px] text-slate-500">{t.id} • {t.jabatan || (ROLES[String(t.role).toLowerCase().trim()] ? ROLES[String(t.role).toLowerCase().trim()].label : 'Guru')}{t.kelasWali && ` • Wali ${t.kelasWali}`}</div>
                                               </div>
                                           </div>
                                           <div className="flex gap-1.5 flex-wrap">
                                               <button onClick={() => { setNameTarget(t); setNameInput(t.name || ''); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Edit Nama</button>
                                               <button onClick={() => { setRoleTarget(t); setRoleInput(String(t.role || 'guru').toLowerCase().trim()); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Role</button>
                                               <button onClick={() => { setJabatanTarget(t); setJabatanInput(t.jabatan || ''); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Jabatan</button>
                                               <button onClick={() => { setWaliKelasTarget(t); setWaliKelasInput(t.kelasWali || ''); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Wali Kelas</button>
                                               <button onClick={() => setResetTarget(t)} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Password</button>
                                               <button onClick={() => onToggleStatus({ targetId: t.id }, (ok, text) => showMsg(ok, text))} className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border ${t.status === 'nonaktif' ? 'bg-sky-dim/10 border-sky-dim/40 text-sky-dim' : 'bg-crimson/10 border-crimson/30 text-crimson'}`}>
                                                   {t.status === 'nonaktif' ? 'Aktifkan' : 'Nonaktifkan'}
                                               </button>
                                               <button onClick={() => setConfirmDeleteGuru(t)} className="text-[10px] font-semibold bg-crimson/10 border border-crimson/30 text-crimson px-2.5 py-1.5 rounded-lg">Hapus</button>
                                           </div>
                                       </div>
                                   ))}
                               </div>
                           </Card>
                       </React.Fragment>
                   )}

                   {view === 'jadwal' && (
                       <React.Fragment>
                           <KelolaSubHeader title="Jadwal Piket" onBack={() => setView('hub')} />
                           {msg && (
                               <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>
                                   {msg}
                               </div>
                           )}
                           <Card className="space-y-3">
                               <h3 className="text-xs font-display font-bold text-slate-800">Jadwal Piket Mingguan</h3>
                               <p className="text-[10px] text-slate-500 leading-relaxed">Pola tetap per hari, berulang tiap minggu. Kalau ada tukar piket dadakan, ubah manual di sini.</p>

                               {HARI_LIST.map(hari => {
                                   const entries = jadwalDraft.filter(j => j.hari === hari);
                                   return (
                                       <div key={hari} className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                                           <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{hari}</div>
                                           {entries.length > 0 ? (
                                               <div className="flex flex-wrap gap-1.5">
                                                   {entries.map((j, i) => (
                                                       <span key={i} className="text-[10px] font-semibold bg-white border border-slate-300 text-slate-700 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                                                           {guruName(j.guruId)}
                                                           {/* p-1 -m-1 (bukan padding besar) -- chip ini di flex-wrap
                                                               berdempetan (gap-1.5 = 6px), jadi perluasan area tap
                                                               dibatasi supaya tidak pernah tabrakan dengan chip
                                                               sebelah walau saat wrap paling rapat. */}
                                                           <button onClick={() => removeJadwalEntry(j.hari, j.guruId)} aria-label={`Hapus ${guruName(j.guruId)} dari piket ${j.hari}`} className="text-crimson font-bold p-1 -m-1">×</button>
                                                       </span>
                                                   ))}
                                               </div>
                                           ) : (
                                               <div className="text-[10px] text-slate-500">Belum ada guru piket.</div>
                                           )}
                                       </div>
                                   );
                               })}

                               <div className="flex items-center gap-2">
                                   <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex-shrink-0">Tambah ke</label>
                                   <select value={pickHari} onChange={(e) => setPickHari(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       {HARI_LIST.map(h => <option key={h} value={h}>{h}</option>)}
                                   </select>
                               </div>
                               <input type="text" value={pickGuruSearch} onChange={(e) => setPickGuruSearch(e.target.value)} placeholder="Cari nama guru untuk ditambahkan..." className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               {/* Tap NAMA langsung menambahkan -- bukan sekadar menyaring
                                   <select> tersembunyi seperti sebelumnya (dilaporkan sebagai
                                   "klik nama tidak muncul apa-apa"). min-h-[48px] sama seperti
                                   daftar guru di layar Login, untuk tap-target yang konsisten. */}
                               {pickGuruSearch.trim() !== '' && (
                                   <div className="bg-white border border-slate-300 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                                       {pickGuruOptions.length === 0 && (
                                           <div className="text-xs text-slate-500 px-3 py-2.5">Tidak ada guru cocok.</div>
                                       )}
                                       {pickGuruOptions.map(t => (
                                           <button key={t.id} type="button" onClick={() => requestAddJadwal(t.id, t.name)} className="w-full text-left px-3 min-h-[48px] flex items-center text-xs font-semibold text-slate-700 active:bg-sky-dim/10 transition">
                                               {t.name}
                                           </button>
                                       ))}
                                   </div>
                               )}

                               <Button onClick={submitJadwal} disabled={!jadwalDirty} className="w-full">Simpan Jadwal Piket</Button>
                           </Card>
                       </React.Fragment>
                   )}

                   {view === 'surat' && (
                       <React.Fragment>
                           <KelolaSubHeader title="Pemeliharaan Data" onBack={() => setView('hub')} />
                           {msg && (
                               <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>
                                   {msg}
                               </div>
                           )}
                           <p className="text-[11px] text-slate-500 leading-relaxed">
                               Hapus data operasional lama berdasarkan rentang tanggal. Jumlah data yang
                               akan terhapus SELALU ditampilkan dulu untuk dikonfirmasi — tidak ada
                               penghapusan langsung dari halaman ini.
                           </p>

                           <Card className="space-y-3">
                               <h3 className="text-xs font-display font-bold text-slate-800">Periode Data</h3>
                               <div className="grid grid-cols-3 gap-2">
                                   <Button size="compact" variant="ghost" onClick={() => applyHapusShortcut('hari_ini')}>Hari Ini</Button>
                                   <Button size="compact" variant="ghost" onClick={() => applyHapusShortcut('bulan_ini')}>Bulan Ini</Button>
                                   <Button size="compact" variant="ghost" onClick={() => applyHapusShortcut('bulan_lalu')}>Bulan Lalu</Button>
                               </div>
                               <div className="grid grid-cols-2 gap-2">
                                   <div>
                                       <span className="block text-[10px] text-slate-500 mb-1">Tanggal Mulai</span>
                                       <input type="date" value={hapusStart} onChange={(e) => { setHapusStart(e.target.value); setHapusPreviewMsg(''); }} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                   </div>
                                   <div>
                                       <span className="block text-[10px] text-slate-500 mb-1">Tanggal Selesai</span>
                                       <input type="date" value={hapusEnd} onChange={(e) => { setHapusEnd(e.target.value); setHapusPreviewMsg(''); }} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                   </div>
                               </div>
                           </Card>

                           <Card className="space-y-2">
                               <h3 className="text-xs font-display font-bold text-slate-800">Pilih Data</h3>
                               <p className="text-[10px] text-slate-500">Hanya jenis data operasional yang aman dihapus massal. Audit Log serta data guru & siswa tidak ada di menu ini.</p>
                               <div className="space-y-1.5">
                                   {HAPUS_DATA_JENIS_UI.map(j => (
                                       <label key={j.key} className="flex items-center gap-2.5 bg-white/60 rounded-xl px-3 py-2.5 cursor-pointer">
                                           <input type="checkbox" checked={!!hapusJenis[j.key]} onChange={() => toggleHapusJenis(j.key)} className="h-4 w-4 flex-shrink-0" />
                                           <span className="text-xs font-semibold text-slate-700">{j.label}</span>
                                       </label>
                                   ))}
                               </div>
                           </Card>

                           <Card tone="crimson" className="space-y-2.5">
                               <h3 className="text-xs font-display font-bold text-crimson">Keamanan Data</h3>
                               <p className="text-[11px] text-slate-600 leading-relaxed">Data yang dihapus tidak dapat dipulihkan dari SIGAP. Pastikan data penting telah diekspor.</p>
                               <Button variant="secondary" className="w-full" onClick={() => onGoToExportData({ jenis: hapusJenisTerpilih()[0], start: hapusStart, end: hapusEnd })}>
                                   Export Data Terlebih Dahulu
                               </Button>
                           </Card>

                           {hapusPreviewMsg && (
                               <div className="text-xs font-medium text-center py-2 rounded-lg border text-crimson bg-crimson/10 border-crimson/30">{hapusPreviewMsg}</div>
                           )}

                           <Button onClick={requestPreviewHapusData} variant="danger" className="w-full" disabled={hapusPreviewLoading}>
                               {hapusPreviewLoading ? 'Menghitung...' : 'Lihat Pratinjau & Hapus'}
                           </Button>
                       </React.Fragment>
                   )}

                   {showAddGuru && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-3 animate-pop my-4">
                               <div className="flex items-center justify-between">
                                   <h3 className="text-sm font-display font-bold text-slate-800">Tambah Guru Baru</h3>
                                   {/* p-2.5 (bukan tanpa padding) -- baris judul modal ini punya
                                       banyak ruang kosong di kanan, aman diperbesar ke >=44px tanpa
                                       risiko tabrakan (beda dari tombol × di chip Jadwal Piket yang
                                       berdesakan di baris flex-wrap). */}
                                   <button onClick={() => setShowAddGuru(false)} aria-label="Tutup" className="text-slate-400 text-xl leading-none p-2.5 -m-2.5">×</button>
                               </div>
                               <form onSubmit={submitAdd} className="space-y-3">
                                   <input type="text" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="ID Guru (contoh: G21)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                                   <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama Lengkap" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                                   <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password Awal" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                                   <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                   </select>
                                   <input type="text" value={newJabatan} onChange={(e) => setNewJabatan(e.target.value)} placeholder="Jabatan tampilan (opsional, misal: Kepala Sekolah)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                   <p className="text-[10px] text-slate-500 leading-relaxed">Kosongkan Jabatan kalau mau tampil label peran biasa (misal "BK/Kesiswaan"). Isi kalau mau tampil beda, misal akun BK/Kesiswaan untuk Kepala Sekolah — hak aksesnya tetap sama seperti BK/Kesiswaan, cuma labelnya yang beda.</p>
                                   <Button type="submit" disabled={loading} className="w-full">
                                       {loading ? 'Menyimpan...' : 'Tambah Guru'}
                                   </Button>
                               </form>
                           </div>
                       </div>
                   )}

                   {resetTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Reset Password</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{resetTarget.name}</div>
                               </div>
                               <input type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="Password baru" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <Button onClick={submitReset} className="w-full">Simpan Password Baru</Button>
                               <Button onClick={() => { setResetTarget(null); setResetPassword(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {roleTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Ubah Role</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{roleTarget.name}</div>
                                   <div className="text-[10px] text-slate-500 mt-1">Berguna kalau guru ini juga merangkap BK/Kesiswaan, dsb.</div>
                               </div>
                               <select value={roleInput} onChange={(e) => setRoleInput(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                   {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                               </select>
                               <Button onClick={submitRole} className="w-full">Simpan Role</Button>
                               <Button onClick={() => setRoleTarget(null)} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {jabatanTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Ubah Jabatan Tampilan</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{jabatanTarget.name}</div>
                                   <div className="text-[10px] text-slate-500 mt-1">Hak akses tetap sesuai role: {ROLES[String(jabatanTarget.role).toLowerCase().trim()] ? ROLES[String(jabatanTarget.role).toLowerCase().trim()].label : 'Guru'}</div>
                               </div>
                               <input type="text" value={jabatanInput} onChange={(e) => setJabatanInput(e.target.value)} placeholder="Kosongkan untuk label default" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <Button onClick={submitJabatan} className="w-full">Simpan Jabatan</Button>
                               <Button onClick={() => { setJabatanTarget(null); setJabatanInput(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {nameTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Edit Nama</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{nameTarget.name}</div>
                                   <div className="text-[10px] text-slate-500 mt-1">Perbaiki nama yang salah ketik. ID, password, role, dan riwayat tidak berubah.</div>
                               </div>
                               <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Nama lengkap" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <Button onClick={submitName} disabled={!nameInput.trim()} className="w-full">Simpan Nama</Button>
                               <Button onClick={() => { setNameTarget(null); setNameInput(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {waliKelasTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Atur Wali Kelas</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{waliKelasTarget.name}</div>
                               </div>
                               <select value={waliKelasInput} onChange={(e) => setWaliKelasInput(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                   <option value="">Tidak ada (lepas status wali kelas)</option>
                                   {kelasOptions.map(k => <option key={k} value={k}>{k}</option>)}
                               </select>
                               <Button onClick={submitWaliKelas} className="w-full">Simpan Wali Kelas</Button>
                               <Button onClick={() => { setWaliKelasTarget(null); setWaliKelasInput(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {confirmDeleteGuru && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-crimson uppercase tracking-widest font-bold">Hapus Akun Guru?</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{confirmDeleteGuru.name}</div>
                                   <p className="text-[11px] text-slate-500 mt-2">Akun ini akan dihapus permanen dan tidak bisa login lagi. Riwayat catatan yang sudah tersimpan tidak ikut terhapus. Kalau ini cuma nama yang salah ketik, gunakan "Edit Nama" saja, bukan Hapus.</p>
                               </div>
                               <Button onClick={executeDeleteGuru} disabled={deletingGuru} variant="danger" className="w-full">
                                   {deletingGuru ? 'Menghapus...' : 'Ya, Hapus'}
                               </Button>
                               <Button onClick={() => setConfirmDeleteGuru(null)} variant="secondary" className="w-full" disabled={deletingGuru}>Batal</Button>
                           </div>
                       </div>
                   )}

                   {confirmAddGuru && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Tambah Guru Piket?</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{confirmAddGuru.name}</div>
                                   <p className="text-[11px] text-slate-500 mt-2">Ditambahkan ke jadwal piket hari <b>{confirmAddGuru.hari}</b>.</p>
                               </div>
                               <Button onClick={executeAddJadwal} className="w-full">Ya, Tambahkan</Button>
                               <Button onClick={() => setConfirmAddGuru(null)} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {/* Tahap 2 dari alur Hapus Data: jumlah data hasil pratinjau SERVER
                       (bukan tebakan klien) + konfirmasi eksplisit lewat checkbox — pola
                       yang sama semangatnya dengan confirmDeleteGuru/confirmDeleteTarget
                       (Riwayat), cuma di sini tombol hapus TETAP nonaktif sampai
                       checkbox-nya dicentang, karena cakupannya bisa lintas kategori &
                       lintas periode bebas (bukan cuma satu bulan seperti sebelumnya). */}
                   {confirmHapusData && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-crimson uppercase tracking-widest font-bold">Pratinjau Penghapusan</h3>
                                   <div className="font-display text-sm font-extrabold text-slate-900 mt-1">{confirmHapusData.periodeLabel}</div>
                               </div>
                               <div className="space-y-1.5">
                                   {confirmHapusData.jenis.map(key => {
                                       const def = HAPUS_DATA_JENIS_UI.find(j => j.key === key);
                                       return (
                                           <div key={key} className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                                               <span>{def ? def.label : key}</span>
                                               <span className="font-bold text-slate-900">{confirmHapusData.counts[key] || 0}</span>
                                           </div>
                                       );
                                   })}
                                   <div className="flex items-center justify-between text-xs font-bold text-crimson bg-crimson/10 rounded-lg px-3 py-2">
                                       <span>Total</span>
                                       <span>{confirmHapusData.total}</span>
                                   </div>
                               </div>
                               {confirmHapusData.total === 0 ? (
                                   <p className="text-[11px] text-slate-500 text-center">Tidak ada data pada periode & jenis ini — tidak ada yang perlu dihapus.</p>
                               ) : (
                                   <React.Fragment>
                                       <label className="flex items-start gap-2.5 text-[11px] text-slate-600 leading-relaxed cursor-pointer">
                                           <input type="checkbox" checked={hapusConfirmChecked} onChange={(e) => setHapusConfirmChecked(e.target.checked)} className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                           <span>Saya memahami bahwa data yang dipilih akan dihapus permanen dan tidak dapat dipulihkan dari SIGAP.</span>
                                       </label>
                                       <Button onClick={executeHapusData} disabled={!hapusConfirmChecked || hapusDeleting} variant="danger" className="w-full">
                                           {hapusDeleting ? 'Menghapus...' : `Ya, Hapus ${confirmHapusData.total} Data Ini`}
                                       </Button>
                                   </React.Fragment>
                               )}
                               <Button onClick={() => { setConfirmHapusData(null); setHapusConfirmChecked(false); }} variant="secondary" className="w-full" disabled={hapusDeleting}>
                                   {confirmHapusData.total === 0 ? 'Tutup' : 'Batal'}
                               </Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }

       function AuditLogTab({ auditLog }) {
           const [search, setSearch] = useState('');
           const filtered = auditLog.filter(a =>
               !search.trim() ||
               a.name.toLowerCase().includes(search.toLowerCase()) ||
               a.action.toLowerCase().includes(search.toLowerCase())
           );

           const actionTone = (action) => {
               if (action === 'Login' || action === 'Logout') return 'bg-slate-100 text-slate-600';
               if (action.indexOf('Hapus') === 0) return 'bg-crimson/10 text-crimson';
               if (action.indexOf('Tambah') === 0) return 'bg-sky-dim/10 text-sky-dim';
               return 'bg-amber-50 text-amber-700';
           };

           return (
               <div className="space-y-4 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Audit Log</h2>
                   <p className="text-[11px] text-slate-500">Jejak keamanan permanen — siapa melakukan apa. Hanya Admin dan BK/Kesiswaan yang bisa lihat ini. Menampilkan 300 aktivitas terakhir.</p>

                   <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama atau jenis aksi..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{filtered.length} catatan</h3>

                   {filtered.length > 0 ? (
                       <div className="space-y-2">
                           {filtered.map((a, idx) => {
                               const dt = parseTimestamp(a.timestamp);
                               return (
                                   <RowCard key={idx} className="space-y-1">
                                       <div className="flex items-center justify-between gap-2">
                                           <span className="text-xs font-bold text-slate-900">{a.name}</span>
                                           <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${actionTone(a.action)}`}>{a.action}</span>
                                       </div>
                                       {a.detail && <div className="text-[11px] text-slate-500">{a.detail}</div>}
                                       <div className="text-[10px] text-slate-500">{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} • {dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                   </RowCard>
                               );
                           })}
                       </div>
                   ) : (
                       <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />} text="Belum ada catatan audit." />
                   )}
               </div>
           );
       }

