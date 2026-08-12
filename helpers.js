// ===== helpers.js =====
// Fungsi bantu murni (bukan tampilan): format tanggal, hitung periode,
// bikin data grafik, ekspor CSV. Dipakai oleh hampir semua file tab.


       // ===== Cache data di sisi klien (localStorage) =====
       // Masalah yang dipecahkan: setiap refresh halaman, SEMUA state data
       // kembali ke [] dan aplikasi mengunduh ulang seluruh dataset dari Apps
       // Script (lambat) sebelum ada apa pun yang bisa dilihat. Padahal data
       // yang sama baru saja ada di layar sedetik sebelumnya.
       //
       // Aturan main yang TIDAK boleh dilanggar:
       // 1. Tidak pernah menyimpan PIN/password/hash/salt/token sesi. Yang
       //    disimpan hanya data operasional yang memang sudah tampil di layar.
       // 2. Terikat ke satu pengguna (userId) — HP yang dipakai bergantian
       //    tidak boleh menampilkan data pengguna sebelumnya.
       // 3. Terikat ke masa berlaku sesi. Cache yang lebih tua dari sesi
       //    server dibuang, jadi cache TIDAK PERNAH bisa membuat orang
       //    terlihat masih login (lihat clearSession + loadStoredSession).
       // 4. Dibuang total saat logout / sesi berakhir.
       // 5. Data dari cache SELALU ditandai di UI sebagai "sedang diperbarui",
       //    tidak pernah disajikan diam-diam sebagai data final.
       const CLIENT_CACHE_KEY = 'sigap_data_cache';
       // Naikkan kalau BENTUK data yang disimpan berubah (nama field, dsb) —
       // cache versi lama akan diabaikan, bukan dibaca salah.
       const CLIENT_CACHE_VERSION = 1;
       // Batas jumlah baris per daftar. Log_Gerbang setahun bisa puluhan ribu
       // baris; disimpan utuh, localStorage (±5MB) jebol dan penyimpanannya
       // sendiri jadi lambat. Daftar dari server sudah urut terbaru-dulu, jadi
       // potongan ini selalu berisi yang paling relevan. Kalau terpotong,
       // ditandai `truncated` supaya UI tahu ini belum lengkap.
       const CLIENT_CACHE_MAX_ROWS = 800;

       function buildClientCache(userId, datasets, expiresAt) {
           const payload = { v: CLIENT_CACHE_VERSION, userId: String(userId || ''), savedAt: Date.now(), expiresAt: expiresAt || 0, truncated: false, data: {} };
           Object.keys(datasets || {}).forEach(key => {
               const value = datasets[key];
               if (!Array.isArray(value)) return;
               if (value.length > CLIENT_CACHE_MAX_ROWS) {
                   payload.truncated = true;
                   payload.data[key] = value.slice(0, CLIENT_CACHE_MAX_ROWS);
               } else {
                   payload.data[key] = value;
               }
           });
           return payload;
       }

       function readClientCache(raw, userId, now) {
           const at = typeof now === 'number' ? now : Date.now();
           if (!raw) return null;
           let parsed;
           try { parsed = JSON.parse(raw); } catch (e) { return null; }
           if (!parsed || parsed.v !== CLIENT_CACHE_VERSION) return null;
           if (!parsed.data || typeof parsed.data !== 'object') return null;
           // Pengguna lain (HP dipakai bergantian) — jangan pernah tampilkan.
           if (String(parsed.userId || '') !== String(userId || '')) return null;
           // Sesi server sudah lewat umur — cache ikut mati bersamanya.
           if (!parsed.expiresAt || at >= parsed.expiresAt) return null;
           return parsed;
       }

       // ===== Layar Login: pencarian nama guru =====
       // Dipisah dari LoginScreen (murni, tanpa React) supaya logikanya bisa
       // diuji langsung di tests/login.test.js.
       //
       // Sengaja hanya mengembalikan {id, name}: apa pun field lain yang ikut
       // terbawa dari server (role/jabatan/status) dibuang di sini, supaya
       // tidak ada jalan untuk tidak sengaja menampilkannya di layar login.
       const LOGIN_SEARCH_LIMIT = 8;

       function filterLoginUsers(users, query, limit) {
           const list = Array.isArray(users) ? users : [];
           const q = String(query == null ? '' : query).trim().toLowerCase();
           if (!q) return [];
           const max = typeof limit === 'number' ? limit : LOGIN_SEARCH_LIMIT;
           const hits = [];
           for (const u of list) {
               if (!u || !u.id || !u.name) continue;
               const name = String(u.name);
               const pos = name.toLowerCase().indexOf(q);
               if (pos === -1) continue;
               hits.push({ id: String(u.id), name: name, pos: pos });
           }
           // Yang cocok di awal nama muncul lebih dulu — mengetik 1-2 huruf
           // ("ka") harus memunculkan "Kartina" di atas "Bu Eka".
           hits.sort((a, b) => (a.pos - b.pos) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
           return hits.slice(0, max).map(h => ({ id: h.id, name: h.name }));
       }

       // Body request login. teacherId hanya ikut kalau guru benar-benar
       // memilih namanya; kalau tidak, dikirim tanpa teacherId sehingga
       // server jatuh ke jalur legacy (cocokkan password ke semua akun).
       function buildLoginPayload(password, teacher, apiToken) {
           const payload = { action: 'login', password: password, token: apiToken };
           if (teacher && teacher.id) payload.teacherId = String(teacher.id);
           return payload;
       }

       function Icon({ path, className = "h-5 w-5", filled = false }) {
           return (
               <svg xmlns="http://www.w3.org/2000/svg" className={className} fill={filled ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={filled ? 0 : 1.6}>
                   {path}
               </svg>
           );
       }

       // Nama kelas diketik manual di beberapa tempat (Master_Siswa, Kelola > Wali
       // Kelas, dst.) — jadi rawan beda spasi/huruf besar-kecil ("XI IPA 1" vs
       // "xi ipa 1 "), DAN rawan beda format sama sekali antara catatan lama vs
       // Master_Siswa yang sudah diubah (mis. catatan lama "XI A" sementara
       // Master_Siswa sekarang "XI.A (KESEHATAN I)" setelah nama kelas ditambah
       // keterangan peminatan). Keterangan dalam kurung & tanda titik/strip
       // dibuang dulu supaya keduanya cocok jadi "xi a". Dipakai di mana pun perlu
       // MENCOCOKKAN kelas (Rekap Kelas, ringkasan kelas perwalian di Dashboard);
       // untuk TAMPILAN tetap pakai nilai aslinya, cuma perbandingannya yang
       // ditoleransi.
       function normalizeClass(c) {
           return String(c || '')
               .replace(/\([^)]*\)/g, '')
               .replace(/[.\-]/g, ' ')
               .trim().toLowerCase().replace(/\s+/g, ' ');
       }
       function sameClass(a, b) {
           return normalizeClass(a) === normalizeClass(b);
       }

       function parseTimestamp(ts) {
           if (!ts) return new Date();
           if (typeof ts === 'string') {
               if (ts.includes('/')) {
                   const parts = ts.trim().split(' ');
                   const dateParts = parts[0].split('/');
                   if (dateParts.length === 3) {
                       const day = dateParts[0].padStart(2, '0');
                       const month = dateParts[1].padStart(2, '0');
                       const year = dateParts[2];
                       const timePart = parts[1] ? parts[1] + (parts[1].split(':').length === 2 ? ':00' : '') : '00:00:00';
                       const formatted = `${year}-${month}-${day}T${timePart}`;
                       const d = new Date(formatted);
                       if (!isNaN(d.getTime())) return d;
                   }
               }
           }
           const fallback = new Date(ts);
           return isNaN(fallback.getTime()) ? new Date() : fallback;
       }

       const isSameDay = (a, b) => a.toDateString() === b.toDateString();
       const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x; };
       const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

       function getSemesterInfo(d) {
           const m = d.getMonth();
           if (m >= 6) return { label: 'Semester Ganjil', months: [6,7,8,9,10,11], year: d.getFullYear() };
           return { label: 'Semester Genap', months: [0,1,2,3,4,5], year: d.getFullYear() };
       }

       function inRange(ts, start, end) { const t = parseTimestamp(ts).getTime(); return t >= start.getTime() && t <= end.getTime(); }

       function countInRange(logs, start, end) {
           return logs.filter(l => inRange(l.timestamp, start, end)).length;
       }

       function topN(logs, keyFn, n = 3) {
           const map = {};
           logs.forEach(l => { const k = keyFn(l) || '—'; map[k] = (map[k] || 0) + 1; });
           return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
       }

       // Kelompokkan catatan terlambat per siswa dalam rentang waktu tertentu —
       // dipakai bareng oleh banner "Siswa Sering Terlambat" di Beranda dan
       // daftar sejenis di Statistik, supaya logikanya tidak ditulis dua kali.
       // resolvedMap (opsional): { nisn: tanggalTerakhirDisetujui } — dari fitur
       // Tindak Lanjut. Kejadian SEBELUM tanggal itu tidak lagi dihitung (siswa
       // dianggap "mulai dari nol" sejak tindak lanjutnya disetujui admin),
       // tapi kejadian BARU setelahnya tetap terhitung wajar.
       function groupLateByStudent(allLogs, startDate, endDate, resolvedMap) {
           const map = {};
           allLogs.forEach(l => {
               const dt = parseTimestamp(l.timestamp);
               const cutoff = resolvedMap && resolvedMap[l.nisn];
               const effectiveStart = cutoff && cutoff > startDate ? cutoff : startDate;
               if (dt >= effectiveStart && dt <= endDate) {
                   if (!map[l.nisn]) map[l.nisn] = { nisn: l.nisn, name: l.name, class: l.class, count: 0 };
                   map[l.nisn].count++;
               }
           });
           return Object.values(map).sort((a, b) => b.count - a.count);
       }

       // Bangun peta nisn -> tanggal disetujui TERBARU dari daftar Tindak Lanjut
       // yang statusnya 'selesai' — dipakai groupLateByStudent/
       // getFrequentLatecomersBanner sebagai titik reset hitungan.
       function buildResolvedMap(tindakLanjutList) {
           const map = {};
           (tindakLanjutList || []).forEach(t => {
               if (t.status !== 'selesai' || !t.tanggalDisetujui) return;
               const d = parseTimestamp(t.tanggalDisetujui);
               if (!map[t.nisn] || d > map[t.nisn]) map[t.nisn] = d;
           });
           return map;
       }

       // Ambang batas untuk banner Beranda: sudah 3x terlambat (dihitung sejak
       // TERAKHIR ditindaklanjuti — atau sejak awal kalau belum pernah). SENGAJA
       // TIDAK pakai jendela waktu (rolling ataupun kalender) — begitu seorang
       // siswa mencapai 3x, dia harus TETAP muncul di banner ini sampai ada yang
       // menindaklanjuti & disetujui admin, tidak boleh hilang sendiri cuma
       // karena waktu berlalu (itu sebabnya fiturnya disebut "tindak lanjut",
       // bukan "otomatis selesai"). Lihat buildResolvedMap untuk titik reset.
       function getFrequentLatecomersBanner(allLogs, resolvedMap) {
           const map = {};
           allLogs.forEach(l => {
               const cutoff = resolvedMap && resolvedMap[l.nisn];
               const dt = parseTimestamp(l.timestamp);
               if (cutoff && dt <= cutoff) return;
               if (!map[l.nisn]) map[l.nisn] = { nisn: l.nisn, name: l.name, class: l.class, count: 0, first: dt };
               map[l.nisn].count++;
               if (dt < map[l.nisn].first) map[l.nisn].first = dt;
           });
           return Object.values(map).filter(s => s.count >= 3).sort((a, b) => b.count - a.count);
       }

       function buildPeriodSeries(period, logs) {
           const now = new Date();
           if (period === '5hari') {
               const days = [];
               let cursor = new Date(now);
               while (days.length < 5) {
                   if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days.unshift(new Date(cursor));
                   cursor.setDate(cursor.getDate() - 1);
               }
               return days.map(d => ({ 
                   label: d.toLocaleDateString('id-ID', { weekday: 'short' }), 
                   dateStr: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
                   count: logs.filter(l => isSameDay(parseTimestamp(l.timestamp), d)).length 
               }));
           }
           if (period === 'mingguan') {
               const start = startOfWeek(now);
               return Array.from({ length: 7 }, (_, i) => {
                   const d = new Date(start); d.setDate(start.getDate() + i);
                   return { 
                       label: d.toLocaleDateString('id-ID', { weekday: 'short' }), 
                       dateStr: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
                       count: logs.filter(l => isSameDay(parseTimestamp(l.timestamp), d)).length 
                   };
               });
           }
           if (period === 'bulanan') {
               const start = startOfMonth(now);
               const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
               const weeks = Math.ceil(daysInMonth / 7);
               return Array.from({ length: weeks }, (_, i) => {
                   const wStart = new Date(start); wStart.setDate(start.getDate() + i * 7);
                   const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 6); wEnd.setHours(23,59,59,999);
                   return { label: `M${i + 1}`, dateStr: `${wStart.getDate()}-${wEnd.getDate()}`, count: countInRange(logs, wStart, wEnd) };
               });
           }
           if (period === 'semester') {
               const info = getSemesterInfo(now);
               return info.months.map(m => {
                   const s = new Date(info.year, m, 1); const e = new Date(info.year, m + 1, 0, 23, 59, 59, 999);
                   return { label: s.toLocaleDateString('id-ID', { month: 'short' }), count: countInRange(logs, s, e) };
               });
           }
           return Array.from({ length: 12 }, (_, m) => {
               const s = new Date(now.getFullYear(), m, 1); const e = new Date(now.getFullYear(), m + 1, 0, 23, 59, 59, 999);
               return { label: s.toLocaleDateString('id-ID', { month: 'short' }), count: countInRange(logs, s, e) };
           });
       }

       function exportCSV(logs, filenameHint) {
           const header = ['Nama', 'NISN', 'Kelas', 'Alasan', 'Tanggal', 'Waktu', 'Dicatat Oleh'];
           const rows = logs.map(l => {
               const dt = parseTimestamp(l.timestamp);
               return [
                   l.name, l.nisn || '', l.class, l.type,
                   dt.toLocaleDateString('id-ID'),
                   dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                   l.logged_by || '',
               ];
           });
           const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
           const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
           const url = URL.createObjectURL(blob);
           const a = document.createElement('a');
           a.href = url; a.download = `SIGAP_${filenameHint}_${new Date().toISOString().slice(0, 10)}.csv`;
           document.body.appendChild(a); a.click(); document.body.removeChild(a);
           URL.revokeObjectURL(url);
       }

