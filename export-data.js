// ===== export-data.js =====
// Tab "Export Data": pilih jenis data -> cakupan kelas -> periode -> format,
// lalu unduh. Google Spreadsheet tetap ADMIN-ONLY; inilah jalan resmi bagi
// yang berwenang untuk mengambil rekap tanpa dibukakan akses ke Sheet.
//
// Komponen ini SENGAJA tidak menyaring data apa pun sendiri: yang ditekan
// tombol Generate cuma mengirim FILTER ke server, dan server yang memutuskan
// (a) apakah pemanggil berhak atas jenis laporan itu, (b) kelas mana yang
// boleh ikut, (c) apakah periodenya masuk akal — lihat resolveExportAccess()
// & validateExportPeriod() di Utils.gs. Daftar pilihan di layar ini cuma
// cermin dari aturan itu supaya guru tidak disodori pilihan yang pasti
// ditolak; menyembunyikan pilihan BUKAN pengamanannya.

       // Cermin dari EXPORT_JENIS di Utils.gs. level 'bk' = hanya admin/BK
       // (Bimbingan Khusus memang sudah admin/BK-only lewat getBimbingan).
       const EXPORT_JENIS_UI = [
           { key: 'keterlambatan', label: 'Keterlambatan', level: 'umum' },
           { key: 'pelanggaran', label: 'Pelanggaran', level: 'umum' },
           { key: 'surat', label: 'Surat/Izin', level: 'umum' },
           { key: 'upacara', label: 'Pelanggaran Upacara', level: 'umum' },
           // Izin Keluar ikut aturan yang sama dengan jenis 'umum' lain:
           // admin/BK semua kelas, wali kelas hanya kelas perwaliannya, guru
           // biasa tidak dapat menu Export sama sekali. Tidak ada aturan
           // cakupan baru yang dibuat untuknya.
           { key: 'izin', label: 'Izin Keluar', level: 'umum' },
           { key: 'bimbingan', label: 'Bimbingan Khusus', level: 'bk' },
           { key: 'rekap', label: 'Rekap Siswa (gabungan)', level: 'umum' },
       ];

       function exportJenisOptions(isBk) {
           return EXPORT_JENIS_UI.filter(j => isBk || j.level !== 'bk');
       }

       // Siapa yang melihat menu Export sama sekali. Guru biasa (bukan wali
       // kelas) TIDAK dapat: tidak ada dasar data untuk memberi mereka cakupan
       // kelas tertentu (tidak ada mapping jadwal mengajar di sistem ini), dan
       // hak akses tidak diperluas hanya demi fitur ini. OSIS juga tidak.
       function canAccessExport(roleKey, waliKelas) {
           if (roleKey === 'admin' || roleKey === 'bk_kesiswaan') return true;
           if (roleKey === 'guru') return !!String(waliKelas || '').trim();
           return false;
       }

       function toDateInputValue(d) {
           const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
           const pad = (n) => (n < 10 ? '0' + n : String(n));
           return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
       }

       // Pemeriksaan cepat di layar supaya kesalahan yang jelas tidak perlu
       // menunggu satu perjalanan ke server. Server TETAP memvalidasi ulang
       // semuanya — ini kenyamanan, bukan pengamanan.
       function validateExportForm(form) {
           const f = form || {};
           if (!f.jenis) return 'Pilih jenis data dulu.';
           if (!f.start || !f.end) return 'Isi tanggal mulai dan tanggal akhir.';
           if (String(f.start) > String(f.end)) return 'Tanggal mulai tidak boleh melewati tanggal akhir.';
           if (f.format !== 'pdf' && f.format !== 'xlsx') return 'Pilih format laporan.';
           return '';
       }

       function ExportTab({ isBk, waliKelas, classes, onGenerate }) {
           const lockedKelas = isBk ? '' : String(waliKelas || '').trim();
           const jenisOptions = exportJenisOptions(!!isBk);

           const [jenis, setJenis] = useState(jenisOptions[0] ? jenisOptions[0].key : 'keterlambatan');
           const [kelas, setKelas] = useState(lockedKelas);
           const [start, setStart] = useState(() => toDateInputValue(startOfMonth(new Date())));
           const [end, setEnd] = useState(() => toDateInputValue(new Date()));
           const [format, setFormat] = useState('pdf');
           const [busy, setBusy] = useState(false);
           const [msg, setMsg] = useState(null);

           const classList = [...new Set((classes || []).filter(Boolean).map(String))]
               .sort((a, b) => a.localeCompare(b));

           const submit = () => {
               if (busy) return;
               // Wali kelas: cakupan SELALU kelas perwaliannya, apa pun isi
               // state di layar. Server juga menolak kalau kelas lain dikirim.
               const payload = { jenis, kelas: lockedKelas || kelas, start, end, format };
               const problem = validateExportForm(payload);
               if (problem) { setMsg({ ok: false, text: problem }); return; }
               setMsg(null);
               setBusy(true);
               onGenerate(payload, (ok, text) => {
                   setBusy(false);
                   setMsg({ ok: !!ok, text: text });
               });
           };

           const fieldClass = 'w-full bg-white border border-slate-300 rounded-xl px-3 py-3 text-sm text-slate-900 focus:border-sky focus:outline-none';

           return (
               <div className="space-y-4 animate-rise">
                   <div>
                       <h1 className="font-display text-xl font-extrabold text-slate-900">Export Data</h1>
                       <p className="text-xs text-slate-500 mt-1">
                           Buat laporan siap cetak (PDF) atau siap olah (Excel) langsung dari SIGAP —
                           tanpa perlu membuka Google Spreadsheet.
                       </p>
                   </div>

                   <Card>
                       <div className="space-y-4">
                           <div>
                               <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Jenis Data</label>
                               <select className={fieldClass} value={jenis} onChange={(e) => setJenis(e.target.value)}>
                                   {jenisOptions.map(j => <option key={j.key} value={j.key}>{j.label}</option>)}
                               </select>
                           </div>

                           <div>
                               <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Kelas</label>
                               {lockedKelas ? (
                                   // Cuma satu cakupan yang mungkin — tidak perlu dipaksa memilih ulang.
                                   <div className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-700">
                                       {lockedKelas}
                                       <span className="block text-[11px] text-slate-500 mt-0.5">Kelas perwalian Anda</span>
                                   </div>
                               ) : (
                                   <select className={fieldClass} value={kelas} onChange={(e) => setKelas(e.target.value)}>
                                       <option value="">Semua Kelas</option>
                                       {classList.map(c => <option key={c} value={c}>{c}</option>)}
                                   </select>
                               )}
                           </div>

                           <div>
                               <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Periode</label>
                               <div className="grid grid-cols-2 gap-2">
                                   <div>
                                       <span className="block text-[10px] text-slate-500 mb-1">Dari</span>
                                       <input type="date" className={fieldClass} value={start} onChange={(e) => setStart(e.target.value)} />
                                   </div>
                                   <div>
                                       <span className="block text-[10px] text-slate-500 mb-1">Sampai</span>
                                       <input type="date" className={fieldClass} value={end} onChange={(e) => setEnd(e.target.value)} />
                                   </div>
                               </div>
                           </div>

                           <div>
                               <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Format</label>
                               <div className="grid grid-cols-2 gap-2">
                                   <Button variant={format === 'pdf' ? 'primary' : 'ghost'} onClick={() => setFormat('pdf')}>PDF</Button>
                                   <Button variant={format === 'xlsx' ? 'primary' : 'ghost'} onClick={() => setFormat('xlsx')}>Excel</Button>
                               </div>
                           </div>

                           <Button onClick={submit} disabled={busy} className="w-full">
                               {busy ? 'Menyiapkan laporan...' : 'Generate & Download'}
                           </Button>

                           {msg && (
                               <div className={`text-xs font-medium rounded-xl px-3 py-2.5 border ${msg.ok ? 'bg-moss/10 border-moss/30 text-moss-dim' : 'bg-crimson/10 border-crimson/30 text-crimson-dim'}`}>
                                   {msg.text}
                               </div>
                           )}
                       </div>
                   </Card>

                   <p className="text-[11px] text-slate-500 leading-relaxed px-1">
                       Laporan hanya memuat data yang memang menjadi kewenangan akun Anda, dan setiap
                       pembuatan laporan tercatat di Audit Log.
                   </p>
               </div>
           );
       }
