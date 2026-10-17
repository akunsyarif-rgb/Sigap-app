'use strict';
// Tes pembungkus fetch untuk backend Supabase (api-adapter.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'api-adapter.js'), 'utf8');
const API = 'https://x.supabase.co/functions/v1/sigap-api';

function jalankan(backend, balasan) {
  const calls = [];
  const win = {
    fetch: async (u, o) => { calls.push({ u, o }); return balasan || new Response('{}', { status: 200 }); },
  };
  vm.runInNewContext(`var API_BACKEND=${JSON.stringify(backend)};var API_URL=${JSON.stringify(API)};` + src,
    { window: win, Response, URL });
  return { win, calls };
}

test('backend appsscript: fetch tidak diubah', () => {
  const { win } = jalankan('appsscript');
  assert.equal(win.__sigapApiAdapterInstalled, undefined);
});

test('GET ke API_URL diubah jadi POST JSON, parameter token dibuang', async () => {
  const { win, calls } = jalankan('supabase');
  await win.fetch(API + '?action=getTodayData&token=RAHASIA&sessionToken=abc&x=1');
  assert.equal(calls[0].u, API);
  assert.equal(calls[0].o.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].o.body), { action: 'getTodayData', sessionToken: 'abc', x: '1' });
});

test('POST ke API_URL diteruskan apa adanya', async () => {
  const { win, calls } = jalankan('supabase');
  const o = { method: 'POST', body: '{"action":"login"}' };
  await win.fetch(API, o);
  assert.equal(calls[0].o, o);
});

test('URL lain tidak disentuh', async () => {
  const { win, calls } = jalankan('supabase');
  await win.fetch('https://lain.example/a?action=x&token=y');
  assert.equal(calls[0].u, 'https://lain.example/a?action=x&token=y');
});

test('pesan "Aksi tidak dikenali." diseragamkan ke teks lama', async () => {
  const r = new Response(JSON.stringify({ status: 'error', message: 'Aksi tidak dikenali.' }), { status: 400 });
  const { win } = jalankan('supabase', r);
  const res = await win.fetch(API, { method: 'POST', body: '{}' });
  assert.equal((await res.json()).message, 'Action tidak dikenali');
});

test('error 400 lain tetap utuh', async () => {
  const r = new Response(JSON.stringify({ status: 'error', message: 'NISN wajib' }), { status: 400 });
  const { win } = jalankan('supabase', r);
  const res = await win.fetch(API, { method: 'POST', body: '{}' });
  assert.equal((await res.json()).message, 'NISN wajib');
});
