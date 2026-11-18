/* Kho giả trong bộ nhớ, đúng hợp đồng phần Store của @netlify/blobs mà lõi dùng:
   set(key, data, {onlyIfNew}), get(key, {type}), list({prefix}), delete(key). Có đếm lệnh để kiểm số lần gọi. */
export class MemStore {
  constructor() { this.m = new Map(); this.calls = { set: 0, get: 0, list: 0, delete: 0 }; this.failNextSet = 0; }
  async set(key, data, opt) {
    this.calls.set++;
    if (this.failNextSet > 0) { this.failNextSet--; throw new Error('boom'); }
    if (opt && opt.onlyIfNew && this.m.has(key)) return { modified: false };
    this.m.set(key, String(data));
    return { modified: true, etag: '"' + this.m.size + '"' };
  }
  async get(key) { this.calls.get++; return this.m.has(key) ? this.m.get(key) : null; }
  async list(opt) {
    this.calls.list++;
    const p = (opt && opt.prefix) || '';
    return { blobs: [...this.m.keys()].filter((k) => k.startsWith(p)).sort().map((key) => ({ key, etag: '"x"' })), directories: [] };
  }
  async delete(key) { this.calls.delete++; this.m.delete(key); }
}
