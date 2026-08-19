// ===== gerbang.js =====
// Form catat keterlambatan (RecordModal) dan tab Gerbang gabungan
// (Catat Terlambat / Catat Surat). Surat cuma laporan tertulis (jenis +
// keterangan) — TIDAK ada lampiran foto (dihapus, lihat catatan di Utils.gs).

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
                               <div className="flex items-center gap-1.5 text-[10px] text-crimson font-bold uppercase tracking-wide">
                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-3 w-3 flex-shrink-0" />
                                   <span>Sudah {studentHistory.length}x terlambat — perlu tindak lanjut</span>
                               </div>
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

       function GerbangTab({ students, allLogs, pelanggaranList, onSelectLate, suratList, onAddSurat, isAdminUser, waliKelasMap }) {
           // "mode" sekarang benar-benar mengunci workflow (bukan cuma saklar
           // tampilan) — begitu dipilih, seluruh alur cari -> pilih -> bottom
           // sheet -> simpan ikut mode itu, tidak ditanya lagi di bottom sheet.
           // Daftar riwayat per-kategori yang dulu ada di sini (dengan filter
           // kelas & sort) dihapus karena mengulang menu Riwayat — kalau perlu
           // cek "siapa di kelas X izin/sakit hari ini", arahnya ke Riwayat.
           const [mode, setMode] = useState('terlambat');
           const [searchQuery, setSearchQuery] = useState('');
           const [pickerStudent, setPickerStudent] = useState(null);
           const [suratStudent, setSuratStudent] = useState(null);
           const [jenis, setJenis] = useState('Sakit');
           const [keterangan, setKeterangan] = useState('');
           const [msg, setMsg] = useState('');
           const [savingSurat, setSavingSurat] = useState(false);

           // Jam berjalan (tanpa detik) supaya guru piket lihat waktu saat ini
           // tanpa perlu refresh halaman. Dicek tiap 15 detik tapi state cuma
           // di-update begitu menitnya benar-benar berganti (bukan tiap tick).
           const [now, setNow] = useState(new Date());
           useEffect(() => {
               const id = setInterval(() => {
                   setNow(prev => {
                       const fresh = new Date();
                       return fresh.getMinutes() === prev.getMinutes() && fresh.getHours() === prev.getHours() ? prev : fresh;
                   });
               }, 15000);
               return () => clearInterval(id);
           }, []);
           const todayLabel = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
           const timeLabel = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

           // Nama wali kelas wajib tampil di hasil pencarian — guru piket di
           // gerbang sering perlu tahu ini juga (mis. untuk menghubungi wali
           // kelas terkait), bukan cuma di Rekap Kelas.
           const waliByClass = {};
           waliKelasMap.forEach(w => { waliByClass[normalizeClass(w.class)] = w.waliKelasName; });

           // filterStudents (helpers.js) mengurutkan berdasarkan relevansi (posisi
           // kecocokan paling awal menang) -- bukan cuma .filter() tanpa urutan.
           const filtered = filterStudents(students, searchQuery);

           // Live Activity Log — gabungan Terlambat + Surat hari ini, terbaru dulu,
           // supaya guru piket lain langsung tahu siapa yang sudah dicatat (hindari input ganda).
           const todayActivity = [
               ...allLogs.filter(l => isSameDay(parseTimestamp(l.timestamp), new Date())).map(l => ({ ...l, _kind: 'terlambat', _time: parseTimestamp(l.timestamp) })),
               ...suratList.filter(s => isSameDay(parseTimestamp(s.timestamp), new Date())).map(s => ({ ...s, _kind: 'surat', _time: parseTimestamp(s.timestamp) })),
           ].sort((a, b) => b._time - a._time).slice(0, 25);

           const [msgTone, setMsgTone] = useState('sky');
           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 6000); };
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

           // Modal HANYA ditutup & form direset setelah server konfirmasi
           // sukses — sebelumnya modal langsung tertutup begitu tombol Simpan
           // ditekan, jadi kalau gagal (mis. siswa itu sudah punya catatan
           // surat hari ini, atau koneksi putus), guru tidak sadar karena
           // pesan errornya cuma toast 3 detik di layar yang sudah tertutup
           // modal. Sekarang kalau gagal, modal tetap terbuka dengan isian
           // (keterangan) masih ada supaya bisa langsung coba lagi.
           const submitSurat = () => {
               setSavingSurat(true);
               onAddSurat({ nisn: suratStudent.nisn, name: suratStudent.name, class_name: suratStudent.class, jenis, keterangan }, (ok, text) => {
                   setSavingSurat(false);
                   showMsg(ok, text);
                   if (ok) {
                       setSuratStudent(null); setJenis('Sakit'); setKeterangan('');
                   }
               });
           };

           return (
               <div className="space-y-5 animate-rise">
                   <div className="text-center text-[11px] text-slate-500 font-medium mt-6">{todayLabel} &middot; {timeLabel}</div>
                   <div className="grid grid-cols-2 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       <button onClick={() => setMode('terlambat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'terlambat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Terlambat</button>
                       <button onClick={() => setMode('surat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'surat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Surat</button>
                   </div>

                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}
                   <div>
                       <label className="text-xs text-slate-500 font-semibold mb-1.5 block">{mode === 'surat' ? 'Cari siswa untuk membuat surat' : 'Cari siswa untuk mencatat keterlambatan'}</label>
                       <div className="relative">
                           <input
                               type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                               placeholder="Ketik nama, kelas, atau NISN..."
                               className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky shadow-sm transition"
                           />
                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />} className="h-5 w-5 absolute right-4 top-3.5 text-slate-500" />
                       </div>
                   </div>

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl animate-rise">
                           <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                               Hasil ({filtered.length})
                           </div>
                           <div className="max-h-60 overflow-y-auto">
                               {/* key gabungan nisn+index (bukan cuma s.nisn) -- Master_Siswa
                                   bisa punya baris tanpa NISN terisi, dan dua siswa yang
                                   sama-sama kosong NISN-nya akan tabrakan key kalau cuma
                                   pakai s.nisn (React salah mengenali baris mana itu mana). */}
                               {filtered.length > 0 ? filtered.map((s, i) => (
                                   <div key={`${s.nisn}-${i}`} onClick={() => handleSelect(s)} className="px-4 py-3.5 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 active:bg-slate-200 cursor-pointer transition">
                                       <div className="min-w-0">
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim font-medium mt-0.5">{s.class} <span className="text-slate-500 font-normal">| NISN: {s.nisn || '(belum diisi)'}</span></div>
                                           <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5">
                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} className="h-2.5 w-2.5 flex-shrink-0" />
                                               <span className="truncate">{waliByClass[normalizeClass(s.class)] || 'Belum ada wali kelas'}</span>
                                           </div>
                                       </div>
                                       <span className="text-xs bg-sky text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm flex-shrink-0 ml-2">Pilih</span>
                                   </div>
                               )) : <div className="p-6 text-center text-xs text-slate-500 font-medium">Siswa tidak ditemukan</div>}
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
                                           <div className="text-[11px] font-bold text-slate-500 w-11 text-center flex-shrink-0">{item._time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</div>
                                           <div className="w-px h-8 bg-slate-200 flex-shrink-0"></div>
                                           <div className="flex-1 min-w-0">
                                               <div className="text-xs font-bold text-slate-900 truncate">{item.name} <span className="text-slate-500 font-normal">({item.class})</span></div>
                                               <div className="flex items-center gap-1 text-[9px] text-slate-500">
                                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} className="h-2 w-2 flex-shrink-0" />
                                                   <span className="truncate">{waliByClass[normalizeClass(item.class)] || 'Belum ada wali kelas'}</span>
                                               </div>
                                               <div className="text-[10px] mt-0.5 flex items-center justify-between gap-2">
                                                   <span className={`flex items-center gap-1 min-w-0 ${item._kind === 'terlambat' ? 'text-crimson font-semibold' : 'text-sky-dim font-semibold'}`}>
                                                       <Icon path={item._kind === 'terlambat' ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />} className="h-2.5 w-2.5 flex-shrink-0" />
                                                       <span className="truncate">{item._kind === 'terlambat' ? 'Terlambat' : 'Surat'} — {item._kind === 'terlambat' ? item.type : item.jenis}</span>
                                                   </span>
                                                   <span className="text-slate-500 truncate flex-shrink-0">oleh {item.logged_by}</span>
                                               </div>
                                           </div>
                                       </div>
                                   ))}
                               </div>
                           ) : (
                               <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />} text="Belum ada aktivitas tercatat hari ini." />
                           )}
                       </div>
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
                                       <div className="text-xs text-slate-500 font-medium mt-1">{pickerStudent.class} <span className="text-slate-500 font-normal">| NISN: {pickerStudent.nisn || '(belum diisi)'}</span></div>
                                       <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mt-1">
                                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} className="h-3 w-3 flex-shrink-0" />
                                           <span>{waliByClass[normalizeClass(pickerStudent.class)] || 'Belum ada wali kelas'}</span>
                                       </div>
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

                                   {/* Cuma 1 aksi yang ditampilkan, sesuai "mode" yang sudah
                                       dipilih di atas sebelum mencari — bukan lagi menawarkan
                                       2 pilihan di sini seperti sebelumnya. */}
                                   <div className="pt-1 border-t border-slate-100">
                                       {mode === 'terlambat' ? (
                                           lateToday ? (
                                               <div className="bg-slate-100 rounded-xl px-4 py-3">
                                                   <div className="text-xs font-bold text-slate-600">✓ Sudah dicatat terlambat</div>
                                                   <div className="text-[10px] text-slate-500 mt-0.5">{parseTimestamp(lateToday.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} oleh {lateToday.logged_by}</div>
                                               </div>
                                           ) : (
                                               <button onClick={() => { setPickerStudent(null); onSelectLate(pickerStudent); }} className="w-full bg-crimson/10 hover:bg-crimson/20 border border-crimson/30 text-crimson py-3.5 rounded-2xl font-bold text-sm transition inline-flex items-center justify-center gap-2">
                                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />} className="h-4 w-4" />
                                                   Catat Terlambat
                                               </button>
                                           )
                                       ) : (
                                           suratToday ? (
                                               <div className="bg-slate-100 rounded-xl px-4 py-3">
                                                   <div className="text-xs font-bold text-slate-600">✓ Sudah ada catatan surat</div>
                                                   <div className="text-[10px] text-slate-500 mt-0.5 truncate">{parseTimestamp(suratToday.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} oleh {suratToday.logged_by}</div>
                                               </div>
                                           ) : (
                                               <button onClick={() => { setPickerStudent(null); setSuratStudent(pickerStudent); }} className="w-full bg-sky-dim/10 hover:bg-sky-dim/20 border border-sky-dim/30 text-sky-dim py-3.5 rounded-2xl font-bold text-sm transition inline-flex items-center justify-center gap-2">
                                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />} className="h-4 w-4" />
                                                   Catat Surat
                                               </button>
                                           )
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

                               {/* Toast `msg` di layar belakang tertutup modal ini (z-50,
                                   full-screen) — pesan gagal DIULANG di sini supaya kelihatan
                                   selama modal masih terbuka (lihat catatan di submitSurat). */}
                               {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                               <input type="text" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Keterangan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />

                               <Button onClick={submitSurat} disabled={savingSurat} className="w-full">
                                   {savingSurat ? 'Menyimpan...' : 'Simpan'}
                               </Button>
                               <Button onClick={() => setSuratStudent(null)} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }


