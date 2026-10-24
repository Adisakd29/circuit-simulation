import type { GateOp, Netlist, NetlistElement } from './netlist';
import { waveValue } from './waveform';

/**
 * DC operating-point solver — Modified Nodal Analysis (รูปแบบ nodal ล้วน) + Newton–Raphson
 *
 * แบบจำลอง (เปิดเผยทั้งหมด):
 *  - ตัวต้านทาน / สวิตช์ปิด / แอมมิเตอร์:  i = v / R  (เชิงเส้น)
 *  - แหล่งจ่าย DC มีจำกัดกระแส: สองโหมด
 *      CV: แหล่งแรงดัน V ต่ออนุกรม Rint  (แทนด้วย Norton: G = 1/Rint, I = V/Rint)
 *      CC: แหล่งกระแส ±Ilim  (เข้าโหมดนี้เมื่อ |I| ใน CV > Ilim; กลับ CV เมื่อแรงดันขั้วเกิน V)
 *      หมายเหตุ: แบบจำลองยอมให้จำกัดกระแสทั้งสองทิศ (ไม่จำลองการที่แหล่งจ่ายจริงรับกระแสย้อนไม่ได้)
 *  - LED: ไดโอด Shockley  I = Is·(exp(Vd/(n·Vt)) − 1)  ต่ออนุกรม Rs
 *      ไม่จำลองการพังทลายย้อนกลับ (reverse breakdown) — แต่แจ้งเตือนเมื่อแรงดันย้อนเกินพิกัด
 *  - สาย jumper: ความต้านทาน 0 (รวมเป็นเน็ตเดียวกัน)
 *  - เครื่องกำเนิดสัญญาณ: แหล่งแรงดัน v(t) (ไซน์/สี่เหลี่ยม/สามเหลี่ยม/DC) ต่ออนุกรม Rout — ใช้ค่า ณ เวลา options.time
 *  - ตัวเก็บประจุ C / ตัวเหนี่ยวนำ L (+ DCR):
 *      ในการวิเคราะห์ DC: C = วงจรเปิด, L = ความต้านทาน DCR (อย่างน้อย 1 mΩ)
 *      ในการวิเคราะห์ตามเวลา: แทนด้วย companion model i = G·v + J ที่ transient.ts คำนวณให้ทุกก้าวเวลา
 *
 * จุดอ้างอิง (reference node):
 *  - solver แบ่งวงจรเป็น "ส่วนที่เชื่อมกันทางไฟฟ้า" (component) แล้วเลือกโหนดอ้างอิงภายในของแต่ละส่วนเอง
 *    (โหนดที่มีขาอุปกรณ์ต่อมากที่สุด เพื่อเสถียรภาพเชิงตัวเลข) — ไม่ผูกกับขั้วลบของแหล่งจ่าย และไม่บังคับให้ขั้วลบทุกแหล่งจ่ายเป็นกราวด์ร่วม
 *  - ค่าที่มีความหมายคือ "ผลต่างแรงดันระหว่างสองจุดในส่วนเดียวกัน" เท่านั้น
 *  - เน็ตที่ไม่มีอุปกรณ์ต่อเลย = floating (ไม่มีค่าแรงดัน)
 *  - เพิ่ม gmin = 1e-12 S จากทุกโหนดไปยังโหนดอ้างอิงของส่วนนั้นเพื่อเสถียรภาพเชิงตัวเลข
 *
 * เกณฑ์ลู่เข้า: |ΔV| < 1e-7 V + 1e-7·|V| และ KCL ทุกโหนด < 1e-12 A + 1e-7·(กระแสสูงสุดที่โหนด)
 */

export const GMIN = 1e-12;
const VT = 0.025852;
const MAX_NEWTON = 300;
const MAX_MODE_ITER = 24;
const VNTOL = 1e-7; // V
const RELTOL = 1e-7;
const ABSTOL = 1e-12; // A

export type SupplyMode = 'CV' | 'CC';

export interface ElementResult {
  id: string;
  /** กระแส (A) ทิศ: R a→b, LED A→K, แหล่งจ่าย ออกจากขั้ว + */
  current: number;
  /** แรงดันคร่อม (V): R Va−Vb, LED VA−VK, แหล่งจ่าย V+ − V− */
  voltage: number;
  power: number;
  mode?: SupplyMode;
  /** ค่าเพิ่มเติมของอุปกรณ์หลายขา (BJT: ib, vbe, region…; ออปแอมป์: vd, saturated…) */
  extra?: Record<string, number>;
}

export type SimErrorCode = 'singular' | 'convergence' | 'mode-oscillation' | 'numeric' | 'invalid';

export interface SimResult {
  ok: boolean;
  error?: { code: SimErrorCode; message: string; detail?: string };
  /** แรงดันของเน็ตเทียบกับโหนดอ้างอิงของส่วนของตน; null = floating */
  nodeVoltage: Array<number | null>;
  /** หมายเลขส่วน (component) ของแต่ละเน็ต; -1 = floating */
  component: number[];
  /** ส่วนที่มีแหล่งจ่ายทำงาน */
  energized: boolean[];
  elements: Record<string, ElementResult>;
  iterations: number;
  modeIterations: number;
  solveMs: number;
  /** เวกเตอร์คำตอบภายใน (ใช้ warm start ก้าวเวลาถัดไป) — ไม่ส่งออกนอก worker */
  x?: Float64Array;
  /** เวลาจำลอง (s) — มีเฉพาะการวิเคราะห์ตามเวลา */
  time?: number;
  /** สถานะที่มีความจำ ตาม id อุปกรณ์: รีเลย์ (true = ดึงแล้ว, COM ต่อ NO) และฟลิปฟล็อปของไอซี 555 (true = OUT HIGH) */
  relayStates?: Record<string, boolean>;
  /** ไอซี 555 เปลี่ยนสถานะในการคำนวณนี้: ขาเข้าคอมพาราเตอร์เลยจุดเปลี่ยนไปเท่าใด (สัดส่วนของ VCC) — ใช้ลดก้าวเวลาให้ลงใกล้จุดเปลี่ยน */
  eventOvershoot?: number;
  /** มอเตอร์ DC (จำลองตามเวลา): ความเร็วที่แกนมอเตอร์ (rad/s) และมุมสะสมที่แกนออก (rad) */
  motorSpeeds?: Record<string, number>;
  motorAngles?: Record<string, number>;
  /** HC-SR04: ECHO ตอนนี้สูงหรือไม่ ความกว้างพัลส์ล่าสุดที่ส่งครบ (s) และจำนวนครั้งที่วัด */
  sonars?: Record<string, { echo: number; width: number; count: number }>;
}

/* ------------------------------------------------------------------ */

function terminals(e: NetlistElement): number[] {
  if (e.type === 'R' || e.type === 'C' || e.type === 'L') return [e.a, e.b];
  if (e.type === 'LED' || e.type === 'D') return [e.a, e.k];
  if (e.type === 'BJT') return [e.c, e.b, e.e];
  if (e.type === 'MOS') return [e.d, e.g, e.s];
  if (e.type === 'OPAMP') return [e.inp, e.inn, e.out, e.vp, e.vn];
  return [e.p, e.n];
}

type MosEl = Extract<NetlistElement, { type: 'MOS' }>;
type DiodeEl = Extract<NetlistElement, { type: 'LED' | 'D' }>;
type BjtEl = Extract<NetlistElement, { type: 'BJT' }>;
type OpampEl = Extract<NetlistElement, { type: 'OPAMP' }>;
const isDiode = (e: NetlistElement): e is DiodeEl => e.type === 'LED' || e.type === 'D';

/** companion model ของ C/L ในหนึ่งก้าวเวลา: กระแส a→b = G·(Va − Vb) + J */
export interface Companion { G: number; J: number }

/** ความต้านทานของตัวเหนี่ยวนำในการวิเคราะห์ DC */
export const L_DC_MIN_R = 1e-3;

/**
 * แก้ระบบเชิงเส้น Ax = b
 * - ปรับสเกลแถว/คอลัมน์ด้วยรากของเส้นทแยง (symmetric Jacobi scaling) รองรับ conductance ที่ต่างกันมาก
 *   (เช่น ตัวเก็บประจุใหญ่ในก้าวเวลาสั้น 1e5 S คู่กับ gmin 1e-12 S)
 * - LU พร้อม partial pivoting แล้วปรับแก้คำตอบ (iterative refinement) 2 รอบ เพื่อให้ KCL ของแถวที่มีค่าเล็กยังแม่นยำ
 * - คืน null ถ้าเมทริกซ์ singular
 */
export function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v = Math.abs(A[i * n + i]); d[i] = v > 0 && isFinite(v) ? 1 / Math.sqrt(v) : 1; }
  const As = new Float64Array(n * n);
  const bs = new Float64Array(n);
  for (let r = 0; r < n; r++) { for (let c = 0; c < n; c++) As[r * n + c] = A[r * n + c] * d[r] * d[c]; bs[r] = b[r] * d[r]; }
  const lu = luFactor(As, n);
  if (!lu) return null;
  const y = luSolve(lu, bs, n);
  for (let pass = 0; pass < 2; pass++) {
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = bs[i];
      for (let c = 0; c < n; c++) acc -= As[i * n + c] * y[c];
      r[i] = acc;
    }
    const dy = luSolve(lu, r, n);
    for (let i = 0; i < n; i++) y[i] += dy[i];
  }
  for (let i = 0; i < n; i++) y[i] *= d[i];
  return y;
}

interface LU { m: Float64Array; perm: Int32Array }

function luFactor(A: Float64Array, n: number): LU | null {
  const m = Float64Array.from(A);
  const perm = new Int32Array(n).map((_, i) => i);
  let maxAbs = 0;
  for (let i = 0; i < n * n; i++) maxAbs = Math.max(maxAbs, Math.abs(m[i]));
  const eps = Math.max(maxAbs, 1e-300) * 1e-17;
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(m[col * n + col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(m[r * n + col]); if (v > best) { best = v; piv = r; } }
    if (best <= eps) return null;
    if (piv !== col) {
      for (let c = 0; c < n; c++) { const t = m[col * n + c]; m[col * n + c] = m[piv * n + c]; m[piv * n + c] = t; }
      const t = perm[col]; perm[col] = perm[piv]; perm[piv] = t;
    }
    const dg = m[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col] / dg;
      m[r * n + col] = f;
      if (f === 0) continue;
      for (let c = col + 1; c < n; c++) m[r * n + c] -= f * m[col * n + c];
    }
  }
  return { m, perm };
}

function luSolve({ m, perm }: LU, b: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[perm[i]];
    for (let c = 0; c < i; c++) s -= m[i * n + c] * y[c];
    y[i] = s;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let c = i + 1; c < n; c++) s -= m[i * n + c] * y[c];
    y[i] = s / m[i * n + i];
  }
  return y;
}

