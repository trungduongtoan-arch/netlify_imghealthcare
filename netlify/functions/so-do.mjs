/* Netlify Function /api/so-do: kho số đo chung của chú Minh và dì Giang.
   Toàn bộ logic nằm ở ../lib/sodo_core.mjs (có bộ thử riêng). Tệp này chỉ nối với Netlify Blobs, biến môi trường và giới hạn tốc độ. */
import { getStore } from '@netlify/blobs';
import { handle } from '../lib/sodo_core.mjs';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
function rand(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHA[a[i] % 36];
  return out;
}

export default async (req) => {
  // consistency strong: máy thứ hai thấy ngay số vừa lưu, không phải chờ bản sao lan ra
  const store = getStore({ name: 'sodo', consistency: 'strong' });
  return handle(req, { store, env: (k) => Netlify.env.get(k), now: () => new Date(), rand });
};

export const config = {
  path: '/api/so-do',
  method: ['GET', 'POST', 'DELETE'],
  // 120 yêu cầu mỗi phút cho mỗi địa chỉ IP; vượt thì Netlify trả 429. Trang chỉ hỏi vài lần mỗi phút.
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
