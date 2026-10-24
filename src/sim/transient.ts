import type { Netlist, NetlistElement } from './netlist';
import { solveDC, type Companion, type OpampDyn, type SimResult } from './solver';
import { maxStepFor, nextBreakpoint } from './waveform';
import { SONAR_DELAY } from '../model/catalog';

/**
 * การวิเคราะห์ตามเวลา (transient analysis)
 *
 * วิธีอินทิเกรต:
 *  - Trapezoidal (ลำดับ 2) เป็นค่าหลัก
 *  - Backward Euler (ลำดับ 1, หน่วงการแกว่ง) ในก้าวแรกหลัง "จุดไม่ต่อเนื่อง":
 *    เริ่มจำลอง, เริ่มเวลาใหม่, แก้ไขวงจร/สลับสวิตช์ระหว่างจำลอง
 *
 * Companion model (กระแส a→b = G·v + J):
 *  ตัวเก็บประจุ   BE: G = C/h,          J = −G·vₙ
 *                 TR: G = 2C/h,         J = −(G·vₙ + iₙ)
 *  ตัวเหนี่ยวนำ+R BE: G = 1/(R + L/h),  J = G·(L/h)·iₙ
 *                 TR: G = 1/(R + 2L/h), J = G·(vₙ + (2L/h − R)·iₙ)
 *
 * ควบคุมขนาดก้าว (adaptive):
 *  ยอมรับก้าวเมื่อแรงดันตัวเก็บประจุเปลี่ยนไม่เกิน 2% ของแรงดันอ้างอิง และกระแสตัวเหนี่ยวนำเปลี่ยนไม่เกิน 2% ของกระแสอ้างอิง
 *  ถ้าเกิน → ปฏิเสธและลด h ลง 4 เท่า; ถ้าเปลี่ยนน้อยกว่า 0.5% → เพิ่ม h 2 เท่าในก้าวถัดไป
 *  (ประมาณ 50 ก้าวขึ้นไปต่อการเปลี่ยนแปลงเต็มช่วง — คลาดเคลื่อนจากคำตอบเชิงวิเคราะห์ต่ำกว่า 0.1% สำหรับ RC/RL)
 *
 * เครื่องกำเนิดสัญญาณ:
 *  - ก้าวเวลาไม่เกิน 1/64 คาบ เพื่อให้รูปคลื่นละเอียดพอ
 *  - ก้าวเวลาลงตรงขอบคลื่นสี่เหลี่ยม/ยอดคลื่นสามเหลี่ยมพอดี (breakpoint) แล้วเริ่มก้าวถัดไปด้วย Backward Euler ขนาดเล็ก
 */

export const H_MIN = 1e-9; // s
export const H_START = 1e-7; // s
export const H_INSTANT = 1e-9;
const ACCEPT = 0.02;
const GROW = 0.005;
/** ไอซี 555 เปลี่ยนสถานะ: ยอมให้ขาเข้าคอมพาราเตอร์เลยจุดเปลี่ยนได้ไม่เกินสัดส่วนนี้ของ VCC (ไม่งั้นลดก้าวลง) */
const EVENT_TOL = 3e-4;

type CEl = Extract<NetlistElement, { type: 'C' }>;
type LEl = Extract<NetlistElement, { type: 'L' }>;

export interface ReactiveState { v: number; i: number }
export interface SonarState { trigHi: boolean; trigRise: number; echoStart: number; echoEnd: number; width: number; count: number }

export interface TranState {
  /** เวลาจำลอง (s) */
  t: number;
  /** สถานะตัวเก็บประจุ/ตัวเหนี่ยวนำ ตาม id อุปกรณ์ (คงอยู่แม้วงจรถูกแก้ไขระหว่างจำลอง) */
  react: Map<string, ReactiveState>;
  /** สถานะภายในของออปแอมป์ (แรงดันก่อนตัดที่ไฟเลี้ยง เทียบกลางไฟเลี้ยง) ตาม id — ขั้วของวงเปิดและ slew rate */
  amp: Map<string, number>;
  /** สถานะหน้าสัมผัสรีเลย์ (true = ดึงแล้ว) — ใช้ต่อเนื่องข้ามก้าวเพื่อให้มี hysteresis */
  relay: Record<string, boolean>;
  /** มอเตอร์ DC: ความเร็วเชิงมุมที่แกนมอเตอร์ (rad/s) และมุมสะสมที่แกนออก (rad) ตาม id */
  motor: Map<string, { w: number; th: number }>;
  /** HC-SR04: ระดับ TRIG ก่อนหน้า เวลาขอบขึ้นของ TRIG ช่วงเวลา ECHO สูงที่กำหนดไว้ ความกว้างล่าสุด และจำนวนครั้งที่วัด */
  sonar: Map<string, SonarState>;
  /** ใช้ Backward Euler ในก้าวถัดไป (หลังจุดไม่ต่อเนื่อง) */
  needBE: boolean;
  /** ขนาดก้าวที่จะลองครั้งถัดไป */
  h: number;
  /** ผลล่าสุดที่ยอมรับแล้ว */
  last: SimResult | null;
  netlistKey: string;
}