/** กระแสไดโอดและอนุพันธ์ พร้อมต่อเชิงเส้นเมื่อ exponent สูงมาก (กัน overflow) */
function diode(vd: number, Is: number, nVt: number): { i: number; g: number } {
  const x = vd / nVt;
  const XMAX = 80;
  if (x > XMAX) {
    const e = Math.exp(XMAX);
    return { i: Is * (e * (1 + x - XMAX) - 1), g: (Is * e) / nVt };
  }
  const e = Math.exp(x);
  return { i: Is * (e - 1), g: (Is * e) / nVt };
}

/** กระแสไดโอดรวมการพังทลายย้อนกลับ: −Ibv·exp(−(v+Bv)/Vt) (มีผลเมื่อ v เข้าใกล้ −Bv) */
function diodeBV(vd: number, Is: number, nVt: number, Bv: number | undefined, Ibv: number | undefined): { i: number; g: number } {
  const f = diode(vd, Is, nVt);
  if (!(Bv !== undefined && isFinite(Bv) && Ibv !== undefined && Ibv > 0)) return f;
  const x = -(vd + Bv) / VT;
  const XMAX = 80;
  let ib: number, gb: number;
  if (x > XMAX) { const e = Math.exp(XMAX); ib = Ibv * e * (1 + x - XMAX); gb = (Ibv * e) / VT; }
  else { const e = Math.exp(x); ib = Ibv * e; gb = (Ibv * e) / VT; }
  return { i: f.i - ib, g: f.g + gb };
}

/**
 * conductance สัญญาณเล็กของไดโอด/LED รอบจุดทำงาน (v = V_A − V_K, i = กระแส A→K)
 * แรงดันรอยต่อ vj = v − i·Rs → g_j = dI/dvj (+GMIN) → รวม Rs อนุกรม: 1/(Rs + 1/g_j)
 */
export function diodeSmallSignal(e: DiodeEl, v: number, i: number): number {
  const vj = v - i * e.Rs;
  const gj = diodeBV(vj, e.Is, e.n * VT, e.Bv, e.Ibv).g + GMIN;
  return e.Rs > 0 ? 1 / (e.Rs + 1 / gj) : gj;
}

/** exp แบบต่อเชิงเส้นเมื่อเกิน 80 (กัน overflow) คืนค่า e และอนุพันธ์ de/dx */
function expLim(x: number): { e: number; d: number } {
  if (x > 80) { const e = Math.exp(80); return { e: e * (1 + x - 80), d: e }; }
  const e = Math.exp(x);
  return { e, d: e };
}

/**
 * BJT (Ebers–Moll transport model) — คำนวณในทิศ NPN แล้วคูณ pol สำหรับ PNP
 * กระแสที่ "ไหลเข้าอุปกรณ์" ที่ขา C, B, E และเมทริกซ์อนุพันธ์เทียบแรงดันโหนด [C, B, E]
 */
export function evalBJT(e: BjtEl, Vc: number, Vb: number, Ve: number, vbeUse?: number, vbcUse?: number) {
  const vbe = vbeUse ?? e.pol * (Vb - Ve), vbc = vbcUse ?? e.pol * (Vb - Vc);
  const F = expLim(vbe / VT), Rr = expLim(vbc / VT);
  const gf = (e.Is * F.d) / VT, gr = (e.Is * Rr.d) / VT;
  const ict = e.Is * (F.e - Rr.e);
  const ibe = (e.Is / e.bf) * (F.e - 1) + GMIN * vbe;
  const ibc = (e.Is / e.br) * (Rr.e - 1) + GMIN * vbc;
  const Ic = ict - ibc, Ib = ibe + ibc, Ie = -(Ic + Ib);
  const dIc = [gf, -gr - gr / e.br - GMIN]; // [d/dvbe, d/dvbc]
  const dIb = [gf / e.bf + GMIN, gr / e.br + GMIN];
  const dIe = [-(dIc[0] + dIb[0]), -(dIc[1] + dIb[1])];
  const rows = [dIc, dIb, dIe];
  // dvbe/dV = pol·[0, 1, −1], dvbc/dV = pol·[−1, 1, 0]; กระแสจริง = pol·I → อนุพันธ์จริง = d/dvbe·[0,1,−1] + d/dvbc·[−1,1,0]
  const J = rows.map(([a, c]) => [-c, a + c, -a]);
  const I = [Ic, Ib, Ie].map((v) => e.pol * v);
  // ค่าคงที่ของการประมาณเชิงเส้นรอบจุด (vbe, vbc) ที่ใช้: I ≈ C + J·V
  const Cst = rows.map(([a, c], k) => e.pol * ([Ic, Ib, Ie][k] - a * vbe - c * vbc));
  return { I, J, C: Cst, vbe, vbc, Ic: I[0], Ib: I[1], Ie: I[2] };
}

/** ค่าคูณ Vt ของความชันย่านใต้ขีดเริ่ม (subthreshold) ≈ 1.5 → ~90 mV/decade */
const MOS_NS = 1.5;
/** ln(1 + e^x) แบบไม่ล้น */
const softplus = (x: number) => (x > 30 ? x : x < -30 ? Math.exp(x) : Math.log1p(Math.exp(x)));
const sigmoid = (x: number) => (x > 30 ? 1 : x < -30 ? Math.exp(x) : 1 / (1 + Math.exp(-x)));

/**
 * กระแสช่อง MOSFET ในทิศช่อง N (vds ≥ 0): ระดับ 1 (Shichman–Hodges) ที่ใช้ Vov แบบนุ่ม
 * veff = 2·ns·Vt·ln(1 + e^((vgs − Vth)/(2·ns·Vt)))  → เหนือขีดเริ่ม veff ≈ vgs − Vth, ใต้ขีดเริ่มกระแสลดแบบเอกซ์โพเนนเชียล (ไม่กระโดด ช่วย Newton)
 *   triode (vds < veff): id = KP·(veff·vds − vds²/2)·(1 + λ·vds)
 *   saturation:          id = KP/2·veff²·(1 + λ·vds)
 * คืน id และอนุพันธ์ gm = ∂id/∂vgs, gds = ∂id/∂vds
 */
export function mosChannel(vgs: number, vds: number, vth: number, kp: number, lambda: number) {
  const a = 2 * MOS_NS * VT;
  const veff = a * softplus((vgs - vth) / a);
  const s = sigmoid((vgs - vth) / a);
  const cl = 1 + lambda * vds;
  if (vds < veff) {
    const q = veff * vds - (vds * vds) / 2;
    return { id: kp * q * cl, gm: kp * vds * cl * s, gds: kp * ((veff - vds) * cl + lambda * q), veff, sat: false };
  }
  const q = (veff * veff) / 2;
  return { id: kp * q * cl, gm: kp * veff * s * cl, gds: kp * q * lambda, veff, sat: true };
}

/**
 * MOSFET (3 ขา D, G, S; ขา body ต่อ S ภายใน) — กระแสเข้าอุปกรณ์ที่ [D, G, S] เมทริกซ์อนุพันธ์ และค่าคงที่ของการประมาณเชิงเส้น
 * ถ้า vds (ทิศช่อง N) < 0 ขา D/S สลับบทบาท (อุปกรณ์สมมาตร) เกตไม่มีกระแส DC
 * vgsUse/vdsUse = ค่าที่ผ่านการจำกัดการเปลี่ยนแปลงต่อรอบ Newton แล้ว (ทิศช่อง N)
 */
export function evalMOS(e: MosEl, Vd: number, Vg: number, Vs: number, vgsUse?: number, vdsUse?: number) {
  const vgs = vgsUse ?? e.pol * (Vg - Vs), vds = vdsUse ?? e.pol * (Vd - Vs);
  let Id: number, Jd: number[], Cd: number, region: number, f: ReturnType<typeof mosChannel>;
  if (vds >= 0) {
    f = mosChannel(vgs, vds, e.vth, e.kp, e.lambda);
    Id = e.pol * f.id;
    Jd = [f.gds, f.gm, -(f.gm + f.gds)];
    Cd = e.pol * (f.id - f.gm * vgs - f.gds * vds);
    region = vgs < e.vth ? 0 : f.sat ? 2 : 1;
  } else {
    const u = vgs - vds, w = -vds; // เกตเทียบ "ขา D" ที่ทำหน้าที่เป็นซอร์ส
    f = mosChannel(u, w, e.vth, e.kp, e.lambda);
    Id = -e.pol * f.id;
    Jd = [f.gm + f.gds, -f.gm, -f.gds];
    Cd = -e.pol * (f.id - f.gm * u - f.gds * w);
    region = u < e.vth ? 0 : 3;
  }
  const J = [Jd, [0, 0, 0], Jd.map((v) => -v)];
  const C = [Cd, 0, -Cd];
  return { I: [Id, 0, -Id], J, C, Id, vgs, vds, region, veff: f.veff, gm: f.gm, gds: f.gds };
}

/**
 * ออปแอมป์เชิงพฤติกรรม — ลำดับขา [IN+, IN−, OUT, V+, V−]
 * vo = Vmid + H·tanh(A·(V+ − V−)/H),  Vmid = (V+ + V−)/2,  H = (V+ − V− − 2·headroom)/2
 *  → ช่วงกลางเป็นเชิงเส้นด้วยอัตราขยาย A และอิ่มตัวนุ่มที่ไฟเลี้ยง − headroom (อนุพันธ์ไม่เป็นศูนย์ทันที ช่วยให้ Newton ลู่เข้า)
 * iout = (vo − Vout)/Rout; กระแสขาออกมาจากขา V+ เมื่อจ่ายออก และไหลออกทางขา V− เมื่อรับเข้า
 * มีความต้านทานขาเข้า Rin และกระแสนิ่ง (V+ − V−)/Rq ไหลจาก V+ ไป V−
 */
/** สถานะภายในของออปแอมป์ในการจำลองตามเวลา: w = แรงดันขาออกก่อนตัดที่ไฟเลี้ยง (เทียบกลางไฟเลี้ยง) ณ ก้าวก่อน, h = ขนาดก้าว */
export interface OpampDyn { wn: number; h: number }

/**
 * แรงดันภายใน w (ก่อนตัดที่ไฟเลี้ยง) ณ สิ้นก้าว ตามขั้วเดียวของวงเปิดและ slew rate (Backward Euler):
 *   τ·dw/dt = A·Vd − w,  τ = A / (2π·GBW)  → w* = (wₙ + (h/τ)·A·Vd) / (1 + h/τ)
 *   slew: การเปลี่ยนของ w ต่อก้าวถูกจำกัดนุ่ม ๆ ด้วย S·tanh((w* − wₙ)/S), S = SR·h / sech²(wₙ/H)
 *   (หารด้วย sech² เพื่อให้ขีดจำกัดเป็นอัตราการเปลี่ยนของ "ขาออกจริง" — ตอนอิ่มตัว w ถอยกลับได้เร็ว ไม่ค้าง)
 * ไม่มี dyn (DC) → w = A·Vd
 */
