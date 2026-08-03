// ===== admin.js =====
// Panel Kelola Guru (khusus Admin): tambah guru baru, reset password, ubah
// jabatan tampilan. Juga berisi AuditLogTab (khusus Admin/BK-Kesiswaan).

       function KelolaTab({ teachers, jadwalPiket, onAddTeacher, onUpdatePassword, onUpdateJabatan, onToggleStatus, onUpdateWaliKelas, onSetJadwalPiket, loading }) {
           const [newId, setNewId] = useState('');
           const [newName, setNewName] = useState('');
           const [newPassword, setNewPassword] = useState('');
           const [newRole, setNewRole] = useState('guru');
           const [newJabatan, setNewJabatan] = useState('');
           const [resetTarget, setResetTarget] = useState(null);
           const [resetPassword, setResetPassword] = useState('');
           const [jabatanTarget, setJabatanTarget] = useState(null);
           const [jabatanInput, setJabatanInput] = useState('');
           const [waliKelasTarget, setWaliKelasTarget] = useState(null);
           const [waliKelasInput, setWaliKelasInput] = useState('');
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');

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
                   if (ok) { setNewId(''); setNewName(''); setNewPassword(''); setNewRole('guru'); setNewJabatan(''); }
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

           const submitWaliKelas = () => {
               if (!waliKelasTarget) return;
               onUpdateWaliKelas({ targetId: waliKelasTarget.id, newKelasWali: waliKelasInput.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   setWaliKelasTarget(null); setWaliKelasInput('');
               });
           };

           // ===== Jadwal Piket mingguan (pola tetap, tanpa pengecualian per
           // tanggal — Blueprint SIGAP v2 memilih ini supaya tetap sederhana) =====
           const HARI_LIST = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
           const [jadwalDraft, setJadwalDraft] = useState(() => jadwalPiket.map(j => ({ hari: j.hari, guruId: j.guruId })));
           const [jadwalDirty, setJadwalDirty] = useState(false);
           const [pickHari, setPickHari] = useState('Senin');
           const [pickGuru, setPickGuru] = useState('');

           useEffect(() => {
               if (!jadwalDirty) setJadwalDraft(jadwalPiket.map(j => ({ hari: j.hari, guruId: j.guruId })));
           }, [jadwalPiket]);

           const guruName = (id) => { const t = teachers.find(t => String(t.id) === String(id)); return t ? t.name : id; };

           const addJadwalEntry = () => {
               if (!pickGuru) return;
               if (jadwalDraft.some(j => j.hari === pickHari && String(j.guruId) === String(pickGuru))) return;
               setJadwalDraft(prev => [...prev, { hari: pickHari, guruId: pickGuru }]);
               setJadwalDirty(true);
               setPickGuru('');
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

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Kelola Guru</h2>

                   {msg && (
                       <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>
                           {msg}
                       </div>
                   )}

                   <form onSubmit={submitAdd} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                       <h3 className="text-xs font-display font-bold text-slate-800">Tambah Guru Baru</h3>
                       <input type="text" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="ID Guru (contoh: G21)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                       <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama Lengkap" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                       <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password Awal" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" required />
                       <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky">
                           <option value="guru_piket">Guru</option>
                           <option value="bk_kesiswaan">BK / Kesiswaan</option>
                           <option value="osis">OSIS</option>
                           <option value="admin">Admin</option>
                       </select>
                       <input type="text" value={newJabatan} onChange={(e) => setNewJabatan(e.target.value)} placeholder="Jabatan tampilan (opsional, misal: Kepala Sekolah)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                       <p className="text-[10px] text-slate-400 leading-relaxed">Kosongkan Jabatan kalau mau tampil label peran biasa (misal "BK/Kesiswaan"). Isi kalau mau tampil beda, misal akun BK/Kesiswaan untuk Kepala Sekolah — hak aksesnya tetap sama seperti BK/Kesiswaan, cuma labelnya yang beda.</p>
                       <button type="submit" disabled={loading} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50">
                           {loading ? 'Menyimpan...' : 'Tambah Guru'}
                       </button>
                   </form>

                   <div className="bg-white border border-slate-200 rounded-2xl p-4">
                       <h3 className="text-xs font-display font-bold text-slate-800 mb-3">Daftar Guru ({teachers.length})</h3>
                       {teachers.length === 0 && <div className="text-xs text-slate-400 py-2">Memuat daftar guru...</div>}
                       <div className="space-y-2">
                           {teachers.map(t => (
                               <div key={t.id} className="bg-white/60 rounded-xl px-3 py-2.5 space-y-2">
                                   <div className="flex items-center justify-between gap-2">
                                       <div className="min-w-0">
                                           <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                               {t.name}
                                               {t.status === 'nonaktif' && <span className="text-[9px] bg-crimson/10 text-crimson px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">NONAKTIF</span>}
                                           </div>
                                           <div className="text-[10px] text-slate-400">{t.id} • {t.jabatan || (ROLES[String(t.role).toLowerCase().trim()] ? ROLES[String(t.role).toLowerCase().trim()].label : 'Guru')}{t.kelasWali && ` • Wali ${t.kelasWali}`}</div>
                                       </div>
                                   </div>
                                   <div className="flex gap-1.5 flex-wrap">
                                       <button onClick={() => { setJabatanTarget(t); setJabatanInput(t.jabatan || ''); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Jabatan</button>
                                       <button onClick={() => { setWaliKelasTarget(t); setWaliKelasInput(t.kelasWali || ''); }} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Kelas Wali</button>
                                       <button onClick={() => setResetTarget(t)} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg">Password</button>
                                       <button onClick={() => onToggleStatus({ targetId: t.id }, (ok, text) => showMsg(ok, text))} className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border ${t.status === 'nonaktif' ? 'bg-sky-dim/10 border-sky-dim/40 text-sky-dim' : 'bg-crimson/10 border-crimson/30 text-crimson'}`}>
                                           {t.status === 'nonaktif' ? 'Aktifkan' : 'Nonaktifkan'}
                                       </button>
                                   </div>
                               </div>
                           ))}
                       </div>
                   </div>

                   <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                       <h3 className="text-xs font-display font-bold text-slate-800">Jadwal Piket Mingguan</h3>
                       <p className="text-[10px] text-slate-400 leading-relaxed">Pola tetap per hari, berulang tiap minggu. Kalau ada tukar piket dadakan, ubah manual di sini.</p>

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
                                       <div className="text-[10px] text-slate-400">Belum ada guru piket.</div>
                                   )}
                               </div>
                           );
                       })}

                       <div className="flex gap-2 pt-1">
                           <select value={pickHari} onChange={(e) => setPickHari(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                               {HARI_LIST.map(h => <option key={h} value={h}>{h}</option>)}
                           </select>
                           <select value={pickGuru} onChange={(e) => setPickGuru(e.target.value)} className="flex-1 bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                               <option value="">Pilih guru...</option>
                               {teachers.filter(t => t.status !== 'nonaktif').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                           </select>
                           <button onClick={addJadwalEntry} disabled={!pickGuru} className="bg-slate-100 border border-slate-300 text-slate-600 px-3 rounded-xl text-xs font-bold disabled:opacity-40">Tambah</button>
                       </div>

                       <button onClick={submitJadwal} disabled={!jadwalDirty} className="w-full bg-sky hover:bg-sky-light disabled:opacity-40 text-white py-2.5 rounded-xl text-xs font-bold transition">Simpan Jadwal Piket</button>
                   </div>

                   {resetTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Reset Password</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{resetTarget.name}</div>
                               </div>
                               <input type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="Password baru" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitReset} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold transition">Simpan Password Baru</button>
                               <button onClick={() => { setResetTarget(null); setResetPassword(''); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   {jabatanTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Ubah Jabatan Tampilan</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{jabatanTarget.name}</div>
                                   <div className="text-[10px] text-slate-400 mt-1">Hak akses tetap sesuai role: {ROLES[String(jabatanTarget.role).toLowerCase().trim()] ? ROLES[String(jabatanTarget.role).toLowerCase().trim()].label : 'Guru'}</div>
                               </div>
                               <input type="text" value={jabatanInput} onChange={(e) => setJabatanInput(e.target.value)} placeholder="Kosongkan untuk label default" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitJabatan} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold transition">Simpan Jabatan</button>
                               <button onClick={() => { setJabatanTarget(null); setJabatanInput(''); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   {waliKelasTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Atur Kelas Wali</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{waliKelasTarget.name}</div>
                               </div>
                               <input type="text" value={waliKelasInput} onChange={(e) => setWaliKelasInput(e.target.value)} placeholder="Contoh: XI B — kosongkan untuk lepas status wali kelas" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitWaliKelas} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold transition">Simpan Kelas Wali</button>
                               <button onClick={() => { setWaliKelasTarget(null); setWaliKelasInput(''); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
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
                   <p className="text-[11px] text-slate-400">Jejak keamanan permanen — siapa melakukan apa. Hanya Admin dan BK/Kesiswaan yang bisa lihat ini. Menampilkan 300 aktivitas terakhir.</p>

                   <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama atau jenis aksi..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{filtered.length} catatan</h3>

                   {filtered.length > 0 ? (
                       <div className="space-y-2">
                           {filtered.map((a, idx) => {
                               const dt = parseTimestamp(a.timestamp);
                               return (
                                   <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl space-y-1">
                                       <div className="flex items-center justify-between gap-2">
                                           <span className="text-xs font-bold text-slate-900">{a.name}</span>
                                           <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${actionTone(a.action)}`}>{a.action}</span>
                                       </div>
                                       {a.detail && <div className="text-[11px] text-slate-500">{a.detail}</div>}
                                       <div className="text-[10px] text-slate-400">{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} • {dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                   </div>
                               );
                           })}
                       </div>
                   ) : (
                       <EmptyState emoji="🔍" text="Belum ada catatan audit." />
                   )}
               </div>
           );
       }

