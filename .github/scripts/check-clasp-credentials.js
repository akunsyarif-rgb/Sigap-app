// ===== .github/scripts/check-clasp-credentials.js =====
// Gerbang pemeriksaan kredensial clasp SEBELUM workflow deploy-gas.yml
// menyentuh project Apps Script SIGAP yang dipakai sekolah.
//
// Kenapa file ini ada:
// Workflow versi lama menulis `echo '${{ secrets.CLASP_CREDENTIALS }}' >
// ~/.clasprc.json`. Kalau secret-nya belum diisi, `echo` tetap SUKSES dan
// menghasilkan file berisi satu baris kosong. clasp v3 lalu membaca file itu
// dengan JSON.parse() mentah (lihat FileCredentialStore.readFile di
// @google/clasp) sehingga meledak dengan pesan yang tidak menjelaskan apa pun:
//
//     Unexpected end of JSON input
//
// Bahaya kedua yang lebih mahal: `clasp deploy -i ""` (CLASP_DEPLOYMENT_ID
// kosong) TIDAK error. Di clasp v3 pengecekannya `if (!deploymentId)`, jadi
// ID kosong = bikin deployment BARU dengan URL Web App baru yang tidak
// dikenali config.js manapun — sementara deployment lama yang dipakai semua
// guru tetap menjalankan kode lama. Makanya ID kosong WAJIB dihentikan di
// sini, sebelum ada satu pun perintah clasp yang jalan.
//
// ATURAN KERAS: file ini tidak boleh mencetak isi kredensial. Yang dilaporkan
// hanya ADA/TIDAK ADA dan BENTUK JSON-nya, tidak pernah nilainya.

'use strict';

// Meniru FileCredentialStore.load() milik clasp v3 PERSIS: bentuk mana saja
// yang dikenali, dan jadi objek seperti apa. Hasilnya lalu diserahkan clasp ke
// `new GoogleAuth().fromJSON(...)`, yang mewajibkan client_id, client_secret,
// dan refresh_token — kalau salah satu hilang, clasp mati dengan pesan
// "The incoming JSON object does not contain a <field> field", sama tidak
// menolongnya seperti "Unexpected end of JSON input". Semua itu bisa
// dipastikan di sini tanpa jaringan.
//
// Bentuk yang diterima:
//   v3       : { "tokens": { "default": {...} } }
//   v1 lokal : { "token": {...}, "oauth2ClientSettings": {clientId, clientSecret} }
//   v1 global: { "access_token": ... }  → client_id/secret diisi bawaan clasp
function extractCredential(store) {
  if (store && store.tokens && store.tokens.default) {
    return { shape: 'v3 (tokens.default)', credential: store.tokens.default };
  }
  if (store && store.token && store.oauth2ClientSettings) {
    return {
      shape: 'lama v1 (token + oauth2ClientSettings)',
      credential: {
        ...store.token,
        client_id: store.oauth2ClientSettings.clientId,
        client_secret: store.oauth2ClientSettings.clientSecret,
      },
    };
  }
  if (store && store.access_token) {
    // clasp mengisi client_id/client_secret dengan milik clasp sendiri untuk
    // bentuk ini, jadi keduanya tidak perlu ada di file.
    return {
      shape: 'lama v1 global (access_token di akar)',
      credential: {
        ...store,
        client_id: store.client_id || '(bawaan clasp)',
        client_secret: store.client_secret || '(bawaan clasp)',
      },
    };
  }
  return { shape: null, credential: null };
}

