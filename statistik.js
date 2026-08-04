// ===== statistik.js =====
// Tab Statistik: tren per kategori & periode, top kelas/jenis, ekspor.

       function StatsTab({ allLogs, pelanggaranList, suratList, canExport, canViewRanking }) {
           const [category, setCategory] = useState('terlambat');
           const [period, setPeriod] = useState('mingguan');
           const [freqWindow, setFreqWindow] = useState('1minggu');
           // Mode Ranking (urut jumlah kasus terbanyak) khusus BK/Kesiswaan & Admin.
           // Guru cuma dapat mode Per Kelas (urut A-Z) — lihat config.js canViewRanking
           // untuk alasan pembatasannya. (Blueprint SIGAP v2, section VII & VIII)
           const [kelasMode, setKelasMode] = useState(canViewRanking ? 'ranking' : 'perkelas');

           const categories = [
               { key: 'terlambat', label: 'Terlambat', data: allLogs, subField: 'type', subLabel: 'Alasan' },
               { key: 'pelanggaran', label: 'Pelanggaran', data: pelanggaranList, subField: 'jenis_pelanggaran', subLabel: 'Jenis' },
               { key: 'surat', label: 'Surat', data: suratList, subField: 'jenis', subLabel: 'Jenis' },
           ];
           const activeCat = categories.find(c => c.key === category);
           const sourceData = activeCat.data;

           const periods = [
               { key: 'mingguan', label: 'Mingguan' },
               { key: 'bulanan', label: 'Bulanan' },
               { key: 'semester', label: 'Semester' },
               { key: 'tahunan', label: 'Tahunan' },
           ];
           const activePeriod = periods.find(p => p.key === period);
           const series = buildPeriodSeries(period, sourceData);

           // Daftar siswa sering terlambat (khusus kategori Terlambat) — ambang tetap 3x,
           // jendela waktu bisa dipilih (1/2/3 minggu, atau sebulan)
           const freqWindows = [
               { key: '1minggu', label: '1 Minggu', days: 7 },
               { key: '2minggu', label: '2 Minggu', days: 14 },
               { key: '3minggu', label: '3 Minggu', days: 21 },
               { key: 'sebulan', label: 'Sebulan', days: 30 },
           ];
           const activeFreqWindow = freqWindows.find(w => w.key === freqWindow);
           const freqWindowEnd = new Date();
           const freqWindowStart = new Date();
           freqWindowStart.setDate(freqWindowEnd.getDate() - activeFreqWindow.days);
           const frequentStudents = category === 'terlambat'
               ? groupLateByStudent(allLogs, freqWindowStart, freqWindowEnd).filter(s => s.count >= 3)
               : [];

           const periodData = sourceData.filter(l => {
               const now = new Date();
               if (period === 'mingguan') {
                   return inRange(l.timestamp, startOfWeek(now), now);
               }
               if (period === 'bulanan') {
                   return inRange(l.timestamp, startOfMonth(now), now);
               }
               if (period === 'semester') {
                   const semInfo = getSemesterInfo(now);
                   const s = new Date(semInfo.year, semInfo.months[0], 1);
                   return inRange(l.timestamp, s, now);
               }
               const s = new Date(now.getFullYear(), 0, 1);
               return inRange(l.timestamp, s, now);
           });

           return (
               <div className="space-y-5 animate-rise">
                   <div className="grid grid-cols-3 gap-2 bg-white border border-slate-200 rounded-2xl p-1.5">
                       {categories.map(c => (
                           <button key={c.key} onClick={() => setCategory(c.key)} className={`py-2 rounded-xl text-xs font-bold transition ${category === c.key ? 'bg-sky text-white shadow-md' : 'text-slate-500'}`}>{c.label}</button>
                       ))}
                   </div>

                   <div className="flex gap-1.5 overflow-x-auto pb-1">
                       {periods.map(p => (
                           <button key={p.key} onClick={() => setPeriod(p.key)} className={`px-3.5 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${period === p.key ? 'bg-sky text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200'}`}>
                               {p.label}
                           </button>
                       ))}
                   </div>

                   <BarChart data={series} title={`Tren ${activeCat.label} — ${activePeriod.label}`} />

                   <div className="grid grid-cols-1 gap-3">
                       <StatCard value={periodData.length} label={`Total ${activeCat.label} (${activePeriod.label})`} accent />
                   </div>

                   {/* Rekap per Kelas & Siswa Sering Terlambat: cuma admin/BK/Kesiswaan
                       (canViewRanking) — TANPA pengecualian wali kelas. Guru cuma dapat
                       tren (BarChart di atas) & alasan terbanyak (TopList di bawah).
                       Wali kelas yang mau lihat detail kelasnya sendiri, arahnya ke
                       menu Rekap Kelas, bukan di sini. */}
                   {canViewRanking && (
                       <Card>
                           <div className="flex items-center justify-between mb-3">
                               <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rekap per Kelas (Periode Ini)</h3>
                               <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                                   <button onClick={() => setKelasMode('ranking')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${kelasMode === 'ranking' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Ranking</button>
                                   <button onClick={() => setKelasMode('perkelas')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${kelasMode === 'perkelas' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>A-Z</button>
                               </div>
                           </div>
                           {(() => {
                               // Ranking: urut jumlah kasus terbanyak (topN sudah begitu).
                               // Per Kelas: urut nama kelas A-Z — cara guru mencari data
                               // ("kelas berapa dulu, baru siapa"), bukan bandingkan kelas.
                               const perKelas = kelasMode === 'ranking'
                                   ? topN(periodData, l => l.class, 999)
                                   : topN(periodData, l => l.class, 999).sort((a, b) => String(a.label).localeCompare(String(b.label)));
                               return perKelas.length > 0 ? (
                                   <div className="space-y-2">
                                       {perKelas.map((k, i) => (
                                           <div key={i} className="flex items-center justify-between">
                                               <span className="text-xs text-slate-700 font-medium">{k.label}</span>
                                               <span className="text-[11px] text-slate-500 font-semibold">{k.count} {activeCat.key === 'terlambat' ? 'siswa' : 'kali'}</span>
                                           </div>
                                       ))}
                                   </div>
                               ) : (
                                   <div className="text-xs text-slate-400 py-2 text-center">Belum ada data di periode ini.</div>
                               );
                           })()}
                       </Card>
                   )}

                   <TopList title={`${activeCat.subLabel} Terbanyak (Periode Ini)`} items={topN(periodData, l => l[activeCat.subField], 5)} unit="kali" />

                   {canViewRanking && category === 'terlambat' && (
                       <Card className="space-y-3">
                           <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Siswa Sering Terlambat (≥3x)</h3>
                           <div className="flex gap-1.5 overflow-x-auto pb-1">
                               {freqWindows.map(w => (
                                   <button key={w.key} onClick={() => setFreqWindow(w.key)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold whitespace-nowrap transition ${freqWindow === w.key ? 'bg-navy text-white' : 'bg-slate-100 text-slate-500'}`}>
                                       {w.label}
                                   </button>
                               ))}
                           </div>
                           {frequentStudents.length > 0 ? (
                               <div className="space-y-2">
                                   {frequentStudents.map((s, idx) => (
                                       <div key={idx} className="flex items-center justify-between">
                                           <span className="text-xs text-slate-700 font-medium truncate">{s.name} <span className="text-slate-400 font-normal">({s.class})</span></span>
                                           <span className="text-[11px] text-crimson font-bold flex-shrink-0 ml-2">{s.count}x</span>
                                       </div>
                                   ))}
                               </div>
                           ) : (
                               <div className="text-xs text-slate-400 py-1 text-center">Tidak ada siswa dengan ≥3x terlambat di periode ini.</div>
                           )}
                       </Card>
                   )}

                   {canExport && (
                       <Card tone="sky" className="space-y-3">
                           <h3 className="text-xs font-display font-bold text-sky-dim flex items-center gap-2">
                               <Icon path={<path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />} filled className="h-4 w-4" />
                               Data Lengkap (Admin)
                           </h3>
                           <p className="text-[11px] text-slate-500 leading-relaxed">Seluruh data tersimpan di Google Sheets — buka langsung kalau perlu olah lebih lanjut (unduh, cetak, dsb).</p>
                           <a href="https://docs.google.com/spreadsheets" target="_blank" className="block w-full text-center bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-[11px] font-bold transition">
                               Buka Google Spreadsheet
                           </a>
                       </Card>
                   )}
               </div>
           );
       }

