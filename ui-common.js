// ===== ui-common.js =====
// Komponen tampilan kecil yang dipakai berulang (Badge, kartu statistik,
// grafik batang, dll), plus layar Login, Header, dan Bottom Navigation.

       function Badge({ children, tone = 'sky' }) {
           const tones = { sky: 'bg-sky-dim/30 text-sky-dim border-sky-dim/60', crimson: 'bg-crimson/15 text-crimson border-crimson/40', ink: 'bg-slate-100 text-slate-600 border-slate-300' };
           return <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${tones[tone]}`}>{children}</span>;
       }

       function StatCard({ value, label, accent = false }) {
           return (
               <div className={`p-4 rounded-2xl text-center border ${accent ? 'bg-sky-dim/15 border-sky-dim/40' : 'bg-white border-slate-200'}`}>
                   <div className={`font-display text-3xl font-extrabold ${accent ? 'text-sky-dim' : 'text-slate-800'}`}>{value}</div>
                   <div className="text-[10px] text-slate-500 mt-1 font-semibold uppercase tracking-wide">{label}</div>
               </div>
           );
       }

       function BarChart({ data, title }) {
           const max = Math.max(...data.map(d => d.count), 1);
           return (
               <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-lg">
                   {title && <h3 className="text-xs font-display font-bold text-slate-800 mb-4 text-center">{title}</h3>}
                   <div className="flex items-end justify-between h-36 gap-1.5">
                       {data.map((d, i) => (
                           <div key={i} className="flex flex-col items-center flex-1 h-full">
                               <span className="text-[10px] text-sky-dim font-bold mb-1.5">{d.count > 0 ? d.count : '·'}</span>
                               <div className="w-full max-w-[28px] bg-slate-200/60 rounded-t-lg relative flex items-end justify-center h-full overflow-hidden">
                                   <div className="w-full bg-gradient-to-t from-navy-light to-sky rounded-t-lg transition-all duration-700 ease-out" style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '8%' : '0%' }}></div>
                               </div>
                               <span className="text-[9px] text-slate-600 mt-2 font-bold">{d.label}</span>
                               {d.dateStr && <span className="text-[8px] text-slate-400">{d.dateStr}</span>}
                           </div>
                       ))}
                   </div>
               </div>
           );
       }

       function TopList({ title, items, unit }) {
           return (
               <div className="bg-white border border-slate-200 rounded-2xl p-4">
                   <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{title}</h3>
                   {items.length === 0 && <div className="text-xs text-slate-400 py-2">Belum ada data.</div>}
                   <div className="space-y-2.5">
                       {items.map((it, i) => (
                           <div key={i} className="flex items-center gap-3">
                               <span className="w-5 h-5 rounded-full bg-navy-light text-sky-dim text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                               <span className="text-xs text-slate-800 font-medium flex-1 truncate">{it.label}</span>
                               <span className="text-[10px] text-slate-500 font-semibold">{it.count} {unit}</span>
                           </div>
                       ))}
                   </div>
               </div>
           );
       }

       function EmptyState({ emoji, text }) {
           return (
               <div className="text-center py-16 bg-white/50 rounded-2xl border border-dashed border-slate-200">
                   <div className="text-4xl mb-2">{emoji}</div>
                   <div className="text-slate-500 text-xs font-medium px-6">{text}</div>
               </div>
           );
       }

       function LoginScreen({ onLogin, loading, error, password, setPassword }) {
           return (
               <div className="min-h-screen flex flex-col justify-center p-6 bg-slate-50">
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
                           <p className="text-[10px] text-slate-400 mt-1">SMAN 2 Tarakan</p>
                       </div>

                       <form onSubmit={onLogin} className="space-y-5 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                           <div>
                               <label className="text-xs text-slate-500 font-semibold mb-1.5 block">Password Petugas</label>
                               <input
                                   type="password"
                                   value={password}
                                   onChange={(e) => setPassword(e.target.value)}
                                   placeholder="Masukkan password..."
                                   className="w-full bg-slate-50 border border-slate-300 rounded-2xl px-4 py-3.5 text-sm text-slate-900 focus:outline-none focus:border-sky focus:ring-1 focus:ring-sky transition"
                                   required
                               />
                           </div>
                           {error && <div className="text-xs text-crimson font-medium text-center bg-crimson/10 border border-crimson/30 py-2 rounded-lg">{error}</div>}
                           <button type="submit" disabled={loading} className="w-full bg-sky hover:bg-sky-light text-white py-3.5 rounded-2xl font-bold text-sm shadow-[0_4px_14px_0_rgba(46,134,216,0.4)] transition active:scale-95 disabled:opacity-50">
                               {loading ? 'Memeriksa Akses...' : 'Masuk Aplikasi'}
                           </button>
                       </form>
                   </div>
               </div>
           );
       }

       function Header({ user, roleLabel, onLogout, fontScale, onFontScaleChange }) {
           return (
               <div className="fixed top-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
                   <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
                       <div className="flex items-center space-x-3 min-w-0">
                           <img src="IMG_1966.jpeg" alt="Logo" className="w-10 h-10 object-contain rounded-xl bg-white p-1 border border-slate-300 flex-shrink-0" />
                           <div className="min-w-0">
                               <h1 className="font-display font-bold text-xs uppercase tracking-wider text-sky-dim truncate">SMAN 2 Tarakan</h1>
                               <div className="flex items-center gap-1.5 mt-0.5">
                                   <span className="text-[10px] text-slate-500 truncate">{user.name}</span>
                                   <Badge tone="sky">{roleLabel}</Badge>
                               </div>
                           </div>
                       </div>
                       <div className="flex items-center gap-1.5 flex-shrink-0">
                           <div className="flex items-center bg-slate-100 rounded-lg border border-slate-300 overflow-hidden">
                               <button onClick={() => onFontScaleChange(-1)} aria-label="Perkecil huruf" className="px-2 py-1.5 text-slate-600 hover:bg-slate-200 text-xs font-bold">Aa−</button>
                               <button onClick={() => onFontScaleChange(1)} aria-label="Perbesar huruf" className="px-2 py-1.5 text-slate-600 hover:bg-slate-200 text-sm font-bold border-l border-slate-300">Aa+</button>
                           </div>
                           <button onClick={onLogout} className="text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl border border-slate-300 transition shadow-sm">
                               Keluar
                           </button>
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
                   <div className="bg-white/95 backdrop-blur-md border-t border-slate-200">
                       <div className="max-w-2xl mx-auto flex justify-around py-3 px-2 pb-safe">
                           {primaryMenus.map((key) => {
                               const item = NAV_ITEMS[key];
                               const active = activeTab === key;
                               return (
                                   <button key={key} onClick={() => { setActiveTab(key); setShowMore(false); }} className={`flex flex-col items-center space-y-1 transition-all duration-200 px-3 ${active ? 'text-sky-dim scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
                                       <Icon path={item.icon()} filled={active} className="h-6 w-6" />
                                       <span className="text-[10px] font-bold">{item.label}</span>
                                   </button>
                               );
                           })}
                           {secondaryMenus.length > 0 && (
                               <button onClick={() => setShowMore(v => !v)} className={`flex flex-col items-center space-y-1 transition-all duration-200 px-3 ${isSecondaryActive || showMore ? 'text-sky-dim scale-110' : 'text-slate-400 hover:text-slate-600'}`}>
                                   <Icon path={<React.Fragment><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></React.Fragment>} filled={isSecondaryActive} className="h-6 w-6" />
                                   <span className="text-[10px] font-bold">Lainnya</span>
                               </button>
                           )}
                       </div>
                   </div>
               </div>
           );
       }

