// Generates build/icon.png (1024x1024, no dependencies). Run: node electron/make-icon.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const N = 1024;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const o = y * (N * 4 + 1) + 1 + x * 4;
    const r = 200, m = 60;
    const cx = Math.min(Math.max(x, m + r), N - m - r), cy = Math.min(Math.max(y, m + r), N - m - r);
    const inside = x >= m && x < N - m && y >= m && y < N - m && Math.hypot(x - cx, y - cy) <= r;
    if (!inside) continue;
    const t = (x + y) / (2 * N);
    let c = [Math.round(99 + 90 * t), Math.round(102 - 30 * t), Math.round(241 - 20 * t)];
    if (x >= 400 && x <= 780 && Math.abs(y - 512) <= (780 - x) * (212 / 380)) c = [255, 255, 255];
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
