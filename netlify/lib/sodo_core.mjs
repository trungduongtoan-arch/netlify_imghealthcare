/* Kho số đo chung: lõi xử lý của Netlify Function /api/so-do.
   Hàm thuần: nhận Request chuẩn web và các phụ thuộc truyền vào (kho Blobs, biến môi trường, đồng hồ, bộ sinh chuỗi ngẫu nhiên),
   trả Response chuẩn web. Nhờ vậy bộ thử chạy được với kho giả mà không cần Netlify.

   Bố cục kho: nhật ký chỉ thêm. Mỗi thao tác tạo, sửa, xoá là một blob bất biến
     ops/<PID>/<ISO-ms>-<rand>     ví dụ ops/LTM/2026-11-19T03:15:30.123Z-k3m9x
   ghi bằng onlyIfNew nên không bao giờ ghi đè và hai máy ghi cùng lúc không làm mất nhau.
   Máy chủ không gộp, không đọc rồi ghi lại: việc gộp theo entry_id và rev làm ở phía trang.

   Mã truy cập: Authorization: Bearer <mã>. Máy chủ chỉ giữ SHA-256 (hex) của mã trong biến môi trường
     SODO_HASH_<PID> cho từng người (PID nằm trong SODO_PEOPLE, mặc định LTM,DTG) và SODO_HASH_ADMIN cho quản trị (chỉ đọc).
   Người gửi lên không quyết định được mình là ai: PID lấy từ mã, trường person trong thân bị bỏ qua. */
import { createHash, timingSafeEqual } from 'node:crypto';

export const LIMITS = { body: 40 * 1024, ops: 50, page: 300, pageDefault: 200, note: 300, str: 40, arr: 20, overlapMs: 10000, daysMax: 3660, pastDays: 400, futureMs: 24 * 3600 * 1000 };
const DAY = 24 * 3600 * 1000;
const TYPES = ['bp', 'pain', 'weight', 'glucose', 'symptom', 'habit'];
const ID_RE = /^[A-Z0-9]{3,12}$/;
const OPID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const DEV_RE = /^D[A-Z0-9]{4,12}$/;
const PID_RE = /^[A-Z0-9]{2,8}$/;
const HAB_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-[a-z0-9]{4,16}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ARM = ['trái', 'phải'], SEV = ['Nhẹ', 'Vừa', 'Nặng'], CTX = ['doi', 'sauan', 'bat'];

class Reject extends Error { constructor(why) { super(why); this.why = why; } }
const bad = (why) => { throw new Reject(why); };

/* ---------- trả lời ---------- */
const HEAD = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
function reply(status, body) { return new Response(JSON.stringify(body), { status, headers: HEAD }); }

/* ---------- mã truy cập ---------- */
export function sha256hex(s) { return createHash('sha256').update(String(s)).digest('hex'); }
function same(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
export function listPeople(env) {
  return String(env('SODO_PEOPLE') || 'LTM,DTG').split(',').map((s) => s.trim().toUpperCase()).filter((s) => PID_RE.test(s));
}
function listPurgeable(env) {
  return String(env('SODO_PURGEABLE') || 'TEST').split(',').map((s) => s.trim().toUpperCase()).filter((s) => PID_RE.test(s));
}
// Trả { role: 'person', pid } hoặc { role: 'admin' } hoặc null. So sánh hết mọi ứng viên, không dừng sớm.
export function authenticate(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') || '');
  if (!m || !TOKEN_RE.test(m[1])) return null;
  const h = sha256hex(m[1]);
  let found = null;
  for (const pid of listPeople(env)) {
    const want = String(env('SODO_HASH_' + pid) || '').toLowerCase();
    if (want && same(h, want) && !found) found = { role: 'person', pid };
  }
  const adm = String(env('SODO_HASH_ADMIN') || '').toLowerCase();
  if (adm && same(h, adm) && !found) found = { role: 'admin' };
  return found;
}

/* ---------- kiểm tra và làm sạch ---------- */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function intIn(v, lo, hi, why) { if (!isNum(v) || v % 1 !== 0 || v < lo || v > hi) bad(why); return v; }
function decIn(v, lo, hi, why) { if (!isNum(v) || v < lo || v > hi) bad(why); return Math.round(v * 10) / 10; }
function str(v, max, why) {
  if (typeof v !== 'string') bad(why);
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function strList(v, why) {
  if (!Array.isArray(v) || v.length > LIMITS.arr) bad(why);
  return v.map((x) => str(x, LIMITS.str, why)).filter(Boolean);
}
function oneOf(v, list, why) { if (!list.includes(v)) bad(why); return v; }
function validDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function timeIn(v, nowMs, why) {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms) || ms < nowMs - LIMITS.pastDays * DAY || ms > nowMs + LIMITS.futureMs) bad(why);
  return new Date(ms).toISOString();
}