export function newTranState(): TranState {
  return { t: 0, react: new Map(), amp: new Map(), relay: {}, motor: new Map(), sonar: new Map(), needBE: true, h: H_START, last: null, netlistKey: '' };
}

/** เตรียมสถานะสำหรับ netlist (อุปกรณ์ใหม่ได้ค่าเริ่มต้น, อุปกรณ์ที่ถูกลบถูกทิ้ง) และจับจุดไม่ต่อเนื่อง */
export function syncState(st: TranState, nl: Netlist) {
  const key = JSON.stringify(nl);
  const ids = new Set<string>();
  for (const e of nl.elements) {
    if (e.type !== 'C' && e.type !== 'L') continue;
    ids.add(e.id);
    if (!st.react.has(e.id)) st.react.set(e.id, { v: e.type === 'C' ? e.v0 : 0, i: 0 });
  }
  for (const id of [...st.react.keys()]) if (!ids.has(id)) st.react.delete(id);
  for (const e of nl.elements) if (e.type === 'L' && e.motor && !st.motor.has(e.id)) st.motor.set(e.id, { w: 0, th: 0 });
  for (const id of [...st.motor.keys()]) if (!nl.elements.some((e) => e.type === 'L' && e.motor && e.id === id)) st.motor.delete(id);
  for (const s of nl.sonars ?? []) if (!st.sonar.has(s.id)) st.sonar.set(s.id, { trigHi: false, trigRise: -1, echoStart: Infinity, echoEnd: -Infinity, width: 0, count: 0 });
  for (const id of [...st.sonar.keys()]) if (!nl.sonars?.some((s) => s.id === id)) st.sonar.delete(id);
  const amps = new Set(nl.elements.filter((e) => e.type === 'OPAMP').map((e) => e.id));
  for (const id of amps) if (!st.amp.has(id)) st.amp.set(id, 0);
  for (const id of [...st.amp.keys()]) if (!amps.has(id)) st.amp.delete(id);
  if (key !== st.netlistKey) {
    st.netlistKey = key;
    st.needBE = true;
    // วงจรเปลี่ยน (เช่น ขา PWM สลับ): เริ่มก้าวที่ 1/32 ของก้าวก่อน (ไม่ต่ำกว่า H_START) — ก้าวที่ใหญ่เกินจะถูกปฏิเสธเองตามเกณฑ์การเปลี่ยนแปลง
    // (เดิมเริ่มที่ H_START ทุกครั้ง: PWM 1 kHz ต้องเดินขึ้นจาก 0.1 µs ราว 14 ก้าวต่อขอบ)
    st.h = Math.min(st.h, Math.max(H_START, st.h / 32));
  }
}

function companions(nl: Netlist, st: TranState, h: number, be: boolean): Map<string, Companion> {
  const m = new Map<string, Companion>();
  for (const e of nl.elements) {
    if (e.type === 'C') {
      const s = st.react.get(e.id)!;
      if (be) { const G = e.C / h; m.set(e.id, { G, J: -G * s.v }); }
      else { const G = (2 * e.C) / h; m.set(e.id, { G, J: -(G * s.v + s.i) }); }
    } else if (e.type === 'L') {
      const s = st.react.get(e.id)!;
      // มอเตอร์: แรงดันคร่อมขดลวด = v − E (E = ke·ω จากก้าวก่อน — ความเฉื่อยทำให้ ω เปลี่ยนช้ากว่ากระแสมาก)
      const E = e.motor ? e.motor.ke * (st.motor.get(e.id)?.w ?? 0) : 0;
      if (be) { const G = 1 / (e.R + e.L / h); m.set(e.id, { G, J: G * (e.L / h) * s.i - G * E }); }
      else { const G = 1 / (e.R + (2 * e.L) / h); m.set(e.id, { G, J: G * (s.v - E + ((2 * e.L) / h - e.R) * s.i) - G * E }); }
    }
  }
  return m;
}

