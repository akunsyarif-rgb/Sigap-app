// ===== tests/clasp-credentials.test.js =====
// Menguji gerbang kredensial .github/scripts/check-clasp-credentials.js yang
// dipakai workflow deploy-gas.yml.
//
// Kasus paling penting di file ini adalah dua kegagalan sungguhan yang sudah
// terjadi di repo ini:
//   1. Secret CLASP_CREDENTIALS belum diisi → workflow lama menulis file
//      kosong → clasp v3 JSON.parse("") → "Unexpected end of JSON input"
//      (tiga run deploy-gas berturut-turut mati persis di sini).
//   2. CLASP_DEPLOYMENT_ID kosong → `clasp deploy -i ""` TIDAK error, tapi
//      membuat deployment BARU dengan URL Web App baru sementara guru masih
//      memakai URL lama. Ini kegagalan diam-diam, jadi harus ditangkap di
//      sini.
// Semua nilai di bawah ini palsu/dibuat-buat — tidak ada kredensial asli.
// Jalankan: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkClaspCredentials } = require('../.github/scripts/check-clasp-credentials.js');

// Kredensial palsu berbentuk clasp v3 yang lolos semua pemeriksaan.
const CRED_V3 = JSON.stringify({
  tokens: {
    default: {
      type: 'authorized_user',
      client_id: 'contoh-client-id',
      client_secret: 'contoh-client-secret',
      refresh_token: 'contoh-refresh-token',
      access_token: 'contoh-access-token',
    },
  },
});

const ENV_OK = {
  CLASP_CREDENTIALS: CRED_V3,
  CLASP_SCRIPT_ID: 'ContohScriptId1234567890',
  CLASP_DEPLOYMENT_ID: 'AKfycbContohDeploymentId1234567890',
};

const gabung = (hasil) => hasil.problems.join('\n');

test('kredensial lengkap & valid dianggap siap pakai', () => {
  const hasil = checkClaspCredentials(ENV_OK);
  assert.deepEqual(hasil.problems, []);
});

test('secret yang belum diisi ditangkap sebelum clasp dipanggil', () => {
  // Inilah keadaan run yang gagal: secret belum ada, jadi GitHub
  // meng-interpolasi jadi string kosong tanpa error apa pun.
  const hasil = checkClaspCredentials({
    CLASP_CREDENTIALS: '',
    CLASP_SCRIPT_ID: '',
    CLASP_DEPLOYMENT_ID: '',
  });
  assert.equal(hasil.problems.length, 3);
  assert.match(gabung(hasil), /CLASP_CREDENTIALS kosong/);
  assert.match(gabung(hasil), /CLASP_SCRIPT_ID kosong/);
  assert.match(gabung(hasil), /CLASP_DEPLOYMENT_ID kosong/);
});

test('secret yang tidak diset sama sekali diperlakukan seperti kosong', () => {
  const hasil = checkClaspCredentials({});
  assert.equal(hasil.problems.length, 3);
});

test('CLASP_CREDENTIALS kosong/berisi spasi = penyebab "Unexpected end of JSON input"', () => {
  // `echo '' > ~/.clasprc.json` menghasilkan satu baris kosong; itu yang
  // dibaca clasp dan bikin JSON.parse meledak.
  for (const isi of ['', '\n', '   ']) {
    const hasil = checkClaspCredentials({ ...ENV_OK, CLASP_CREDENTIALS: isi });
    assert.match(gabung(hasil), /CLASP_CREDENTIALS kosong/, JSON.stringify(isi));
  }
});

test('CLASP_CREDENTIALS yang kepotong ditolak dengan penjelasan', () => {
  const hasil = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: '{"tokens":{"default":{"refresh_token":"abc"',
  });
  assert.match(gabung(hasil), /bukan JSON yang valid/);
  assert.match(gabung(hasil), /Unexpected end of JSON input/);
});

test('deployment ID kosong ditolak walau kredensial lain benar', () => {
  // Kalau lolos, clasp bikin deployment baru dengan URL baru — kegagalan
  // yang tidak kelihatan sampai ada guru yang lapor aplikasinya aneh.
  const hasil = checkClaspCredentials({ ...ENV_OK, CLASP_DEPLOYMENT_ID: '' });
  assert.equal(hasil.problems.length, 1);
  assert.match(gabung(hasil), /deployment BARU/);
});

test('ketiga bentuk .clasprc.json yang didukung clasp v3 diterima', () => {
  const bentuk = {
    'v3': CRED_V3,
    'v1 lokal': JSON.stringify({
      token: { refresh_token: 'contoh-refresh-token', access_token: 'contoh' },
      oauth2ClientSettings: { clientId: 'x', clientSecret: 'y' },
    }),
    'v1 global': JSON.stringify({
      access_token: 'contoh',
      refresh_token: 'contoh-refresh-token',
    }),
  };
  for (const [nama, isi] of Object.entries(bentuk)) {
    const hasil = checkClaspCredentials({ ...ENV_OK, CLASP_CREDENTIALS: isi });
    assert.deepEqual(hasil.problems, [], nama);
    assert.equal(hasil.info.length, 1, nama);
  }
});