// Giữ đúng các trường của từng loại; trường lạ bị bỏ. Khoảng giá trị khớp với kiểm tra phía trang Sổ đo.
export function cleanEntry(raw, op, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('e');
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) bad('id');
  oneOf(raw.type, TYPES, 'type');
  const e = { id: raw.id, code: typeof raw.code === 'string' && ID_RE.test(raw.code) ? raw.code : raw.id, type: raw.type };
  if (raw.type === 'habit') {
    if (!validDay(raw.day)) bad('day');
    const ms = Date.parse(raw.day + 'T00:00:00.000Z');
    if (ms < nowMs - LIMITS.pastDays * DAY || ms > nowMs + 2 * DAY) bad('day');
    e.day = raw.day;
    e.t = raw.t != null ? timeIn(raw.t, nowMs, 't') : raw.day + 'T05:00:00.000Z';
  } else if (raw.t != null || op !== 'delete') e.t = timeIn(raw.t, nowMs, 't');
  if (op === 'delete') return e;
  if (raw.type === 'bp') {
    e.sbp = intIn(raw.sbp, 60, 260, 'sbp'); e.dbp = intIn(raw.dbp, 30, 160, 'dbp');
    if (e.dbp >= e.sbp) bad('dbp');
    if (raw.hr != null) e.hr = intIn(raw.hr, 30, 220, 'hr');
    if (raw.arm != null) e.arm = oneOf(raw.arm, ARM, 'arm');
  } else if (raw.type === 'pain') {
    e.pain = intIn(raw.pain, 0, 10, 'pain');
    if (raw.loc != null) { const l = strList(raw.loc, 'loc'); if (l.length) e.loc = l; }
    if (raw.kind != null) { const k = str(raw.kind, 160, 'kind'); if (k) e.kind = k; }
  } else if (raw.type === 'weight') {
    if (raw.weight == null && raw.waist == null) bad('weight');
    if (raw.weight != null) e.weight = decIn(raw.weight, 25, 250, 'weight');
    if (raw.waist != null) e.waist = decIn(raw.waist, 40, 200, 'waist');
  } else if (raw.type === 'glucose') {
    e.glu = decIn(raw.glu, 1, 35, 'glu');   // luôn lưu mmol/L; trang đã đổi từ mg/dL
    e.ctx = oneOf(raw.ctx, CTX, 'ctx');
  } else if (raw.type === 'symptom') {
    e.sym = raw.sym == null ? [] : strList(raw.sym, 'sym');
    if (raw.sev != null && raw.sev !== '') e.sev = oneOf(raw.sev, SEV, 'sev');
    if (raw.temp != null) e.temp = decIn(raw.temp, 34, 43, 'temp');
    if (!e.sym.length && !(typeof raw.note === 'string' && raw.note.trim())) bad('sym');
  } else if (raw.type === 'habit') {
    if (!Array.isArray(raw.done) || raw.done.length > LIMITS.arr) bad('done');
    const seen = {};
    e.done = raw.done.filter((x) => typeof x === 'string' && HAB_RE.test(x) && !seen[x] && (seen[x] = 1));
  }
  if (raw.note != null) { const n = str(raw.note, LIMITS.note, 'note'); if (n) e.note = n; }
  return e;
}