/** แรงดัน/กระแสอ้างอิงสำหรับวัดขนาดการเปลี่ยนแปลงต่อก้าว */
function scales(nl: Netlist, st: TranState) {
  let vref = 1, iref = 1e-3;
  for (const e of nl.elements) {
    if (e.type === 'SUPPLY') { vref = Math.max(vref, Math.abs(e.V)); iref = Math.max(iref, e.Ilim * 0.05); }
    if (e.type === 'FGEN') { const vm = Math.abs(e.offset) + e.vpp / 2; vref = Math.max(vref, vm); iref = Math.max(iref, (vm / e.Rout) * 0.05); }
  }
  for (const s of st.react.values()) { vref = Math.max(vref, Math.abs(s.v)); iref = Math.max(iref, Math.abs(s.i)); }
  // มอเตอร์: สเกลกระแสตามกระแสหยุดค้าง (V/R) — กระแสขณะหมุนเล็กกว่ามาก ถ้าใช้เป็นสเกล PWM จะต้องเดินก้าวละไม่กี่ mA
  for (const e of nl.elements) if (e.type === 'L' && e.motor) iref = Math.max(iref, vref / Math.max(e.R, 1e-3));
  return { vref, iref };
}

export interface StepOutcome {
  ok: boolean;
  result: SimResult;
  steps: number;
  rejected: number;
  /** ไปถึงเวลาเป้าหมายหรือไม่ (false = หมดงบเวลา/จำนวนก้าว) */
  reached: boolean;
}

/**
 * เดินเวลาไปจนถึง tEnd (หรือจนหมดงบ) — เรียก onSample หลังทุกก้าวที่ยอมรับ
 * ถ้า tEnd ≤ t: คำนวณ "สถานะ ณ เวลาปัจจุบัน" ด้วยก้าวสั้นมาก (ใช้ตอนหยุดเวลาแล้วแก้วงจร)
 */
export function advance(
  nl: Netlist, st: TranState, tEnd: number,
  opts: { maxSteps?: number; deadline?: number; hMax?: number; onSample?: (t: number, r: SimResult) => void } = {},
): StepOutcome {
  syncState(st, nl);
  const maxSteps = opts.maxSteps ?? 20000;
  const fgens = nl.elements.filter((e): e is Extract<NetlistElement, { type: 'FGEN' }> => e.type === 'FGEN');
  const hasMotor = nl.elements.some((e) => e.type === 'L' && !!e.motor);
  // มอเตอร์: แรงเสียดทานรอบ ω = 0 แข็ง (ปรับ ω แบบชัดแจ้ง) — ก้าวไม่เกิน 1 ms
  const hMax = Math.min(opts.hMax ?? Infinity, hasMotor ? 1e-3 : Infinity, ...fgens.map(maxStepFor));
  const nextBp = (t: number) => Math.min(Infinity, ...fgens.map((f) => nextBreakpoint(f, t)), nextSonarEvent(st, t));
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let steps = 0, rejected = 0;

  if (tEnd <= st.t || !st.last) {
    // คำนวณ ณ เวลาปัจจุบัน: ก้าว BE สั้นมาก ตัวเก็บประจุ/ตัวเหนี่ยวนำแทบไม่เปลี่ยนสถานะ
    const r = solveStep(nl, st, H_INSTANT, true, st.t);
    if (!r.ok) return { ok: false, result: r, steps: 1, rejected: 0, reached: false };
    commit(nl, st, r);
    stepSonars(nl, st, r);
    st.last = { ...r, time: st.t, ...motorOut(st), ...sonarOut(st) };
    if (tEnd <= st.t) return { ok: true, result: st.last, steps: 1, rejected: 0, reached: true };
  }

  while (st.t < tEnd - 1e-15) {
    if (steps >= maxSteps || (opts.deadline !== undefined && now() > opts.deadline)) {
      return { ok: true, result: st.last!, steps, rejected, reached: false };
    }
    const remaining = tEnd - st.t;
    let h = Math.min(st.h, hMax, remaining);
    if (remaining - h < H_MIN) h = remaining; // อย่าทิ้งเศษก้าวที่เล็กเกิน
    const bp = nextBp(st.t);
    let hitsBp = false;
    if (st.t + h >= bp - H_MIN) { h = bp - st.t; hitsBp = true; }
    const be = st.needBE;
    const r = solveStep(nl, st, h, be, st.t + h);
    steps++;
    if (!r.ok) {
      if (h > H_MIN * 4) { st.h = h / 4; rejected++; continue; }
      return { ok: false, result: { ...r, time: st.t }, steps, rejected, reached: false };
    }
    if ((r.eventOvershoot ?? 0) > EVENT_TOL && h > H_MIN * 4) { st.h = h / 4; rejected++; continue; }
    // ขนาดการเปลี่ยนแปลงในก้าวนี้
    const { vref, iref } = scales(nl, st);
    let change = 0;
    for (const e of nl.elements) {
      if (e.type === 'C') change = Math.max(change, Math.abs(r.elements[e.id].voltage - st.react.get(e.id)!.v) / vref);
      else if (e.type === 'L') change = Math.max(change, Math.abs(r.elements[e.id].current - st.react.get(e.id)!.i) / iref);
    }
    if (change > ACCEPT && h > H_MIN * 4) { st.h = h / 4; rejected++; continue; }
    st.t += h;
    const latched = latchKey(st.relay);
    commit(nl, st, r);
    stepMotors(nl, st, r, h);
    stepSonars(nl, st, r);
    st.needBE = false;
    if (latchKey(st.relay) !== latched) st.needBE = true; // รีเลย์/555 เปลี่ยนสถานะ = จุดไม่ต่อเนื่อง
    st.last = { ...r, time: st.t, ...motorOut(st), ...sonarOut(st) };
    if (change < GROW) st.h = Math.min(h * 2, hMax === Infinity ? 1e3 : hMax);
    else st.h = h;
    if (hitsBp) {
      // ขอบคลื่น: ก้าวถัดไปใช้ BE และเริ่มจากก้าวเล็ก เพื่อจับการเปลี่ยนแปลงทันทีได้แม่น
      st.needBE = true;
      st.h = Math.max(H_MIN * 4, Math.min(st.h, (hMax === Infinity ? h : hMax) / 32));
    }
    opts.onSample?.(st.t, st.last);
  }
  return { ok: true, result: st.last!, steps, rejected, reached: true };
}

