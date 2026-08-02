// ===== admin.js =====
// Panel Kelola Guru (khusus Admin): tambah guru baru & reset password.

       function KelolaTab({ teachers, onAddTeacher, onUpdatePassword, loading }) {
           const [newId, setNewId] = useState('');
           const [newName, setNewName] = useState('');
           const [newPassword, setNewPassword] = useState('');
           const [newRole, setNewRole] = useState('guru_piket');
           const [resetTarget, setResetTarget] = useState(null);
           const [resetPassword, setResetPassword] = useState('');
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
               onAddTeacher({ newId: newId.trim(), newName: newName.trim(), newPassword: newPassword.trim(), newRole }, (ok, text) => {
                   showMsg(ok, text);
                   if (ok) { setNewId(''); setNewName(''); setNewPassword(''); setNewRole('guru_piket'); }
               });
           };

           const submitReset = () => {
               if (!resetPassword.trim() || !resetTarget) return;
               onUpdatePassword({ targetId: resetTarget.id, newPassword: resetPassword.trim() }, (ok, text) => {
                   showMsg(ok, text);
                   setResetTarget(null); setResetPassword('');
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
                       <button type="submit" disabled={loading} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50">
                           {loading ? 'Menyimpan...' : 'Tambah Guru'}
                       </button>
                   </form>

                   <div className="bg-white border border-slate-200 rounded-2xl p-4">
                       <h3 className="text-xs font-display font-bold text-slate-800 mb-3">Daftar Guru ({teachers.length})</h3>
                       {teachers.length === 0 && <div className="text-xs text-slate-400 py-2">Memuat daftar guru...</div>}
                       <div className="space-y-2">
                           {teachers.map(t => (
                               <div key={t.id} className="flex items-center justify-between bg-white/60 rounded-xl px-3 py-2.5">
                                   <div className="min-w-0">
                                       <div className="text-xs font-semibold text-slate-900 truncate">{t.name}</div>
                                       <div className="text-[10px] text-slate-400">{t.id} • {ROLES[String(t.role).toLowerCase().trim()] ? ROLES[String(t.role).toLowerCase().trim()].label : 'Guru'}</div>
                                   </div>
                                   <button onClick={() => setResetTarget(t)} className="text-[10px] font-semibold bg-slate-100 border border-slate-300 text-slate-600 px-2.5 py-1.5 rounded-lg flex-shrink-0">Reset Password</button>
                               </div>
                           ))}
                       </div>
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
               </div>
           );
       }

