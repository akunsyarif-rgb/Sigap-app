// ===== pelanggaran-bimbingan-upacara.js =====
// Tab Pelanggaran (catat + tandai Bimbingan Khusus), tab Bimbingan
// Khusus (khusus Admin/BK), dan tab Upacara (OSIS + BK/Admin).

       function PelanggaranTab({ students, pelanggaranList, onAddPelanggaran, onAddBimbingan, canSeeClassDetail, onGetPelanggaranCount, waliKelasMap }) {
           const [searchQuery, setSearchQuery] = useState('');
           const [selectedStudent, setSelectedStudent] = useState(null);
           const [jenis, setJenis] = useState('');
           const [jenisCustom, setJenisCustom] = useState('');
           const [sanksi, setSanksi] = useState('');
           const [sanksiCustom, setSanksiCustom] = useState('');
           const [catatan, setCatatan] = useState('');
           const [msg, setMsg] = useState('');
           const [bimbinganTarget, setBimbinganTarget] = useState(null);
           const [bimbinganCatatan, setBimbinganCatatan] = useState('');
           // Default tetap kronologis — Nama A-Z cuma opsi tambahan (Blueprint SIGAP v2, section VIII)
           const [sortMode, setSortMode] = useState('waktu');
           // Cuma dipakai kalau !canSeeClassDetail — total sebenarnya (semua guru),
           // tanpa detail isi (lihat getPelanggaranCountForStudent di Code.gs).
           const [otherTotalCount, setOtherTotalCount] = useState(0);

           const jenisPresets = ['Bolos', 'Rambut/Seragam', 'Merokok'];
           const sanksiPresets = ['Teguran Lisan', 'Surat Peringatan', 'Panggil Orang Tua'];

           // Wali kelas di hasil pencarian — konsisten dengan Gerbang (Roadmap
           // Lanjutan SIGAP Fase 3), berguna kalau perlu menghubungi wali kelas
           // terkait sebelum/sesudah mencatat pelanggaran.
           const waliByClass = {};
           (waliKelasMap || []).forEach(w => { waliByClass[normalizeClass(w.class)] = w.waliKelasName; });

           // filterStudents (helpers.js) mengurutkan berdasarkan relevansi (posisi
           // kecocokan paling awal menang), sama seperti pencarian di Gerbang.
           const filtered = filterStudents(students, searchQuery);

           // canSeeClassDetail: pelanggaranList sudah berisi data lengkap (kelasnya/semua),
           // jadi riwayat siswa dihitung langsung dari situ. Selain itu, pelanggaranList
           // cuma berisi catatan guru ini sendiri — untuk peringatan "sudah Nx tercatat"
           // tetap perlu TOTAL sebenarnya, diambil terpisah (cuma angka, lihat useEffect).
           const studentHistory = selectedStudent ? pelanggaranList.filter(p => p.nisn === selectedStudent.nisn) : [];
           useEffect(() => {
               if (selectedStudent && !canSeeClassDetail) {
                   onGetPelanggaranCount(selectedStudent.nisn).then(setOtherTotalCount);
               } else {
                   setOtherTotalCount(0);
               }
           }, [selectedStudent]);
           const todayList = pelanggaranList.filter(p => isSameDay(parseTimestamp(p.timestamp), new Date())).sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp));
           const todayCount = todayList.length;

           const showMsg = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000); };

           const submitPelanggaran = () => {
               const finalJenis = jenis === 'Custom' ? (jenisCustom.trim() || 'Lainnya') : jenis;
               const finalSanksi = sanksi === 'Custom' ? (sanksiCustom.trim() || 'Lainnya') : sanksi;
               onAddPelanggaran({ nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, jenis_pelanggaran: finalJenis, sanksi: finalSanksi, catatan }, (ok, text) => showMsg(text));
               setSelectedStudent(null); setSearchQuery(''); setJenis(''); setJenisCustom(''); setSanksi(''); setSanksiCustom(''); setCatatan('');
           };

           const submitBimbingan = () => {
               if (!bimbinganCatatan.trim()) return;
               onAddBimbingan({ nisn: bimbinganTarget.nisn, name: bimbinganTarget.name, class_name: bimbinganTarget.class, catatan: bimbinganCatatan.trim() }, (ok, text) => showMsg(text));
               setBimbinganTarget(null); setBimbinganCatatan('');
           };

           return (
               <div className="space-y-5 animate-rise">
                   <div className="flex justify-between items-end">
                       <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Catat Pelanggaran</h2>
                       <span className="text-[10px] text-slate-500 font-semibold">{todayCount} hari ini</span>
                   </div>

                   {msg && <div className="text-xs text-sky-dim font-medium text-center bg-sky-dim/15 border border-sky-dim/40 py-2 rounded-lg">{msg}</div>}

                   <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama, kelas, atau NISN..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
                           <div className="max-h-48 overflow-y-auto">
                               {/* key gabungan nisn+index -- lihat catatan yang sama di
                                   gerbang.js: dua siswa tanpa NISN terisi akan tabrakan key
                                   kalau cuma pakai s.nisn. */}
                               {filtered.length > 0 ? filtered.map((s, i) => (
                                   <div key={`${s.nisn}-${i}`} onClick={() => { setSelectedStudent(s); setSearchQuery(''); }} className="px-4 py-3 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 cursor-pointer">
                                       <div>
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim">{s.class}</div>
                                           <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-0.5">
                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} className="h-2.5 w-2.5 flex-shrink-0" />
                                               <span className="truncate">{waliByClass[normalizeClass(s.class)] || 'Belum ada wali kelas'}</span>
                                           </div>
                                       </div>
                                   </div>
                               )) : <div className="p-4 text-center text-xs text-slate-500">Tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {/* canSeeClassDetail (admin/BK/wali kelas) melihat seluruh catatan
                       yang relevan buat mereka; guru biasa melihat catatan yang MEREKA
                       SENDIRI tulis (pelanggaranList sudah dibatasi begitu dari server) —
                       jadi tidak ada pesan "Anda tidak boleh lihat ini", cukup label yang
                       jujur soal cakupannya. */}
                   <div className="pt-1">
                       <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">{canSeeClassDetail ? `Pelanggaran Hari Ini (${todayList.length})` : `Yang Saya Catat Hari Ini (${todayList.length})`}</h3>
                       {todayList.length > 0 ? (
                           <div className="space-y-2.5">
                               {todayList.map((p, idx) => {
                                   const dt = parseTimestamp(p.timestamp);
                                   return (
                                       <RowCard key={idx} className="space-y-1 shadow-sm">
                                           <div className="flex items-center justify-between gap-2">
                                               <div className="font-semibold text-sm text-slate-900 truncate">{p.name}</div>
                                               <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">{p.jenis_pelanggaran}</span>
                                           </div>
                                           <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                               <span>{p.class} • Sanksi: {p.sanksi}</span>
                                               <span className="flex-shrink-0">{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                           </div>
                                       </RowCard>
                                   );
                               })}
                           </div>
                       ) : (
                           <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />} text={canSeeClassDetail ? 'Belum ada pelanggaran tercatat hari ini.' : 'Anda belum mencatat pelanggaran hari ini.'} />
                       )}
                       <p className="text-[11px] text-slate-500 text-center pt-3">Untuk data kemarin/minggu/bulan lalu, buka menu <span className="font-semibold text-slate-500">Riwayat</span>.</p>
                   </div>

                   {selectedStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop my-4">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Catat Pelanggaran</h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{selectedStudent.name}</div>
                                   <div className="text-xs text-slate-500">{selectedStudent.class}</div>
                                   <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mt-1">
                                       <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />} className="h-3 w-3 flex-shrink-0" />
                                       <span>{waliByClass[normalizeClass(selectedStudent.class)] || 'Belum ada wali kelas'}</span>
                                   </div>
                               </div>

                               {canSeeClassDetail ? (
                                   studentHistory.length > 0 && (
                                       <div className="bg-crimson/10 border border-crimson/40 rounded-2xl p-3 space-y-1.5">
                                           <div className="flex items-center gap-1.5 text-[10px] text-crimson font-bold uppercase tracking-wide">
                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-3 w-3 flex-shrink-0" />
                                               <span>Sudah {studentHistory.length}x tercatat sebelumnya</span>
                                           </div>
                                           {studentHistory.slice(0, 3).map((h, i) => {
                                               const hDt = parseTimestamp(h.timestamp);
                                               return <div key={i} className="text-[11px] text-slate-600">{h.jenis_pelanggaran} — {hDt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ({h.sanksi})</div>;
                                           })}
                                       </div>
                                   )
                               ) : (
                                   // Cuma angka total (termasuk dicatat guru lain), tanpa detail
                                   // isinya — lihat getPelanggaranCountForStudent di Code.gs.
                                   otherTotalCount > 0 && (
                                       <div className="bg-crimson/10 border border-crimson/40 rounded-2xl p-3">
                                           <div className="flex items-center gap-1.5 text-[10px] text-crimson font-bold uppercase tracking-wide">
                                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />} className="h-3 w-3 flex-shrink-0" />
                                               <span>Sudah {otherTotalCount}x tercatat sebelumnya (oleh guru mana pun)</span>
                                           </div>
                                       </div>
                                   )
                               )}

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Jenis Pelanggaran</label>
                                   {/* Memilih preset WAJIB mengosongkan kotak ketik manual di
                                       bawahnya. Tanpa itu, teks manual yang terlanjur diketik
                                       tetap terpampang padahal yang tersimpan adalah preset —
                                       yang dilihat guru beda dengan yang masuk Sheet. Arah
                                       sebaliknya sudah aman: mengetik manual menyetel
                                       jenis='Custom' sehingga tidak ada preset yang tersorot. */}
                                   <div className="grid grid-cols-3 gap-2">
                                       {jenisPresets.map(j => (
                                           <button key={j} onClick={() => { setJenis(j); setJenisCustom(''); }} className={`py-2 rounded-xl text-[10px] font-bold ${jenis === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={jenisCustom} onChange={(e) => { setJenisCustom(e.target.value); setJenis('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Sanksi</label>
                                   <div className="grid grid-cols-3 gap-2">
                                       {sanksiPresets.map(s => (
                                           <button key={s} onClick={() => { setSanksi(s); setSanksiCustom(''); }} className={`py-2 rounded-xl text-[10px] font-bold ${sanksi === s ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{s}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={sanksiCustom} onChange={(e) => { setSanksiCustom(e.target.value); setSanksi('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>

                               <input type="text" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />

                               <Button onClick={submitPelanggaran} disabled={!jenis || !sanksi} className="w-full">Simpan</Button>
                               <Button onClick={() => { setBimbinganTarget(selectedStudent); setSelectedStudent(null); }} variant="ghost" className="w-full">Tandai Perlu Bimbingan Khusus</Button>
                               <Button onClick={() => setSelectedStudent(null)} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {bimbinganTarget && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                           <div className="bg-white w-full max-w-sm rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Perlu Bimbingan Khusus</h3>
                                   <div className="font-display text-lg font-extrabold text-slate-900 mt-1">{bimbinganTarget.name}</div>
                               </div>
                               <textarea value={bimbinganCatatan} onChange={(e) => setBimbinganCatatan(e.target.value)} placeholder="Catatan untuk Admin..." rows={3} className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <Button onClick={submitBimbingan} className="w-full">Simpan (hanya Admin bisa lihat)</Button>
                               <Button onClick={() => { setBimbinganTarget(null); setBimbinganCatatan(''); }} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   <div className="flex items-center justify-between">
                       <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{canSeeClassDetail ? `${pelanggaranList.length} catatan pelanggaran` : `${pelanggaranList.length} catatan yang pernah saya tulis`}</h3>
                       <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
                           <button onClick={() => setSortMode('waktu')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${sortMode === 'waktu' ? 'bg-sky text-white' : 'text-slate-500'}`}>Terbaru</button>
                           <button onClick={() => setSortMode('nama')} className={`px-2.5 py-1 rounded-md text-[9px] font-bold transition ${sortMode === 'nama' ? 'bg-sky text-white' : 'text-slate-500'}`}>A-Z</button>
                       </div>
                   </div>
                   <div className="space-y-2.5">
                       {[...pelanggaranList].sort((a, b) => sortMode === 'nama' ? String(a.name).localeCompare(String(b.name)) : parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp)).slice(0, 30).map((p, idx) => {
                           const dt = parseTimestamp(p.timestamp);
                           return (
                               <RowCard key={idx} className="space-y-1">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{p.name}</div>
                                       <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">{p.jenis_pelanggaran}</span>
                                   </div>
                                   <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                       <span>{p.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                       <span className="truncate">{p.sanksi}</span>
                                   </div>
                                   {/* Catatan tambahan sempat tersimpan ke sheet tapi tidak
                                       pernah dirender di sini — guru yang mengetiknya jadi
                                       mengira catatannya hilang. Ikut pola BimbinganTab. */}
                                   {p.catatan && <div className="text-[11px] text-slate-600 break-words">{p.catatan}</div>}
                               </RowCard>
                           );
                       })}
                       {pelanggaranList.length === 0 && (
                           <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />} text={canSeeClassDetail ? 'Belum ada catatan pelanggaran.' : 'Anda belum pernah mencatat pelanggaran.'} />
                       )}
                   </div>
               </div>
           );
       }

       function BimbinganTab({ bimbinganList }) {
           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Perlu Bimbingan Khusus (Admin)</h2>
                   <p className="text-[11px] text-slate-500">Daftar ini hanya terlihat oleh Admin.</p>
                   <div className="space-y-2.5">
                       {bimbinganList.map((b, idx) => {
                           const dt = parseTimestamp(b.timestamp);
                           return (
                               <RowCard key={idx} className="space-y-1.5">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{b.name}</div>
                                       <span className="text-[10px] text-slate-500">{b.class}</span>
                                   </div>
                                   <div className="text-[11px] text-slate-600">{b.catatan}</div>
                                   <div className="text-[10px] text-slate-500 flex justify-between">
                                       <span>{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                       <span>oleh {b.logged_by}</span>
                                   </div>
                               </RowCard>
                           );
                       })}
                       {bimbinganList.length === 0 && <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />} text="Belum ada catatan bimbingan khusus." />}
                   </div>
               </div>
           );
       }

       // ===== Rekap Pelanggaran Upacara =====
       // Alat BACA, bukan halaman administrasi: ringkasan satu baris, lalu
       // dikelompokkan per kelas. Sengaja tanpa tabel — di HP tabel lebar
       // memaksa scroll horizontal.
       //
       // Filter dipecah dua tingkat supaya tidak memakan layar: pencarian siswa
       // selalu terlihat (paling sering dipakai), sedangkan Periode/Kelas/Jenis
       // disembunyikan di bottom sheet dan hanya dibuka saat perlu.
       function RekapUpacara({ upacaraList }) {
           const [period, setPeriod] = useState('bulan-ini');
           const [filterClass, setFilterClass] = useState('');
           const [filterJenis, setFilterJenis] = useState('');
           const [query, setQuery] = useState('');
           const [showFilter, setShowFilter] = useState(false);

           const periods = [
               { key: 'hari-ini', label: 'Hari Ini' },
               { key: 'minggu-ini', label: 'Minggu Ini' },
               { key: 'bulan-ini', label: 'Bulan Ini' },
               { key: 'semua', label: 'Semua' },
           ];

           const list = Array.isArray(upacaraList) ? upacaraList : [];
           const now = new Date();
           const passesPeriod = (dt) => {
               if (period === 'hari-ini') return isSameDay(dt, now);
               if (period === 'minggu-ini') return dt >= startOfWeek(now) && dt <= now;
               if (period === 'bulan-ini') return dt >= startOfMonth(now) && dt <= now;
               return true;
           };

           const allClasses = [...new Set(list.map(u => u.class).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
           const allJenis = [...new Set(list.map(u => u.jenis_pelanggaran).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

           const q = query.trim().toLowerCase();
           const filtered = list.filter(u => {
               if (!passesPeriod(parseTimestamp(u.timestamp))) return false;
               if (filterClass && !sameClass(u.class, filterClass)) return false;
               if (filterJenis && u.jenis_pelanggaran !== filterJenis) return false;
               if (q && !String(u.name || '').toLowerCase().includes(q)) return false;
               return true;
           });

           // Urutan default: Kelas -> Nama A-Z -> waktu (terlama dulu dalam satu
           // siswa, supaya urutan kejadiannya terbaca wajar).
           const sorted = [...filtered].sort((a, b) =>
               String(a.class).localeCompare(String(b.class))
               || String(a.name).localeCompare(String(b.name))
               || parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp)
           );

           // Kunci identitas siswa: nisn kalau ada, kalau tidak jatuh ke
           // nama+kelas. Payload upacara untuk OSIS sengaja TIDAK membawa nisn
           // (dipangkas server-side di getPelanggaranUpacara, RBAC v1) — tanpa
           // fallback ini seluruh baris berkunci `undefined` dan hitungannya
           // selalu tampil "1 Siswa" untuk petugas OSIS.
           const jumlahSiswa = new Set(sorted.map(u => u.nisn || `${u.name}|${normalizeClass(u.class)}`)).size;
           const jumlahKelas = new Set(sorted.map(u => normalizeClass(u.class))).size;

           const byClass = [];
           sorted.forEach(u => {
               let group = byClass.find(g => sameClass(g.kelas, u.class));
               if (!group) { group = { kelas: u.class, items: [] }; byClass.push(group); }
               group.items.push(u);
           });

           const filterAktif = (filterClass ? 1 : 0) + (filterJenis ? 1 : 0) + (period !== 'bulan-ini' ? 1 : 0);
           const resetFilter = () => { setPeriod('bulan-ini'); setFilterClass(''); setFilterJenis(''); };

           return (
               <div className="space-y-4">
                   <div className="flex items-center gap-2">
                       <input
                           type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                           placeholder="Cari nama siswa..."
                           className="flex-1 min-w-0 bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky"
                       />
                       <button
                           type="button" onClick={() => setShowFilter(true)}
                           className={`flex-shrink-0 min-h-[48px] px-4 rounded-2xl text-xs font-bold border transition ${filterAktif > 0 ? 'bg-sky text-white border-sky' : 'bg-white text-slate-600 border-slate-300'}`}
                       >
                           Filter{filterAktif > 0 ? ` (${filterAktif})` : ''}
                       </button>
                   </div>

                   <div className="text-[11px] text-slate-500 font-semibold px-1">
                       {sorted.length} Pelanggaran • {jumlahSiswa} Siswa • {jumlahKelas} Kelas
                   </div>

                   <div className="space-y-3">
                       {byClass.map((g) => (
                           <div key={g.kelas} className="space-y-1.5">
                               <div className="flex items-baseline justify-between px-1">
                                   <div className="font-display font-bold text-sm text-slate-900">{g.kelas}</div>
                                   <div className="text-[10px] text-slate-500 font-semibold flex-shrink-0 ml-2">{g.items.length} catatan</div>
                               </div>
                               {g.items.map((u, i) => (
                                   <RowCard key={i} className="space-y-1">
                                       <div className="flex items-center justify-between gap-2">
                                           <div className="font-semibold text-sm text-slate-900 truncate">{u.name}</div>
                                           <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold flex-shrink-0">{u.jenis_pelanggaran}</span>
                                       </div>
                                       {u.catatan && <div className="text-[11px] text-slate-600 break-words">{u.catatan}</div>}
                                       <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                           <span className="truncate">{parseTimestamp(u.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} • {u.logged_by}</span>
                                           <span className="flex-shrink-0">{parseTimestamp(u.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                       </div>
                                   </RowCard>
                               ))}
                           </div>
                       ))}
                       {sorted.length === 0 && <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />} text="Tidak ada pelanggaran upacara di filter ini." />}
                   </div>

                   {showFilter && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={() => setShowFilter(false)}>
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop" onClick={(e) => e.stopPropagation()}>
                               <div className="flex items-center justify-between">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Filter Rekap</h3>
                                   <button type="button" onClick={resetFilter} className="text-[10px] text-crimson font-bold py-2 px-1">Reset</button>
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Periode</label>
                                   <div className="grid grid-cols-2 gap-2">
                                       {periods.map(p => (
                                           <button key={p.key} type="button" onClick={() => setPeriod(p.key)} className={`min-h-[44px] rounded-xl text-[11px] font-bold ${period === p.key ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{p.label}</button>
                                       ))}
                                   </div>
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Kelas</label>
                                   <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} className="w-full min-h-[44px] bg-white border border-slate-300 rounded-xl px-3 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       <option value="">Semua kelas</option>
                                       {allClasses.map(c => <option key={c} value={c}>{c}</option>)}
                                   </select>
                               </div>

                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Jenis Pelanggaran</label>
                                   <select value={filterJenis} onChange={(e) => setFilterJenis(e.target.value)} className="w-full min-h-[44px] bg-white border border-slate-300 rounded-xl px-3 text-xs text-slate-900 focus:outline-none focus:border-sky">
                                       <option value="">Semua jenis</option>
                                       {allJenis.map(j => <option key={j} value={j}>{j}</option>)}
                                   </select>
                               </div>

                               <Button onClick={() => setShowFilter(false)} className="w-full">Terapkan</Button>
                           </div>
                       </div>
                   )}
               </div>
           );
       }

       // canSeeRekap: admin/BK/OSIS. Guru biasa tidak dapat — dan itu juga
       // ditegakkan server-side di getPelanggaranUpacara (Code.gs), bukan cuma
       // dengan menyembunyikan tombol di sini.
       function UpacaraTab({ students, upacaraList, onAddUpacara, isOsis, canSeeRekap }) {
           const [view, setView] = useState('catat');
           const [searchQuery, setSearchQuery] = useState('');
           const [selectedStudent, setSelectedStudent] = useState(null);
           const [jenis, setJenis] = useState('');
           const [jenisCustom, setJenisCustom] = useState('');
           const [catatan, setCatatan] = useState('');
           const [msg, setMsg] = useState('');
           const [msgTone, setMsgTone] = useState('sky');

           const jenisPresets = ['Atribut Tidak Lengkap', 'Tidak Tertib', 'Terlambat Baris'];

           // filterStudents (helpers.js) mengurutkan berdasarkan relevansi (posisi
           // kecocokan paling awal menang), sama seperti pencarian di Gerbang.
           const filtered = filterStudents(students, searchQuery);

           const showMsg = (ok, text) => { setMsgTone(ok ? 'sky' : 'crimson'); setMsg(text); setTimeout(() => setMsg(''), 3000); };

           const submitUpacara = () => {
               const finalJenis = jenis === 'Custom' ? (jenisCustom.trim() || 'Lainnya') : jenis;
               onAddUpacara({ nisn: selectedStudent.nisn, name: selectedStudent.name, class_name: selectedStudent.class, jenis_pelanggaran: finalJenis, catatan }, (ok, text) => showMsg(ok, text));
               setSelectedStudent(null); setSearchQuery(''); setJenis(''); setJenisCustom(''); setCatatan('');
           };

           // Rekap dibuka lewat sakelar di dalam menu Upacara, BUKAN menu baru
           // di Bottom Nav — jumlah menu utama tidak bertambah, dan alur mencatat
           // tetap sama persis: buka Upacara -> cari siswa -> pilih jenis ->
           // Simpan. Tidak ada klik tambahan untuk pekerjaan yang lama.
           const rekapAktif = canSeeRekap && view === 'rekap';

           return (
               <div className="space-y-5 animate-rise">
                   <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                       {rekapAktif ? 'Rekap Pelanggaran Upacara' : 'Catat Pelanggaran Upacara'}
                   </h2>

                   {canSeeRekap && (
                       <div className="flex gap-1 bg-white border border-slate-200 rounded-2xl p-1">
                           {[{ key: 'catat', label: 'Catat' }, { key: 'rekap', label: 'Rekap' }].map(v => (
                               <button
                                   key={v.key} type="button" onClick={() => setView(v.key)}
                                   className={`flex-1 min-h-[44px] rounded-xl text-xs font-bold transition ${view === v.key ? 'bg-sky text-white' : 'text-slate-500'}`}
                               >
                                   {v.label}
                               </button>
                           ))}
                       </div>
                   )}

                   {rekapAktif && <RekapUpacara upacaraList={upacaraList} />}

                   {!rekapAktif && (
                   <React.Fragment>
                   {msg && <div className={`text-xs font-medium text-center py-2 rounded-lg border ${msgTone === 'sky' ? 'text-sky-dim bg-sky-dim/15 border-sky-dim/40' : 'text-crimson bg-crimson/10 border-crimson/30'}`}>{msg}</div>}

                   <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari nama, kelas, atau NISN..." className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-sky" />

                   {searchQuery.trim() !== '' && (
                       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xl">
                           <div className="max-h-48 overflow-y-auto">
                               {/* key gabungan nisn+index -- lihat catatan yang sama di
                                   gerbang.js: dua siswa tanpa NISN terisi akan tabrakan key
                                   kalau cuma pakai s.nisn. */}
                               {filtered.length > 0 ? filtered.map((s, i) => (
                                   <div key={`${s.nisn}-${i}`} onClick={() => { setSelectedStudent(s); setSearchQuery(''); }} className="px-4 py-3 border-b border-slate-200/60 flex items-center justify-between hover:bg-slate-100 cursor-pointer">
                                       <div>
                                           <div className="font-bold text-sm text-slate-900">{s.name}</div>
                                           <div className="text-xs text-sky-dim">{s.class}</div>
                                       </div>
                                   </div>
                               )) : <div className="p-4 text-center text-xs text-slate-500">Tidak ditemukan</div>}
                           </div>
                       </div>
                   )}

                   {selectedStudent && (
                       <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                           <div className="bg-white w-full sm:max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 border border-slate-200 shadow-2xl space-y-4 animate-pop">
                               <div className="text-center">
                                   <h3 className="text-[10px] text-sky-dim uppercase tracking-widest font-bold">Pelanggaran Upacara</h3>
                                   <div className="font-display text-xl font-extrabold text-slate-900 mt-1">{selectedStudent.name}</div>
                                   <div className="text-xs text-slate-500">{selectedStudent.class}</div>
                               </div>
                               <div>
                                   <label className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 block">Jenis Pelanggaran</label>
                                   {/* Memilih preset WAJIB mengosongkan kotak ketik manual di
                                       bawahnya. Tanpa itu, teks manual yang terlanjur diketik
                                       tetap terpampang padahal yang tersimpan adalah preset —
                                       yang dilihat guru beda dengan yang masuk Sheet. Arah
                                       sebaliknya sudah aman: mengetik manual menyetel
                                       jenis='Custom' sehingga tidak ada preset yang tersorot. */}
                                   <div className="grid grid-cols-3 gap-2">
                                       {jenisPresets.map(j => (
                                           <button key={j} onClick={() => { setJenis(j); setJenisCustom(''); }} className={`py-2 rounded-xl text-[10px] font-bold ${jenis === j ? 'bg-sky text-white' : 'bg-slate-100 border border-slate-300 text-slate-600'}`}>{j}</button>
                                       ))}
                                   </div>
                                   <input type="text" value={jenisCustom} onChange={(e) => { setJenisCustom(e.target.value); setJenis('Custom'); }} placeholder="Atau ketik manual..." className="w-full mt-2 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               </div>
                               <input type="text" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan tambahan (opsional)" className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky" />
                               <Button onClick={submitUpacara} disabled={!jenis} className="w-full">Simpan</Button>
                               <Button onClick={() => setSelectedStudent(null)} variant="secondary" className="w-full">Batal</Button>
                           </div>
                       </div>
                   )}

                   {/* Daftar pendek di bawah form = konfirmasi langsung bahwa
                       catatan barusan masuk, tanpa harus pindah ke Rekap.
                       Daftar lengkap + filter ada di Rekap, jadi di sini cukup
                       10 terbaru. (Judul lama "Riwayat Catatan Saya" sudah tidak
                       tepat: OSIS sekarang menerima seluruh rekap, bukan hanya
                       catatannya sendiri.) */}
                   <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Catatan Terbaru</h3>
                   <div className="space-y-2.5">
                       {upacaraList.slice(0, 10).map((u, idx) => {
                           const dt = parseTimestamp(u.timestamp);
                           return (
                               <RowCard key={idx} className="space-y-1">
                                   <div className="flex items-center justify-between">
                                       <div className="font-semibold text-sm text-slate-900">{u.name}</div>
                                       <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">{u.jenis_pelanggaran}</span>
                                   </div>
                                   <div className="text-[10px] text-slate-500 flex justify-between gap-2">
                                       <span>{u.class} • {dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                                       <span>{dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                                   </div>
                                   {/* Sama seperti di PelanggaranTab: catatan tambahan ikut
                                       tersimpan ke sheet (kolom Catatan) tapi tidak pernah
                                       ditampilkan, jadi terlihat seperti hilang. */}
                                   {u.catatan && <div className="text-[11px] text-slate-600 break-words">{u.catatan}</div>}
                                   {!isOsis && <div className="text-[10px] text-slate-500">Dicatat oleh: {u.logged_by}</div>}
                               </RowCard>
                           );
                       })}
                       {upacaraList.length === 0 && <EmptyState icon={<path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />} text="Belum ada catatan pelanggaran upacara." />}
                   </div>
                   </React.Fragment>
                   )}
               </div>
           );
       }

