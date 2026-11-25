/**
 * เครื่องวัดกำลังไฟฟ้า (power monitor) — ตัวเลขทุกตัวมาจากผลคำนวณวงจร (กำลังของแต่ละ element = แรงดันคร่อม × กระแส)
 *
 * ฝั่งตัวคำนวณ: PowerAcc สะสม ∫P dt ของทุก element ทุกก้าวเวลา (ค่าคงที่เป็นช่วงจนถึงก้าวถัดไป) → ค่าเฉลี่ยตามเวลาในช่วงของคำขอ
 *   (LED ที่ขับด้วย PWM จึงได้กำลังเฉลี่ยจริง ไม่ใช่ค่าขณะหนึ่ง) · วงจร DC ล้วน (ไม่มีเวลา) ใช้ค่าจากผลคำนวณครั้งนั้น
 * ฝั่งแอป: powerReport แยกแหล่งจ่าย (แหล่งจ่าย DC, เครื่องกำเนิดสัญญาณ, ขาไฟเลี้ยงและขา GPIO ของบอร์ด, แบตเตอรี่ในมิเตอร์) กับอุปกรณ์ที่ใช้กำลัง
 *   กำลังสุทธิของอุปกรณ์ = Σ กำลังของ element ภายใน − Σ กำลังที่แหล่งภายในจำลองจ่าย (เช่น แหล่งอ้างอิงของไอซีคงแรงดัน) = กำลังที่ไหลเข้าทางขาทั้งหมด
 *   PowerLog สะสมพลังงาน (J) ตามเวลาจำลอง
 * ไม่รวม: ไฟเลี้ยงของบอร์ด/ชิปไมโครคอนโทรลเลอร์เอง, ความสูญเสียภายในแหล่งจ่าย (ความต้านทานภายใน)
 */
import type { CircuitDoc, Part } from '../model/types';
import type { NetlistElement } from '../sim/netlist';
import type { SimResult } from '../sim/solver';
import { GPIO_ILIM, mcuRails } from '../mcu/rails';
import { UNO_DIGITAL, MEGA_DIGITAL, rp2Pins } from '../model/catalog';

export interface PowerChunk {
  /** ช่วงเวลาจำลองที่เฉลี่ย (s) — 0 = ค่าขณะหนึ่ง */
  dt: number;
  /** กำลังเฉลี่ย (W) และกระแสเฉลี่ย (A) ตาม id ของ element */
  p: Record<string, number>;
  i: Record<string, number>;
  /** แรงดันเฉลี่ย (V) */
  v: Record<string, number>;
}

export class PowerAcc {
  private tPrev: number | null = null;
  private last: { p: Map<string, number>; i: Map<string, number>; v: Map<string, number> } | null = null;
  private sp = new Map<string, number>();
  private si = new Map<string, number>();
  private sv = new Map<string, number>();
  private T = 0;

  reset() { this.tPrev = null; this.last = null; this.sp.clear(); this.si.clear(); this.sv.clear(); this.T = 0; }

  feed(t: number, r: SimResult) {
    if (!r.ok) return;
    if (this.tPrev !== null && t < this.tPrev) this.reset();
    if (this.tPrev !== null && this.last && t > this.tPrev) {
      const dt = t - this.tPrev;
      for (const [k, x] of this.last.p) this.sp.set(k, (this.sp.get(k) ?? 0) + x * dt);
      for (const [k, x] of this.last.i) this.si.set(k, (this.si.get(k) ?? 0) + x * dt);
      for (const [k, x] of this.last.v) this.sv.set(k, (this.sv.get(k) ?? 0) + x * dt);
      this.T += dt;
    }
    this.tPrev = t;
    const p = new Map<string, number>(), i = new Map<string, number>(), v = new Map<string, number>();
    for (const e of Object.values(r.elements)) { p.set(e.id, e.power); i.set(e.id, e.current); v.set(e.id, e.voltage); }
    this.last = { p, i, v };
  }

  /** ค่าเฉลี่ยตั้งแต่ครั้งก่อน (ไม่มีช่วงเวลา = ค่าล่าสุด) แล้วเริ่มนับใหม่ */
  take(): PowerChunk | undefined {
    if (!this.last) return undefined;
    const T = this.T;
    const avg = (s: Map<string, number>, l: Map<string, number>) => Object.fromEntries([...l.keys()].map((k) => [k, T > 0 ? (s.get(k) ?? 0) / T : l.get(k)!]));
    const out: PowerChunk = { dt: T, p: avg(this.sp, this.last.p), i: avg(this.si, this.last.i), v: avg(this.sv, this.last.v) };
    this.sp.clear(); this.si.clear(); this.sv.clear(); this.T = 0;
    return out;
  }
}