function solveStep(nl: Netlist, st: TranState, h: number, be: boolean, time: number): SimResult {
  const opampDyn = new Map<string, OpampDyn>();
  for (const [id, wn] of st.amp) opampDyn.set(id, { wn, h });
  const net = nl.sonars?.length ? { ...nl, elements: [...nl.elements, ...sonarElements(nl, st, time)] } : nl;
  return solveDC(net, { companions: companions(nl, st, h, be), initial: st.last?.x, time, opampDyn, relayStates: st.relay });
}

/* ---------------- HC-SR04 ---------------- */

/** ECHO สูงในช่วง [echoStart, echoEnd) — ขาออกขับด้วย 100 Ω ไป VCC (สูง) หรือ GND (ต่ำ), ระหว่างวัดกินกระแสเพิ่ม 13 mA */
function sonarElements(nl: Netlist, st: TranState, time: number): NetlistElement[] {
  const out: NetlistElement[] = [];
  for (const s of nl.sonars ?? []) {
    const ss = st.sonar.get(s.id);
    const hi = !!ss && time >= ss.echoStart - 1e-12 && time < ss.echoEnd - 1e-12;
    const busy = !!ss && time >= ss.echoStart - SONAR_DELAY - 1e-12 && time < ss.echoEnd;
    out.push(hi ? { type: 'R', id: `${s.id}#eh`, role: 'module', a: s.vcc, b: s.echo, R: 100 } : { type: 'R', id: `${s.id}#el`, role: 'module', a: s.echo, b: s.gnd, R: 100 });
    if (busy) out.push({ type: 'MOS', id: `${s.id}#ia`, d: s.vcc, g: s.gnd, s: s.gnd, pol: 1, vth: -1, kp: 2 * 0.013, lambda: 0.001 });
  }
  return out;
}

/** หลังก้าวที่ยอมรับ: หาขอบของ TRIG — ขอบลงหลังสูงนาน ≥ 10 µs (และไม่ได้วัดอยู่) = เริ่มวัดครั้งใหม่ */
function stepSonars(nl: Netlist, st: TranState, r: SimResult) {
  for (const s of nl.sonars ?? []) {
    const ss = st.sonar.get(s.id);
    if (!ss) continue;
    const v = (n: number) => r.nodeVoltage[n] ?? 0;
    const g = v(s.gnd), vcc = v(s.vcc) - g, trig = v(s.trig) - g;
    // ECHO จบแล้ว: บันทึกความกว้าง และพร้อมรับคำสั่งวัดครั้งต่อไป
    if (ss.echoEnd !== -Infinity && st.t >= ss.echoEnd - 1e-12) {
      ss.width = ss.echoEnd - ss.echoStart; ss.count++; ss.echoStart = Infinity; ss.echoEnd = -Infinity;
    }
    if (vcc < s.vMin - 0.3) { ss.trigHi = false; ss.echoStart = Infinity; ss.echoEnd = -Infinity; continue; }
    const hi = trig > 2.0; // ขาเข้าระดับ TTL
    if (hi && !ss.trigHi) ss.trigRise = st.t;
    if (!hi && ss.trigHi && st.t - ss.trigRise >= 10e-6 - 1e-9 && ss.echoEnd === -Infinity) {
      ss.echoStart = st.t + SONAR_DELAY;
      ss.echoEnd = ss.echoStart + s.echoWidth;
    }
    ss.trigHi = hi;
  }
}

