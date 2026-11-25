/**
 * แปลงรูปของผู้ใช้เป็นไฟล์ bg.bin สำหรับจอกลม: ตัดกลางเป็นสี่เหลี่ยมจัตุรัส ย่อเป็น 240 × 240
 * แล้วแปลงเป็น RGB565 (ไบต์สูงก่อน — ส่งเข้า GC9A01 ได้ตรง ๆ) พร้อมดิทเธอร์ Floyd–Steinberg ลดแถบสี
 */
export const BG_W = 240;

/** RGBA 240×240 → RGB565 ไบต์สูงก่อน */
export function rgbaTo565(rgba: Uint8ClampedArray | Uint8Array, w = BG_W, h = BG_W): Uint8Array {
  const out = new Uint8Array(w * h * 2);
  const err = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) err[i * 3 + c] = rgba[i * 4 + c];
  const levels = [31, 63, 31];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const q = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const v = Math.max(0, Math.min(255, err[i * 3 + c]));
        q[c] = Math.round((v / 255) * levels[c]);
        const e = v - (q[c] * 255) / levels[c];
        const add = (dx: number, dy: number, k: number) => {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < w && yy < h) err[(yy * w + xx) * 3 + c] += e * k;
        };
        add(1, 0, 7 / 16); add(-1, 1, 3 / 16); add(0, 1, 5 / 16); add(1, 1, 1 / 16);
      }
      const v = (q[0] << 11) | (q[1] << 5) | q[2];
      out[i * 2] = v >> 8; out[i * 2 + 1] = v & 0xff;
    }
  }
  return out;
}

/** RGB565 ไบต์สูงก่อน → RGBA (แสดงตัวอย่าง) */
export function rgb565ToRgba(b: Uint8Array, out = new Uint8ClampedArray((b.length / 2) * 4)): Uint8ClampedArray {
  for (let i = 0; i < b.length / 2; i++) {
    const v = (b[i * 2] << 8) | b[i * 2 + 1];
    const r = v >> 11, g = (v >> 5) & 63, bl = v & 31;
    out[i * 4] = (r << 3) | (r >> 2); out[i * 4 + 1] = (g << 2) | (g >> 4); out[i * 4 + 2] = (bl << 3) | (bl >> 2); out[i * 4 + 3] = 255;
  }
  return out;
}

export function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** ไฟล์รูป → bg.bin (base64) — ตัดกลางให้เป็นจัตุรัส */
export async function imageFileTo565(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = BG_W; c.height = BG_W;
  const ctx = c.getContext('2d')!;
  const s = Math.min(bmp.width, bmp.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, BG_W, BG_W);
  bmp.close?.();
  return bytesToB64(rgbaTo565(ctx.getImageData(0, 0, BG_W, BG_W).data));
}
