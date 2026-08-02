// ===== beranda-riwayat.js =====
// Tab Beranda (ringkasan hari ini) dan Riwayat (pencarian & filter
// lintas kategori: Terlambat/Pelanggaran/Surat).

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

       function DashboardTab({ allLogs, pelanggaranList, suratList, onRefresh, loading }) {
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

           return (
               <div className="space-y-5 animate-rise">
                   <div className="flex justify-between items-end">
                       <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Ringkasan Hari Ini</h2>
                       <button onClick={onRefresh} className="text-[10px] text-sky-dim font-semibold bg-sky-dim/10 px-2 py-1 rounded-md">Refresh</button>
                   </div>

                   <div className="grid grid-cols-3 gap-2.5">
                       <SummaryCard value={todayLate.length} label="Terlambat" tone="crimson" />
                       <SummaryCard value={todaySurat.length} label="Surat" tone="sky" />
                       <SummaryCard value={todayPelanggaran.length} label="Pelanggaran" tone="amber" />
                   </div>

                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Aktivitas Hari Ini</h2>

                   {loading ? (
                       <SkeletonList count={4} />
                   ) : combinedFeed.length > 0 ? (
                       <div className="space-y-2.5">
                           {combinedFeed.map((item, idx) => <FeedItem key={idx} item={item} />)}
                       </div>
                   ) : (
                       <EmptyState emoji="🏆" text="Belum ada aktivitas tercatat hari ini." />
                   )}

                   <p className="text-[11px] text-slate-400 text-center pt-1">Untuk data kemarin, minggu, atau bulan lalu, buka menu <span className="font-semibold text-slate-500">Riwayat</span>.</p>
               </div>
           );
       }

       function LogTab({ allLogs, pelanggaranList, suratList, initialCategory }) {
           const [category, setCategory] = useState(initialCategory || 'terlambat');
           const [period, setPeriod] = useState('semua');
           const [customDate, setCustomDate] = useState('');
           const [filterClass, setFilterClass] = useState('');
           const [filterSub, setFilterSub] = useState('');
           const [search, setSearch] = useState('');
           const [expandedStudent, setExpandedStudent] = useState(null);
           const [showFilters, setShowFilters] = useState(false);

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
           }).sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));

           const activeFilterCount = [filterClass, filterSub, period !== 'semua' ? 'x' : ''].filter(Boolean).length;

           return (
               <div className="space-y-4 animate-rise">
                   <div className="grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       {categories.map(c => (
                           <button key={c.key} onClick={() => setCategory(c.key)} className={`py-2 rounded-xl text-xs font-bold transition ${category === c.key ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>{c.label}</button>
                       ))}
                   </div>

                   <div className="flex gap-1.5 overflow-x-auto pb-1">
                       {periods.map(p => (
                           <button key={p.key} onClick={() => { setPeriod(p.key); setCustomDate(''); }} className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${period === p.key ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                               {p.label}
                           </button>
                       ))}
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
                       <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 animate-pop">
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
                           <div>
                               <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 block">Tanggal Spesifik</label>
                               <input type="date" value={customDate} onChange={(e) => { setCustomDate(e.target.value); setPeriod('custom'); }} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                           </div>
                           {(filterClass || filterSub || period !== 'semua') && (
                               <button onClick={() => { setFilterClass(''); setFilterSub(''); setPeriod('semua'); setCustomDate(''); }} className="text-[10px] text-crimson font-semibold">Reset semua filter</button>
                           )}
                       </div>
                   )}

                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{filtered.length} catatan {activeCat.label.toLowerCase()}</h2>

                   {filtered.length > 0 ? (
                       <div className="space-y-2.5">
                           {filtered.map((item, idx) => {
                               const dt = parseTimestamp(item.timestamp);
                               const subValue = item[activeCat.subField];
                               return (
                                   <div key={idx}>
                                       <div onClick={() => setExpandedStudent(expandedStudent === item.nisn ? null : item.nisn)} className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-1 cursor-pointer active:bg-slate-100 transition">
                                           <div className="flex items-center justify-between">
                                               <div className="font-semibold text-sm text-slate-900">{item.name}</div>
                                               <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">{subValue}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-400 flex justify-between">
                                               <span>{item.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                               <span>{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                           </div>
                                           {category === 'pelanggaran' && item.sanksi && (
                                               <div className="text-[10px] text-slate-500">Sanksi: {item.sanksi}</div>
                                           )}
                                           {category === 'surat' && item.foto_url && (
                                               <a href={item.foto_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[10px] text-sky-dim underline inline-block">Lihat foto surat</a>
                                           )}
                                       </div>
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
               </div>
           );
       }