/** เวลาเหตุการณ์ถัดไปของ ECHO (ขอบขึ้น/ลง) หลังเวลา t — ใช้เป็น breakpoint ของก้าวเวลา และให้ CPU หยุดตรงขอบ */
export function nextSonarEvent(st: TranState, t: number): number {
  let n = Infinity;
  for (const ss of st.sonar.values()) {
    if (ss.echoStart > t + 1e-12) n = Math.min(n, ss.echoStart);
    else if (ss.echoEnd > t + 1e-12) n = Math.min(n, ss.echoEnd);
  }
  return n;
}

function sonarOut(st: TranState): Partial<SimResult> {
  if (!st.sonar.size) return {};
  const sonars: Record<string, { echo: number; width: number; count: number }> = {};
  for (const [id, ss] of st.sonar) sonars[id] = { echo: st.t >= ss.echoStart && st.t < ss.echoEnd ? 1 : 0, width: ss.width, count: ss.count };
  return { sonars };
}

/** ปรับความเร็วมอเตอร์หลังก้าวที่ยอมรับ: J·dω/dt = ke·i − แรงเสียดทาน(คูลอมบ์ ทำให้เรียบรอบ 0) − b·ω − โหลด (กึ่งโดยนัยสำหรับพจน์หนืด) */
function stepMotors(nl: Netlist, st: TranState, r: SimResult, h: number) {
  for (const e of nl.elements) {
    if (e.type !== 'L' || !e.motor) continue;
    const m = e.motor, s = st.motor.get(e.id)!;
    const i = r.elements[e.id]?.current ?? 0;
    const w0 = 5; // rad/s — ช่วงทำให้เรียบของแรงเสียดทานสถิต
    const Tm = m.ke * i;
    const Tf = (m.Tc + m.Tload) * Math.tanh(s.w / w0);
    // หยุดนิ่ง: แรงบิดมอเตอร์ไม่ชนะแรงเสียดทาน+โหลด → คงอยู่ (กันการไหลช้า ๆ จาก tanh)
    if (Math.abs(s.w) < 0.5 && Math.abs(Tm) <= m.Tc + m.Tload) { s.w = 0; continue; }
    s.w = (s.w + (h / m.J) * (Tm - Tf)) / (1 + (h * m.b) / m.J);
    s.th += (s.w / m.ratio) * h;
  }
}

function motorOut(st: TranState): Partial<SimResult> {
  if (!st.motor.size) return {};
  const motorSpeeds: Record<string, number> = {}, motorAngles: Record<string, number> = {};
  for (const [id, s] of st.motor) { motorSpeeds[id] = s.w; motorAngles[id] = s.th; }
  return { motorSpeeds, motorAngles };
}

const latchKey = (m: Record<string, boolean>) => Object.keys(m).sort().map((k) => (m[k] ? 1 : 0)).join('');

function commit(nl: Netlist, st: TranState, r: SimResult) {
  if (r.relayStates) st.relay = { ...r.relayStates };
  for (const e of nl.elements) {
    if (e.type === 'OPAMP') { const w = r.elements[e.id]?.extra?.w; if (w !== undefined && isFinite(w)) st.amp.set(e.id, w); continue; }
    if (e.type !== 'C' && e.type !== 'L') continue;
    const er = r.elements[(e as CEl | LEl).id];
    st.react.set(e.id, { v: er.voltage, i: er.current });
  }
}

/** เริ่มเวลาใหม่: t = 0, ตัวเก็บประจุกลับไปที่แรงดันเริ่มต้น, ตัวเหนี่ยวนำกระแส 0 */
export function restart(st: TranState) {
  st.t = 0;
  st.react.clear();
  st.amp.clear();
  st.relay = {};
  st.motor.clear();
  st.sonar.clear();
  st.needBE = true;
  st.h = H_START;
  st.last = null;
  st.netlistKey = '';
}