test('JSON valid tapi bukan kredensial clasp ditolak', () => {
  const hasil = checkClaspCredentials({ ...ENV_OK, CLASP_CREDENTIALS: '{"halo":"dunia"}' });
  assert.match(gabung(hasil), /tidak berisi kredensial yang dikenali/);
});

test('JSON valid tapi bukan objek ditolak', () => {
  for (const isi of ['[]', '"teks"', '123']) {
    const hasil = checkClaspCredentials({ ...ENV_OK, CLASP_CREDENTIALS: isi });
    assert.notEqual(hasil.problems.length, 0, isi);
  }
});

test('kredensial tanpa refresh_token ditolak (mati ~1 jam setelah login)', () => {
  const hasil = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: JSON.stringify({
      tokens: {
        default: {
          type: 'authorized_user',
          client_id: 'contoh',
          client_secret: 'contoh',
          access_token: 'contoh',
        },
      },
    }),
  });
  assert.match(gabung(hasil), /refresh_token/);
});

test('kredensial tanpa client_id/client_secret ditolak sebelum clasp jalan', () => {
  // clasp menyerahkan objek ini ke GoogleAuth().fromJSON(), yang menolak
  // dengan "The incoming JSON object does not contain a client_id field" —
  // pesan yang sama membingungkannya dengan yang bikin run kemarin gagal.
  const hasil = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: JSON.stringify({
      tokens: { default: { type: 'authorized_user', refresh_token: 'contoh' } },
    }),
  });
  assert.match(gabung(hasil), /does not contain a client_id field/);
  assert.match(gabung(hasil), /does not contain a client_secret field/);
});

test('bentuk v1 lokal mengambil client_id dari oauth2ClientSettings', () => {
  // clasp memetakan oauth2ClientSettings.clientId -> client_id, jadi bentuk
  // ini sah walau tidak punya field client_id secara harfiah...
  const lengkap = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: JSON.stringify({
      token: { refresh_token: 'contoh-refresh-token' },
      oauth2ClientSettings: { clientId: 'x', clientSecret: 'y' },
    }),
  });
  assert.deepEqual(lengkap.problems, []);

  // ...tapi kalau oauth2ClientSettings-nya kosong, tetap harus ditolak.
  const bolong = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: JSON.stringify({
      token: { refresh_token: 'contoh-refresh-token' },
      oauth2ClientSettings: {},
    }),
  });
  assert.match(gabung(bolong), /client_id/);
});

test('bentuk v1 global tidak butuh client_id (clasp mengisi bawaannya)', () => {
  const hasil = checkClaspCredentials({
    ...ENV_OK,
    CLASP_CREDENTIALS: JSON.stringify({
      access_token: 'contoh',
      refresh_token: 'contoh-refresh-token',
    }),
  });
  assert.deepEqual(hasil.problems, []);
});

test('URL Web App yang tertempel sebagai ID ditangkap', () => {
  const hasilDeploy = checkClaspCredentials({
    ...ENV_OK,
    CLASP_DEPLOYMENT_ID: 'https://script.google.com/macros/s/AKfycbContoh/exec',
  });
  assert.match(gabung(hasilDeploy), /berisi URL Web App/);

  const hasilScript = checkClaspCredentials({
    ...ENV_OK,
    CLASP_SCRIPT_ID: 'https://script.google.com/home/projects/ContohScriptId/edit',
  });
  assert.match(gabung(hasilScript), /berisi URL/);
});

test('ID dengan spasi/baris baru ditangkap', () => {
  const hasil = checkClaspCredentials({
    ...ENV_OK,
    CLASP_SCRIPT_ID: 'Contoh Script Id',
    CLASP_DEPLOYMENT_ID: 'AKfycb Contoh',
  });
  assert.match(gabung(hasil), /CLASP_SCRIPT_ID mengandung spasi/);
  assert.match(gabung(hasil), /CLASP_DEPLOYMENT_ID mengandung spasi/);
});

test('pesan masalah tidak pernah memuat isi kredensial', () => {
  // Gerbang ini berjalan di log GitHub Actions yang bisa dibaca siapa pun
  // yang punya akses repo — pesannya harus menjelaskan BENTUK, bukan NILAI.
  const rahasia = 'RAHASIA-JANGAN-BOCOR';
  const hasil = checkClaspCredentials({
    CLASP_CREDENTIALS: JSON.stringify({ tokens: { default: { refresh_token: rahasia } } }),
    CLASP_SCRIPT_ID: rahasia + '-script',
    CLASP_DEPLOYMENT_ID: rahasia + '-deploy',
  });
  const semua = [...hasil.problems, ...hasil.info].join('\n');
  assert.ok(!semua.includes(rahasia), 'nilai secret bocor ke pesan: ' + semua);
});