// Một thao tác của máy gửi lên -> bản ghi sẽ lưu. Ném Reject khi sai.
export function cleanOp(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('op');
  if (typeof raw.id !== 'string' || !OPID_RE.test(raw.id)) bad('op_id');
  const op = oneOf(raw.op, ['create', 'update', 'delete'], 'op');
  const rev = intIn(raw.rev, 1, 100000, 'rev');
  let at = Date.parse(raw.at);
  if (!Number.isFinite(at) || at < nowMs - 800 * DAY || at > nowMs + 2 * DAY) at = nowMs;   // đồng hồ máy lệch: lấy giờ máy chủ
  const dev = typeof raw.dev === 'string' && DEV_RE.test(raw.dev) ? raw.dev : '';
  const e = cleanEntry(raw.e, op, nowMs);
  e.rev = rev;
  return { v: 1, id: raw.id, op, rev, at: new Date(at).toISOString(), dev, e };
}

/* ---------- khoá và đọc nhật ký ---------- */
const pad = (n, w) => String(n).padStart(w || 2, '0');
export function isoMs(ms) { return new Date(ms).toISOString(); }
const prefixOf = (pid) => 'ops/' + pid + '/';
function* daysBetween(fromMs, toMs) {
  for (let d = Math.floor(fromMs / DAY) * DAY; d <= toMs; d += DAY) yield isoMs(d).slice(0, 10);
}
async function listKeys(store, prefix) {
  const r = await store.list({ prefix });
  return (r.blobs || []).map((b) => b.key);
}
// Các khoá của một người từ mốc lower (chuỗi ISO, so sánh theo thứ tự chữ) trở đi, đã sắp xếp tăng dần.
// lower có thể là mốc giờ trần (24 ký tự) hoặc một khoá đầy đủ; rỗng nghĩa là từ đầu.
async function keysFrom(store, pid, lower, nowMs) {
  const base = prefixOf(pid), end = nowMs + 60000;
  let keys = [];
  const fromMs = lower ? Date.parse(lower.slice(0, 24)) : NaN;
  if (Number.isFinite(fromMs) && end - fromMs <= 40 * DAY) {
    const jobs = [];
    for (const day of daysBetween(fromMs, end)) jobs.push(listKeys(store, base + day));
    keys = [].concat(...(await Promise.all(jobs)));
  } else keys = await listKeys(store, base);
  const seen = new Set();
  return keys.filter((k) => k.startsWith(base) && !seen.has(k) && seen.add(k)).map((k) => k.slice(base.length)).filter((k) => KEY_RE.test(k) && (!lower || k > lower)).sort();
}
// Đọc nội dung các khoá. Gặp một khoá không đọc được thì dừng ngay trước nó để lần sau đọc lại, không bỏ sót.
async function fetchOps(store, pid, ks) {
  const out = [];
  for (let i = 0; i < ks.length; i += 25) {
    const part = await Promise.all(ks.slice(i, i + 25).map(async (k) => {
      const txt = await store.get(prefixOf(pid) + k, { type: 'text' });
      if (txt == null) return { k, miss: true };
      try { const r = JSON.parse(txt); return { k, s: r.s || '', dev: r.dev || '', id: r.id, op: r.op, rev: r.rev, at: r.at, e: r.e }; } catch (err) { return { k, skip: true }; }
    }));
    for (const p of part) { if (p.miss) return { ops: out, stoppedAt: p.k }; out.push(p); }
  }
  return { ops: out, stoppedAt: '' };
}

/* ---------- xử lý yêu cầu ---------- */
async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > LIMITS.body) return { tooBig: true };
  const text = await req.text();
  if (Buffer.byteLength(text) > LIMITS.body) return { tooBig: true };
  return { text };
}

