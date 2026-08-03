// ===== rekap-kelas.js =====
// Tab Rekap Kelas: per kelas menampilkan wali kelas, jumlah siswa, jumlah
// Terlambat/Pelanggaran/Surat, dan daftar siswa bermasalah. Dihitung dari
// data yang sudah di-fetch (allLogs/pelanggaranList/suratList/students) —
// tidak ada endpoint agregasi baru di server (Blueprint SIGAP v2, section VI).

       function RekapKelasTab({ students, allLogs, pelanggaranList, suratList, waliKelasMap }) {
           const [period, setPeriod] = useState('minggu-ini');
           const [expandedClass, setExpandedClass] = useState(null);

           const periods = [
               { key: 'hari-ini', label: 'Hari Ini' },
               { key: 'minggu-ini', label: 'Minggu Ini' },
               { key: 'bulan-ini', label: 'Bulan Ini' },
               { key: 'semua', label: 'Semua' },
           ];

           const now = new Date();
           const passesPeriod = (dt) => {
               if (period === 'hari-ini') return isSameDay(dt, now);
               if (period === 'minggu-ini') return dt >= startOfWeek(now) && dt <= now;
               if (period === 'bulan-ini') return dt >= startOfMonth(now) && dt <= now;
               return true;
           };

           const lateInPeriod = allLogs.filter(l => passesPeriod(parseTimestamp(l.timestamp)));
           const pelanggaranInPeriod = pelanggaranList.filter(p => passesPeriod(parseTimestamp(p.timestamp)));
           const suratInPeriod = suratList.filter(s => passesPeriod(parseTimestamp(s.timestamp)));

           const waliByClass = {};
           waliKelasMap.forEach(w => { waliByClass[w.class] = w.waliKelasName; });

           // Urut A-Z (Blueprint section VIII: Statistik Operasional -> Kelas A-Z)
           const classes = [...new Set(students.map(s => s.class))].sort((a, b) => String(a).localeCompare(String(b)));

           const classData = classes.map(kelas => {
               const jumlahSiswa = students.filter(s => s.class === kelas).length;
               const lateKelas = lateInPeriod.filter(l => l.class === kelas);
               const pelanggaranKelas = pelanggaranInPeriod.filter(p => p.class === kelas);
               const suratKelas = suratInPeriod.filter(s => s.class === kelas);

               const bermasalah = {};
               lateKelas.forEach(l => { bermasalah[l.nisn] = bermasalah[l.nisn] || { nisn: l.nisn, name: l.name }; });
               pelanggaranKelas.forEach(p => { bermasalah[p.nisn] = bermasalah[p.nisn] || { nisn: p.nisn, name: p.name }; });
               const daftarSiswa = Object.values(bermasalah).sort((a, b) => String(a.name).localeCompare(String(b.name)));

               return {
                   kelas,
                   waliKelas: waliByClass[kelas] || '',
                   jumlahSiswa,
                   jumlahTerlambat: lateKelas.length,
                   jumlahPelanggaran: pelanggaranKelas.length,
                   jumlahSurat: suratKelas.length,
                   daftarSiswa,
               };
           });

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Rekap Kelas</h2>

                   <div className="flex gap-1.5 overflow-x-auto pb-1">
                       {periods.map(p => (
                           <button key={p.key} onClick={() => setPeriod(p.key)} className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${period === p.key ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                               {p.label}
                           </button>
                       ))}
                   </div>

                   <div className="space-y-2.5">
                       {classData.map((c) => (
                           <div key={c.kelas}>
                               <div onClick={() => setExpandedClass(expandedClass === c.kelas ? null : c.kelas)} className="bg-white border border-slate-200 p-4 rounded-2xl space-y-2 cursor-pointer active:bg-slate-100 transition">
                                   <div className="flex items-center justify-between">
                                       <div>
                                           <div className="font-display font-bold text-sm text-slate-900">{c.kelas}</div>
                                           <div className="text-[10px] text-slate-400">{c.waliKelas ? `Wali Kelas: ${c.waliKelas}` : 'Belum ada wali kelas'} • {c.jumlahSiswa} siswa</div>
                                       </div>
                                       {c.daftarSiswa.length > 0 && (
                                           <span className="text-[9px] bg-crimson/10 text-crimson px-2 py-0.5 rounded-full font-bold flex-shrink-0">{c.daftarSiswa.length} perlu perhatian</span>
                                       )}
                                   </div>
                                   <div className="grid grid-cols-3 gap-2">
                                       <div className="text-center bg-crimson/10 rounded-xl py-1.5">
                                           <div className="text-sm font-extrabold text-crimson">{c.jumlahTerlambat}</div>
                                           <div className="text-[8px] text-crimson font-bold uppercase">Terlambat</div>
                                       </div>
                                       <div className="text-center bg-amber-50 rounded-xl py-1.5">
                                           <div className="text-sm font-extrabold text-amber-600">{c.jumlahPelanggaran}</div>
                                           <div className="text-[8px] text-amber-600 font-bold uppercase">Pelanggaran</div>
                                       </div>
                                       <div className="text-center bg-sky-dim/10 rounded-xl py-1.5">
                                           <div className="text-sm font-extrabold text-sky-dim">{c.jumlahSurat}</div>
                                           <div className="text-[8px] text-sky-dim font-bold uppercase">Surat</div>
                                       </div>
                                   </div>
                               </div>
                               {expandedClass === c.kelas && (
                                   <div className="ml-3 mt-1.5 mb-1 pl-3 border-l-2 border-sky-dim space-y-1.5 animate-pop">
                                       <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Siswa Bermasalah — {c.kelas}</div>
                                       {c.daftarSiswa.length > 0 ? c.daftarSiswa.map((s, i) => (
                                           <div key={i} className="text-[11px] text-slate-700 font-medium bg-slate-50 rounded-lg px-2.5 py-1.5">{s.name}</div>
                                       )) : (
                                           <div className="text-[11px] text-slate-400">Tidak ada siswa bermasalah di periode ini.</div>
                                       )}
                                   </div>
                               )}
                           </div>
                       ))}
                       {classData.length === 0 && <EmptyState emoji="🏫" text="Belum ada data kelas." />}
                   </div>
               </div>
           );
       }