export function opampW(e: OpampEl, vd: number, H: number, dyn?: OpampDyn): { w: number; dw: number; slewing: boolean } {
  if (!dyn || !(e.gbw > 0)) return { w: e.A * vd, dw: e.A, slewing: false };
  const tau = e.A / (2 * Math.PI * e.gbw);
  const k = dyn.h / tau;
  const a = (e.A * k) / (1 + k), c = dyn.wn / (1 + k);
  const ws = a * vd + c;
  if (!(e.sr > 0)) return { w: ws, dw: a, slewing: false };
  const tn = Math.tanh(dyn.wn / Math.max(H, 1e-3));
  const S = (e.sr * dyn.h) / Math.max(1 - tn * tn, 1e-3);
  const r = (ws - dyn.wn) / S;
  const t = Math.tanh(r);
  return { w: dyn.wn + S * t, dw: a * (1 - t * t), slewing: Math.abs(r) > 0.5 };
}

export function evalOpamp(e: OpampEl, Vin: number[], dyn?: OpampDyn) {
  const [vpI, vnI, vOut, vcc, vee] = Vin;
  const vd = vpI - vnI;
  const mid = (vcc + vee) / 2;
  const H = (vcc - vee - 2 * e.headroom) / 2;
  let vo: number, dvd: number, dcc: number, dee: number, saturated: boolean;
  let wState = 0, slewing = false;
  if (H <= 1e-3) {
    vo = mid; dvd = 0; dcc = 0.5; dee = 0.5; saturated = true; // ไฟเลี้ยงไม่พอ
  } else {
    const ww = opampW(e, vd, H, dyn);
    slewing = ww.slewing;
    // เก็บสถานะไม่เกิน ±3H (anti-windup: ขาออกอิ่มตัวแล้ว w ไม่วิ่งต่อไปถึง A·Vd)
    wState = Math.max(-3 * H, Math.min(3 * H, ww.w));
    const u = ww.w / H;
    const th = Math.tanh(u), sech2 = 1 - th * th;
    vo = mid + H * th;
    dvd = ww.dw * sech2;
    dcc = 0.5 + 0.5 * th - 0.5 * u * sech2;
    dee = 0.5 - 0.5 * th + 0.5 * u * sech2;
    saturated = Math.abs(th) > 0.97;
  }
  const iout = (vo - vOut) / e.Rout;
  // อนุพันธ์ของ iout เทียบ [IN+, IN−, OUT, V+, V−]
  const g = 1 / e.Rout;
  const di = [dvd * g, -dvd * g, -g, dcc * g, dee * g];
  const sourcing = iout >= 0;
  // กระแสเข้าอุปกรณ์: OUT = −iout, V+ = iout (จ่ายออก) หรือ V− = iout (รับเข้า)
  const I = [0, 0, -iout, sourcing ? iout : 0, sourcing ? 0 : iout];
  const J = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    di.map((d) => -d),
    sourcing ? di.slice() : [0, 0, 0, 0, 0],
    sourcing ? [0, 0, 0, 0, 0] : di.slice(),
  ];
  // ความต้านทานขาเข้า (IN+ ↔ IN−) และกระแสนิ่งของวงจรภายใน (V+ ↔ V−)
  const gin = 1 / e.Rin, gq = 1 / e.Rq;
  const iin = vd * gin, iq = (vcc - vee) * gq;
  I[0] += iin; I[1] -= iin; I[3] += iq; I[4] -= iq;
  J[0][0] += gin; J[0][1] -= gin; J[1][0] -= gin; J[1][1] += gin;
  J[3][3] += gq; J[3][4] -= gq; J[4][3] -= gq; J[4][4] += gq;
  const C = I.map((ik, k) => ik - J[k].reduce((acc, jj, j) => acc + jj * Vin[j], 0));
  return { I, J, C, iout, vd, vo, saturated, iq, iin, wState, slewing };
}

/** จำกัดการเปลี่ยนแรงดันรอยต่อต่อรอบ (แบบ SPICE pnjlim) */
function pnjlim(vnew: number, vold: number, nVt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nVt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nVt;
      return arg > 0 ? vold + nVt * Math.log(arg) : vcrit;
    }
    return nVt * Math.log(vnew / nVt);
  }
  return vnew;
}

/* ------------------------------------------------------------------ */

interface Layout {
  /** index ตัวแปรของแต่ละเน็ต (-1 = โหนดอ้างอิงหรือ floating) */
  varOf: Int32Array;
  /** โหนดภายใน LED (ระหว่าง Rs กับรอยต่อ) */
  ledInternal: Map<string, number>;
  size: number;
}

