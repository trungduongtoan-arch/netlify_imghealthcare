// The offline token page: its hand-written SHA-256 equals Node's, the hashes shown belong to the tokens shown, and it makes no network request.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium = null;
try { chromium = (await import('playwright')).chromium; } catch (e) { for (const p of [process.env.PLAYWRIGHT, '/opt/npm-tools/node_modules/playwright']) { if (!p) continue; try { chromium = require(p).chromium; break; } catch (e2) { /* next */ } } }
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'tao_ma_truy_cap.html');
test('token page: sha256, links, hashes, no network', { skip: !chromium && 'Playwright not installed' }, async () => {
  const b = await chromium.launch(), p = await b.newPage(), reqs = [];
  p.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) reqs.push(r.url()); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + FILE);
  const rnd = []; for (let i = 0; i < 1000; i++) rnd.push(crypto.randomBytes(1 + (i % 70)).toString('base64url'));
  const got = await p.evaluate((a) => a.map((s) => window.__sha256hex(s)), rnd);
  rnd.forEach((s, i) => assert.equal(got[i], crypto.createHash('sha256').update(s).digest('hex')));
  assert.equal(await p.evaluate(() => window.__sha256hex('')), crypto.createHash('sha256').update('').digest('hex'));
  await p.click('#gen');
  const outs = await p.$$eval('#results .out', (e) => e.map((x) => x.textContent));
  const toks = outs.filter((s) => /^[A-Za-z0-9_-]{32}$/.test(s)), hashes = outs.filter((s) => /^[0-9a-f]{64}$/.test(s));
  assert.equal(toks.length, 3);   // two people and admin
  assert.equal(hashes.length, 3);
  toks.forEach((t, i) => assert.equal(hashes[i], crypto.createHash('sha256').update(t).digest('hex')));
  const links = outs.filter((s) => s.startsWith('https://'));
  assert.ok(links.some((l) => l.endsWith('/so-do/#minh.' + toks[0])) && links.some((l) => l.endsWith('/#admin.' + toks[2])));
  assert.equal(new Set(toks).size, 3);
  await p.fill('#have', toks[0]);
  assert.equal(await p.textContent('#haveOut'), hashes[0]);
  await p.click('#addTest');
  assert.ok((await p.textContent('#results')).includes('SODO_HASH_TEST') && (await p.textContent('#results')).includes('LTM,DTG,TEST'));
  assert.deepEqual(reqs, []); assert.deepEqual(errs, []);
  await b.close();
});