async function post(req, who, deps) {
  if (who.role !== 'person') return reply(403, { ok: false, error: 'read_only' });
  const body = await readBody(req);
  if (body.tooBig) return reply(413, { ok: false, error: 'too_large' });
  let data;
  try { data = JSON.parse(body.text); } catch (e) { return reply(400, { ok: false, error: 'bad_request', why: 'json' }); }
  if (!data || !Array.isArray(data.ops) || data.ops.length < 1 || data.ops.length > LIMITS.ops) return reply(400, { ok: false, error: 'bad_request', why: 'ops' });
  const nowMs = deps.now().getTime();
  const good = [], rejected = [];
  data.ops.forEach((raw) => {
    try { good.push(cleanOp(raw, nowMs)); } catch (e) {
      if (!(e instanceof Reject)) throw e;
      rejected.push({ id: raw && typeof raw.id === 'string' ? raw.id.slice(0, 40) : '', why: e.why });
    }
  });
  if (!good.length) return reply(422, { ok: false, error: 'invalid', rejected });
  const saved = [];
  for (let i = 0; i < good.length; i++) {
    const rec = good[i];
    let done = false;
    for (let tries = 0; tries < 4 && !done; tries++) {
      const t = deps.now().getTime() + i;   // trong một lần gửi, khoá tăng dần theo thứ tự
      const key = prefixOf(who.pid) + isoMs(t) + '-' + deps.rand(5);
      const res = await deps.store.set(key, JSON.stringify(Object.assign({ s: isoMs(deps.now().getTime()) }, rec)), { onlyIfNew: true });
      if (res && res.modified) { saved.push(rec.id); done = true; }
    }
    if (!done) throw new Error('key_collision');
  }
  return reply(200, { ok: true, person: who.pid, saved, rejected });
}

async function get(req, who, deps, url) {
  const q = url.searchParams, env = deps.env, nowMs = deps.now().getTime();
  let pid = who.pid;
  const asked = (q.get('person') || '').toUpperCase();
  if (who.role === 'admin') {
    if (!listPeople(env).includes(asked)) return reply(400, { ok: false, error: 'bad_request', why: 'person' });
    pid = asked;
  } else if (asked && asked !== pid) return reply(403, { ok: false, error: 'forbidden' });
  const limit = Math.max(1, Math.min(LIMITS.page, parseInt(q.get('limit') || String(LIMITS.pageDefault), 10) || LIMITS.pageDefault));
  const since = q.get('since') || '', after = q.get('after') || '';
  if ((since && !KEY_RE.test(since)) || (after && !KEY_RE.test(after)) || (since && after)) return reply(400, { ok: false, error: 'bad_request', why: 'cursor' });
  let lower = '';
  if (after) lower = after;                                              // trang kế: đúng sau khoá này
  else if (since) lower = isoMs(Date.parse(since.slice(0, 24)) - LIMITS.overlapMs);   // lùi vài giây phòng ghi chậm
  else if (q.get('days')) {
    const n = Math.max(1, Math.min(LIMITS.daysMax, parseInt(q.get('days'), 10) || 1));
    lower = isoMs(nowMs - n * DAY);
  }
  const keys = await keysFrom(deps.store, pid, lower, nowMs);
  const page = keys.slice(0, limit);
  const got = await fetchOps(deps.store, pid, page);
  const ops = got.ops.filter((o) => !o.skip);
  const upto = got.ops.length ? got.ops[got.ops.length - 1].k : '';
  const more = keys.length > got.ops.length;
  const cursor = upto || (after || since || '');
  return reply(200, { ok: true, person: pid, role: who.role, cursor, more, ops, now: isoMs(nowMs) });
}

// Chỉ quản trị, chỉ với người trong SODO_PURGEABLE (mặc định TEST): xoá toàn bộ nhật ký của người giả dùng để thử.
async function purge(req, who, deps, url) {
  if (who.role !== 'admin') return reply(403, { ok: false, error: 'forbidden' });
  const pid = (url.searchParams.get('person') || '').toUpperCase();
  if (url.searchParams.get('confirm') !== 'PURGE-' + pid || !listPurgeable(deps.env).includes(pid)) return reply(400, { ok: false, error: 'bad_request', why: 'purge' });
  const keys = await listKeys(deps.store, prefixOf(pid));
  for (const k of keys) await deps.store.delete(k);
  return reply(200, { ok: true, person: pid, deleted: keys.length });
}

export async function handle(req, deps) {
  try {
    const url = new URL(req.url);
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return reply(405, { ok: false, error: 'method' });
    const who = authenticate(req, deps.env);
    if (!who) return reply(401, { ok: false, error: 'auth' });
    if (req.method === 'POST') return await post(req, who, deps);
    if (req.method === 'DELETE') return await purge(req, who, deps, url);
    return await get(req, who, deps, url);
  } catch (err) {
    try { console.error('so-do error:', err && err.message ? err.message : String(err)); } catch (e) { /* nothing */ }
    return reply(500, { ok: false, error: 'server' });
  }
}
