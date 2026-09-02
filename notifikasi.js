// ===== notifikasi.js =====
// Push Notification: onboarding + halaman setelan + runtime (registrasi
// service worker, subscribe/unsubscribe, deep-link klik notifikasi).
//
// PRINSIP KERAS yang dijaga di seluruh file ini (lihat CLAUDE.md, bagian
// Push Notification, & Notifikasi.gs untuk sisi server):
//   - TIDAK PERNAH memunculkan permintaan izin browser tanpa konteks — selalu
//     lewat tombol yang penjelasannya sudah tampil duluan (NotifikasiOnboardingBanner
//     / NotifikasiTab), tidak pernah otomatis saat komponen mount.
//   - Menekan notifikasi BUKAN jalan pintas otorisasi — cuma memindahkan tab
//     yang ditampilkan (lewat token ?goto=), sesi & RBAC tetap diperiksa
//     ulang oleh setiap pemanggilan API seperti biasa.
//   - Subscription SELALU terikat ke sessionToken yang sedang login saat itu
//     (server yang menentukan Guru_ID, lihat savePushSubscription di
//     Code.gs) — file ini tidak pernah mengirim id guru sendiri ke server.

// ===== Deteksi kemampuan & platform =====
// typeof-guard di setiap fungsi platform di bawah ini BUKAN gaya penulisan
// belaka: file ini ikut dimuat & dijalankan (App() dipanggil sungguhan) oleh
// beberapa test harness (lihat tests/session.test.js dkk.) yang sandbox-nya
// TIDAK selalu menyediakan `navigator`/`window` sama sekali -- referensi
// bare `navigator`/`window` di situ ber-throw ReferenceError, bukan sekadar
// `undefined`, dan mematahkan App() lebih dulu sebelum sempat merender apa
// pun. Jangan hapus guard ini walau di browser sungguhan variabel itu selalu ada.
function pushIsSupported() {
  return typeof navigator !== 'undefined' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

function pushIsIOS() {
  var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  // iPadOS terbaru melaporkan diri sebagai "Macintosh" tapi punya touch —
  // dibedakan lewat maxTouchPoints, satu-satunya cara yang cukup andal tanpa
  // library deteksi perangkat terpisah.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
}

function pushIsStandalone() {
  return (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
}

// Siapa yang berhak melihat menu Notifikasi sama sekali — HANYA cermin dari
// dua kelompok penerima yang sama dengan Notifikasi.gs (resolvePushRecipients):
// wali kelas aktif, atau namanya pernah muncul di Jadwal_Piket (hari apa
// pun — ini murni supaya menu tidak hilang-muncul tiap hari sesuai jadwal;
// gerbang SEBENARNYA tetap dihitung server per hari kejadian, ini cuma
// keputusan tampil/tidaknya menu).
function pushIsEligible(user, jadwalPiket) {
  if (!user) return false;
  if (user.waliKelas) return true;
  var list = jadwalPiket || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].guruId) === String(user.id)) return true;
  }
  return false;
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function pushRegisterServiceWorker() {
  if (!pushIsSupported()) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js').catch(function () { return null; });
}

function pushSendSubscriptionToServer(sessionToken, subscription) {
  return fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'savePushSubscription', token: API_TOKEN, sessionToken: sessionToken,
      subscription: subscription.toJSON ? subscription.toJSON() : subscription,
      userAgent: navigator.userAgent.slice(0, 200),
    }),
  }).then(function (res) { return res.json(); });
}

function pushRemoveSubscriptionFromServer(sessionToken, endpoint) {
  return fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: 'deletePushSubscription', token: API_TOKEN, sessionToken: sessionToken, endpoint: endpoint }),
  }).then(function (res) { return res.json(); });
}

