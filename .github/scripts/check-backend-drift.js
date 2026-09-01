// ===== .github/scripts/check-backend-drift.js =====
// Deteksi OTOMATIS kalau Code.gs/Auth.gs/Utils.gs di `main` sudah berubah
// tapi BELUM di-deploy manual ke Apps Script — lihat CLAUDE.md kenapa deploy
// backend tidak pernah otomatis (merge PR != live). Sebelum ini ada, satu-
// satunya cara tahu ada drift adalah seseorang membuka status ping-nya
// sendiri secara manual dan membandingkan `version` dengan BACKEND_VERSION
// di Code.gs — gampang lupa, apalagi berminggu-minggu setelah merge.
//
// Workflow ini (.github/workflows/check-backend-drift.yml) TIDAK PERNAH
// menyentuh Apps Script — cuma memanggil status ping publik (doGet tanpa
// action, digembok API_TOKEN seperti endpoint lain) dan membandingkan.
// Gagal (exit 1) di sini artinya "ada yang perlu di-deploy manual", BUKAN
// bug kode, dan tidak menghalangi merge PR mana pun (workflow terpisah dari
// test.yml, cuma jalan di push ke main + jadwal harian).
//
// Dua mode CLI (dipanggil dari workflow, bukan lewat require di kode lain):
//   --print-status-url   Cetak "<API_URL>?token=<API_TOKEN>" ke stdout SAJA,
//                         supaya workflow bisa `curl` dengan itu. Tidak ada
//                         teks lain yang dicetak di mode ini.
//   --compare <file>      Bandingkan BACKEND_VERSION di Code.gs (dibaca dari
//                         checkout) dengan isi <file> (hasil curl status
//                         ping tadi, ditulis workflow -- bukan file ini yang
//                         melakukan requestnya, supaya logika pembanding di
//                         bawah tetap murni & gampang diuji tanpa jaringan).

'use strict';

// BACKEND_VERSION dideklarasikan `var BACKEND_VERSION = '...';` di baris
// paling atas Code.gs -- lihat komentar di sana kenapa formatnya begitu
// (dinaikkan manual tiap ada perubahan .gs yang perlu diverifikasi setelah
// deploy).
function extractBackendVersion(codeGsSource) {
  var m = /var\s+BACKEND_VERSION\s*=\s*'([^']*)'/.exec(codeGsSource || '');
  return m ? m[1] : null;
}

// API_URL/API_TOKEN di config.js BUKAN rahasia yang disembunyikan dari
// browser (lihat komentar di config.js -- keduanya memang terkirim dari
// SETIAP klien) -- jadi aman dibaca apa adanya dari checkout, tidak perlu
// lewat GitHub Secret.
function extractApiConfig(configJsSource) {
  var urlMatch = /const\s+API_URL\s*=\s*"([^"]*)"/.exec(configJsSource || '');
  var tokenMatch = /const\s+API_TOKEN\s*=\s*"([^"]*)"/.exec(configJsSource || '');
  return {
    apiUrl: urlMatch ? urlMatch[1] : null,
    apiToken: tokenMatch ? tokenMatch[1] : null,
  };
}

// Fungsi murni -- tidak menyentuh jaringan/filesystem -- supaya diuji dengan
// string fixture saja. `liveBodyRaw` adalah body mentah hasil curl ke status
// ping (bisa jadi bukan JSON sama sekali kalau Apps Script tidak terjangkau
// atau token salah, makanya di-parse hati-hati, bukan diasumsikan selalu JSON).
function evaluateDrift(expectedVersion, liveBodyRaw) {
  if (!expectedVersion) {
    return {
      status: 'error',
      message: 'Tidak menemukan BACKEND_VERSION di Code.gs -- cek apakah format deklarasinya berubah (harus persis `var BACKEND_VERSION = \'...\';`).',
    };
  }

  var live = null;
  try {
    live = JSON.parse(liveBodyRaw);
  } catch (err) {
    return {
      status: 'unreachable',
      message:
        'Respons status ping bukan JSON yang valid -- kemungkinan Apps Script ' +
        'tidak bisa dihubungi, API_TOKEN di config.js sudah tidak cocok dengan ' +
        'Script Properties, atau Web App belum pernah di-deploy. Cek manual: ' +
        'buka API_URL + "?token=" + API_TOKEN di browser. Potongan respons: ' +
        JSON.stringify(String(liveBodyRaw || '').slice(0, 200)),
    };
  }

  if (!live || typeof live.version !== 'string') {
    return {
      status: 'unreachable',
      message:
        'Respons status ping tidak memuat field "version" seperti yang ' +
        'diharapkan (status: ' + (live && live.status) + '). Backend mungkin ' +
        'menjalankan kode yang jauh lebih lama dari sebelum BACKEND_VERSION ada.',
    };
  }

  if (live.version === expectedVersion) {
    return { status: 'sync', message: 'Backend live sudah sinkron dengan main (versi "' + expectedVersion + '").' };
  }

  return {
    status: 'drift',
    message:
      'Backend live MASIH menjalankan versi "' + live.version + '", padahal ' +
      'Code.gs di main sekarang versi "' + expectedVersion + '". Ada ' +
      'perubahan Code.gs/Auth.gs/Utils.gs yang sudah merge tapi belum ' +
      'di-deploy manual ke Apps Script -- lihat CLAUDE.md bagian clasp untuk ' +
      'cara deploy (clasp:push + clasp:deploy, atau salin-tempel manual ke editor).',
  };
}

module.exports = { extractBackendVersion, extractApiConfig, evaluateDrift };

if (require.main === module) {
  var fs = require('fs');
  var mode = process.argv[2];

  if (mode === '--print-status-url') {
    var configJs = fs.readFileSync('config.js', 'utf8');
    var apiConfig = extractApiConfig(configJs);
    if (!apiConfig.apiUrl || !apiConfig.apiToken) {
      console.error('Tidak bisa membaca API_URL/API_TOKEN dari config.js -- cek apakah formatnya berubah.');
      process.exit(1);
    }
    // HANYA ini yang boleh dicetak di mode ini -- workflow menangkap stdout
    // langsung sebagai argumen `curl`.
    process.stdout.write(apiConfig.apiUrl + '?token=' + encodeURIComponent(apiConfig.apiToken));
    process.exit(0);
  }

  if (mode === '--compare') {
    var liveFile = process.argv[3];
    if (!liveFile) {
      console.error('Penggunaan: check-backend-drift.js --compare <file-respons-status-ping>');
      process.exit(1);
    }
    var codeGsSource = fs.readFileSync('Code.gs', 'utf8');
    var expectedVersion = extractBackendVersion(codeGsSource);
    var liveBodyRaw = fs.readFileSync(liveFile, 'utf8');
    var result = evaluateDrift(expectedVersion, liveBodyRaw);

    if (result.status === 'sync') {
      console.log(result.message);
      process.exit(0);
    }
    // 'drift', 'unreachable', dan 'error' semuanya bikin job merah -- ketiganya
    // sama-sama berarti "tidak bisa dipastikan backend live sudah sesuai kode
    // di main", yang justru inti dari workflow ini.
    console.error('::error::' + result.message);
    process.exit(1);
  }

  console.error('Penggunaan: check-backend-drift.js --print-status-url | --compare <file>');
  process.exit(1);
}
