// ===== config.js =====
// URL & token API, daftar 4 tingkat akses (ROLES), dan ikon menu navigasi (NAV_ITEMS).
// Dimuat PALING AWAL karena file lain semua bergantung ke sini.

       const { useState, useEffect, useMemo, useRef } = React;

       // ⚠️ PASTIKAN LINK INI SESUAI DENGAN WEB APP GOOGLE SCRIPT ANDA
       const API_URL = "https://script.google.com/macros/s/AKfycbxMh_A5xbwfff7GwgojVLyCRXjpl2FyyTSIf8HvkTxOx4w6zasLZ9VDhMNraEux1tAztg/exec";
       // ⚠️ GANTI dengan token yang SAMA PERSIS dengan Script Properties (API_TOKEN) di Apps Script
       const API_TOKEN = "sigap2026rahasia8x9zK2mP";

       // Kunci PUBLIK VAPID untuk Web Push (lihat notifikasi.js, CLAUDE.md bagian
       // Push Notification). Kunci publik VAPID memang dirancang untuk diketahui
       // klien — bukan rahasia seperti API_TOKEN — tapi tetap HARUS pasangan
       // persis dari kunci PRIVAT di env var Vercel VAPID_PRIVATE_KEY (project
       // yang sama dengan hosting frontend ini). Kalau pasangan ini pernah
       // diganti lagi, generate ulang KEDUANYA bersamaan lewat
       // `npx web-push generate-vapid-keys` — subscription yang dibuat dengan
       // kunci publik lama tidak akan pernah bisa dikirimi notifikasi oleh
       // kunci privat yang baru.
       const VAPID_PUBLIC_KEY = "BBGeLh0xTBdRYq3HIESmYtY6Lps8hix9eG0FurryAQL1TZySOMPxTGI443PQIoDNFOdf-xvZQiiBqWivX7wppb8";

       // 4 tingkat akses:
       // - admin: semua menu + ekspor + Kelola Guru + Bimbingan Khusus + Pelanggaran Upacara
       // - bk_kesiswaan: sama seperti guru + Bimbingan Khusus + Pelanggaran Upacara (guru BK & tim kesiswaan)
       // - guru: menu operasional harian (Gerbang, Beranda, Riwayat, Pelanggaran, Statistik) — sama untuk semua guru
       // - osis: HANYA menu Upacara (catat + riwayat catatan sendiri), tidak lihat apa pun yang lain
       // canViewRanking: kalau true, Statistik menampilkan mode "Ranking" (urut
       // jumlah kasus terbanyak antar kelas) selain mode "Per Kelas" (urut A-Z).
       // Ranking dibatasi ke BK/Kesiswaan & Admin saja — bukan karena datanya
       // rahasia dari Guru (Guru tetap dapat data lengkap lewat Riwayat), tapi
       // supaya perbandingan "kelas mana paling banyak kasus" tidak jadi bahan
       // bandingan/label buruk antar kelas yang dilihat sembarang guru.
       // (Blueprint SIGAP v2, section VII & IX)
       const ROLES = {
           // primaryMenus admin/bk_kesiswaan sempat diperluas ke 6 item (audit
           // desain, coba masukkan Statistik & Audit Log) TAPI dikembalikan ke 4
           // -- di HP asli 6 ikon + tombol "Lainnya" (7 total) overflow horizontal,
           // BottomNav jadi geser kiri-kanan dan tombol "Lainnya" (satu-satunya
           // jalan ke menu Kelola) terdorong ke luar layar sehingga admin tidak
           // bisa menjangkau Kelola sama sekali. Kalau mau menonjolkan
           // Statistik/Audit Log lagi nanti, jangan lewat primaryMenus (ruang
           // BottomNav sudah pas untuk 4+Lainnya) -- perlu pendekatan lain.
           admin:         { label: 'Admin',         menus: ['scan', 'dashboard', 'log', 'stats', 'rekap', 'pelanggaran', 'bimbingan', 'upacara', 'auditlog', 'export', 'kelola'], primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], canExport: true, canViewRanking: true },
           bk_kesiswaan:  { label: 'BK/Kesiswaan',  menus: ['scan', 'dashboard', 'log', 'stats', 'rekap', 'pelanggaran', 'bimbingan', 'upacara', 'export'], primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], canExport: false, canViewRanking: true },
           // 'auditlog' SENGAJA tidak ada di bk_kesiswaan — Audit Log sekarang
           // Admin-only (lihat getAuditLog di Code.gs, itu gerbang sebenarnya).
           // 'rekap' TIDAK dimasukkan di sini — akses ke Rekap Kelas untuk guru
           // ditentukan per-orang (cuma yang jadi wali kelas), ditambahkan secara
           // runtime di app.js (effectiveMenus), bukan berlaku untuk semua guru.
           guru:          { label: 'Guru',          menus: ['scan', 'dashboard', 'log', 'stats', 'pelanggaran'],                                    primaryMenus: ['scan', 'dashboard', 'log', 'pelanggaran'], canExport: false, canViewRanking: false },
           osis:          { label: 'OSIS',          menus: ['upacara'],                                                                             primaryMenus: ['upacara'], canExport: false, canViewRanking: false },
       };

       // Nama hari tetap (bukan Date.toLocaleDateString) supaya "hari ini" untuk
       // Jadwal Piket tidak tergantung locale browser/OS pengguna.
       const HARI_PIKET = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
       function getHariIni() { return HARI_PIKET[new Date().getDay()]; }

       const NAV_ITEMS = {
           scan:      { label: 'Gerbang',    icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5zM13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" /> },
           dashboard: { label: 'Beranda',    icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /> },
           log:       { label: 'Riwayat',    icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /> },
           stats:     { label: 'Statistik',  icon: (a) => <React.Fragment><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" /></React.Fragment> },
           rekap:     { label: 'Rekap Kelas', icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.702-4.53 8.599 8.599 0 011.458 5.078v.001z" /> },
           kelola:    { label: 'Kelola',     icon: (a) => <React.Fragment><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></React.Fragment> },
           pelanggaran: { label: 'Pelanggaran', icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /> },
           bimbingan:   { label: 'Bimbingan',   icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /> },
           upacara:     { label: 'Upacara',      icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" /> },
           // 'export' TIDAK masuk primaryMenus mana pun — BottomNav sudah pas
           // untuk 4 ikon + "Lainnya" (lihat catatan panjang di ROLES di atas),
           // jadi Export Data dijangkau lewat panel "Lainnya" seperti Kelola.
           // Untuk guru yang jadi wali kelas, menu ini ditambahkan runtime di
           // app.js (per-orang, sama seperti 'rekap') — bukan lewat ROLES.
           export:      { label: 'Export Data',  icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /> },
           auditlog:    { label: 'Audit Log',    icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /> },
           // 'notifikasi' TIDAK masuk ke `menus` role mana pun di ROLES di atas —
           // sama seperti 'rekap'/'export' untuk wali kelas, ditambahkan runtime
           // di app.js HANYA untuk pengguna yang benar-benar termasuk salah satu
           // dari dua golongan penerima push (wali kelas / guru piket — lihat
           // CLAUDE.md bagian Push Notification). BK/Kesiswaan/Admin/guru biasa
           // yang tidak masuk keduanya tidak akan melihat menu ini sama sekali,
           // supaya tidak membingungkan (menampilkan setelan notifikasi untuk
           // fitur yang tidak pernah mengirimi mereka apa pun).
           notifikasi:  { label: 'Notifikasi',   icon: (a) => <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /> },
       };
