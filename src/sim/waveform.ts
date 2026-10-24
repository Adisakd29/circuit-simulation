/**
 * รูปคลื่นของเครื่องกำเนิดสัญญาณ (ทุกรูปเริ่มเฟสเดียวกันที่ t = 0)
 *  sine:     offset + A·sin(2πft)
 *  square:   offset + A  เมื่อ frac(ft) < 0.5,  offset − A  เมื่อ frac(ft) ≥ 0.5   (ขอบขึ้นที่ frac = 0)
 *  triangle: ขึ้นเชิงเส้นจาก offset ถึง offset + A ที่ frac 0.25, ลงถึง offset − A ที่ 0.75, กลับ offset ที่ 1
 *  dc:       offset
 * A = Vpp / 2 (แรงดันขณะไม่มีโหลด — ขั้วออกมีความต้านทานภายใน Rout)
 */

export type WaveShape = 'sine' | 'square' | 'triangle' | 'dc';

export interface WaveSpec {
  wave: WaveShape;
  freq: number;
  vpp: number;
  offset: number;
}

export function waveValue(w: WaveSpec, t: number): number {
  const A = w.vpp / 2;
  if (w.wave === 'dc' || !(w.freq > 0)) return w.offset;
  const ph = t * w.freq;
  const frac = ph - Math.floor(ph);
  switch (w.wave) {
    case 'sine': return w.offset + A * Math.sin(2 * Math.PI * ph);
    case 'square': return w.offset + (frac < 0.5 ? A : -A);
    case 'triangle':
      if (frac < 0.25) return w.offset + A * (frac / 0.25);
      if (frac < 0.75) return w.offset + A * (1 - (frac - 0.25) / 0.25);
      return w.offset - A + A * ((frac - 0.75) / 0.25);
  }
}

/** จุดหักของรูปคลื่น (ขอบสี่เหลี่ยม / ยอดสามเหลี่ยม) ถัดจากเวลา t — ก้าวเวลาต้องลงตรงจุดนี้พอดี */
export function nextBreakpoint(w: WaveSpec, t: number): number {
  if (!(w.freq > 0) || w.wave === 'sine' || w.wave === 'dc') return Infinity;
  const T = 1 / w.freq;
  const marks = w.wave === 'square' ? [0, 0.5] : [0.25, 0.75];
  const k = Math.floor(t / T);
  let best = Infinity;
  for (const kk of [k, k + 1]) for (const m of marks) {
    const tb = (kk + m) * T;
    if (tb > t + T * 1e-9 && tb < best) best = tb;
  }
  return best;
}

/** ก้าวเวลาสูงสุดเพื่อให้เห็นรูปคลื่นละเอียดพอ (64 จุดต่อคาบ) */
export function maxStepFor(w: WaveSpec): number {
  if (!(w.freq > 0) || w.wave === 'dc') return Infinity;
  return 1 / (w.freq * 64);
}
