/* Bộ thử lõi kho số đo chung. Chạy: node --test test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, sha256hex, cleanOp, LIMITS } from '../netlify/lib/sodo_core.mjs';
import { MemStore } from './memstore.mjs';

const TOK = { LTM: 'tokLTMtokLTMtokLTMtokLTM0123', DTG: 'tokDTGtokDTGtokDTGtokDTG4567', ADMIN: 'tokADMINtokADMINtokADMIN89ab', TEST: 'tokTESTtokTESTtokTESTtokTEST_-' };
function makeEnv(extra) {
  const e = { SODO_HASH_LTM: sha256hex(TOK.LTM), SODO_HASH_DTG: sha256hex(TOK.DTG), SODO_HASH_ADMIN: sha256hex(TOK.ADMIN) };
  Object.assign(e, extra || {});
  return (k) => e[k];
}
let clock;
function mk(extra) {
  clock = Date.parse('2026-11-19T03:00:00.000Z');
  let n = 0;
  const store = new MemStore();
  const deps = { store, env: makeEnv(extra), now: () => new Date(clock), rand: () => ('r' + (n++).toString(36) + 'xxxxx').slice(0, 5) };
  return deps;
}
function req(method, path, tok, body) {
  const h = {};
  if (tok) h.authorization = 'Bearer ' + tok;
  if (body !== undefined) h['content-type'] = 'application/json';
  return new Request('https://x.test' + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
}
const J = async (r) => ({ status: r.status, body: await r.json(), headers: r.headers });
const T0 = '2026-11-19T02:50:00.000Z';
const bp = (id, rev, extra) => ({ id: 'Q' + id + rev + 'abcd', op: rev === 1 ? 'create' : 'update', rev, at: T0, dev: 'DAAAA1111', e: Object.assign({ id, code: id, type: 'bp', t: T0, sbp: 128, dbp: 78, hr: 70, arm: 'trái', rev }, extra || {}) });

test('thiếu mã, mã sai, mã lạ đều 401 cùng một thông báo', async () => {
  const d = mk();
  for (const t of [undefined, 'short', 'x'.repeat(30), TOK.LTM + 'z', 'Bearer', 'tok LTM']) {
    const r = await J(await handle(req('GET', '/api/so-do', t), d));
    assert.equal(r.status, 401); assert.deepEqual(r.body, { ok: false, error: 'auth' });
  }
  const r = await J(await handle(new Request('https://x.test/api/so-do', { headers: { authorization: 'Basic abc' } }), d));
  assert.equal(r.status, 401);
  assert.equal(d.store.calls.list + d.store.calls.get + d.store.calls.set, 0, 'không chạm kho khi chưa xác thực');
});

test('phương thức khác bị từ chối, không có CORS', async () => {
  const d = mk();
  const r = await handle(req('PUT', '/api/so-do', TOK.LTM, {}), d);
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const ok = await handle(req('GET', '/api/so-do', TOK.LTM), d);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.headers.get('access-control-allow-origin'), null);
});

test('ghi rồi đọc: người lấy từ mã, bỏ qua person trong thân', async () => {
  const d = mk();
  const body = { person: 'DTG', ops: [Object.assign(bp('AAA111', 1), { person: 'DTG', e: Object.assign(bp('AAA111', 1).e, { person: 'DTG', hack: 'x' }) })] };
  const w = await J(await handle(req('POST', '/api/so-do', TOK.LTM, body), d));
  assert.equal(w.status, 200); assert.equal(w.body.person, 'LTM'); assert.deepEqual(w.body.saved, [body.ops[0].id]);
  const keys = [...d.store.m.keys()];
  assert.equal(keys.length, 1); assert.match(keys[0], /^ops\/LTM\/2026-11-19T03:00:00\.000Z-[a-z0-9]{5}$/);
  const rec = JSON.parse(d.store.m.get(keys[0]));
  assert.equal(rec.e.hack, undefined); assert.equal(rec.e.person, undefined); assert.equal(rec.e.sbp, 128);
  // dì Giang không thấy gì của chú
  const dtg = await J(await handle(req('GET', '/api/so-do', TOK.DTG), d));
  assert.equal(dtg.body.person, 'DTG'); assert.equal(dtg.body.ops.length, 0);
  const ltm = await J(await handle(req('GET', '/api/so-do', TOK.LTM), d));
  assert.equal(ltm.body.ops.length, 1); assert.equal(ltm.body.ops[0].e.sbp, 128); assert.equal(ltm.body.ops[0].dev, 'DAAAA1111');
  assert.match(ltm.body.cursor, /^2026-11-19T03:00:00\.000Z-/);
});

test('người dùng không đọc được người khác bằng person=', async () => {
  const d = mk();
  const r = await J(await handle(req('GET', '/api/so-do?person=DTG', TOK.LTM), d));
  assert.equal(r.status, 403);
  const own = await J(await handle(req('GET', '/api/so-do?person=ltm', TOK.LTM), d));
  assert.equal(own.status, 200);
});

test('quản trị chỉ đọc: đọc được cả hai người, không ghi được', async () => {
  const d = mk();
  await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), d);
  await handle(req('POST', '/api/so-do', TOK.DTG, { ops: [bp('BBB222', 1, { sbp: 150 })] }), d);
  const a1 = await J(await handle(req('GET', '/api/so-do?person=LTM', TOK.ADMIN), d));
  const a2 = await J(await handle(req('GET', '/api/so-do?person=DTG', TOK.ADMIN), d));
  assert.equal(a1.body.ops[0].e.id, 'AAA111'); assert.equal(a2.body.ops[0].e.sbp, 150);
  assert.equal((await J(await handle(req('GET', '/api/so-do', TOK.ADMIN), d))).status, 400, 'quản trị phải nêu person');
  assert.equal((await J(await handle(req('GET', '/api/so-do?person=TEST', TOK.ADMIN), d))).status, 400, 'người ngoài danh sách');
  const w = await J(await handle(req('POST', '/api/so-do', TOK.ADMIN, { ops: [bp('CCC333', 1)] }), d));
  assert.equal(w.status, 403); assert.equal(w.body.error, 'read_only');
  assert.equal(d.store.m.size, 2);
});

test('kiểm giá trị từng loại: ngoài khoảng bị loại, phần hợp lệ vẫn lưu', async () => {
  const d = mk();
  const bad = [
    bp('AAA111', 1, { sbp: 300 }), bp('AAB111', 1, { dbp: 20 }), bp('AAC111', 1, { sbp: 100, dbp: 100 }), bp('AAD111', 1, { hr: 20 }), bp('AAE111', 1, { sbp: 120.5 }),
    bp('AAF111', 1, { arm: 'giữa' }), bp('AAG111', 1, { t: '2020-01-01T00:00:00Z' }), bp('AAH111', 1, { t: '2027-06-01T00:00:00Z' }), bp('AAI111', 1, { t: 'hôm qua' }),
    bp('lower1', 1), { id: 'Qbad1', op: 'create', rev: 1, e: { id: 'ZZZ111', type: 'ecg', t: T0 } },
    { id: 'Qbad2', op: 'frob', rev: 1, e: bp('ZZ1111', 1).e }, { id: 'Qbad3', op: 'create', rev: 0, e: bp('ZZ2222', 1).e }, { id: 'x', op: 'create', rev: 1, e: bp('ZZ3333', 1).e },
    { id: 'Qbad4', op: 'create', rev: 1, e: { id: 'ZZ4444', type: 'pain', t: T0, pain: 11 } },
    { id: 'Qbad5', op: 'create', rev: 1, e: { id: 'ZZ5555', type: 'weight', t: T0 } },
    { id: 'Qbad6', op: 'create', rev: 1, e: { id: 'ZZ6666', type: 'weight', t: T0, weight: 20 } },
    { id: 'Qbad7', op: 'create', rev: 1, e: { id: 'ZZ7777', type: 'weight', t: T0, waist: 300 } },
    { id: 'Qbad8', op: 'create', rev: 1, e: { id: 'ZZ8888', type: 'glucose', t: T0, glu: 0.5, ctx: 'doi' } },
    { id: 'Qbad9', op: 'create', rev: 1, e: { id: 'ZZ9999', type: 'glucose', t: T0, glu: 120, ctx: 'doi' } },
    { id: 'QbadA', op: 'create', rev: 1, e: { id: 'ZZAAAA', type: 'glucose', t: T0, glu: 5.5, ctx: 'sau' } },
    { id: 'QbadB', op: 'create', rev: 1, e: { id: 'ZZBBBB', type: 'symptom', t: T0, sym: ['Ho'], temp: 45 } },
    { id: 'QbadC', op: 'create', rev: 1, e: { id: 'ZZCCCC', type: 'symptom', t: T0, sym: [] } },
    { id: 'QbadD', op: 'create', rev: 1, e: { id: 'ZZDDDD', type: 'symptom', t: T0, sym: 'Ho' } },
    { id: 'QbadE', op: 'create', rev: 1, e: { id: 'H261119', type: 'habit', day: '2026-02-30', done: [] } },
    { id: 'QbadF', op: 'create', rev: 1, e: { id: 'H261119', type: 'habit', day: '2026-11-19', done: 'walk' } },
    { id: 'QbadG', op: 'create', rev: 1, e: 'chuỗi' }, 'chuỗi', null,
  ];
  const good = bp('GOOD11', 1);
  const w = await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [...bad, good] }), d));
  assert.equal(w.status, 200); assert.deepEqual(w.body.saved, [good.id]); assert.equal(w.body.rejected.length, bad.length);
  assert.equal(d.store.m.size, 1);
  const all = await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: bad }), d));
  assert.equal(all.status, 422); assert.equal(all.body.rejected.length, bad.length); assert.equal(d.store.m.size, 1);
  const whys = Object.fromEntries(w.body.rejected.filter((r) => r.id).map((r) => [r.id, r.why]));
  assert.equal(whys['QAAA1111abcd'], 'sbp'); assert.equal(whys['Qbad4'], 'pain'); assert.equal(whys['Qbad9'], 'glu'); assert.equal(whys['QbadA'], 'ctx');
});

test('mọi loại hợp lệ được lưu đúng, trường lạ bị bỏ, ghi chú cắt 300 ký tự', async () => {
  const d = mk();
  const ops = [
    { id: 'Qpain01', op: 'create', rev: 1, at: T0, dev: 'DBBBB2222', e: { id: 'PAIN01', type: 'pain', t: T0, pain: 6, loc: ['Lưng', 'Gối'], kind: 'Âm ỉ, Nhói', note: 'x'.repeat(500), extra: 1 } },
    { id: 'Qwt0001', op: 'create', rev: 1, at: T0, e: { id: 'WT0001', type: 'weight', t: T0, weight: 70.26, waist: 88 } },
    { id: 'Qwt0002', op: 'create', rev: 1, at: T0, e: { id: 'WT0002', type: 'weight', t: T0, waist: 90 } },
    { id: 'Qglu001', op: 'create', rev: 1, at: T0, e: { id: 'GLU001', type: 'glucose', t: T0, glu: 6.2, ctx: 'sauan' } },
    { id: 'Qsym001', op: 'create', rev: 1, at: T0, e: { id: 'SYM001', type: 'symptom', t: T0, sym: ['Ho', 'Sốt'], sev: 'Vừa', temp: 38.2 } },
    { id: 'Qsym002', op: 'create', rev: 1, at: T0, e: { id: 'SYM002', type: 'symptom', t: T0, sym: [], note: 'mệt' } },
    { id: 'Qhab001', op: 'create', rev: 3, at: T0, e: { id: 'H261119', code: 'H261119', type: 'habit', day: '2026-11-19', t: '2026-11-19T05:00:00.000Z', done: ['walk', 'walk', 'salt', 'bad id!'] } },
  ];
  const w = await J(await handle(req('POST', '/api/so-do', TOK.DTG, { ops }), d));
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.equal(w.body.saved.length, 7);
  const r = (await J(await handle(req('GET', '/api/so-do', TOK.DTG), d))).body.ops;
  const by = Object.fromEntries(r.map((o) => [o.e.id, o]));
  assert.equal(by.PAIN01.e.note.length, 300); assert.equal(by.PAIN01.e.extra, undefined); assert.deepEqual(by.PAIN01.e.loc, ['Lưng', 'Gối']);
  assert.equal(by.WT0001.e.weight, 70.3); assert.equal(by.WT0002.e.weight, undefined);
  assert.equal(by.GLU001.e.glu, 6.2); assert.equal(by.SYM001.e.temp, 38.2); assert.equal(by.SYM002.e.note, 'mệt');
  assert.deepEqual(by.H261119.e.done, ['walk', 'salt']); assert.equal(by.H261119.rev, 3); assert.equal(by.H261119.e.rev, 3);
  assert.equal(r.length, 7);
});

test('xoá chỉ cần id và loại; sửa mang rev mới', async () => {
  const d = mk();
  await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), d);
  clock += 5000;
  await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 2, { sbp: 135 })] }), d);
  clock += 5000;
  const del = await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [{ id: 'Qdel0001', op: 'delete', rev: 3, at: T0, e: { id: 'AAA111', type: 'bp', sbp: 9999, junk: 1 } }] }), d));
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const ops = (await J(await handle(req('GET', '/api/so-do', TOK.LTM), d))).body.ops;
  assert.deepEqual(ops.map((o) => [o.op, o.rev]), [['create', 1], ['update', 2], ['delete', 3]]);
  assert.equal(ops[2].e.sbp, undefined); assert.equal(ops[2].e.junk, undefined); assert.equal(ops[1].e.sbp, 135);
});

test('thân quá lớn, JSON hỏng, danh sách rỗng hoặc quá dài', async () => {
  const d = mk();
  const big = await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1, { note: 'x'.repeat(LIMITS.body) })] }), d));
  assert.equal(big.status, 413);
  assert.equal((await J(await handle(req('POST', '/api/so-do', TOK.LTM, '{khong phai json'), d))).status, 400);
  assert.equal((await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [] }), d))).status, 400);
  assert.equal((await J(await handle(req('POST', '/api/so-do', TOK.LTM, { khac: 1 }), d))).status, 400);
  const many = Array.from({ length: LIMITS.ops + 1 }, (_, i) => bp('M' + String(i).padStart(5, '0'), 1));
  assert.equal((await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: many }), d))).status, 400);
  assert.equal(d.store.m.size, 0);
});

test('hai máy ghi cùng một mili giây không đè nhau; trùng khoá thì thử khoá khác', async () => {
  const d = mk();
  d.rand = () => 'same1';   // ép trùng khoá
  const [a, b] = await Promise.all([
    handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), d),
    handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('BBB222', 1)] }), d),
  ]);
  // cả hai đều dùng cùng khoá nên một bên báo lỗi máy chủ; không bên nào ghi đè bên kia
  const st = [a.status, b.status].sort();
  assert.deepEqual(st, [200, 500]);
  assert.equal(d.store.m.size, 1);
  // khi bộ sinh số ngẫu nhiên khác nhau thì cả hai đều vào
  let n = 0; d.rand = () => 'k' + (n++) + 'abcd';
  clock += 10;
  const [c, e] = await Promise.all([handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('CCC333', 1)] }), d), handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('DDD444', 1)] }), d)]);
  assert.deepEqual([c.status, e.status], [200, 200]); assert.equal(d.store.m.size, 3);
});

test('lỗi kho khi ghi trả 500 chung, không lộ chi tiết', async () => {
  const d = mk(); d.store.failNextSet = 1;
  const r = await J(await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), d));
  assert.equal(r.status, 500); assert.deepEqual(r.body, { ok: false, error: 'server' });
});

test('đọc phân trang, con trỏ since có lùi vài giây, after chặt', async () => {
  const d = mk();
  for (let i = 0; i < 7; i++) { await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('P' + String(i).padStart(5, '0'), 1)] }), d); clock += 1000; }
  const p1 = (await J(await handle(req('GET', '/api/so-do?limit=3', TOK.LTM), d))).body;
  assert.equal(p1.ops.length, 3); assert.equal(p1.more, true);
  const p2 = (await J(await handle(req('GET', '/api/so-do?limit=3&after=' + p1.cursor, TOK.LTM), d))).body;
  assert.equal(p2.ops.length, 3); assert.equal(p2.more, true);
  assert.deepEqual(p2.ops.map((o) => o.e.id), ['P00003', 'P00004', 'P00005']);
  const p3 = (await J(await handle(req('GET', '/api/so-do?limit=3&after=' + p2.cursor, TOK.LTM), d))).body;
  assert.equal(p3.ops.length, 1); assert.equal(p3.more, false); assert.equal(p3.ops[0].e.id, 'P00006');
  // không có gì mới: cursor giữ nguyên
  const p4 = (await J(await handle(req('GET', '/api/so-do?after=' + p3.cursor, TOK.LTM), d))).body;
  assert.equal(p4.ops.length, 0); assert.equal(p4.cursor, p3.cursor);
  // since lùi 10 giây: trả lại vài mục cuối
  const s = (await J(await handle(req('GET', '/api/so-do?since=' + p3.cursor, TOK.LTM), d))).body;
  assert.ok(s.ops.length >= 3 && s.ops.length <= 7, 'số mục trả lại ' + s.ops.length);
  assert.equal(s.ops[s.ops.length - 1].e.id, 'P00006');
  assert.equal((await J(await handle(req('GET', '/api/so-do?since=abc', TOK.LTM), d))).status, 400);
  assert.equal((await J(await handle(req('GET', '/api/so-do?since=' + p3.cursor + '&after=' + p3.cursor, TOK.LTM), d))).status, 400);
});

test('đọc qua nhiều ngày: since cũ vài ngày và đọc từ đầu', async () => {
  const d = mk();
  const stamps = ['2026-11-10T03:00:00.000Z', '2026-11-15T03:00:00.000Z', '2026-11-19T01:00:00.000Z'];
  for (const [i, s] of stamps.entries()) {
    clock = Date.parse(s);
    await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('D' + String(i).padStart(5, '0'), 1, { t: s })] }), d);
  }
  clock = Date.parse('2026-11-19T03:00:00.000Z');
  const all = (await J(await handle(req('GET', '/api/so-do', TOK.LTM), d))).body.ops.map((o) => o.e.id);
  assert.deepEqual(all, ['D00000', 'D00001', 'D00002']);
  const sinceOld = (await J(await handle(req('GET', '/api/so-do?since=2026-11-14T00:00:00.000Z-aaaaa', TOK.LTM), d))).body.ops.map((o) => o.e.id);
  assert.deepEqual(sinceOld, ['D00001', 'D00002']);
  const days = (await J(await handle(req('GET', '/api/so-do?days=2', TOK.LTM), d))).body.ops.map((o) => o.e.id);
  assert.deepEqual(days, ['D00002']);
  const farSince = (await J(await handle(req('GET', '/api/so-do?since=2026-01-01T00:00:00.000Z-aaaaa', TOK.LTM), d))).body.ops.length;
  assert.equal(farSince, 3);
  // đọc đều đặn chỉ gọi list theo ngày, không quét toàn bộ
  d.store.calls.list = 0;
  await handle(req('GET', '/api/so-do?since=2026-11-19T01:00:00.000Z-aaaaa', TOK.LTM), d);
  assert.ok(d.store.calls.list <= 2, 'số lần list ' + d.store.calls.list);
});

test('khoá không đọc được thì dừng trước nó, lần sau đọc lại', async () => {
  const d = mk();
  for (let i = 0; i < 3; i++) { await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('M' + String(i).padStart(5, '0'), 1)] }), d); clock += 1000; }
  const keys = [...d.store.m.keys()].sort();
  const keep = d.store.m.get(keys[1]); d.store.m.delete(keys[1]);
  // khoá bị mất nhưng vẫn "thấy" trong danh sách: giả lập bằng list trả khoá thừa
  const realList = d.store.list.bind(d.store);
  d.store.list = async (o) => { const r = await realList(o); r.blobs.push({ key: keys[1], etag: '"x"' }); return r; };
  const r = (await J(await handle(req('GET', '/api/so-do', TOK.LTM), d))).body;
  assert.equal(r.ops.length, 1); assert.equal(r.more, true); assert.equal(r.cursor, keys[0].slice('ops/LTM/'.length));
  d.store.m.set(keys[1], keep);
  const r2 = (await J(await handle(req('GET', '/api/so-do?after=' + r.cursor, TOK.LTM), d))).body;
  assert.deepEqual(r2.ops.map((o) => o.e.id), ['M00001', 'M00002']);
});

test('xoá dữ liệu thử: chỉ quản trị, chỉ người trong danh sách thử, phải xác nhận', async () => {
  const d = mk({ SODO_PEOPLE: 'LTM,DTG,TEST', SODO_HASH_TEST: sha256hex(TOK.TEST) });
  await handle(req('POST', '/api/so-do', TOK.TEST, { ops: [bp('TTT111', 1), bp('TTT222', 1)] }), d);
  await handle(req('POST', '/api/so-do', TOK.LTM, { ops: [bp('AAA111', 1)] }), d);
  assert.equal(d.store.m.size, 3);
  assert.equal((await J(await handle(req('DELETE', '/api/so-do?person=TEST&confirm=PURGE-TEST', TOK.TEST), d))).status, 403);
  assert.equal((await J(await handle(req('DELETE', '/api/so-do?person=TEST&confirm=PURGE-TEST', TOK.LTM), d))).status, 403);
  assert.equal((await J(await handle(req('DELETE', '/api/so-do?person=TEST', TOK.ADMIN), d))).status, 400);
  assert.equal((await J(await handle(req('DELETE', '/api/so-do?person=LTM&confirm=PURGE-LTM', TOK.ADMIN), d))).status, 400, 'người thật không xoá được');
  assert.equal(d.store.m.size, 3);
  const r = await J(await handle(req('DELETE', '/api/so-do?person=TEST&confirm=PURGE-TEST', TOK.ADMIN), d));
  assert.equal(r.status, 200); assert.equal(r.body.deleted, 2);
  assert.deepEqual([...d.store.m.keys()].map((k) => k.split('/')[1]), ['LTM']);
});

test('người ngoài danh sách SODO_PEOPLE dù có băm cũng không vào được', async () => {
  const d = mk({ SODO_HASH_TEST: sha256hex(TOK.TEST) });   // không khai TEST trong SODO_PEOPLE
  assert.equal((await handle(req('GET', '/api/so-do', TOK.TEST), d)).status, 401);
});

test('mã bị đổi thì mã cũ vô hiệu ngay', async () => {
  const d = mk();
  assert.equal((await handle(req('GET', '/api/so-do', TOK.LTM), d)).status, 200);
  d.env = makeEnv({ SODO_HASH_LTM: sha256hex('tokMoiLTMtokMoiLTMtokMoi123') });
  assert.equal((await handle(req('GET', '/api/so-do', TOK.LTM), d)).status, 401);
  assert.equal((await handle(req('GET', '/api/so-do', 'tokMoiLTMtokMoiLTMtokMoi123'), d)).status, 200);
});

test('giờ gửi lệch được thay bằng giờ máy chủ; giờ đo bắt buộc trong khoảng cho phép', async () => {
  const nowMs = Date.parse('2026-11-19T03:00:00.000Z');
  const o = cleanOp(Object.assign(bp('AAA111', 1), { at: '1999-01-01T00:00:00Z' }), nowMs);
  assert.equal(o.at, '2026-11-19T03:00:00.000Z');
  assert.throws(() => cleanOp(bp('AAA111', 1, { t: '2025-01-01T00:00:00Z' }), nowMs), { why: 't' });
});
