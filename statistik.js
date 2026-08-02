// ===== statistik.js =====
// Tab Statistik: tren per kategori & periode, top kelas/jenis, ekspor.

       function StatsTab({ allLogs, pelanggaranList, suratList, canExport }) {
           const [category, setCategory] = useState('terlambat');
           const [period, setPeriod] = useState('mingguan');

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

                   <TopList title="Kelas Terbanyak (Periode Ini)" items={topN(periodData, l => l.class, 5)} unit="siswa" />
                   <TopList title={`${activeCat.subLabel} Terbanyak (Periode Ini)`} items={topN(periodData, l => l[activeCat.subField], 5)} unit="kali" />

                   {canExport && (
                       <div className="bg-sky-dim/10 border border-sky-dim/40 p-4 rounded-2xl space-y-3">
                           <h3 className="text-xs font-display font-bold text-sky-dim flex items-center gap-2">
                               <Icon path={<path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />} filled className="h-4 w-4" />
                               Ekspor Data (Admin)
                           </h3>
                           <p className="text-[11px] text-slate-500 leading-relaxed">Seluruh log tersimpan di Google Sheets. Unduh sebagai CSV/Excel, cetak sebagai PDF, atau buka rekap lengkap di Spreadsheet.</p>
                           <div className="grid grid-cols-2 gap-2">
                               <button onClick={() => exportCSV(sourceData, activeCat.label)} className="bg-sky hover:bg-sky-light text-white py-2.5 rounded-xl text-[11px] font-bold transition">Unduh CSV</button>
                               <button onClick={() => window.print()} className="bg-slate-100 border border-slate-300 hover:bg-slate-200 text-slate-800 py-2.5 rounded-xl text-[11px] font-bold transition">Cetak / PDF</button>
                           </div>
                           <a href="https://docs.google.com/spreadsheets" target="_blank" className="block w-full text-center bg-transparent border-2 border-sky-dim text-sky-dim py-2.5 rounded-xl text-[11px] font-bold transition">
                               Buka Google Spreadsheet
                           </a>
                       </div>
                   )}

                   <div className="print-report">
                       <h2 style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>Laporan {activeCat.label} — SIGAP SMAN 2 Tarakan</h2>
                       <p style={{ fontSize: '11px', marginBottom: '12px' }}>Dicetak: {new Date().toLocaleString('id-ID')}</p>
                       <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                           <thead><tr>{['Nama', 'Kelas', activeCat.subLabel, 'Tanggal', 'Waktu'].map(h => <th key={h} style={{ border: '1px solid #999', padding: '4px', textAlign: 'left' }}>{h}</th>)}</tr></thead>
                           <tbody>
                               {sourceData.map((l, i) => {
                                   const dt = parseTimestamp(l.timestamp);
                                   return (
                                       <tr key={i}>
                                           <td style={{ border: '1px solid #999', padding: '4px' }}>{l.name}</td>
                                           <td style={{ border: '1px solid #999', padding: '4px' }}>{l.class}</td>
                                           <td style={{ border: '1px solid #999', padding: '4px' }}>{l[activeCat.subField]}</td>
                                           <td style={{ border: '1px solid #999', padding: '4px' }}>{dt.toLocaleDateString('id-ID')}</td>
                                           <td style={{ border: '1px solid #999', padding: '4px' }}>{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</td>
                                       </tr>
                                   );
                               })}
                           </tbody>
                       </table>
                   </div>
               </div>
           );
       }

