// ===== beranda-riwayat.js =====
// Tab Beranda (ringkasan hari ini) dan Riwayat (pencarian & filter
// lintas kategori: Terlambat/Pelanggaran/Surat), termasuk edit/hapus
// 1 catatan (khusus Admin & BK/Kesiswaan, BK/Kesiswaan dibatasi 5 menit
// sejak catatan dibuat — aturan sebenarnya ditegakkan di server).

       function SummaryCard({ value, label, tone }) {
           const toneClasses = {
               crimson: 'bg-crimson/10 border-crimson/30 text-crimson',
               amber: 'bg-amber-50 border-amber-200 text-amber-600',
               sky: 'bg-sky-dim/10 border-sky-dim/30 text-sky-dim',
           };
           return (
               <div className={`p-4 rounded-2xl text-center border ${toneClasses[tone]}`}>
                   <div className="font-display text-3xl font-extrabold">{value}</div>
                   <div className="text-[9px] mt-1 font-bold uppercase tracking-wide opacity-80">{label}</div>
               </div>
           );
       }

       function FeedItem({ item }) {
           const toneClasses = {
               terlambat: 'bg-crimson/10 text-crimson border-crimson/20',
               pelanggaran: 'bg-amber-50 text-amber-700 border-amber-200',
               surat: 'bg-sky-dim/10 text-sky-dim border-sky-dim/20',
           };
           const labelMap = { terlambat: 'Terlambat', pelanggaran: 'Pelanggaran', surat: 'Surat' };
           const detailMap = {
               terlambat: item.type,
               pelanggaran: `${item.jenis_pelanggaran} — ${item.sanksi}`,
               surat: item.jenis,
           };
           return (
               <div className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1 shadow-sm">
                   <div className="flex items-center justify-between gap-2">
                       <div className="font-bold text-sm text-slate-900 truncate">{item.name}</div>
                       <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border flex-shrink-0 ${toneClasses[item._kind]}`}>{labelMap[item._kind]}</span>
                   </div>
                   <div className="text-[11px] text-slate-500 flex justify-between items-center gap-2">
                       <span className="truncate">{item.class} • {detailMap[item._kind]}</span>
                       <span className="flex-shrink-0 text-slate-400">{item._time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                   </div>
               </div>
           );
       }

       // Sapaan sesuai jam — bagian pertama Dashboard (Blueprint SIGAP v2, section III ①)
       function sapaanWaktu() {
           const h = new Date().getHours();
           if (h < 11) return 'Selamat Pagi';
           if (h < 15) return 'Selamat Siang';
           if (h < 18) return 'Selamat Sore';
           return 'Selamat Malam';
       }

       function DashboardTab({ user, allLogs, pelanggaranList, suratList, jadwalPiket, onRefresh, loading, tindakLanjutList, canViewRanking, isAdmin, onAjukanTindakLanjut, onApproveTindakLanjut }) {
           const [showPiketList, setShowPiketList] = useState(false);
           const [tindakLanjutTarget, setTindakLanjutTarget] = useState(null);
           const [catatanInput, setCatatanInput] = useState('');
           const [tlMsg, setTlMsg] = useState('');
           const [showRiwayatTL, setShowRiwayatTL] = useState(false);
           const now = new Date();
           const todayLate = allLogs.filter(l => isSameDay(parseTimestamp(l.timestamp), now));
           const todayPelanggaran = pelanggaranList.filter(p => isSameDay(parseTimestamp(p.timestamp), now));
           const todaySurat = suratList.filter(s => isSameDay(parseTimestamp(s.timestamp), now));

           // Hanya aktivitas HARI INI — untuk data lebih lama, arahkan ke menu Riwayat
           const combinedFeed = [
               ...todayLate.map(l => ({ ...l, _kind: 'terlambat', _time: parseTimestamp(l.timestamp) })),
               ...todayPelanggaran.map(p => ({ ...p, _kind: 'pelanggaran', _time: parseTimestamp(p.timestamp) })),
               ...todaySurat.map(s => ({ ...s, _kind: 'surat', _time: parseTimestamp(s.timestamp) })),
           ].sort((a, b) => b._time - a._time);

           // Siswa yang sudah 3x terlambat minggu ini ATAU 5x bulan ini — perlu
           // tindak lanjut wali kelas/BK. resolvedMap bikin hitungan mulai dari
           // nol lagi sejak tindak lanjut disetujui admin (lihat helpers.js).
           // Visibilitas: admin/BK lihat semua kelas, wali kelas cuma kelasnya
           // sendiri, guru biasa non-wali-kelas tidak lihat sama sekali (privasi).
           const resolvedMap = buildResolvedMap(tindakLanjutList);
           const rawFrequentLatecomers = getFrequentLatecomersBanner(allLogs, resolvedMap);
           const frequentLatecomers = canViewRanking
               ? rawFrequentLatecomers
               : (user.waliKelas ? rawFrequentLatecomers.filter(s => sameClass(s.class, user.waliKelas)) : []);

           const showMsgTL = (text) => { setTlMsg(text); setTimeout(() => setTlMsg(''), 3000); };
           const submitTindakLanjut = () => {
               if (!tindakLanjutTarget || !catatanInput.trim()) return;
               onAjukanTindakLanjut({ nisn: tindakLanjutTarget.nisn, name: tindakLanjutTarget.name, class_name: tindakLanjutTarget.class, catatan: catatanInput.trim() }, (ok, text) => showMsgTL(text));
               setTindakLanjutTarget(null); setCatatanInput('');
           };
           const approveTL = (t) => {
               onApproveTindakLanjut({ nisn: t.nisn, timestamp: t.timestamp }, (ok, text) => showMsgTL(text));
           };

           // ② Assignment Hari Ini — piket (dari Jadwal_Piket) & wali kelas (dari sesi login).
           // Nama hari dihitung dari HARI_PIKET (config.js), bukan locale API, supaya
           // tidak tergantung setting browser/OS pengguna.
           const hariIni = getHariIni();
           const piketHariIni = [...jadwalPiket.filter(j => j.hari === hariIni)].sort((a, b) => String(a.guruName).localeCompare(String(b.guruName)));
           const isPiketToday = piketHariIni.some(j => String(j.guruId) === String(user.id));
           const waliKelas = user.waliKelas || '';

           // ⑥ Ringkasan kelas perwalian — dihitung dari data yang sudah di-fetch,
           // difilter ke kelas perwalian guru ini saja, minggu berjalan.
           const weekStart = startOfWeek(now);
           let kelasPerwalian = null;
           if (waliKelas) {
               const lateWeek = allLogs.filter(l => sameClass(l.class, waliKelas) && parseTimestamp(l.timestamp) >= weekStart);
               const pelanggaranWeek = pelanggaranList.filter(p => sameClass(p.class, waliKelas) && parseTimestamp(p.timestamp) >= weekStart);
               const bermasalah = {};
               lateWeek.forEach(l => { bermasalah[l.nisn] = bermasalah[l.nisn] || { nisn: l.nisn, name: l.name }; });
               pelanggaranWeek.forEach(p => { bermasalah[p.nisn] = bermasalah[p.nisn] || { nisn: p.nisn, name: p.name }; });
               kelasPerwalian = {
                   jumlahSiswaBermasalah: Object.keys(bermasalah).length,
                   daftarSiswa: Object.values(bermasalah),
               };
           }

           return (
               <div className="space-y-5 animate-rise">
                   {/* ① Sapaan */}
                   <div className="flex justify-between items-end">
                       <div>
                           <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{sapaanWaktu()}</h2>
                           <div className="font-display text-lg font-extrabold text-slate-900">{user.name.split(' ')[0]}</div>
                       </div>
                       <button onClick={onRefresh} className="text-[10px] text-sky-dim font-semibold bg-sky-dim/10 px-2 py-1 rounded-md">Refresh</button>
                   </div>

                   {/* ② Assignment Hari Ini */}
                   {(piketHariIni.length > 0 || waliKelas) && (
                       <div className={`rounded-2xl p-4 space-y-2 border ${isPiketToday ? 'bg-sky-dim/15 border-sky-dim/40' : 'bg-white border-slate-200'}`}>
                           {piketHariIni.length > 0 && (
                               <div>
                                   <button onClick={() => setShowPiketList(v => !v)} className="w-full flex items-center justify-between gap-2 text-left">
                                       <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">👮 Guru Piket Hari Ini ({hariIni}) — {piketHariIni.length} orang</div>
                                       <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d={showPiketList ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'} />} className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                                   </button>
                                   {showPiketList && (
                                       <div className="mt-2 flex flex-wrap gap-1.5 animate-pop">
                                           {piketHariIni.map((j, i) => (
                                               <span key={i} className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg ${String(j.guruId) === String(user.id) ? 'bg-sky text-white' : 'bg-slate-100 text-slate-600'}`}>{j.guruName}</span>
                                           ))}
                                       </div>
                                   )}
                                   {isPiketToday && <div className="text-[10px] text-sky-dim font-bold mt-1.5">✓ Anda piket hari ini</div>}
                               </div>
                           )}
                           {waliKelas && (
                               <div className={piketHariIni.length > 0 ? 'pt-2 border-t border-slate-200/70' : ''}>
                                   <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">👨‍🏫 Wali Kelas {waliKelas}</div>
                               </div>
                           )}
                       </div>
                   )}

                   {/* ③ Ringkasan Hari Ini */}
                   <div className="grid grid-cols-3 gap-2.5">
                       <SummaryCard value={todayLate.length} label="Terlambat" tone="crimson" />
                       <SummaryCard value={todaySurat.length} label="Surat" tone="sky" />
                       <SummaryCard value={todayPelanggaran.length} label="Pelanggaran" tone="amber" />
                   </div>

                   {/* ④ Perlu Perhatian */}
                   {frequentLatecomers.length > 0 && (
                       <div className="bg-crimson/10 border border-crimson/30 rounded-2xl p-4 space-y-2.5">
                           <div className="text-[10px] text-crimson font-bold uppercase tracking-wide flex items-center gap-1.5">
                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-3.5 w-3.5" />
                               Siswa Sering Terlambat
                           </div>
                           {tlMsg && <div className="text-[10px] text-sky-dim font-semibold bg-white/60 rounded-lg px-2 py-1.5">{tlMsg}</div>}
                           <div className="space-y-2">
                               {frequentLatecomers.map((s, idx) => {
                                   const pending = tindakLanjutList.find(t => t.nisn === s.nisn && t.status === 'menunggu');
                                   return (
                                       <div key={idx} className="space-y-1 pb-2 border-b border-crimson/10 last:border-0 last:pb-0">
                                           <div className="flex items-center justify-between gap-2 text-xs">
                                               <span className="text-slate-800 font-medium truncate">{s.name} <span className="text-slate-400 font-normal">({s.class})</span></span>
                                               <span className="text-crimson font-bold flex-shrink-0">{s.count}x sejak {s.first.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                           </div>
                                           {pending ? (
                                               isAdmin ? (
                                                   <div className="bg-white/70 rounded-lg p-2 space-y-1">
                                                       <div className="text-[10px] text-slate-500">Diajukan oleh <span className="font-semibold">{pending.diajukanOleh}</span>: "{pending.catatan}"</div>
                                                       <button onClick={() => approveTL(pending)} className="text-[10px] font-bold text-white bg-crimson px-2.5 py-1 rounded-lg">Setujui & Hapus dari Peringatan</button>
                                                   </div>
                                               ) : (
                                                   <div className="text-[10px] text-amber-600 font-semibold">⏳ Menunggu persetujuan admin</div>
                                               )
                                           ) : (
                                               <button onClick={() => { setTindakLanjutTarget(s); setCatatanInput(''); }} className="text-[10px] font-bold text-crimson bg-white px-2.5 py-1 rounded-lg border border-crimson/30">Tandai Sudah Ditindaklanjuti</button>
                                           )}
                                       </div>
                                   );
                               })}
                           </div>
                       </div>
                   )}

                   {/* Riwayat Tindak Lanjut — status 'selesai' TETAP tersimpan & terlihat,
                       cuma tidak lagi memicu banner di atas (lihat resolvedMap). */}
                   {tindakLanjutList.length > 0 && (
                       <div className="bg-white border border-slate-200 rounded-2xl p-4">
                           <button onClick={() => setShowRiwayatTL(v => !v)} className="w-full flex items-center justify-between gap-2 text-left">
                               <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Riwayat Tindak Lanjut ({tindakLanjutList.length})</h3>
                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d={showRiwayatTL ? 'M4.5 15.75l7.5-7.5 7.5 7.5' : 'M19.5 8.25l-7.5 7.5-7.5-7.5'} />} className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                           </button>
                           {showRiwayatTL && (
                               <div className="mt-2.5 space-y-2 animate-pop">
                                   {tindakLanjutList.map((t, idx) => (
                                       <div key={idx} className="bg-slate-50 rounded-lg p-2.5 space-y-0.5">
                                           <div className="flex items-center justify-between gap-2">
                                               <span className="text-xs font-semibold text-slate-800 truncate">{t.name} <span className="text-slate-400 font-normal">({t.class})</span></span>
                                               <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${t.status === 'selesai' ? 'bg-sky-dim/15 text-sky-dim' : 'bg-amber-100 text-amber-700'}`}>{t.status === 'selesai' ? 'Selesai' : 'Menunggu'}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-500">"{t.catatan}" — diajukan {t.diajukanOleh}</div>
                                           {t.status === 'selesai' && <div className="text-[10px] text-slate-400">Disetujui {t.disetujuiOleh} • {parseTimestamp(t.tanggalDisetujui).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
                                       </div>
                                   ))}
                               </div>
                           )}
                       </div>
                   )}

                   {tindakLanjutTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Tandai Sudah Ditindaklanjuti</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{tindakLanjutTarget.name}</div>
                                   <div className="text-[10px] text-slate-400 mt-1">Akan diajukan ke Admin untuk disetujui — belum langsung hilang dari peringatan.</div>
                               </div>
                               <textarea value={catatanInput} onChange={(e) => setCatatanInput(e.target.value)} placeholder="Catatan tindak lanjut (mis. sudah dipanggil orang tua, diberi peringatan, dsb.)" rows={3} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <button onClick={submitTindakLanjut} disabled={!catatanInput.trim()} className="w-full bg-sky hover:bg-sky-light disabled:opacity-40 text-white py-2.5 rounded-xl text-xs font-bold transition">Ajukan ke Admin</button>
                               <button onClick={() => { setTindakLanjutTarget(null); setCatatanInput(''); }} className="w-full bg-transparent border-2 border-slate-300 text-slate-500 py-2.5 rounded-2xl font-bold text-xs">Batal</button>
                           </div>
                       </div>
                   )}

                   {/* ⑤ Aktivitas Hari Ini */}
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Aktivitas Hari Ini</h2>

                   {loading ? (
                       <div className="text-center py-10 text-xs text-slate-400">Memuat data...</div>
                   ) : combinedFeed.length > 0 ? (
                       <div className="space-y-2.5">
                           {combinedFeed.map((item, idx) => <FeedItem key={idx} item={item} />)}
                       </div>
                   ) : (
                       <EmptyState emoji="🏆" text="Belum ada aktivitas tercatat hari ini." />
                   )}

                   <p className="text-[11px] text-slate-400 text-center pt-1">Untuk data kemarin, minggu, atau bulan lalu, buka menu <span className="font-semibold text-slate-500">Riwayat</span>.</p>

                   {/* ⑥ Ringkasan kelas perwalian */}
                   {kelasPerwalian && (
                       <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                           <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Kelas Perwalian {waliKelas} — Minggu Ini</h3>
                           {kelasPerwalian.jumlahSiswaBermasalah > 0 ? (
                               <div className="space-y-1.5">
                                   <div className="text-xs text-slate-600">{kelasPerwalian.jumlahSiswaBermasalah} siswa perlu perhatian minggu ini:</div>
                                   {kelasPerwalian.daftarSiswa.slice(0, 5).map((s, idx) => (
                                       <div key={idx} className="text-[11px] text-slate-700 font-medium">{s.name}</div>
                                   ))}
                                   {kelasPerwalian.daftarSiswa.length > 5 && <p className="text-[10px] text-slate-500">+{kelasPerwalian.daftarSiswa.length - 5} siswa lainnya</p>}
                               </div>
                           ) : (
                               <div className="text-xs text-slate-400">Belum ada siswa bermasalah minggu ini. 🎉</div>
                           )}
                       </div>
                   )}
               </div>
           );
       }

       const EDIT_WINDOW_MS = 5 * 60 * 1000; // 5 menit — sinkron dengan aturan server

       function LogTab({ allLogs, pelanggaranList, suratList, initialCategory, canManage, isAdmin, isBk, currentUserName, onEditEntry, onDeleteEntry }) {
           const [category, setCategory] = useState(initialCategory || 'terlambat');
           const [period, setPeriod] = useState('semua');
           const [customDate, setCustomDate] = useState('');
           const [filterClass, setFilterClass] = useState('');
           const [filterSub, setFilterSub] = useState('');
           const [search, setSearch] = useState('');
           const [expandedStudent, setExpandedStudent] = useState(null);
           const [showFilters, setShowFilters] = useState(false);
           // Default sekarang Kelas -> Nama A-Z (Roadmap Lanjutan SIGAP Fase 3:
           // "urut berdasarkan kelas, di dalam kelas urut alfabet") — guru piket
           // paling sering cari "kelas X siapa saja", bukan "apa yang baru saja
           // terjadi". Urutan waktu tetap ada sebagai opsi kalau mau lihat
           // aktivitas terbaru.
           const [sortMode, setSortMode] = useState('nama');

           // ---- State untuk Edit/Hapus 1 catatan ----
           const [manageTarget, setManageTarget] = useState(null);
           const [editType, setEditType] = useState('');
           const [editJenisPelanggaran, setEditJenisPelanggaran] = useState('');
           const [editSanksi, setEditSanksi] = useState('');
           const [editCatatan, setEditCatatan] = useState('');
           const [editJenisSurat, setEditJenisSurat] = useState('');
           const [editKeterangan, setEditKeterangan] = useState('');
           const [editFotoPreview, setEditFotoPreview] = useState(null);
           const [editFotoBase64, setEditFotoBase64] = useState(null);
           const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);
           const [manageMsg, setManageMsg] = useState('');
           const [manageMsgTone, setManageMsgTone] = useState('sky');
           const [manageLoading, setManageLoading] = useState(false);
           const [restrictedMsg, setRestrictedMsg] = useState('');
           const editFileInputRef = useRef(null);

           // Ikon edit/hapus tetap ditampilkan (bukan disembunyikan total) walau
           // dibatasi, supaya guru tahu fiturnya ADA tapi lagi tidak bisa dipakai
           // — tanpa ini, ikon abu-abu yang tidak merespons tap terlihat seperti
           // rusak, bukan sengaja dibatasi (title/tooltip tidak muncul di HP
           // lewat tap).
           const showRestrictedMsg = (text) => {
               setRestrictedMsg(text);
               setTimeout(() => setRestrictedMsg(''), 3500);
           };

           const periods = [
               { key: 'semua', label: 'Semua' },
               { key: 'hari-ini', label: 'Hari Ini' },
               { key: 'kemarin', label: 'Kemarin' },
               { key: 'minggu-ini', label: 'Minggu Ini' },
               { key: 'bulan-ini', label: 'Bulan Ini' },
           ];

           const categories = [
               { key: 'terlambat', label: 'Terlambat', data: allLogs, subField: 'type', subLabel: 'Alasan' },
               { key: 'pelanggaran', label: 'Pelanggaran', data: pelanggaranList, subField: 'jenis_pelanggaran', subLabel: 'Jenis' },
               { key: 'surat', label: 'Surat', data: suratList, subField: 'jenis', subLabel: 'Jenis' },
           ];
           const activeCat = categories.find(c => c.key === category);
           const sourceData = activeCat.data;

           // Ganti kategori = reset filter, supaya tidak ada filter nyangkut dari kategori sebelumnya
           useEffect(() => { setFilterClass(''); setFilterSub(''); setPeriod('semua'); setCustomDate(''); setExpandedStudent(null); }, [category]);

           const classes = useMemo(() => [...new Set(sourceData.map(l => l.class))].sort(), [sourceData]);
           const subOptions = useMemo(() => [...new Set(sourceData.map(l => l[activeCat.subField]))].filter(Boolean).sort(), [sourceData, category]);

           const passesPeriod = (dt) => {
               const now = new Date();
               if (period === 'hari-ini') return isSameDay(dt, now);
               if (period === 'kemarin') {
                   const y = new Date(now); y.setDate(now.getDate() - 1);
                   return isSameDay(dt, y);
               }
               if (period === 'minggu-ini') return dt >= startOfWeek(now) && dt <= now;
               if (period === 'bulan-ini') return dt >= startOfMonth(now) && dt <= now;
               if (period === 'custom' && customDate) return isSameDay(dt, new Date(customDate));
               return true;
           };

           const filtered = sourceData.filter(l => {
               const dt = parseTimestamp(l.timestamp);
               if (!passesPeriod(dt)) return false;
               if (filterClass && l.class !== filterClass) return false;
               if (filterSub && l[activeCat.subField] !== filterSub) return false;
               if (search.trim() && !l.name.toLowerCase().includes(search.toLowerCase()) && !(l.nisn && l.nisn.toString().includes(search.trim()))) return false;
               return true;
           }).sort((a, b) => {
               if (sortMode === 'nama') {
                   const kelasCompare = String(a.class).localeCompare(String(b.class));
                   if (kelasCompare !== 0) return kelasCompare;
                   return String(a.name).localeCompare(String(b.name));
               }
               return parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp);
           });

           const activeFilterCount = [filterClass, filterSub, period !== 'semua' ? 'x' : ''].filter(Boolean).length;

           // Penanda visual saja — aturan SEBENARNYA ditegakkan di server. Admin:
           // bebas. BK/Kesiswaan: siapa pun boleh, asal masih dalam 5 menit.
           // Guru biasa: sama-sama 5 menit, TAPI cuma boleh catatan yang dia
           // sendiri tulis (logged_by cocok) — supaya tidak ada yang bisa
           // utak-atik catatan guru lain.
           const restrictReason = (item) => {
               if (isAdmin) return null;
               if ((Date.now() - parseTimestamp(item.timestamp).getTime()) > EDIT_WINDOW_MS) {
                   return 'Sudah lewat 5 menit sejak dicatat — tidak bisa diubah/hapus lagi.';
               }
               if (!isBk && item.logged_by !== currentUserName) {
                   return 'Cuma bisa mengubah/menghapus catatan yang Anda tulis sendiri.';
               }
               return null;
           };
           const canEditNow = (item) => !restrictReason(item);

           const showManageMsg = (ok, text) => { setManageMsgTone(ok ? 'sky' : 'crimson'); setManageMsg(text); };

           const openManage = (item) => {
               setManageMsg('');
               setManageTarget(item);
               if (category === 'terlambat') {
                   setEditType(item.type || '');
               } else if (category === 'pelanggaran') {
                   setEditJenisPelanggaran(item.jenis_pelanggaran || '');
                   setEditSanksi(item.sanksi || '');
                   setEditCatatan(item.catatan || '');
               } else if (category === 'surat') {
                   setEditJenisSurat(item.jenis || '');
                   setEditKeterangan(item.keterangan || '');
                   setEditFotoPreview(item.foto_url || null);
                   setEditFotoBase64(null);
               }
           };

           const closeManage = () => {
               setManageTarget(null);
               setEditFotoPreview(null);
               setEditFotoBase64(null);
               setManageMsg('');
           };

           // Kompres foto (maks lebar 800px, kualitas 60%) — sama seperti di form Catat Surat
           const handleEditFotoChange = (e) => {
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
                       setEditFotoPreview(compressed);
                       setEditFotoBase64(compressed.split(',')[1]);
                   };
                   img.src = ev.target.result;
               };
               reader.readAsDataURL(file);
           };

           const submitEdit = () => {
               if (!manageTarget) return;
               setManageLoading(true);
               const payload = { category, nisn: manageTarget.nisn, name: manageTarget.name, timestamp: manageTarget.timestamp };
               if (category === 'terlambat') {
                   payload.type = editType;
               } else if (category === 'pelanggaran') {
                   payload.jenis_pelanggaran = editJenisPelanggaran;
                   payload.sanksi = editSanksi;
                   payload.catatan = editCatatan;
               } else if (category === 'surat') {
                   payload.jenis = editJenisSurat;
                   payload.keterangan = editKeterangan;
                   if (editFotoBase64) payload.fotoBase64 = editFotoBase64;
               }
               onEditEntry(payload, (ok, text) => {
                   setManageLoading(false);
                   showManageMsg(ok, text);
                   if (ok) setTimeout(closeManage, 900);
               });
           };

           const submitDelete = () => {
               if (!confirmDeleteTarget) return;
               setManageLoading(true);
               const payload = { category, nisn: confirmDeleteTarget.nisn, name: confirmDeleteTarget.name, timestamp: confirmDeleteTarget.timestamp };
               onDeleteEntry(payload, (ok, text) => {
                   setManageLoading(false);
                   if (ok) {
                       setConfirmDeleteTarget(null);
                       closeManage();
                   } else {
                       showManageMsg(ok, text);
                   }
               });
           };

           return (
               <div className="space-y-4 animate-rise">
                   <div className="grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       {categories.map(c => (
                           <button key={c.key} onClick={() => setCategory(c.key)} className={`py-2 rounded-xl text-xs font-bold transition ${category === c.key ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>{c.label}</button>
                       ))}
                   </div>

                   {/* Periode aktif SELALU kelihatan di sini, termasuk tanggal spesifik dari
                       drawer Filter — supaya tidak ada state filter yang "tersembunyi". */}
                   <div className="flex gap-1.5 overflow-x-auto pb-1">
                       {periods.map(p => (
                           <button key={p.key} onClick={() => { setPeriod(p.key); setCustomDate(''); }} className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${period === p.key ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                               {p.label}
                           </button>
                       ))}
                       {period === 'custom' && customDate && (
                           <span className="px-3.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-navy text-white flex items-center gap-1.5">
                               {new Date(customDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                               <button onClick={() => { setPeriod('semua'); setCustomDate(''); }} className="text-white/70 hover:text-white">×</button>
                           </span>
                       )}
                   </div>

                   <div className="flex gap-2">
                       <div className="relative flex-1">
                           <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama atau NISN siswa..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-sky" />
                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />} className="h-4 w-4 absolute right-4 top-3 text-slate-400" />
                       </div>
                       <button onClick={() => setShowFilters(v => !v)} className={`px-3.5 rounded-2xl border flex items-center gap-1 text-xs font-semibold transition ${(filterClass || filterSub) ? 'bg-sky-dim/25 border-sky-dim text-sky-dim' : 'bg-white border-slate-200 text-slate-500'}`}>
                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M6 4.5h12M6 4.5a1.5 1.5 0 00-1.5 1.5v.879a1.5 1.5 0 00.44 1.06l4.12 4.122a1.5 1.5 0 01.44 1.06v4.502a1.5 1.5 0 00.732 1.286l2.25 1.353a.75.75 0 001.128-.647V13.12a1.5 1.5 0 01.44-1.06l4.12-4.122a1.5 1.5 0 00.44-1.06V6A1.5 1.5 0 0018 4.5" />} className="h-4 w-4" />
                           {(filterClass || filterSub) && <span>•</span>}
                       </button>
                   </div>

                   {showFilters && (
                       <Card className="space-y-3 animate-pop">
                           {/* Kelas & Jenis berdampingan (bukan ditumpuk) — drawer lebih
                               pendek, lebih cepat dipindai (Roadmap Lanjutan SIGAP Fase 3:
                               "filter lebih sederhana"). */}
                           <div className="grid grid-cols-2 gap-2">
                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Kelas</label>
                                   <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       <option value="">Semua Kelas</option>
                                       {classes.map(c => <option key={c} value={c}>{c}</option>)}
                                   </select>
                               </div>
                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">{activeCat.subLabel}</label>
                                   <select value={filterSub} onChange={(e) => setFilterSub(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       <option value="">Semua {activeCat.subLabel}</option>
                                       {subOptions.map(r => <option key={r} value={r}>{r}</option>)}
                                   </select>
                               </div>
                           </div>
                           <div>
                               <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Tanggal Spesifik</label>
                               <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setPeriod('custom'); }} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                           </div>
                           <div className="pt-1 border-t border-slate-100">
                               <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Urutkan Hasil</label>
                               <div className="flex gap-1.5 bg-slate-100 rounded-xl p-1 w-fit">
                                   <button onClick={() => setSortMode('nama')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${sortMode === 'nama' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Kelas &amp; Nama A-Z</button>
                                   <button onClick={() => setSortMode('waktu')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${sortMode === 'waktu' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Terbaru</button>
                               </div>
                           </div>
                           {(filterClass || filterSub || period !== 'semua' || sortMode !== 'nama') && (
                               <button onClick={() => { setFilterClass(''); setFilterSub(''); setPeriod('semua'); setCustomDate(''); setSortMode('nama'); }} className="text-[10px] text-crimson font-semibold">Reset semua</button>
                           )}
                       </Card>
                   )}

                   {restrictedMsg && <div className="text-[11px] text-amber-700 font-medium text-center bg-amber-50 border border-amber-200 py-2 px-3 rounded-lg">{restrictedMsg}</div>}

                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{filtered.length} catatan {activeCat.label.toLowerCase()}</h2>

                   {filtered.length > 0 ? (
                       <div className="space-y-2.5">
                           {filtered.map((item, idx) => {
                               const dt = parseTimestamp(item.timestamp);
                               const subValue = item[activeCat.subField];
                               const editable = canManage && canEditNow(item);
                               return (
                                   <div key={idx}>
                                       <RowCard onClick={() => setExpandedStudent(expandedStudent === item.nisn ? null : item.nisn)} className="space-y-1">
                                           <div className="flex items-center justify-between">
                                               <div className="font-semibold text-sm text-slate-900">{item.name}</div>
                                               <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">{subValue}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-400 flex justify-between items-center">
                                               <span>{item.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                               <span className="flex items-center gap-2">
                                                   <span>{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                                   {canManage && (
                                                       <span className="flex items-center gap-0.5">
                                                           <button
                                                               onClick={(e) => { e.stopPropagation(); if (editable) openManage(item); else showRestrictedMsg(restrictReason(item)); }}
                                                               title={editable ? 'Edit catatan' : restrictReason(item)}
                                                               className={`p-1 rounded-lg transition ${editable ? 'text-sky-dim hover:bg-sky-dim/10' : 'text-slate-300'}`}
                                                           >
                                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />} className="h-3.5 w-3.5" />
                                                           </button>
                                                           <button
                                                               onClick={(e) => { e.stopPropagation(); if (editable) { setManageMsg(''); setConfirmDeleteTarget(item); } else showRestrictedMsg(restrictReason(item)); }}
                                                               title={editable ? 'Hapus catatan' : restrictReason(item)}
                                                               className={`p-1 rounded-lg transition ${editable ? 'text-crimson hover:bg-crimson/10' : 'text-slate-300'}`}
                                                           >
                                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />} className="h-3.5 w-3.5" />
                                                           </button>
                                                       </span>
                                                   )}
                                               </span>
                                           </div>
                                           {item.logged_by && <div className="text-[10px] text-slate-400">Dicatat oleh: {item.logged_by}</div>}
                                           {category === 'pelanggaran' && item.sanksi && (
                                               <div className="text-[10px] text-slate-500">Sanksi: {item.sanksi}</div>
                                           )}
                                           {category === 'surat' && item.foto_url && (
                                               <a href={item.foto_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-sky-dim underline inline-block">Lihat foto surat</a>
                                           )}
                                       </RowCard>
                                       {expandedStudent === item.nisn && (
                                           <div className="ml-3 mt-1.5 mb-1 pl-3 border-l-2 border-sky-dim space-y-1.5 animate-pop">
                                               <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Riwayat {activeCat.label} {item.name}</div>
                                               {sourceData.filter(l => l.nisn === item.nisn).map((h, i) => {
                                                   const hDt = parseTimestamp(h.timestamp);
                                                   return (
                                                       <div key={i} className="text-[11px] text-slate-500 flex justify-between bg-slate-50 rounded-lg px-2.5 py-1.5">
                                                           <span>{h[activeCat.subField]}</span>
                                                           <span>{hDt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                                       </div>
                                                   );
                                               })}
                                           </div>
                                       )}
                                   </div>
                               );
                           })}
                       </div>
                   ) : (
                       <EmptyState emoji="🔍" text={`Tidak ada catatan ${activeCat.label.toLowerCase()} yang cocok.`} />
                   )}

                   {manageTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                               <div className="text-center">
                                   <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-2 sm:hidden"></div>
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Edit Catatan {activeCat.label}</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{manageTarget.name}</div>
                                   <div className="text-xs text-slate-500">{manageTarget.class}</div>
                               </div>

                               {!isAdmin && (Date.now() - parseTimestamp(manageTarget.timestamp).getTime()) > EDIT_WINDOW_MS && (
                                   <div className="text-[10px] text-crimson bg-crimson/10 border border-crimson/30 rounded-lg px-3 py-2 text-center">Sudah lewat 5 menit sejak dicatat — server kemungkinan menolak perubahan ini (hanya admin yang bisa).</div>
                               )}

                               {category === 'terlambat' && (
                                   <div>
                                       <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Alasan Terlambat</label>
                                       <input type="text" value={editType} onChange={(e) => setEditType(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                   </div>
                               )}

                               {category === 'pelanggaran' && (
                                   <div className="space-y-3">
                                       <div>
                                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Jenis Pelanggaran</label>
                                           <input type="text" value={editJenisPelanggaran} onChange={(e) => setEditJenisPelanggaran(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                       </div>
                                       <div>
                                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Sanksi</label>
                                           <input type="text" value={editSanksi} onChange={(e) => setEditSanksi(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                       </div>
                                       <div>
                                           <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Catatan</label>
                                           <input type="text" value={editCatatan} onChange={(e) => setEditCatatan(e.target.value)} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                       </div>
                                   </div>
                               )}

                               {category === 'surat' && (
                                   <div className="space-y-3">
                                       <div className="grid grid-cols-3 gap-2">
                                           {['Sakit', 'Izin', 'Lainnya'].map(j => (
                                               <button key={j} onClick={() => setEditJenisSurat(j)} className={`py-2.5 rounded-xl text-xs font-bold ${editJenisSurat === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                           ))}
                                       </div>
                                       <input type="text" value={editKeterangan} onChange={(e) => setEditKeterangan(e.target.value)} placeholder="Keterangan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                                       <div>
                                           <input ref={editFileInputRef} type="file" accept="image/*" capture="environment" onChange={handleEditFotoChange} className="hidden" />
                                           {editFotoPreview ? (
                                               <div className="relative">
                                                   <img src={editFotoPreview} alt="Preview surat" className="w-full h-32 object-cover rounded-xl border border-slate-300" />
                                                   <button onClick={() => { setEditFotoPreview(null); setEditFotoBase64(null); }} className="absolute top-2 right-2 bg-crimson text-white text-[10px] font-bold px-2 py-1 rounded-lg">Hapus Foto</button>
                                               </div>
                                           ) : (
                                               <button onClick={() => editFileInputRef.current && editFileInputRef.current.click()} className="w-full bg-slate-100 border-2 border-dashed border-slate-300 text-slate-500 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                                                   <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />} className="h-4 w-4" />
                                                   Ganti Foto Surat
                                               </button>
                                           )}
                                       </div>
                                   </div>
                               )}

                               {manageMsg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${manageMsgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{manageMsg}</div>}

                               <Button onClick={submitEdit} disabled={manageLoading} className="w-full">
                                   {manageLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
                               </Button>
                               <Button onClick={closeManage} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {confirmDeleteTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-crimson uppercase tracking-widest font-bold">Hapus Catatan {activeCat.label}?</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{confirmDeleteTarget.name}</div>
                                   <div className="text-xs text-slate-500">{confirmDeleteTarget.class}</div>
                                   <p className="text-[11px] text-slate-400 mt-2">Tindakan ini tidak bisa dibatalkan.</p>
                               </div>
                               {manageMsg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${manageMsgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{manageMsg}</div>}
                               <Button onClick={submitDelete} disabled={manageLoading} variant="danger" className="w-full">
                                   {manageLoading ? 'Menghapus...' : 'Ya, Hapus'}
                               </Button>
                               <Button onClick={() => { setConfirmDeleteTarget(null); setManageMsg(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }
