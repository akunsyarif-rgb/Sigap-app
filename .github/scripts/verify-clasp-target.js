// ===== .github/scripts/verify-clasp-target.js =====
// Gerbang KEDUA deploy-gas.yml: memastikan kita menembak project dan
// deployment yang BENAR, sebelum `clasp push` menulis apa pun.
//
// check-clasp-credentials.js hanya memastikan ketiga secret ada dan bentuknya
// benar. Itu tidak cukup. Secret bisa terisi lengkap tapi salah isi:
//
//   - CLASP_DEPLOYMENT_ID milik project LAIN, atau deployment yang sudah
//     dihapus. `clasp push` terlanjur jalan, baru `clasp deploy -i` gagal —
//     project live sudah berubah tapi deployment-nya tidak diperbarui, jadi
//     guru menjalankan versi yang tidak pernah dites siapa pun.
//   - .clasp.json menunjuk scriptId yang berbeda dari CLASP_SCRIPT_ID (mis.
//     ada .clasp.json nyasar di checkout), sehingga push mendarat di project
//     yang salah.
//
// Keduanya dicegah dengan satu panggilan BACA-SAJA: `clasp deployments --json`
// mengembalikan daftar deployment MILIK scriptId yang dikonfigurasi. Kalau
// CLASP_DEPLOYMENT_ID ada di daftar itu, terbukti dua hal sekaligus — 
// deployment-nya memang ada, dan memang milik project ini.
//
// ATURAN KERAS: sama seperti check-clasp-credentials.js, file ini tidak pernah
// mencetak nilai apa pun — tidak scriptId, tidak deploymentId, tidak daftar
// deployment. Lognya bisa dibaca siapa saja yang punya akses repo.

'use strict';

function verifyClaspTarget({ env, claspJsonRaw, deploymentsRaw }) {
  const problems = [];
  const info = [];

  const scriptIdSecret = (env.CLASP_SCRIPT_ID || '').trim();
  const deploymentIdSecret = (env.CLASP_DEPLOYMENT_ID || '').trim();

  // --- 1. .clasp.json harus ada, JSON valid, dan punya scriptId ------------
  let claspJson = null;
  if (claspJsonRaw === null || claspJsonRaw === undefined || !claspJsonRaw.trim()) {
    problems.push(
      '.clasp.json tidak ada atau kosong. Langkah "Siapkan kredensial clasp" ' +
        'seharusnya menulisnya dari CLASP_SCRIPT_ID — kalau hilang, urutan ' +
        'langkah di workflow berubah atau langkah itu gagal diam-diam.',
    );
  } else {
    try {
      claspJson = JSON.parse(claspJsonRaw);
    } catch (err) {
      problems.push('.clasp.json bukan JSON yang valid (' + err.message + ').');
    }
  }

  if (claspJson && (typeof claspJson !== 'object' || Array.isArray(claspJson))) {
    problems.push('.clasp.json harus berupa objek JSON.');
    claspJson = null;
  }

  if (claspJson) {
    const scriptIdConfig = typeof claspJson.scriptId === 'string' ? claspJson.scriptId.trim() : '';
    if (!scriptIdConfig) {
      problems.push('.clasp.json tidak punya scriptId yang terisi.');
    } else if (!scriptIdSecret) {
      // Sudah dilaporkan check-clasp-credentials.js; jangan diulang di sini.
    } else if (scriptIdConfig !== scriptIdSecret) {
      // Tanpa cek ini, push bisa mendarat di project Apps Script yang salah.
      problems.push(
        'scriptId di .clasp.json TIDAK SAMA dengan secret CLASP_SCRIPT_ID. ' +
          'Push bisa mendarat di project Apps Script yang salah, jadi deploy ' +
          'dihentikan. Pastikan tidak ada .clasp.json lain yang ikut ter-checkout.',
      );
    } else {
      info.push('scriptId di .clasp.json cocok dengan CLASP_SCRIPT_ID.');
    }
  }

  // --- 2. Deployment tujuan harus BENAR-BENAR ADA di project ini -----------
  let deployments = null;
  if (deploymentsRaw === null || deploymentsRaw === undefined || !deploymentsRaw.trim()) {
    problems.push(
      'Daftar deployment dari `clasp deployments --json` kosong/tidak terbaca. ' +
        'Tidak bisa membuktikan CLASP_DEPLOYMENT_ID valid, jadi deploy dihentikan.',
    );
  } else {
    try {
      deployments = JSON.parse(deploymentsRaw);
    } catch (err) {
      problems.push(
        'Keluaran `clasp deployments --json` bukan JSON yang valid (' + err.message + ').',
      );
    }
  }

  if (deployments !== null && !Array.isArray(deployments)) {
    problems.push('Keluaran `clasp deployments --json` bukan array.');
    deployments = null;
  }

  if (Array.isArray(deployments)) {
    info.push('Project ini punya ' + deployments.length + ' deployment.');
    if (!deploymentIdSecret) {
      // Sudah dilaporkan check-clasp-credentials.js.
    } else {
      const cocok = deployments.some(
        (d) => d && typeof d.deploymentId === 'string' && d.deploymentId.trim() === deploymentIdSecret,
      );
      if (cocok) {
        info.push('CLASP_DEPLOYMENT_ID ditemukan di project ini — deployment yang sudah ada akan DIPERBARUI, bukan dibuat baru.');
      } else {
        problems.push(
          'CLASP_DEPLOYMENT_ID TIDAK ADA di daftar deployment project ini. ' +
            'Kemungkinan: ID-nya milik project lain, sudah dihapus, atau salah ' +
            'salin. Deploy dihentikan SEBELUM `clasp push` supaya project live ' +
            'tidak berubah tanpa deployment-nya ikut diperbarui. Jalankan ' +
            '`npx clasp deployments` di komputer sendiri, cocokkan dengan ' +
            'API_URL di config.js, lalu perbarui secret-nya.',
        );
      }
    }
  }

  return { problems, info };
}

module.exports = { verifyClaspTarget };

if (require.main === module) {
  const fs = require('fs');
  const bacaKalauAda = (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (err) {
      return null;
    }
  };

  const { problems, info } = verifyClaspTarget({
    env: process.env,
    claspJsonRaw: bacaKalauAda('.clasp.json'),
    // Argumen pertama = berkas hasil `clasp deployments --json`.
    deploymentsRaw: bacaKalauAda(process.argv[2]),
  });

  info.forEach((line) => console.log('  - ' + line));
  if (problems.length === 0) {
    console.log('Target deploy terverifikasi: project dan deployment sudah benar.');
    process.exit(0);
  }
  console.error('Target deploy TIDAK terverifikasi, deploy DIBATALKAN:');
  problems.forEach((line, i) => console.error('  ' + (i + 1) + '. ' + line));
  process.exit(1);
}
