// Minimal PNG reader for the simulator's 576×288 screenshots (8-bit, non-interlaced),
// so the check needs no image library.

import { inflateSync } from 'node:zlib';

export interface Image {
  w: number;
  h: number;
  /** 0..255 brightness per pixel. */
  lum: Uint8Array;
}

export function decodePng(buf: Buffer): Image {
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || interlace !== 0 || !ch) throw new Error(`unsupported PNG (depth ${depth}, type ${type})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const lum = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const colour = ch >= 3 ? Math.max(px[o], px[o + 1], px[o + 2]) : px[o];
    const alpha = ch === 4 ? px[o + 3] : ch === 2 ? px[o + 1] : 255;
    lum[i] = Math.round((colour * alpha) / 255);
  }
  return { w, h, lum };
}

export const INK = 48; // brightness above which a pixel counts as lit

export interface RowInk {
  left: number;
  right: number;
  peak: number;
}

export function rowInk(img: Image, y0: number, y1: number): RowInk | null {
  let left = Infinity;
  let right = -1;
  let peak = 0;
  for (let y = y0; y < Math.min(y1, img.h); y++) {
    for (let x = 0; x < img.w; x++) {
      const v = img.lum[y * img.w + x];
      if (v > INK) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (v > peak) peak = v;
      }
    }
  }
  return right < 0 ? null : { left, right, peak };
}