function analyzeComponents(nl: Netlist, capConducts: boolean) {
  const parent = new Int32Array(nl.nodeCount).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const used = new Uint8Array(nl.nodeCount);
  for (const e of nl.elements) {
    const t = terminals(e);
    for (const v of t) used[v] = 1;
    if (e.type === 'C' && !capConducts) continue; // DC: ตัวเก็บประจุไม่เชื่อมสองฝั่ง
    for (let k = 1; k < t.length; k++) {
      const ra = find(t[0]), rb = find(t[k]);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  // ระดับ (degree) ของโหนด = จำนวนขาอุปกรณ์ที่ต่อ — ใช้เลือกโหนดอ้างอิงที่ "แข็งแรง" ทางตัวเลข
  const degree = new Int32Array(nl.nodeCount);
  for (const e of nl.elements) for (const v of terminals(e)) degree[v]++;
  const component = new Array<number>(nl.nodeCount).fill(-1);
  const compOfRoot = new Map<number, number>();
  const refNode: number[] = [];
  for (let i = 0; i < nl.nodeCount; i++) {
    if (!used[i]) continue;
    const r = find(i);
    let c = compOfRoot.get(r);
    if (c === undefined) { c = refNode.length; compOfRoot.set(r, c); refNode.push(i); }
    component[i] = c;
    if (degree[i] > degree[refNode[c]]) refNode[c] = i;
  }
  const energized = new Array<boolean>(refNode.length).fill(false);
  for (const e of nl.elements) {
    if (e.type === 'SUPPLY' && e.V !== 0 && e.p !== e.n) energized[component[e.p]] = true;
    if (e.type === 'FGEN' && (e.vpp !== 0 || e.offset !== 0) && e.p !== e.n) energized[component[e.p]] = true;
  }
  return { component, refNode, energized };
}

function makeLayout(nl: Netlist, component: number[], refNode: number[]): Layout {
  const varOf = new Int32Array(nl.nodeCount).fill(-1);
  let size = 0;
  for (let i = 0; i < nl.nodeCount; i++) if (component[i] >= 0 && refNode[component[i]] !== i) varOf[i] = size++;
  const ledInternal = new Map<string, number>();
  for (const e of nl.elements) if (isDiode(e) && e.Rs > 0) ledInternal.set(e.id, size++);
  return { varOf, ledInternal, size };
}

export function validateNetlist(nl: Netlist): string | null {
  for (const e of nl.elements) {
    for (const t of terminals(e)) if (!(t >= 0 && t < nl.nodeCount)) return `${e.id}: หมายเลขโหนดไม่ถูกต้อง`;
    if (e.type === 'R' && !(e.R > 0 && isFinite(e.R))) return `${e.id}: ความต้านทานต้องมากกว่า 0`;
    if (e.type === 'SUPPLY' && (!(e.Rint > 0) || !(e.Ilim > 0) || !isFinite(e.V))) return `${e.id}: พารามิเตอร์แหล่งจ่ายไม่ถูกต้อง`;
    if (isDiode(e) && (!(e.Is > 0) || !(e.n > 0) || !(e.Rs >= 0))) return `${e.id}: พารามิเตอร์ไดโอดไม่ถูกต้อง`;
    if (e.type === 'BJT' && (!(e.Is > 0) || !(e.bf > 0) || !(e.br > 0))) return `${e.id}: พารามิเตอร์ทรานซิสเตอร์ไม่ถูกต้อง`;
    if (e.type === 'MOS' && (!isFinite(e.vth) || !(e.kp > 0) || !(e.lambda >= 0))) return `${e.id}: พารามิเตอร์ MOSFET ไม่ถูกต้อง`;
    if (e.type === 'OPAMP' && (!(e.A > 0) || !(e.Rout > 0) || !(e.headroom >= 0) || !(e.Rin > 0) || !(e.Rq > 0))) return `${e.id}: พารามิเตอร์ออปแอมป์ไม่ถูกต้อง`;
    if (e.type === 'C' && !(e.C > 0 && isFinite(e.C))) return `${e.id}: ความจุต้องมากกว่า 0`;
    if (e.type === 'FGEN' && (!(e.Rout > 0) || !isFinite(e.vpp) || !isFinite(e.offset) || !(e.freq >= 0))) return `${e.id}: พารามิเตอร์เครื่องกำเนิดสัญญาณไม่ถูกต้อง`;
    if (e.type === 'L' && (!(e.L > 0 && isFinite(e.L)) || !(e.R >= 0))) return `${e.id}: พารามิเตอร์ตัวเหนี่ยวนำไม่ถูกต้อง`;
  }
  return null;
}

export interface SolveOptions { initial?: Float64Array; companions?: Map<string, Companion>; time?: number; trace?: (msg: string) => void; opampGain?: number; /** สถานะออปแอมป์ (จำลองตามเวลา) ตาม id */ opampDyn?: Map<string, OpampDyn>; /** สถานะรีเลย์ก่อนหน้า (hysteresis) */ relayStates?: Record<string, boolean> }

/**
 * แก้วงจร — ถ้ามีออปแอมป์และ Newton ไม่ลู่เข้า จะใช้ gain continuation:
 * แก้ซ้ำโดยเพิ่มอัตราขยายวงเปิดทีละ 10 เท่า (10, 100, …, A) ใช้คำตอบก่อนหน้าเป็นจุดเริ่ม
 * เพราะอัตราขยายสูงมากทำให้ย่านอิ่มตัวมีอนุพันธ์เกือบศูนย์ Newton จึงอาจกระโดดข้ามไปมาระหว่างไฟเลี้ยง
 */
/**
 * รีเลย์: หน้าสัมผัสขึ้นกับกระแสขดลวดซึ่งขึ้นกับคำตอบ — แก้ซ้ำแบบจุดตรึง (fixed point)
 *  เริ่มจากสถานะก่อนหน้า (หรือ "ปล่อย") → แก้วงจรโดยใส่หน้าสัมผัส COM–NO หรือ COM–NC เป็นตัวต้านทาน
 *  → ดึงเมื่อ |V ขดลวด| ≥ แรงดันดึง, ปล่อยเมื่อ ≤ แรงดันปล่อย, ระหว่างนั้นคงสถานะเดิม (hysteresis)
 *  ถ้าสลับไปมาไม่หยุด (เช่น หน้าสัมผัสตัดไฟขดลวดตัวเอง) แจ้งเป็นข้อผิดพลาดที่อธิบายได้
 */
export function solveDC(nl: Netlist, options: SolveOptions = {}): SimResult {
  const relays = nl.relays ?? [], timers = nl.timers ?? [], gates = nl.gates ?? [], counters = nl.counters ?? [], drivers = nl.drivers ?? [], shifts = nl.shiftregs ?? [];
  const fuses = nl.elements.filter((e): e is Extract<NetlistElement, { type: 'R' }> => e.type === 'R' && !!e.fuse);
  const scrs = nl.scrs ?? [], comps = nl.comps ?? [];
  if (!relays.length && !timers.length && !gates.length && !counters.length && !drivers.length && !shifts.length && !fuses.length && !scrs.length && !comps.length) return solveDCInner(nl, options);
  const st: Record<string, boolean> = {};
  for (const c of scrs) st[c.id] = options.relayStates?.[c.id] ?? false;
  // ฟิวส์ในมิเตอร์: ขาดแล้วค้าง (ต้องเริ่มจำลองใหม่ = ใส่ฟิวส์ใหม่)
  for (const f of fuses) st[`${f.id}#blown`] = !!options.relayStates?.[`${f.id}#blown`];
  const blownNl = (): Netlist => (fuses.some((f) => st[`${f.id}#blown`]) ? { ...nl, elements: nl.elements.map((e) => (e.type === 'R' && e.fuse && st[`${e.id}#blown`] ? { ...e, R: 1e12 } : e)) } : nl);
  for (const r of relays) st[r.id] = options.relayStates?.[r.id] ?? false;
  for (const t of timers) st[t.id] = options.relayStates?.[t.id] ?? false;
  for (const g of gates) st[g.id] = options.relayStates?.[g.id] ?? false;
  for (const c of comps) st[c.id] = options.relayStates?.[c.id] ?? false;
  // ไอซีนับ: one-hot q0..q9 (ไม่มีสถานะเดิม = เริ่มที่ 0) + ระดับ CLK/INH ที่เห็นครั้งก่อน (หาขอบ)
  for (const c of counters) {
    const has = Array.from({ length: 10 }, (_, k) => !!options.relayStates?.[`${c.id}#q${k}`]);
    const n0 = has.indexOf(true);
    for (let k = 0; k < 10; k++) st[`${c.id}#q${k}`] = k === (n0 < 0 ? 0 : n0);
    st[`${c.id}#clk`] = options.relayStates?.[`${c.id}#clk`] ?? false;
    st[`${c.id}#inh`] = options.relayStates?.[`${c.id}#inh`] ?? false;
  }
  // ยังไม่เคยเห็นระดับ CLK/INH (เพิ่งจ่ายไฟ/เริ่มจำลอง): ครั้งแรกจำระดับไว้เฉย ๆ ไม่นับ (CLK ที่สูงอยู่แล้วไม่ใช่ขอบขาขึ้น)
  const fresh = new Set(counters.filter((c) => options.relayStates?.[`${c.id}#clk`] === undefined).map((c) => c.id));
  // 74HC595: รีจิสเตอร์เลื่อน #s0..7, รีจิสเตอร์พัก (ขาออก) #o0..7, ระดับ SRCLK/RCLK ครั้งก่อน (หาขอบ), OE ครั้งก่อน
  // ไม่มีสถานะเดิม (เพิ่งจ่ายไฟ) = ทุกบิต 0 และจำระดับนาฬิกาไว้ก่อน ไม่นับเป็นขอบ
  for (const s of shifts) {
    for (let k = 0; k < 8; k++) { st[`${s.id}#s${k}`] = !!options.relayStates?.[`${s.id}#s${k}`]; st[`${s.id}#o${k}`] = !!options.relayStates?.[`${s.id}#o${k}`]; }
    st[`${s.id}#sck`] = options.relayStates?.[`${s.id}#sck`] ?? false;
    st[`${s.id}#rck`] = options.relayStates?.[`${s.id}#rck`] ?? false;
    st[`${s.id}#oe`] = options.relayStates?.[`${s.id}#oe`] ?? false;
  }
  const freshSr = new Set(shifts.filter((s) => options.relayStates?.[`${s.id}#sck`] === undefined).map((s) => s.id));
  let shiftMoves = 0;
  for (const d of drivers) { st[`${d.id}#e`] = options.relayStates?.[`${d.id}#e`] ?? false; st[`${d.id}#h`] = options.relayStates?.[`${d.id}#h`] ?? false; }
  const countOf = (id: string) => { for (let k = 0; k < 10; k++) if (st[`${id}#q${k}`]) return k; return 0; };
  const ids = [...relays.map((r) => r.id), ...timers.map((t) => t.id), ...gates.map((g) => g.id), ...counters.flatMap((c) => Array.from({ length: 10 }, (_, k) => `${c.id}#q${k}`)), ...drivers.flatMap((d) => [`${d.id}#e`, `${d.id}#h`]), ...shifts.flatMap((s) => [...Array.from({ length: 8 }, (_, k) => `${s.id}#s${k}`), ...Array.from({ length: 8 }, (_, k) => `${s.id}#o${k}`), `${s.id}#oe`]), ...fuses.map((f) => `${f.id}#blown`), ...scrs.map((c) => c.id), ...comps.map((c) => c.id)];
  let compMoves = 0;
  let counterMoves = 0;
  let seen = new Set<string>();
  let last: SimResult | null = null;
  let overshoot = 0;
  let timerFlap = false, gateFlap = false;
  /** เกตเปลี่ยนพร้อมกันหลายตัวแล้ววนซ้ำ (เช่น SR latch ที่ S, R เปลี่ยนพร้อมกัน) → เปลี่ยนทีละตัว (เหมือนของจริงที่หน่วงเวลาไม่เท่ากัน) */
  let oneAtATime = false;
  for (let k = 0; k < 80; k++) {
    const key = ids.map((id) => (st[id] ? 1 : 0)).join('');
    if (seen.has(key)) {
      if (gates.length && !oneAtATime) { oneAtATime = true; seen = new Set([key]); }
      else break;
    } else seen.add(key);
    const extra: NetlistElement[] = relays.map((r) => ({ type: 'R', id: `${r.id}#${st[r.id] ? 'no' : 'nc'}`, role: 'contact', a: r.com, b: st[r.id] ? r.no : r.nc, R: r.Rc }));
    for (const t of timers) {
      if (st[t.id]) extra.push({ type: 'R', id: `${t.id}#oh`, role: 'module', a: t.hi, b: t.out, R: 0.01 });
      else extra.push({ type: 'R', id: `${t.id}#ol`, role: 'module', a: t.out, b: t.gnd, R: t.Rl }, { type: 'R', id: `${t.id}#dis`, role: 'module', a: t.dis, b: t.gnd, R: t.Rd });
    }
    // คอมพาราเตอร์: นำ = ขาออกต่อลง GND ผ่าน Ron · ไม่นำ = ลอย (open collector)
    for (const c of comps) if (st[c.id]) extra.push({ type: 'R', id: `${c.id}#on`, role: 'module', a: c.out, b: c.gnd, R: c.Ron });
    for (const g of gates) extra.push(st[g.id] ? { type: 'R', id: `${g.id}#h`, role: 'module', a: g.vcc, b: g.out, R: g.Ron } : { type: 'R', id: `${g.id}#l`, role: 'module', a: g.out, b: g.gnd, R: g.Ron });
    // L293D: ขาออกสูง = ทรานซิสเตอร์ดาร์ลิงตันจาก VCC2 (ตก ≈ 1.1 V ที่ 10 mA, 1.4 V ที่ 0.6 A), ต่ำ = ลง GND (≈ 0.8–1.2 V)
    // แบบจำลองเป็นไดโอดที่ fit กับ VOH/VOL ของดาต้าชีต · เปิดใช้งานกินกระแสเพิ่ม (ICC1 ขาออกต่ำ / ICC2 ขาออกสูง)
    for (const d of drivers) {
      if (!st[`${d.id}#e`]) continue;
      if (st[`${d.id}#h`]) extra.push({ type: 'D', id: `${d.id}#h`, a: d.vcc2, k: d.y, Is: 3.06e-9, n: 2.835, Rs: 0, Bv: 100, Ibv: 1e-6 },
        { type: 'MOS', id: `${d.id}#ih`, d: d.vcc2, g: d.gnd, s: d.gnd, pol: 1, vth: -1, kp: 2 * 0.003, lambda: 0.001 });
      else extra.push({ type: 'D', id: `${d.id}#l`, a: d.y, k: d.gnd, Is: 2.8e-6, n: 3.78, Rs: 0, Bv: 100, Ibv: 1e-6 },
        { type: 'MOS', id: `${d.id}#il`, d: d.vcc1, g: d.gnd, s: d.gnd, pol: 1, vth: -1, kp: 2 * 0.00675, lambda: 0.001 });
    }
    // ขาออก CD4017: สูง = MOSFET ช่อง P จาก VDD (เกตที่ VSS), ต่ำ = ช่อง N ลง VSS (เกตที่ VDD) — กระแสอิ่มตัวตามไฟเลี้ยงเหมือนของจริง
    for (const c of counters) {
      const n = countOf(c.id);
      const outs: Array<[number, boolean, string]> = c.q.map((node, k) => [node, k === n, `q${k}`]);
      outs.push([c.co, n <= 4, 'co']);
      for (const [node, hi, nm] of outs) extra.push(hi
        ? { type: 'MOS', id: `${c.id}#${nm}h`, d: node, g: c.vss, s: c.vdd, pol: -1, vth: c.vth, kp: c.kp, lambda: c.lambda }
        : { type: 'MOS', id: `${c.id}#${nm}l`, d: node, g: c.vdd, s: c.vss, pol: 1, vth: c.vth, kp: c.kp, lambda: c.lambda });
    }
    // ขาออก 74HC595: CMOS push-pull (MOSFET P จาก VCC / N ลง GND) · OE สูง = QA–QH ลอย (QH′ ไม่ขึ้นกับ OE)
    for (const s of shifts) {
      const outs: Array<[number, boolean, string]> = st[`${s.id}#oe`] ? [] : s.q.map((node, k) => [node, st[`${s.id}#o${k}`], `q${k}`]);
      outs.push([s.qh2, st[`${s.id}#s7`], 'qh2']);
      for (const [node, hi, nm] of outs) extra.push(hi
        ? { type: 'MOS', id: `${s.id}#${nm}h`, d: node, g: s.gnd, s: s.vcc, pol: -1, vth: s.vth, kp: s.kp, lambda: s.lambda }
        : { type: 'MOS', id: `${s.id}#${nm}l`, d: node, g: s.vcc, s: s.gnd, pol: 1, vth: s.vth, kp: s.kp, lambda: s.lambda });
    }
    // SCR: ติด = ไดโอด A→K (แรงดันตก ≈ 0.9 V ที่ 10 mA), ดับ = รั่ว 1 GΩ
    for (const c of scrs) extra.push(st[c.id]
      ? { type: 'D', id: `${c.id}#ak`, a: c.a, k: c.k, ...c.on, Bv: 1e4, Ibv: 1e-9 }
      : { type: 'R', id: `${c.id}#off`, role: 'module', a: c.a, b: c.k, R: 1e9 });
    const base = blownNl();
    const res = solveDCInner({ ...base, elements: [...base.elements, ...extra] }, options);
    if (!res.ok) return res;
    last = { ...res, relayStates: { ...st } };
    let changed = false;
    // SCR (ตามดาต้าชีต): ติดเมื่อกระแสเกต ≥ IGT ขณะ A บวกกว่า K (หรือ VAK เกิน VDRM = breakover) · ติดแล้วค้างจนกระแสแอโนด < IH โดยไม่มีกระแสเกต
    for (const c of scrs) {
      const ig = res.elements[`${c.id}#gk`]?.current ?? 0;
      const vak = (res.nodeVoltage[c.a] ?? 0) - (res.nodeVoltage[c.k] ?? 0);
      const ia = st[c.id] ? res.elements[`${c.id}#ak`]?.current ?? 0 : 0;
      const next = st[c.id] ? !(ia < c.ih && ig < c.igt) : (ig >= c.igt && vak > 0.5) || vak > c.vdrm;
      if (next !== st[c.id]) { st[c.id] = next; changed = true; }
    }
    for (const r of relays) {
      const vc = Math.abs(res.elements[r.coilId]?.voltage ?? 0);
      const next = st[r.id] ? vc > r.vDrop : vc >= r.vPick;
      if (next !== st[r.id]) { st[r.id] = next; changed = true; }
    }
    for (const t of timers) {
      // ตารางการทำงาน (TI SLFS022): RESET < 0.7 V → LOW; TRIG < ⅓ (โหนดล่างของวงแบ่ง) → HIGH (มีผลก่อน THR);
      // THR > แรงดัน CTRL (⅔) → LOW; นอกนั้นคงสถานะเดิม · ไฟเลี้ยงต่ำกว่า 3 V วงจรภายในไม่ทำงาน → LOW
      const v = (n: number) => res.nodeVoltage[n] ?? 0;
      const g = v(t.gnd), vs = v(t.vcc) - g;
      let next = st[t.id], over = 0;
      if (vs < 3 || v(t.rst) - g < 0.7) next = false;
      else if (v(t.trig) < v(t.lo)) { next = true; over = (v(t.lo) - v(t.trig)) / vs; }
      else if (v(t.thr) > v(t.ctl)) { next = false; over = (v(t.thr) - v(t.ctl)) / vs; }
      if (next !== st[t.id]) {
        if (k === 0) overshoot = Math.max(overshoot, over);
        else timerFlap = true;
        st[t.id] = next; changed = true;
      }
    }
    // LM393: IN− > IN+ → ขาออกนำ · ไม่มี hysteresis ในตัว (ใส่ด้วยตัวต้านทานป้อนกลับบวกภายนอกได้) · ไฟเลี้ยงต่ำกว่า VCC ต่ำสุด → ไม่นำ
    for (const c of comps) {
      const v = (n: number) => res.nodeVoltage[n] ?? 0;
      const vs = v(c.vcc) - v(c.gnd);
      const next = vs >= c.vMin && v(c.inn) > v(c.inp);
      if (next !== st[c.id]) {
        if (k === 0) overshoot = Math.max(overshoot, Math.abs(v(c.inn) - v(c.inp)) / Math.max(1, vs));
        st[c.id] = next; changed = true; compMoves++;
      }
    }
    // เกต CMOS: ขาเข้า > VCC/2 = 1 · ไฟเลี้ยงต่ำกว่า 1 V วงจรไม่ทำงาน (ขาออก LOW)
    const flips: Array<{ id: string; next: boolean; over: number }> = [];
    for (const g of gates) {
      const v = (n: number) => res.nodeVoltage[n] ?? 0;
      const gnd = v(g.gnd), vs = v(g.vcc) - gnd;
      const ins = g.inputs.map((n) => v(n) - gnd);
      const bits = ins.map((x) => x > vs / 2);
      const next = vs < 1 ? false : gateFn(g.op, bits[0], bits[1] ?? false);
      if (next !== st[g.id]) flips.push({ id: g.id, next, over: vs > 0 ? Math.min(...ins.map((x) => Math.abs(x - vs / 2))) / vs : 0 });
    }
    for (const f of oneAtATime ? flips.slice(0, 1) : flips) {
      if (k === 0) overshoot = Math.max(overshoot, f.over);
      else if (oneAtATime) gateFlap = true;
      st[f.id] = f.next; changed = true;
    }
    // L293D (ตารางความจริง): EN สูงและ VCC1 ≥ 4 V → Y = A, EN ต่ำ → Y ลอย · ขาเข้าระดับ TTL (VIH 2.3 V, VIL 1.5 V) ตัดที่ 1.9 V
    for (const d of drivers) {
      const v = (node: number) => res.nodeVoltage[node] ?? 0;
      const g = v(d.gnd);
      const en = v(d.vcc1) - g >= 4 && v(d.en) - g > 1.9, hi = v(d.a) - g > 1.9;
      if (en !== st[`${d.id}#e`] || (en && hi !== st[`${d.id}#h`])) {
        if (k === 0) overshoot = Math.max(overshoot, Math.min(Math.abs(v(d.en) - g - 1.9), Math.abs(v(d.a) - g - 1.9)) / Math.max(1, v(d.vcc1) - g));
        st[`${d.id}#e`] = en; if (en) st[`${d.id}#h`] = hi;
        changed = true;
      }
    }
    // CD4017B (ตารางการทำงานในดาต้าชีต): RESET สูง → Q0; นับเมื่อ CLK ขอบขึ้นขณะ INH ต่ำ หรือ INH ขอบลงขณะ CLK สูง
    // ขา CLK เป็นชมิตต์ทริกเกอร์: ขึ้นเมื่อ > 0.6 VDD ลงเมื่อ < 0.4 VDD · ไฟเลี้ยงต่ำกว่า 2 V วงจรภายในไม่ทำงาน (คงสถานะ)
    for (const c of counters) {
      const v = (node: number) => res.nodeVoltage[node] ?? 0;
      const vss = v(c.vss), vs = v(c.vdd) - vss;
      if (vs < 2) { fresh.delete(c.id); continue; }
      const ck = v(c.clk) - vss;
      const clkWas = st[`${c.id}#clk`], inhWas = st[`${c.id}#inh`];
      const clkHi = clkWas ? ck > 0.4 * vs : ck > 0.6 * vs;
      const inhHi = v(c.inh) - vss > vs / 2, rstHi = v(c.rst) - vss > vs / 2;
      const n = countOf(c.id);
      let next = n;
      if (fresh.has(c.id)) fresh.delete(c.id);
      else if (rstHi) next = 0;
      else if ((!clkWas && clkHi && !inhHi) || (clkHi && inhWas && !inhHi)) {
        next = (n + 1) % 10;
        if (k === 0 && !clkWas && clkHi) overshoot = Math.max(overshoot, (ck - 0.6 * vs) / vs);
      }
      st[`${c.id}#clk`] = clkHi; st[`${c.id}#inh`] = inhHi;
      if (next !== n) {
        for (let q = 0; q < 10; q++) st[`${c.id}#q${q}`] = q === next;
        changed = true; counterMoves++;
      }
    }
    // 74HC595 (ตารางการทำงาน SCLS041): SRCLK ขอบขึ้น → เลื่อน QA←SER, QB←QA … ; SRCLR ต่ำ → ล้างรีจิสเตอร์เลื่อน;
    // RCLK ขอบขึ้น → โอนรีจิสเตอร์เลื่อนไปรีจิสเตอร์พัก (ถ้า SRCLK กับ RCLK ขึ้นพร้อมกัน รีจิสเตอร์พักได้ค่าก่อนเลื่อน — ช้ากว่าหนึ่งจังหวะ)
    // ขาเข้า CMOS ตัดที่ VCC/2 มี hysteresis เล็กน้อย · ไฟเลี้ยงต่ำกว่า 1.5 V วงจรไม่ทำงาน (คงสถานะ)
    for (const s of shifts) {
      const v = (node: number) => res.nodeVoltage[node] ?? 0;
      const g = v(s.gnd), vs = v(s.vcc) - g;
      if (vs < 1.5) { freshSr.delete(s.id); continue; }
      const lvl = (node: number, was: boolean) => (was ? v(node) - g > 0.45 * vs : v(node) - g > 0.55 * vs);
      const sckWas = st[`${s.id}#sck`], rckWas = st[`${s.id}#rck`];
      const sck = lvl(s.sck, sckWas), rck = lvl(s.rck, rckWas);
      const oe = v(s.oe) - g > vs / 2, clr = v(s.clr) - g < vs / 2;
      const old = Array.from({ length: 8 }, (_, b) => st[`${s.id}#s${b}`]);
      let sh = old.slice(), out = Array.from({ length: 8 }, (_, b) => st[`${s.id}#o${b}`]);
      if (freshSr.has(s.id)) freshSr.delete(s.id);
      else {
        if (!rckWas && rck) out = old.slice();
        if (clr) sh = sh.map(() => false);
        else if (!sckWas && sck) {
          sh = [v(s.ser) - g > vs / 2, ...old.slice(0, 7)];
          if (k === 0) overshoot = Math.max(overshoot, (v(s.sck) - g - 0.55 * vs) / vs);
        }
      }
      st[`${s.id}#sck`] = sck; st[`${s.id}#rck`] = rck;
      let mv = false;
      for (let b = 0; b < 8; b++) {
        if (sh[b] !== st[`${s.id}#s${b}`]) { st[`${s.id}#s${b}`] = sh[b]; mv = true; }
        if (out[b] !== st[`${s.id}#o${b}`]) { st[`${s.id}#o${b}`] = out[b]; mv = true; }
      }
      if (oe !== st[`${s.id}#oe`]) { st[`${s.id}#oe`] = oe; mv = true; }
      if (mv) { changed = true; shiftMoves++; }
    }
    // ฟิวส์: ตัดสินเมื่อสถานะอื่นนิ่งแล้วเท่านั้น (ไม่ขาดจากคำตอบระหว่างทางที่รีเลย์/เกตยังไม่ถูก)
    if (!changed) for (const f of fuses) {
      if (st[`${f.id}#blown`]) continue;
      if (Math.abs(res.elements[f.id]?.current ?? 0) > 1.5 * f.fuse!) { st[`${f.id}#blown`] = true; changed = true; }
    }
    if (!changed) { const out = { ...last, relayStates: { ...st } }; return overshoot > 0 ? { ...out, eventOvershoot: overshoot } : out; }
    if (counterMoves > 20 || shiftMoves > 40) break;
  }
  if (shiftMoves > 40) return { ...last!, ok: false, error: { code: 'convergence', message: 'ไอซีเลื่อนบิต 74HC595 เลื่อนไม่หยุด', detail: 'ขาออกของ 74HC595 ย้อนกลับไปที่ขา SRCLK หรือ RCLK ทำให้เกิดขอบสัญญาณซ้ำทันที — ต่อ SRCLK/RCLK จาก GPIO ของ Pico หรือสัญญาณนาฬิกาภายนอก' } };
  if (counterMoves > 20) return { ...last!, ok: false, error: { code: 'convergence', message: 'ไอซีนับ CD4017 นับไม่หยุด', detail: 'ขาออกของไอซีนับย้อนกลับไปที่ขา CLK หรือ CLK INH ทำให้เกิดขอบสัญญาณนับซ้ำทันที — ต่อขา CLK จากแหล่งสัญญาณนาฬิกา (เช่น 555) และต่อ RESET ได้เฉพาะจากขาออก Q' } };
  if (comps.length && compMoves > 0 && !gates.length && !timers.length && !relays.length) return { ...last!, ok: false, error: { code: 'convergence', message: 'คอมพาราเตอร์สลับสถานะไม่หยุด', detail: 'ขาออกของคอมพาราเตอร์ย้อนกลับไปที่ขาเข้าแบบป้อนกลับลบ (เช่น ต่อขาออกเข้า IN− หรือ LED/โหลดทำให้แรงดันขาเข้าเปลี่ยนข้ามจุดเปรียบเทียบ) — ของจริงจะสั่นความถี่สูง แก้โดยใส่ hysteresis (ตัวต้านทานป้อนกลับจากขาออกไป IN+)' } };
  if (gates.length && (gateFlap || (!timers.length && !relays.length))) return { ...last!, ok: false, error: { code: 'convergence', message: 'วงจรเกตตรรกะสั่นไม่หยุด', detail: 'ขาออกของเกตย้อนกลับมาที่ขาเข้าแบบกลับสถานะ (เช่น NOT ต่อวนตัวเอง หรือวงแหวนเกตจำนวนคี่) — ของจริงจะสั่นที่ความถี่สูงมากตามเวลาหน่วงของเกต ซึ่งแบบจำลองนี้ไม่ได้จำลอง' } };
  if (timerFlap || (timers.length && !relays.length)) return { ...last!, ok: false, error: { code: 'convergence', message: 'ไอซี 555 สลับสถานะไม่หยุด', detail: 'วงจรสั่นเร็วเกินกว่าจะจำลองได้ — ส่วนใหญ่เกิดจากไม่มีตัวเก็บประจุกำหนดเวลาจากขา THR/TRIG ลงกราวด์ หรือขา DIS ต่อตรงกับ THR/TRIG โดยไม่มีตัวต้านทาน RB คั่น' } };
  return { ...last!, ok: false, error: { code: 'convergence', message: 'รีเลย์สลับไปมาไม่หยุด', detail: 'หน้าสัมผัสของรีเลย์ตัดหรือต่อไฟเลี้ยงขดลวดของตัวเอง (วงจรออสซิลเลต) — ในของจริงจะสั่นเป็นเสียงหึ่ง ตรวจการต่อ NO/NC/COM' } };
}

export function gateFn(op: GateOp, a: boolean, b: boolean): boolean {
  switch (op) {
    case 'nand': return !(a && b);
    case 'nor': return !(a || b);
    case 'not': return !a;
    case 'and': return a && b;
    case 'or': return a || b;
    case 'xor': return a !== b;
  }
}

function solveDCInner(nl: Netlist, options: SolveOptions = {}): SimResult {
  const first = solveCore(nl, options);
  if (first.ok || options.opampGain !== undefined || first.error?.code !== 'convergence') return first;
  const amps = nl.elements.filter((e): e is OpampEl => e.type === 'OPAMP');
  if (!amps.length) return first;
  const Amax = Math.max(...amps.map((a) => a.A));
  let x = options.initial;
  let iters = first.iterations;
  for (let g = 10; g < Amax; g *= 10) {
    const r = solveCore(nl, { ...options, initial: x, opampGain: g });
    iters += r.iterations;
    if (!r.ok) return { ...r, iterations: iters };
    x = r.x;
  }
  const last = solveCore(nl, { ...options, initial: x, opampGain: Amax });
  return { ...last, iterations: iters + last.iterations };
}

function solveCore(nl: Netlist, options: SolveOptions): SimResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const comp = options.companions;
  const tNow = options.time ?? 0;
  /** แรงดันขณะไม่มีโหลดของเครื่องกำเนิดสัญญาณ ณ เวลานี้ */
  const fv = (e: Extract<NetlistElement, { type: 'FGEN' }>) => waveValue(e, tNow);
  const { component, refNode, energized } = analyzeComponents(nl, !!comp);
  /** กระแส a→b และ conductance ของ C/L ที่ใช้ในการคำนวณครั้งนี้ */
  const reactive = (e: Extract<NetlistElement, { type: 'C' | 'L' }>): Companion | null => {
    const c = comp?.get(e.id);
    if (c) return c;
    if (e.type === 'L') return { G: 1 / Math.max(e.R, L_DC_MIN_R), J: 0 };
    return null; // C ใน DC = เปิด
  };
  const base: SimResult = {
    ok: false, nodeVoltage: new Array(nl.nodeCount).fill(null), component, energized,
    elements: {}, iterations: 0, modeIterations: 0, solveMs: 0,
  };
  const invalid = validateNetlist(nl);
  if (invalid) return { ...base, error: { code: 'invalid', message: 'ค่าพารามิเตอร์ไม่ถูกต้อง', detail: invalid } };

  const L = makeLayout(nl, component, refNode);
  const N = L.size;
  const supplies = nl.elements.filter((e): e is Extract<NetlistElement, { type: 'SUPPLY' }> => e.type === 'SUPPLY');
  const leds = nl.elements.filter(isDiode);
  const bjts = nl.elements.filter((e): e is BjtEl => e.type === 'BJT');
  const opVd = new Map<string, number>(nl.elements.filter((e) => e.type === 'OPAMP').map((e) => [e.id, 0]));
  const gainOf = (e: OpampEl): OpampEl => (options.opampGain !== undefined ? { ...e, A: Math.min(e.A, options.opampGain) } : e);
  /** แรงดันรอยต่อที่ใช้ในรอบก่อน (สำหรับ pnjlim ของ BJT) */
  const bjtV = new Map<string, { vbe: number; vbc: number }>(bjts.map((b) => [b.id, { vbe: 0, vbc: 0 }]));
  /** แรงดัน vgs/vds (ทิศช่อง N) ที่ใช้ในรอบก่อน — จำกัดการกระโดดต่อรอบ (คล้าย fetlim ของ SPICE) */
  const mosV = new Map<string, { vgs: number; vds: number }>(nl.elements.filter((e): e is MosEl => e.type === 'MOS').map((m) => [m.id, { vgs: 0, vds: 0 }]));
  /** ประทับอุปกรณ์หลายขา: กระแสเข้าอุปกรณ์ I_k ≈ C_k + Σ_j J[k][j]·V_j */
  const modes = new Map<string, { mode: SupplyMode; sign: number }>();
  for (const s of supplies) modes.set(s.id, { mode: 'CV', sign: 1 });

  let x: Float64Array = options.initial && options.initial.length === N ? Float64Array.from(options.initial) : new Float64Array(N);
  const vd = new Map<string, number>(leds.map((l) => [l.id, 0]));
  const seenModes = new Set<string>();
  let totalIter = 0;
  let modeIter = 0;

  const V = (net: number, xv: Float64Array) => (L.varOf[net] >= 0 ? xv[L.varOf[net]] : 0);

  // เริ่มจากคำตอบก่อนหน้า (ก้าวเวลาถัดไป / แก้วงจรเล็กน้อย): ให้สถานะการจำกัดก้าวของรอยต่อเริ่มที่ค่าเดิมด้วย
  // — ไม่เช่นนั้นรอบแรกจะประเมินทรานซิสเตอร์/ไดโอดที่ 0 V (ดับ) แล้ว Newton กระโดดไกลจนติดย่านพังทลาย
  if (options.initial && options.initial.length === N) {
    for (const b of bjts) bjtV.set(b.id, { vbe: b.pol * (V(b.b, x) - V(b.e, x)), vbc: b.pol * (V(b.b, x) - V(b.c, x)) });
    for (const l of leds) {
      const j = l.Rs > 0 ? L.ledInternal.get(l.id)! : L.varOf[l.a];
      vd.set(l.id, (j >= 0 ? x[j] : 0) - V(l.k, x));
    }
    for (const e of nl.elements) if (e.type === 'MOS') mosV.set(e.id, { vgs: e.pol * (V(e.g, x) - V(e.s, x)), vds: e.pol * (V(e.d, x) - V(e.s, x)) });
    for (const e of nl.elements) if (e.type === 'OPAMP') opVd.set(e.id, V(e.inp, x) - V(e.inn, x));
  }

  /** ประเมินสมดุลกระแส (KCL) ของสมการไม่เชิงเส้นจริงที่ทุกตัวแปร */
  const residualOk = (xv: Float64Array): boolean => {
    const F = new Float64Array(N);
    const S = new Float64Array(N);
    /** mag = ขนาดของพจน์ย่อยที่หักล้างกัน (เช่น G·v กับ J ของ companion) ใช้กำหนดความคลาดเคลื่อนปัดเศษที่ยอมรับได้ */
    const add = (node: number, cur: number, mag = Math.abs(cur)) => { if (node >= 0) { F[node] += cur; S[node] = Math.max(S[node], mag); } };
    /** ความไม่แน่นอนจากการลบแรงดันโหนดสองค่าที่ใกล้กัน: G·max(|Va|,|Vb|)·ε (ขยายไว้ 1e-8 เพื่อเผื่อการสะสม) */
    const round = (G: number, a: number, b: number) => G * Math.max(Math.abs(V(a, xv)), Math.abs(V(b, xv))) * 1e-8;
    for (let i = 0; i < N; i++) add(i, GMIN * xv[i]);
    for (const e of nl.elements) {
      if (e.type === 'R') {
        const i = (V(e.a, xv) - V(e.b, xv)) / e.R;
        const mag = Math.max(Math.abs(i), round(1 / e.R, e.a, e.b));
        add(L.varOf[e.a], i, mag); add(L.varOf[e.b], -i, mag);
      } else if (e.type === 'C' || e.type === 'L') {
        const c = reactive(e);
        if (!c || e.a === e.b) continue;
        const gv = c.G * (V(e.a, xv) - V(e.b, xv));
        const i = gv + c.J;
        const mag = Math.max(Math.abs(gv), Math.abs(c.J), round(c.G, e.a, e.b));
        add(L.varOf[e.a], i, mag); add(L.varOf[e.b], -i, mag);
      } else if (e.type === 'FGEN') {
        const vt = V(e.p, xv) - V(e.n, xv);
        const iout = (fv(e) - vt) / e.Rout;
        const mag = Math.max(Math.abs(iout), round(1 / e.Rout, e.p, e.n));
        add(L.varOf[e.p], -iout, mag); add(L.varOf[e.n], iout, mag);
      } else if (e.type === 'SUPPLY') {
        const m = modes.get(e.id)!;
        const iout = m.mode === 'CV' ? (e.V - (V(e.p, xv) - V(e.n, xv))) / e.Rint : m.sign * e.Ilim;
        add(L.varOf[e.p], -iout); add(L.varOf[e.n], iout);
      } else if (e.type === 'BJT') {
        const r = evalBJT(e, V(e.c, xv), V(e.b, xv), V(e.e, xv));
        [e.c, e.b, e.e].forEach((n, k) => add(L.varOf[n], r.I[k]));
      } else if (e.type === 'MOS') {
        const r = evalMOS(e, V(e.d, xv), V(e.g, xv), V(e.s, xv));
        add(L.varOf[e.d], r.I[0]); add(L.varOf[e.s], r.I[2]);
      } else if (e.type === 'OPAMP') {
        const nodes = [e.inp, e.inn, e.out, e.vp, e.vn];
        const r = evalOpamp(gainOf(e), nodes.map((n) => V(n, xv)), options.opampDyn?.get(e.id));
        nodes.forEach((n, k) => add(L.varOf[n], r.I[k], Math.max(Math.abs(r.I[k]), (Math.abs(V(e.out, xv)) + Math.abs(r.vo)) * 1e-8 / e.Rout)));
      } else {
        const j = e.Rs > 0 ? L.ledInternal.get(e.id)! : L.varOf[e.a];
        const vj = j >= 0 ? xv[j] : 0;
        if (e.Rs > 0) { const ir = (V(e.a, xv) - vj) / e.Rs; add(L.varOf[e.a], ir); add(j, -ir); }
        const vdd = vj - V(e.k, xv);
        const id = diodeBV(vdd, e.Is, e.n * VT, e.Bv, e.Ibv).i + GMIN * vdd;
        add(j, id); add(L.varOf[e.k], -id);
        if (e.type === 'D' && e.ctl) { const ic = e.ctl.gain * (id - GMIN * vdd); add(L.varOf[e.ctl.p], ic); add(L.varOf[e.ctl.q], -ic); }
      }
    }
    // ความคลาดเคลื่อนปัดเศษสะสมตามขนาดกระแสที่ใหญ่ที่สุดในวงจร (เช่น companion ของตัวเก็บประจุใหญ่ในก้าวสั้น)
    let smax = 0;
    for (let i = 0; i < N; i++) smax = Math.max(smax, S[i]);
    let ok = true, worst = 0, wi = -1;
    for (let i = 0; i < N; i++) { const q = Math.abs(F[i]) / (ABSTOL + 1e-7 * S[i] + 1e-13 * smax); if (q > worst) { worst = q; wi = i; } if (!(q <= 1)) ok = false; }
    if (options.trace) options.trace(`res worst=${worst.toExponential(2)} at ${wi} F=${F[wi]?.toExponential(2)} S=${S[wi]?.toExponential(2)}`);
    return ok;
  };

  for (modeIter = 1; modeIter <= MAX_MODE_ITER; modeIter++) {
    const key = supplies.map((s) => { const m = modes.get(s.id)!; return `${m.mode}${m.sign}`; }).join(',');
    if (seenModes.has(key)) {
      return { ...base, iterations: totalIter, modeIterations: modeIter, error: { code: 'mode-oscillation', message: 'แหล่งจ่ายสลับโหมด CV/CC ไม่ลงตัว', detail: 'ลองลดจำนวนแหล่งจ่ายที่ต่อขนานกันหรือปรับขีดจำกัดกระแส' } };
    }
    seenModes.add(key);

    // ---------- Newton–Raphson ----------
    let converged = false;
    for (let it = 0; it < MAX_NEWTON; it++) {
      totalIter++;
      const A = new Float64Array(N * N);
      const b = new Float64Array(N);
      const stampG = (p: number, q: number, g: number) => {
        // p, q เป็น index ตัวแปร (−1 = อ้างอิง)
        if (p >= 0) A[p * N + p] += g;
        if (q >= 0) A[q * N + q] += g;
        if (p >= 0 && q >= 0) { A[p * N + q] -= g; A[q * N + p] -= g; }
      };
      /** กระแส I ไหลเข้าโหนด p (ออกจาก q) */
      const stampI = (p: number, q: number, I: number) => {
        if (p >= 0) b[p] += I;
        if (q >= 0) b[q] -= I;
      };
      for (let i = 0; i < N; i++) A[i * N + i] += GMIN;
      /** ประทับอุปกรณ์หลายขา: I_k = C_k + Σ_j J[k][j]·V_j (I_k = กระแสไหลเข้าอุปกรณ์จากโหนด k) */
      const stampMulti = (vars: number[], J: number[][], C: number[]) => {
        for (let k = 0; k < vars.length; k++) {
          const p = vars[k];
          if (p < 0) continue;
          for (let j = 0; j < vars.length; j++) if (vars[j] >= 0) A[p * N + vars[j]] += J[k][j];
          b[p] -= C[k];
        }
      };

      for (const e of nl.elements) {
        if (e.type === 'R') { if (e.a !== e.b) stampG(L.varOf[e.a], L.varOf[e.b], 1 / e.R); }
        else if (e.type === 'C' || e.type === 'L') {
          const c = reactive(e);
          if (!c || e.a === e.b) continue; // ขาทั้งสองอยู่เน็ตเดียวกัน: ไม่มีผลต่อสมการ
          stampG(L.varOf[e.a], L.varOf[e.b], c.G);
          stampI(L.varOf[e.b], L.varOf[e.a], c.J); // J ไหล a → b
        } else if (e.type === 'FGEN') {
          if (e.p === e.n) continue;
          const p = L.varOf[e.p], q = L.varOf[e.n];
          stampG(p, q, 1 / e.Rout); stampI(p, q, fv(e) / e.Rout);
        } else if (e.type === 'SUPPLY') {
          const m = modes.get(e.id)!;
          const p = L.varOf[e.p], q = L.varOf[e.n];
          if (m.mode === 'CV') { stampG(p, q, 1 / e.Rint); stampI(p, q, e.V / e.Rint); }
          else stampI(p, q, m.sign * e.Ilim);
        } else if (e.type === 'BJT') {
          const Vc = V(e.c, x), Vb = V(e.b, x), Ve = V(e.e, x);
          const prev = bjtV.get(e.id)!;
          const vcrit = VT * Math.log(VT / (Math.SQRT2 * e.Is));
          const vbe = pnjlim(e.pol * (Vb - Ve), prev.vbe, VT, vcrit);
          const vbc = pnjlim(e.pol * (Vb - Vc), prev.vbc, VT, vcrit);
          bjtV.set(e.id, { vbe, vbc });
          const r = evalBJT(e, Vc, Vb, Ve, vbe, vbc);
          stampMulti([e.c, e.b, e.e].map((n) => L.varOf[n]), r.J, r.C);
        } else if (e.type === 'MOS') {
          const Vd = V(e.d, x), Vg = V(e.g, x), Vs = V(e.s, x);
          const prev = mosV.get(e.id)!;
          let vgs = e.pol * (Vg - Vs), vds = e.pol * (Vd - Vs);
          // จำกัดการเปลี่ยน vgs ต่อรอบ (เหนือขีดเริ่มให้ขยับได้มากขึ้นตามระยะห่าง) และ vds
          const dgMax = 0.5 + 0.5 * Math.abs(prev.vgs - e.vth);
          vgs = prev.vgs + Math.max(-dgMax, Math.min(dgMax, vgs - prev.vgs));
          const ddMax = 2 + 0.5 * Math.abs(prev.vds);
          vds = prev.vds + Math.max(-ddMax, Math.min(ddMax, vds - prev.vds));
          mosV.set(e.id, { vgs, vds });
          const r = evalMOS(e, Vd, Vg, Vs, vgs, vds);
          stampMulti([e.d, e.g, e.s].map((n) => L.varOf[n]), r.J, r.C);
        } else if (e.type === 'OPAMP') {
          const nodes = [e.inp, e.inn, e.out, e.vp, e.vn];
          const ge = gainOf(e);
          const Vin = nodes.map((n) => V(n, x));
          // จำกัดการเปลี่ยน u = A·vd/H ต่อรอบไม่เกิน 2 (คล้าย pnjlim) กันการกระโดดข้ามย่านอิ่มตัว
          const H = (Vin[3] - Vin[4] - 2 * ge.headroom) / 2;
          const prevVd = opVd.get(e.id)!;
          let vdNow = Vin[0] - Vin[1];
          const dy = options.opampDyn?.get(e.id);
          if (H > 1e-3) {
            // อัตราขยายที่มีผลในก้าวนี้: DC = A, ตามเวลา = A·k/(1 + k) (k = h/τ) — ขั้วของวงเปิดลดอัตราขยายต่อก้าวลง
            const k = dy && ge.gbw > 0 ? dy.h / (ge.A / (2 * Math.PI * ge.gbw)) : Infinity;
            const aEff = k === Infinity ? ge.A : (ge.A * k) / (1 + k);
            const maxDv = (2 * H) / Math.max(aEff, 1e-9);
            // จุดเริ่มของการจำกัด: ถ้ารอบก่อนอิ่มตัวลึก (|u| > 3) เริ่มจากขอบย่านอิ่มตัวเลย ไม่ต้องคลานออกทีละ Δu = 2
            // (อัตราขยายสูง เช่น ไอซีคงแรงดันที่หลุดจาก dropout จะใช้รอบเป็นพัน ๆ ถ้าเริ่มจาก vd เดิม)
            const cOff = k === Infinity ? 0 : dy!.wn / (1 + k);
            const lo = (-3 * H - cOff) / Math.max(aEff, 1e-9), hi = (3 * H - cOff) / Math.max(aEff, 1e-9);
            const sameSat = (prevVd >= hi && vdNow >= hi) || (prevVd <= lo && vdNow <= lo); // อิ่มตัวด้านเดิมทั้งสองรอบ: ไม่ต้องจำกัด
            const pv = Math.max(lo, Math.min(hi, prevVd));
            if (sameSat) { /* ใช้ค่าจริง */ }
            else if (vdNow - pv > maxDv) vdNow = pv + maxDv;
            else if (pv - vdNow > maxDv) vdNow = pv - maxDv;
            Vin[1] = Vin[0] - vdNow;
          }
          opVd.set(e.id, vdNow);
          const r = evalOpamp(ge, Vin, dy);
          stampMulti(nodes.map((n) => L.varOf[n]), r.J, r.C);
        } else {
          const nVt = e.n * VT;
          const j = e.Rs > 0 ? L.ledInternal.get(e.id)! : L.varOf[e.a];
          if (e.Rs > 0) stampG(L.varOf[e.a], j, 1 / e.Rs);
          const vj = j >= 0 ? x[j] : 0;
          const vk = V(e.k, x);
          const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * e.Is));
          let v = pnjlim(vj - vk, vd.get(e.id)!, nVt, vcrit);
          // จำกัดการเปลี่ยนแรงดันในย่านพังทลายย้อนกลับด้วย (ซีเนอร์)
          if (e.Bv !== undefined && isFinite(e.Bv) && v < -e.Bv + 10 * VT) {
            const vcb = VT * Math.log(VT / (Math.SQRT2 * (e.Ibv ?? 1e-3)));
            v = -(pnjlim(-(v + e.Bv), -(vd.get(e.id)! + e.Bv), VT, vcb) + e.Bv);
          }
          vd.set(e.id, v);
          const { i, g } = diodeBV(v, e.Is, nVt, e.Bv, e.Ibv);
          const gg = g + GMIN;
          stampG(j, L.varOf[e.k], gg);
          // companion: i(v) ≈ i0 + g(v − v0)  → แหล่งกระแสสมมูล ieq = i0 − g·v0 ไหลจาก A' ไป K
          stampI(L.varOf[e.k], j, i - g * v);
          // ออปโต: กระแสโฟโต้ = gain·i(v) ≈ gain·(i0 + g(vj − vk − v0)) ไหลออกจาก p เข้า q (VCCS เชิงเส้นรอบจุดทำงาน)
          if (e.type === 'D' && e.ctl) {
            const p = L.varOf[e.ctl.p], q = L.varOf[e.ctl.q], kk = L.varOf[e.k], gm = e.ctl.gain * g;
            const put = (r: number, c: number, val: number) => { if (r >= 0 && c >= 0) A[r * N + c] += val; };
            put(p, j, gm); put(p, kk, -gm); put(q, j, -gm); put(q, kk, gm);
            const i0 = e.ctl.gain * (i - g * v);
            if (p >= 0) b[p] -= i0;
            if (q >= 0) b[q] += i0;
          }
        }
      }
      const xn = solveLinear(A, b, N);
      if (!xn) {
        return { ...base, iterations: totalIter, modeIterations: modeIter, error: { code: 'singular', message: 'ระบบสมการแก้ไม่ได้ (singular matrix)', detail: 'โครงข่ายมีโหนดที่ไม่มีเส้นทางกำหนดแรงดัน' } };
      }
      for (let i = 0; i < N; i++) if (!isFinite(xn[i])) {
        return { ...base, iterations: totalIter, modeIterations: modeIter, error: { code: 'numeric', message: 'ผลคำนวณไม่เป็นตัวเลขจำกัด (overflow)' } };
      }
      let ok = true;
      for (let i = 0; i < N; i++) {
        const d = Math.abs(xn[i] - x[i]);
        if (d > VNTOL + RELTOL * Math.abs(xn[i])) ok = false;
      }
      if (options.trace) { let md = 0, mi = -1; for (let i = 0; i < N; i++) { const d = Math.abs(xn[i] - x[i]); if (d > md) { md = d; mi = i; } } options.trace(`it ${it} maxdx=${md.toExponential(2)} at ${mi} x=${xn[mi]?.toExponential(3)}`); }
      x = xn;
      // เกณฑ์ลู่เข้า: ขั้น Newton เล็กพอ และ KCL ทุกโหนดสมดุล (ประเมินสมการไม่เชิงเส้นจริงที่ x)
      // หมายเหตุ: วงจรย่อยที่ต่อกับส่วนอื่นด้วยไดโอดที่ปิดอยู่เท่านั้นทำให้เมทริกซ์ ill-conditioned
      // แรงดัน "ลอย" ของส่วนนั้นอาจแกว่งเล็กน้อยระหว่างรอบโดยกระแสไม่เปลี่ยน — จึงยอมรับเมื่อ KCL สมดุลแม้ ΔV ยังไม่เล็ก
      if (it >= 1 && (ok || it >= 3) && residualOk(x)) { converged = true; break; }
    }
    if (!converged) {
      return { ...base, iterations: totalIter, modeIterations: modeIter, error: { code: 'convergence', message: `การคำนวณไม่ลู่เข้าภายใน ${MAX_NEWTON} รอบ`, detail: 'วงจรมีความไม่เชิงเส้นสูงหรือค่าพารามิเตอร์สุดขั้ว' } };
    }

    // ---------- ตรวจโหมดแหล่งจ่าย ----------
    let changed = false;
    for (const s of supplies) {
      const m = modes.get(s.id)!;
      const vt = V(s.p, x) - V(s.n, x);
      if (m.mode === 'CV') {
        const I = (s.V - vt) / s.Rint;
        if (Math.abs(I) > s.Ilim * (1 + 1e-9)) { modes.set(s.id, { mode: 'CC', sign: Math.sign(I) || 1 }); changed = true; }
      } else if (m.sign * vt > s.V * (1 + 1e-9) + 1e-12) {
        modes.set(s.id, { mode: 'CV', sign: 1 });
        changed = true;
      }
    }
    if (!changed) break;
    if (modeIter === MAX_MODE_ITER) {
      return { ...base, iterations: totalIter, modeIterations: modeIter, error: { code: 'mode-oscillation', message: 'แหล่งจ่ายสลับโหมด CV/CC ไม่ลงตัว' } };
    }
  }

  // ---------- สรุปผล ----------
  const nodeVoltage = base.nodeVoltage.slice();
  for (let i = 0; i < nl.nodeCount; i++) if (component[i] >= 0) nodeVoltage[i] = V(i, x);
  const elements: Record<string, ElementResult> = {};
  for (const e of nl.elements) {
    if (e.type === 'R') {
      const v = V(e.a, x) - V(e.b, x);
      const i = v / e.R;
      elements[e.id] = { id: e.id, current: i, voltage: v, power: v * i };
    } else if (e.type === 'C' || e.type === 'L') {
      const v = V(e.a, x) - V(e.b, x);
      const c = reactive(e);
      const i = c ? c.G * v + c.J : 0;
      elements[e.id] = { id: e.id, current: i, voltage: v, power: v * i };
    } else if (e.type === 'FGEN') {
      const v = V(e.p, x) - V(e.n, x);
      const i = (fv(e) - v) / e.Rout;
      elements[e.id] = { id: e.id, current: i, voltage: v, power: v * i };
    } else if (e.type === 'SUPPLY') {
      const m = modes.get(e.id)!;
      const v = V(e.p, x) - V(e.n, x);
      const i = m.mode === 'CV' ? (e.V - v) / e.Rint : m.sign * e.Ilim;
      elements[e.id] = { id: e.id, current: i, voltage: v, power: v * i, mode: m.mode };
    } else if (e.type === 'BJT') {
      const r = evalBJT(e, V(e.c, x), V(e.b, x), V(e.e, x));
      const vce = V(e.c, x) - V(e.e, x), vbeA = V(e.b, x) - V(e.e, x);
      const region = r.vbe > 0.5 ? (r.vbc > 0.45 ? 2 : 1) : r.vbc > 0.5 ? 3 : 0;
      elements[e.id] = { id: e.id, current: r.Ic, voltage: vce, power: vce * r.Ic + vbeA * r.Ib, extra: { ib: r.Ib, ie: r.Ie, vbe: vbeA, vbc: V(e.b, x) - V(e.c, x), region } };
    } else if (e.type === 'MOS') {
      const r = evalMOS(e, V(e.d, x), V(e.g, x), V(e.s, x));
      const vds = V(e.d, x) - V(e.s, x);
      elements[e.id] = { id: e.id, current: r.Id, voltage: vds, power: vds * r.Id, extra: { vgs: V(e.g, x) - V(e.s, x), region: r.region, veff: r.veff, gm: r.gm, rds: r.gds > 0 ? 1 / r.gds : Infinity } };
    } else if (e.type === 'OPAMP') {
      const nodes = [e.inp, e.inn, e.out, e.vp, e.vn];
      const r = evalOpamp(gainOf(e), nodes.map((n) => V(n, x)), options.opampDyn?.get(e.id));
      const vout = V(e.out, x) - V(e.vn, x);
      elements[e.id] = { id: e.id, current: r.iout, voltage: vout, power: r.iout * (r.iout >= 0 ? V(e.vp, x) - V(e.out, x) : V(e.out, x) - V(e.vn, x)) + r.iq * (V(e.vp, x) - V(e.vn, x)), extra: { vd: r.vd, saturated: r.saturated ? 1 : 0, vsupply: V(e.vp, x) - V(e.vn, x), iq: r.iq, iin: r.iin, w: r.wState, slewing: r.slewing ? 1 : 0 } };
    } else {
      const nVt = e.n * VT;
      const j = e.Rs > 0 ? L.ledInternal.get(e.id)! : L.varOf[e.a];
      const vj = j >= 0 ? x[j] : 0;
      const i = diodeBV(vj - V(e.k, x), e.Is, nVt, e.Bv, e.Ibv).i;
      const v = V(e.a, x) - V(e.k, x);
      elements[e.id] = { id: e.id, current: i, voltage: v, power: v * i };
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { ...base, ok: true, nodeVoltage, elements, iterations: totalIter, modeIterations: modeIter, solveMs: t1 - t0, x };
}

/** ผลต่างแรงดันระหว่างสองเน็ต — null พร้อมเหตุผลถ้าวัดไม่ได้ */
export function voltageBetween(r: SimResult, a: number | undefined, b: number | undefined): { value: number | null; reason?: string } {
  if (!r.ok) return { value: null, reason: 'การจำลองล้มเหลว' };
  if (a === undefined || b === undefined) return { value: null, reason: 'ยังไม่ได้วางโพรบครบสองจุด' };
  if (a === b) return { value: 0 };
  const ca = r.component[a], cb = r.component[b];
  if (ca < 0 || cb < 0) return { value: null, reason: 'จุดวัดลอย (floating) — ไม่มีอุปกรณ์ต่อกับจุดนี้' };
  if (ca !== cb) return { value: null, reason: 'สองจุดอยู่คนละวงจรที่ไม่เชื่อมกัน จึงไม่มีจุดอ้างอิงร่วม' };
  return { value: (r.nodeVoltage[a] as number) - (r.nodeVoltage[b] as number) };
}

/** กระแสที่ไหลเข้าอุปกรณ์จากแต่ละขา (ใช้ตรวจ KCL และแสดงผล) */
export function terminalCurrents(e: NetlistElement, er: ElementResult): Array<[number, number]> {
  const i = er.current;
  switch (e.type) {
    case 'R': case 'C': case 'L': return [[e.a, i], [e.b, -i]];
    case 'LED': case 'D': return [[e.a, i], [e.k, -i]];
    case 'SUPPLY': case 'FGEN': return [[e.p, -i], [e.n, i]];
    case 'BJT': return [[e.c, i], [e.b, er.extra!.ib], [e.e, er.extra!.ie]];
    case 'MOS': return [[e.d, i], [e.g, 0], [e.s, -i]];
    case 'OPAMP': { const x = er.extra!; return [[e.inp, x.iin], [e.inn, -x.iin], [e.out, -i], [e.vp, (i >= 0 ? i : 0) + x.iq], [e.vn, (i < 0 ? i : 0) - x.iq]]; }
  }
}