// Mengembalikan daftar masalah (string). Array kosong = kredensial siap pakai.
// `env` sengaja dilewatkan sebagai argumen supaya bisa diuji tanpa menyentuh
// process.env sungguhan.
function checkClaspCredentials(env) {
  const problems = [];
  const info = [];

  const raw = (env.CLASP_CREDENTIALS || '').trim();
  const scriptId = (env.CLASP_SCRIPT_ID || '').trim();
  const deploymentId = (env.CLASP_DEPLOYMENT_ID || '').trim();

  // --- 1. Ketiga secret harus benar-benar terisi ---------------------------
  // Secret yang belum dibuat di Settings > Secrets di-interpolasi jadi string
  // kosong, bukan error — inilah yang bikin run kemarin lolos sampai clasp.
  if (!raw) {
    problems.push(
      'Secret CLASP_CREDENTIALS kosong atau belum dibuat. Isi dengan SELURUH ' +
        'isi ~/.clasprc.json hasil `npx clasp login` di komputer sendiri.',
    );
  }
  if (!scriptId) {
    problems.push(
      'Secret CLASP_SCRIPT_ID kosong atau belum dibuat. Ambil dari editor ' +
        'Apps Script: Project Settings > IDs > Script ID.',
    );
  }
  if (!deploymentId) {
    problems.push(
      'Secret CLASP_DEPLOYMENT_ID kosong atau belum dibuat. WAJIB diisi: ID ' +
        'kosong membuat clasp bikin deployment BARU dengan URL Web App baru, ' +
        'bukan memperbarui deployment yang sekarang dipakai config.js. Ambil ' +
        'dengan `npx clasp deployments` (pilih yang URL-nya sama dengan ' +
        'API_URL di config.js).',
    );
  }

  // --- 2. CLASP_CREDENTIALS harus JSON yang utuh ---------------------------
  if (raw) {
    let store = null;
    try {
      store = JSON.parse(raw);
    } catch (err) {
      problems.push(
        'Secret CLASP_CREDENTIALS bukan JSON yang valid (' +
          err.message +
          '). Ini persis penyebab pesan "Unexpected end of JSON input" dari ' +
          'clasp. Salin ulang isi ~/.clasprc.json APA ADANYA, utuh dari "{" ' +
          'sampai "}", tanpa dipotong dan tanpa tanda kutip tambahan.',
      );
    }

    if (store !== null) {
      if (typeof store !== 'object' || Array.isArray(store)) {
        problems.push(
          'Secret CLASP_CREDENTIALS adalah JSON valid tapi bukan objek. ' +
            'Isinya harus objek ~/.clasprc.json, bukan potongan lain.',
        );
      } else {
        const { shape, credential } = extractCredential(store);
        if (!credential) {
          problems.push(
            'Secret CLASP_CREDENTIALS tidak berisi kredensial yang dikenali ' +
              'clasp v3. Diharapkan salah satu bentuk: {"tokens":{"default":' +
              '{...}}} (clasp v3), {"token":...,"oauth2ClientSettings":...} ' +
              'atau {"access_token":...} (clasp v1). Pastikan yang disalin ' +
              'adalah ~/.clasprc.json, bukan file kredensial OAuth lain.',
          );
        } else {
          info.push('Bentuk kredensial terdeteksi: ' + shape + '.');
          // Tanpa refresh_token, access_token mati dalam ~1 jam dan run
          // berikutnya gagal lagi dengan pesan yang membingungkan.
          if (!credential.refresh_token) {
            problems.push(
              'Kredensial clasp tidak punya refresh_token. Tanpa itu token ' +
                'kedaluwarsa ~1 jam setelah login dan deploy akan gagal. ' +
                'Jalankan `npx clasp login` ulang, lalu salin ~/.clasprc.json ' +
                'yang baru.',
            );
          }
          // Dipakai google-auth-library lewat GoogleAuth().fromJSON().
          for (const field of ['client_id', 'client_secret']) {
            if (!credential[field]) {
              problems.push(
                'Kredensial clasp tidak punya ' +
                  field +
                  '. clasp akan berhenti dengan "The incoming JSON object ' +
                  'does not contain a ' +
                  field +
                  ' field". Salin ulang ~/.clasprc.json yang utuh hasil ' +
                  '`npx clasp login` (jangan hanya bagian token-nya).',
              );
            }
          }
        }
      }
    }
  }

  // --- 3. Salah tempel yang paling sering: URL, bukan ID -------------------
  const looksLikeUrl = (value) => /^https?:\/\//i.test(value) || value.includes('/');
  if (scriptId && looksLikeUrl(scriptId)) {
    problems.push(
      'Secret CLASP_SCRIPT_ID kelihatannya berisi URL, bukan Script ID. Yang ' +
        'dibutuhkan hanya ID-nya saja (tanpa https:// dan tanpa garis miring).',
    );
  }
  if (deploymentId && looksLikeUrl(deploymentId)) {
    problems.push(
      'Secret CLASP_DEPLOYMENT_ID kelihatannya berisi URL Web App, bukan ' +
        'deployment ID. Ambil ID-nya saja lewat `npx clasp deployments` ' +
        '(kolom pertama, biasanya diawali "AKfycb").',
    );
  }
  if (scriptId && /\s/.test(scriptId)) {
    problems.push('Secret CLASP_SCRIPT_ID mengandung spasi/baris baru. Salin ulang tanpa spasi.');
  }
  if (deploymentId && /\s/.test(deploymentId)) {
    problems.push('Secret CLASP_DEPLOYMENT_ID mengandung spasi/baris baru. Salin ulang tanpa spasi.');
  }

  return { problems, info };
}

module.exports = { checkClaspCredentials, extractCredential };

// Dipanggil langsung oleh workflow: keluar dengan kode 1 kalau ada masalah,
// supaya job berhenti SEBELUM `clasp push`/`clasp deploy` menyentuh project.
if (require.main === module) {
  const { problems, info } = checkClaspCredentials(process.env);
  info.forEach((line) => console.log('  - ' + line));
  if (problems.length === 0) {
    console.log('Kredensial clasp lengkap dan formatnya valid.');
    process.exit(0);
  }
  console.error('Kredensial clasp belum siap, deploy DIBATALKAN:');
  problems.forEach((line, i) => console.error('  ' + (i + 1) + '. ' + line));
  console.error('');
  console.error('Perbaiki di: Settings > Secrets and variables > Actions.');
  process.exit(1);
}
