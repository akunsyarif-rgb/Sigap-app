// ===== ui-common.js =====
// Komponen tampilan kecil yang dipakai berulang (Badge, kartu statistik,
// grafik batang, dll), plus layar Login, Header, dan Bottom Navigation.

       // tone="sky" satu-satunya yang dipakai (badge peran di Header, yang
       // sekarang berlatar navy) -- makanya warnanya terang (putih di atas
       // navy), bukan biru gelap seperti tone lain yang dipakai di latar
       // terang. Kalau ada pemakai baru di latar terang nanti, tambah tone
       // baru, jangan ubah "sky" lagi (lihat kontras yang sudah dihitung).
       function Badge({ children, tone = 'sky' }) {
           const tones = { sky: 'bg-white/15 text-white border-white/35', crimson: 'bg-crimson/15 text-crimson border-crimson/40', ink: 'bg-slate-100 text-slate-600 border-slate-300' };
           return <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${tones[tone]}`}>{children}</span>;
       }

       // ===== Design System primitives (Roadmap Lanjutan SIGAP, Fase 2) =====
       // Pola card/tombol yang sudah berulang di banyak file (radius, padding,
       // shadow, warna) ditarik jadi satu sumber di sini supaya konsisten dan
       // tidak drift lagi tiap ada tab baru. Migrasi file lain dilakukan
       // bertahap satu file per kali, bukan sekaligus.

       // Card: wadah section (mis. panel Rekap per Kelas, form pengaturan) —
       // radius lebih besar karena elemen yang lebih besar/jarang berulang.
       // tone dipakai HANYA untuk info penting (Terlambat=crimson,
       // Pelanggaran=amber, Surat=sky) — default tetap putih netral.
       function Card({ children, className = '', tone = 'white' }) {
           const tones = {
               white: 'bg-white border-slate-200',
               crimson: 'bg-crimson/10 border-crimson/30',
               amber: 'bg-amber-50 border-amber-200',
               sky: 'bg-sky-dim/10 border-sky-dim/30',
               // moss dipakai kartu ringkasan Izin Keluar di Beranda — warna
               // keempat yang memang sudah ada di palet (index.html), bukan
               // warna baru; Terlambat/Surat/Pelanggaran sudah memakai tiga
               // tone lainnya dan kartu keempat harus tetap terbedakan.
               moss: 'bg-moss/10 border-moss/30',
           };
           // shadow halus 0 1px 3px rgba(navy,.08) — audit desain (bukan shadow-lg/
           // shadow-xl bawaan Tailwind, itu terlalu berat untuk kartu kecil berulang).
           return <div className={`border rounded-2xl p-5 ${tones[tone]} ${className}`} style={{ boxShadow: '0 1px 3px rgba(27,42,65,0.08)' }}>{children}</div>;
       }

       // RowCard: satu baris dalam daftar berulang (log Riwayat, hasil
       // pencarian, dst.) — radius lebih kecil & padding lebih rapat daripada
       // Card, sesuai hierarki visual yang sudah ada (section besar vs baris
       // list kecil).
       function RowCard({ children, className = '', onClick }) {
           return (
               <div onClick={onClick} className={`bg-white border border-slate-200 rounded-xl p-3.5 ${onClick ? 'cursor-pointer active:bg-slate-100 transition' : ''} ${className}`}>
                   {children}
               </div>
           );
       }

       // Button: 4 varian warna x 2 ukuran. size="normal" WAJIB untuk aksi
       // utama (Simpan, Catat X, dst.) — py-3.5 memastikan tinggi tap-area
       // ≥44px (standar kenyamanan sentuh di HP, lihat checklist Freeze
       // Gerbang). size="compact" untuk elemen kecil berulang (toggle pill,
       // tombol ikon) yang secara desain memang tidak perlu 44px.
       function Button({ children, onClick, variant = 'primary', size = 'normal', disabled = false, type = 'button', className = '' }) {
           // weight 600 (bukan 700) sesuai audit desain — py-3.5 (bukan py-3 persis
           // seperti spec) DIPERTAHANKAN: itu yang menjaga tap-target tetap ≥44px
           // di semua varian termasuk yang punya border-2, jangan diturunkan.
           const base = 'font-semibold transition active:scale-95 disabled:opacity-40 disabled:active:scale-100 inline-flex items-center justify-center gap-1.5';
           const variants = {
               primary: 'bg-sky hover:bg-sky-light text-white shadow-sm',
               danger: 'bg-crimson hover:bg-crimson-dim text-white shadow-sm',
               secondary: 'bg-transparent border-2 border-navy/20 text-navy hover:border-navy/40 hover:bg-navy/5',
               ghost: 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300',
           };
           const sizes = {
               normal: 'py-3.5 px-5 rounded-xl text-sm',
               compact: 'py-2 px-3 rounded-xl text-xs',
           };
           return (
               <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
                   {children}
               </button>
           );
       }

       function StatCard({ value, label, accent = false }) {
           return (
               <Card tone={accent ? 'sky' : 'white'} className="text-center">
                   <div className={`font-display text-3xl font-semibold ${accent ? 'text-sky-dim' : 'text-slate-800'}`}>{value}</div>
                   <div className="text-[10px] text-slate-500 mt-1 font-semibold uppercase tracking-wide">{label}</div>
               </Card>
           );
       }

       function BarChart({ data, title }) {
           const max = Math.max(...data.map(d => d.count), 1);
           return (
               <Card className="shadow-lg">
                   {title && <h3 className="text-xs font-display font-bold text-slate-800 mb-4 text-center">{title}</h3>}
                   <div className="flex items-end justify-between h-36 gap-1.5">
                       {data.map((d, i) => (
                           <div key={i} className="flex flex-col items-center flex-1 h-full">
                               <span className="text-[10px] text-sky-dim font-bold mb-1.5">{d.count > 0 ? d.count : '·'}</span>
                               <div className="w-full max-w-[28px] bg-slate-200/60 rounded-t-lg relative flex items-end justify-center h-full overflow-hidden">
                                   <div className="w-full bg-gradient-to-t from-navy-light to-sky rounded-t-lg transition-all duration-700 ease-out" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '8%' : '0%' }}></div>
                               </div>
                               <span className="text-[9px] text-slate-600 mt-2 font-bold">{d.label}</span>
                               {d.dateStr && <span className="text-[8px] text-slate-500">{d.dateStr}</span>}
                           </div>
                       ))}
                   </div>
               </Card>
           );
       }

       function TopList({ title, items, unit }) {
           return (
               <Card>
                   <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{title}</h3>
                   {items.length === 0 && <div className="text-xs text-slate-500 py-2">Belum ada data.</div>}
                   <div className="space-y-2.5">
                       {items.map((it, i) => (
                           <div key={i} className="flex items-center gap-3">
                               <span className="w-5 h-5 rounded-full bg-navy-light text-sky-dim text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                               <span className="text-xs text-slate-800 font-medium flex-1 truncate">{it.label}</span>
                               <span className="text-[10px] text-slate-500 font-semibold">{it.count} {unit}</span>
                           </div>
                       ))}
                   </div>
               </Card>
           );
       }

       // ScrollFadeRow: baris pilihan yang bisa digeser horizontal (filter
       // periode, jendela waktu, dst.) — sebelumnya terpotong tanpa isyarat
       // apa pun kalau ada pilihan lain di luar layar (ditemukan saat uji
       // coba: "Bulan Ini"/"Tahun" di Riwayat kepotong tepat di tepi HP).
       // Gradient tipis di tepi kanan cukup untuk isyarat "geser lagi",
       // tanpa perlu javascript pelacak posisi scroll. fadeFrom disesuaikan
       // dengan warna latar di baliknya (slate-100 = latar halaman, white =
       // di dalam Card).
       function ScrollFadeRow({ children, fadeFrom = 'slate-100' }) {
           return (
               <div className="relative">
                   <div className="flex gap-1.5 overflow-x-auto pb-1">{children}</div>
                   <div className={`pointer-events-none absolute top-0 right-0 bottom-1 w-8 bg-gradient-to-l from-${fadeFrom} to-transparent`}></div>
               </div>
           );
       }

       // icon (path SVG, opsional) ditambahkan berdampingan dengan emoji -- BUKAN
       // pengganti -- supaya 11 pemanggil lama tetap jalan tanpa migrasi serentak
       // (audit desain Fase 3: migrasi call site dilakukan bertahap/terpisah).
       // Kirim salah satu: `icon` untuk line-art duotone navy/paper baru, atau
       // `emoji` seperti sebelumnya kalau belum sempat dimigrasi.
       function EmptyState({ emoji, icon, text }) {
           return (
               <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed border-slate-200">
                   {icon ? (
                       <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-navy/5 border border-navy/10 flex items-center justify-center">
                           <Icon path={icon} className="h-7 w-7 text-navy/40" />
                       </div>
                   ) : (
                       <div className="text-4xl mb-2">{emoji}</div>
                   )}
                   <div className="text-slate-500 text-xs font-medium px-6">{text}</div>
               </div>
           );
       }

       // Placeholder "kerangka" saat data sedang dimuat — lebih enak dilihat
       // daripada layar kosong atau tulisan "Memuat..." saja.
       function SkeletonCard() {
           return (
               <div className="bg-white border border-slate-200 p-3.5 rounded-xl space-y-2 animate-pulse">
                   <div className="flex items-center justify-between">
                       <div className="h-3.5 bg-slate-200 rounded w-1/3"></div>
                       <div className="h-4 bg-slate-200 rounded-full w-16"></div>
                   </div>
                   <div className="h-2.5 bg-slate-100 rounded w-1/2"></div>
               </div>
           );
       }

       function SkeletonList({ count = 4 }) {
           return (
               <div className="space-y-2.5">
                   {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
               </div>
           );
       }

       // ===== Layar Login =====
       // ATURAN YANG TIDAK BOLEH DILANGGAR LAGI DI SINI (ini bug nyata yang
       // pernah terjadi, bukan preferensi gaya):
       //
       // 1. Form ini HARUS bisa disentuh sejak frame pertama. Daftar nama guru
       //    (getLoginUsers) datang belakangan dari Apps Script yang lambat —
       //    JANGAN pernah men-disable field/tombol, memasang overlay, atau
       //    menunda render form sambil menunggu daftar itu.
       // 2. Struktur form TIDAK berubah antar state. Kotak "Nama Guru" selalu
       //    ada; yang berganti hanya ISI-nya (memuat / pencarian / pesan
       //    gagal). Sebelumnya ada field yang muncul lalu hilang sendiri
       //    beberapa detik kemudian dan itu bikin guru mengira aplikasi hang.
       // 3. Gagal memuat daftar = turun ke mode legacy (password saja, server
       //    mencocokkan ke semua akun) DENGAN pesan kecil + tombol "Coba
       //    lagi", bukan diam-diam.
       //
       // usersState: 'loading' | 'ready' | 'error'
       function LoginScreen({ onLogin, loading, error, password, setPassword, users, usersState, onRetryUsers, selectedTeacher, setSelectedTeacher }) {
           const [query, setQuery] = useState('');
           // Papan ketik HP dibuka sebagai keyboard HURUF (inputMode="text"),
           // bukan numpad -- yang dibagikan admin ke guru di sekolah ini adalah
           // PASSWORD (boleh mengandung huruf), bukan PIN angka. Sakelar
           // ABC/123 yang dulu ada di sini untuk pindah ke numpad DIHAPUS atas
           // permintaan eksplisit (bukan default -- lihat pagar CLAUDE.md soal
           // sakelar ini): guru yang password-nya kebetulan angka semua tetap
           // bisa mengetik lewat tombol angka bawaan di keyboard huruf standar
           // (long-press atau tombol "123" di keyboard itu sendiri).

           const userList = Array.isArray(users) ? users : [];
           const state = usersState || 'loading';
           const results = filterLoginUsers(userList, query);
           const showResults = !selectedTeacher && query.trim().length > 0;

           const pickTeacher = (teacher) => {
               setSelectedTeacher({ id: teacher.id, name: teacher.name });
               setQuery(''); // daftar hasil ikut tertutup karena showResults jadi false
           };

           const clearTeacher = () => {
               setSelectedTeacher(null);
               setQuery('');
           };

           // Tombol Masuk ada di bawah field password; tanpa ini keyboard HP
           // sering menutupinya persis setelah password diketik.
           const keepInView = (e) => {
               const el = e && e.target;
               if (el && typeof el.scrollIntoView === 'function') {
                   setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
               }
           };

           return (
               // min-h-[100dvh] (bukan 100vh) — dvh ikut mengecil saat keyboard
               // HP naik, jadi isi form tetap bisa di-scroll sampai tombol
               // Masuk kelihatan. pb-24 menyisakan ruang aman di bawahnya.
               <div className="min-h-[100dvh] overflow-y-auto flex flex-col justify-center p-6 pb-24 bg-slate-50">
                   <div className="w-full max-w-sm mx-auto">
                       <div className="text-center mb-8 mt-2">
                           <div className="relative inline-block mb-6">
                               <div className="absolute inset-0 bg-sky blur-[34px] opacity-20 rounded-[40px]"></div>
                               <img src="IMG_1966.jpeg" alt="Logo SMAN 2 Tarakan" className="relative w-40 h-40 object-contain bg-white rounded-[32px] mx-auto shadow-lg p-3 border border-slate-200" />
                           </div>
                           <h1 className="font-display text-3xl font-extrabold text-navy tracking-tight">SIGAP</h1>
                           <p className="text-[11px] text-slate-500 mt-2 font-semibold max-w-[280px] mx-auto leading-snug uppercase tracking-wide">
                               Sistem Informasi Gerbang &amp; Absensi Pelanggaran
                           </p>
                           <p className="text-[10px] text-slate-500 mt-1">SMAN 2 Tarakan</p>
                       </div>

                       <form onSubmit={onLogin} className="space-y-5 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                           {/* Kotak "Nama Guru" SELALU dirender (lihat aturan 2 di atas) —
                               isinya yang berganti sesuai usersState. */}
                           <div>
                               <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Nama Guru</label>

                               {selectedTeacher ? (
                                   <div className="w-full bg-sky-dim/10 border border-sky-dim/30 rounded-2xl px-4 py-3 flex items-center gap-3">
                                       <div className="min-w-0 flex-1">
                                           <div className="text-sm font-bold text-navy truncate">{selectedTeacher.name}</div>
                                           <div className="text-[10px] text-slate-500 mt-0.5">Bukan Anda? Ketuk Ganti.</div>
                                       </div>
                                       <button type="button" onClick={clearTeacher} className="flex-shrink-0 min-h-[44px] px-4 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-600 active:bg-slate-100 transition">
                                           Ganti
                                       </button>
                                   </div>
                               ) : (
                                   <React.Fragment>
                                       <div className="relative">
                                           <input
                                               type="text"
                                               value={query}
                                               onChange={(e) => setQuery(e.target.value)}
                                               onFocus={keepInView}
                                               placeholder="Cari nama guru..."
                                               autoComplete="off"
                                               className="w-full bg-slate-50 border border-slate-300 rounded-2xl pl-4 pr-11 py-3.5 text-sm text-slate-900 focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky transition"
                                           />
                                           <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />} className="h-5 w-5 absolute right-4 top-3.5 text-slate-500" />
                                       </div>
                                       {state === 'loading' && (
                                           <div className="text-[10px] text-slate-500 mt-1.5 px-1">Memuat daftar guru... Anda tetap bisa langsung mengisi password di bawah.</div>
                                       )}
                                       {state === 'error' && (
                                           <div className="flex items-center gap-2 mt-1.5 px-1">
                                               <span className="text-[10px] text-amber-700 flex-1">Daftar guru gagal dimuat. Login dengan password saja tetap bisa.</span>
                                               <button type="button" onClick={onRetryUsers} className="flex-shrink-0 text-[10px] font-bold text-sky-dim underline py-2 px-1">Coba lagi</button>
                                           </div>
                                       )}
                                       {showResults && state === 'ready' && (
                                           <div className="mt-2 border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
                                               {results.length === 0 ? (
                                                   <div className="px-4 py-3 text-xs text-slate-500">Nama tidak ditemukan.</div>
                                               ) : results.map(u => (
                                                   <button
                                                       key={u.id}
                                                       type="button"
                                                       onClick={() => pickTeacher(u)}
                                                       className="w-full text-left px-4 py-3 min-h-[48px] text-sm font-semibold text-slate-700 bg-white active:bg-sky-dim/10 transition"
                                                   >
                                                       {u.name}
                                                   </button>
                                               ))}
                                           </div>
                                       )}
                                   </React.Fragment>
                               )}
                           </div>

                           <div>
                               <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Password Petugas</label>
                               <input
                                   type="password"
                                   value={password}
                                   onChange={(e) => setPassword(e.target.value)}
                                   onFocus={keepInView}
                                   inputMode="text"
                                   autoComplete="current-password"
                                   placeholder="Masukkan password..."
                                   className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3.5 text-sm text-slate-900 focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky transition"
                                   required
                               />
                           </div>
                           {error && <div className="text-xs text-crimson font-medium text-center bg-crimson/10 border border-crimson/30 py-2 rounded-lg">{error}</div>}
                           <Button type="submit" disabled={loading} className="w-full shadow-[0_4px_14px_0_rgba(46,134,216,0.4)]">
                               {loading ? 'Memeriksa Akses...' : 'Masuk Aplikasi'}
                           </Button>
                       </form>
                   </div>
               </div>
           );
       }

       // Header dibuat seringkas mungkin — Aa-/Aa+/Keluar dipindah ke menu kecil
       // (bukan tombol permanen) karena jarang dipakai, supaya tidak memakan
       // ruang layar yang berharga bagi guru piket yang kerja satu tangan.
       // Prinsip "satu tangan, satu pandangan, satu keputusan": zona atas cuma
       // untuk identitas & pengaturan yang jarang disentuh.
       function Header({ user, roleLabel, onLogout, fontScale, onFontScaleChange, activeTab }) {
           const [showMenu, setShowMenu] = useState(false);
           // Menu ini tumpang tindih z-index dengan BottomNav (z-40 > overlay
           // penutup z-10 milik menu ini), jadi tap di BottomNav untuk pindah tab
           // tidak pernah "kena" overlay-nya -- menu tetap terbuka nyangkut di atas
           // tab baru sampai di-tap manual sekali lagi. Tutup otomatis begitu
           // activeTab berubah, supaya pindah tab = menu ikut tertutup.
           useEffect(() => { setShowMenu(false); }, [activeTab]);
           return (
               // bg-navy/95 (bukan opak) + backdrop-blur: pengecualian glassmorphism
               // yang memang diizinkan audit desain untuk header sticky. Hanya WARNA
               // yang berubah di sini -- padding/ukuran logo/struktur SAMA PERSIS
               // dengan sebelumnya, supaya tinggi header (dan pt-20 di app.js:688
               // yang bergantung padanya) tidak bergeser.
               <div className="fixed top-0 inset-x-0 z-30 bg-navy/95 backdrop-blur-md border-b border-white/10">
                   <div className="max-w-2xl mx-auto px-4 pt-4 pb-2.5 flex items-center justify-between">
                       <div className="flex items-center space-x-3 min-w-0">
                           <img src="IMG_1966.jpeg" alt="Logo" className="w-9 h-9 object-contain rounded-xl bg-white p-1 border border-white/20 flex-shrink-0" />
                           <div className="min-w-0">
                               <h1 className="font-display font-bold text-xs uppercase tracking-wider text-white truncate">SMAN 2 Tarakan</h1>
                               <div className="flex items-center gap-1.5 mt-0.5">
                                   <span className="text-[10px] text-white/70 truncate">{user.name}</span>
                                   <Badge tone="sky">{roleLabel}</Badge>
                               </div>
                           </div>
                       </div>
                       <div className="relative flex-shrink-0">
                           {/* p-3.5 (bukan p-2) — 16px ikon + padding pas menembus ambang
                               tap-target ≥44px (Roadmap Lanjutan SIGAP Fase 1, checklist
                               "audit ukuran tombol"), walau menu ini jarang dipakai. */}
                           <button onClick={() => setShowMenu(v => !v)} aria-label="Menu" className="p-3.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-600 transition">
                               <Icon path={<path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />} className="h-4 w-4" />
                           </button>
                           {showMenu && (
                               <React.Fragment>
                                   <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)}></div>
                                   <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl p-2 w-48 z-20 animate-pop">
                                       <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wide px-2 pt-1 pb-2">Ukuran Tulisan</div>
                                       <div className="flex items-center gap-1.5 px-2 pb-2">
                                           <button onClick={() => onFontScaleChange(-1)} aria-label="Perkecil huruf" className="flex-1 bg-slate-100 hover:bg-slate-200 rounded-lg py-1.5 text-xs font-bold text-slate-600 transition">Aa−</button>
                                           <button onClick={() => onFontScaleChange(1)} aria-label="Perbesar huruf" className="flex-1 bg-slate-100 hover:bg-slate-200 rounded-lg py-1.5 text-sm font-bold text-slate-600 transition">Aa+</button>
                                       </div>
                                       {/* border-t + mt-1.5 pt-1.5 (bukan langsung nempel di bawah
                                           Aa+/Aa-) -- dilaporkan: menu ukuran tulisan terlalu dekat
                                           dengan Keluar, gampang ke-tap keluar tanpa sengaja saat
                                           mau atur ukuran huruf. */}
                                       <div className="border-t border-slate-200 mt-1.5 pt-1.5">
                                           <button onClick={() => { setShowMenu(false); onLogout(); }} className="w-full text-left text-xs font-semibold text-crimson hover:bg-crimson/10 px-2.5 py-2.5 rounded-lg transition">Keluar</button>
                                       </div>
                                   </div>
                               </React.Fragment>
                           )}
                       </div>
                   </div>
               </div>
           );
       }

       function BottomNav({ menus, primaryMenus, activeTab, setActiveTab }) {
           const [showMore, setShowMore] = useState(false);
           const secondaryMenus = menus.filter(m => !primaryMenus.includes(m));
           const isSecondaryActive = secondaryMenus.includes(activeTab);

           return (
               <div className="fixed bottom-0 inset-x-0 z-40">
                   {showMore && secondaryMenus.length > 0 && (
                       <div className="max-w-2xl mx-auto px-4">
                           <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl p-2 mb-2 animate-pop">
                               {secondaryMenus.map(key => {
                                   const item = NAV_ITEMS[key];
                                   const active = activeTab === key;
                                   return (
                                       <button key={key} onClick={() => { setActiveTab(key); setShowMore(false); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${active ? 'bg-sky-dim/20 text-sky-dim' : 'text-slate-600 hover:bg-slate-100'}`}>
                                           <Icon path={item.icon()} filled={active} className="h-5 w-5" />
                                           <span className="text-xs font-semibold">{item.label}</span>
                                       </button>
                                   );
                               })}
                           </div>
                       </div>
                   )}
                   {/* Dikembalikan ke gaya semula (bg-white/95, aktif = sky-dim, tanpa
                       titik indikator) setelah laporan langsung dari HP asli: versi navy
                       + 6 item primer (audit desain) bikin BottomNav admin/BK overflow
                       horizontal, "Lainnya" (satu-satunya jalan ke menu Kelola) terdorong
                       keluar layar. px-3 -> px-2 supaya 5 item (4 primer + Lainnya) lebih
                       rapat dan tidak mepet di layar sempit. */}
                   <div className="bg-white/95 backdrop-blur-md border-t border-slate-200">
                       <div className="max-w-2xl mx-auto flex justify-around py-3 px-1 pb-safe">
                           {primaryMenus.map((key) => {
                               const item = NAV_ITEMS[key];
                               const active = activeTab === key;
                               return (
                                   <button key={key} onClick={() => { setActiveTab(key); setShowMore(false); }} className={`flex flex-col items-center space-y-1 transition-all duration-200 px-2 min-w-0 ${active ? 'text-sky-dim scale-110' : 'text-slate-500 hover:text-slate-600'}`}>
                                       <Icon path={item.icon()} filled={active} className="h-6 w-6" />
                                       {/* break-words -- label seperti "Pelanggaran" satu kata tanpa
                                           spasi, tidak bisa pindah baris secara alami; tanpa ini teks
                                           akan meluber dari tombolnya yang sudah disempitkan (min-w-0)
                                           di layar sempit, bukan patah ke baris ke-2. */}
                                       <span className="text-[10px] font-bold text-center break-words leading-tight">{item.label}</span>
                                   </button>
                               );
                           })}
                           {secondaryMenus.length > 0 && (
                               <button onClick={() => setShowMore(v => !v)} className={`flex flex-col items-center space-y-1 transition-all duration-200 px-2 min-w-0 ${isSecondaryActive || showMore ? 'text-sky-dim scale-110' : 'text-slate-500 hover:text-slate-600'}`}>
                                   <Icon path={<React.Fragment><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></React.Fragment>} filled={isSecondaryActive} className="h-6 w-6" />
                                   <span className="text-[10px] font-bold">Lainnya</span>
                               </button>
                           )}
                       </div>
                   </div>
               </div>
           );
       }