/** ค่าขณะหนึ่งจากผลคำนวณ (วงจร DC ที่ไม่มีเวลา) */
export function chunkOf(r: SimResult): PowerChunk {
  const p: Record<string, number> = {}, i: Record<string, number> = {}, v: Record<string, number> = {};
  for (const e of Object.values(r.elements)) { p[e.id] = e.power; i[e.id] = e.current; v[e.id] = e.voltage; }
  return { dt: 0, p, i, v };
}

export interface PowerRow {
  key: string;
  partId: string;
  label: string;
  /** แรงดัน (V) และกระแส (A) — มีเฉพาะแหล่งจ่าย */
  v?: number;
  i?: number;
  /** กำลัง (W): แหล่ง = จ่ายออก, อุปกรณ์ = ใช้ */
  p: number;
  /** กระแสสูงสุดของแหล่ง (A) */
  ilim?: number;
  over?: boolean;
}

export interface PowerReport {
  sources: PowerRow[];
  loads: PowerRow[];
  /** กำลังรวมที่แหล่งจ่ายออก / ที่อุปกรณ์ใช้ (W) */
  pIn: number;
  pOut: number;
  dt: number;
}

const MCU = new Set<Part['kind']>(['uno', 'nano', 'unoq', 'mega', 'promini', 'pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5']);
const RAIL_NAMES = new Set(['5V', '3V3', 'VBUS', 'VSYS', 'ADC_VREF', 'VCC']);

function pinName(part: Part, i: number): string {
  if (part.kind === 'mega') return MEGA_DIGITAL[i] ?? `ขา ${i}`;
  if (part.kind === 'uno' || part.kind === 'nano' || part.kind === 'unoq' || part.kind === 'promini') return UNO_DIGITAL[i] ?? `ขา ${i}`;
  if (part.kind === 'rpi5') return `GPIO${i}`;
  if (part.kind === 'xiao' || part.kind === 'nanoconnect' || part.kind === 'esp32devkitc') { const d = rp2Pins(part.kind).find(([, g]) => g === i); return d ? `${d[0]} (GPIO${i})` : `GPIO${i}`; }
  return `GP${i}`;
}

/** ขนาดที่ถือว่าเป็นศูนย์ (ตัดเศษจากการคำนวณ) */
const EPS = 1e-7;

