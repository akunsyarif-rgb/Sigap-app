// ===== gerbang.js =====
// Form catat keterlambatan (RecordModal) dan tab Gerbang gabungan
// (Catat Terlambat / Catat Surat, termasuk foto surat).

       function RecordModal({ student, customReason, setCustomReason, onRecord, onClose, allLogs }) {
           const presets = [
               { type: 'Terlambat bangun', emoji: '⏰', label: 'Telat Bangun' },
               { type: 'Hujan', emoji: '🌧️', label: 'Hujan' },
               { type: 'Kendaraan bermasalah', emoji: '🏍️', label: 'Kendaraan' },
               { type: 'Keperluan keluarga', emoji: '👥', label: 'Urusan Keluarga' },
           ];
           const studentHistory = allLogs.filter(l => l.nisn === student.nisn);
           return (
               <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                   <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-5 animate-pop">
                       <div className="text-center">
                           <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-4 sm:hidden"></div>
                           <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Catat Keterlambatan</h3>
                           <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{student.name}</div>
                           <div className="text-xs text-slate-500 font-medium bg-white inline-block px-3 py-1 rounded-full mt-2 border border-slate-200">{student.class}</div>
                       </div>

                       {studentHistory.length >= 3 && (
                           <div className="bg-crimson/10 border border-crimson/40 rounded-2xl p-3 space-y-1.5">
                               <div className="text-[10px] text-crimson font-bold uppercase tracking-wide">⚠ Sudah {studentHistory.length}x terlambat — perlu tindak lanjut</div>
                               {studentHistory.slice(0, 3).map((h, i) => {
                                   const hDt = parseTimestamp(h.timestamp);
                                   return <div key={i} className="text-[11px] text-slate-600">{h.type} — {hDt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</div>;
                               })}
                           </div>
                       )}

                       <div className="grid grid-cols-2 gap-2.5">
                           {presets.map(p => (
                               <button key={p.type} onClick={() => onRecord(p.type)} className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 py-3 px-2 rounded-2xl font-medium text-xs transition active:scale-95 flex flex-col items-center justify-center gap-1">
                                   <span className="text-lg">{p.emoji}</span><span>{p.label}</span>
                               </button>
                           ))}
                       </div>
                       <div className="pt-2">
                           <label className="text-[10px] text-slate-500 font-bold mb-1.5 block uppercase tracking-wider">Atau Alasan Lainnya</label>
                           <div className="flex gap-2">
                               <input type="text" value={customReason} onChange={(e) => setCustomReason(e.target.value)} placeholder="Ketik spesifik..." className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={() => onRecord('Custom')} disabled={!customReason.trim()} className="bg-sky hover:bg-sky-light disabled:opacity-30 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition">Simpan</button>
                           </div>
                       </div>
                       <button onClick={onClose} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 hover:text-slate-900 hover:border-slate-400 py-3 rounded-2xl font-bold text-xs transition">Batal</button>
                   </div>
               </div>
           );
       }

       function GerbangTab({ students, allLogs, onSelectLate, suratList, onAddSurat, onDeleteSurat, isAdminUser }) {
           const [mode, setMode] = useState('terlambat');
           const [searchQuery, setSearchQuery] = useState('');
           const [suratStudent, setSuratStudent] = useState(null);
           const [jenis, setJenis] = useState('Sakit');
           const [keterangan, setKeterangan] = useState('');
           const [fotoPreview, setFotoPreview] = useState(null);
           const [fotoBase64, setFotoBase64] = useState(null);
           const [showDeletePanel, setShowDeletePanel] = useState(false);
           const [delMonth, setDelMonth] = useState(String(new Date().getMonth() + 1));
           const [delYear, setDelYear] = useState(String(new Date().getFullYear()));
           const [msg, setMsg] = useState('');
           const [blockMsg, setBlockMsg] = useState('');
           const [savingSurat, setSavingSurat] = useState(false);
           const fileInputRef = useRef(null);

           const filtered = searchQuery.trim() === '' ? [] : students.filter(s =>
               s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               s.class.toLowerCase().includes(searchQuery.toLowerCase()) ||
               (s.nisn && s.nisn.toString().includes(searchQuery.trim()))
           );

           const [msgTone, setMsgTone] = useState('sky');
           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 3000); };
           const alreadyToday = (list, nisn) => list.some(item => item.nisn === nisn && isSameDay(parseTimestamp(item.timestamp), new Date()));

           const handleSelect = (s) => {
               setSearchQuery('');
               if (mode === 'terlambat') {
                   if (alreadyToday(allLogs, s.nisn)) {
                       setBlockMsg(`${s.name} sudah tercatat terlambat hari ini — tidak bisa dicatat dua kali. Kalau ini keterlambatan setelah kegiatan di luar, catat lewat menu Pelanggaran.`);
                       setTimeout(() => setBlockMsg(''), 6000);
                       return;
                   }
                   onSelectLate(s);
               } else {
                   if (alreadyToday(suratList, s.nisn)) {
                       setBlockMsg(`${s.name} sudah punya catatan surat hari ini — tidak bisa dicatat dua kali.`);
                       setTimeout(() => setBlockMsg(''), 6000);
                       return;
                   }
                   setSuratStudent(s);
               }
           };

           // Kompres foto di sisi browser (maks lebar 800px, kualitas 60%) sebelum
           // dikirim, supaya ukuran data tetap kecil dan tidak membebani penyimpanan.
           const handleFotoChange = (e) => {
               const file = e.target.files[0];
               if (!file) return;
               const reader = new FileReader();
               reader.onload = (ev) => {
                   const img = new Image();
                   img.onload = () => {
                       const maxWidth = 800;
                       const scale = Math.min(1, maxWidth / img.width);
                       const canvas = document.createElement('canvas');
                       canvas.width = img.width * scale;
                       canvas.height = img.height * scale;
                       const ctx = canvas.getContext('2d');
                       ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                       const compressed = canvas.toDataURL('image/jpeg', 0.6);
                       setFotoPreview(compressed);
                       setFotoBase64(compressed.split(',')[1]);
                   };
                   img.src = ev.target.result;
               };
               reader.readAsDataURL(file);
           };

           const submitSurat = () => {
               setSavingSurat(true);
               onAddSurat({ nisn: suratStudent.nisn, name: suratStudent.name, class_name: suratStudent.class, jenis, keterangan, fotoBase64 }, (ok, text) => {
                   setSavingSurat(false);
                   showMsg(ok, text);
               });
               setSuratStudent(null); setJenis('Sakit'); setKeterangan(''); setFotoPreview(null); setFotoBase64(null);
           };

           const submitDelete = () => {
               onDeleteSurat({ month: delMonth, year: delYear }, (ok, text) => showMsg(ok, text));
               setShowDeletePanel(false);
           };

           return (
               <div className="space-y-5 animate-rise">
                   <div className="grid grid-cols-2 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       <button onClick={() => setMode('terlambat')} className={`py-2.5 rounded-xl text-xs font-bold transition ${mode === 'terlambat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Terlambat</button>
                       <button onClick={() => setMode('surat')} className={`py-2.5 rounded-xl text-xs font-bold transition ${mode === 'surat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Surat</button>
                   </div>

                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}
                   {blockMsg && <div className="text-xs text-crimson font-medium text-center bg-crimson/10 border border-crimson/30 py-2.5 px-3 rounded-lg leading-relaxed">{blockMsg}</div>}
                   <div>
                       <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Cari Manual (Nama, Kelas, atau NISN)</label>
                       <div className="relative">
                           <input
                               type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                               placeholder="Ketik nama, kelas, atau NISN..."
                               className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky shadow-sm transition"
                           />
                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />} className="h-5 w-5 absolute right-4 top-3.5 text-slate-400" />
                       </div>
                   </div>

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl animate-rise">
                           <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                               Hasil ({filtered.length}) — mode: {mode === 'terlambat' ? 'Catat Terlambat' : 'Catat Surat'}
                           </div>
                           <div className="max-h-60 overflow-y-auto">
                               {filtered.length > 0 ? filtered.map(s => (
                                   <div key={s.nisn} onClick={() => handleSelect(s)} className="px-4 py-3.5 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 active:bg-slate-200 cursor-pointer transition">
                                       <div>
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim font-medium mt-0.5">{s.class} <span className="text-slate-400 font-normal">| NISN: {s.nisn}</span></div>
                                       </div>
                                       <span className="text-xs bg-sky text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm">Pilih</span>
                                   </div>
                               )) : <div className="p-6 text-center text-xs text-slate-400 font-medium">Siswa tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {mode === 'surat' && (
                       <React.Fragment>
                           {isAdminUser && (
                               <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                                   <button onClick={() => setShowDeletePanel(v => !v)} className="text-[10px] font-semibold text-crimson">Hapus Data per Bulan/Tahun</button>
                                   {showDeletePanel && (
                                       <div className="space-y-2 animate-pop">
                                           <div className="grid grid-cols-2 gap-2">
                                               <select value={delMonth} onChange={(e) => setDelMonth(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900">
                                                   {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleDateString('id-ID', { month: 'long' })}</option>)}
                                               </select>
                                               <input type="number" value={delYear} onChange={(e) => setDelYear(e.target.value)} className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900" />
                                           </div>
                                           <button onClick={submitDelete} className="w-full bg-crimson hover:bg-crimson-dim text-white py-2.5 rounded-xl text-xs font-bold">Hapus Data Periode Ini</button>
                                       </div>
                                   )}
                               </div>
                           )}

                           <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{suratList.length} catatan surat</h3>
                           <div className="space-y-2.5">
                               {suratList.slice(0, 30).map((s, idx) => {
                                   const dt = parseTimestamp(s.timestamp);
                                   return (
                                       <div key={idx} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1.5">
                                           <div className="flex items-center justify-between">
                                               <div className="font-semibold text-sm text-slate-900">{s.name}</div>
                                               <span className="text-[9px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-semibold">{s.jenis}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-400 flex justify-between gap-2">
                                               <span>{s.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                               <span className="truncate">{s.keterangan}</span>
                                           </div>
                                           {s.foto_url && <a href={s.foto_url} target="_blank" rel="noreferrer" className="text-[10px] text-sky-dim underline">Lihat foto surat</a>}
                                       </div>
                                   );
                               })}
                               {suratList.length === 0 && <EmptyState emoji="✉️" text="Belum ada catatan surat masuk." />}
                           </div>
                       </React.Fragment>
                   )}

                   {suratStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Catat Surat Masuk</h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{suratStudent.name}</div>
                                   <div className="text-xs text-slate-500">{suratStudent.class}</div>
                               </div>

                               <div className="grid grid-cols-3 gap-2">
                                   {['Sakit', 'Izin', 'Lainnya'].map(j => (
                                       <button key={j} onClick={() => setJenis(j)} className={`py-2.5 rounded-xl text-xs font-bold ${jenis === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                   ))}
                               </div>

                               <input type="text" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Keterangan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />

                               <div>
                                   <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFotoChange} className="hidden" />
                                   {fotoPreview ? (
                                       <div className="relative">
                                           <img src={fotoPreview} alt="Preview surat" className="w-full h-32 object-cover rounded-xl border border-slate-300" />
                                           <button onClick={() => { setFotoPreview(null); setFotoBase64(null); }} className="absolute top-2 right-2 bg-crimson text-white text-[10px] font-bold px-2 py-1 rounded-lg">Hapus Foto</button>
                                       </div>
                                   ) : (
                                       <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="w-full bg-slate-100 border-2 border-dashed border-slate-300 text-slate-500 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />} className="h-4 w-4" />
                                           Foto Surat (Opsional)
                                       </button>
                                   )}
                               </div>

                               <button onClick={submitSurat} disabled={savingSurat} className="w-full bg-sky hover:bg-sky-light disabled:opacity-50 text-white py-3 rounded-2xl font-bold text-sm">
                                   {savingSurat ? 'Menyimpan...' : 'Simpan'}
                               </button>
                               <button onClick={() => { setSuratStudent(null); setFotoPreview(null); setFotoBase64(null); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }


