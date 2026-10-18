
// ===== api-adapter.js =====
// Jembatan ke backend Supabase (Edge Function `sigap-api`).
// Dimuat tepat SESUDAH config.js. Hanya aktif kalau API_BACKEND === 'supabase'.
//
// Kenapa ada: backend Apps Script menerima pembacaan lewat GET
// (?action=...&token=...&sessionToken=...), sedangkan backend Supabase hanya
// menerima POST berisi JSON. Daripada mengubah ±25 pemanggilan fetch di app.js,
// semua GET ke API_URL diubah di sini menjadi POST. Parameter `token` dibuang
// (backend Supabase tidak memakainya; sesi dicek lewat sessionToken).
//
// Juga: pesan "aksi tidak dikenali" dari backend baru diseragamkan ke teks
// lama ('Action tidak dikenali') supaya penanganan fitur yang belum tersedia
// di app.js (mis. export, hapus data periode) tetap bekerja apa adanya.
(function installApiAdapter() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    if (typeof API_BACKEND === 'undefined' || API_BACKEND !== 'supabase') return;
    if (window.__sigapApiAdapterInstalled) return;
    window.__sigapApiAdapterInstalled = true;

    var realFetch = window.fetch.bind(window);
    var PESAN_BARU = 'Aksi tidak dikenali.';
    var PESAN_LAMA = 'Action tidak dikenali';

    function urlOf(input) {
        if (typeof input === 'string') return input;
        return (input && input.url) || '';
    }

    function bungkus(promise) {
        return promise.then(function (res) {
            // Hanya baca salinan (clone) supaya res.json() milik pemanggil tetap utuh.
            if (res.status !== 400) return res;
            return res.clone().json().then(function (data) {
                if (data && data.message === PESAN_BARU) {
                    return new Response(JSON.stringify({ status: 'error', message: PESAN_LAMA }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });
                }
                return res;
            }).catch(function () { return res; });
        });
    }

    window.fetch = function (input, init) {
        var url = urlOf(input);
        if (url.indexOf(API_URL) !== 0) return realFetch(input, init);
        var method = String((init && init.method) || 'GET').toUpperCase();
        if (method === 'GET' && url.indexOf(API_URL + '?') === 0) {
            var body = {};
            new URL(url).searchParams.forEach(function (v, k) { if (k !== 'token') body[k] = v; });
            var opsi = { method: 'POST', body: JSON.stringify(body) };
            if (init && init.signal) opsi.signal = init.signal;
            return bungkus(realFetch(API_URL, opsi));
        }
        return bungkus(realFetch(input, init));
    };
})();