export function powerReport(doc: CircuitDoc, elements: NetlistElement[], chunk: PowerChunk, overRated: (partId: string) => boolean = () => false): PowerReport {
  const types = new Map(elements.map((e) => [e.id, e]));
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  const sources: PowerRow[] = [];
  const loadByPart = new Map<string, number>();
  const sinkRows: PowerRow[] = [];
  for (const [id, p] of Object.entries(chunk.p)) {
    const [owner, sub] = id.split('#');
    const part = parts.get(owner);
    if (!part) continue;
    const el = types.get(id);
    let ext: { label: string; ilim?: number } | null = null;
    if (MCU.has(part.kind) && sub !== undefined) {
      const kind = part.kind === 'nano' || part.kind === 'unoq' || part.kind === 'mega' || part.kind === 'promini' ? 'uno' : part.kind === 'picow' || part.kind === 'xiao' || part.kind === 'nanoconnect' || part.kind === 'esp32devkitc' ? 'pico' : (part.kind as 'uno' | 'pico' | 'rpi5');
      const m = /^GP(\d+)$/.exec(sub);
      if (m) ext = { label: `${part.label} ขา ${pinName(part, Number(m[1]))}`, ilim: GPIO_ILIM[part.kind === 'unoq' ? 'unoq' : kind] };
      else if (RAIL_NAMES.has(sub)) ext = { label: `${part.label} ขา ${part.kind === 'xiao' && sub === 'VBUS' ? '5V' : part.kind === 'nanoconnect' && sub === 'VBUS' ? 'VUSB' : part.kind === 'esp32devkitc' && sub === 'VBUS' ? '5V' : sub}`, ilim: mcuRails(kind, part.kind === 'nano' || part.kind === 'unoq' || part.kind === 'nanoconnect' ? part.kind : part.kind === 'esp32devkitc' ? 'esp32' : part.kind === 'promini' ? (part.params.volt === 3.3 ? 'promini3' : 'promini') : undefined, part.kind === 'unoq' ? part.params.usbLimit : undefined).find((r) => r[0] === sub)?.[3] };
    } else if (el?.type === 'SUPPLY' && part.kind === 'dcsupply') ext = { label: `${part.label} (แหล่งจ่าย DC)`, ilim: el.Ilim };
    else if (el?.type === 'SUPPLY' && part.kind === 'dcadapter') ext = { label: `${part.label} (อะแดปเตอร์ ${part.params.voltage} V)`, ilim: el.Ilim };
    else if (el?.type === 'FGEN') ext = { label: `${part.label} (เครื่องกำเนิดสัญญาณ)` };
    else if (el?.type === 'SUPPLY' && (part.kind === 'dmm' || part.kind === 'vom') && sub === 'm') ext = { label: `${part.label} (แบตเตอรี่ย่านวัดโอห์ม)`, ilim: el.Ilim };
    if (ext) {
      const i = chunk.i[id] ?? 0, v = chunk.v[id] ?? 0;
      if (p > EPS) sources.push({ key: id, partId: owner, label: ext.label, v, i, p, ilim: ext.ilim, over: ext.ilim !== undefined && Math.abs(i) > ext.ilim * 0.999 });
      else if (p < -EPS) sinkRows.push({ key: id, partId: owner, label: `${ext.label} (รับกระแสเข้า)`, p: -p });
      continue;
    }
    // แหล่งภายในของแบบจำลองอุปกรณ์ (เช่น แหล่งอ้างอิง) จ่ายกำลังให้ element อื่นของอุปกรณ์เดียวกัน — หักออก ได้กำลังสุทธิที่เข้าทางขา
    const internalSource = el?.type === 'SUPPLY' || el?.type === 'FGEN' || (!el && sub !== undefined && /^out$/.test(sub));
    loadByPart.set(owner, (loadByPart.get(owner) ?? 0) + (internalSource ? -p : p));
  }
  const loads: PowerRow[] = [...sinkRows];
  for (const [owner, p] of loadByPart) {
    if (Math.abs(p) <= EPS) continue;
    const part = parts.get(owner)!;
    loads.push({ key: owner, partId: owner, label: part.label, p, over: overRated(owner) });
  }
  sources.sort((a, b) => b.p - a.p);
  loads.sort((a, b) => b.p - a.p);
  // แถวที่เล็กมาก (< 1 µW เช่น กระแสจากตัวดึงขึ้นเข้าขา LOW) รวมเป็นแถวเดียว — ยังนับในผลรวม
  const tiny = loads.filter((r) => Math.abs(r.p) < 1e-6);
  if (tiny.length > 1) {
    const keep = loads.filter((r) => Math.abs(r.p) >= 1e-6);
    loads.length = 0;
    loads.push(...keep);
    loads.push({ key: '#tiny', partId: '', label: `อื่น ๆ ${tiny.length} รายการ (แต่ละรายการ < 1 µW)`, p: tiny.reduce((a, r) => a + r.p, 0) });
  }
  const pIn = sources.reduce((a, r) => a + r.p, 0), pOut = loads.reduce((a, r) => a + r.p, 0);
  return { sources, loads, pIn, pOut, dt: chunk.dt };
}

/** สะสมพลังงานตามเวลาจำลอง (ฝั่งแอป) */
export class PowerLog {
  /** พลังงานที่แหล่งจ่ายออกรวม (J) และตามแถว (key) */
  eIn = 0;
  rows = new Map<string, number>();
  T = 0;
  /** ประวัติ [เวลาจำลอง, กำลังจ่ายรวม] */
  hist: Array<[number, number]> = [];
  last: PowerReport | null = null;
  peak = 0;

  reset() { this.eIn = 0; this.rows.clear(); this.T = 0; this.hist = []; this.last = null; this.peak = 0; }

  push(rep: PowerReport, t: number) {
    this.last = rep;
    if (rep.dt > 0) {
      this.eIn += rep.pIn * rep.dt;
      this.T += rep.dt;
      for (const r of [...rep.sources, ...rep.loads]) this.rows.set(r.key, (this.rows.get(r.key) ?? 0) + r.p * rep.dt);
      this.hist.push([t, rep.pIn]);
      if (this.hist.length > 600) this.hist.splice(0, this.hist.length - 600);
    }
    this.peak = Math.max(this.peak, rep.pIn);
  }

  /** กำลังเฉลี่ยตั้งแต่เริ่ม (W) */
  get avgIn() { return this.T > 0 ? this.eIn / this.T : this.last?.pIn ?? 0; }
}