// Registrasi SW + "self-heal": kalau browser ini SUDAH punya izin & langganan
// aktif (kunjungan berikutnya, bukan aktivasi pertama kali), kirim ulang
// subscription-nya ke server dengan diam-diam — menutup celah kalau baris
// server sempat dibersihkan (subscription invalid, lihat processPushQueue di
// Notifikasi.gs) padahal browser masih menyimpannya sebagai aktif. TIDAK
// PERNAH meminta izin baru di sini — hanya memakai izin yang SUDAH ada.
var pushMessageListenerAttached = false;
function initPushRuntime(user, sessionToken, onGoto) {
  if (!pushIsSupported() || !user || !sessionToken) return;
  pushRegisterServiceWorker().then(function (reg) {
    if (!reg || Notification.permission !== 'granted') return;
    reg.pushManager.getSubscription().then(function (sub) {
      if (sub) {
        pushSendSubscriptionToServer(sessionToken, sub).catch(function () {});
      } else if (VAPID_PUBLIC_KEY && VAPID_PUBLIC_KEY.indexOf('GANTI_DENGAN') === -1) {
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) })
          .then(function (newSub) { return pushSendSubscriptionToServer(sessionToken, newSub); })
          .catch(function () {}); // izin browser bisa saja dicabut manual di antara sesi -- diamkan, bukan aksi krusial
      }
    });
  });

  if (!pushMessageListenerAttached && 'serviceWorker' in navigator) {
    pushMessageListenerAttached = true;
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'sigap-push-goto' && typeof onGoto === 'function') {
        onGoto(event.data.goto);
      }
    });
  }
}

// Token '?goto=' dari SW yang membuka tab BARU (clients.openWindow) saat
// tidak ada tab SIGAP yang sedang terbuka -- dibaca & DIBUANG dari URL sekali
// di boot supaya tidak "menempel" (refresh berikutnya tidak mengulang
// navigasi yang sama).
function consumePushGotoParam() {
  if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
  var params = new URLSearchParams(window.location.search);
  var goto = params.get('goto');
  if (goto) {
    params.delete('goto');
    var newSearch = params.toString();
    var newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }
  return goto;
}

// ===== Salinan adaptif: kenapa notifikasi belum bisa diaktifkan di sini =====
function pushUnavailableReason() {
  if (pushIsSupported()) return null;
  if (pushIsIOS() && !pushIsStandalone()) {
    return 'Di iPhone/iPad: buka menu Share (ikon kotak dengan panah ke atas) di Safari, pilih "Tambah ke Layar Utama", lalu buka SIGAP dari ikon di layar utama untuk mengaktifkan notifikasi.';
  }
  if (pushIsIOS()) {
    return 'Notifikasi push butuh iOS/iPadOS 16.4 ke atas. Perbarui versi iOS/iPadOS perangkat ini lalu coba lagi.';
  }
  return 'Browser ini belum mendukung notifikasi push. Coba buka SIGAP lewat Chrome/Edge versi terbaru (Android/desktop).';
}

// ===== Onboarding: banner di Beranda, HANYA untuk pengguna yang eligible,
// permission belum diputuskan, dan belum pernah ditutup manual. ===== ----
function NotifikasiOnboardingBanner({ user, eligible, onOpenSettings }) {
  var dismissKey = 'sigap_push_dismissed_' + (user ? user.id : '');
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dismissKey) === '1'; } catch (e) { return false; }
  });
  if (!eligible || dismissed) return null;
  if (pushIsSupported() && typeof Notification !== 'undefined' && Notification.permission !== 'default') return null;

  const dismiss = () => {
    try { localStorage.setItem(dismissKey, '1'); } catch (e) {}
    setDismissed(true);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4 animate-rise">
      <p className="text-sm text-slate-700 mb-3">
        Aktifkan notifikasi untuk mendapatkan informasi penting SIGAP meskipun aplikasi sedang tidak dibuka.
      </p>
      <div className="flex gap-2">
        <button onClick={onOpenSettings} className="flex-1 bg-sky-dim text-white rounded-xl py-2.5 text-sm font-bold hover:bg-sky transition">
          Aktifkan Notifikasi
        </button>
        <button onClick={dismiss} className="px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700">
          Nanti saja
        </button>
      </div>
    </div>
  );
}

