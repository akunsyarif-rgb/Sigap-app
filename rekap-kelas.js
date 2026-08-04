// ===== rekap-kelas.js =====
// Tab Rekap Kelas: per kelas menampilkan wali kelas, jumlah siswa, jumlah
// Terlambat & Pelanggaran, dan daftar siswa bermasalah. Dihitung dari data
// yang sudah di-fetch (allLogs/pelanggaranList/students) — tidak ada endpoint
// agregasi baru di server (Blueprint SIGAP v2, section VI).
//
// Akses: admin/BK/Kesiswaan (isPrivileged) lihat SEMUA kelas. Guru yang jadi
// wali kelas (myWaliKelas) cuma lihat kelasnya sendiri, detail. Guru biasa
// non-wali-kelas tidak pernah sampai ke komponen ini (digating di app.js).
// Surat sengaja TIDAK dimasukkan di sini — beda kebutuhan, lihat diskusi Surat.

       function RekapKelasTab({ students, allLogs, pelanggaranList, waliKelasMap, isPrivileged, myWaliKelas }) {
           const [period, setPeriod] = useState('minggu-ini');
           const [expandedClass, setExpandedClass] = useState(isPrivileged ? null : myWaliKelas);

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

           // normalizeClass/sameClass (helpers.js): nama kelas diketik manual di
           // beberapa tempat, jadi dicocokkan toleran spasi/huruf besar-kecil,
           // bukan string persis sama — tampilan tetap pakai nilai asli `kelas`.
           const waliByClass = {};
           waliKelasMap.forEach(w => { waliByClass[normalizeClass(w.class)] = w.waliKelasName; });

           // Privileged (admin/BK/Kesiswaan): semua kelas, urut A-Z (Blueprint
           // section VIII). Wali kelas: cuma kelasnya sendiri.
           const classes = isPrivileged
               ? [...new Set(students.map(s => s.class))].sort((a, b) => String(a).localeCompare(String(b)))
               : (myWaliKelas ? [myWaliKelas] : []);

           const classData = classes.map(kelas => {
               const jumlahSiswa = students.filter(s => sameClass(s.class, kelas)).length;
               const lateKelas = lateInPeriod.filter(l => sameClass(l.class, kelas));
               const pelanggaranKelas = pelanggaranInPeriod.filter(p => sameClass(p.class, kelas));

               const bermasalah = {};
               lateKelas.forEach(l => { bermasalah[l.nisn] = bermasalah[l.nisn] || { nisn: l.nisn, name: l.name }; });
               pelanggaranKelas.forEach(p => { bermasalah[p.nisn] = bermasalah[p.nisn] || { nisn: p.nisn, name: p.name }; });
               const daftarSiswa = Object.values(bermasalah).sort((a, b) => String(a.name).localeCompare(String(b.name)));

               // Dipisah per kategori (bukan digabung jadi 1 daftar polos) supaya
               // jelas siswa itu masuk karena Terlambat atau Pelanggaran — dan
               // `details` (alasan/jenis) ditampilkan biar tidak cuma nama tanpa
               // keterangan sama sekali.
               const groupByStudent = (list, detailField) => {
                   const map = {};
                   list.forEach(item => {
                       if (!map[item.nisn]) map[item.nisn] = { nisn: item.nisn, name: item.name, count: 0, details: [] };
                       map[item.nisn].count++;
                       if (item[detailField] && !map[item.nisn].details.includes(item[detailField])) {
                           map[item.nisn].details.push(item[detailField]);
                       }
                   });
                   return Object.values(map).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
               };
               const siswaTerlambat = groupByStudent(lateKelas, 'type');
               const siswaPelanggaran = groupByStudent(pelanggaranKelas, 'jenis_pelanggaran');

               return {
                   kelas,
                   waliKelas: waliByClass[normalizeClass(kelas)] || '',
                   jumlahSiswa,
                   jumlahTerlambat: lateKelas.length,
                   jumlahPelanggaran: pelanggaranKelas.length,
                   daftarSiswa,
                   siswaTerlambat,
                   siswaPelanggaran,
               };
           });

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{isPrivileged ? 'Rekap Kelas' : `Rekap Kelas ${myWaliKelas}`}</h2>

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
                               <RowCard onClick={() => setExpandedClass(expandedClass === c.kelas ? null : c.kelas)} className="space-y-2">
                                   <div className="flex items-center justify-between">
                                       <div>
                                           <div className="font-display font-bold text-sm text-slate-900">{c.kelas}</div>
                                           <div className="text-[10px] text-slate-400">{c.waliKelas ? `Wali Kelas: ${c.waliKelas}` : 'Belum ada wali kelas'} • {c.jumlahSiswa} siswa</div>
                                       </div>
                                       {c.daftarSiswa.length > 0 && (
                                           <span className="text-[9px] bg-crimson/10 text-crimson px-2 py-0.5 rounded-full font-bold flex-shrink-0">{c.daftarSiswa.length} perlu perhatian</span>
                                       )}
                                   </div>
                                   <div className="grid grid-cols-2 gap-2">
                                       <div className="text-center bg-crimson/10 rounded-xl py-1.5">
                                           <div className="text-sm font-extrabold text-crimson">{c.jumlahTerlambat}</div>
                                           <div className="text-[8px] text-crimson font-bold uppercase">Terlambat</div>
                                       </div>
                                       <div className="text-center bg-amber-50 rounded-xl py-1.5">
                                           <div className="text-sm font-extrabold text-amber-600">{c.jumlahPelanggaran}</div>
                                           <div className="text-[8px] text-amber-600 font-bold uppercase">Pelanggaran</div>
                                       </div>
                                   </div>
                               </RowCard>
                               {expandedClass === c.kelas && (
                                   <div className="ml-3 mt-1.5 mb-1 pl-3 border-l-2 border-sky-dim space-y-3 animate-pop">
                                       <div className="space-y-1.5">
                                           <div className="text-[10px] text-crimson font-semibold uppercase tracking-wide">Terlambat — {c.kelas}</div>
                                           {c.siswaTerlambat.length > 0 ? c.siswaTerlambat.map((s, i) => (
                                               <div key={i} className="text-[11px] text-slate-700 bg-crimson/5 rounded-lg px-2.5 py-1.5">
                                                   <div className="flex items-center justify-between font-medium">
                                                       <span>{s.name}</span>
                                                       <span className="text-crimson font-bold flex-shrink-0 ml-2">{s.count}x</span>
                                                   </div>
                                                   {s.details.length > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{s.details.join(', ')}</div>}
                                               </div>
                                           )) : (
                                               <div className="text-[11px] text-slate-400">Tidak ada catatan terlambat di periode ini.</div>
                                           )}
                                       </div>
                                       <div className="space-y-1.5">
                                           <div className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">Pelanggaran — {c.kelas}</div>
                                           {c.siswaPelanggaran.length > 0 ? c.siswaPelanggaran.map((s, i) => (
                                               <div key={i} className="text-[11px] text-slate-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                                                   <div className="flex items-center justify-between font-medium">
                                                       <span>{s.name}</span>
                                                       <span className="text-amber-600 font-bold flex-shrink-0 ml-2">{s.count}x</span>
                                                   </div>
                                                   {s.details.length > 0 && <div className="text-[10px] text-slate-400 mt-0.5">{s.details.join(', ')}</div>}
                                               </div>
                                           )) : (
                                               <div className="text-[11px] text-slate-400">Tidak ada catatan pelanggaran di periode ini.</div>
                                           )}
                                       </div>
                                   </div>
                               )}
                           </div>
                       ))}
                       {classData.length === 0 && <EmptyState emoji="🏫" text="Belum ada data kelas." />}
                   </div>
               </div>
           );
       }
