/* Thử lõi với client @netlify/blobs thật, nối vào máy chủ Blobs cục bộ của chính thư viện (không cần mạng, không chạm Netlify).
   Kiểm hợp đồng thật của set onlyIfNew, list theo tiền tố, get, delete, rồi chạy cả Function bọc bên ngoài. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { handle, sha256hex } from '../netlify/lib/sodo_core.mjs';

const TOK = { LTM: 'tokLTMtokLTMtokLTMtokLTM0123', DTG: 'tokDTGtokDTGtokDTGtokDTG4567', ADMIN: 'tokADMINtokADMINtokADMIN89ab' };
const ENV = { SODO_HASH_LTM: sha256hex(TOK.LTM), SODO_HASH_DTG: sha256hex(TOK.DTG), SODO_HASH_ADMIN: sha256hex(TOK.ADMIN) };
const T0 = new Date(Date.now() - 3600 * 1000).toISOString();
const bp = (id, rev, x) => ({ id: 'Q' + id + rev + 'zz', op: rev === 1 ? 'create' : 'update', rev, at: T0, dev: 'DAAAA1111', e: Object.assign({ id, type: 'bp', t: T0, sbp: 130, dbp: 80 }, x || {}) });
const rq = (m, p, tok, body) => new Request('https://x.test' + p, { method: m, headers: Object.assign({ authorization: 'Bearer ' + tok }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });

let dir, server, apiURL, store, deps;
test.before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'blobs-'));
  server = new BlobsServer({ directory: dir, token: 'srv-token', logger: () => {} });
  const addr = await server.start();
  apiURL = 'http://localhost:' + addr.port;
  // chế độ edgeURL giống cách Function chạy thật gọi Blobs (chế độ apiURL của máy chủ cục bộ ghép sai dấu ? khi có tiền tố)
  store = getStore({ name: 'sodo', siteID: 'site-test', token: 'srv-token', edgeURL: apiURL, uncachedEdgeURL: apiURL, consistency: 'strong' });
  let n = 0;
  deps = { store, env: (k) => ENV[k], now: () => new Date(), rand: () => 'q' + (n++).toString(36).padStart(4, '0') };
});
test.after(async () => { await server.stop(); rmSync(dir, { recursive: true, force: true }); });

test('client thật: onlyIfNew không ghi đè, list theo tiền tố, delete', async () => {
  const a = await store.set('ops/ZZ/k1', 'một', { onlyIfNew: true });
  const b = await store.set('ops/ZZ/k1', 'hai', { onlyIfNew: true });
  assert.equal(a.modified, true); assert.equal(b.modified, false);
  assert.equal(await store.get('ops/ZZ/k1', { type: 'text' }), 'một');
  assert.equal(await store.get('ops/ZZ/none', { type: 'text' }), null);
  await store.set('ops/ZZ/k2', 'x'); await store.set('ops/YY/k3', 'y');
  const l = await store.list({ prefix: 'ops/ZZ/' });
  assert.deepEqual(l.blobs.map((x) => x.key).sort(), ['ops/ZZ/k1', 'ops/ZZ/k2']);
  const none = await store.list({ prefix: 'ops/NOPE/' });
  assert.equal(none.blobs.length, 0);
  await store.delete('ops/ZZ/k1'); await store.delete('ops/ZZ/k2'); await store.delete('ops/YY/k3');
  assert.equal((await store.list({ prefix: 'ops/' })).blobs.length, 0);
});

test('lõi trên client thật: ghi, đọc, sửa, xoá, hai người tách biệt', async () => {
  const w1 = await handle(rq('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), deps);
  assert.equal(w1.status, 200);
  await new Promise((r) => setTimeout(r, 5));
  const w2 = await handle(rq('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 2, { sbp: 142 })] }), deps);
  assert.equal(w2.status, 200);
  await handle(rq('POST', '/api/so-do', TOK.DTG, { ops: [bp('BBB222', 1, { sbp: 118 })] }), deps);
  const ltm = await (await handle(rq('GET', '/api/so-do', TOK.LTM), deps)).json();
  assert.deepEqual(ltm.ops.map((o) => [o.e.id, o.rev, o.e.sbp]), [['AAA111', 1, 130], ['AAA111', 2, 142]]);
  const dtg = await (await handle(rq('GET', '/api/so-do', TOK.DTG), deps)).json();
  assert.deepEqual(dtg.ops.map((o) => o.e.id), ['BBB222']);
  const adm = await (await handle(rq('GET', '/api/so-do?person=DTG', TOK.ADMIN), deps)).json();
  assert.equal(adm.ops[0].e.sbp, 118);
  const inc = await (await handle(rq('GET', '/api/so-do?since=' + ltm.cursor, TOK.LTM), deps)).json();
  assert.ok(inc.ops.length >= 1 && inc.ops[inc.ops.length - 1].rev === 2);
});

test('hai máy ghi cùng lúc trên client thật: không mất mục nào', async () => {
  const N = 30;
  const res = await Promise.all(Array.from({ length: N }, (_, i) => handle(rq('POST', '/api/so-do', i % 2 ? TOK.LTM : TOK.DTG, { ops: [bp('C' + String(i).padStart(5, '0'), 1)] }), deps)));
  assert.ok(res.every((r) => r.status === 200), res.map((r) => r.status).join());
  const l = await (await handle(rq('GET', '/api/so-do?limit=300', TOK.LTM), deps)).json();
  const d = await (await handle(rq('GET', '/api/so-do?limit=300', TOK.DTG), deps)).json();
  const ids = (r) => r.ops.map((o) => o.e.id).filter((x) => x.startsWith('C'));
  assert.equal(ids(l).length, N / 2); assert.equal(ids(d).length, N / 2);
});

test('đọc phân trang và xoá dữ liệu thử trên client thật', async () => {
  const p = [];
  let after = '', more = true, total = 0;
  while (more) {
    const r = await (await handle(rq('GET', '/api/so-do?limit=4' + (after ? '&after=' + after : ''), TOK.LTM), deps)).json();
    total += r.ops.length; after = r.cursor; more = r.more; p.push(r.ops.length);
    assert.ok(p.length < 20);
  }
  assert.equal(total, 2 + 15);
});

test('Function bọc ngoài chạy với Blobs context và Netlify.env giả', async () => {
  const ctx = { edgeURL: apiURL, uncachedEdgeURL: apiURL, siteID: 'site-test', token: 'srv-token' };
  globalThis.netlifyBlobsContext = Buffer.from(JSON.stringify(ctx)).toString('base64');
  globalThis.Netlify = { env: { get: (k) => ENV[k] } };
  const fn = await import('../netlify/functions/so-do.mjs');
  assert.equal(fn.config.path, '/api/so-do');
  assert.equal(fn.config.rateLimit.windowLimit, 120);
  assert.deepEqual(fn.config.rateLimit.aggregateBy, ['ip', 'domain']);
  const w = await fn.default(rq('POST', '/api/so-do', TOK.DTG, { ops: [bp('FUNC11', 1)] }));
  assert.equal(w.status, 200, await w.clone().text());
  const g = await (await fn.default(rq('GET', '/api/so-do?limit=300', TOK.DTG))).json();
  assert.ok(g.ops.some((o) => o.e.id === 'FUNC11'));
  assert.equal((await fn.default(rq('GET', '/api/so-do', 'saisaisaisaisaisaisaisai'))).status, 401);
});