// ===== Halaman Setelan Notifikasi =====
function NotifikasiTab({ user, sessionToken }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'active' | 'inactive' | 'denied' | 'unsupported'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = () => {
    if (!pushIsSupported()) { setStatus('unsupported'); return; }
    if (Notification.permission === 'denied') { setStatus('denied'); return; }
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
      setStatus(sub ? 'active' : 'inactive');
    }).catch(() => setStatus('inactive'));
  };

  useEffect(() => { refreshStatus(); }, []);

  const activate = () => {
    setError('');
    if (!pushIsSupported()) return;
    setBusy(true);
    Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') {
        setStatus('denied');
        setBusy(false);
        return;
      }
      pushRegisterServiceWorker().then((reg) => {
        if (!reg) throw new Error('Gagal mendaftarkan service worker.');
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      }).then((sub) => pushSendSubscriptionToServer(sessionToken, sub)).then((res) => {
        if (res.status !== 'success') throw new Error(res.message || 'Gagal menyimpan subscription di server.');
        setStatus('active');
      }).catch((err) => {
        setError(err.message || 'Gagal mengaktifkan notifikasi. Coba lagi.');
        refreshStatus();
      }).finally(() => setBusy(false));
    });
  };

  const deactivate = () => {
    setError('');
    setBusy(true);
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
      if (!sub) { setStatus('inactive'); return null; }
      const endpoint = sub.endpoint;
      return sub.unsubscribe().then(() => pushRemoveSubscriptionFromServer(sessionToken, endpoint));
    }).then(() => setStatus('inactive'))
      .catch(() => setError('Gagal menonaktifkan notifikasi. Coba lagi.'))
      .finally(() => setBusy(false));
  };

  const unavailableReason = pushUnavailableReason();

  return (
    <div className="space-y-5 animate-rise">
      <h2 className="text-xl font-display font-bold text-ink-900">Notifikasi</h2>
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-sm text-slate-600 mb-4">
          SIGAP dapat mengirim notifikasi untuk kejadian yang berkaitan dengan siswa kelas perwalian Anda,
          atau saat ada izin keluar yang menunggu verifikasi ketika Anda sedang piket — bahkan saat aplikasi
          tidak sedang dibuka.
        </p>

        {status === 'checking' && <p className="text-sm text-slate-400">Memeriksa status...</p>}

        {status === 'active' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-moss">🔔 Notifikasi Aktif</span>
            <button disabled={busy} onClick={deactivate} className="px-4 py-2 text-sm font-semibold text-crimson border border-crimson/30 rounded-xl hover:bg-crimson/5 transition disabled:opacity-50">
              Nonaktifkan Notifikasi
            </button>
          </div>
        )}

        {status === 'inactive' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-500">🔕 Notifikasi Belum Diaktifkan</span>
            <button disabled={busy} onClick={activate} className="px-4 py-2 bg-sky-dim text-white text-sm font-bold rounded-xl hover:bg-sky transition disabled:opacity-50">
              Aktifkan Notifikasi
            </button>
          </div>
        )}

        {status === 'denied' && (
          <div>
            <span className="text-sm font-bold text-crimson block mb-2">🔕 Notifikasi Diblokir</span>
            <p className="text-xs text-slate-500">
              Notifikasi diblokir lewat pengaturan browser/situs ini. Buka pengaturan situs (biasanya lewat ikon
              gembok/info di address bar), izinkan Notifikasi, lalu muat ulang halaman ini.
            </p>
          </div>
        )}

        {status === 'unsupported' && unavailableReason && (
          <div>
            <span className="text-sm font-bold text-slate-500 block mb-2">🔕 Belum Bisa Diaktifkan di Perangkat Ini</span>
            <p className="text-xs text-slate-500">{unavailableReason}</p>
          </div>
        )}

        {error && <p className="text-xs text-crimson mt-3">{error}</p>}
      </div>
    </div>
  );
}
