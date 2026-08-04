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
                       <Button onClick={onClose} variant="secondary" className="w-full">Batal</Button>
                   </div>
               </div>
           );
       }

       function GerbangTab({ students, allLogs, pelanggaranList, onSelectLate, suratList, onAddSurat, onDeleteSurat, isAdminUser, waliKelasMap }) {
           const [mode, setMode] = useState('terlambat');
           const [searchQuery, setSearchQuery] = useState('');
           const [pickerStudent, setPickerStudent] = useState(null);
           const [suratStudent, setSuratStudent] = useState(null);
           const [jenis, setJenis] = useState('Sakit');
           const [keterangan, setKeterangan] = useState('');
           const [fotoPreview, setFotoPreview] = useState(null);
           const [fotoBase64, setFotoBase64] = useState(null);
           const [showDeletePanel, setShowDeletePanel] = useState(false);
           const [delMonth, setDelMonth] = useState(String(new Date().getMonth() + 1));
           const [delYear, setDelYear] = useState(String(new Date().getFullYear()));
           const [msg, setMsg] = useState('');
           const [savingSurat, setSavingSurat] = useState(false);
           const fileInputRef = useRef(null);
           // Default tetap kronologis — Nama A-Z cuma opsi tambahan (Blueprint SIGAP v2, section VIII)
           const [suratSortMode, setSuratSortMode] = useState('waktu');
           // Filter kelas + "Hari Ini saja" (default aktif) — supaya guru yang mau
           // masuk kelas tertentu bisa cepat cek siapa yang izin/sakit hari itu.
           // Akses tetap semua guru, lintas kelas (bukan cuma wali kelas) — beda
           // dengan Pelanggaran, karena guru mata pelajaran bisa masuk kelas mana saja.
           const [filterKelasSurat, setFilterKelasSurat] = useState('');
           const [onlyTodaySurat, setOnlyTodaySurat] = useState(true);
           const kelasOptions = [...new Set(students.map(s => s.class))].sort((a, b) => String(a).localeCompare(String(b)));

           // Nama wali kelas wajib tampil di hasil pencarian — guru piket di
           // gerbang sering perlu tahu ini juga (mis. untuk menghubungi wali
           // kelas terkait), bukan cuma di Rekap Kelas.
           const waliByClass = {};
           waliKelasMap.forEach(w => { waliByClass[normalizeClass(w.class)] = w.waliKelasName; });

           const filtered = searchQuery.trim() === '' ? [] : students.filter(s =>
               s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               s.class.toLowerCase().includes(searchQuery.toLowerCase()) ||
               (s.nisn && s.nisn.toString().includes(searchQuery.trim()))
           );

           const filteredSurat = [...suratList]
               .filter(s => !filterKelasSurat || s.class === filterKelasSurat)
               .filter(s => !onlyTodaySurat || isSameDay(parseTimestamp(s.timestamp), new Date()))
               .sort((a, b) => suratSortMode === 'nama' ? String(a.name).localeCompare(String(b.name)) : parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

           // Live Activity Log — gabungan Terlambat + Surat hari ini, terbaru dulu,
           // supaya guru piket lain langsung tahu siapa yang sudah dicatat (hindari input ganda).
           const todayActivity = [
               ...allLogs.filter(l => isSameDay(parseTimestamp(l.timestamp), new Date())).map(l => ({ ...l, _kind: 'terlambat', _time: parseTimestamp(l.timestamp) })),
               ...suratList.filter(s => isSameDay(parseTimestamp(s.timestamp), new Date())).map(s => ({ ...s, _kind: 'surat', _time: parseTimestamp(s.timestamp) })),
           ].sort((a, b) => b._time - a._time).slice(0, 25);

           const [msgTone, setMsgTone] = useState('sky');
           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 3000); };
           const alreadyToday = (list, nisn) => list.find(item => item.nisn === nisn && isSameDay(parseTimestamp(item.timestamp), new Date()));
           const monthCount = (list, nisn) => {
               const now = new Date();
               return list.filter(item => item.nisn === nisn && parseTimestamp(item.timestamp).getMonth() === now.getMonth() && parseTimestamp(item.timestamp).getFullYear() === now.getFullYear()).length;
           };

           // Pilih siswa -> buka satu bottom sheet ringkasan (bukan langsung
           // masuk mode tertentu) — di situ guru baru memilih mau "Catat
           // Terlambat" atau "Catat Surat", dan kalau salah satunya sudah
           // tercatat hari ini, langsung kelihatan di situ (bukan pesan blok
           // terpisah). Prinsip "satu tangan, satu pandangan, satu keputusan".
           const handleSelect = (s) => {
               setSearchQuery('');
               setPickerStudent(s);
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
                   <div className="grid grid-cols-2 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5 mt-6">
                       <button onClick={() => setMode('terlambat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'terlambat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Terlambat</button>
                       <button onClick={() => setMode('surat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'surat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Surat</button>
                   </div>

                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}
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
                               Hasil ({filtered.length})
                           </div>
                           <div className="max-h-60 overflow-y-auto">
                               {filtered.length > 0 ? filtered.map(s => (
                                   <div key={s.nisn} onClick={() => handleSelect(s)} className="px-4 py-3.5 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 active:bg-slate-200 cursor-pointer transition">
                                       <div className="min-w-0">
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim font-medium mt-0.5">{s.class} <span className="text-slate-400 font-normal">| NISN: {s.nisn}</span></div>
                                           <div className="text-[10px] text-slate-400 mt-0.5 truncate">👩‍🏫 {waliByClass[normalizeClass(s.class)] || 'Belum ada wali kelas'}</div>
                                       </div>
                                       <span className="text-xs bg-sky text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm flex-shrink-0 ml-2">Pilih</span>
                                   </div>
                               )) : <div className="p-6 text-center text-xs text-slate-400 font-medium">Siswa tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {searchQuery.trim() === '' && (
                       <div className="space-y-2.5">
                           <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                               Aktivitas Hari Ini
                               <span className="flex h-2 w-2 relative">
                                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky opacity-60"></span>
                                   <span className="relative inline-flex rounded-full h-2 w-2 bg-sky"></span>
                               </span>
                           </h3>
                           {todayActivity.length > 0 ? (
                               <div className="space-y-2">
                                   {todayActivity.map((item, idx) => (
                                       <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl flex items-center gap-3">
                                           <div className="text-[11px] font-bold text-slate-400 w-11 text-center flex-shrink-0">{item._time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                           <div className="w-px h-8 bg-slate-200 flex-shrink-0"></div>
                                           <div className="flex-1 min-w-0">
                                               <div className="text-xs font-bold text-slate-900 truncate">{item.name} <span className="text-slate-400 font-normal">({item.class})</span></div>
                                               <div className="text-[9px] text-slate-400 truncate">👩‍🏫 {waliByClass[normalizeClass(item.class)] || 'Belum ada wali kelas'}</div>
                                               <div className="text-[10px] mt-0.5 flex items-center justify-between gap-2">
                                                   <span className={item._kind === 'terlambat' ? 'text-crimson font-semibold' : 'text-sky-dim font-semibold'}>
                                                       {item._kind === 'terlambat' ? '⏰ Terlambat' : '📄 Surat'} — {item._kind === 'terlambat' ? item.type : item.jenis}
                                                   </span>
                                                   <span className="text-slate-400 truncate flex-shrink-0">oleh {item.logged_by}</span>
                                               </div>
                                           </div>
                                       </div>
                                   ))}
                               </div>
                           ) : (
                               <EmptyState emoji="🌤️" text="Belum ada aktivitas tercatat hari ini." />
                           )}
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

                           <div className="flex items-center justify-between">
                               <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{suratList.length} catatan surat</h3>
                               <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
                                   <button onClick={() => setSuratSortMode('waktu')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${suratSortMode === 'waktu' ? 'bg-sky text-white' : 'text-slate-500'}`}>Terbaru</button>
                                   <button onClick={() => setSuratSortMode('nama')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${suratSortMode === 'nama' ? 'bg-sky text-white' : 'text-slate-500'}`}>A-Z</button>
                               </div>
                           </div>

                           {/* Cek cepat: "siapa di kelas X izin/sakit hari ini" — dipakai guru
                               yang mau masuk kelas tertentu, bukan cuma wali kelas. */}
                           <div className="flex gap-2">
                               <select value={filterKelasSurat} onChange={(e) => setFilterKelasSurat(e.target.value)} className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                   <option value="">Semua Kelas</option>
                                   {kelasOptions.map(k => <option key={k} value={k}>{k}</option>)}
                               </select>
                               <button onClick={() => setOnlyTodaySurat(v => !v)} className={`px-3.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${onlyTodaySurat ? 'bg-sky text-white' : 'bg-white border border-slate-300 text-slate-500'}`}>Hari Ini</button>
                           </div>

                           <div className="space-y-2.5">
                               {filteredSurat.slice(0, 30).map((s, idx) => {
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
                                           {s.foto_url ? (
                                               <a href={s.foto_url} target="_blank" rel="noreferrer" className="text-[10px] text-sky-dim underline">Lihat foto surat</a>
                                           ) : (
                                               <span className="text-[10px] text-amber-600 font-semibold">⚠ Belum ada bukti foto</span>
                                           )}
                                       </div>
                                   );
                               })}
                               {filteredSurat.length === 0 && (
                                   <EmptyState emoji="✉️" text={suratList.length === 0 ? 'Belum ada catatan surat masuk.' : 'Tidak ada catatan surat yang cocok dengan filter.'} />
                               )}
                           </div>
                       </React.Fragment>
                   )}

                   {/* Bottom sheet setelah pilih siswa — satu tempat, tanpa pindah
                       halaman: ringkasan singkat + pilih mau catat apa. Kalau salah
                       satu kategori sudah tercatat hari ini, langsung kelihatan di
                       sini (bukan pesan blok terpisah sebelum sempat lihat siswanya). */}
                   {pickerStudent && (() => {
                       const lateToday = alreadyToday(allLogs, pickerStudent.nisn);
                       const suratToday = alreadyToday(suratList, pickerStudent.nisn);
                       return (
                           <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                               <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                                   <div className="text-center">
                                       <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-2 sm:hidden"></div>
                                       <div className="font-display text-xl font-extrabold text-slate-900">{pickerStudent.name}</div>
                                       <div className="text-xs text-slate-500 font-medium mt-1">{pickerStudent.class} <span className="text-slate-400 font-normal">| NISN: {pickerStudent.nisn}</span></div>
                                       <div className="text-[11px] text-slate-400 mt-1">👩‍🏫 {waliByClass[normalizeClass(pickerStudent.class)] || 'Belum ada wali kelas'}</div>
                                   </div>

                                   <div className="grid grid-cols-3 gap-2 text-center">
                                       <div className="bg-crimson/10 rounded-xl py-2">
                                           <div className="text-sm font-extrabold text-crimson">{monthCount(allLogs, pickerStudent.nisn)}</div>
                                           <div className="text-[8px] text-crimson font-bold uppercase">Terlambat/bln</div>
                                       </div>
                                       <div className="bg-amber-50 rounded-xl py-2">
                                           <div className="text-sm font-extrabold text-amber-600">{monthCount(pelanggaranList, pickerStudent.nisn)}</div>
                                           <div className="text-[8px] text-amber-600 font-bold uppercase">Pelanggaran/bln</div>
                                       </div>
                                       <div className="bg-sky-dim/10 rounded-xl py-2">
                                           <div className="text-sm font-extrabold text-sky-dim">{monthCount(suratList, pickerStudent.nisn)}</div>
                                           <div className="text-[8px] text-sky-dim font-bold uppercase">Surat/bln</div>
                                       </div>
                                   </div>

                                   <div className="space-y-2 pt-1 border-t border-slate-100">
                                       {lateToday ? (
                                           <div className="bg-slate-100 rounded-xl px-4 py-3">
                                               <div className="text-xs font-bold text-slate-600">✓ Sudah dicatat terlambat</div>
                                               <div className="text-[10px] text-slate-400 mt-0.5">{parseTimestamp(lateToday.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} oleh {lateToday.logged_by}</div>
                                           </div>
                                       ) : (
                                           <button onClick={() => { setPickerStudent(null); onSelectLate(pickerStudent); }} className="w-full bg-crimson/10 hover:bg-crimson/20 border border-crimson/30 text-crimson py-3.5 rounded-2xl font-bold text-sm transition">
                                               ⏰ Catat Terlambat
                                           </button>
                                       )}
                                       {suratToday ? (
                                           <div className="bg-slate-100 rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                                               <div className="min-w-0">
                                                   <div className="text-xs font-bold text-slate-600">✓ Sudah ada catatan surat</div>
                                                   <div className="text-[10px] text-slate-400 mt-0.5 truncate">{parseTimestamp(suratToday.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} oleh {suratToday.logged_by}</div>
                                               </div>
                                               {suratToday.foto_url && <a href={suratToday.foto_url} target="_blank" rel="noreferrer" className="text-[10px] text-sky-dim underline flex-shrink-0">Lihat</a>}
                                           </div>
                                       ) : (
                                           <button onClick={() => { setPickerStudent(null); setSuratStudent(pickerStudent); }} className="w-full bg-sky-dim/10 hover:bg-sky-dim/20 border border-sky-dim/30 text-sky-dim py-3.5 rounded-2xl font-bold text-sm transition">
                                               📄 Catat Surat
                                           </button>
                                       )}
                                   </div>

                                   <Button onClick={() => setPickerStudent(null)} variant="secondary" className="w-full">Tutup</Button>
                               </div>
                           </div>
                       );
                   })()}

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

                               <Button onClick={submitSurat} disabled={savingSurat} className="w-full">
                                   {savingSurat ? 'Menyimpan...' : 'Simpan'}
                               </Button>
                               <Button onClick={() => { setSuratStudent(null); setFotoPreview(null); setFotoBase64(null); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }


