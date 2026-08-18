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

       // Kartu hub "Kelola" — satu tombol besar per sub-area (Guru / Jadwal
       // Piket / Pemeliharaan Data), dipakai di layar hub KelolaTab supaya
       // daftar guru yang panjang (54+ guru di sekolah nyata) tidak lagi
       // memaksa scroll panjang untuk sampai ke Jadwal Piket / hapus data.
       function KelolaHubCard({ emoji, title, subtitle, onClick }) {
           return (
               <button onClick={onClick} className="w-full bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3.5 text-left hover:border-sky-dim/40 hover:bg-sky-dim/5 transition">
                   <div className="text-2xl flex-shrink-0">{emoji}</div>
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

       function KelolaTab({ teachers, students, jadwalPiket, onAddTeacher, onUpdatePassword, onUpdateJabatan, onToggleStatus, onUpdateRole, onUpdateWaliKelas, onUpdateName, onDeleteTeacher, onSetJadwalPiket, onDeleteSurat, loading }) {
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

           // Tap nama langsung menambahkan (bukan pilih di <select> lalu tekan
           // tombol Tambah terpisah) -- sebelumnya kotak cari cuma menyaring
           // <select> yang tersembunyi di baliknya, jadi tampak seperti tidak
           // berfungsi sama sekali saat nama di-tap. Satu tap = satu keputusan,
           // sama seperti pola cari-lalu-pilih di tempat lain (Gerbang, dst.).
           const addJadwalEntry = (guruId) => {
               if (!guruId) return;
               if (jadwalDraft.some(j => j.hari === pickHari && String(j.guruId) === String(guruId))) return;
               setJadwalDraft(prev => [...prev, { hari: pickHari, guruId }]);
               setJadwalDirty(true);
               setPickGuruSearch('');
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

           // ===== Hapus Data Surat per Bulan/Tahun — dipindah dari Gerbang ke
           // sini (Roadmap: Gerbang tidak lagi jadi tempat browsing/kelola data,
           // cuma cari-pilih-catat; ini murni tugas admin, bukan guru piket). =====
           const [showDeleteSuratPanel, setShowDeleteSuratPanel] = useState(false);
           const [delSuratMonth, setDelSuratMonth] = useState(String(new Date().getMonth() + 1));
           const [delSuratYear, setDelSuratYear] = useState(String(new Date().getFullYear()));
           // Hapus massal (1 bulan penuh, tidak bisa dibatalkan) sebelumnya
           // langsung eksekusi begitu tombol ditekan — beda dari hapus 1 baris
           // di Riwayat yang sudah punya dialog konfirmasi (confirmDeleteTarget).
           // confirmDeleteSurat MENYIMPAN snapshot bulan/tahun saat tombol
           // ditekan (bukan baca ulang delSuratMonth/delSuratYear saat eksekusi)
           // supaya kalau dropdown sempat berubah selagi dialog terbuka, yang
           // benar-benar terhapus tetap sesuai yang ditampilkan di dialog.
           const [confirmDeleteSurat, setConfirmDeleteSurat] = useState(null);
           const [deletingSurat, setDeletingSurat] = useState(false);
           const monthLabel = (m) => new Date(2000, parseInt(m, 10) - 1).toLocaleDateString('id-ID', { month: 'long' });
           const requestDeleteSurat = () => {
               setConfirmDeleteSurat({ month: delSuratMonth, year: delSuratYear });
           };
           const executeDeleteSurat = () => {
               if (!confirmDeleteSurat) return;
               setDeletingSurat(true);
               onDeleteSurat({ month: confirmDeleteSurat.month, year: confirmDeleteSurat.year }, (ok, text) => {
                   setDeletingSurat(false);
                   showMsg(ok, text);
                   setConfirmDeleteSurat(null);
                   setShowDeleteSuratPanel(false);
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
                               <KelolaHubCard emoji="👤" title="Kelola Guru" subtitle={`Akun, role & wali kelas • ${teachers.length} guru`} onClick={() => setView('guru')} />
                               <KelolaHubCard emoji="📅" title="Jadwal Piket" subtitle="Atur guru piket harian" onClick={() => setView('jadwal')} />
                               <KelolaHubCard emoji="🗄️" title="Pemeliharaan Data" subtitle="Kelola & hapus data lama" onClick={() => setView('surat')} />
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
                                                           <button onClick={() => removeJadwalEntry(j.hari, j.guruId)} className="text-crimson font-bold">×</button>
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
                                           <button key={t.id} type="button" onClick={() => addJadwalEntry(t.id)} className="w-full text-left px-3 min-h-[48px] flex items-center text-xs font-semibold text-slate-700 active:bg-sky-dim/10 transition">
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
                           <Card className="space-y-3">
                               <h3 className="text-xs font-display font-bold text-slate-800">Data Surat</h3>
                               <button onClick={() => setShowDeleteSuratPanel(v => !v)} className="text-[10px] font-semibold text-crimson">Hapus Data per Bulan/Tahun</button>
                               {showDeleteSuratPanel && (
                                   <div className="space-y-2 animate-pop">
                                       <div className="grid grid-cols-2 gap-2">
                                           <select value={delSuratMonth} onChange={(e) => setDelSuratMonth(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900">
                                               {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('id-ID', { month: 'long' })}</option>)}
                                           </select>
                                           <input type="number" value={delSuratYear} onChange={(e) => setDelSuratYear(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900" />
                                       </div>
                                       <Button onClick={requestDeleteSurat} variant="danger" className="w-full">Hapus Data Periode Ini</Button>
                                   </div>
                               )}
                           </Card>
                       </React.Fragment>
                   )}

                   {showAddGuru && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-3 animate-pop my-4">
                               <div className="flex items-center justify-between">
                                   <h3 className="text-sm font-display font-bold text-slate-800">Tambah Guru Baru</h3>
                                   <button onClick={() => setShowAddGuru(false)} className="text-slate-400 text-xl leading-none">×</button>
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

                   {/* Konfirmasi hapus massal — pola sama persis dengan confirmDeleteTarget
                       di Riwayat (beranda-riwayat.js), supaya hapus 1 baris & hapus 1
                       bulan penuh sama-sama tidak bisa langsung tereksekusi dari 1 tap. */}
                   {confirmDeleteSurat && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-crimson uppercase tracking-widest font-bold">Hapus Data Surat?</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{monthLabel(confirmDeleteSurat.month)} {confirmDeleteSurat.year}</div>
                                   <p className="text-[11px] text-slate-500 mt-2">Anda akan menghapus seluruh data surat bulan {monthLabel(confirmDeleteSurat.month)} {confirmDeleteSurat.year}. Tindakan ini tidak bisa dibatalkan.</p>
                               </div>
                               <Button onClick={executeDeleteSurat} disabled={deletingSurat} variant="danger" className="w-full">
                                   {deletingSurat ? 'Menghapus...' : 'Ya, Hapus'}
                               </Button>
                               <Button onClick={() => setConfirmDeleteSurat(null)} variant="secondary" className="w-full" disabled={deletingSurat}>Batal</Button>
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
                       <EmptyState emoji="🔍" text="Belum ada catatan audit." />
                   )}
               </div>
           );
       }

