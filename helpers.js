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

       // ===== Sesi login: SATU record utuh di localStorage =====
       // Dulu sesi disimpan sebagai TIGA kunci terpisah (sigap_session_token,
       // sigap_user, sigap_session_expires) yang ditulis lewat tiga setItem
       // berturut-turut di dalam satu try/catch. Kalau setItem kedua atau
       // ketiga gagal (kuota penuh — origin yang sama juga menulis snapshot
       // data ratusan KB, dan web app yang dipasang di Home Screen iOS punya
       // jatah penyimpanan sendiri yang lebih ketat daripada Safari), catch-nya
       // menelan error itu diam-diam dan menyisakan record ROBEK: token & user
       // ada, stempel kedaluwarsa tidak. Pembacanya lalu menyimpulkan "sesi
       // sudah lewat umur" dan layar login berteriak "Sesi sebelumnya sudah
       // berakhir" — padahal yang terjadi cuma tulisan yang gagal separuh.
       //
       // Satu record = satu setItem = tidak ada lagi keadaan separuh jadi.
       // Record yang tetap tidak bisa dibaca diperlakukan sebagai 'none'
       // (layar login biasa, TANPA pesan), bukan 'expired' — "tidak tahu"
       // bukan "sudah habis", dan pesan sesi habis hanya boleh muncul kalau
       // sesinya memang terbukti lewat umur.
       const SESSION_STORAGE_KEY = 'sigap_session';
       // Kunci format lama. Masih DIBACA (supaya deploy ini tidak melogout
       // siapa pun yang sedang login) dan dihapus begitu berhasil dimigrasi,
       // tapi tidak pernah ditulis lagi.
       const SESSION_LEGACY_KEYS = { token: 'sigap_session_token', user: 'sigap_user', expires: 'sigap_session_expires' };
       // Naikkan kalau BENTUK record berubah — record versi lama diabaikan
       // (jadi 'none'), bukan dibaca salah.
       const SESSION_RECORD_VERSION = 1;
       // Samakan dengan TTL createSession() di Auth.gs: 21600 detik adalah
       // batas MAKSIMUM satu CacheService.put() di Apps Script.
       const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

       function buildSessionRecord(token, user, expiresAt, loginAt) {
           return { v: SESSION_RECORD_VERSION, token: String(token || ''), user: user || null, expiresAt: Number(expiresAt) || 0, loginAt: Number(loginAt) || 0 };
       }

       // Fungsi, bukan satu objek konstan yang dipakai bersama: pemanggilnya
       // menyimpan hasil ini ke state dan objek yang dipakai ulang lintas
       // pemanggil adalah undangan bug yang sulit dilacak.
       function emptySession() { return { token: null, user: null, expired: false, expiresAt: 0, loginAt: 0 }; }
       function expiredSession() { return { token: null, user: null, expired: true, expiresAt: 0, loginAt: 0 }; }

       // expired:true HANYA untuk sesi yang benar-benar terbukti lewat umur.
       // Apa pun yang cuma "tidak terbaca" jatuh ke emptySession().
       function parseSessionRecord(raw, now) {
           const at = typeof now === 'number' ? now : Date.now();
           if (!raw) return emptySession();
           let parsed;
           try { parsed = JSON.parse(raw); } catch (e) { return emptySession(); }
           if (!parsed || typeof parsed !== 'object' || parsed.v !== SESSION_RECORD_VERSION) return emptySession();
           const token = parsed.token ? String(parsed.token) : '';
           const user = parsed.user && typeof parsed.user === 'object' ? parsed.user : null;
           const expiresAt = Number(parsed.expiresAt) || 0;
           if (!token || !user || !expiresAt) return emptySession();
           if (at >= expiresAt) return expiredSession();
           return { token: token, user: user, expired: false, expiresAt: expiresAt, loginAt: Number(parsed.loginAt) || 0 };
       }

       // Jalur kompatibilitas untuk tiga kunci lama. Aturannya DIPERTAHANKAN
       // persis seperti sebelumnya, termasuk "tanpa stempel = perlakukan
       // sebagai kedaluwarsa": di format lama, record tanpa stempel memang
       // tidak bisa dibedakan dari sesi versi aplikasi lawas yang umurnya
       // tidak diketahui, dan sekali login ulang jauh lebih baik daripada
       // merender tampilan "sudah login" dari sesi yang sebenarnya sudah mati.
       function parseLegacySession(rawToken, rawUser, rawExpires, now) {
           const at = typeof now === 'number' ? now : Date.now();
           if (!rawToken || !rawUser) return emptySession();
           let user;
           try { user = JSON.parse(rawUser); } catch (e) { return emptySession(); }
           if (!user || typeof user !== 'object') return emptySession();
           const expiresAt = parseInt(rawExpires || '0', 10);
           if (!expiresAt || at >= expiresAt) return expiredSession();
           return { token: String(rawToken), user: user, expired: false, expiresAt: expiresAt, loginAt: 0 };
       }

       // Satu-satunya tempat yang mendefinisikan "server bilang sesi habis".
       const SESSION_EXPIRED_PATTERN = /sesi berakhir/i;
       function isSessionExpiredResponse(data) {
           return !!(data && data.status === 'error' && SESSION_EXPIRED_PATTERN.test(String(data.message || '')));
       }

       // ===== Kapan "Sesi berakhir" boleh benar-benar melogout =====
       // Jawaban dari server SELALU datang belakangan, kadang belasan detik
       // setelah request-nya ditembakkan (Apps Script lambat, dan boot
       // menembakkan 7 request paralel sekaligus). Penjaga sesi yang lama cuma
       // mencocokkan TEKS pesannya, tanpa pernah menanyakan token mana yang
       // dipakai request itu — jadi jawaban milik sesi yang SUDAH mati bisa
       // mendarat setelah guru berhasil login ulang, dan ikut menghapus sesi
       // BARU yang baru berumur beberapa detik. Itulah "login berhasil lalu
       // langsung logout lagi" yang dilaporkan dari layar Home Screen: buka
       // dari ikon = cold start dari halaman yang ditinggal dalam keadaan
       // login, satu-satunya kondisi yang melahirkan sesi-tersimpan-tapi-mati.
       //
       // Aturannya sekarang: sebuah jawaban hanya boleh melogout kalau token
       // yang dipakai request itu MASIH token yang sedang aktif sekarang.
       function shouldClearSessionForResponse(data, tokenUsed, activeToken) {
           if (!isSessionExpiredResponse(data)) return false;
           if (!tokenUsed || !activeToken) return false; // request tanpa sesi / sudah logout
           return String(tokenUsed) === String(activeToken);
       }

       // Perpanjangan sesi. serverExpiresAt = field sessionExpiresAt yang
       // dikirim backend setiap kali ia berhasil memperpanjang sesi (lihat
       // getSessionUser di Auth.gs + jsonOut di Utils.gs).
       //
       // Backend yang BELUM di-deploy ulang tidak mengirim field ini sama
       // sekali → kembalikan stempel apa adanya, jadi perilakunya identik
       // dengan sebelum perubahan ini. Nilai dari server juga tidak pernah
       // boleh MEMENDEKKAN stempel atau memberi lebih dari satu TTL penuh —
       // sesi klien tidak boleh bisa dimatikan/diperpanjang liar oleh jawaban
       // yang aneh.
       function nextSessionExpiry(currentExpiresAt, serverExpiresAt, now) {
           const at = typeof now === 'number' ? now : Date.now();
           const current = Number(currentExpiresAt) || 0;
           const fromServer = Number(serverExpiresAt) || 0;
           if (!fromServer) return current;
           const capped = Math.min(fromServer, at + SESSION_MAX_AGE_MS);
           return capped > current ? capped : current;
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

       // ===== Gerbang: pencarian siswa (Catat Terlambat / Catat Surat) =====
       // Sama polanya seperti filterLoginUsers di atas -- diambil terpisah
       // (murni, bisa diuji tanpa React) setelah laporan lapangan: ketik "Ter"
       // memunculkan "Pretty Puteri" (cocok di tengah nama, "pu-TER-i") di
       // atas "Terra De Langit Muslim" (cocok persis di awal nama), karena
       // sebelumnya filter cuma pakai .filter() tanpa urutan relevansi sama
       // sekali -- hasil tampil dalam urutan asal data siswa, bukan seberapa
       // pas kecocokannya. Field yang cocok PALING AWAL (huruf ke berapa)
       // yang menang, nama/kelas/NISN semua diperiksa lalu diambil posisi
       // terbaik dari ketiganya.
       function filterStudents(students, query) {
           const list = Array.isArray(students) ? students : [];
           const q = String(query == null ? '' : query).trim().toLowerCase();
           if (!q) return [];
           const hits = [];
           for (const s of list) {
               if (!s || !s.name) continue;
               const name = String(s.name);
               const cls = String(s.class || '');
               const nisn = s.nisn == null ? '' : String(s.nisn);
               const positions = [name.toLowerCase().indexOf(q), cls.toLowerCase().indexOf(q), nisn.indexOf(q)].filter(p => p !== -1);
               if (positions.length === 0) continue;
               hits.push({ student: s, pos: Math.min(...positions) });
           }
           hits.sort((a, b) => (a.pos - b.pos) || (a.student.name < b.student.name ? -1 : a.student.name > b.student.name ? 1 : 0));
           return hits.map(h => h.student);
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
       const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

       // Format <input type="date"> (YYYY-MM-DD, LOKAL bukan UTC — beda dari
       // toISOString() yang bisa mundur/maju satu hari dekat tengah malam
       // tergantung zona waktu perangkat). Dulu didefinisikan sendiri-sendiri
       // di export-data.js; dipindah ke sini (helpers.js, dimuat lebih awal)
       // supaya admin.js (Pemeliharaan Data > Hapus Data) bisa memakainya juga
       // tanpa menduplikasi logika yang sama persis.
       function toDateInputValue(d) {
           const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
           const pad = (n) => (n < 10 ? '0' + n : String(n));
           return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
       }

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

       // ===== Izin Keluar: "pekerjaan yang menunggu SAYA" =====
       // SATU sumber kebenaran dipakai baik oleh badge di sakelar Gerbang
       // (gerbang.js) maupun ringkasan di Beranda (beranda-riwayat.js), supaya
       // keduanya tidak pernah menunjukkan angka berbeda untuk kondisi yang
       // sama. Prinsipnya: badge = pekerjaan yang menunggu tindakan, BUKAN
       // penghitung seluruh transaksi izin keluar.
       //
       // Hanya status 'Menunggu Verifikasi' yang dihitung — 'Sedang di Luar'
       // memang masih kondisi operasional aktif (makanya tetap tampil penuh di
       // halaman Izin Keluar), tapi TIDAK butuh tindakan baru dari user sampai
       // siswanya benar-benar kembali, jadi tidak masuk badge.
       //
       // Digerbangi `canVerify` — nilai yang SAMA yang sudah dikirim server
       // lewat getIzinKeluar (canVerifyIzin() di Utils.gs, dari Jadwal_Piket +
       // fallback admin/BK). Kalau false, hasilnya SELALU 0: begitu sebuah izin
       // diajukan, guru pemberi persetujuan tidak punya aksi lain apa pun atas
       // baris itu (semua aksi verifikasi/tandai kembali/dst di Code.gs
       // menolak siapa pun selain Guru Piket bertugas/admin/BK) — jadi memang
       // tidak ada "pekerjaan menunggu" baginya, bukan disembunyikan.
       //
       // izinList & kelompokList SUDAH disaring server (scopeIzinForUser) —
       // fungsi ini murni menghitung ulang dari data yang sudah berwenang
       // diterima pemanggil, tidak menentukan cakupan apa pun sendiri.
       //
       // Satu kegiatan Izin Kelompok dihitung SATU (bukan per siswa) selama
       // masih ada minimal satu pesertanya yang 'Menunggu Verifikasi' — sesuai
       // dengan satu ketukan "Verifikasi Kelompok" yang menuntaskan satu
       // kegiatan sekaligus, persis seperti yang terlihat user di daftar
       // "Menunggu Verifikasi" masing-masing panel (gerbang.js).
       function hitungIzinMenungguVerifikasi(izinList, kelompokList, canVerify) {
           if (!canVerify) return 0;
           const izin = izinList || [];
           const individual = izin.filter(i => !i.kelompok_id && i.status === 'Menunggu Verifikasi').length;
           const kelompokMenunggu = (kelompokList || []).filter(k =>
               izin.some(i => i.kelompok_id === k.id && i.status === 'Menunggu Verifikasi')
           ).length;
           return individual + kelompokMenunggu;
       }

       // Ringkasan Izin Keluar untuk kartu ke-4 di Beranda. Sengaja dipisah
       // dari hitungIzinMenungguVerifikasi (yang tetap jadi SATU sumber angka
       // badge) dan justru MEMANGGILNYA, supaya angka "menunggu verifikasi"
       // di kartu Beranda, di kalimat notifikasi, dan di badge sakelar Gerbang
       // tidak akan pernah berbeda.
       //
       // Tiga angka, tiga satuan yang berbeda dan masing-masing diberi label
       // sesuai satuannya — jangan disatukan:
       //   hariIni  = jumlah SISWA yang punya baris izin hari ini (apa pun
       //              statusnya, termasuk yang sudah selesai/ditutup). Sejajar
       //              dengan tiga kartu lain di Beranda yang juga "hari ini".
       //   menunggu = jumlah PEKERJAAN verifikasi yang menunggu pengguna ini
       //              (kegiatan kelompok dihitung SATU, sama dengan badge) —
       //              0 kalau pengguna memang tidak berwenang memverifikasi.
       //   diLuar   = jumlah SISWA yang saat ini masih di luar sekolah, tanpa
       //              batas tanggal: siswa yang belum ditandai kembali dari
       //              kemarin justru kondisi yang paling perlu terlihat.
       //
       // Transaksi 'Kembali'/'Pulang'/'Selesai' TIDAK pernah masuk `menunggu`
       // maupun `diLuar` — keduanya adalah "pekerjaan/keadaan berjalan", bukan
       // penghitung riwayat. Riwayatnya tetap utuh dan tetap bisa ditelusuri
       // di menu Riwayat sesuai cakupan yang sudah ada.
       function ringkasIzinBeranda(izinList, kelompokList, canVerify) {
           const izin = izinList || [];
           const today = new Date();
           const hariIni = izin.filter(i => isSameDay(parseTimestamp(i.timestamp), today)).length;
           const menunggu = hitungIzinMenungguVerifikasi(izin, kelompokList, canVerify);
           const diLuar = izin.filter(i => i.status === 'Sedang di Luar').length;
           // Satu keterangan kecil saja — yang paling menuntut tindakan lebih
           // dulu. Dashboard tidak dipadati dengan semua angka sekaligus.
           const hint = menunggu > 0
               ? menunggu + ' menunggu verifikasi'
               : (diLuar > 0 ? diLuar + ' siswa di luar' : '');
           return { hariIni: hariIni, menunggu: menunggu, diLuar: diLuar, hint: hint };
       }

       // ===== Izin Keluar: label peran di jejak audit kartu =====
       // "Disetujui oleh: Wali Kelas — Nama" vs "Disetujui oleh: Guru Mapel —
       // Nama" pada KARTU transaksi (Gerbang), bukan cuma di baris Audit Log
       // (yang admin-only dan sudah menghitungnya sendiri di server lewat
       // izinKonteksPersetujuan(), Utils.gs). Baris Izin_Keluar TIDAK
       // menyimpan konteks itu sebagai kolom (keputusan yang sudah ada —
       // server cuma menuliskannya ke detail Audit Log), jadi label kartu ini
       // MURNI DIHITUNG ULANG di klien dari data yang sudah ada di layar:
       // kelas siswa (izin.class) dicocokkan ke peta wali kelas sekolah
       // (waliByClass, sudah dibangun dari getLoginUsers/waliKelasMap) lalu
       // dibandingkan ke NAMA yang tercatat menyetujui (izin.disetujui_oleh).
       //
       // Ini BUKAN klaim jadwal mengajar dan BUKAN role — sama seperti
       // konteksUntuk() di gerbang.js (dipakai SEBELUM submit, untuk kartu
       // konteks), cuma versi baca-belakangan untuk transaksi yang sudah
       // tersimpan. Server tidak pernah dipercaya membawa nilai ini balik;
       // dihitung ulang di dua tempat secara independen (audit log & kartu)
       // dari fakta yang sama (kelas siswa + peta wali kelas), bukan
       // saling mewarisi.
       //
       // Jalur khusus (Izin Khusus) SENGAJA tidak pernah dilabeli Wali
       // Kelas/Guru Mapel — Disetujui_Oleh pada baris itu adalah petugas
       // piket yang mengambil keputusan pengecualian, bukan guru yang
       // menangani siswa (yang justru sedang tidak tersedia, itulah kenapa
       // jalur khusus dipakai).
       function izinPeranPersetujuan(izin, waliByClass) {
           if (!izin) return '';
           if (izin.jalur === 'khusus') return 'khusus';
           const wali = (waliByClass || {})[normalizeClass(izin.class)];
           const namaWali = String(wali || '').trim();
           const namaPersetuju = String(izin.disetujui_oleh || '').trim();
           return (namaWali && namaWali === namaPersetuju) ? 'wali_kelas' : 'guru_mapel';
       }

       function izinPeranLabel(peran) {
           if (peran === 'wali_kelas') return 'Wali Kelas';
           if (peran === 'guru_mapel') return 'Guru Mapel';
           return '';
       }

       // ===== Izin Keluar: kapasitas verifikasi (audit Agustus 2026) =====
       // "Diverifikasi oleh: Guru Piket — Nama" vs "Diverifikasi oleh:
       // BK/Kesiswaan — Nama". Bug yang diperbaiki: kartu sebelumnya menulis
       // "Guru Piket" untuk SEMUA verifikasi tanpa syarat, jadi akun
       // BK/Kesiswaan yang mengambil alih TANPA sedang piket tercatat
       // seolah-olah dia memang petugas piket hari itu.
       //
       // Kapasitas SEBENARNYA sudah ditentukan & dikirim SERVER
       // (izinKapasitasVerifikasi/izinKapasitasBaris di Utils.gs, dari sesi +
       // Jadwal_Piket saat aksi dijalankan — bukan cuma role akun, dan bukan
       // klaim klien) sebagai izin.diverifikasi_kapasitas /
       // izin.dicatat_kembali_kapasitas / kelompok.diverifikasi_kapasitas.
       // Fungsi ini MURNI pemetaan kode -> label tampilan, tidak menghitung
       // ulang otorisasi apa pun — kalau field ini kosong (baris belum
       // diverifikasi/ditandai kembali, atau data lama sebelum kolom ini
       // ada), kartu tidak menampilkan label sama sekali.
       function izinKapasitasLabel(kapasitas) {
           if (kapasitas === 'guru_piket') return 'Guru Piket';
           if (kapasitas === 'bk_kesiswaan') return 'BK/Kesiswaan';
           return '';
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

