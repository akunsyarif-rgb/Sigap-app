// ===== pelanggaran-bimbingan-upacara.js =====
// Tab Pelanggaran (catat + tandai Bimbingan Khusus), tab Bimbingan
// Khusus (khusus Admin/BK), dan tab Upacara (OSIS + BK/Admin).

       function PelanggaranTab({ students, pelanggaranList, onAddPelanggaran, onAddBimbingan }) {
           const [searchQuery, setSearchQuery] = useState('');
           const [selectedStudent, setSelectedStudent] = useState(null);
           const [jenis, setJenis] = useState('');
           const [jenisCustom, setJenisCustom] = useState('');
           const [sanksi, setSanksi] = useState('');
           const [sanksiCustom, setSanksiCustom] = useState('');
           const [catatan, setCatatan] = useState('');
           const [msg, setMsg] = useState('');
           const [bimbinganTarget, setBimbinganTarget] = useState(null);
           const [bimbinganCatatan, setBimbinganCatatan] = useState('');

           const jenisPresets = ['Bolos', 'Rambut/Seragam', 'Merokok'];
           const sanksiPresets = ['Teguran Lisan', 'Surat Peringatan', 'Panggil Orang Tua'];

           const filtered = searchQuery.trim() === '' ? [] : students.filter(s =>
               s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               s.class.toLowerCase().includes(searchQuery.toLowerCase()) ||
               (s.nisn && s.nisn.toString().includes(searchQuery.trim()))
           );

           const studentHistory = selectedStudent ? pelanggaranList.filter(p => p.nisn === selectedStudent.nisn) : [];
           const todayList = pelanggaranList.filter(p => isSameDay(parseTimestamp(p.timestamp), new Date())).sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
           const todayCount = todayList.length;

           const showMsg = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000); };

           const submitPelanggaran = () => {
               const finalJenis = jenis === 'Custom' ? (jenisCustom.trim() || 'Lainnya') : jenis;
               const finalSanksi = sanksi === 'Custom' ? (sanksiCustom.trim() || 'Lainnya') : sanksi;
               onAddPelanggaran({ nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, jenis_pelanggaran: finalJenis, sanksi: finalSanksi, catatan }, (ok, text) => showMsg(text));
               setSelectedStudent(null); setSearchQuery(''); setJenis(''); setJenisCustom(''); setSanksi(''); setSanksiCustom(''); setCatatan('');
           };

           const submitBimbingan = () => {
               if (!bimbinganCatatan.trim()) return;
               onAddBimbingan({ nisn: bimbinganTarget.nisn, name: bimbinganTarget.name, class_name: bimbinganTarget.class, catatan: bimbinganCatatan.trim() }, (ok, text) => showMsg(text));
               setBimbinganTarget(null); setBimbinganCatatan('');
           };

           return (
               <div className="space-y-5 animate-rise">
                   <div className="flex justify-between items-end">
                       <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Catat Pelanggaran</h2>
                       <span className="text-[10px] text-slate-400 font-semibold">{todayCount} hari ini</span>
                   </div>

                   {msg && <div className="text-xs text-sky-dim font-medium text-center bg-sky-dim/15 border border-sky-dim/40 py-2 rounded-lg">{msg}</div>}

                   <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama, kelas, atau NISN..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
                           <div className="max-h-48 overflow-y-auto">
                               {filtered.length > 0 ? filtered.map(s => (
                                   <div key={s.nisn} onClick={() => { setSelectedStudent(s); setSearchQuery(''); }} className="px-4 py-3 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 cursor-pointer">
                                       <div>
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim">{s.class}</div>
                                       </div>
                                   </div>
                               )) : <div className="p-4 text-center text-xs text-slate-400">Tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   <div className="pt-1">
                       <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Pelanggaran Hari Ini ({todayList.length})</h3>
                       {todayList.length > 0 ? (
                           <div className="space-y-2.5">
                               {todayList.map((p, idx) => {
                                   const dt = parseTimestamp(p.timestamp);
                                   return (
                                       <div key={idx} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1 shadow-sm">
                                           <div className="flex items-center justify-between gap-2">
                                               <div className="font-semibold text-sm text-slate-900 truncate">{p.name}</div>
                                               <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">{p.jenis_pelanggaran}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-400 flex justify-between gap-2">
                                               <span>{p.class} • Sanksi: {p.sanksi}</span>
                                               <span className="flex-shrink-0">{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                           </div>
                                       </div>
                                   );
                               })}
                           </div>
                       ) : (
                           <EmptyState emoji="✅" text="Belum ada pelanggaran tercatat hari ini." />
                       )}
                       <p className="text-[11px] text-slate-400 text-center pt-3">Untuk data kemarin/minggu/bulan lalu, buka menu <span className="font-semibold text-slate-500">Riwayat</span>.</p>
                   </div>

                   {selectedStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Catat Pelanggaran</h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{selectedStudent.name}</div>
                                   <div className="text-xs text-slate-500">{selectedStudent.class}</div>
                               </div>

                               {studentHistory.length > 0 && (
                                   <div className="bg-crimson/10 border border-crimson/40 rounded-2xl p-3 space-y-1.5">
                                       <div className="text-[10px] text-crimson font-bold uppercase tracking-wide">⚠ Sudah {studentHistory.length}x tercatat sebelumnya</div>
                                       {studentHistory.slice(0, 3).map((h, i) => {
                                           const hDt = parseTimestamp(h.timestamp);
                                           return <div key={i} className="text-[11px] text-slate-600">{h.jenis_pelanggaran} — {hDt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ({h.sanksi})</div>;
                                       })}
                                   </div>
                               )}

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Jenis Pelanggaran</label>
                                   <div className="grid grid-cols-3 gap-2">
                                       {jenisPresets.map(j => (
                                           <button key={j} onClick={() => setJenis(j)} className={`py-2 rounded-xl text-[10px] font-bold ${jenis === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={jenisCustom} onChange={(e) => { setJenisCustom(e.target.value); setJenis('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Sanksi</label>
                                   <div className="grid grid-cols-3 gap-2">
                                       {sanksiPresets.map(s => (
                                           <button key={s} onClick={() => setSanksi(s)} className={`py-2 rounded-xl text-[10px] font-bold ${sanksi === s ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{s}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={sanksiCustom} onChange={(e) => { setSanksiCustom(e.target.value); setSanksi('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>

                               <input type="text" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />

                               <button onClick={submitPelanggaran} disabled={!jenis || !sanksi} className="w-full bg-sky hover:bg-sky-light disabled:opacity-40 text-white py-3 rounded-2xl font-bold text-sm">Simpan</button>
                               <button onClick={() => { setBimbinganTarget(selectedStudent); setSelectedStudent(null); }} className="w-full bg-slate-100 border border-slate-300 text-slate-600 py-2.5 rounded-2xl font-bold text-xs">Tandai Perlu Bimbingan Khusus</button>
                               <button onClick={() => setSelectedStudent(null)} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   {bimbinganTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Perlu Bimbingan Khusus</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{bimbinganTarget.name}</div>
                               </div>
                               <textarea value={bimbinganCatatan} onChange={(e) => setBimbinganCatatan(e.target.value)} placeholder="Catatan untuk Admin..." rows={3} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitBimbingan} className="w-full bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-xs font-bold">Simpan (hanya Admin bisa lihat)</button>
                               <button onClick={() => { setBimbinganTarget(null); setBimbinganCatatan(''); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{pelanggaranList.length} catatan pelanggaran</h3>
                   <div className="space-y-2.5">
                       {pelanggaranList.slice(0, 30).map((p, idx) => {
                           const dt = parseTimestamp(p.timestamp);
                           return (
                               <div key={idx} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                                       <span className="text-[9px] bg-crimson/15 text-crimson px-2 py-0.5 rounded-full font-semibold">{p.jenis_pelanggaran}</span>
                                   </div>
                                   <div className="text-[10px] text-slate-400 flex justify-between gap-2">
                                       <span>{p.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                       <span className="truncate">{p.sanksi}</span>
                                   </div>
                               </div>
                           );
                       })}
                       {pelanggaranList.length === 0 && <EmptyState emoji="📋" text="Belum ada catatan pelanggaran." />}
                   </div>
               </div>
           );
       }

       function BimbinganTab({ bimbinganList }) {
           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Perlu Bimbingan Khusus (Admin)</h2>
                   <p className="text-[11px] text-slate-400">Daftar ini hanya terlihat oleh Admin.</p>
                   <div className="space-y-2.5">
                       {bimbinganList.map((b, idx) => {
                           const dt = parseTimestamp(b.timestamp);
                           return (
                               <div key={idx} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1.5">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{b.name}</div>
                                       <span className="text-[10px] text-slate-400">{b.class}</span>
                                   </div>
                                   <div className="text-[11px] text-slate-600">{b.catatan}</div>
                                   <div className="text-[10px] text-slate-400 flex justify-between">
                                       <span>{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                       <span>oleh {b.logged_by}</span>
                                   </div>
                               </div>
                           );
                       })}
                       {bimbinganList.length === 0 && <EmptyState emoji="🤝" text="Belum ada catatan bimbingan khusus." />}
                   </div>
               </div>
           );
       }

       function UpacaraTab({ students, upacaraList, onAddUpacara, isOsis }) {
           const [searchQuery, setSearchQuery] = useState('');
           const [selectedStudent, setSelectedStudent] = useState(null);
           const [jenis, setJenis] = useState('');
           const [jenisCustom, setJenisCustom] = useState('');
           const [catatan, setCatatan] = useState('');
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');

           const jenisPresets = ['Atribut Tidak Lengkap', 'Tidak Tertib', 'Terlambat Baris'];

           const filtered = searchQuery.trim() === '' ? [] : students.filter(s =>
               s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               s.class.toLowerCase().includes(searchQuery.toLowerCase()) ||
               (s.nisn && s.nisn.toString().includes(searchQuery.trim()))
           );

           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 3000); };

           const submitUpacara = () => {
               const finalJenis = jenis === 'Custom' ? (jenisCustom.trim() || 'Lainnya') : jenis;
               onAddUpacara({ nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, jenis_pelanggaran: finalJenis, catatan }, (ok, text) => showMsg(ok, text));
               setSelectedStudent(null); setSearchQuery(''); setJenis(''); setJenisCustom(''); setCatatan('');
           };

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Catat Pelanggaran Upacara</h2>

                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                   <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama, kelas, atau NISN..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
                           <div className="max-h-48 overflow-y-auto">
                               {filtered.length > 0 ? filtered.map(s => (
                                   <div key={s.nisn} onClick={() => { setSelectedStudent(s); setSearchQuery(''); }} className="px-4 py-3 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 cursor-pointer">
                                       <div>
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim">{s.class}</div>
                                       </div>
                                   </div>
                               )) : <div className="p-4 text-center text-xs text-slate-400">Tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {selectedStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Pelanggaran Upacara</h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{selectedStudent.name}</div>
                                   <div className="text-xs text-slate-500">{selectedStudent.class}</div>
                               </div>
                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Jenis Pelanggaran</label>
                                   <div className="grid grid-cols-3 gap-2">
                                       {jenisPresets.map(j => (
                                           <button key={j} onClick={() => setJenis(j)} className={`py-2 rounded-xl text-[10px] font-bold ${jenis === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={jenisCustom} onChange={(e) => { setJenisCustom(e.target.value); setJenis('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>
                               <input type="text" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitUpacara} disabled={!jenis} className="w-full bg-sky hover:bg-sky-light disabled:opacity-40 text-white py-3 rounded-2xl font-bold text-sm">Simpan</button>
                               <button onClick={() => setSelectedStudent(null)} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{isOsis ? 'Riwayat Catatan Saya' : 'Semua Catatan'} ({upacaraList.length})</h3>
                   <div className="space-y-2.5">
                       {upacaraList.slice(0, 50).map((u, idx) => {
                           const dt = parseTimestamp(u.timestamp);
                           return (
                               <div key={idx} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{u.name}</div>
                                       <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">{u.jenis_pelanggaran}</span>
                                   </div>
                                   <div className="text-[10px] text-slate-400 flex justify-between gap-2">
                                       <span>{u.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                       <span>{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                   </div>
                                   {!isOsis && <div className="text-[10px] text-slate-400">Dicatat oleh: {u.logged_by}</div>}
                               </div>
                           );
                       })}
                       {upacaraList.length === 0 && <EmptyState emoji="🚩" text="Belum ada catatan pelanggaran upacara." />}
                   </div>
               </div>
           );
       }

