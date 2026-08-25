// ===== gerbang.js =====
// Form catat keterlambatan (RecordModal) dan tab Gerbang gabungan
// (Catat Terlambat / Catat Surat). Surat cuma laporan tertulis (jenis +
// keterangan) — TIDAK ada lampiran foto (dihapus, lihat catatan di Utils.gs).

       function RecordModal({ student, customReason, setCustomReason, onRecord, onClose, allLogs, onGetLateCount }) {
           const presets = [
               { type: 'Terlambat bangun', emoji: '⏰', label: 'Telat Bangun' },
               { type: 'Hujan', emoji: '🌧️', label: 'Hujan' },
               { type: 'Kendaraan bermasalah', emoji: '🏍️', label: 'Kendaraan' },
               { type: 'Keperluan keluarga', emoji: '👥', label: 'Urusan Keluarga' },
           ];
           // Baris detail yang boleh dilihat pemakai ini (server yang membatasi
           // cakupannya — lihat getLogs di Code.gs).
           const studentHistory = allLogs.filter(l => l.nisn === student.nisn);
           // Jumlah SEBENARNYA se-sekolah untuk siswa ini, angka saja, diambil
           // saat modal dibuka. Untuk guru biasa, allLogs sudah tidak memuat
           // catatan guru lain, jadi tanpa ini peringatan "perlu tindak lanjut"
           // bisa tidak muncul padahal siswanya sudah berkali-kali terlambat.
           // Prop opsional: kalau tidak dipasang, perilakunya persis seperti dulu.
           const [serverLateCount, setServerLateCount] = useState(0);
           useEffect(() => {
               if (!onGetLateCount) return;
               let batal = false;
               onGetLateCount(student.nisn).then(n => { if (!batal) setServerLateCount(n || 0); });
               return () => { batal = true; };
           }, [student.nisn]);
           const totalLate = Math.max(studentHistory.length, serverLateCount);
           return (
               <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                   <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-5 animate-pop">
                       <div className="text-center">
                           <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-4 sm:hidden"></div>
                           <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Catat Keterlambatan</h3>
                           <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{student.name}</div>
                           <div className="text-xs text-slate-500 font-medium bg-white inline-block px-3 py-1 rounded-full mt-2 border border-slate-200">{student.class}</div>
                       </div>

                       {totalLate >= 3 && (
                           <div className="bg-crimson/10 border border-crimson/40 rounded-2xl p-3 space-y-1.5">
                               <div className="flex items-center gap-1.5 text-[10px] text-crimson font-bold uppercase tracking-wide">
                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-3 w-3 flex-shrink-0" />
                                   <span>Sudah {totalLate}x terlambat — perlu tindak lanjut</span>
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

       function GerbangTab({ students, allLogs, pelanggaranList, onSelectLate, suratList, onAddSurat, isAdminUser, waliKelasMap, izinList, kelompokList, canVerifyIzin, onCreateIzin, onVerifikasiIzin, onTandaiKembaliIzin, onSelesaikanIzin, onTandaiPulangIzin, onCreateKelompok, onVerifikasiKelompok, onTandaiKembaliKelompok, myWaliKelas }) {
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

           // Badge sakelar Izin Keluar — "pekerjaan yang menunggu SAYA", bukan
           // penghitung seluruh transaksi. Lihat hitungIzinMenungguVerifikasi
           // (helpers.js) untuk aturan lengkapnya & kenapa fungsi yang sama
           // dipakai lagi di ringkasan Beranda (DashboardTab).
           const izinBadge = hitungIzinMenungguVerifikasi(izinList, kelompokList, canVerifyIzin);

           return (
               <div className="space-y-5 animate-rise">
                   {/* Mode ketiga (Izin Keluar) menumpang sakelar yang SUDAH ADA di
                       sini — sengaja BUKAN entri BottomNav baru: ruang BottomNav
                       sudah pas untuk 4 ikon + "Lainnya" (lihat catatan panjang di
                       ROLES, config.js), dan alurnya memang milik guru piket yang
                       sudah bekerja di layar ini. */}
                   <div className="grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5 mt-6">
                       <button onClick={() => setMode('terlambat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'terlambat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Terlambat</button>
                       <button onClick={() => setMode('surat')} className={`py-3.5 px-2 rounded-xl text-xs font-bold transition ${mode === 'surat' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Catat Surat</button>
                       <button onClick={() => setMode('izin')} className={`relative py-2.5 px-2 rounded-xl text-xs font-bold transition leading-tight ${mode === 'izin' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>
                           Izin Keluar
                           <span className={`block text-[8px] font-bold uppercase tracking-widest mt-0.5 ${mode === 'izin' ? 'text-white/80' : 'text-amber-600'}`}>Beta</span>
                           {/* Badge = pekerjaan yang menunggu SAYA (Menunggu
                               Verifikasi yang memang boleh saya proses), BUKAN
                               total transaksi izin keluar — "Sedang di Luar"
                               sengaja tidak dihitung, itu kondisi operasional
                               bukan pekerjaan baru. count=0 -> badge disembunyikan
                               total, bukan menampilkan "0". */}
                           {izinBadge > 0 && (
                               <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold leading-none shadow-sm ${mode === 'izin' ? 'bg-white text-sky' : 'bg-crimson text-white'}`}>
                                   {izinBadge > 99 ? '99+' : izinBadge}
                               </span>
                           )}
                       </button>
                   </div>

                   {mode === 'izin' ? (
                       <IzinKeluarTab
                           students={students} izinList={izinList} kelompokList={kelompokList} canVerify={canVerifyIzin} waliKelasMap={waliKelasMap}
                           onCreateIzin={onCreateIzin} onVerifikasi={onVerifikasiIzin}
                           onTandaiKembali={onTandaiKembaliIzin} onSelesaikan={onSelesaikanIzin}
                           onTandaiPulang={onTandaiPulangIzin}
                           onCreateKelompok={onCreateKelompok} onVerifikasiKelompok={onVerifikasiKelompok}
                           onTandaiKembaliKelompok={onTandaiKembaliKelompok}
                           myWaliKelas={myWaliKelas}
                       />
                   ) : (
                   /* Isi lama (Catat Terlambat / Catat Surat) sengaja TIDAK
                      di-indent ulang saat dibungkus Fragment ini — supaya
                      riwayat perubahannya tetap terbaca sebagai "dibungkus",
                      bukan seluruh blok ikut berubah. */
                   <React.Fragment>

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
                   </React.Fragment>
                   )}
               </div>
           );
       }

       // ===== Izin Keluar / Pulang (BETA) =====
       // Dipakai sebagai mode KETIGA di dalam Gerbang (bukan menu BottomNav
       // baru): satu tempat yang sama dengan tempat guru piket sudah bekerja.
       //
       // Beda dari Surat: Surat = laporan tertulis atas siswa yang tidak
       // masuk/terlambat, selesai saat dicatat. Izin Keluar = transaksi
       // BERSTATUS untuk siswa yang meninggalkan lingkungan sekolah, dan baru
       // tertutup setelah siswa kembali (atau memang pulang).
       //
       // Prosedur sekolah dipertahankan utuh: persetujuan guru dulu (status
       // "Menunggu Verifikasi"), baru verifikasi Guru Piket. Tombol di layar
       // ini cuma mengikuti apa yang server izinkan — SEMUA kewenangan
       // ditegakkan ulang di server (canVerifyIzin di Utils.gs), jadi
       // menyembunyikan tombol di sini bukan pengamanannya.
       //
       // Yang dicatat pada tahap persetujuan adalah "guru yang memberikan
       // persetujuan" — identitasnya diambil dari sesi login, bukan diklaim
       // lewat isian. SIGAP TIDAK menyimpan jadwal mengajar per jam, jadi layar
       // ini TIDAK PERNAH meminta guru memilih/mengaku sebagai "Guru Mapel jam
       // ini" atau "Wali Kelas" sekadar untuk lolos validasi — klaim seperti
       // itu tidak bisa diperiksa kebenarannya, jadi tidak ada gunanya diminta.
       //
       // Komponen terpisah dari GerbangTab supaya alur Terlambat/Surat yang
       // sudah dipakai tiap pagi tidak ikut tersentuh.
       // Satu kartu transaksi izin. Sengaja komponen TERSENDIRI di level file,
       // bukan didefinisikan di dalam IzinKeluarPanel: komponen yang dibuat
       // ulang tiap render membuat React memperlakukannya sebagai tipe baru dan
       // membongkar-pasang seluruh kartunya. `children` diisi tombol aksi yang
       // relevan untuk kelompok status tempat kartu ini tampil.
       function KartuIzinKeluar({ izin, children }) {
           const jam = (v) => (v ? parseTimestamp(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-');
           return (
               <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2">
                   <div className="flex items-start justify-between gap-2">
                       <div className="min-w-0">
                           <div className="font-bold text-sm text-slate-900 truncate">{izin.name}</div>
                           <div className="text-[11px] text-sky-dim font-medium">{izin.class}</div>
                       </div>
                       <div className="flex flex-col items-end gap-1 flex-shrink-0">
                           <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${izin.tujuan === 'pulang' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-sky-dim/10 text-sky-dim border-sky-dim/30'}`}>
                               {izin.tujuan === 'pulang' ? 'Pulang' : 'Kembali ke sekolah'}
                           </span>
                           {izin.jalur === 'khusus' && (
                               <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border bg-crimson/10 text-crimson border-crimson/30">Izin Khusus</span>
                           )}
                       </div>
                   </div>
                   <div className="text-[11px] text-slate-600">{izin.keperluan}</div>
                   {izin.jalur === 'khusus' && izin.alasan_khusus && (
                       <div className="text-[10px] text-crimson bg-crimson/5 border border-crimson/20 rounded-lg px-2.5 py-1.5">
                           Alasan pengecualian: {izin.alasan_khusus}
                       </div>
                   )}
                   <div className="text-[10px] text-slate-500 space-y-0.5">
                       <div>Disetujui: {izin.disetujui_oleh || '-'} • {jam(izin.waktu_persetujuan)}</div>
                       {izin.diverifikasi_oleh && <div>Diverifikasi: {izin.diverifikasi_oleh} • {jam(izin.waktu_verifikasi)}</div>}
                       {izin.dicatat_kembali_oleh && <div>Kembali dicatat: {izin.dicatat_kembali_oleh} • {jam(izin.waktu_kembali)}</div>}
                   </div>
                   {children}
               </div>
           );
       }

       function IzinKeluarPanel({ students, izinList, canVerify, onCreateIzin, onVerifikasi, onTandaiKembali, onSelesaikan, waliKelasMap, myWaliKelas }) {
           const [searchQuery, setSearchQuery] = useState('');
           // Siswa yang baru dipilih dari pencarian, SEBELUM konteks persetujuan
           // dikonfirmasi — kartu kecil "Anda wali kelas siswa ini" / "Siswa ini
           // bukan kelas perwalian Anda" tampil dulu di sini, baru setelah
           // dikonfirmasi pindah ke formStudent (form lengkap). Dipisah dari
           // formStudent supaya "Batal" di kartu konteks tidak perlu membersihkan
           // isian form yang belum sempat ada.
           const [pickedStudent, setPickedStudent] = useState(null);
           const [formStudent, setFormStudent] = useState(null);
           const [keperluan, setKeperluan] = useState('');
           const [tujuan, setTujuan] = useState('kembali');
           const [jalurKhusus, setJalurKhusus] = useState(false);
           const [alasanKhusus, setAlasanKhusus] = useState('');
           const [saving, setSaving] = useState(false);
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');
           // Penjaga double-tap di sisi layar: selama satu aksi masih jalan,
           // tombol transaksi itu mati. Penjaga SEBENARNYA ada di server (satu
           // siswa tidak boleh punya dua transaksi berjalan, dan tiap transisi
           // status dicek dari status sekarang) — ini cuma supaya guru tidak
           // menunggu tanpa tahu tapnya sudah masuk.
           const [busyId, setBusyId] = useState('');

           // Baris peserta kegiatan (punya kelompok_id) SENGAJA tidak ikut di
           // sini: transaksinya diurus di mode Kelompok, lengkap dengan konteks
           // kegiatannya. Kalau ikut muncul di sini, petugas melihat 8 kartu
           // lepas tanpa keterangan kegiatan dan bisa menandai kembali satu per
           // satu padahal polanya rombongan.
           const daftar = (izinList || []).filter(i => !i.kelompok_id);
           const waliByClass = {};
           (waliKelasMap || []).forEach(w => { waliByClass[normalizeClass(w.class)] = w.waliKelasName; });

           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 6000); };

           // Tiga kelompok OPERASIONAL (bukan daftar status mentah) — inilah
           // yang benar-benar ditanyakan petugas piket sepanjang hari.
           const menunggu = daftar.filter(i => i.status === 'Menunggu Verifikasi');
           const diLuar = daftar.filter(i => i.status === 'Sedang di Luar');
           const selesaiHariIni = daftar.filter(i =>
               ['Kembali', 'Pulang', 'Selesai'].includes(i.status) && isSameDay(parseTimestamp(i.timestamp), new Date())
           );

           // Siswa yang transaksinya masih berjalan tidak ditawarkan lagi di
           // pencarian — server juga menolaknya, ini supaya guru tahu lebih awal.
           const izinTerbukaByNisn = {};
           daftar.forEach(i => {
               if (i.status === 'Menunggu Verifikasi' || i.status === 'Sedang di Luar') izinTerbukaByNisn[String(i.nisn)] = i;
           });

           const filtered = filterStudents(students, searchQuery);

           // Konteks persetujuan — MURNI label tampilan, dihitung dari data yang
           // sudah ada di layar (waliKelas milik pengguna vs kelas siswa), pakai
           // sameClass yang sama dengan Utils.gs supaya hasilnya selalu identik
           // dengan yang dihitung ulang server. Bukan role, bukan klaim jadwal
           // mengajar — server tetap menghitung ulang sendiri saat submit, tidak
           // pernah mempercayai apa pun dari klien (lihat addIzinKeluar, Code.gs).
           const konteksUntuk = (s) => (myWaliKelas && s && sameClass(s.class, myWaliKelas)) ? 'wali_kelas' : 'guru_mapel';

           const resetForm = () => { setPickedStudent(null); setFormStudent(null); setKeperluan(''); setTujuan('kembali'); setJalurKhusus(false); setAlasanKhusus(''); };

           const submitIzin = () => {
               if (saving) return;
               setSaving(true);
               onCreateIzin({
                   nisn: formStudent.nisn,
                   keperluan: keperluan,
                   tujuan: tujuan,
                   jalur: jalurKhusus ? 'khusus' : 'normal',
                   alasan_khusus: jalurKhusus ? alasanKhusus : '',
                   // Informasional saja — server MENGHITUNG ULANG konteksnya
                   // sendiri dari sesi + kelas siswa dan mengabaikan field ini
                   // sepenuhnya, jadi mengubah nilai ini di klien tidak bisa
                   // mengubah apa yang benar-benar tercatat.
                   konteks: konteksUntuk(formStudent),
               }, (ok, text) => {
                   setSaving(false);
                   showMsg(ok, text);
                   if (ok) resetForm();
               });
           };

           const runAction = (fn, izin, konfirmasiTeks) => {
               if (busyId) return;
               setBusyId(izin.id);
               fn({ id: izin.id }, (ok, text) => {
                   setBusyId('');
                   showMsg(ok, text || konfirmasiTeks);
               });
           };

           return (
               <div className="space-y-5">
                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                   <div>
                       <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Cari siswa untuk membuat izin keluar</label>
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
                           <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-[10px] text-slate-500 font-bold uppercase tracking-wider">Hasil ({filtered.length})</div>
                           <div className="max-h-60 overflow-y-auto">
                               {filtered.length > 0 ? filtered.map((s, i) => {
                                   const terbuka = izinTerbukaByNisn[String(s.nisn)];
                                   return (
                                       <div key={`${s.nisn}-${i}`} onClick={() => { if (!terbuka) { setSearchQuery(''); setPickedStudent(s); } }} className={`px-4 py-3.5 border-b border-slate-200/60 flex items-center justify-between transition ${terbuka ? 'opacity-60' : 'hover:bg-slate-100 active:bg-slate-200 cursor-pointer'}`}>
                                           <div className="min-w-0">
                                               <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                               <div className="text-xs text-sky-dim font-medium mt-0.5">{s.class} <span className="text-slate-500 font-normal">| {waliByClass[normalizeClass(s.class)] || 'Belum ada wali kelas'}</span></div>
                                           </div>
                                           <span className={`text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0 ml-2 ${terbuka ? 'bg-slate-200 text-slate-500' : 'bg-sky text-white shadow-sm'}`}>
                                               {terbuka ? (terbuka.status === 'Sedang di Luar' ? 'Di luar' : 'Menunggu') : 'Pilih'}
                                           </span>
                                       </div>
                                   );
                               }) : <div className="p-6 text-center text-xs text-slate-500 font-medium">Siswa tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {/* ① Menunggu Verifikasi — ini daftar kerja Guru Piket. */}
                   <div className="space-y-2.5">
                       <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Menunggu Verifikasi ({menunggu.length})</h3>
                       {menunggu.length > 0 ? menunggu.map((izin) => (
                           <KartuIzinKeluar key={izin.id} izin={izin}>
                               {canVerify ? (
                                   <Button onClick={() => runAction(onVerifikasi, izin, 'Terverifikasi.')} disabled={busyId === izin.id} size="compact" className="w-full">
                                       {busyId === izin.id ? 'Memproses...' : 'Verifikasi & Siswa Keluar'}
                                   </Button>
                               ) : (
                                   <div className="text-[10px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5 text-center">Menunggu diverifikasi Guru Piket yang bertugas.</div>
                               )}
                           </KartuIzinKeluar>
                       )) : <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} text="Tidak ada izin yang menunggu verifikasi." />}
                   </div>

                   {/* ② Sedang di Luar — hanya yang tujuannya kembali ke sekolah
                       yang bisa sampai ke sini (yang "pulang" langsung tertutup). */}
                   <div className="space-y-2.5">
                       <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Sedang di Luar ({diLuar.length})</h3>
                       {diLuar.length > 0 ? diLuar.map((izin) => (
                           <KartuIzinKeluar key={izin.id} izin={izin}>
                               {canVerify ? (
                                   <Button onClick={() => runAction(onTandaiKembali, izin, 'Ditandai kembali.')} disabled={busyId === izin.id} size="compact" variant="secondary" className="w-full">
                                       {busyId === izin.id ? 'Memproses...' : 'Tandai Kembali'}
                                   </Button>
                               ) : (
                                   <div className="text-[10px] text-slate-500 bg-slate-50 rounded-lg px-2.5 py-1.5 text-center">Petugas piket yang bertugas yang menandai siswa kembali.</div>
                               )}
                           </KartuIzinKeluar>
                       )) : <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} text="Tidak ada siswa yang sedang di luar." />}
                   </div>

                   {/* ③ Selesai Hari Ini — Kembali, Pulang, dan yang sudah ditutup. */}
                   {selesaiHariIni.length > 0 && (
                       <div className="space-y-2.5">
                           <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Selesai Hari Ini ({selesaiHariIni.length})</h3>
                           {selesaiHariIni.map((izin) => (
                               <KartuIzinKeluar key={izin.id} izin={izin}>
                                   <div className="flex items-center justify-between gap-2">
                                       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{izin.status}</span>
                                       {canVerify && izin.status !== 'Selesai' && (
                                           <button onClick={() => runAction(onSelesaikan, izin, 'Transaksi ditutup.')} disabled={busyId === izin.id} className="text-[10px] font-bold text-sky-dim hover:underline disabled:opacity-40">
                                               {busyId === izin.id ? 'Memproses...' : 'Tutup transaksi'}
                                           </button>
                                       )}
                                   </div>
                               </KartuIzinKeluar>
                           ))}
                       </div>
                   )}

                   {/* Kartu konteks — tampil dulu setelah siswa dipilih, SEBELUM
                       form. Ini bukan formulir klaim role: cuma menentukan label
                       mana yang dipakai ("Wali Kelas" vs "Guru Mapel"), dihitung
                       dari kelas perwalian pengguna vs kelas siswa yang dipilih —
                       tanpa jadwal mengajar apa pun. Menekan tombolnya cuma
                       membuka form yang sama seperti sebelumnya, dengan judul
                       yang menyesuaikan konteksnya. */}
                   {pickedStudent && (() => {
                       const konteks = konteksUntuk(pickedStudent);
                       return (
                           <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                               <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                                   <div className="text-center">
                                       <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-2 sm:hidden"></div>
                                       <div className="font-display text-xl font-extrabold text-slate-900">{pickedStudent.name}</div>
                                       <div className="text-xs text-slate-500 font-medium mt-1">{pickedStudent.class}</div>
                                   </div>
                                   <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-center leading-relaxed">
                                       {konteks === 'wali_kelas' ? 'Anda adalah wali kelas siswa ini.' : 'Siswa ini bukan kelas perwalian Anda.'}
                                   </p>
                                   <Button onClick={() => { setFormStudent(pickedStudent); setPickedStudent(null); }} className="w-full">
                                       {konteks === 'wali_kelas' ? 'Berikan Persetujuan' : 'Berikan Izin sebagai Guru Mapel'}
                                   </Button>
                                   <Button onClick={() => setPickedStudent(null)} variant="secondary" className="w-full">Batal</Button>
                               </div>
                           </div>
                       );
                   })()}

                   {/* Form pembuatan izin — dibuka setelah konteks dikonfirmasi. */}
                   {formStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                               <div className="text-center">
                                   <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-2 sm:hidden"></div>
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">
                                       {konteksUntuk(formStudent) === 'wali_kelas' ? 'Persetujuan sebagai Wali Kelas' : 'Persetujuan sebagai Guru Mapel'}
                                   </h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{formStudent.name}</div>
                                   <div className="text-xs text-slate-500">{formStudent.class}</div>
                               </div>

                               {/* "Guru Mapel" di sini adalah KONTEKS TINDAKAN, bukan
                                   klaim jadwal mengajar — SIGAP tidak punya data jadwal
                                   per jam dan tidak memverifikasinya. Identitas yang
                                   tercatat tetap dari sesi, sama seperti jalur Wali Kelas. */}
                               <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
                                   Anda akan tercatat sebagai pihak yang memberikan persetujuan izin ini.
                               </p>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Keperluan</label>
                                   <input type="text" value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="Contoh: berobat ke puskesmas" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Tujuan</label>
                                   <div className="grid grid-cols-2 gap-2">
                                       <button onClick={() => setTujuan('kembali')} className={`py-2.5 rounded-xl text-xs font-bold ${tujuan === 'kembali' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Kembali ke sekolah</button>
                                       <button onClick={() => setTujuan('pulang')} className={`py-2.5 rounded-xl text-xs font-bold ${tujuan === 'pulang' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Pulang / tidak kembali</button>
                                   </div>
                                   <p className="text-[10px] text-slate-500 mt-1.5">
                                       {tujuan === 'pulang'
                                           ? 'Setelah diverifikasi Guru Piket, transaksi langsung selesai — tidak perlu ditandai kembali.'
                                           : 'Setelah diverifikasi, siswa berstatus "Sedang di Luar" sampai ada petugas piket yang menandainya kembali.'}
                                   </p>
                               </div>

                               {/* Jalur khusus hanya muncul untuk yang berwenang — dan
                                   server tetap menolak kalau tetap dikirim orang lain. */}
                               {canVerify && (
                                   <div className="border-t border-slate-100 pt-3 space-y-2">
                                       <label className="flex items-start gap-2 cursor-pointer">
                                           <input type="checkbox" checked={jalurKhusus} onChange={(e) => setJalurKhusus(e.target.checked)} className="mt-0.5" />
                                           <span className="text-[11px] text-slate-600 leading-snug">
                                               <strong className="text-crimson">Izin Khusus</strong> — guru yang menangani siswa ini tidak tersedia dan keputusan harus diambil sekarang.
                                           </span>
                                       </label>
                                       {jalurKhusus && (
                                           <div className="space-y-2">
                                               <div className="text-[10px] text-crimson bg-crimson/10 border border-crimson/30 rounded-lg px-3 py-2 leading-relaxed">
                                                   Ini <strong>pengecualian</strong>, bukan jalan pintas prosedur normal. Transaksi akan tercatat sebagai <strong>Izin Khusus</strong> atas nama Anda, lengkap dengan alasannya, dan masuk jejak audit.
                                               </div>
                                               <input type="text" value={alasanKhusus} onChange={(e) => setAlasanKhusus(e.target.value)} placeholder="Alasan pengecualian (wajib)" className="w-full bg-white border border-crimson/40 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-crimson" />
                                           </div>
                                       )}
                                   </div>
                               )}

                               {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                               <Button onClick={submitIzin} disabled={saving || !keperluan.trim() || (jalurKhusus && !alasanKhusus.trim())} className="w-full">
                                   {saving ? 'Menyimpan...' : (jalurKhusus ? 'Catat Izin Khusus' : 'Setujui Izin')}
                               </Button>
                               <Button onClick={resetForm} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }

       // ===== Izin Kelompok: satu kegiatan, banyak peserta =====
       // Dipakai kalau beberapa siswa keluar karena SATU kegiatan yang sama
       // (seminar, lomba, kunjungan). Kalau keperluannya berbeda-beda, itu tetap
       // izin individual masing-masing — satu kegiatan = satu kelompok.
       //
       // Yang penting dan gampang salah: kelompok itu KONTEKS, bukan status.
       // Setiap peserta tetap punya status sendiri, dan angka rombongan di kartu
       // ("8 siswa · 7 di luar · 1 kembali") SELALU dihitung dari status peserta
       // — tidak ada status kelompok yang disimpan terpisah dan bisa berselisih.

       // Hitung keadaan satu rombongan dari baris pesertanya. Cerminan dari
       // ringkasKelompok() di Utils.gs — dipisah supaya layar tidak perlu
       // menunggu server hanya untuk menampilkan angkanya.
       function ringkasPesertaKelompok(peserta) {
           const list = peserta || [];
           return {
               total: list.length,
               menunggu: list.filter(p => p.status === 'Menunggu Verifikasi').length,
               diLuar: list.filter(p => p.status === 'Sedang di Luar').length,
               kembali: list.filter(p => p.status === 'Kembali').length,
               pulang: list.filter(p => p.status === 'Pulang').length,
               selesai: list.filter(p => p.status === 'Selesai').length,
           };
       }

       // Kartu satu kegiatan. Tombolnya cuma mengikuti apa yang server izinkan —
       // kewenangan sebenarnya dicek ulang di server pada tiap aksi.
       function KartuKelompok({ kelompok, peserta, canVerify, onLihat, onVerifikasi, onTandaiKembali, busy }) {
           const r = ringkasPesertaKelompok(peserta);
           const jam = (v) => (v ? parseTimestamp(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-');
           const rincian = [
               r.menunggu ? `${r.menunggu} menunggu` : '',
               r.diLuar ? `${r.diLuar} di luar` : '',
               r.kembali ? `${r.kembali} kembali` : '',
               r.pulang ? `${r.pulang} pulang` : '',
               r.selesai ? `${r.selesai} selesai` : '',
           ].filter(Boolean).join(' · ');
           return (
               <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2">
                   <div className="flex items-start justify-between gap-2">
                       <div className="min-w-0">
                           <div className="font-bold text-sm text-slate-900">{kelompok.kegiatan}</div>
                           <div className="text-[11px] text-sky-dim font-medium">{r.total} siswa{rincian ? ` — ${rincian}` : ''}</div>
                       </div>
                       <div className="flex flex-col items-end gap-1 flex-shrink-0">
                           <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${kelompok.tujuan === 'pulang' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-sky-dim/10 text-sky-dim border-sky-dim/30'}`}>
                               {kelompok.tujuan === 'pulang' ? 'Pulang' : 'Kembali ke sekolah'}
                           </span>
                           {kelompok.jalur === 'khusus' && (
                               <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border bg-crimson/10 text-crimson border-crimson/30">Izin Khusus</span>
                           )}
                       </div>
                   </div>
                   <div className="text-[11px] text-slate-600">{kelompok.keperluan}</div>
                   {kelompok.jalur === 'khusus' && kelompok.alasan_khusus && (
                       <div className="text-[10px] text-crimson bg-crimson/5 border border-crimson/20 rounded-lg px-2.5 py-1.5">
                           Alasan pengecualian: {kelompok.alasan_khusus}
                       </div>
                   )}
                   <div className="text-[10px] text-slate-500 space-y-0.5">
                       <div>Disetujui: {kelompok.disetujui_oleh || '-'} • {jam(kelompok.waktu_persetujuan)}</div>
                       {kelompok.diverifikasi_oleh && <div>Diverifikasi: {kelompok.diverifikasi_oleh} • {jam(kelompok.waktu_verifikasi)}</div>}
                       {kelompok.tujuan === 'kembali' && (
                           <div>Pola kembali: {kelompok.pola_kembali === 'individual' ? 'Individual' : 'Bersama'}</div>
                       )}
                   </div>
                   <div className="flex gap-2 pt-0.5">
                       <Button onClick={() => onLihat(kelompok)} variant="ghost" size="compact" className="flex-1">Lihat Peserta</Button>
                       {canVerify && r.menunggu > 0 && (
                           <Button onClick={() => onVerifikasi(kelompok)} size="compact" disabled={busy} className="flex-1">
                               {busy ? 'Memproses...' : 'Verifikasi Kelompok'}
                           </Button>
                       )}
                       {/* "Tandai Rombongan Kembali" hanya untuk pola BERSAMA. Pola
                           individual ditandai per siswa dari daftar peserta — kalau
                           tombol rombongan ikut muncul di sana, artinya kita
                           menganggap semua pulang-pergi bareng padahal bukan. */}
                       {canVerify && r.menunggu === 0 && r.diLuar > 0 && kelompok.pola_kembali === 'bersama' && (
                           <Button onClick={() => onTandaiKembali(kelompok)} variant="secondary" size="compact" disabled={busy} className="flex-1">
                               {busy ? 'Memproses...' : 'Tandai Rombongan Kembali'}
                           </Button>
                       )}
                   </div>
               </div>
           );
       }

       // Daftar peserta satu kegiatan. Satu komponen untuk tiga keperluan:
       //   'lihat'      — baca saja (+ aksi per siswa untuk pola individual)
       //   'verifikasi' — centang siapa yang benar-benar berangkat
       //   'kembali'    — centang siapa yang benar-benar sudah kembali
       // Dua mode terakhir SELALU lewat centang, tidak pernah "ubah semua sekali
       // tap": mengubah 8 siswa sekaligus padahal 1 masih di luar itu persis
       // catatan palsu yang harus dicegah. Server menolak hal yang sama.
       function PesertaKelompokSheet({ kelompok, peserta, mode, dipilih, onToggle, onTutup, onKonfirmasi, canVerify, busy, onTandaiKembaliIndividu, onTandaiPulang }) {
           const bisaDicentang = (p) => (mode === 'verifikasi' ? p.status === 'Menunggu Verifikasi' : p.status === 'Sedang di Luar');
           const judul = mode === 'verifikasi' ? 'Verifikasi Kelompok' : mode === 'kembali' ? 'Tandai Rombongan Kembali' : 'Peserta Kegiatan';
           const terpilih = (dipilih || []).length;
           const polaIndividual = kelompok.pola_kembali === 'individual';
           return (
               <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                   <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                       <div className="text-center">
                           <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-2 sm:hidden"></div>
                           <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">{judul}</h3>
                           <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{kelompok.kegiatan}</div>
                           <div className="text-xs text-slate-500">{(peserta || []).length} siswa</div>
                       </div>

                       {mode === 'verifikasi' && (
                           <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
                               Centang siswa yang benar-benar berangkat. Yang tidak dicentang tetap menunggu verifikasi.
                           </p>
                       )}
                       {mode === 'kembali' && (
                           <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
                               Centang siswa yang benar-benar sudah kembali. Yang tidak dicentang tetap tercatat <strong>Sedang di Luar</strong>.
                           </p>
                       )}

                       <div className="max-h-72 overflow-y-auto space-y-1.5">
                           {(peserta || []).map((p) => {
                               const aktif = bisaDicentang(p);
                               const dicentang = (dipilih || []).indexOf(p.id) !== -1;
                               return (
                                   <div key={p.id} className={`border rounded-xl px-3 py-2 ${aktif && mode !== 'lihat' ? 'border-slate-300' : 'border-slate-200 bg-slate-50'}`}>
                                       <div className="flex items-center gap-2">
                                           {mode !== 'lihat' && (
                                               <input type="checkbox" checked={dicentang} disabled={!aktif} onChange={() => onToggle(p.id)} />
                                           )}
                                           <div className="min-w-0 flex-1">
                                               <div className="text-xs font-bold text-slate-900 truncate">{p.name}</div>
                                               <div className="text-[10px] text-slate-500">{p.class} • {p.status}</div>
                                           </div>
                                       </div>
                                       {/* Pola individual: tiap siswa ditandai sendiri-sendiri,
                                           tanpa asumsi rombongan kembali bersamaan. Tombol
                                           "Pulang" untuk siswa yang ternyata tidak balik lagi
                                           ke sekolah — statusnya berhenti di Pulang dan tidak
                                           bisa ditandai kembali setelahnya. */}
                                       {mode === 'lihat' && canVerify && p.status === 'Sedang di Luar' && (
                                           <div className="flex gap-1.5 mt-1.5">
                                               {polaIndividual && (
                                                   <button onClick={() => onTandaiKembaliIndividu(p)} disabled={busy} className="flex-1 text-[10px] font-bold text-sky-dim border border-sky-dim/40 rounded-lg py-1.5 disabled:opacity-40">Tandai Kembali</button>
                                               )}
                                               <button onClick={() => onTandaiPulang(p)} disabled={busy} className="flex-1 text-[10px] font-bold text-amber-700 border border-amber-300 rounded-lg py-1.5 disabled:opacity-40">Tandai Pulang</button>
                                           </div>
                                       )}
                                   </div>
                               );
                           })}
                       </div>

                       {mode !== 'lihat' && (
                           <Button onClick={onKonfirmasi} disabled={busy || !terpilih} className="w-full">
                               {busy ? 'Memproses...' : `Konfirmasi ${terpilih} siswa`}
                           </Button>
                       )}
                       <Button onClick={onTutup} variant="secondary" className="w-full">Tutup</Button>
                   </div>
               </div>
           );
       }

       function IzinKelompokPanel({ students, izinList, kelompokList, canVerify, waliKelasMap, onCreateKelompok, onVerifikasiKelompok, onTandaiKembaliKelompok, onTandaiKembaliIndividu, onTandaiPulang }) {
           const [kegiatan, setKegiatan] = useState('');
           const [keperluan, setKeperluan] = useState('');
           const [tujuan, setTujuan] = useState('kembali');
           const [pola, setPola] = useState('bersama');
           const [searchQuery, setSearchQuery] = useState('');
           const [pilihan, setPilihan] = useState([]);
           const [jalurKhusus, setJalurKhusus] = useState(false);
           const [alasanKhusus, setAlasanKhusus] = useState('');
           const [saving, setSaving] = useState(false);
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');
           const [busyId, setBusyId] = useState('');
           const [sheetKelompok, setSheetKelompok] = useState(null);
           const [sheetMode, setSheetMode] = useState('lihat');
           const [sheetPilih, setSheetPilih] = useState([]);

           const daftarIzin = izinList || [];
           const daftarKelompok = kelompokList || [];
           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 6000); };

           // Peserta tiap kegiatan diambil dari baris izin individualnya — inilah
           // yang membuat status per siswa selalu jadi sumber kebenaran.
           const pesertaByKelompok = {};
           daftarIzin.forEach(i => {
               if (!i.kelompok_id) return;
               if (!pesertaByKelompok[i.kelompok_id]) pesertaByKelompok[i.kelompok_id] = [];
               pesertaByKelompok[i.kelompok_id].push(i);
           });
           const pesertaDari = (k) => pesertaByKelompok[k.id] || [];

           // Satu kegiatan muncul di SATU kelompok tampilan saja (yang paling perlu
           // ditindak), tapi angka rinciannya tetap tampil penuh di kartunya —
           // jadi tidak ada peserta yang tersembunyi karena pengelompokan ini.
           const bucket = (k) => {
               const r = ringkasPesertaKelompok(pesertaDari(k));
               if (r.menunggu > 0) return 'menunggu';
               if (r.diLuar > 0) return 'diLuar';
               return 'selesai';
           };
           const menunggu = daftarKelompok.filter(k => bucket(k) === 'menunggu');
           const diLuar = daftarKelompok.filter(k => bucket(k) === 'diLuar');
           const selesaiHariIni = daftarKelompok.filter(k => bucket(k) === 'selesai' && isSameDay(parseTimestamp(k.timestamp), new Date()));

           // Siswa yang transaksinya masih berjalan tidak bisa ikut kegiatan baru —
           // server juga menolaknya, ini supaya guru tahu sebelum menekan Ajukan.
           const izinTerbukaByNisn = {};
           daftarIzin.forEach(i => {
               if (i.status === 'Menunggu Verifikasi' || i.status === 'Sedang di Luar') izinTerbukaByNisn[String(i.nisn)] = i;
           });

           const filtered = filterStudents(students, searchQuery);
           const dipilihNisn = pilihan.map(p => String(p.nisn));
           const togglePeserta = (s) => {
               setPilihan(prev => (prev.some(p => String(p.nisn) === String(s.nisn))
                   ? prev.filter(p => String(p.nisn) !== String(s.nisn))
                   : [...prev, s]));
           };

           const resetForm = () => { setKegiatan(''); setKeperluan(''); setTujuan('kembali'); setPola('bersama'); setPilihan([]); setSearchQuery(''); setJalurKhusus(false); setAlasanKhusus(''); };

           const submitKelompok = () => {
               if (saving) return;
               setSaving(true);
               // Yang dikirim cuma NISN — nama & kelas diambil server dari
               // Master_Siswa, jadi tidak ada identitas siswa yang dikarang klien.
               onCreateKelompok({
                   kegiatan: kegiatan,
                   keperluan: keperluan,
                   tujuan: tujuan,
                   pola_kembali: tujuan === 'kembali' ? pola : '',
                   peserta: pilihan.map(p => ({ nisn: p.nisn })),
                   jalur: jalurKhusus ? 'khusus' : 'normal',
                   alasan_khusus: jalurKhusus ? alasanKhusus : '',
               }, (ok, text) => {
                   setSaving(false);
                   showMsg(ok, text);
                   if (ok) resetForm();
               });
           };

           const bukaSheet = (k, mode) => {
               setSheetKelompok(k);
               setSheetMode(mode);
               setSheetPilih(mode === 'lihat' ? [] : pesertaDari(k)
                   .filter(p => (mode === 'verifikasi' ? p.status === 'Menunggu Verifikasi' : p.status === 'Sedang di Luar'))
                   .map(p => p.id));
           };
           const tutupSheet = () => { setSheetKelompok(null); setSheetPilih([]); setSheetMode('lihat'); };
           const toggleSheetPilih = (id) => setSheetPilih(prev => (prev.indexOf(id) !== -1 ? prev.filter(x => x !== id) : [...prev, id]));

           const konfirmasiSheet = () => {
               if (!sheetKelompok || busyId) return;
               const fn = sheetMode === 'verifikasi' ? onVerifikasiKelompok : onTandaiKembaliKelompok;
               setBusyId(sheetKelompok.id);
               fn({ id: sheetKelompok.id, pesertaIds: sheetPilih }, (ok, text) => {
                   setBusyId('');
                   showMsg(ok, text);
                   if (ok) tutupSheet();
               });
           };

           const aksiPeserta = (fn, peserta) => {
               if (busyId) return;
               setBusyId(peserta.id);
               fn({ id: peserta.id }, (ok, text) => { setBusyId(''); showMsg(ok, text); });
           };

           const seksi = (judul, list, kosong) => (
               <div className="space-y-2.5">
                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{judul} ({list.length})</h3>
                   {list.length > 0 ? list.map(k => (
                       <KartuKelompok
                           key={k.id} kelompok={k} peserta={pesertaDari(k)} canVerify={canVerify} busy={busyId === k.id}
                           onLihat={(kel) => bukaSheet(kel, 'lihat')}
                           onVerifikasi={(kel) => bukaSheet(kel, 'verifikasi')}
                           onTandaiKembali={(kel) => bukaSheet(kel, 'kembali')}
                       />
                   )) : <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />} text={kosong} />}
               </div>
           );

           return (
               <div className="space-y-5">
                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                   <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                       <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ajukan Kegiatan</div>
                       <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-relaxed">
                           Untuk <strong>satu kegiatan yang sama</strong>. Kalau keperluan tiap siswa berbeda, pakai Izin Individual — jangan digabung.
                       </p>

                       <div>
                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Kegiatan</label>
                           <input type="text" value={kegiatan} onChange={(e) => setKegiatan(e.target.value)} placeholder="Contoh: Seminar Bank Indonesia" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                       </div>
                       <div>
                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Keperluan / Keterangan</label>
                           <input type="text" value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="Contoh: undangan seminar literasi keuangan" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                       </div>

                       <div>
                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Tujuan</label>
                           <div className="grid grid-cols-2 gap-2">
                               <button onClick={() => setTujuan('kembali')} className={`py-2.5 rounded-xl text-xs font-bold ${tujuan === 'kembali' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Kembali ke sekolah</button>
                               <button onClick={() => setTujuan('pulang')} className={`py-2.5 rounded-xl text-xs font-bold ${tujuan === 'pulang' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Pulang / tidak kembali</button>
                           </div>
                       </div>

                       {/* Pola kembali cuma punya arti kalau memang ada yang kembali. */}
                       {tujuan === 'kembali' && (
                           <div>
                               <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Pola Kembali</label>
                               <div className="grid grid-cols-2 gap-2">
                                   <button onClick={() => setPola('bersama')} className={`py-2.5 rounded-xl text-xs font-bold ${pola === 'bersama' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Bersama</button>
                                   <button onClick={() => setPola('individual')} className={`py-2.5 rounded-xl text-xs font-bold ${pola === 'individual' ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>Individual</button>
                               </div>
                               <p className="text-[10px] text-slate-500 mt-1.5">
                                   {pola === 'bersama'
                                       ? 'Rombongan ditandai kembali sekali jalan — tetap dengan mencentang siapa saja yang benar-benar sudah kembali.'
                                       : 'Tiap peserta ditandai kembali sendiri-sendiri dari daftar peserta.'}
                               </p>
                           </div>
                       )}

                       <div>
                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Peserta ({pilihan.length})</label>
                           {pilihan.length > 0 && (
                               <div className="flex flex-wrap gap-1.5 mb-2">
                                   {pilihan.map(p => (
                                       <span key={p.nisn} className="inline-flex items-center gap-1 bg-sky-dim/10 border border-sky-dim/30 text-sky-dim text-[10px] font-semibold px-2 py-1 rounded-full">
                                           {p.name} — {p.class}
                                           <button onClick={() => togglePeserta(p)} aria-label={`Hapus ${p.name}`} className="text-sky-dim/70 hover:text-sky-dim">×</button>
                                       </span>
                                   ))}
                               </div>
                           )}
                           <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama, kelas, atau NISN..." className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                           {searchQuery.trim() !== '' && (
                               <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                                   {filtered.length > 0 ? filtered.map((s, i) => {
                                       const terbuka = izinTerbukaByNisn[String(s.nisn)];
                                       const terpilih = dipilihNisn.indexOf(String(s.nisn)) !== -1;
                                       return (
                                           <div key={`${s.nisn}-${i}`} onClick={() => { if (!terbuka) togglePeserta(s); }} className={`px-3 py-2.5 border-b border-slate-200/60 flex items-center justify-between gap-2 ${terbuka ? 'opacity-60' : 'cursor-pointer hover:bg-slate-100 active:bg-slate-200'}`}>
                                               <div className="min-w-0">
                                                   <div className="text-xs font-bold text-slate-900 truncate">{s.name}</div>
                                                   <div className="text-[10px] text-slate-500">{s.class}</div>
                                               </div>
                                               <span className={`text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${terbuka ? 'bg-slate-200 text-slate-500' : terpilih ? 'bg-sky text-white' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}>
                                                   {terbuka ? (terbuka.status === 'Sedang di Luar' ? 'Di luar' : 'Menunggu') : terpilih ? '✓ Dipilih' : 'Pilih'}
                                               </span>
                                           </div>
                                       );
                                   }) : <div className="p-4 text-center text-xs text-slate-500 font-medium">Siswa tidak ditemukan</div>}
                               </div>
                           )}
                       </div>

                       {canVerify && (
                           <div className="border-t border-slate-100 pt-3 space-y-2">
                               <label className="flex items-start gap-2 cursor-pointer">
                                   <input type="checkbox" checked={jalurKhusus} onChange={(e) => setJalurKhusus(e.target.checked)} className="mt-0.5" />
                                   <span className="text-[11px] text-slate-600 leading-snug">
                                       <strong className="text-crimson">Izin Khusus</strong> — guru yang menangani siswa ini tidak tersedia dan keputusan harus diambil sekarang.
                                   </span>
                               </label>
                               {jalurKhusus && (
                                   <div className="space-y-2">
                                       <div className="text-[10px] text-crimson bg-crimson/10 border border-crimson/30 rounded-lg px-3 py-2 leading-relaxed">
                                           Ini <strong>pengecualian</strong>, bukan jalan pintas prosedur normal. Kegiatan akan tercatat sebagai <strong>Izin Khusus</strong> atas nama Anda, lengkap dengan alasannya, dan masuk jejak audit.
                                       </div>
                                       <input type="text" value={alasanKhusus} onChange={(e) => setAlasanKhusus(e.target.value)} placeholder="Alasan pengecualian (wajib)" className="w-full bg-white border border-crimson/40 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-crimson" />
                                   </div>
                               )}
                           </div>
                       )}

                       <p className="text-[11px] text-slate-600 leading-relaxed">
                           Anda akan tercatat sebagai pihak yang memberikan persetujuan kegiatan ini.
                       </p>
                       <Button onClick={submitKelompok} disabled={saving || !kegiatan.trim() || !keperluan.trim() || !pilihan.length || (jalurKhusus && !alasanKhusus.trim())} className="w-full">
                           {saving ? 'Menyimpan...' : (jalurKhusus ? 'Catat Kegiatan (Izin Khusus)' : 'Ajukan Kelompok')}
                       </Button>
                   </div>

                   {seksi('Menunggu Verifikasi', menunggu, 'Tidak ada kegiatan yang menunggu verifikasi.')}
                   {seksi('Sedang di Luar', diLuar, 'Tidak ada rombongan yang sedang di luar.')}
                   {selesaiHariIni.length > 0 && seksi('Selesai Hari Ini', selesaiHariIni, '')}

                   {sheetKelompok && (
                       <PesertaKelompokSheet
                           kelompok={sheetKelompok} peserta={pesertaDari(sheetKelompok)} mode={sheetMode}
                           dipilih={sheetPilih} onToggle={toggleSheetPilih} onTutup={tutupSheet}
                           onKonfirmasi={konfirmasiSheet} canVerify={canVerify} busy={!!busyId}
                           onTandaiKembaliIndividu={(p) => aksiPeserta(onTandaiKembaliIndividu, p)}
                           onTandaiPulang={(p) => aksiPeserta(onTandaiPulang, p)}
                       />
                   )}
               </div>
           );
       }

       // Pembungkus mode Izin Keluar di dalam Gerbang: kartu BETA + sakelar
       // Individual/Kelompok. Sengaja komponen tersendiri supaya state milik
       // kedua panel tidak bercampur, dan supaya panel individual yang sudah
       // dipakai tidak perlu diubah sama sekali saat mode kelompok ditambahkan.
       function IzinKeluarTab(props) {
           const [subMode, setSubMode] = useState('individual');
           return (
               <div className="space-y-5">
                   {/* Satu-satunya kalimat soal cetak yang boleh ada di layar ini.
                       Jenis printer, media, ukuran kertas & cara koneksinya belum
                       ditentukan sekolah — jadi tidak ada apa pun di fitur ini yang
                       berhubungan dengan perangkat cetak. */}
                   <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-1">
                       <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Izin Keluar · BETA</div>
                       <p className="text-[11px] text-amber-800 leading-relaxed">
                           Alur tetap seperti prosedur sekolah: <strong>persetujuan guru</strong> dulu, lalu <strong>verifikasi Guru Piket</strong>, baru siswa keluar.
                       </p>
                       <p className="text-[11px] text-amber-800">Fitur pencetakan masih dalam tahap BETA.</p>
                   </div>

                   <div className="grid grid-cols-2 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       <button onClick={() => setSubMode('individual')} className={`py-2.5 rounded-xl text-xs font-bold transition ${subMode === 'individual' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Individual</button>
                       <button onClick={() => setSubMode('kelompok')} className={`py-2.5 rounded-xl text-xs font-bold transition ${subMode === 'kelompok' ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>Kelompok</button>
                   </div>

                   {subMode === 'kelompok' ? (
                       <IzinKelompokPanel
                           students={props.students} izinList={props.izinList} kelompokList={props.kelompokList}
                           canVerify={props.canVerify} waliKelasMap={props.waliKelasMap}
                           onCreateKelompok={props.onCreateKelompok} onVerifikasiKelompok={props.onVerifikasiKelompok}
                           onTandaiKembaliKelompok={props.onTandaiKembaliKelompok}
                           onTandaiKembaliIndividu={props.onTandaiKembali} onTandaiPulang={props.onTandaiPulang}
                       />
                   ) : (
                       <IzinKeluarPanel
                           students={props.students} izinList={props.izinList} canVerify={props.canVerify} waliKelasMap={props.waliKelasMap}
                           onCreateIzin={props.onCreateIzin} onVerifikasi={props.onVerifikasi}
                           onTandaiKembali={props.onTandaiKembali} onSelesaikan={props.onSelesaikan}
                           myWaliKelas={props.myWaliKelas}
                       />
                   )}
               </div>
           );
       }
