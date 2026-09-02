// ===== sw.js =====
// Service worker SIGAP — SENGAJA MINIMAL. Satu-satunya tugasnya menerima Web
// Push dan menangani klik notifikasi. TIDAK ADA event listener 'fetch' dan
// TIDAK memakai Cache Storage API sama sekali di sini — index.html sudah
// punya strategi cache-bust sendiri lewat BUILD_VERSION (?v=<angka> di tiap
// file .js, lihat komentar loadSigapApp di index.html). Kalau service worker
// ini ikut men-cache file .js/.html, dua mekanisme versi berbeda akan
// bentrok dan berisiko membuat pengguna terjebak di frontend lama — jadi
// TIDAK dilakukan. Menambahkan cache di sini nanti WAJIB dipikirkan ulang
// terhadap BUILD_VERSION, bukan ditambahkan begitu saja.
//
// skipWaiting()+clients.claim() dipakai supaya service worker ini aktif
// SEGERA setelah didaftarkan (dibutuhkan Web Push bisa segera bekerja),
// bukan menunggu semua tab lama ditutup dulu — aman di sini justru KARENA
// tidak ada cache yang bisa "beda versi" antar tab.

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// Payload dikirim api/push-send.js apa adanya (lihat Notifikasi.gs,
// pushSalinan()) — SUDAH generik/aman untuk kejadian sensitif SEBELUM
// sampai di sini; service worker ini tidak melakukan penyaringan privasi
// apa pun sendiri, hanya menampilkannya.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'SIGAP', body: event.data ? event.data.text() : '' };
  }
  var title = data.title || 'SIGAP';
  var options = {
    body: data.body || '',
    tag: data.tag || undefined,
    // tag+renotify: notifikasi baru untuk kejadian yang SAMA (Event_ID sama,
    // lihat Notifikasi.gs) MENGGANTI yang lama di tray, bukan menumpuk.
    renotify: !!data.tag,
    icon: 'icons/icon-512.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Menekan notifikasi HANYA memindahkan tab yang ditampilkan (lewat token
// pendek ?goto=izin / ?goto=log yang dibaca app.js saat boot/pesan masuk) —
// BUKAN jalan pintas otorisasi. Sesi & RBAC tetap diperiksa ulang sepenuhnya
// oleh setiap pemanggilan API yang sudah ada; lihat CLAUDE.md bagian Push
// Notification.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '';
  var targetPath = target ? '/?goto=' + encodeURIComponent(target) : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        // Tab SIGAP sudah terbuka -- fokuskan & kirim pesan supaya app.js
        // pindah tab tanpa reload penuh (lihat listener 'message' di app.js).
        if ('focus' in client) {
          client.postMessage({ type: 'sigap-push-goto', goto: target });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetPath);
      }
    })
  );
});
