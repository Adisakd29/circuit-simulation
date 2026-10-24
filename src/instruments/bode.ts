import { cabs, cdiv, type AcResult, type Complex } from '../sim/ac';

/**
 * กราฟโบด: แปลงผล AC sweep เป็นขนาด (dB) และเฟส (องศา, ต่อเนื่อง) แล้ววัดค่าที่ใช้ในบทเรียน
 * อัตราขยาย H = V(CH2)/V(CH1) หรือ V(CH2)/EMF ของเครื่องกำเนิด (EMF = 1 V ในการวิเคราะห์)
 */

export interface BodeData {
  ok: boolean;
  error?: string;
  ref: 'ch1' | 'source';
  freqs: number[];
  /** dB (null = วัดไม่ได้ที่ความถี่นั้น) */
  mag: Array<number | null>;
  /** องศา คลี่ต่อเนื่อง (unwrapped) */
  phase: Array<number | null>;
  notes: string[];
}

export interface BodeMeasure {
  peakDb: number;
  peakF: number;
  /** ความถี่ที่ขนาดลดจากยอด 3 dB (ฝั่งต่ำ/สูง) — null ถ้าไม่ตกถึงในช่วงที่ sweep */
  fLow: number | null;
  fHigh: number | null;
}

export function toBode(r: AcResult, ref: 'ch1' | 'source'): BodeData {
  const base = { ref, freqs: r.freqs, mag: [] as Array<number | null>, phase: [] as Array<number | null>, notes: [...r.notes] };
  if (!r.ok) return { ...base, ok: false, error: r.error };
  const v2 = r.values.ch2 ?? [], v1 = r.values.ch1 ?? [];
  if (v2.every((v) => v === null)) return { ...base, ok: false, error: 'CH2 ไม่ได้ต่อกับวงจรเดียวกับเครื่องกำเนิดสัญญาณ (หรือ GND ของสโคปยังไม่ได้ต่อ)' };
  if (v2.every((v) => v === null || cabs(v) < 1e-12)) return { ...base, ok: false, error: 'CH2 ไม่มีสัญญาณ — ต่อ CH2 ที่จุดที่ต้องการวัด และ GND ของสโคปเข้ากับ COM ของเครื่องกำเนิด' };
  let useRef = ref;
  if (ref === 'ch1' && v1.some((v) => v === null || cabs(v) < 1e-12)) {
    useRef = 'source';
    base.notes.push('CH1 ไม่มีสัญญาณ — ใช้แรงดันของเครื่องกำเนิดสัญญาณ (ขณะไม่มีโหลด) เป็นอ้างอิงแทน');
  }
  let prev: number | null = null;
  for (let i = 0; i < r.freqs.length; i++) {
    const a = v2[i];
    const H: Complex | null = a === null ? null : useRef === 'ch1' ? (v1[i] ? cdiv(a, v1[i]!) : null) : a;
    if (!H || !(cabs(H) > 0)) { base.mag.push(H ? -400 : null); base.phase.push(null); continue; }
    base.mag.push(20 * Math.log10(cabs(H)));
    let ph = (Math.atan2(H.im, H.re) * 180) / Math.PI;
    if (prev !== null) { while (ph - prev > 180) ph -= 360; while (ph - prev < -180) ph += 360; }
    else if (ph > 179.999) ph -= 360; // เริ่มที่ −180° แทน +180° (วงจรกลับเฟส)
    base.phase.push(ph);
    prev = ph;
  }
  return { ...base, ref: useRef, ok: true };
}

/** ค่าที่ความถี่ f โดยประมาณเชิงเส้นในแกน log f */
export function bodeAt(d: BodeData, f: number): { mag: number | null; phase: number | null } {
  const F = d.freqs;
  if (!F.length || f < F[0] || f > F[F.length - 1]) return { mag: null, phase: null };
  let i = 1;
  while (i < F.length - 1 && F[i] < f) i++;
  const t = (Math.log10(f) - Math.log10(F[i - 1])) / (Math.log10(F[i]) - Math.log10(F[i - 1]));
  const lerp = (arr: Array<number | null>) => (arr[i - 1] === null || arr[i] === null ? null : arr[i - 1]! + t * (arr[i]! - arr[i - 1]!));
  return { mag: lerp(d.mag), phase: lerp(d.phase) };
}

/** ความถี่ที่ขนาด = level dB ระหว่างจุด i−1 กับ i (ประมาณเชิงเส้นใน log f) */
function crossAt(d: BodeData, i: number, level: number): number {
  const a = d.mag[i - 1]!, b = d.mag[i]!;
  const t = (level - a) / (b - a);
  return 10 ** (Math.log10(d.freqs[i - 1]) + t * (Math.log10(d.freqs[i]) - Math.log10(d.freqs[i - 1])));
}

export function measureBode(d: BodeData): BodeMeasure | null {
  if (!d.ok) return null;
  let k = -1;
  d.mag.forEach((m, i) => { if (m !== null && (k < 0 || m > d.mag[k]!)) k = i; });
  if (k < 0) return null;
  const peakDb = d.mag[k]!, level = peakDb - 3.0103;
  let fLow: number | null = null, fHigh: number | null = null;
  for (let i = k; i > 0; i--) { if (d.mag[i - 1] === null) break; if (d.mag[i - 1]! < level) { fLow = crossAt(d, i, level); break; } }
  for (let i = k + 1; i < d.freqs.length; i++) { if (d.mag[i] === null) break; if (d.mag[i]! < level) { fHigh = crossAt(d, i, level); break; } }
  return { peakDb, peakF: d.freqs[k], fLow, fHigh };
}

/** ความชันของขนาด (dB ต่อทศวรรษ) ระหว่าง fa กับ fb */
export function slopeDbPerDecade(d: BodeData, fa: number, fb: number): number | null {
  const a = bodeAt(d, fa).mag, b = bodeAt(d, fb).mag;
  if (a === null || b === null) return null;
  return (b - a) / (Math.log10(fb) - Math.log10(fa));
}

export function fmtHz(f: number): string {
  if (f >= 1e6) return `${+(f / 1e6).toPrecision(4)} MHz`;
  if (f >= 1e3) return `${+(f / 1e3).toPrecision(4)} kHz`;
  return `${+f.toPrecision(4)} Hz`;
}
