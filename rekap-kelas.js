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

       function RekapKelasTab({ students, allLogs, pelanggaranList, upacaraList, waliKelasMap, isPrivileged, myWaliKelas }) {
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
           // Upacara memakai SUMBER DATA YANG SAMA dengan menu Upacara
           // (upacaraList dari getPelanggaranUpacara) — bukan rekap kedua.
           // Untuk wali kelas, server sudah membatasi isinya ke kelasnya
           // sendiri, jadi wali kelas tidak perlu membuka menu Upacara cuma
           // untuk tahu kondisi anaknya.
           const upacaraSemua = Array.isArray(upacaraList) ? upacaraList : [];
           const upacaraInPeriod = upacaraSemua.filter(u => passesPeriod(parseTimestamp(u.timestamp)));

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
               const upacaraKelas = upacaraInPeriod.filter(u => sameClass(u.class, kelas));

               const bermasalah = {};
               lateKelas.forEach(l => { bermasalah[l.nisn] = bermasalah[l.nisn] || { nisn: l.nisn, name: l.name }; });
               pelanggaranKelas.forEach(p => { bermasalah[p.nisn] = bermasalah[p.nisn] || { nisn: p.nisn, name: p.name }; });
               upacaraKelas.forEach(u => { bermasalah[u.nisn] = bermasalah[u.nisn] || { nisn: u.nisn, name: u.name }; });
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
               const siswaUpacara = groupByStudent(upacaraKelas, 'jenis_pelanggaran');

               return {
                   kelas,
                   waliKelas: waliByClass[normalizeClass(kelas)] || '',
                   jumlahSiswa,
                   jumlahTerlambat: lateKelas.length,
                   jumlahPelanggaran: pelanggaranKelas.length,
                   jumlahUpacara: upacaraKelas.length,
                   daftarSiswa,
                   siswaTerlambat,
                   siswaPelanggaran,
                   siswaUpacara,
               };
           });

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{isPrivileged ? 'Rekap Kelas' : `Rekap Kelas ${myWaliKelas}`}</h2>

                   <ScrollFadeRow>
                       {periods.map(p => (
                           <button key={p.key} onClick={() => setPeriod(p.key)} className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition ${period === p.key ? 'bg-navy text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                               {p.label}
                           </button>
                       ))}
                   </ScrollFadeRow>

                   <div className="space-y-2.5">
                       {classData.map((c) => (
                           <div key={c.kelas}>
                               <RowCard onClick={() => setExpandedClass(expandedClass === c.kelas ? null : c.kelas)} className="space-y-2">
                                   <div className="flex items-center justify-between">
                                       <div>
                                           <div className="font-display font-bold text-sm text-slate-900">{c.kelas}</div>
                                           <div className="text-[10px] text-slate-500">{c.waliKelas ? `Wali Kelas: ${c.waliKelas}` : 'Belum ada wali kelas'} • {c.jumlahSiswa} siswa</div>
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
                                           <div className="text-sm font-extrabold text-sky-dim">{c.jumlahUpacara}</div>
                                           <div className="text-[8px] text-sky-dim font-bold uppercase">Upacara</div>
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
                                                   {s.details.length > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{s.details.join(', ')}</div>}
                                               </div>
                                           )) : (
                                               <div className="text-[11px] text-slate-500">Tidak ada catatan terlambat di periode ini.</div>
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
                                                   {s.details.length > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{s.details.join(', ')}</div>}
                                               </div>
                                           )) : (
                                               <div className="text-[11px] text-slate-500">Tidak ada catatan pelanggaran di periode ini.</div>
                                           )}
                                       </div>
                                       <div className="space-y-1.5">
                                           <div className="text-[10px] text-sky-dim font-semibold uppercase tracking-wide">Upacara — {c.kelas}</div>
                                           {c.siswaUpacara.length > 0 ? c.siswaUpacara.map((s, i) => (
                                               <div key={i} className="text-[11px] text-slate-700 bg-sky-dim/5 rounded-lg px-2.5 py-1.5">
                                                   <div className="flex items-center justify-between font-medium">
                                                       <span>{s.name}</span>
                                                       <span className="text-sky-dim font-bold flex-shrink-0 ml-2">{s.count}x</span>
                                                   </div>
                                                   {s.details.length > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{s.details.join(', ')}</div>}
                                               </div>
                                           )) : (
                                               <div className="text-[11px] text-slate-500">Tidak ada catatan upacara di periode ini.</div>
                                           )}
                                       </div>
                                   </div>
                               )}
                           </div>
                       ))}
                       {classData.length === 0 && <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4.5 21V9.75A2.25 2.25 0 016.75 7.5h10.5a2.25 2.25 0 012.25 2.25V21M4.5 21h15M4.5 21H3m16.5 0H21M9 7.5V6a2.25 2.25 0 012.25-2.25h1.5A2.25 2.25 0 0115 6v1.5m-6 3.75h.008v.008H9v-.008zm0 3h.008v.008H9v-.008zm3.75-3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm3.75-3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />} text="Belum ada data kelas." />}
                   </div>
               </div>
           );
       }
