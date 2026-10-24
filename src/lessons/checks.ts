import { netOfPin, netOfTerminal } from '../connectivity/connectivity';
import { holeInfo } from '../model/breadboard';
import { lm35Vout, lm317Vout, ntcResistance, ntcTemperature, pinDefs, CD4017_OUTS, LOGIC_FUNC, SEG_NAMES, SEG_PINS, ldrResistance, logicGates } from '../model/catalog';
import type { Analysis } from '../instruments/measure';
import type { BuiltNetlist } from '../sim/netlist';
import type { SimResult } from '../sim/solver';
import type { AmmeterPart, CapacitorPart, CircuitDoc, DcSupplyPart, LedPart, ResistorPart, StudentWork } from '../model/types';
import type { DataLogger } from '../instruments/logger';
import type { ChannelMeasure } from '../instruments/scope';
import { bodeAt, fmtHz, measureBode, slopeDbPerDecade, type BodeData } from '../instruments/bode';
import type { StepperPart, OptoPart, ShiftRegPart, SonarPart, HbridgePart, Lm35Part, CounterPart, LogicPart, BjtPart, BuzzerPart, LdrPart, RelayPart, Timer555Part, VregPart, TransformerPart, ServoPart, MotorPart, SevenSegPart, DiodePart, MosfetPart, PotentiometerPart, PushbuttonPart, FgenPart, OpampPart, PicoPart, ScopePart, SwitchPart } from '../model/types';
import { PICO_GPIO, HC595_OUTS, STEPPER_INPUTS, vomPosition } from '../model/catalog';
import type { DmmPart, VomPart, ScrPart, Lm317Part, NtcPart, ComparatorPart, DarlingtonPart, Lm386Part, SpeakerPart } from '../model/types';
import { buildNetlist } from '../sim/netlist';
import { solveDC } from '../sim/solver';

/**
 * ตัวตรวจผลแลป (เฉลย) — ตรวจจาก "การเชื่อมต่อจริง" และ "ค่าทางไฟฟ้าตาม tolerance"
 * ไม่ตรวจตำแหน่ง สี หรือรูปแบบการวางให้เหมือนตัวอย่าง
 */

export const LESSON_TOL = 0.02;

export interface CheckContext {
  doc: CircuitDoc;
  built: BuiltNetlist;
  result: SimResult;
  analysis: Analysis;
  work: StudentWork;
  /** กราฟบันทึกค่า (เฉพาะการจำลองตามเวลา) */
  logger?: DataLogger | null;
  /** เวลาจำลองปัจจุบัน (s) */
  time?: number;
  /** ค่าที่ออสซิลโลสโคปวัดได้ (CH1, CH2) */
  scopeMeasure?: [ChannelMeasure | null, ChannelMeasure | null] | null;
  /** กราฟโบดล่าสุดที่คำนวณจากวงจรนี้ (null = ยังไม่มี/ล้าสมัย) */
  bode?: BodeData | null;
}

export interface GoalStatus {
  pass: boolean;
  detail?: string;
}

const near = (a: number, b: number, tol = LESSON_TOL) => Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-12);

class Ctx {
  constructor(public c: CheckContext) {}
  get conn() { return this.c.built.connectivity; }
  net(partId: string, pin: string) { return netOfPin(this.conn, partId, pin)!; }
  supplies() { return this.c.doc.parts.filter((p): p is DcSupplyPart => p.kind === 'dcsupply' && p.params.outputOn); }
  resistors() { return this.c.doc.parts.filter((p): p is ResistorPart => p.kind === 'resistor'); }
  ammeters() { return this.c.doc.parts.filter((p): p is AmmeterPart => p.kind === 'ammeter'); }
  leds() { return this.c.doc.parts.filter((p): p is LedPart => p.kind === 'led'); }
  caps() { return this.c.doc.parts.filter((p): p is CapacitorPart => p.kind === 'capacitor'); }
  I(id: string) { return this.c.analysis.parts[id]?.current ?? 0; }
  V(id: string) { return this.c.analysis.parts[id]?.voltage ?? 0; }
  resNets(r: ResistorPart) { return [this.net(r.id, '1'), this.net(r.id, '2')]; }
  /** จำนวนขาอุปกรณ์ทั้งหมดในเน็ต */
  pinsOn(net: number) { return this.conn.nets[net].partPins.length; }
  /** ammeter ที่วัดกระแสเท่ากับกระแสที่ให้ (ต่ออนุกรมในเส้นทางเดียวกัน) */
  meterFor(current: number) {
    return this.ammeters().find((a) => Math.abs(this.I(a.id)) > 1e-6 && near(Math.abs(this.I(a.id)), Math.abs(current), 0.01));
  }
  /** หาคู่ตัวต้านทานที่ต่ออนุกรม (ขาร่วมกันหนึ่งเน็ต ซึ่งมีแค่สองขานี้) */
  seriesPairs(): Array<[ResistorPart, ResistorPart, number, number, number]> {
    const rs = this.resistors();
    const out: Array<[ResistorPart, ResistorPart, number, number, number]> = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = this.resNets(rs[i]), b = this.resNets(rs[j]);
      const shared = a.filter((n) => b.includes(n));
      if (shared.length !== 1) continue;
      const mid = shared[0];
      if (this.pinsOn(mid) !== 2) continue;
      const endA = a.find((n) => n !== mid)!, endB = b.find((n) => n !== mid)!;
      out.push([rs[i], rs[j], mid, endA, endB]);
    }
    return out;
  }
  parallelPairs(): Array<[ResistorPart, ResistorPart]> {
    const rs = this.resistors();
    const out: Array<[ResistorPart, ResistorPart]> = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = this.resNets(rs[i]).sort(), b = this.resNets(rs[j]).sort();
      if (a[0] !== a[1] && a[0] === b[0] && a[1] === b[1]) out.push([rs[i], rs[j]]);
    }
    return out;
  }
  probeNets() {
    const p = this.c.doc.probes;
    return { red: p.red ? netOfTerminal(this.conn, p.red) : undefined, black: p.black ? netOfTerminal(this.conn, p.black) : undefined };
  }
}

type Checker = (x: Ctx) => Record<string, GoalStatus>;

const NOT_RUN: GoalStatus = { pass: false, detail: 'กด Run เพื่อให้ตรวจผลได้' };

export const CHECKERS: Record<string, Checker> = {
  breadboard(x) {
    const out: Record<string, GoalStatus> = { rails: { pass: false }, measureRail: { pass: false }, groove: { pass: false } };
    const railGroups = (net: number) => x.conn.nets[net].groups.filter((g) => g.startsWith('rail-'));
    for (const s of x.supplies()) {
      const rp = railGroups(x.net(s.id, 'pos')), rn = railGroups(x.net(s.id, 'neg'));
      if (rp.length && rn.length && x.net(s.id, 'pos') !== x.net(s.id, 'neg')) out.rails = { pass: true };
      const vSet = s.params.voltage;
      const { red, black } = x.probeNets();
      const pr = x.c.doc.probes;
      const onRail = (t: typeof pr.red) => !!t && t.kind === 'hole' && /^(tp|tn|bp|bn)/.test(t.hole);
      const v = x.c.analysis.probe.value;
      if (onRail(pr.red) && onRail(pr.black) && v !== null && near(Math.abs(v), vSet)) out.measureRail = { pass: true };
      else if (onRail(pr.red) && onRail(pr.black)) out.measureRail = { pass: false, detail: 'โพรบอยู่บนรางไฟแล้ว แต่ค่ายังไม่เท่าแรงดันจ่าย' };
      // ร่องกลาง: โพรบแดงที่ f–j ของคอลัมน์ที่ a–e ต่อกับ +
      if (pr.red && pr.red.kind === 'hole' && red !== undefined) {
        const info = holeInfo(pr.red.hole);
        const m = info && /^col(\d+)-bot$/.exec(info.group);
        if (m) {
          const topNet = netOfTerminal(x.conn, { kind: 'hole', boardId: pr.red.boardId, hole: `a${m[1]}` });
          if (topNet === x.net(s.id, 'pos') && red !== topNet && (v === null || Math.abs(v) < 0.01 * vSet || black === undefined)) {
            out.groove = { pass: true };
          }
        }
      }
    }
    return out;
  },

  ohm(x) {
    const out: Record<string, GoalStatus> = { series: { pass: false }, ohm: { pass: false }, three: { pass: false } };
    for (const r of x.resistors()) {
      const I = x.I(r.id);
      const m = x.meterFor(I);
      if (!m) continue;
      out.series = { pass: true };
      const s = x.supplies()[0];
      if (s) {
        const expected = s.params.voltage / (r.params.resistance + m.params.shuntResistance + s.params.internalResistance);
        if (near(Math.abs(x.I(m.id)), expected)) out.ohm = { pass: true };
        else out.ohm = { pass: false, detail: `คาดว่า ${(expected * 1000).toFixed(2)} mA ตามวงจร แหล่งจ่าย–มิเตอร์–R อนุกรม แต่ได้ ${(Math.abs(x.I(m.id)) * 1000).toFixed(2)} mA` };
      }
    }
    const rec = x.c.work.records['ohm'] ?? {};
    const filled = ['i1', 'i2', 'i3'].filter((k) => rec[k]?.sim?.trim()).length;
    out.three = { pass: filled >= 3, detail: `บันทึกแล้ว ${filled}/3` };
    return out;
  },

  'series-parallel'(x) {
    const out: Record<string, GoalStatus> = { series: { pass: false }, parallel: { pass: false } };
    const s = x.supplies()[0];
    if (!s) return out;
    for (const [a, b] of x.seriesPairs()) {
      const m = x.meterFor(x.I(a.id));
      if (!m || !near(x.I(a.id), x.I(b.id), 0.01)) continue;
      const expected = s.params.voltage / (a.params.resistance + b.params.resistance + m.params.shuntResistance + s.params.internalResistance);
      if (near(Math.abs(x.I(m.id)), expected)) out.series = { pass: true };
    }
    for (const [a, b] of x.parallelPairs()) {
      const total = x.I(a.id) + x.I(b.id);
      const m = x.meterFor(total);
      if (!m) continue;
      const rp = 1 / (1 / a.params.resistance + 1 / b.params.resistance);
      const expected = s.params.voltage / (rp + m.params.shuntResistance + s.params.internalResistance);
      if (near(Math.abs(x.I(m.id)), expected)) out.parallel = { pass: true };
    }
    return out;
  },

  divider(x) {
    const out: Record<string, GoalStatus> = { series: { pass: false }, measure: { pass: false }, design: { pass: false } };
    const { red, black } = x.probeNets();
    const v = x.c.analysis.probe.value;
    for (const s of x.supplies()) {
      const sp = x.net(s.id, 'pos'), sn = x.net(s.id, 'neg');
      for (const [a, b, mid, ea, eb] of x.seriesPairs()) {
        const ends = [ea, eb].sort().join();
        if (ends !== [sp, sn].sort().join()) continue;
        out.series = { pass: true };
        if (v === null || red === undefined || black === undefined) continue;
        const vin = x.V(s.id);
        for (const [r, end] of [[a, ea], [b, eb]] as const) {
          const across = [mid, end].sort().join() === [red, black].sort().join();
          if (!across) continue;
          const other = r === a ? b : a;
          const expected = (vin * r.params.resistance) / (r.params.resistance + other.params.resistance);
          if (near(Math.abs(v), expected)) out.measure = { pass: true };
          if (near(s.params.voltage, 5, 0.001) && near(Math.abs(v), 3.3, 0.03)) out.design = { pass: true };
        }
      }
    }
    return out;
  },

  led(x) {
    const out: Record<string, GoalStatus> = { forward: { pass: false }, resistor: { pass: false }, meter: { pass: false }, reverse: { pass: false } };
    for (const led of x.leds()) {
      const I = x.I(led.id);
      const reading = x.c.analysis.parts[led.id];
      if (I >= 0.005 && I <= 0.02 && !reading?.overRated) out.forward = { pass: true };
      else if (I > 0.02) out.forward = { pass: false, detail: `กระแส ${(I * 1000).toFixed(1)} mA สูงเกินไป` };
      else if (I > 1e-6 && I < 0.005) out.forward = { pass: false, detail: `กระแส ${(I * 1000).toFixed(2)} mA ต่ำเกินไป` };
      if (I > 1e-4 && x.resistors().some((r) => near(Math.abs(x.I(r.id)), I, 0.01))) out.resistor = { pass: true };
      if (I > 1e-3 && x.meterFor(I)) out.meter = { pass: true };
      if (x.V(led.id) < -1 && Math.abs(I) < 1e-6) out.reverse = { pass: true };
    }
    return out;
  },
};

/**
 * วัดค่าคงที่เวลาจากกราฟบันทึกค่า: เวลาที่แรงดันโพรบข้าม 63.2% ของแรงดันจ่าย
 * ใช้ได้เมื่อกราฟเริ่มเก็บตั้งแต่ t = 0 (หลังกด Run หรือ "เริ่มใหม่") และโพรบอยู่บนช่องแรก
 */
export function measuredTau(logger: DataLogger | null | undefined, vSupply: number): number | null {
  if (!logger || !logger.fromZero || !logger.channels.length || logger.channels[0].unit !== 'V') return null;
  const d = logger.data[0];
  const sign = d.find((v) => v !== null && Math.abs(v) > 0.05 * vSupply) ?? 1;
  return logger.crossing(0, Math.sign(sign as number) * 0.632 * vSupply);
}

CHECKERS['rc'] = (x) => {
  const out: Record<string, GoalStatus> = { series: { pass: false }, tau: { pass: false }, full: { pass: false }, discharge: { pass: false } };
  const { red, black } = x.probeNets();
  for (const s of x.supplies()) {
    const sp = x.net(s.id, 'pos'), sn = x.net(s.id, 'neg');
    for (const c of x.caps()) {
      const cn = [x.net(c.id, 'P'), x.net(c.id, 'N')];
      for (const r of x.resistors()) {
        const rn = x.resNets(r);
        const shared = cn.filter((n) => rn.includes(n));
        if (shared.length !== 1 || x.pinsOn(shared[0]) !== 2) continue;
        const cEnd = cn.find((n) => n !== shared[0])!, rEnd = rn.find((n) => n !== shared[0])!;
        const ends = [cEnd, rEnd].sort().join();
        // ยอมให้มีแอมมิเตอร์คั่นระหว่างแหล่งจ่ายกับวงจร: ตรวจผ่านกระแสที่เท่ากันแทนการเชื่อมตรง
        const direct = ends === [sp, sn].sort().join();
        const viaMeter = !direct && x.ammeters().some((m) => [x.net(m.id, 'A'), x.net(m.id, 'COM')].some((n) => n === cEnd || n === rEnd));
        if (!direct && !viaMeter) continue;
        const probeAcross = red !== undefined && black !== undefined && [red, black].sort().join() === [...cn].sort().join();
        if (!probeAcross) { out.series = { pass: false, detail: 'ต่อ R–C ถูกแล้ว ให้วางโพรบคร่อมตัวเก็บประจุ' }; continue; }
        out.series = { pass: true };
        const shunt = x.ammeters().reduce((acc, m) => acc + (viaMeter ? m.params.shuntResistance : 0), 0);
        const tau = (r.params.resistance + shunt + s.params.internalResistance) * c.params.capacitance;
        const t63 = measuredTau(x.c.logger, s.params.voltage);
        if (t63 !== null && near(t63, tau, 0.05)) out.tau = { pass: true };
        else if (t63 !== null) out.tau = { pass: false, detail: `วัดได้ ${(t63 * 1000).toFixed(1)} ms แต่ R·C = ${(tau * 1000).toFixed(1)} ms — ตรวจว่าเริ่มจากตัวเก็บประจุว่าง (กด "เริ่มใหม่")` };
        else out.tau = { pass: false, detail: 'กด "เริ่มใหม่" ให้ตัวเก็บประจุเริ่มจาก 0 V แล้วรอให้แรงดันเกิน 63%' };
        const v = Math.abs(x.V(c.id));
        if ((x.c.time ?? 0) >= 5 * tau && v >= 0.99 * Math.abs(x.V(s.id))) out.full = { pass: true };
      }
    }
  }
  for (const c of x.caps()) {
    if (x.V(c.id) > 0.5 && x.I(c.id) < -1e-6) out.discharge = { pass: true };
  }
  return out;
};

CHECKERS['scope'] = (x) => {
  const out: Record<string, GoalStatus> = { connect: { pass: false }, measure: { pass: false }, filter: { pass: false }, ratio: { pass: false }, cutoff: { pass: false } };
  const fg = x.c.doc.parts.find((p): p is FgenPart => p.kind === 'fgen' && p.params.outputOn);
  const sc = x.c.doc.parts.find((p): p is ScopePart => p.kind === 'scope');
  if (!fg || !sc) return out;
  const OUT = x.net(fg.id, 'OUT'), COM = x.net(fg.id, 'COM');
  const CH1 = x.net(sc.id, 'CH1'), CH2 = x.net(sc.id, 'CH2'), GND = x.net(sc.id, 'GND');
  if (GND !== COM) { out.connect = { pass: false, detail: 'ต่อ GND ของออสซิลโลสโคปเข้ากับ COM ของเครื่องกำเนิดสัญญาณ' }; return out; }
  if (CH1 !== OUT) { out.connect = { pass: false, detail: 'ต่อ CH1 เข้ากับจุดเดียวกับ OUT ของเครื่องกำเนิดสัญญาณ' }; return out; }
  out.connect = { pass: true };
  const [m1, m2] = x.c.scopeMeasure ?? [null, null];
  if (m1 && fg.params.wave !== 'dc') {
    const vOk = near(m1.vpp, fg.params.vpp, 0.05), fOk = m1.freq !== null && near(m1.freq, fg.params.frequency, 0.02);
    out.measure = vOk && fOk ? { pass: true } : { pass: false, detail: `สโคปวัดได้ ${m1.vpp.toFixed(3)} Vpp${m1.freq ? `, ${m1.freq.toFixed(1)} Hz` : ''} — รอให้เห็นอย่างน้อย 2–3 คาบบนจอ` };
  } else if (!m1) out.measure = { pass: false, detail: 'กด Run แล้วรอให้มีรูปคลื่นบนจอ' };
  // ตัวกรอง: R จาก OUT ไปจุด X, C จาก X ไป COM, CH2 ที่ X
  for (const r of x.resistors()) {
    const rn = x.resNets(r);
    if (!rn.includes(OUT)) continue;
    const X = rn.find((n) => n !== OUT)!;
    for (const c of x.caps()) {
      const cn = [x.net(c.id, 'P'), x.net(c.id, 'N')];
      if (!(cn.includes(X) && cn.includes(COM))) continue;
      if (CH2 !== X) { out.filter = { pass: false, detail: 'ต่อ R–C ถูกแล้ว ให้ต่อ CH2 ที่จุดระหว่าง R กับ C' }; continue; }
      out.filter = { pass: true };
      if (!m1 || !m2 || !(m1.vpp > 0)) continue;
      const f = fg.params.frequency, RC = r.params.resistance * c.params.capacitance;
      const theory = 1 / Math.sqrt(1 + (2 * Math.PI * f * RC) ** 2);
      const ratio = m2.vpp / m1.vpp;
      out.ratio = near(ratio, theory, 0.05) ? { pass: true } : { pass: false, detail: `วัดได้ ${ratio.toFixed(3)} ทฤษฎี ${theory.toFixed(3)} — รอให้ผ่านช่วงเริ่มต้นสักครู่ หรือกด Auto` };
      const fc = 1 / (2 * Math.PI * RC);
      if (near(f, fc, 0.1) && near(ratio, Math.SQRT1_2, 0.05)) out.cutoff = { pass: true };
    }
  }
  return out;
};

/** แรงดันของเน็ตเทียบกราวด์ของ solver (null ถ้าลอย) */
function nodeV(x: Ctx, net: number): number | null {
  const v = x.c.result.nodeVoltage[net];
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** ส่วนที่ใช้ร่วม: เครื่องกำเนิด + สโคป ต่อ CH1 = OUT, GND = COM */
function scopeOnFgen(x: Ctx) {
  const fg = x.c.doc.parts.find((p): p is FgenPart => p.kind === 'fgen' && p.params.outputOn);
  const sc = x.c.doc.parts.find((p): p is ScopePart => p.kind === 'scope');
  if (!fg || !sc) return null;
  return { fg, sc, OUT: x.net(fg.id, 'OUT'), COM: x.net(fg.id, 'COM'), CH1: x.net(sc.id, 'CH1'), CH2: x.net(sc.id, 'CH2'), GND: x.net(sc.id, 'GND') };
}

CHECKERS['rectifier'] = (x) => {
  const out: Record<string, GoalStatus> = { connect: { pass: false }, circuit: { pass: false }, halfwave: { pass: false }, filter: { pass: false } };
  const s = scopeOnFgen(x);
  if (!s) return out;
  if (s.GND !== s.COM) { out.connect = { pass: false, detail: 'ต่อ GND ของออสซิลโลสโคปเข้ากับ COM ของเครื่องกำเนิดสัญญาณ' }; return out; }
  if (s.CH1 !== s.OUT) { out.connect = { pass: false, detail: 'ต่อ CH1 เข้ากับจุดเดียวกับ OUT ของเครื่องกำเนิดสัญญาณ' }; return out; }
  out.connect = { pass: true };
  const diodes = x.c.doc.parts.filter((p): p is DiodePart => p.kind === 'diode');
  for (const d of diodes) {
    const A = x.net(d.id, 'A'), K = x.net(d.id, 'K');
    const reversed = K === s.OUT;
    if (A !== s.OUT && !reversed) continue;
    const X = reversed ? A : K;
    if (X === s.COM) continue;
    const load = x.resistors().find((r) => { const n = x.resNets(r); return n.includes(X) && n.includes(s.COM); });
    if (!load) { out.circuit = { pass: false, detail: 'ต่อตัวต้านทานโหลดจากขาไดโอดฝั่งขาออกกลับไปที่ COM' }; continue; }
    if (s.CH2 !== X) { out.circuit = { pass: false, detail: 'ต่อ CH2 คร่อมโหลด (ที่ขาไดโอดฝั่งตัวต้านทาน)' }; continue; }
    out.circuit = { pass: true };
    const [m1, m2] = x.c.scopeMeasure ?? [null, null];
    if (!m1 || !m2) { out.halfwave = { pass: false, detail: 'กด Run แล้วรอให้มีรูปคลื่นบนจอ' }; break; }
    if (reversed) { out.halfwave = { pass: false, detail: 'ได้ครึ่งคลื่นลบ — ไดโอดกลับทิศ ให้หมุนไดโอดให้ขา A อยู่ฝั่งเครื่องกำเนิด' }; break; }
    const drop = m1.vmax - m2.vmax;
    const filtered = x.caps().some((c) => { const n = [x.net(c.id, 'P'), x.net(c.id, 'N')]; return n.includes(X) && n.includes(s.COM); });
    if (m2.vmin > -0.05 && drop >= 0.3 && drop <= 1.0) out.halfwave = { pass: true };
    else if (!filtered) out.halfwave = { pass: false, detail: `ยอดขาออก ${m2.vmax.toFixed(2)} V ต่ำกว่าขาเข้า ${drop.toFixed(2)} V, ต่ำสุด ${m2.vmin.toFixed(2)} V — ใช้สัญญาณอย่างน้อยราว 4 Vpp และรอให้เห็น 2–3 คาบ` };
    if (filtered) {
      const ripple = m2.vpp;
      out.filter = m2.vmax > 0.5 && ripple < 0.2 * m2.vmax ? { pass: true } : { pass: false, detail: `ripple ${ripple.toFixed(2)} V (${((ripple / Math.max(m2.vmax, 1e-9)) * 100).toFixed(0)}% ของยอด) — รอให้ตัวเก็บประจุชาร์จจนคงตัว หรือเพิ่มค่า C` };
    }
    break;
  }
  return out;
};

CHECKERS['transistor'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, off: { pass: false }, on: { pass: false }, ib: { pass: false } };
  const s = x.supplies()[0];
  const q = x.c.doc.parts.find((p): p is BjtPart => p.kind === 'bjt' && p.params.polarity === 'npn');
  if (!s || !q) return out;
  const POS = x.net(s.id, 'pos'), NEG = x.net(s.id, 'neg');
  const E = x.net(q.id, 'E'), B = x.net(q.id, 'B'), C = x.net(q.id, 'C');
  if (E !== NEG) { out.wiring = { pass: false, detail: 'ต่อขา E ของทรานซิสเตอร์เข้ากับขั้วลบของแหล่งจ่าย (ขา E อยู่ซ้ายสุด)' }; return out; }
  if (C === POS || C === NEG) { out.wiring = { pass: false, detail: 'ขา C ต้องต่อผ่านโหลด (ตัวต้านทาน + LED) ไม่ต่อตรงเข้ารางไฟ' }; return out; }
  const rb = x.resistors().find((r) => x.resNets(r).includes(B));
  if (!rb || B === POS) { out.wiring = { pass: false, detail: 'ต่อขา B ผ่านตัวต้านทานจำกัดกระแส (เช่น 10 kΩ) — ห้ามต่อขา B ตรงเข้าแหล่งจ่าย' }; return out; }
  out.wiring = { pass: true };
  const r = x.c.analysis.parts[q.id];
  if (!r?.extra) return out;
  const ic = r.current, ib = r.extra.ib, vce = r.voltage;
  if (Math.abs(ib) < 1e-7 && Math.abs(ic) < 1e-6) out.off = { pass: true };
  else {
    const sw = x.c.doc.parts.find((p): p is SwitchPart => p.kind === 'switch');
    out.off = { pass: false, detail: sw ? 'เปิดสวิตช์ (OFF) เพื่อตัดกระแสเบส แล้วดูว่า Ic เป็นศูนย์' : 'ใช้สวิตช์ตัดกระแสเบส (หรือถอดสายเบส) เพื่อดูสภาวะคัตออฟ' };
  }
  if (ic > 1e-3 && vce < 0.3 && r.extra.region === 2) out.on = { pass: true };
  else if (ic > 1e-6) out.on = { pass: false, detail: `Vce = ${vce.toFixed(2)} V, Ic = ${(ic * 1000).toFixed(2)} mA — ยังไม่อิ่มตัว ลองลดค่า Rb เพื่อเพิ่มกระแสเบส` };
  // Ib ตามทฤษฎี: (V ที่ปลาย Rb อีกข้าง − Vbe) / Rb
  const rn = x.resNets(rb);
  const far = rn.find((n) => n !== B)!;
  const vFar = nodeV(x, far), vB = nodeV(x, B);
  if (ib > 1e-6 && vFar !== null && vB !== null) {
    const theory = (vFar - vB) / rb.params.resistance;
    out.ib = near(ib, theory, 0.05) ? { pass: true } : { pass: false, detail: `Ib = ${(ib * 1e6).toFixed(1)} µA ทฤษฎี ${(theory * 1e6).toFixed(1)} µA` };
  }
  return out;
};

CHECKERS['mosfet'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, pulldown: { pass: false }, off: { pass: false }, on: { pass: false }, vgs: { pass: false } };
  const s = x.supplies()[0];
  const q = x.c.doc.parts.find((p): p is MosfetPart => p.kind === 'mosfet' && p.params.polarity === 'n');
  if (!s || !q) return out;
  const POS = x.net(s.id, 'pos'), NEG = x.net(s.id, 'neg');
  const S = x.net(q.id, 'S'), G = x.net(q.id, 'G'), D = x.net(q.id, 'D');
  if (S !== NEG) { out.wiring = { pass: false, detail: D === NEG ? 'ต่อขา D ลงกราวด์อยู่ — สลับขา: ขา S ต้องลงขั้วลบ (ดูลำดับขาในแผงคุณสมบัติ)' : 'ต่อขา S ของมอสเฟตเข้ากับขั้วลบของแหล่งจ่าย' }; return out; }
  if (D === POS || D === NEG) { out.wiring = { pass: false, detail: 'ขา D ต้องต่อผ่านโหลด (ตัวต้านทาน + LED) ไม่ต่อตรงเข้ารางไฟ' }; return out; }
  if (G === NEG || G === S) { out.wiring = { pass: false, detail: 'ขา G ต่อตรงลงกราวด์ — มอสเฟตจะไม่มีวันนำกระแส' }; return out; }
  out.wiring = { pass: true };
  const pd = x.resistors().find((r) => { const n = x.resNets(r); return n.includes(G) && n.includes(NEG); });
  out.pulldown = pd ? { pass: true } : { pass: false, detail: 'ใส่ตัวต้านทาน pull-down (เช่น 100 kΩ) จากขา G ลงกราวด์ ไม่อย่างนั้นเมื่อปลดสวิตช์ เกตจะลอยและค้างสถานะ' };
  const r = x.c.analysis.parts[q.id];
  if (!r?.extra) return out;
  const id = r.current, vds = r.voltage, vgs = r.extra.vgs;
  if (Math.abs(id) < 1e-6 && vgs < q.params.vth) out.off = pd ? { pass: true } : { pass: false, detail: 'ต้องมี pull-down ดึงเกตลงก่อน จึงนับว่าปิดอย่างแน่นอน' };
  else if (!(id > 1e-3)) out.off = { pass: false, detail: 'ปลดสวิตช์ให้เกตถูกดึงลงกราวด์ แล้วดูว่า Id เป็นศูนย์' };
  if (id > 1e-3 && vds < 0.2 && r.extra.region === 1) out.on = { pass: true };
  else if (id > 1e-6) out.on = { pass: false, detail: `Vds = ${vds.toFixed(2)} V, Id = ${(id * 1000).toFixed(2)} mA — มอสเฟตยังเปิดไม่สุด เพิ่มแรงดันเกต หรือใช้รุ่นที่ Vth ต่ำกว่า` };
  if (id > 1e-3) out.vgs = vgs >= 2 * q.params.vth ? { pass: true } : { pass: false, detail: `Vgs = ${vgs.toFixed(2)} V ยังไม่ถึง 2×Vth (${(2 * q.params.vth).toFixed(1)} V)` };
  return out;
};

CHECKERS['slew'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, circuit: { pass: false }, scope: { pass: false }, slew: { pass: false }, bandwidth: { pass: false }, gbw: { pass: false } };
  const u = x.c.doc.parts.find((p): p is OpampPart => p.kind === 'opamp');
  const s = scopeOnFgen(x);
  if (!u) return out;
  const VP = x.net(u.id, 'V+'), VN = x.net(u.id, 'V-'), INP = x.net(u.id, 'IN+'), INN = x.net(u.id, 'IN-'), O = x.net(u.id, 'OUT');
  const GND = s ? s.COM : -1;
  const vp = nodeV(x, VP), vn = nodeV(x, VN), vg = GND >= 0 ? nodeV(x, GND) : null;
  if (vp === null || vn === null || vg === null) out.power = { pass: false, detail: 'ต่อไฟเลี้ยงที่ขา 7 (V+) และขา 4 (V−) และวางเครื่องกำเนิดสัญญาณ' };
  else if (vp - vg > 3 && vg - vn > 3 && vp - vn <= u.params.maxSupply) out.power = { pass: true };
  else out.power = { pass: false, detail: `V+ = ${(vp - vg).toFixed(2)} V, V− = ${(vn - vg).toFixed(2)} V เทียบกราวด์ — ใช้ไฟเลี้ยงคู่ ±12 V` };
  if (!s) { out.circuit = { pass: false, detail: 'วางเครื่องกำเนิดสัญญาณและออสซิลโลสโคป' }; return out; }
  // วงจรไม่กลับเฟส: สัญญาณเข้า IN+, ป้อนกลับ OUT → IN− ตรง (ตามแรงดัน, ×1) หรือผ่าน Rf กับ Rg ลงกราวด์ (×(1 + Rf/Rg))
  let gainTheory: number | null = null;
  if (INP !== s.OUT) out.circuit = { pass: false, detail: 'ต่อ OUT ของเครื่องกำเนิดสัญญาณเข้าขา 3 (IN+)' };
  else if (INN === O) { gainTheory = 1; out.circuit = { pass: true }; }
  else {
    const rf = x.resistors().find((rr) => { const n = x.resNets(rr); return n.includes(O) && n.includes(INN); });
    const rg = x.resistors().find((rr) => { const n = x.resNets(rr); return rr !== rf && n.includes(INN) && n.includes(s.COM); });
    if (!rf) out.circuit = { pass: false, detail: 'ต่อขา 6 (OUT) กลับเข้าขา 2 (IN−) ด้วยสาย (ตามแรงดัน) หรือผ่าน Rf' };
    else if (!rg) out.circuit = { pass: false, detail: 'มี Rf แล้ว ต่อ Rg จากขา 2 (IN−) ลงกราวด์ เพื่อให้อัตราขยาย 1 + Rf/Rg' };
    else { gainTheory = 1 + rf.params.resistance / rg.params.resistance; out.circuit = { pass: true }; }
  }
  if (s.GND !== s.COM) out.scope = { pass: false, detail: 'ต่อ GND ของสโคปเข้ากราวด์' };
  else if (s.CH1 !== s.OUT) out.scope = { pass: false, detail: 'ต่อ CH1 ที่ OUT ของเครื่องกำเนิด' };
  else if (s.CH2 !== O) out.scope = { pass: false, detail: 'ต่อ CH2 ที่ขา 6 (OUT) ของออปแอมป์' };
  else out.scope = { pass: true };
  if (!out.circuit.pass || !out.power.pass) return out;
  // slew rate: คลื่นสี่เหลี่ยมขนาดใหญ่ — วัดความชันขาขึ้น 10–90% ของ CH2 เทียบค่าในดาต้าชีต
  const [m1, m2] = x.c.scopeMeasure ?? [null, null];
  const SR = u.params.slewRate;
  if (out.scope.pass) {
    if (s.fg.params.wave !== 'square') out.slew = { pass: false, detail: 'ตั้งเครื่องกำเนิดเป็นคลื่นสี่เหลี่ยม' };
    else if (!m2 || m2.slew === null) out.slew = { pass: false, detail: 'ปรับเวลา/ช่องให้เห็นขอบขาขึ้นเต็มขอบบนจอ (เช่น 10 µs/div) แล้วรอให้รูปคลื่นนิ่ง' };
    else if (m2.vpp < 4) out.slew = { pass: false, detail: `ขาออก ${m2.vpp.toFixed(2)} Vpp เล็กเกินไป — สัญญาณเล็กจะถูกจำกัดด้วยแบนด์วิดท์ ไม่ใช่ slew rate เพิ่มเป็นอย่างน้อย 4 Vpp ที่ขาออก` };
    else if (near(m2.slew, SR, 0.15) && (m1?.slew ?? Infinity) > 3 * m2.slew) out.slew = { pass: true };
    else out.slew = { pass: false, detail: `ความชันขาออก ${(m2.slew / 1e6).toFixed(2)} V/µs ค่าในดาต้าชีต ${(SR / 1e6).toFixed(2)} V/µs — ตรวจว่าขาออกไม่อิ่มตัวและเห็นขอบเต็มบนจอ` };
  }
  // แบนด์วิดท์จากกราฟโบด: f(−3 dB) × อัตราขยาย ≈ GBW
  const d = x.c.bode ?? null;
  if (!out.scope.pass) return out;
  if (!d || !d.ok) { out.bandwidth = { pass: false, detail: d?.error ?? 'เปิดแท็บ "กราฟโบด" ขณะ Run เพื่อคำนวณกราฟ' }; return out; }
  const m = measureBode(d);
  const fExp = gainTheory ? u.params.gbw / gainTheory : null;
  if (!m || m.fHigh === null) { out.bandwidth = { pass: false, detail: `กราฟยังไม่ตกถึง −3 dB — ตั้งความถี่สิ้นสุดของ sweep ให้สูงกว่า ${fExp ? fmtHz(fExp * 3) : '1 MHz'}` }; return out; }
  const gMid = Math.pow(10, m.peakDb / 20);
  out.bandwidth = gainTheory !== null && near(gMid, gainTheory, 0.05) ? { pass: true } : { pass: false, detail: `อัตราขยายช่วงความถี่ต่ำ ${gMid.toFixed(2)} เท่า ทฤษฎี ${gainTheory?.toFixed(2)} เท่า` };
  if (out.bandwidth.pass && gainTheory! >= 5) {
    const prod = m.fHigh * gMid;
    out.gbw = near(prod, u.params.gbw, 0.15) ? { pass: true } : { pass: false, detail: `f(−3 dB) × อัตราขยาย = ${fmtHz(prod)} — GBW ในดาต้าชีต ${fmtHz(u.params.gbw)}` };
  } else if (out.bandwidth.pass) out.gbw = { pass: false, detail: 'เปลี่ยนเป็นวงขยายไม่กลับเฟสอัตราขยายอย่างน้อย 5 เท่า (เช่น Rf 10 kΩ, Rg 1 kΩ = ×11) แล้วดู f(−3 dB) อีกครั้ง' };
  return out;
};

CHECKERS['pot'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, probe: { pass: false }, linear: { pass: false }, sweep: { pass: false }, load: { pass: false } };
  const s = x.supplies()[0];
  const vr = x.c.doc.parts.find((p): p is PotentiometerPart => p.kind === 'potentiometer');
  if (!s || !vr) return out;
  const POS = x.net(s.id, 'pos'), NEG = x.net(s.id, 'neg');
  const n1 = x.net(vr.id, '1'), nw = x.net(vr.id, '2'), n3 = x.net(vr.id, '3');
  const top = n1 === POS && n3 === NEG ? '1' : n3 === POS && n1 === NEG ? '3' : null;
  if (!top) { out.wiring = { pass: false, detail: nw === POS || nw === NEG ? 'ขากลาง (ขา 2) คือแกนกลาง — ต่อขาปลาย 1 และ 3 คร่อมแหล่งจ่าย แล้ววัดแรงดันที่ขา 2' : 'ต่อขา 1 เข้าขั้วบวก และขา 3 เข้าขั้วลบ (หรือสลับกัน)' }; return out; }
  if (nw === POS || nw === NEG) { out.wiring = { pass: false, detail: 'ขาแกนกลางต่อตรงเข้ารางไฟ — ถอดออก (หมุนจนสุดจะลัดวงจรผ่านส่วนเล็ก ๆ ของ VR)' }; return out; }
  out.wiring = { pass: true };
  const { red, black } = x.probeNets();
  const v = x.c.analysis.probe.value;
  if (red === nw && black === NEG && v !== null) out.probe = { pass: true };
  else { out.probe = { pass: false, detail: 'วางโพรบแดงที่ขา 2 (แกนกลาง) และโพรบดำที่ขั้วลบ' }; return out; }
  const r = x.c.analysis.parts[vr.id];
  const vs = r?.extra?.v13;
  if (!vs) return out;
  const { resistance: R, position: p, endResistance: re } = vr.params;
  const lower = top === '1' ? R * (1 - p) + re : R * p + re; // ส่วนระหว่างแกนกลางกับขั้วลบ
  const upper = R + 2 * re - lower;
  const vsAbs = Math.abs(vs);
  // โหลดที่ขาแกนกลาง = ตัวต้านทานจากขา 2 ลงขั้วลบ
  const load = x.resistors().find((rr) => { const n = x.resNets(rr); return n.includes(nw) && n.includes(NEG); });
  const others = x.conn.nets[nw].partPins.filter((pp) => pp.partId !== vr.id && pp.partId !== load?.id).length;
  const ach = x.c.work.achieved?.['pot'] ?? {};
  if (!load && others === 0) {
    const theory = (vsAbs * lower) / (R + 2 * re);
    if (near(v, theory, 0.02) || Math.abs(v - theory) < 0.005) {
      out.linear = { pass: true };
      const frac = lower / (R + 2 * re);
      const key = frac < 0.3 ? '_low' : frac > 0.7 ? '_high' : '_mid';
      out[key] = { pass: true };
    } else out.linear = { pass: false, detail: `วัดได้ ${v.toFixed(3)} V ทฤษฎี ${theory.toFixed(3)} V` };
    const seen = ['_low', '_mid', '_high'].filter((k) => ach[k] || out[k]?.pass);
    out.sweep = seen.length === 3 ? { pass: true } : { pass: false, detail: `หมุนให้ได้แรงดันช่วงต่ำ (< 30%), กลาง และสูง (> 70%) ของแรงดันจ่าย — ผ่านแล้ว ${seen.length}/3 ช่วง` };
    if (!ach.load) out.load = { pass: false, detail: 'ขั้นสุดท้าย: ต่อตัวต้านทานโหลดจากขา 2 ลงขั้วลบ แล้ววัดใหม่' };
  } else if (load) {
    const RL = load.params.resistance;
    const rp = (lower * RL) / (lower + RL);
    const theory = (vsAbs * rp) / (upper + rp), unloaded = (vsAbs * lower) / (R + 2 * re);
    if ((near(v, theory, 0.02) || Math.abs(v - theory) < 0.005) && unloaded - v > 0.05 * unloaded) out.load = { pass: true };
    else if (near(v, theory, 0.02)) out.load = { pass: false, detail: `โหลด ${RL} Ω ใหญ่เมื่อเทียบกับ VR จึงแทบไม่เห็นผล — ลองโหลดที่เล็กลง เช่น 1 kΩ` };
    else out.load = { pass: false, detail: `วัดได้ ${v.toFixed(3)} V สูตรวงแบ่งที่มีโหลด ${theory.toFixed(3)} V` };
  }
  return out;
};

CHECKERS['buzzer'] = (x) => {
  const out: Record<string, GoalStatus> = { active: { pass: false }, passiveDc: { pass: false }, passiveAc: { pass: false }, resonance: { pass: false } };
  const ach = x.c.work.achieved?.['buzzer'] ?? {};
  const bz = x.c.doc.parts.filter((p): p is BuzzerPart => p.kind === 'buzzer');
  if (!bz.length) { out.active = { pass: false, detail: 'วางบัซเซอร์บนบอร์ด' }; return out; }
  for (const b of bz) {
    const r = x.c.analysis.parts[b.id];
    if (!r?.extra) continue;
    const on = r.extra.sounding === 1;
    if (b.params.type === 'active') {
      if (on && r.voltage > 0) out.active = { pass: true };
      else if (r.voltage < -0.5) out.active = { pass: false, detail: 'บัซเซอร์ต่อกลับขั้ว — ขา + (ขายาว) ต้องอยู่ฝั่งขั้วบวก' };
      else if (!out.active.pass) out.active = { pass: false, detail: 'ป้อนไฟตรง 5 V ให้บัซเซอร์แบบมีวงจรในตัว (ขา + ฝั่งบวก)' };
    } else {
      const dcOnly = Math.abs(r.current) > 5e-3 && r.extra.iac < 1e-3;
      if (dcOnly && !on) out.passiveDc = { pass: true };
      if (on) {
        out.passiveAc = { pass: true };
        const f = r.extra.freq;
        if (f > 1500 && f < 2800 && r.extra.level > 0.6) out.resonance = { pass: true };
        else if (!out.resonance.pass) out.resonance = { pass: false, detail: `ตอนนี้ดังที่ ${f.toFixed(0)} Hz (ความดัง ${(r.extra.level * 100).toFixed(0)}%) — ลองปรับความถี่เข้าใกล้ ${b.params.frequency} Hz` };
      } else if (!out.passiveAc.pass && !dcOnly) out.passiveAc = { pass: false, detail: 'ต่อเครื่องกำเนิดสัญญาณคลื่นสี่เหลี่ยม (เช่น 2 kHz, 3 Vpp, offset 1.5 V) เข้าบัซเซอร์แบบไม่มีวงจร แล้วกด Run' };
    }
  }
  if (!out.passiveDc.pass && !ach.passiveDc) out.passiveDc = { pass: false, detail: 'ต่อบัซเซอร์แบบไม่มีวงจร (passive) เข้าไฟตรง 3.5 V แล้วสังเกตว่าไม่ดัง' };
  return out;
};

CHECKERS['ldr'] = (x) => {
  const out: Record<string, GoalStatus> = { divider: { pass: false }, response: { pass: false }, night: { pass: false } };
  const s = x.supplies()[0];
  const l = x.c.doc.parts.find((p): p is LdrPart => p.kind === 'ldr');
  if (!s || !l) return out;
  const ach = x.c.work.achieved?.['ldr'] ?? {};
  const POS = x.net(s.id, 'pos'), NEG = x.net(s.id, 'neg');
  const a = x.net(l.id, '1'), b = x.net(l.id, '2');
  // LDR ด้านล่าง (X–NEG) หรือด้านบน (POS–X) ของวงแบ่ง
  let X = -1, bottom = true;
  if (a === NEG || b === NEG) { X = a === NEG ? b : a; bottom = true; }
  else if (a === POS || b === POS) { X = a === POS ? b : a; bottom = false; }
  const partner = X >= 0 ? x.resistors().find((r) => { const n = x.resNets(r); return n.includes(X) && n.includes(bottom ? POS : NEG); }) : undefined;
  if (!partner || X === POS || X === NEG) { out.divider = { pass: false, detail: 'ต่อ LDR อนุกรมกับตัวต้านทาน (เช่น 47 kΩ) คร่อมแหล่งจ่าย — จุดกึ่งกลางคือแรงดันที่เปลี่ยนตามแสง' }; return out; }
  out.divider = { pass: true };
  const { red, black } = x.probeNets();
  const v = x.c.analysis.probe.value;
  const lux = l.params.lux;
  if (red === X && black === NEG && v !== null) {
    const loaded = x.conn.nets[X].partPins.filter((pp) => pp.partId !== l.id && pp.partId !== partner.id).length > 0;
    const Rl = ldrResistance(l.params), Rf = partner.params.resistance;
    const vs = nodeV(x, POS)! - nodeV(x, NEG)!;
    const theory = vs * (bottom ? Rl / (Rl + Rf) : Rf / (Rl + Rf));
    const ok = loaded || near(v, theory, 0.02) || Math.abs(v - theory) < 0.005;
    if (ok && lux <= 10) out._dark = { pass: true };
    if (ok && lux >= 300) out._bright = { pass: true };
    if (!ok) out.response = { pass: false, detail: `วัดได้ ${v.toFixed(3)} V สูตรวงแบ่ง ${theory.toFixed(3)} V` };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  if (seen('_dark') && seen('_bright')) out.response = { pass: true };
  else if (!out.response.detail) out.response = { pass: false, detail: 'วางโพรบแดงที่จุดกึ่งกลาง โพรบดำที่ขั้วลบ แล้ววัดทั้งตอนมืด (≤ 10 lx) และตอนสว่าง (≥ 300 lx)' };
  // ไฟอัตโนมัติ: LED ติดตอนมืด ดับตอนสว่าง
  for (const led of x.leds()) {
    const I = x.I(led.id);
    if (lux <= 10 && I > 1e-3) out._ledDarkOn = { pass: true };
    if (lux >= 300 && I < 1e-4) out._ledBrightOff = { pass: true };
    if (lux >= 300 && I > 1e-3) out._ledBrightOn = { pass: true };
  }
  if (seen('_ledDarkOn') && seen('_ledBrightOff') && !out._ledBrightOn) out.night = { pass: true };
  else out.night = { pass: false, detail: x.leds().length ? 'ปรับแสง: LED ต้องติดเมื่อมืด (≤ 10 lx) และดับเมื่อสว่าง (≥ 300 lx)' : 'ต่อวงจรขับ LED ด้วยทรานซิสเตอร์ โดยใช้แรงดันจากจุดกึ่งกลางของวงแบ่งป้อนขา B' };
  return out;
};

CHECKERS['sevenseg'] = (x) => {
  const out: Record<string, GoalStatus> = { common: { pass: false }, resistor: { pass: false }, digit: { pass: false }, count: { pass: false } };
  const d = x.c.doc.parts.find((p): p is SevenSegPart => p.kind === 'sevenseg');
  if (!d) return out;
  const ach = x.c.work.achieved?.['sevenseg'] ?? {};
  const COM = x.net(d.id, '3');
  // ขั้วลบ/บวกของวงจร: จากแหล่งจ่าย หรือ GND / 3V3 ของ Pico
  const negs = new Set<number>(), poss = new Set<number>();
  for (const s of x.supplies()) { negs.add(x.net(s.id, 'neg')); poss.add(x.net(s.id, 'pos')); }
  for (const p of x.c.doc.parts) if (p.kind === 'pico') { negs.add(x.net(p.id, 'GND')); poss.add(x.net(p.id, '3V3')); poss.add(x.net(p.id, 'VBUS')); }
  const cc = d.params.common === 'cc';
  if (cc ? negs.has(COM) : poss.has(COM)) out.common = { pass: true };
  else out.common = { pass: false, detail: cc ? 'แคโทดร่วม: ต่อขา 3 หรือ 8 (ขาร่วม) เข้ากราวด์/ขั้วลบ' : 'แอโนดร่วม: ต่อขา 3 หรือ 8 (ขาร่วม) เข้าไฟบวก (เช่น 3V3)' };
  const r = x.c.analysis.parts[d.id];
  if (!r?.extra) return out;
  // ส่วนที่ติดต้องมีตัวต้านทานของตัวเองที่ขาส่วน และกระแสไม่เกิน 15 mA
  const lit = SEG_NAMES.filter((s) => r.extra![`i_${s}`] > 1e-4);
  const resPins = new Set<number>(x.resistors().flatMap((rr) => x.resNets(rr)));
  const noRes = lit.filter((s) => !resPins.has(x.net(d.id, SEG_PINS[s])));
  const over = lit.filter((s) => r.extra![`i_${s}`] > 0.015);
  if (lit.length && !noRes.length && !over.length) out.resistor = { pass: true };
  else if (noRes.length) out.resistor = { pass: false, detail: `ส่วน ${noRes.map((s) => s.toUpperCase()).join(', ')} ไม่มีตัวต้านทานที่ขาส่วน — ใส่ตัวต้านทานแยกให้ทุกส่วน (ไม่ใช้ตัวเดียวที่ขาร่วม เพราะความสว่างจะเปลี่ยนตามจำนวนส่วนที่ติด)` };
  else if (over.length) out.resistor = { pass: false, detail: `ส่วน ${over.map((s) => s.toUpperCase()).join(', ')} กระแสเกิน 15 mA — เพิ่มค่าตัวต้านทาน` };
  else out.resistor = { pass: false, detail: 'ยังไม่มีส่วนใดติด' };
  const ch = r.extra.digit >= 0 ? String.fromCharCode(r.extra.digit) : null;
  if (ch && /[0-9]/.test(ch) && out.resistor.pass) { out.digit = { pass: true }; out[`_d${ch}`] = { pass: true }; }
  else if (lit.length && !ch) out.digit = { pass: false, detail: 'รูปแบบส่วนที่ติดยังไม่ใช่ตัวเลข — ตรวจว่าต่อขาถูกส่วน (ดูตารางขาในแผงคุณสมบัติ)' };
  const seen = '0123456789'.split('').filter((k) => ach[`_d${k}`] || out[`_d${k}`]?.pass);
  out.count = seen.length >= 4 ? { pass: true } : { pass: false, detail: `แสดงตัวเลขต่างกันแล้ว ${seen.length}/4 ตัว (${seen.join(' ') || '—'}) — เขียนโปรแกรมนับเลข` };
  return out;
};

CHECKERS['motor'] = (x) => {
  const out: Record<string, GoalStatus> = { driver: { pass: false }, flyback: { pass: false }, power: { pass: false }, speed: { pass: false }, stop: { pass: false } };
  const m = x.c.doc.parts.find((p): p is MotorPart => p.kind === 'motor');
  if (!m) return out;
  const ach = x.c.work.achieved?.['motor'] ?? {};
  const A = x.net(m.id, 'A'), B = x.net(m.id, 'B');
  const pico = x.c.doc.parts.find((p) => p.kind === 'pico');
  const gp = new Set<number>(pico ? PICO_GPIO.map((g) => x.net(pico.id, `GP${g}`)) : []);
  const negs = new Set<number>(x.supplies().map((s) => x.net(s.id, 'neg')));
  // ขับด้านล่าง: มอสเฟต D (หรือ BJT C) ที่ขั้วมอเตอร์, S/E ลงขั้วลบ, G/B จาก GPIO (ตรงหรือผ่านตัวต้านทาน)
  const viaR = (a: number, b: number) => a === b || x.resistors().some((r) => { const n = x.resNets(r); return n.includes(a) && n.includes(b); });
  const sw = x.c.doc.parts.find((p): p is MosfetPart | BjtPart => (p.kind === 'mosfet' && [A, B].includes(x.net(p.id, 'D'))) || (p.kind === 'bjt' && [A, B].includes(x.net(p.id, 'C'))));
  if (!sw) out.driver = { pass: false, detail: 'ใช้มอสเฟต (เช่น IRLZ44N) ขับด้านล่าง: ขา D ต่อสายดำของมอเตอร์ ขา S ลงกราวด์' };
  else {
    const src = sw.kind === 'mosfet' ? x.net(sw.id, 'S') : x.net(sw.id, 'E');
    const ctl = sw.kind === 'mosfet' ? x.net(sw.id, 'G') : x.net(sw.id, 'B');
    if (!negs.has(src)) out.driver = { pass: false, detail: `ต่อขา ${sw.kind === 'mosfet' ? 'S' : 'E'} ลงกราวด์ (ขั้ว − ของแหล่งจ่ายมอเตอร์)` };
    else if (![...gp].some((g) => viaR(g, ctl))) out.driver = { pass: false, detail: `ต่อขา ${sw.kind === 'mosfet' ? 'G' : 'B'} เข้าขา GPIO ของ Pico (เช่น GP15)` };
    else out.driver = { pass: true };
  }
  const swNet = sw ? (sw.kind === 'mosfet' ? x.net(sw.id, 'D') : x.net(sw.id, 'C')) : B;
  const hi = swNet === A ? B : A;
  const fly = x.c.doc.parts.find((p): p is DiodePart => p.kind === 'diode' && x.net(p.id, 'A') === swNet && x.net(p.id, 'K') === hi);
  out.flyback = fly ? { pass: true } : { pass: false, detail: 'ต่อไดโอด (เช่น 1N4007) คร่อมมอเตอร์: แอโนดที่ขั้วฝั่งมอสเฟต แคโทดที่ขั้วฝั่งไฟบวก' };
  const sup = x.supplies().find((s) => x.net(s.id, 'pos') === hi);
  const picoGnd = pico ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pico.id, n)) : [];
  if (!sup) out.power = { pass: false, detail: 'ต่อสายแดงของมอเตอร์เข้าขั้ว + ของแหล่งจ่ายแยก 3–6 V (ไม่ใช้ไฟจาก Pico)' };
  else if (sup.params.voltage < 3 || sup.params.voltage > 6) out.power = { pass: false, detail: 'ตั้งแหล่งจ่ายมอเตอร์ 3–6 V' };
  else if (pico && !picoGnd.includes(x.net(sup.id, 'neg'))) out.power = { pass: false, detail: 'ต่อกราวด์ร่วม: ขั้ว − ของแหล่งจ่ายกับ GND ของ Pico' };
  else out.power = { pass: true };
  const e = x.c.analysis.parts[m.id]?.extra;
  if (!e) return out;
  const rpm = Math.abs(e.rpm);
  if (out.driver.pass && rpm > 20) { out[`_r${Math.round(rpm / 25)}`] = { pass: true }; out._run = { pass: true }; }
  if ((ach._run || out._run?.pass) && rpm < 1) out._stop = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const n = Object.keys({ ...ach, ...out }).filter((k) => /^_r\d+$/.test(k) && seen(k)).length;
  out.speed = n >= 2 ? { pass: true } : { pass: false, detail: `เปลี่ยน duty ของ PWM ให้ได้ความเร็วต่างกันอย่างน้อย 2 ระดับ (ตอนนี้ ${rpm.toFixed(0)} rpm)` };
  out.stop = seen('_stop') ? { pass: true } : { pass: false, detail: 'ตั้ง duty เป็น 0 ให้มอเตอร์หยุด' };
  return out;
};

CHECKERS['servo'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, signal: { pass: false }, pwm50: { pass: false }, angles: { pass: false }, sweep: { pass: false } };
  const m = x.c.doc.parts.find((p): p is ServoPart => p.kind === 'servo');
  if (!m) return out;
  const ach = x.c.work.achieved?.['servo'] ?? {};
  const V = x.net(m.id, 'V'), G = x.net(m.id, 'GND'), S = x.net(m.id, 'SIG');
  const pico = x.c.doc.parts.find((p) => p.kind === 'pico');
  const fives = new Set<number>(x.supplies().filter((s) => s.params.voltage >= 4.5 && s.params.voltage <= 6).map((s) => x.net(s.id, 'pos')));
  const gnds = new Set<number>(x.supplies().map((s) => x.net(s.id, 'neg')));
  if (pico) { fives.add(x.net(pico.id, 'VBUS')); for (const n of ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38']) gnds.add(x.net(pico.id, n)); }
  if (!fives.has(V)) out.power = { pass: false, detail: 'ต่อสายแดง (+) เข้าไฟ 5 V (Pico: ขา VBUS) — 3V3 ไม่พอและจ่ายกระแสไม่ไหว' };
  else if (!gnds.has(G)) out.power = { pass: false, detail: 'ต่อสายน้ำตาล (GND) เข้ากราวด์ร่วมกับ Pico' };
  else out.power = { pass: true };
  const gp = new Set<number>(pico ? PICO_GPIO.map((g) => x.net(pico.id, `GP${g}`)) : []);
  out.signal = gp.has(S) ? { pass: true } : { pass: false, detail: pico ? 'ต่อสายส้ม (สัญญาณ) เข้าขา GPIO ของ Pico (เช่น GP15)' : 'วาง Raspberry Pi Pico แล้วต่อสายส้มเข้าขา GPIO' };
  const e = x.c.analysis.parts[m.id]?.extra;
  if (!e) return out;
  if (e.period > 0 && Math.abs(e.period - 0.02) <= 0.002) out.pwm50 = { pass: true };
  else if (e.period > 0) out.pwm50 = { pass: false, detail: `คาบ ${(e.period * 1000).toFixed(1)} ms — ตั้ง PWM 50 Hz: s.freq(50)` };
  else out.pwm50 = { pass: false, detail: 'ยังไม่มีพัลส์ที่ขาสัญญาณ — รันโค้ดที่ใช้ PWM(Pin(15)) และ s.freq(50)' };
  // มุมที่ไปถึงและหยุดนิ่ง: ใกล้ 0°, 90°, 180° (±5°)
  if (out.power.pass && out.pwm50.pass && !e.moving) {
    for (const a of [0, 90, 180]) if (Math.abs(e.angle - a) <= 5) out[`_a${a}`] = { pass: true };
    out[`_t${Math.round(e.angle / 10)}`] = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const n = [0, 90, 180].filter((a) => seen(`_a${a}`));
  out.angles = n.length === 3 ? { pass: true } : { pass: false, detail: `หมุนแขนไปหยุดที่ 0°, 90° และ 180° (ผ่านแล้ว: ${n.map((a) => `${a}°`).join(', ') || '—'}) — พัลส์ 0.5 / 1.45 / 2.4 ms` };
  const steps = Object.keys({ ...ach, ...out }).filter((k) => /^_t\d+$/.test(k) && seen(k)).length;
  out.sweep = steps >= 10 ? { pass: true } : { pass: false, detail: `กวาดแขนทีละน้อยด้วยลูป for (เห็นแล้ว ${steps}/10 ตำแหน่ง)` };
  return out;
};

CHECKERS['psu'] = (x) => {
  const out: Record<string, GoalStatus> = { transformer: { pass: false }, filter: { pass: false }, regulate: { pass: false }, scope: { pass: false }, fullwave: { pass: false }, ripple: { pass: false }, compare: { pass: false } };
  const t = x.c.doc.parts.find((p): p is TransformerPart => p.kind === 'transformer');
  const u = x.c.doc.parts.find((p): p is VregPart => p.kind === 'vreg');
  const ach = x.c.work.achieved?.['psu'] ?? {};
  if (!t) { out.transformer = { pass: false, detail: 'วางหม้อแปลง 12-0-12 V บนโต๊ะ' }; return out; }
  const tn = ['A', 'CT', 'B'].map((p) => x.net(t.id, p));
  const diodes = x.c.doc.parts.filter((p): p is DiodePart => p.kind === 'diode');
  const usesT = diodes.some((d) => tn.includes(x.net(d.id, 'A')) || tn.includes(x.net(d.id, 'K')));
  if (!t.params.on) out.transformer = { pass: false, detail: 'เสียบปลั๊กหม้อแปลง (แผงคุณสมบัติ)' };
  else if (!usesT) out.transformer = { pass: false, detail: 'ต่อขั้วหม้อแปลง (A–CT หรือ A–B) เข้าไดโอดเรียงกระแส' };
  else out.transformer = { pass: true };
  if (!u) { out.regulate = { pass: false, detail: 'วางไอซี 7805 รับไฟจากตัวเก็บประจุกรอง' }; return out; }
  const IN = x.net(u.id, 'IN'), G = x.net(u.id, 'GND');
  const caps = x.c.doc.parts.filter((p): p is CapacitorPart => p.kind === 'capacitor' && [x.net(p.id, 'P'), x.net(p.id, 'N')].includes(IN) && [x.net(p.id, 'P'), x.net(p.id, 'N')].includes(G));
  const cTot = caps.reduce((a, c) => a + c.params.capacitance, 0);
  const big = caps.find((c) => c.params.polarized && c.params.capacitance >= 100e-6);
  if (!big) out.filter = { pass: false, detail: 'ต่อตัวเก็บประจุกรอง (อิเล็กโทรไลต์ ≥ 100 µF เช่น 1000 µF 25 V) ระหว่างขา IN กับ GND ของ 7805 — ขา + ทางขา IN' };
  else if (x.net(big.id, 'P') !== IN) out.filter = { pass: false, detail: 'ตัวเก็บประจุอิเล็กโทรไลต์กลับขั้ว — ขา + ต้องต่อด้านไฟบวก (ขา IN)' };
  else out.filter = { pass: true };
  const e = x.c.analysis.parts[u.id]?.extra;
  if (e && e.regulating && e.iout >= 0.01) out.regulate = { pass: true };
  else if (e) out.regulate = { pass: false, detail: e.vin < u.params.vout + u.params.dropout ? `แรงดันขาเข้า 7805 ${e.vin.toFixed(1)} V ต่ำเกิน — ตรวจวงจรเรียงกระแส` : 'ต่อโหลดที่ขาออก (≥ 10 mA เช่น 100 Ω)' };
  const sc = x.c.doc.parts.find((p): p is ScopePart => p.kind === 'scope');
  if (!sc) { out.scope = { pass: false, detail: 'วางออสซิลโลสโคป: CH1 ที่ขา + ของตัวเก็บประจุกรอง, GND ที่กราวด์' }; return out; }
  if (x.net(sc.id, 'CH1') !== IN) out.scope = { pass: false, detail: 'ต่อ CH1 ของสโคปที่ขา + ของตัวเก็บประจุกรอง (ขา IN ของ 7805)' };
  else if (x.net(sc.id, 'GND') !== G) out.scope = { pass: false, detail: 'ต่อ GND ของสโคปเข้ากราวด์ (ขา − ของตัวเก็บประจุ)' };
  else out.scope = { pass: true };
  const [m1] = x.c.scopeMeasure ?? [null, null];
  if (!out.scope.pass || !m1 || m1.freq === null) {
    if (out.scope.pass) out.fullwave = { pass: false, detail: 'กด Run แล้วตั้ง time/div ให้เห็นหลายลูก (เช่น 5 ms/div) — ใช้ AC coupling เพื่อขยาย ripple' };
  } else {
    const fr = t.params.frequency;
    if (Math.abs(m1.freq / (2 * fr) - 1) < 0.1) { out.fullwave = { pass: true }; out._full = { pass: true }; }
    else if (Math.abs(m1.freq / fr - 1) < 0.1) { out._half = { pass: true }; out.fullwave = { pass: false, detail: `ripple ${m1.freq.toFixed(0)} Hz = เรียงกระแสครึ่งคลื่น — ใช้บริดจ์ 4 ไดโอด (หรือแท็ปกลาง 2 ไดโอด) ให้ได้ ${2 * fr} Hz` }; }
    else out.fullwave = { pass: false, detail: `ความถี่ ripple ${m1.freq.toFixed(0)} Hz — รอให้รูปคลื่นนิ่ง` };
    if (out.fullwave.pass && e && cTot > 0) {
      const th = e.iin / (2 * fr * cTot);
      if (m1.vpp > 0 && Math.abs(m1.vpp / th - 1) <= 0.4) out.ripple = { pass: true };
      else out.ripple = { pass: false, detail: `ripple ${m1.vpp.toFixed(3)} Vpp เทียบประมาณการ I/(2fC) = ${th.toFixed(3)} V ต่างเกิน 40%` };
    }
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.compare = seen('_half') && seen('_full') ? { pass: true } : { pass: false, detail: 'ลองถอดไดโอดให้เป็นครึ่งคลื่น (ripple 50 Hz และสูงขึ้น ≈ 2 เท่า) แล้วต่อกลับ' };
  return out;
};

CHECKERS['vreg'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, caps: { pass: false }, regulate: { pass: false }, line: { pass: false }, dropout: { pass: false }, heat: { pass: false } };
  const u = x.c.doc.parts.find((p): p is VregPart => p.kind === 'vreg');
  if (!u) return out;
  const ach = x.c.work.achieved?.['vreg'] ?? {};
  const IN = x.net(u.id, 'IN'), G = x.net(u.id, 'GND'), O = x.net(u.id, 'OUT');
  const sup = x.supplies().find((s) => x.net(s.id, 'pos') === IN && x.net(s.id, 'neg') === G);
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!sup) out.wiring = { pass: false, detail: 'ต่อขา 1 (IN) เข้าขั้ว + และขา 2 (GND) เข้าขั้ว − ของแหล่งจ่าย' };
  else if (!e || e.iout < 1e-3) out.wiring = { pass: false, detail: 'ต่อโหลด (เช่น ตัวต้านทาน 100 Ω หรือ LED + 330 Ω) จากขา 3 (OUT) ลงกราวด์' };
  else out.wiring = { pass: true };
  const caps = x.c.doc.parts.filter((p): p is CapacitorPart => p.kind === 'capacitor');
  const capOn = (a: number) => caps.some((c) => { const n = [x.net(c.id, 'P'), x.net(c.id, 'N')]; return n.includes(a) && n.includes(G); });
  out.caps = capOn(IN) && capOn(O) ? { pass: true } : { pass: false, detail: `ต่อตัวเก็บประจุตามเอกสารผู้ผลิต: ${capOn(IN) ? '' : '0.33 µF ระหว่าง IN กับ GND '}${capOn(O) ? '' : '0.1 µF ระหว่าง OUT กับ GND'}`.trim() };
  if (!e || !out.wiring.pass) return out;
  const vk = Math.round(e.vin);
  if (e.regulating && e.iout >= 0.01) { out.regulate = { pass: true }; out[`_v${vk}`] = { pass: true }; }
  else if (!e.regulating) out.regulate = { pass: false, detail: `ขาออก ${e.vout.toFixed(2)} V — ตั้งแหล่งจ่ายให้ขาเข้าอย่างน้อย ${u.params.vout + u.params.dropout} V` };
  else out.regulate = { pass: false, detail: 'ใช้โหลดที่กินกระแสอย่างน้อย 10 mA' };
  const seenV = Object.keys({ ...ach, ...out }).filter((k) => /^_v\d+$/.test(k) && (ach[k] || out[k]?.pass));
  out.line = seenV.length >= 2 ? { pass: true } : { pass: false, detail: `เปลี่ยนแรงดันแหล่งจ่าย (เช่น 9 V และ 12 V) แล้ววัดว่าขาออกยังคงที่ (${seenV.length}/2)` };
  if (e.vin > 1 && e.vin - u.params.vout < u.params.dropout && e.vout < u.params.vout - 0.2) out._drop = { pass: true };
  out.dropout = ach._drop || out._drop?.pass ? { pass: true } : { pass: false, detail: `ลดแรงดันขาเข้าให้ต่ำกว่า ${u.params.vout + u.params.dropout} V แล้วสังเกตว่าขาออกตกตาม (≈ IN − ${u.params.dropout} V)` };
  if (e.pd >= 1 && u.params.heatsink && e.tj < 125) out.heat = { pass: true };
  else out.heat = { pass: false, detail: e.pd < 1 ? `เพิ่มกระแสโหลดให้กำลังสูญเสียถึง 1 W (ตอนนี้ ${e.pd.toFixed(2)} W) — ดูอุณหภูมิในแผงผล` : `อุณหภูมิประมาณ ${e.tj.toFixed(0)} °C — ติดแผ่นระบายความร้อนให้ต่ำกว่า 125 °C` };
  return out;
};

CHECKERS['timer555'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, network: { pass: false }, oscillate: { pass: false }, blink: { pass: false }, change: { pass: false } };
  const u = x.c.doc.parts.find((p): p is Timer555Part => p.kind === 'timer555');
  if (!u) return out;
  const ach = x.c.work.achieved?.['timer555'] ?? {};
  const r = x.c.analysis.parts[u.id];
  const e = r?.extra;
  const VCC = x.net(u.id, 'VCC'), GND = x.net(u.id, 'GND'), RST = x.net(u.id, 'RESET');
  const sup = x.supplies().find((s) => x.net(s.id, 'pos') === VCC && x.net(s.id, 'neg') === GND);
  if (!sup) out.power = { pass: false, detail: 'ต่อขา 8 (VCC) เข้าขั้ว + และขา 1 (GND) เข้าขั้ว − ของแหล่งจ่าย' };
  else if (sup.params.voltage < 4.5 || sup.params.voltage > 16) out.power = { pass: false, detail: 'ตั้งแหล่งจ่าย 4.5–16 V (ช่วงใช้งานของ NE555) เช่น 5 V หรือ 9 V' };
  else if (RST !== VCC) out.power = { pass: false, detail: 'ต่อขา 4 (RESET) เข้า VCC ด้วย' };
  else out.power = { pass: true };
  if (!e) return out;
  if (e.fth > 0) out.network = { pass: true };
  else out.network = { pass: false, detail: 'ต่อวงจร astable: RA จาก VCC ไปขา 7, RB จากขา 7 ไปขา 6, ต่อขา 2 กับขา 6, ตัวเก็บประจุจากขา 6 ลงกราวด์' };
  const ok = e.fth > 0 && e.freq > 0 && Math.abs(e.freq / e.fth - 1) <= 0.05;
  if (ok) { out.oscillate = { pass: true }; out[`_f${e.fth.toPrecision(3)}`] = { pass: true }; }
  else if (e.fth > 0 && e.freq > 0) out.oscillate = { pass: false, detail: `วัดได้ ${e.freq.toPrecision(3)} Hz ต่างจากทฤษฎี ${e.fth.toPrecision(3)} Hz เกิน 5%` };
  else if (e.fth > 0) out.oscillate = { pass: false, detail: 'กด Run แล้วรอให้ขาออกกะพริบอย่างน้อย 2 รอบ (ดูค่าในแผงผล)' };
  // LED ที่ขาออก: ติดเมื่อ HIGH ดับเมื่อ LOW (จดจำข้ามสถานะ)
  const OUT = x.net(u.id, 'OUT');
  const led = x.leds().find((l) => x.net(l.id, 'A') === OUT || x.resistors().some((rr) => x.resNets(rr).includes(OUT) && x.resNets(rr).includes(x.net(l.id, 'A'))));
  if (!led) out.blink = { pass: false, detail: 'ต่อ LED + ตัวต้านทาน (เช่น 330 Ω) จากขา 3 (OUT) ลงกราวด์' };
  else {
    const il = x.c.analysis.parts[led.id]?.current ?? 0;
    if (il > 2e-3) out._ledOn = { pass: true };
    if (il < 1e-4) out._ledOff = { pass: true };
    const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
    out.blink = seen('_ledOn') && seen('_ledOff') ? { pass: true } : { pass: false, detail: 'รอให้เห็น LED ทั้งติดและดับ (ถ้ากะพริบเร็วเกินตา ให้เพิ่ม C หรือ RB)' };
  }
  const freqs = Object.keys({ ...ach, ...out }).filter((k) => k.startsWith('_f') && (ach[k] || out[k]?.pass));
  out.change = freqs.length >= 2 ? { pass: true } : { pass: false, detail: 'เปลี่ยนค่า C หรือ RB แล้ววัดความถี่ใหม่ให้ตรงทฤษฎีอีกครั้ง' };
  return out;
};

CHECKERS['relay'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, control: { pass: false }, load: { pass: false }, follow: { pass: false } };
  const k = x.c.doc.parts.find((p): p is RelayPart => p.kind === 'relay');
  if (!k) return out;
  const ach = x.c.work.achieved?.['relay'] ?? {};
  const r = x.c.analysis.parts[k.id];
  const e = r?.extra;
  const V = x.net(k.id, 'V'), G = x.net(k.id, 'G'), S = x.net(k.id, 'S');
  const pico = x.c.doc.parts.find((p) => p.kind === 'pico');
  const gpNets = new Set<number>(pico ? PICO_GPIO.map((g) => x.net(pico.id, `GP${g}`)) : []);
  const fives = new Set<number>(x.supplies().filter((s) => s.params.voltage >= 4.5 && s.params.voltage <= 5.5).map((s) => x.net(s.id, 'pos')));
  if (pico) fives.add(x.net(pico.id, 'VBUS'));
  if (!fives.has(V)) out.power = { pass: false, detail: 'ต่อขา + ของโมดูลเข้าไฟ 5 V (Pico: ขา VBUS) — 3V3 ไม่พอให้ขดลวดดึง' };
  else if (e && Math.abs(e.vcc) < 4.5) out.power = { pass: false, detail: 'ต่อขา − ของโมดูลเข้ากราวด์ร่วมกับแหล่งจ่าย' };
  else out.power = { pass: true };
  if (gpNets.has(S)) out.control = { pass: true };
  else out.control = { pass: false, detail: pico ? 'ต่อขา S ของโมดูลเข้าขา GPIO ของ Pico (เช่น GP15)' : 'วาง Raspberry Pi Pico แล้วต่อขา S เข้าขา GPIO' };
  if (!e) return out;
  const usedNo = x.conn.nets[x.net(k.id, 'NO')].partPins.length > 1 && x.conn.nets[x.net(k.id, 'COM')].partPins.length > 1;
  if (!usedNo) out.load = { pass: false, detail: 'ต่อโหลด (เช่น LED + ตัวต้านทาน กับแหล่งจ่ายแยก) ผ่านขั้ว COM และ NO' };
  else if (e.energized && e.icontact > 1e-3) { out.load = { pass: true }; out._onLoad = { pass: true }; }
  else if (!e.energized) { out._offIdle = { pass: true }; if (!out.load.pass && !ach.load) out.load = { pass: false, detail: 'สั่ง S = HIGH เพื่อให้รีเลย์ดึง แล้วดูว่าโหลดทำงาน' }; }
  void G;
  const seen = (key: string) => !!ach[key] || !!out[key]?.pass;
  out.follow = seen('_onLoad') && seen('_offIdle') ? { pass: true } : { pass: false, detail: 'ให้โปรแกรมสลับ S เป็น HIGH และ LOW แล้วดูว่าโหลดทำงาน/หยุดตาม' };
  return out;
};

CHECKERS['opamp'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, circuit: { pass: false }, scope: { pass: false }, gain: { pass: false }, invert: { pass: false }, clip: { pass: false } };
  const u = x.c.doc.parts.find((p): p is OpampPart => p.kind === 'opamp');
  const s = scopeOnFgen(x);
  if (!u) return out;
  const VP = x.net(u.id, 'V+'), VN = x.net(u.id, 'V-'), INP = x.net(u.id, 'IN+'), INN = x.net(u.id, 'IN-'), O = x.net(u.id, 'OUT');
  const GND = s ? s.COM : INP;
  const vp = nodeV(x, VP), vn = nodeV(x, VN), vg = nodeV(x, GND);
  const r = x.c.analysis.parts[u.id];
  if (vp === null || vn === null || vg === null) out.power = { pass: false, detail: 'ต่อไฟเลี้ยงที่ขา 7 (V+) และขา 4 (V−)' };
  else if (vp - vg > 3 && vg - vn > 3 && vp - vn <= u.params.maxSupply) out.power = { pass: true };
  else out.power = { pass: false, detail: `V+ = ${(vp - vg).toFixed(2)} V, V− = ${(vn - vg).toFixed(2)} V เทียบกราวด์ — ต่อแหล่งจ่ายสองตัวอนุกรม จุดกลางเป็นกราวด์` };
  if (!s) { out.circuit = { pass: false, detail: 'วางเครื่องกำเนิดสัญญาณและออสซิลโลสโคป' }; return out; }
  const rf = x.resistors().find((rr) => { const n = x.resNets(rr); return n.includes(O) && n.includes(INN); });
  const rin = x.resistors().find((rr) => { const n = x.resNets(rr); return n.includes(s.OUT) && n.includes(INN); });
  if (INP !== s.COM) out.circuit = { pass: false, detail: 'ต่อขา 3 (IN+) เข้ากราวด์ (COM ของเครื่องกำเนิด)' };
  else if (!rf) out.circuit = { pass: false, detail: 'ต่อ Rf ระหว่างขา 6 (OUT) กับขา 2 (IN−)' };
  else if (!rin || rin === rf) out.circuit = { pass: false, detail: 'ต่อ Rin จาก OUT ของเครื่องกำเนิดไปขา 2 (IN−)' };
  else out.circuit = { pass: true };
  if (s.GND !== s.COM) out.scope = { pass: false, detail: 'ต่อ GND ของสโคปเข้ากราวด์' };
  else if (s.CH1 !== s.OUT) out.scope = { pass: false, detail: 'ต่อ CH1 ที่ OUT ของเครื่องกำเนิด' };
  else if (s.CH2 !== O) out.scope = { pass: false, detail: 'ต่อ CH2 ที่ขา 6 (OUT) ของออปแอมป์' };
  else out.scope = { pass: true };
  if (r?.extra?.saturated && out.power.pass) out.clip = { pass: true };
  if (!out.circuit.pass || !out.scope.pass || !rf || !rin) return out;
  const [m1, m2] = x.c.scopeMeasure ?? [null, null];
  if (!m1 || !m2 || !(m1.vpp > 1e-3)) { out.gain = { pass: false, detail: 'กด Run แล้วรอให้มีรูปคลื่นบนจอ' }; return out; }
  const theory = rf.params.resistance / rin.params.resistance;
  const g = m2.vpp / m1.vpp;
  const swing = vp !== null && vn !== null ? (vp - vn) / 2 - u.params.headroom : Infinity;
  const clipped = Math.max(Math.abs(m2.vmax), Math.abs(m2.vmin)) > swing * 0.97;
  if (clipped) out.gain = { pass: false, detail: `ขาออกถูกตัดยอด (${m2.vmax.toFixed(2)} / ${m2.vmin.toFixed(2)} V) — ลดสัญญาณเข้าเพื่อวัดอัตราขยาย` };
  else out.gain = near(g, theory, 0.05) ? { pass: true } : { pass: false, detail: `วัดได้ ${g.toFixed(2)} เท่า ทฤษฎี ${theory.toFixed(2)} เท่า — รอให้รูปคลื่นนิ่งหรือกด Auto` };
  // กลับเฟส: ณ ขณะนี้ ขาเข้าและขาออกมีเครื่องหมายตรงข้าม (เทียบกราวด์) เมื่อขาเข้าห่างจากศูนย์พอ
  const vi = nodeV(x, s.OUT), vo = nodeV(x, O);
  if (vi !== null && vo !== null && vg !== null) {
    const a = vi - vg - (m1.vavg ?? 0), b = vo - vg - (m2.vavg ?? 0);
    if (Math.abs(a) > 0.25 * (m1.vpp / 2) && Math.abs(b) > 0.05) out.invert = a * b < 0 ? { pass: true } : { pass: false, detail: 'ขาออกเฟสเดียวกับขาเข้า — ตรวจว่าสัญญาณเข้าทาง IN− (ขา 2) ไม่ใช่ IN+' };
  }
  return out;
};

CHECKERS['bode'] = (x) => {
  const out: Record<string, GoalStatus> = { connect: { pass: false }, lowpass: { pass: false }, fc: { pass: false }, slope: { pass: false }, highpass: { pass: false } };
  const s = scopeOnFgen(x);
  if (!s) return out;
  if (s.GND !== s.COM) { out.connect = { pass: false, detail: 'ต่อ GND ของออสซิลโลสโคปเข้ากับ COM ของเครื่องกำเนิดสัญญาณ' }; return out; }
  if (s.CH1 !== s.OUT) { out.connect = { pass: false, detail: 'ต่อ CH1 เข้ากับจุดเดียวกับ OUT ของเครื่องกำเนิดสัญญาณ' }; return out; }
  out.connect = { pass: true };
  const d = x.c.bode ?? null;
  const capNets = (c: CapacitorPart) => [x.net(c.id, 'P'), x.net(c.id, 'N')];
  // หาโครงสร้าง: first = อุปกรณ์จาก OUT ไป X, second = จาก X ไป COM
  for (const r of x.resistors()) for (const c of x.caps()) {
    const rn = x.resNets(r), cn = capNets(c);
    let kind: 'low' | 'high' | null = null, X = -1;
    if (rn.includes(s.OUT) && cn.includes(s.COM)) { X = rn.find((n) => n !== s.OUT)!; if (cn.includes(X) && X !== s.COM) kind = 'low'; }
    if (!kind && cn.includes(s.OUT) && rn.includes(s.COM)) { X = cn.find((n) => n !== s.OUT)!; if (rn.includes(X) && X !== s.COM) kind = 'high'; }
    if (!kind) continue;
    if (s.CH2 !== X) { if (kind === 'low') out.lowpass = { pass: false, detail: 'ต่อ R–C ถูกแล้ว ให้ต่อ CH2 ที่จุดระหว่าง R กับ C' }; continue; }
    const fc = 1 / (2 * Math.PI * r.params.resistance * c.params.capacitance);
    if (!d || !d.ok) { const det = { pass: false, detail: d?.error ?? 'เปิดแท็บ "กราฟโบด" ขณะ Run เพื่อคำนวณกราฟ' }; if (kind === 'low') out.lowpass = det; continue; }
    const F = d.freqs;
    if (!(F[0] <= fc / 3 && F[F.length - 1] >= fc * 30)) {
      const det = { pass: false, detail: `ตั้งช่วง sweep ให้ครอบคลุม ${Math.round(fc / 3)} Hz ถึง ${Math.round(fc * 30)} Hz (fc ≈ ${Math.round(fc)} Hz)` };
      if (kind === 'low') out.lowpass = det; else out.highpass = det;
      continue;
    }
    const m = measureBode(d);
    const ph = bodeAt(d, fc).phase;
    if (kind === 'low') {
      out.lowpass = { pass: true };
      const f3 = m?.fHigh ?? null;
      if (f3 === null) out.fc = { pass: false, detail: 'กราฟไม่ตกถึง −3 dB ในช่วงที่ sweep' };
      else out.fc = near(f3, fc, 0.03) ? { pass: true } : { pass: false, detail: `กราฟได้ ${f3.toFixed(0)} Hz ทฤษฎี ${fc.toFixed(0)} Hz${d.ref === 'source' ? ' — ใช้อ้างอิง CH2/CH1 เพื่อตัดผล 50 Ω ของเครื่องกำเนิด' : ''}` };
      const sl = slopeDbPerDecade(d, fc * 3, fc * 30);
      const okSlope = sl !== null && Math.abs(sl + 20) <= 1, okPh = ph !== null && Math.abs(ph + 45) <= 2;
      out.slope = okSlope && okPh ? { pass: true } : { pass: false, detail: `ความชัน ${sl === null ? '—' : sl.toFixed(1)} dB/ทศวรรษ, เฟสที่ fc ${ph === null ? '—' : ph.toFixed(1)}°` };
    } else {
      const sl = slopeDbPerDecade(d, fc / 30, fc / 3);
      const okSlope = sl !== null && Math.abs(sl - 20) <= 1, okPh = ph !== null && Math.abs(ph - 45) <= 2;
      out.highpass = okSlope && okPh ? { pass: true } : { pass: false, detail: `ความชัน ${sl === null ? '—' : sl.toFixed(1)} dB/ทศวรรษ, เฟสที่ fc ${ph === null ? '—' : ph.toFixed(1)}°` };
    }
  }
  return out;
};

function codeHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

CHECKERS['pico'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, on: { pass: false }, off: { pass: false }, button: { pass: false }, follow: { pass: false } };
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  if (!pc) return out;
  const GND = x.net(pc.id, 'GND'), V33 = x.net(pc.id, '3V3');
  const gpNets = new Map<number, number>(PICO_GPIO.filter((g) => g > 1).map((g) => [x.net(pc.id, `GP${g}`), g]));
  // LED + R อนุกรมระหว่าง GPx กับ GND (ลำดับใดก็ได้)
  let led: { id: string; gp: number } | null = null;
  let noResistor = false;
  for (const l of x.leds()) {
    const A = x.net(l.id, 'A'), K = x.net(l.id, 'K');
    if (gpNets.has(A) && K === GND) { noResistor = true; continue; }
    for (const r of x.resistors()) {
      const rn = x.resNets(r);
      if (K === GND && rn.includes(A)) { const other = rn.find((n) => n !== A)!; if (gpNets.has(other)) led = { id: l.id, gp: gpNets.get(other)! }; }
      if (gpNets.has(A) && rn.includes(K) && rn.includes(GND)) led = { id: l.id, gp: gpNets.get(A)! };
    }
  }
  if (!led) out.wiring = { pass: false, detail: noResistor ? 'LED ต่อตรงจากขา GPIO ลง GND — ต้องมีตัวต้านทานจำกัดกระแสอนุกรม' : 'ต่อ GPx → ตัวต้านทาน → LED (A→K) → GND ของ Pico' };
  else out.wiring = { pass: true };
  const ach = x.c.work.achieved?.['pico'] ?? {};
  if (led) {
    const I = x.I(led.id);
    if (I > 1e-3 && I <= 0.012) out.on = { pass: true };
    else if (I > 0.012) out.on = { pass: false, detail: `กระแส ${(I * 1000).toFixed(1)} mA เกิน 12 mA — เพิ่มค่าตัวต้านทาน` };
    if (Math.abs(I) < 1e-5 && x.c.result.ok) out.off = { pass: true };
    // ปุ่ม: สวิตช์ระหว่าง GP อื่นกับ GND หรือ 3V3
    // สวิตช์เลื่อน (A–B) หรือปุ่มกด 4 ขา (หน้าสัมผัส 1–3)
    const sw = x.c.doc.parts.find((p): p is SwitchPart | PushbuttonPart => {
      if (p.kind !== 'switch' && p.kind !== 'pushbutton') return false;
      const a = p.kind === 'switch' ? x.net(p.id, 'A') : x.net(p.id, '1'), b = p.kind === 'switch' ? x.net(p.id, 'B') : x.net(p.id, '3');
      if (a === b) return false;
      const gp = gpNets.has(a) ? a : gpNets.has(b) ? b : -1;
      const other = gp === a ? b : a;
      return gp >= 0 && gpNets.get(gp) !== led!.gp && (other === GND || other === V33);
    });
    if (sw) {
      out.button = { pass: true };
      const on = I > 1e-3, offNow = Math.abs(I) < 1e-5;
      const pressed = sw.kind === 'switch' ? sw.params.closed : sw.params.pressed;
      // จดจำสิ่งที่เห็นแยกตามรุ่นของโค้ด (โค้ดไฟกะพริบจะเห็นทั้งติดและดับในสถานะเดียวกัน จึงไม่นับว่า "ทำตาม")
      const tag = `:${codeHash(pc.params.code)}`;
      const mark = (k: string) => { out[k + tag] = { pass: true }; };
      if (pressed && on) mark('_pressOn');
      if (!pressed && offNow) mark('_releaseOff');
      if (pressed && offNow) mark('_pressOff');
      if (!pressed && on) mark('_releaseOn');
      const seen = (k: string) => !!ach[k + tag] || !!out[k + tag]?.pass;
      const direct = seen('_pressOn') && seen('_releaseOff') && !seen('_pressOff') && !seen('_releaseOn');
      const inverse = seen('_pressOff') && seen('_releaseOn') && !seen('_pressOn') && !seen('_releaseOff');
      if (direct || inverse) out.follow = { pass: true };
      else out.follow = { pass: false, detail: 'สลับสวิตช์ทั้งสองสถานะ แล้วดูว่า LED ทำตาม (ต้องรันโค้ดที่อ่านขาเข้า)' };
    } else out.button = { pass: false, detail: 'ต่อสวิตช์ระหว่างขา GPIO (ไม่ใช่ขาของ LED) กับ GND' };
  }
  return out;
};

export function checkLesson(lessonId: string, c: CheckContext | null): Record<string, GoalStatus> {
  const chk = CHECKERS[lessonId];
  if (!chk) return {};
  if (!c || !c.result.ok) {
    const base = chk(new Ctx(emptyCtx(c)));
    return Object.fromEntries(Object.keys(base).map((k) => [k, NOT_RUN]));
  }
  return chk(new Ctx(c));
}

function emptyCtx(c: CheckContext | null): CheckContext {
  return {
    doc: { breadboards: [], parts: [], wires: [], probes: { red: null, black: null } },
    built: { netlist: { nodeCount: 0, elements: [] }, connectivity: { nets: [], netOf: new Map() }, inactive: [] },
    result: { ok: false, nodeVoltage: [], component: [], energized: [], elements: {}, iterations: 0, modeIterations: 0, solveMs: 0 },
    analysis: { ok: false, parts: {}, probe: { value: null }, diagnostics: [] },
    work: c?.work ?? { lessonId: null, records: {}, answers: {}, achieved: {} },
  };
}

CHECKERS['logic'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, inputs: { pass: false }, output: { pass: false }, truth: { pass: false }, second: { pass: false } };
  const ics = x.c.doc.parts.filter((p): p is LogicPart => p.kind === 'logic');
  if (!ics.length) return out;
  const ach = x.c.work.achieved?.['logic'] ?? {};
  const poss = new Set<number>(), negs = new Set<number>();
  for (const s of x.supplies()) { poss.add(x.net(s.id, 'pos')); negs.add(x.net(s.id, 'neg')); }
  for (const p of x.c.doc.parts) if (p.kind === 'pico') { poss.add(x.net(p.id, '3V3')); poss.add(x.net(p.id, 'VBUS')); for (const n of ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38']) negs.add(x.net(p.id, n)); }
  const viaR = (a: number, set: Set<number>) => x.resistors().some((r) => { const n = x.resNets(r); return (n[0] === a && set.has(n[1])) || (n[1] === a && set.has(n[0])); });
  const rails = new Set<number>([...poss, ...negs]);
  const leds = x.leds();
  // เกตที่ใช้งาน = ขาออกขับ LED (ตรงหรือผ่านตัวต้านทาน)
  let best: { u: LogicPart; g: ReturnType<typeof logicGates>[number] } | null = null;
  for (const u of ics) for (const g of logicGates(u.params.model)) {
    const Y = x.net(u.id, g.out);
    if (leds.some((l) => { const A = x.net(l.id, 'A'); return A === Y || viaR(A, new Set([Y])); })) { best = { u, g }; break; }
  }
  const u = best?.u ?? ics[0];
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!poss.has(x.net(u.id, 'VCC')) || !negs.has(x.net(u.id, 'GND'))) out.power = { pass: false, detail: 'ต่อขา 14 (VCC) เข้าไฟบวก 5 V และขา 7 (GND) เข้ากราวด์' };
  else if (!e || e.vcc < 4.5 || e.vcc > 5.5) out.power = { pass: false, detail: `ตั้งไฟเลี้ยงไอซี 5 V (ตอนนี้ ${e ? e.vcc.toFixed(2) : '—'} V)` };
  else out.power = { pass: true };
  if (!best) { out.output = { pass: false, detail: 'ต่อขาออกของเกต (เช่น 1Y ขา 3) → ตัวต้านทาน 330–1 kΩ → LED → กราวด์' }; }
  else out.output = { pass: true };
  const g = best?.g ?? logicGates(u.params.model)[0];
  const floating = g.inputs.filter((pin) => { const N = x.net(u.id, pin); return !rails.has(N) && !viaR(N, rails); });
  const floatDiag = x.c.analysis.diagnostics.some((d) => d.partId === u.id && d.message.includes('ลอย'));
  if (floating.length || floatDiag) out.inputs = { pass: false, detail: `ขาเข้า ${(floating.length ? floating : g.inputs).join(', ')} ต้องไม่ลอย — ใส่ตัวต้านทาน 10 kΩ ดึงลงกราวด์ แล้วใช้สวิตช์ต่อไปไฟบวก` };
  else out.inputs = { pass: true };
  if (e && best && out.power.pass && out.inputs.pass) {
    const bits = g.inputs.map((pin) => e[`b${pin}`]);
    const q = e[`q${g.n}`];
    const fn = LOGIC_FUNC[u.params.model];
    const want = fn.f(bits[0] === 1, bits[1] === 1);
    const led = leds.find((l) => { const A = x.net(l.id, 'A'); return A === x.net(u.id, g.out) || viaR(A, new Set([x.net(u.id, g.out)])); })!;
    const I = x.I(led.id);
    if (bits.every((b) => b === 0 || b === 1) && (q === 1) === want && (want ? I > 1e-3 : I < 1e-4)) out[`_c${u.params.model}_${bits.join('')}`] = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const done = (m: string) => { const n = LOGIC_FUNC[m as LogicPart['params']['model']].inputs; const combos = n === 1 ? ['0', '1'] : ['00', '01', '10', '11']; return combos.filter((c) => seen(`_c${m}_${c}`)); };
  const models = Object.keys(LOGIC_FUNC);
  const full = models.filter((m) => done(m).length === (LOGIC_FUNC[m as LogicPart['params']['model']].inputs === 1 ? 2 : 4));
  const cur = done(u.params.model);
  out.truth = full.length >= 1 ? { pass: true } : { pass: false, detail: `กดสวิตช์ให้ครบทุกแบบของ ${u.params.model} (ทำแล้ว ${cur.length}/${LOGIC_FUNC[u.params.model].inputs === 1 ? 2 : 4}: ${cur.join(' ') || '—'}) และ LED ต้องตรงกับตารางความจริง` };
  out.second = full.length >= 2 ? { pass: true } : { pass: false, detail: 'เปลี่ยนรุ่นไอซี (เช่น 74HC32 OR) แล้วทดลองให้ครบอีกตาราง' };
  return out;
};

CHECKERS['counter'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, inputs: { pass: false }, clock: { pass: false }, leds: { pass: false }, sequence: { pass: false }, short: { pass: false } };
  const u = x.c.doc.parts.find((p): p is CounterPart => p.kind === 'counter');
  if (!u) return out;
  const ach = x.c.work.achieved?.['counter'] ?? {};
  const poss = new Set<number>(), negs = new Set<number>();
  for (const s of x.supplies()) { poss.add(x.net(s.id, 'pos')); negs.add(x.net(s.id, 'neg')); }
  for (const p of x.c.doc.parts) if (p.kind === 'pico') { poss.add(x.net(p.id, '3V3')); poss.add(x.net(p.id, 'VBUS')); for (const n of ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38']) negs.add(x.net(p.id, n)); }
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!poss.has(x.net(u.id, 'VDD')) || !negs.has(x.net(u.id, 'VSS'))) out.power = { pass: false, detail: 'ต่อขา 16 (VDD) เข้าไฟบวก และขา 8 (VSS) เข้ากราวด์' };
  else if (!e || e.vdd < 4.5 || e.vdd > 15) out.power = { pass: false, detail: `ตั้งไฟเลี้ยง 5–15 V (ตอนนี้ ${e ? e.vdd.toFixed(1) : '—'} V) — ชุดไฟวิ่งทั่วไปใช้ 9 V` };
  else out.power = { pass: true };
  const Q = CD4017_OUTS.map((q) => x.net(u.id, q));
  const RST = x.net(u.id, 'RST'), INH = x.net(u.id, 'INH'), CLK = x.net(u.id, 'CLK');
  const rstQ = Q.indexOf(RST);
  if (!negs.has(INH)) out.inputs = { pass: false, detail: 'ต่อขา 13 CLOCK INHIBIT ลงกราวด์ (VSS) — ถ้าลอยไอซีจริงอาจหยุดนับเอง' };
  else if (!negs.has(RST) && rstQ < 0) out.inputs = { pass: false, detail: 'ต่อขา 15 RESET ลงกราวด์ (หรือต่อเข้าขาออก Q เพื่อกำหนดจำนวนนับ)' };
  else out.inputs = { pass: true };
  const timerOut = x.c.doc.parts.some((p) => p.kind === 'timer555' && x.net(p.id, 'OUT') === CLK);
  const pico = x.c.doc.parts.find((p) => p.kind === 'pico');
  const gpio = !!pico && PICO_GPIO.some((g) => x.net(pico.id, `GP${g}`) === CLK);
  const button = x.c.doc.parts.some((p) => (p.kind === 'pushbutton' || p.kind === 'switch') && pinDefs(p).some((d) => x.net(p.id, d.name) === CLK));
  if (!e) return out;
  const n = e.count;
  out[`_n${n}`] = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const counts = Array.from({ length: 10 }, (_, k) => k).filter((k) => seen(`_n${k}`));
  if (!timerOut && !gpio && !button) out.clock = { pass: false, detail: 'ต่อขา 14 CLOCK เข้าขา 3 (OUT) ของ 555 หรือขา GPIO ของ Pico หรือปุ่มกด' };
  else if (counts.length < 2) out.clock = { pass: false, detail: 'ยังไม่เห็นการนับ — ตรวจว่า 555 สั่นอยู่ (LED ที่ขา 3 กะพริบ) และ RESET / CLK INH ต่อลงกราวด์' };
  else out.clock = { pass: true };
  // LED ที่ขาออก Q (ตรงหรือผ่านตัวต้านทาน)
  const viaR = (a: number, b: number) => a === b || x.resistors().some((r) => { const m = x.resNets(r); return m.includes(a) && m.includes(b); });
  const ledOf = new Map<number, string>();
  for (const l of x.leds()) { const A = x.net(l.id, 'A'); const k = Q.findIndex((q) => viaR(q, A)); if (k >= 0 && !ledOf.has(k)) ledOf.set(k, l.id); }
  if (ledOf.size < 4) out.leds = { pass: false, detail: `ต่อ LED ที่ขาออก Q อย่างน้อย 4 ขา (ตอนนี้ ${ledOf.size}) — ขาออก → LED → ตัวต้านทาน 1 kΩ → กราวด์` };
  else out.leds = { pass: true };
  // LED ติดตรงกับขาที่นับ
  let ok = true;
  for (const [k, id] of ledOf) { const on = x.I(id) > 1e-3; if (on !== (k === n)) ok = false; }
  if (ok && ledOf.has(n) && out.leds.pass) out[`_l${n}`] = { pass: true };
  const lit = [...ledOf.keys()].filter((k) => seen(`_l${k}`));
  const need = rstQ > 0 ? Array.from({ length: rstQ }, (_, k) => k) : Array.from({ length: 10 }, (_, k) => k);
  const allSeen = need.every((k) => seen(`_n${k}`));
  if (allSeen && lit.length >= Math.min(4, ledOf.size) && out.leds.pass) out.sequence = { pass: true };
  else out.sequence = { pass: false, detail: !ok ? 'LED ที่ติดไม่ตรงกับขาที่นับ — ตรวจว่าต่อ LED กับขา Q ถูกขา (ดูผังขาในแผงคุณสมบัติ)' : `ให้วงจรนับครบรอบ 0–${need.length - 1} (เห็นแล้ว: ${counts.join(' ') || '—'}) และ LED ติดตามลำดับ` };
  if (rstQ >= 2) out[`_r${rstQ}_${n}`] = { pass: true };
  if (rstQ >= 2 && Array.from({ length: rstQ }, (_, k) => k).every((k) => seen(`_r${rstQ}_${k}`))) out.short = { pass: true };
  else out.short = { pass: false, detail: 'ลองย้ายสาย RESET (ขา 15) จากกราวด์ไปที่ขาออก Q4 แล้วสังเกตว่านับถึงเท่าไรก่อนวน' };
  return out;
};

CHECKERS['lm35'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, signal: { pass: false }, measure: { pass: false }, sweep: { pass: false }, alarm: { pass: false } };
  const s = x.c.doc.parts.find((p): p is Lm35Part => p.kind === 'lm35');
  if (!s) return out;
  const ach = x.c.work.achieved?.['lm35'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const poss = new Set<number>(), negs = new Set<number>();
  for (const sp of x.supplies()) { poss.add(x.net(sp.id, 'pos')); negs.add(x.net(sp.id, 'neg')); }
  if (pc) { poss.add(x.net(pc.id, 'VBUS')); poss.add(x.net(pc.id, '3V3')); for (const n of ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38']) negs.add(x.net(pc.id, n)); }
  const VS = x.net(s.id, 'VS'), OUT = x.net(s.id, 'OUT'), G = x.net(s.id, 'GND');
  const e = x.c.analysis.parts[s.id]?.extra;
  if (!poss.has(VS) || !negs.has(G)) out.power = { pass: false, detail: 'ต่อ +VS (ขาซ้าย) เข้าไฟ 5 V — Pico: ขา VBUS — และ GND (ขาขวา) เข้ากราวด์ของ Pico' };
  else if (!e || e.vs < 4) out.power = { pass: false, detail: `ไฟเลี้ยง LM35 ต้อง 4–30 V (ตอนนี้ ${e ? e.vs.toFixed(2) : '—'} V) — ถ้าต่อ 3V3 ให้ย้ายไป VBUS` };
  else out.power = { pass: true };
  const adc = pc ? [26, 27, 28].find((g) => x.net(pc.id, `GP${g}`) === OUT) : undefined;
  if (!pc) out.signal = { pass: false, detail: 'วาง Raspberry Pi Pico แล้วต่อ VOUT (ขากลาง) เข้าขา ADC' };
  else if (adc === undefined) out.signal = { pass: false, detail: 'ต่อ VOUT (ขากลาง) เข้าขา ADC ของ Pico: GP26 (ADC0), GP27 หรือ GP28' };
  else out.signal = { pass: true };
  if (!e) return out;
  const T = s.params.temperature;
  const { red, black } = x.probeNets();
  const v = x.c.analysis.probe.value;
  if (red === OUT && negs.has(black ?? -1) && v !== null && out.power.pass) {
    if (Math.abs(v - lm35Vout(T)) <= Math.max(0.005, 0.02 * lm35Vout(T))) out.measure = { pass: true };
    else out.measure = { pass: false, detail: `วัดได้ ${v.toFixed(3)} V แต่ ${T} °C ควรได้ ${lm35Vout(T).toFixed(3)} V` };
  } else if (!ach.measure) out.measure = { pass: false, detail: 'วัดแรงดันที่ VOUT ด้วยโวลต์มิเตอร์ (โพรบแดงที่ขากลาง โพรบดำที่กราวด์) แล้วเทียบกับ 10 mV/°C' };
  if (out.power.pass && out.signal.pass && T >= 2 && T <= 100) out[`_t${Math.floor(T / 10)}`] = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const buckets = Array.from({ length: 11 }, (_, k) => k).filter((k) => seen(`_t${k}`));
  out.sweep = buckets.length >= 3 ? { pass: true } : { pass: false, detail: `ปรับอุณหภูมิในแผงคุณสมบัติอย่างน้อย 3 ช่วง (ห่างกัน ≥ 10 °C) ขณะต่อเข้า ADC — เห็นแล้ว ${buckets.length}/3` };
  // ไฟเตือน: LED ที่ขา GPIO ติดเมื่อร้อน (≥ 35 °C) ดับเมื่อเย็น (≤ 25 °C) ตามโค้ดที่รันอยู่
  if (pc) {
    const GND = x.net(pc.id, 'GND');
    const gp = new Set<number>(PICO_GPIO.map((g) => x.net(pc.id, `GP${g}`)));
    const led = x.leds().find((l) => { const A = x.net(l.id, 'A'), K = x.net(l.id, 'K'); return x.resistors().some((r) => { const n = x.resNets(r); return (gp.has(A) && n.includes(K) && negs.has(n.find((m) => m !== K)!)) || (negs.has(K) && n.includes(A) && gp.has(n.find((m) => m !== A)!)); }) || (gp.has(A) && K === GND); });
    if (!led) out.alarm = { pass: false, detail: 'ต่อ LED เตือน: GP15 → ตัวต้านทาน 330 Ω → LED → GND แล้วเขียนโค้ดให้ติดเมื่ออุณหภูมิเกิน 30 °C' };
    else {
      const on = x.I(led.id) > 1e-3, offNow = x.I(led.id) < 1e-5;
      const tag = `:${codeHash(pc.params.code)}`;
      // ไม่จดสถานะที่ขัดแย้ง: หลังเปลี่ยนอุณหภูมิ LED ยังค้างสถานะเดิมจนโค้ดอ่านรอบถัดไป (ช่วง sleep) ซึ่งเป็นเรื่องปกติ
      if (out.signal.pass) {
        if (T >= 35 && on) out['_hotOn' + tag] = { pass: true };
        if (T <= 25 && offNow) out['_coldOff' + tag] = { pass: true };
      }
      const sn = (k: string) => seen(k + tag);
      if (sn('_hotOn') && sn('_coldOff')) out.alarm = { pass: true };
      else out.alarm = { pass: false, detail: 'ตั้งอุณหภูมิ ≥ 35 °C แล้ว LED ต้องติด และ ≤ 25 °C LED ต้องดับ (รันโค้ดที่อ่าน ADC แล้วสั่ง LED)' };
    }
  }
  return out;
};

CHECKERS['hbridge'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, inputs: { pass: false }, motor: { pass: false }, forward: { pass: false }, reverse: { pass: false }, speed: { pass: false } };
  const u = x.c.doc.parts.find((p): p is HbridgePart => p.kind === 'hbridge');
  if (!u) return out;
  const ach = x.c.work.achieved?.['hbridge'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const m = x.c.doc.parts.find((p): p is MotorPart => p.kind === 'motor');
  const negs = new Set<number>(x.supplies().map((s) => x.net(s.id, 'neg')));
  const picoG = pc ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pc.id, n)) : [];
  const e = x.c.analysis.parts[u.id]?.extra;
  const V1 = x.net(u.id, 'VCC1'), V2 = x.net(u.id, 'VCC2'), G = x.net(u.id, 'GND');
  const sup2 = x.supplies().find((s) => x.net(s.id, 'pos') === V2);
  if (!e || e.vcc1 < 4.5 || e.vcc1 > 7) out.power = { pass: false, detail: `ต่อขา 16 VCC1 เข้า 5 V (Pico: ขา VBUS) — ตอนนี้ ${e ? e.vcc1.toFixed(2) : '—'} V` };
  else if (!sup2) out.power = { pass: false, detail: 'ต่อขา 8 VCC2 เข้าขั้ว + ของแหล่งจ่ายมอเตอร์แยก (เช่น 6 V)' };
  else if (!negs.has(G) && !picoG.includes(G)) out.power = { pass: false, detail: 'ต่อขา GND (4/5/12/13) ลงกราวด์' };
  else if (pc && !picoG.includes(x.net(sup2.id, 'neg'))) out.power = { pass: false, detail: 'ต่อกราวด์ร่วม: ขั้ว − ของแหล่งจ่ายมอเตอร์ GND ของ L293D และ GND ของ Pico' };
  else out.power = { pass: true };
  void V1;
  // คู่ช่องที่มอเตอร์ต่ออยู่: (1Y, 2Y) หรือ (3Y, 4Y)
  const pairs = [{ y: ['1Y', '2Y'], a: ['1A', '2A'], en: 'EN12' }, { y: ['3Y', '4Y'], a: ['3A', '4A'], en: 'EN34' }];
  const mNets = m ? [x.net(m.id, 'A'), x.net(m.id, 'B')] : [];
  const pair = pairs.find((pp) => pp.y.map((y) => x.net(u.id, y)).sort().join() === [...mNets].sort().join());
  out.motor = !m ? { pass: false, detail: 'วางมอเตอร์ DC บนโต๊ะ' } : pair ? { pass: true } : { pass: false, detail: 'ต่อสายมอเตอร์ทั้งสองเส้นเข้าขาออกคู่เดียวกัน: 1Y (ขา 3) และ 2Y (ขา 6)' };
  const gp = new Set<number>(pc ? PICO_GPIO.map((g) => x.net(pc.id, `GP${g}`)) : []);
  const pp = pair ?? pairs[0];
  const enNet = x.net(u.id, pp.en);
  const aOk = pp.a.every((a) => gp.has(x.net(u.id, a)));
  const enOk = gp.has(enNet) || enNet === V1 || (pc && enNet === x.net(pc.id, 'VBUS'));
  if (!aOk) out.inputs = { pass: false, detail: `ต่อขา ${pp.a.join(' และ ')} เข้าขา GPIO ของ Pico คนละขา (เช่น GP14, GP15)` };
  else if (!enOk) out.inputs = { pass: false, detail: `ต่อขา ${pp.en === 'EN12' ? '1 (1,2EN)' : '9 (3,4EN)'} เข้า GPIO (ใช้ PWM ปรับความเร็ว) หรือเข้า 5 V` };
  else out.inputs = { pass: true };
  const mr = m ? x.c.analysis.parts[m.id]?.extra : undefined;
  const ready = out.power.pass && out.inputs.pass && out.motor.pass;
  if (mr && ready) {
    if (mr.rpm > 20) out._fwd = { pass: true };
    if (mr.rpm < -20) out._rev = { pass: true };
    // ความเร็วคงที่ (ไม่ใช่ช่วงเร่ง): กระแสมอเตอร์ใกล้กระแสไม่มีโหลด (< 0.2 A) — ช่วงเร่งกระแสสูงกว่ามาก
    const im = Math.abs(x.c.analysis.parts[m!.id]?.current ?? 1);
    if (Math.abs(mr.rpm) > 20 && im < 0.2) out[`_s${mr.rpm > 0 ? 'p' : 'n'}${Math.round(Math.abs(mr.rpm) / 25)}`] = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.forward = seen('_fwd') ? { pass: true } : { pass: false, detail: 'ให้มอเตอร์หมุนทางหนึ่ง: 1A = 1, 2A = 0, EN = 1' };
  out.reverse = seen('_rev') ? { pass: true } : { pass: false, detail: 'ให้มอเตอร์หมุนกลับทาง: 1A = 0, 2A = 1, EN = 1' };
  const keys = Object.keys({ ...ach, ...out }).filter((k) => /^_s[pn]\d+$/.test(k) && seen(k));
  // ความเร็วคงที่สองระดับในทิศเดียวกัน ต่างกันอย่างน้อย 75 rpm (3 ช่วง × 25 rpm)
  const twoSpeeds = ['p', 'n'].some((d) => { const b = keys.filter((k) => k[2] === d).map((k) => Number(k.slice(3))); return b.length >= 2 && Math.max(...b) - Math.min(...b) >= 3; });
  out.speed = twoSpeeds ? { pass: true } : { pass: false, detail: 'ใช้ PWM ที่ขา EN (en.duty_u16) ให้หมุนคงที่สองความเร็วในทิศเดียวกัน ต่างกันอย่างน้อย 75 rpm' };
  return out;
};

CHECKERS['sonar'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, trigger: { pass: false }, divider: { pass: false }, echo: { pass: false }, sweep: { pass: false } };
  const u = x.c.doc.parts.find((p): p is SonarPart => p.kind === 'sonar');
  if (!u) return out;
  const ach = x.c.work.achieved?.['sonar'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const poss = new Set<number>(x.supplies().map((s) => x.net(s.id, 'pos')));
  const negs = new Set<number>(x.supplies().map((s) => x.net(s.id, 'neg')));
  const picoG = pc ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pc.id, n)) : [];
  if (pc) { poss.add(x.net(pc.id, 'VBUS')); picoG.forEach((g) => negs.add(g)); }
  const VCC = x.net(u.id, 'VCC'), G = x.net(u.id, 'GND'), TRIG = x.net(u.id, 'TRIG'), ECHO = x.net(u.id, 'ECHO');
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!poss.has(VCC) || !negs.has(G)) out.power = { pass: false, detail: 'ต่อ Vcc ของโมดูลเข้า 5 V (Pico: ขา VBUS) และ Gnd เข้ากราวด์ของ Pico' };
  else if (pc && !picoG.includes(G)) out.power = { pass: false, detail: 'ต่อกราวด์ร่วม: Gnd ของโมดูลต้องต่อกับ GND ของ Pico' };
  else if (!e || e.vcc < 4.5 || e.vcc > 5.5) out.power = { pass: false, detail: `ไฟเลี้ยงโมดูลต้อง 5 V (ตอนนี้ ${e ? e.vcc.toFixed(2) : '—'} V) — ถ้าต่อ 3V3 ให้ย้ายไป VBUS` };
  else out.power = { pass: true };
  const gpNet = (g: number) => (pc ? x.net(pc.id, `GP${g}`) : -1);
  const trigGp = PICO_GPIO.find((g) => gpNet(g) === TRIG);
  if (!pc) out.trigger = { pass: false, detail: 'วาง Raspberry Pi Pico แล้วต่อ Trig เข้าขา GPIO' };
  else if (trigGp === undefined) out.trigger = { pass: false, detail: 'ต่อ Trig ของโมดูลเข้าขา GPIO ของ Pico (เช่น GP14) — ขานี้รับ 3.3 V ได้โดยตรง' };
  else out.trigger = { pass: true };
  const direct = PICO_GPIO.find((g) => gpNet(g) === ECHO);
  if (!pc) out.divider = { pass: false, detail: 'ต่อ Echo ผ่านตัวแบ่งแรงดันเข้า GPIO ของ Pico' };
  else if (direct !== undefined) out.divider = { pass: false, detail: `Echo ต่อตรงเข้า GP${direct} — ขา GPIO ทน 3.3 V ต้องใช้ 1 kΩ จาก Echo ถึง GP และ 2 kΩ จาก GP ลงกราวด์` };
  else if (!e || e.vDiv === undefined) out.divider = { pass: false, detail: 'ต่อ Echo —1 kΩ— GP15 —2 kΩ— GND (ตัวต้านทานตัวบนจาก Echo ถึงขา GP ตัวล่างจากขา GP ลงกราวด์ของโมดูล)' };
  else if (e.vDiv > 3.6 || e.vDiv < 2.0) out.divider = { pass: false, detail: `ตัวแบ่งแรงดันให้ ${e.vDiv.toFixed(2)} V ตอน Echo สูง — ต้องอยู่ระหว่าง 2.0–3.6 V (เช่น 1 kΩ / 2 kΩ ≈ 3.3 V)` };
  else if (e.divGp === trigGp) out.divider = { pass: false, detail: 'ขา Echo (ผ่านตัวแบ่ง) กับขา Trig ต้องเป็นคนละ GPIO' };
  else out.divider = { pass: true };
  const ready = out.power.pass && out.trigger.pass && out.divider.pass;
  const d = u.params.distance;
  if (e && ready && e.count > 0 && d <= 400 && d >= 2 && Math.abs(e.width - e.expect) <= 0.02 * e.expect) out[`_d${d}`] = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const ds = Object.keys({ ...ach, ...out }).filter((k) => /^_d\d+$/.test(k) && seen(k));
  if (ds.length >= 1) out.echo = { pass: true };
  else if (e && ready && e.count > 0 && d > 400) out.echo = { pass: false, detail: 'ตอนนี้ตั้ง "ไม่มีวัตถุ" — ECHO ค้าง 38 ms ให้ตั้งระยะ 2–400 cm' };
  else out.echo = { pass: false, detail: ready ? 'รันโค้ดที่ส่งพัลส์ TRIG 10 µs แล้ววัดความกว้าง ECHO (machine.time_pulse_us)' : 'ต่อวงจรให้ครบก่อน (ไฟเลี้ยง Trig และตัวแบ่งแรงดัน Echo)' };
  out.sweep = ds.length >= 3 ? { pass: true } : { pass: false, detail: `ปรับระยะวัตถุในแผงคุณสมบัติอย่างน้อย 3 ค่า แล้วให้โมดูลวัดซ้ำ — วัดแล้ว ${ds.length}/3 ค่า` };
  return out;
};

CHECKERS['shiftreg'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, control: { pass: false }, leds: { pass: false }, chaser: { pass: false }, pattern: { pass: false } };
  const u = x.c.doc.parts.find((p): p is ShiftRegPart => p.kind === 'shiftreg');
  if (!u) return out;
  const ach = x.c.work.achieved?.['shiftreg'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const poss = new Set<number>(), negs = new Set<number>();
  for (const sp of x.supplies()) { poss.add(x.net(sp.id, 'pos')); negs.add(x.net(sp.id, 'neg')); }
  const picoG = pc ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pc.id, n)) : [];
  if (pc) { poss.add(x.net(pc.id, '3V3')); poss.add(x.net(pc.id, 'VBUS')); picoG.forEach((g) => negs.add(g)); }
  const VCC = x.net(u.id, 'VCC'), G = x.net(u.id, 'GND');
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!poss.has(VCC) || !negs.has(G)) out.power = { pass: false, detail: 'ต่อขา 16 (VCC) เข้า 3V3 ของ Pico และขา 8 (GND) ลงกราวด์ของ Pico' };
  else if (pc && !picoG.includes(G)) out.power = { pass: false, detail: 'ต่อกราวด์ร่วม: ขา 8 ของ 74HC595 ต้องต่อกับ GND ของ Pico' };
  else if (!e || e.vcc < 2 || e.vcc > 6) out.power = { pass: false, detail: `ไฟเลี้ยงต้อง 2–6 V (ตอนนี้ ${e ? e.vcc.toFixed(2) : '—'} V)` };
  else if (x.net(u.id, 'SRCLR') !== VCC) out.power = { pass: false, detail: 'ต่อขา 10 (SRCLR) เข้า VCC — ถ้าปล่อยลอยหรือต่อกราวด์ รีจิสเตอร์ถูกล้างตลอด' };
  else if (!negs.has(x.net(u.id, 'OE'))) out.power = { pass: false, detail: 'ต่อขา 13 (OE) ลงกราวด์ — OE ต่ำ = เปิดขาออก QA–QH' };
  else out.power = { pass: true };
  const gpOf = (pin: string) => (pc ? PICO_GPIO.find((g) => x.net(pc.id, `GP${g}`) === x.net(u.id, pin)) : undefined);
  const ctl = ['SER', 'SRCLK', 'RCLK'].map(gpOf);
  if (!pc) out.control = { pass: false, detail: 'วาง Raspberry Pi Pico แล้วต่อ SER, SRCLK, RCLK เข้าขา GPIO' };
  else if (ctl.some((g) => g === undefined)) out.control = { pass: false, detail: `ต่อขาควบคุมเข้า GPIO ของ Pico: ${['ขา 14 SER', 'ขา 11 SRCLK', 'ขา 12 RCLK'].filter((_, k) => ctl[k] === undefined).join(', ')}` };
  else if (new Set(ctl).size < 3) out.control = { pass: false, detail: 'SER, SRCLK และ RCLK ต้องใช้ GPIO คนละขา' };
  else out.control = { pass: true };
  // LED ต่อจากขาออก Qn: Qn → LED → R → กราวด์ หรือ Qn → R → LED → กราวด์
  const leds = x.leds();
  const rs = x.resistors();
  const ledOf = new Map<number, string>();
  HC595_OUTS.forEach((q, k) => {
    const Q = x.net(u.id, q);
    const l = leds.find((d) => {
      const A = x.net(d.id, 'A'), K = x.net(d.id, 'K');
      if (A === Q) return rs.some((r) => { const n = x.resNets(r); return n.includes(K) && negs.has(n.find((m) => m !== K)!); }) || false;
      if (negs.has(K)) return rs.some((r) => { const n = x.resNets(r); return n.includes(A) && n.includes(Q); });
      return false;
    });
    if (l) ledOf.set(k, l.id);
  });
  const missing = HC595_OUTS.filter((_, k) => !ledOf.has(k));
  out.leds = missing.length === 0 ? { pass: true } : { pass: false, detail: `ต่อ LED กับตัวต้านทาน (เช่น 330 Ω) ลงกราวด์ ที่ขาออก ${missing.join(', ')} (ยังขาด ${missing.length}/8)` };
  const ready = out.power.pass && out.control.pass && out.leds.pass;
  if (e && ready && !e.oe) {
    // ไฟในวงจรตรงกับบิตขาออก: บิต 1 → LED ติด (> 1 mA), บิต 0 → ดับ (< 0.1 mA) — ช่วงที่ค่าเปลี่ยนกลางช่วงวัดไม่นับ
    const ok = HC595_OUTS.every((_, k) => { const i = x.I(ledOf.get(k)!); return (e.out >> k) & 1 ? i > 1e-3 : i < 1e-4; });
    if (ok && e.out > 0) out[`_v${e.out}`] = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const vals = Object.keys({ ...ach, ...out }).filter((k) => /^_v\d+$/.test(k) && seen(k)).map((k) => Number(k.slice(2)));
  const hot = HC595_OUTS.map((_, k) => 1 << k).filter((v) => vals.includes(v));
  out.chaser = hot.length === 8 ? { pass: true } : { pass: false, detail: `ทำไฟวิ่ง: ส่งค่า 1, 2, 4, … 128 ให้ LED ติดทีละดวงจาก QA ถึง QH — เห็นแล้ว ${hot.length}/8 ดวง` };
  const multi = vals.filter((v) => v.toString(2).split('1').length - 1 >= 3);
  out.pattern = multi.length >= 1 ? { pass: true } : { pass: false, detail: 'แสดงเลขฐานสองที่มี LED ติดพร้อมกันอย่างน้อย 3 ดวง (เช่น 0b10101010 = 170)' };
  return out;
};

CHECKERS['opto'] = (x) => {
  const out: Record<string, GoalStatus> = { input: { pass: false }, output: { pass: false }, isolated: { pass: false }, switching: { pass: false }, ctr: { pass: false } };
  const u = x.c.doc.parts.find((p): p is OptoPart => p.kind === 'opto');
  if (!u) return out;
  const ach = x.c.work.achieved?.['opto'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const picoG = pc ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pc.id, n)) : [];
  const gp = new Set<number>(pc ? PICO_GPIO.map((g) => x.net(pc.id, `GP${g}`)) : []);
  const A = x.net(u.id, 'A'), K = x.net(u.id, 'K'), C = x.net(u.id, 'C'), E = x.net(u.id, 'E');
  const e = x.c.analysis.parts[u.id]?.extra;
  // ขาเข้า: GPIO → ตัวต้านทาน → ขา 1, ขา 2 → GND ของ Pico (หรือ GPIO → ขา 1 และ ขา 2 → R → GND)
  const viaR = (a: number, set: (n: number) => boolean) => x.resistors().some((r) => { const n = x.resNets(r); return n.includes(a) && set(n.find((m) => m !== a)!); });
  const inOk = (viaR(A, (n) => gp.has(n)) && picoG.includes(K)) || (gp.has(A) && viaR(K, (n) => picoG.includes(n)));
  if (!pc) out.input = { pass: false, detail: 'วาง Raspberry Pi Pico แล้วต่อขาเข้าของ PC817 กับ GPIO' };
  else if (gp.has(A) && picoG.includes(K)) out.input = { pass: false, detail: 'ต่อ GPIO เข้าขา 1 ตรง ๆ ไม่ได้ — ใส่ตัวต้านทานจำกัดกระแส (เช่น 330 Ω) ระหว่าง GPIO กับขา 1' };
  else if (!inOk) out.input = { pass: false, detail: 'ขาเข้า: GP15 → ตัวต้านทาน 330 Ω → ขา 1 (แอโนด), ขา 2 (แคโทด) → GND ของ Pico' };
  else out.input = { pass: true };
  // ขาออก: แหล่งจ่ายแยก + → โหลด → ขา 4, ขา 3 → − ของแหล่งจ่ายเดียวกัน
  const sup = x.supplies().find((s) => x.net(s.id, 'neg') === E);
  const loadOk = !!sup && (viaR(C, (n) => n === x.net(sup.id, 'pos')) || x.leds().some((l) => x.net(l.id, 'K') === C && (x.net(l.id, 'A') === x.net(sup.id, 'pos') || viaR(x.net(l.id, 'A'), (n) => n === x.net(sup.id, 'pos')))));
  if (!sup) out.output = { pass: false, detail: 'ขาออก: ขา 3 (อิมิตเตอร์) → ขั้ว − ของแหล่งจ่าย DC แยก (เช่น 12 V)' };
  else if (!loadOk) out.output = { pass: false, detail: 'ขาออก: ขั้ว + ของแหล่งจ่าย → ตัวต้านทาน 2.2 kΩ → LED → ขา 4 (คอลเลกเตอร์)' };
  else out.output = { pass: true };
  const shareGnd = !!sup && picoG.includes(x.net(sup.id, 'neg'));
  if (!e) out.isolated = { pass: false };
  else if (e.shared || shareGnd) out.isolated = { pass: false, detail: 'ฝั่งขาเข้า (Pico) กับฝั่งขาออก (แหล่งจ่าย 12 V) ต้องไม่มีจุดต่อร่วมกัน — รวมทั้งกราวด์ — ออปโตจึงทำหน้าที่แยกวงจร' };
  else out.isolated = out.input.pass && out.output.pass ? { pass: true } : { pass: false, detail: 'ต่อขาเข้าและขาออกให้ครบก่อน' };
  const ready = out.input.pass && out.output.pass && out.isolated.pass;
  if (e && ready) {
    if (e.iF > 2e-3 && e.iF < 0.03 && e.sat && e.iC > 1e-3) out._on = { pass: true };
    if (e.iF < 1e-5 && e.iC < 1e-6) out._off = { pass: true };
    if (e.iF > 5e-5 && !e.sat && e.vce > 1 && Math.abs(e.ctrMeas - e.ctr) <= 0.05 * e.ctr) out._lin = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.switching = seen('_on') && seen('_off') ? { pass: true } : { pass: false, detail: `ให้ Pico สั่ง GP15 สลับ 1/0 — ขาออกต้องอิ่มตัว (LED ฝั่ง 12 V ติด) และดับ (เห็นแล้ว: ${seen('_on') ? 'ติด' : '—'} / ${seen('_off') ? 'ดับ' : '—'})` };
  out.ctr = seen('_lin') ? { pass: true } : { pass: false, detail: 'เปลี่ยนตัวต้านทานขาเข้าเป็น 10 kΩ ให้ IF เล็กลง ขาออกจะออกจากการอิ่มตัว แล้วดู IC ≈ CTR × IF ในแผงผล' };
  return out;
};

CHECKERS['stepper'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, inputs: { pass: false }, turn: { pass: false }, reverse: { pass: false }, speed: { pass: false } };
  const m = x.c.doc.parts.find((p): p is StepperPart => p.kind === 'stepper');
  if (!m) return out;
  const ach = x.c.work.achieved?.['stepper'] ?? {};
  const pc = x.c.doc.parts.find((p): p is PicoPart => p.kind === 'pico');
  const picoG = pc ? ['GND', 'GND.8', 'GND.13', 'GND.18', 'GND.23', 'GND.28', 'GND.38'].map((n) => x.net(pc.id, n)) : [];
  const e = x.c.analysis.parts[m.id]?.extra;
  const G = x.net(m.id, 'G');
  if (pc && !picoG.includes(G)) out.power = { pass: false, detail: 'ต่อขา − ของบอร์ดขับเข้ากับ GND ของ Pico (กราวด์ร่วม) — ไม่งั้นสัญญาณ IN ไม่มีจุดอ้างอิง' };
  else if (!e || e.vcc < 4.5) out.power = { pass: false, detail: `ต่อขา + ของบอร์ดขับเข้า 5 V (Pico: ขา VBUS) — ตอนนี้ ${e ? e.vcc.toFixed(2) : '—'} V` };
  else out.power = { pass: true };
  const gpOf = (pin: string) => (pc ? PICO_GPIO.find((g) => x.net(pc.id, `GP${g}`) === x.net(m.id, pin)) : undefined);
  const g = STEPPER_INPUTS.map(gpOf);
  if (!pc) out.inputs = { pass: false, detail: 'วาง Raspberry Pi Pico แล้วต่อ IN1–IN4 เข้าขา GPIO' };
  else if (g.some((v) => v === undefined)) out.inputs = { pass: false, detail: `ต่อ ${STEPPER_INPUTS.filter((_, k) => g[k] === undefined).join(', ')} เข้าขา GPIO ของ Pico (เช่น GP10–GP13 ตามลำดับ)` };
  else if (new Set(g).size < 4) out.inputs = { pass: false, detail: 'IN1–IN4 ต้องใช้ GPIO คนละขา' };
  else out.inputs = { pass: true };
  const ready = out.power.pass && out.inputs.pass;
  if (e && ready) {
    // ใช้ค่าสะสมตั้งแต่เริ่มจำลอง (ตำแหน่งสูงสุด/ต่ำสุด จำนวนสเต็ปแต่ละทิศ) — ไม่พลาดแม้การตรวจเห็นผลเป็นช่วง ๆ
    if (Math.max(Math.abs(e.posMax), Math.abs(e.posMin)) >= 1024) out._q = { pass: true };
    if (e.fwd >= 8) out._fwd = { pass: true };
    if (e.rev >= 8) out._rev = { pass: true };
    if (e.missed > 0) out._miss = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.turn = seen('_q') ? { pass: true } : { pass: false, detail: `ป้อนลำดับฮาล์ฟสเต็ป 8 จังหวะซ้ำให้แกนออกหมุนอย่างน้อย 90° (1024 สเต็ป) — ตอนนี้ ${e ? (e.angle as number).toFixed(1) : '—'}°` };
  out.reverse = seen('_fwd') && seen('_rev') ? { pass: true } : { pass: false, detail: 'ให้หมุนกลับทาง: ไล่ลำดับสเต็ปถอยหลัง (d = −1)' };
  out.speed = seen('_miss') ? { pass: true } : { pass: false, detail: 'ลองลดดีเลย์ระหว่างสเต็ปให้เหลือ 0.5 ms (2000 สเต็ป/วินาที) แล้วสังเกตว่ามอเตอร์หลุดสเต็ป (หมุนไม่ได้)' };
  return out;
};

/** แรงดันระหว่างสองเน็ตเมื่อไม่มีมิเตอร์ต่ออยู่ (ปิดมิเตอร์ทุกตัว = ขาเข้า 10 GΩ แล้วคำนวณใหม่) — ใช้แสดงผลการโหลด */
export function unloadedVoltage(doc: CircuitDoc, a: number, b: number): number | null {
  const off = { ...doc, parts: doc.parts.map((p) => (p.kind === 'dmm' ? { ...p, params: { ...p.params, mode: 'off' as const } } : p.kind === 'vom' ? { ...p, params: { ...p.params, sel: 'off' } } : p)) };
  try {
    const r = solveDC(buildNetlist(off).netlist);
    if (!r.ok) return null;
    return (r.nodeVoltage[a] ?? 0) - (r.nodeVoltage[b] ?? 0);
  } catch { return null; }
}

CHECKERS['meters'] = (x) => {
  const out: Record<string, GoalStatus> = { ohm: { pass: false }, dmmV: { pass: false }, vomV: { pass: false }, loading: { pass: false }, current: { pass: false }, vomOhm: { pass: false } };
  const ach = x.c.work.achieved?.['meters'] ?? {};
  const dmms = x.c.doc.parts.filter((p): p is DmmPart => p.kind === 'dmm');
  const voms = x.c.doc.parts.filter((p): p is VomPart => p.kind === 'vom');
  const rs = x.resistors();
  const ex = (id: string) => x.c.analysis.parts[id]?.extra;
  /** ตัวต้านทานที่ขาทั้งสองอยู่ในเน็ตเดียวกับขั้วมิเตอร์ (แตะคร่อมพอดี) */
  const across = (a: number, b: number) => rs.find((r) => { const [p, q] = x.resNets(r); return (p === a && q === b) || (p === b && q === a); });
  const powered = (id: string) => x.c.analysis.diagnostics.some((d) => d.partId === id && d.message.includes('วัดความต้านทานขณะวงจรมีไฟ'));
  for (const m of dmms) {
    const e = ex(m.id);
    if (!e) continue;
    const V = x.net(m.id, 'V'), C = x.net(m.id, 'COM');
    const r = across(V, C);
    if (m.params.mode === 'ohm' && r && !e.ol) {
      if (powered(m.id)) out.ohm = { pass: false, detail: 'วัดความต้านทานขณะวงจรมีไฟ — ปิดเอาต์พุตแหล่งจ่ายหรือถอดสายแหล่งจ่ายก่อน' };
      else if (near(e.value, r.params.resistance)) out._ohm = { pass: true };
      else out.ohm = { pass: false, detail: `DMM อ่านได้ ${(e.value / 1000).toPrecision(4)} kΩ แต่ ${r.label} = ${(r.params.resistance / 1000).toPrecision(4)} kΩ — มีทางขนานอื่น (อุปกรณ์อื่นยังต่ออยู่) หรือไม่?` };
    }
    if (m.params.mode === 'dcv' && r && Math.abs(e.value) > 0.5) out._dmmV = { pass: true };
    if ((m.params.mode === 'dcma' || m.params.mode === 'dca') && !e.blownMa && !e.blownA && Math.abs(e.value) > 1e-6) out._cur = { pass: true };
    if (e.blownMa || e.blownA) out.current = { pass: false, detail: 'ฟิวส์ใน DMM ขาด — ย่านกระแสต้องต่ออนุกรม ห้ามแตะคร่อมแหล่งจ่าย (แก้การต่อแล้วเริ่มจำลองใหม่)' };
  }
  for (const m of voms) {
    const e = ex(m.id);
    if (!e) continue;
    const pos = vomPosition(m.params.sel);
    const P = x.net(m.id, 'P'), C = x.net(m.id, 'COM');
    const r = across(P, C);
    if (pos.mode === 'dcv' && r) {
      if (e.frac < -0.02) out.vomV = { pass: false, detail: 'เข็มตีกลับ — สลับสายแดง (+) กับสายดำ (COM)' };
      else if (e.frac > 1.02) out.vomV = { pass: false, detail: `เข็มตีเกินสเกล — ย่าน ${pos.label} ต่ำเกินไป` };
      else if (e.frac >= 0.1) {
        out._vomV = { pass: true };
        const u = unloadedVoltage(x.c.doc, P, C);
        if (u !== null && Math.abs(u) > 0.1) {
          const drop = (Math.abs(u) - Math.abs(e.value)) / Math.abs(u);
          if (drop > 0.05) out._load = { pass: true, detail: `${e.value.toFixed(2)} V เทียบกับ ${u.toFixed(2)} V` };
          else out.loading = { pass: false, detail: `VOM อ่านได้ ${e.value.toFixed(2)} V ใกล้ค่าจริง ${u.toFixed(2)} V (ต่างกัน ${(drop * 100).toFixed(1)}%) — ใช้ตัวต้านทานค่าสูง (100 kΩ) เพื่อให้เห็นผลการโหลด` };
        }
      } else out.vomV = { pass: false, detail: `เข็มขยับน้อยเกินไป (${(e.frac * 100).toFixed(0)}% ของสเกล) — ลดย่านลง` };
    }
    if (pos.mode === 'ohm' && r && !powered(m.id) && e.frac > 0.03 && e.frac < 0.97 && near(e.ohm, r.params.resistance, 0.1)) out._vomOhm = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  if (!out.ohm.detail) out.ohm = seen('_ohm') ? { pass: true } : { pass: false, detail: dmms.length ? 'ตั้ง DMM เป็น Ω แล้วต่อขั้ว VΩ และ COM ไปแตะคร่อมตัวต้านทานที่ยังไม่ต่อไฟ' : 'วางมัลติมิเตอร์ดิจิทัลจากคลังอุปกรณ์ (หมวดเครื่องมือวัด)' };
  else if (seen('_ohm')) out.ohm = { pass: true };
  out.dmmV = seen('_dmmV') ? { pass: true } : { pass: false, detail: 'ตั้ง DMM เป็น V⎓ แล้วแตะคร่อมตัวต้านทานขณะจ่ายไฟ' };
  if (seen('_vomV')) out.vomV = { pass: true };
  else if (!out.vomV.detail) out.vomV = { pass: false, detail: voms.length ? 'ตั้ง VOM เป็น DCV 10 V แล้วแตะคร่อมตัวต้านทาน (สายแดง + ด้านศักย์สูง)' : 'วางมัลติมิเตอร์แบบเข็มจากคลังอุปกรณ์' };
  if (seen('_load')) out.loading = { pass: true, detail: out._load?.detail };
  else if (!out.loading.detail) out.loading = { pass: false, detail: 'วัดแรงดันคร่อม R2 ของวงแบ่ง 100 kΩ + 100 kΩ ด้วย VOM ย่าน 10 V' };
  if (seen('_cur')) out.current = { pass: true };
  else if (!out.current.detail) out.current = { pass: false, detail: 'ตั้ง DMM เป็น mA⎓ ย้ายสายแดงไปขั้ว mA µA แล้วต่ออนุกรม (ตัดวงจรระหว่างแหล่งจ่ายกับ R1)' };
  out.vomOhm = seen('_vomOhm') ? { pass: true } : { pass: false, detail: 'ปิดแหล่งจ่าย ตั้ง VOM ย่าน Ω ×1k แล้วแตะคร่อมตัวต้านทาน (เข็มควรอยู่ช่วงกลางสเกล)' };
  return out;
};

CHECKERS['scr'] = (x) => {
  const out: Record<string, GoalStatus> = { circuit: { pass: false }, gate: { pass: false }, latch: { pass: false }, off: { pass: false }, rgk: { pass: false } };
  const scr = x.c.doc.parts.find((p): p is ScrPart => p.kind === 'scr');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  if (!scr || !sup) { out.circuit = { pass: false, detail: !scr ? 'วาง SCR 2N5060 บนเบรดบอร์ด' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['scr'] ?? {};
  const A = x.net(scr.id, 'A'), G = x.net(scr.id, 'G'), K = x.net(scr.id, 'K');
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  /** เดินผ่านอุปกรณ์สองขาชนิดที่กำหนดจากเน็ต start ไม่เกิน depth ชั้น — ถึงเน็ต target ได้หรือไม่ */
  const reach = (start: number, target: number, kinds: string[], depth: number, avoid: number[] = []) => {
    let frontier = new Set([start]); const seen = new Set([start, ...avoid]);
    for (let d = 0; d < depth; d++) {
      const nx = new Set<number>();
      for (const n of frontier) for (const p of x.c.doc.parts) {
        if (!kinds.includes(p.kind)) continue;
        const ends = p.kind === 'led' ? ['A', 'K'] : p.kind === 'switch' ? ['A', 'B'] : ['1', '2'];
        const nets = ends.map((e) => x.net(p.id, e));
        if (!nets.includes(n)) continue;
        for (const m of nets) { if (m === target) return true; if (!seen.has(m)) { seen.add(m); nx.add(m); } }
      }
      frontier = nx;
    }
    return false;
  };
  if (K !== neg) out.circuit = { pass: false, detail: 'ขา K (แคโทด, ขาซ้ายเมื่อมองหน้าแบน) ต้องต่อขั้วลบของแหล่งจ่าย' };
  else if (A === pos) out.circuit = { pass: false, detail: 'ขา A ต่อไฟบวกตรง ๆ — ต้องมีโหลด (LED + ตัวต้านทาน) คั่นระหว่างไฟบวกกับขา A' };
  else if (!reach(A, pos, ['resistor', 'led'], 4)) out.circuit = { pass: false, detail: 'ต่อขา A ผ่าน LED และตัวต้านทาน 1 kΩ ไปยังไฟบวก' };
  else out.circuit = { pass: true };
  if (G === pos) out.gate = { pass: false, detail: 'ขาเกตต่อไฟบวกตรง ๆ — ต้องมีตัวต้านทานจำกัดกระแสเกต (เช่น 10 kΩ)' };
  else if (!reach(G, pos, ['resistor', 'switch', 'pushbutton'], 4, [K]) || !x.resistors().some((r) => x.resNets(r).includes(G) && !x.resNets(r).includes(K))) out.gate = { pass: false, detail: 'ต่อเกตผ่านตัวต้านทาน 10 kΩ และสวิตช์ S1 ไปยังไฟบวก' };
  else out.gate = { pass: true };
  out.rgk = x.resistors().some((r) => { const n = x.resNets(r); return n.includes(G) && n.includes(K); }) ? { pass: true } : { pass: false, detail: 'ต่อตัวต้านทาน 1 kΩ จาก G ลง K' };
  const e = x.c.analysis.parts[scr.id]?.extra;
  if (e && out.circuit.pass) {
    if (e.on && Math.abs(e.ig) < 1e-6 && Math.abs(e.ia) >= scr.params.ih) out._latched = { pass: true };
    if (!e.on && (ach._latched || out._latched?.pass)) out._off = { pass: true };
  }
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.latch = seen('_latched') ? { pass: true } : { pass: false, detail: e?.on ? 'SCR ติดแล้ว — ปล่อยสวิตช์เกต (S1) แล้วดูว่ายังติดค้างหรือไม่' : 'ปิดสวิตช์ S1 ชั่วครู่เพื่อป้อนกระแสเกต แล้วเปิด' };
  out.off = seen('_off') ? { pass: true } : { pass: false, detail: 'ขณะ SCR ติดค้าง ปิดสวิตช์ S2 (ลัด A–K) ชั่วครู่ แล้วเปิด — LED ต้องดับและไม่ติดเอง' };
  return out;
};

/** ความต้านทานสมมูลระหว่างเน็ต a กับ b ผ่านตัวต้านทานและพอตเท่านั้น โดยตัดเน็ตที่อยู่ใน cut ออก (ถือว่าเปิดวงจร) — แก้สมการโนดเล็ก ๆ */
function equivResistance(x: Ctx, a: number, b: number, cut: number[]): number | null {
  const edges: Array<[number, number, number]> = [];
  for (const p of x.c.doc.parts) {
    if (p.kind === 'resistor') edges.push([x.net(p.id, '1'), x.net(p.id, '2'), p.params.resistance]);
    else if (p.kind === 'potentiometer') {
      const { resistance: R, position: q, endResistance: re } = p.params;
      edges.push([x.net(p.id, '1'), x.net(p.id, '2'), Math.max(R * q + re, 1e-3)], [x.net(p.id, '2'), x.net(p.id, '3'), Math.max(R * (1 - q) + re, 1e-3)]);
    }
  }
  const use = edges.filter(([u, v]) => u !== v && !cut.includes(u) && !cut.includes(v) && u >= 0 && v >= 0);
  const nodes = [...new Set(use.flatMap(([u, v]) => [u, v]))].filter((n) => n !== a && n !== b);
  if (!use.some(([u, v]) => u === a || v === a)) return null;
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const N = nodes.length;
  const M = Array.from({ length: N }, () => new Array(N + 1).fill(0));
  const volt = (n: number) => (n === a ? 1 : n === b ? 0 : null);
  for (const [u, v, r] of use) {
    const g = 1 / r;
    for (const [p, q] of [[u, v], [v, u]]) {
      const i = idx.get(p); if (i === undefined) continue;
      M[i][i] += g;
      const j = idx.get(q);
      if (j !== undefined) M[i][j] -= g; else M[i][N] += g * (volt(q) ?? 0);
    }
  }
  for (let i = 0; i < N; i++) if (M[i][i] === 0) M[i][i] = 1; // โนดลอย
  for (let c = 0; c < N; c++) {
    let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < N; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c] / M[c][c]; for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k]; }
  }
  const V = (n: number) => { const v = volt(n); if (v !== null) return v; const i = idx.get(n)!; return M[i][N] / M[i][i]; };
  let I = 0;
  for (const [u, v, r] of use) { if (u === a) I += (1 - V(v)) / r; else if (v === a) I += (1 - V(u)) / r; }
  return I > 1e-12 ? 1 / I : null;
}

CHECKERS['lm317'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, formula: { pass: false }, set5: { pass: false }, set9: { pass: false }, minload: { pass: false } };
  const u = x.c.doc.parts.find((p): p is Lm317Part => p.kind === 'lm317');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  if (!u || !sup) { out.wiring = { pass: false, detail: !u ? 'วาง LM317 บนเบรดบอร์ด' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['lm317'] ?? {};
  const IN = x.net(u.id, 'IN'), ADJ = x.net(u.id, 'ADJ'), O = x.net(u.id, 'OUT');
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  const r1p = x.resistors().find((r) => { const n = x.resNets(r); return n.includes(O) && n.includes(ADJ); });
  const r2 = equivResistance(x, ADJ, neg, [O, IN]);
  if (IN !== pos) out.wiring = { pass: false, detail: 'ต่อขา 3 (IN ขาขวา) เข้าขั้ว + ของแหล่งจ่าย' };
  else if (!r1p) out.wiring = { pass: false, detail: 'ต่อ R1 (240 Ω) จากขา 2 (OUT) ไปขา 1 (ADJ)' };
  else if (r2 === null) out.wiring = { pass: false, detail: 'ต่อ R2 (ทริมพอต) จากขา 1 (ADJ) ลงขั้ว − ของแหล่งจ่าย' };
  else out.wiring = { pass: true };
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!e || !r1p || r2 === null) return out;
  const r1 = r1p.params.resistance;
  const vth = lm317Vout(r1, r2, u.params.vref, u.params.iadj);
  const loaded = e.iout - e.vref / r1 >= 1e-3; // มีโหลดภายนอกกินกระแส ≥ 1 mA นอกจาก R1–R2
  const ok = Math.abs(e.vout / vth - 1) <= 0.03 && e.regulating;
  if (ok) out._f = { pass: true };
  out.formula = ok || ach._f ? { pass: true } : { pass: false, detail: `R1 ${r1} Ω, R2 ≈ ${r2.toFixed(0)} Ω → คำนวณได้ ${vth.toFixed(2)} V แต่วัดได้ ${e.vout.toFixed(2)} V${e.headroom < u.params.dropout ? ' (ขาเข้าต่ำเกิน — dropout)' : e.lowLoad ? ' (กระแสต่ำกว่ากระแสโหลดต่ำสุด)' : ''}` };
  if (ok && loaded && Math.abs(e.vout - 5) <= 0.1) out._v5 = { pass: true };
  if (ok && loaded && Math.abs(e.vout - 9) <= 0.1) out._v9 = { pass: true };
  if (e.lowLoad && r1 >= 1000 && e.vout > vth + 0.5) out._low = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.set5 = seen('_v5') ? { pass: true } : { pass: false, detail: `หมุนพอตให้ขาออก 5.0 V ±0.1 V โดยมีโหลด (ตอนนี้ ${e.vout.toFixed(2)} V${loaded ? '' : ', ยังไม่มีโหลด'})` };
  out.set9 = seen('_v9') ? { pass: true } : { pass: false, detail: `หมุนพอตให้ขาออก 9.0 V ±0.1 V โดยมีโหลด (ตอนนี้ ${e.vout.toFixed(2)} V)` };
  out.minload = seen('_low') ? { pass: true } : { pass: false, detail: 'เปลี่ยน R1 เป็น 2.2 kΩ แล้วลบโหลด — ขาออกจะสูงกว่าที่คำนวณ' };
  return out;
};

CHECKERS['ntc'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, probe: { pass: false }, v25: { pass: false }, sweep: { pass: false }, selfheat: { pass: false } };
  const th = x.c.doc.parts.find((p): p is NtcPart => p.kind === 'ntc');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  if (!th || !sup) { out.wiring = { pass: false, detail: !th ? 'วางเทอร์มิสเตอร์ NTC บนเบรดบอร์ด' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['ntc'] ?? {};
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  const t1 = x.net(th.id, '1'), t2 = x.net(th.id, '2');
  // NTC ด้านล่าง (ลงขั้วลบ) หรือด้านบน (ต่อขั้วบวก) ของวงแบ่ง — จุดกลาง = ขาอีกข้าง
  const mid = t1 === neg || t1 === pos ? t2 : t2 === neg || t2 === pos ? t1 : -1;
  const lower = t1 === neg || t2 === neg;
  const rFix = mid >= 0 ? x.resistors().find((r) => { const n = x.resNets(r); return n.includes(mid) && n.includes(lower ? pos : neg); }) : undefined;
  if (mid < 0 || t1 === t2) out.wiring = { pass: false, detail: 'ต่อขาหนึ่งของเทอร์มิสเตอร์เข้าขั้ว − (หรือ +) ของแหล่งจ่าย ขาอีกข้างเป็นจุดกลางของวงแบ่ง' };
  else if (!rFix) out.wiring = { pass: false, detail: `ต่อตัวต้านทานคงที่ (10 kΩ) จากจุดกลางไปขั้ว${lower ? ' +' : ' −'} ของแหล่งจ่าย` };
  else out.wiring = { pass: true };
  const pn = x.probeNets();
  out.probe = mid >= 0 && pn.red === mid && pn.black === neg ? { pass: true } : { pass: false, detail: 'แตะโพรบแดงที่จุดกลางวงแบ่ง และโพรบดำที่ขั้ว − (กราวด์) เพื่อวัด VOUT' };
  const e = x.c.analysis.parts[th.id]?.extra;
  if (!out.wiring.pass || !rFix || !e) return out;
  const vs = sup.params.voltage, rf = rFix.params.resistance, rn = ntcResistance(th.params);
  const vth = lower ? (vs * rn) / (rn + rf) : (vs * rf) / (rn + rf);
  const vm = x.c.analysis.probe.value;
  const okNow = out.probe.pass && vm !== null && Math.abs(vm - vth) <= Math.max(0.01 * vth, 0.005);
  const T = th.params.temperature;
  if (okNow) out[`_t${Math.round(T)}`] = { pass: true };
  if (okNow && Math.abs(T - 25) < 0.01 && Math.abs(rf - 10000) < 1 && lower && Math.abs(vm! - vs / 2) <= 0.05) out._v25 = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.v25 = seen('_v25') ? { pass: true } : { pass: false, detail: `ตั้งอุณหภูมิ 25 °C (ตัวต้านทานคงที่ 10 kΩ ด้านบน, NTC ด้านล่าง) แล้ววัด VOUT ต้องได้ ≈ ${(vs / 2).toFixed(2)} V (ครึ่งหนึ่งของไฟเลี้ยง)` };
  const temps = Object.keys({ ...ach, ...out }).filter((k) => /^_t-?\d+$/.test(k) && seen(k)).map((k) => Number(k.slice(2)));
  out.sweep = temps.length >= 4 ? { pass: true } : { pass: false, detail: `วัด VOUT ที่อุณหภูมิต่างกันอย่างน้อย 4 ค่า (เช่น 0, 25, 60, 100 °C) — วัดแล้ว ${temps.length}/4${temps.length ? ` (${temps.sort((a, b) => a - b).join(', ')} °C)` : ''}` };
  if (e.dT >= 1) out._heat = { pass: true };
  out.selfheat = seen('_heat') ? { pass: true } : { pass: false, detail: 'เปลี่ยนตัวต้านทานคงที่เป็น 1 kΩ แล้วตั้ง 100 °C — ดูคำเตือนความร้อนในตัว (≥ 1 °C)' };
  return out;
};

CHECKERS['comparator'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, inputs: { pass: false }, output: { pass: false }, setpoint: { pass: false }, alarm: { pass: false }, hyst: { pass: false } };
  const u = x.c.doc.parts.find((p): p is ComparatorPart => p.kind === 'comparator');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  const th = x.c.doc.parts.find((p): p is NtcPart => p.kind === 'ntc');
  if (!u || !sup) { out.power = { pass: false, detail: !u ? 'วาง LM393 คร่อมร่องกลางเบรดบอร์ด' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['comparator'] ?? {};
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  out.power = x.net(u.id, 'VCC') === pos && x.net(u.id, 'GND') === neg ? { pass: true } : { pass: false, detail: 'ต่อขา 8 (VCC) เข้าไฟบวก และขา 4 (GND) เข้าขั้วลบของแหล่งจ่าย' };
  // ใช้ช่อง A หรือ B — ช่องที่ขาเข้าต่อกับวงแบ่ง NTC
  const tn = th ? [x.net(th.id, '1'), x.net(th.id, '2')] : [];
  const vtNet = tn.find((n) => n !== pos && n !== neg) ?? -1;
  const ch = (['A', 'B'] as const).find((c) => [x.net(u.id, `IN${c}+`), x.net(u.id, `IN${c}-`)].includes(vtNet)) ?? 'A';
  const P = x.net(u.id, `IN${ch}+`), N = x.net(u.id, `IN${ch}-`), O = x.net(u.id, `OUT${ch}`);
  const pot = x.c.doc.parts.find((p): p is PotentiometerPart => p.kind === 'potentiometer' && [P, N].includes(x.net(p.id, '2')) && x.net(p.id, '2') !== vtNet);
  const rTop = th && vtNet >= 0 ? x.resistors().find((r) => { const n = x.resNets(r); return n.includes(vtNet) && n.includes(pos); }) : undefined;
  const ntcLower = !!th && tn.includes(neg);
  if (!th) out.inputs = { pass: false, detail: 'วางเทอร์มิสเตอร์ NTC เป็นวงแบ่งกับตัวต้านทาน 10 kΩ' };
  else if (vtNet < 0 || ![P, N].includes(vtNet)) out.inputs = { pass: false, detail: 'ต่อจุดกลางวงแบ่ง NTC (VT) เข้าขา 3 (IN+)' };
  else if (!rTop || !ntcLower) out.inputs = { pass: false, detail: 'วงแบ่ง: ตัวต้านทาน 10 kΩ จากไฟบวกลง VT และ NTC จาก VT ลงกราวด์' };
  else if (!pot) out.inputs = { pass: false, detail: `ต่อแกนกลางทริมพอต (ปลายทั้งสองเข้าไฟบวกและกราวด์) เข้าขา ${vtNet === P ? '2 (IN−)' : '3 (IN+)'}` };
  else out.inputs = { pass: true };
  // ขาออก: LED (A ด้านไฟบวก) + ตัวต้านทาน ต่อจากไฟบวกเข้าขาออก
  const led = x.leds().find((l) => x.net(l.id, 'K') === O && (x.net(l.id, 'A') === pos || x.resistors().some((r) => { const n = x.resNets(r); return n.includes(x.net(l.id, 'A')) && n.includes(pos); })));
  out.output = led ? { pass: true } : { pass: false, detail: `ต่อตัวต้านทาน 470 Ω จากไฟบวกไปขา A ของ LED และขา K ของ LED เข้าขา ${ch === 'A' ? '1 (OUTA)' : '7 (OUTB)'}` };
  if (!out.inputs.pass || !th || !rTop || !pot) return out;
  const e = x.c.analysis.parts[u.id]?.extra;
  if (!e) return out;
  const vs = sup.params.voltage, vref = vtNet === P ? e[`vn${ch}`] : e[`vp${ch}`];
  // จุดตัด: VT = VREF → RNTC = R1·VREF/(VS − VREF)
  const rf = rTop.params.resistance;
  const tCut = vref > 0 && vref < vs ? ntcTemperature((rf * vref) / (vs - vref), th.params.r25, th.params.beta) : NaN;
  const rh = x.resistors().find((r) => { const n = x.resNets(r); return n.includes(O) && n.includes(vtNet); });
  // มี RH: แรงดันอ้างอิงที่วัดตอนนี้ไม่ใช่จุดตัดแบบไม่มี RH แต่ยังคิดได้ประมาณ (RH ใหญ่กว่า R1 มาก)
  if (Number.isFinite(tCut) && Math.abs(tCut - 40) <= 2) out._set = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.setpoint = seen('_set') ? { pass: true } : { pass: false, detail: Number.isFinite(tCut) ? `จุดตัดตอนนี้ ≈ ${tCut.toFixed(1)} °C (VREF ${vref.toFixed(3)} V) — หมุนทริมพอตให้ VREF ≈ 1.74 V` : 'หมุนทริมพอตให้แกนกลางได้แรงดันระหว่าง 0–5 V' };
  const il = led ? x.c.analysis.parts[led.id]?.current ?? 0 : 0;
  const T = th.params.temperature;
  if (vtNet === P && Number.isFinite(tCut) && Math.abs(tCut - 40) <= 3) {
    const withRh = !!rh && rh.params.resistance >= 10000;
    if (e[`on${ch}`] && il > 1e-3 && T > tCut) { out._hot = { pass: true }; if (withRh) out._hotH = { pass: true }; }
    if (!e[`on${ch}`] && il < 1e-4 && T < tCut && (ach._hot || out._hot?.pass)) out._cold = { pass: true };
    if (withRh && !e[`on${ch}`] && il < 1e-4 && T < tCut && (ach._hotH || out._hotH?.pass)) out._coldH = { pass: true };
  }
  out.alarm = seen('_hot') && seen('_cold') ? { pass: true } : { pass: false, detail: seen('_hot') ? 'ลดอุณหภูมิ NTC ให้ต่ำกว่าจุดตัด (เช่น 25 °C) — LED ต้องดับ' : vtNet !== P ? 'VT ต้องเข้าขา IN+ (ร้อนขึ้น VT ลด → ต่ำกว่า VREF → ขาออกดึงลง)' : 'ตั้งอุณหภูมิ NTC ให้สูงกว่าจุดตัด (เช่น 45 °C) — LED ต้องติด' };
  out.hyst = seen('_hotH') && seen('_coldH') ? { pass: true } : { pass: false, detail: 'ใส่ตัวต้านทาน 100 kΩ จากขาออกกลับไปขา IN+ (VT) แล้วทดลองร้อน/เย็นอีกครั้ง' };
  return out;
};

CHECKERS['darlington'] = (x) => {
  const out: Record<string, GoalStatus> = { wiring: { pass: false }, flyback: { pass: false }, run: { pass: false }, measure: { pass: false }, off: { pass: false }, minib: { pass: false } };
  const q = x.c.doc.parts.find((p): p is DarlingtonPart => p.kind === 'darlington');
  const m = x.c.doc.parts.find((p): p is MotorPart => p.kind === 'motor');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  if (!q || !m || !sup) { out.wiring = { pass: false, detail: !q ? 'วาง TIP120 บนเบรดบอร์ด' : !m ? 'วางมอเตอร์บนโต๊ะ' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['darlington'] ?? {};
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  const B = x.net(q.id, 'B'), C = x.net(q.id, 'C'), E = x.net(q.id, 'E');
  const ma = x.net(m.id, 'A'), mb = x.net(m.id, 'B');
  const rb = x.resistors().find((r) => x.resNets(r).includes(B));
  const motorOk = (ma === pos && mb === C) || (mb === pos && ma === C);
  if (E !== neg) out.wiring = { pass: false, detail: 'ต่อขา 3 (E) ลงขั้วลบของแหล่งจ่าย' };
  else if (!motorOk) out.wiring = { pass: false, detail: 'ต่อมอเตอร์ระหว่างไฟบวกกับขา 2 (C)' };
  else if (B === pos || !rb) out.wiring = { pass: false, detail: 'ต่อขา 1 (B) ผ่านตัวต้านทาน RB (10 kΩ) และสวิตช์ไปไฟบวก — ห้ามต่อเบสเข้าไฟตรง' };
  else out.wiring = { pass: true };
  const d = x.c.doc.parts.find((p) => p.kind === 'diode' && x.net(p.id, 'K') === pos && x.net(p.id, 'A') === C);
  const dRev = x.c.doc.parts.find((p) => p.kind === 'diode' && x.net(p.id, 'A') === pos && x.net(p.id, 'K') === C);
  out.flyback = d ? { pass: true } : { pass: false, detail: dRev ? 'ไดโอดกลับทิศ (ลัดวงจรเมื่อทรานซิสเตอร์นำ) — แถบ/แคโทดต้องอยู่ด้านไฟบวก' : 'ต่อไดโอด 1N4007 คร่อมมอเตอร์: แอโนดที่ขา C แคโทด (แถบ) ที่ไฟบวก' };
  const e = x.c.analysis.parts[q.id]?.extra, me = x.c.analysis.parts[m.id]?.extra;
  if (!e || !out.wiring.pass) return out;
  const rpm = Math.abs(me?.rpm ?? 0);
  if (rpm > 100 && e.ib < 1e-3 && e.hfe > 100) out._run = { pass: true };
  if (rpm > 100 && e.vbe >= 1.2 && e.vbe <= 1.6 && e.vce < 1.2) out._meas = { pass: true };
  if ((ach._run || out._run?.pass) && e.ic < 1e-3 && rpm < 5) out._off = { pass: true };
  if (rb && rb.params.resistance >= 47000 && e.ib > 1e-6 && e.ic < 0.01) out._min = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  out.run = seen('_run') ? { pass: true } : { pass: false, detail: rpm > 100 ? `กระแสเบส ${(e.ib * 1000).toFixed(2)} mA — ใช้ RB ≥ 10 kΩ ให้กระแสเบสต่ำกว่า 1 mA` : e.ic < 1e-3 ? 'ปิดสวิตช์ S1 ให้กระแสเบสไหล' : `มอเตอร์ยังเร่งไม่ถึง 100 rpm (${rpm.toFixed(0)} rpm) — รอสักครู่` };
  out.measure = seen('_meas') ? { pass: true } : { pass: false, detail: `ตอนนี้ VBE ${e.vbe.toFixed(2)} V, VCE ${e.vce.toFixed(2)} V — ปิด S1 ให้มอเตอร์หมุนแล้วดูแผงผลของ Q1` };
  out.off = seen('_off') ? { pass: true } : { pass: false, detail: 'หลังมอเตอร์หมุนแล้ว เปิดสวิตช์ S1 — มอเตอร์ต้องหยุด' };
  out.minib = seen('_min') ? { pass: true } : { pass: false, detail: 'เปลี่ยน RB เป็น 100 kΩ แล้วปิด S1 — TIP120 แทบไม่นำ (กระแสเบสไหลผ่านตัวต้านทานภายในหมด)' };
  return out;
};

CHECKERS['lm386'] = (x) => {
  const out: Record<string, GoalStatus> = { power: { pass: false }, input: { pass: false }, output: { pass: false }, scope: { pass: false }, gain20: { pass: false }, gain200: { pass: false }, clip: { pass: false } };
  const u = x.c.doc.parts.find((p): p is Lm386Part => p.kind === 'lm386');
  const sp = x.c.doc.parts.find((p): p is SpeakerPart => p.kind === 'speaker');
  const sup = x.supplies()[0] ?? x.c.doc.parts.find((p): p is DcSupplyPart => p.kind === 'dcsupply');
  const fg = x.c.doc.parts.find((p): p is FgenPart => p.kind === 'fgen');
  if (!u || !sup) { out.power = { pass: false, detail: !u ? 'วาง LM386 คร่อมร่องกลางเบรดบอร์ด' : 'วางแหล่งจ่ายไฟ DC' }; return out; }
  const ach = x.c.work.achieved?.['lm386'] ?? {};
  const pos = x.net(sup.id, 'pos'), neg = x.net(sup.id, 'neg');
  const VS = x.net(u.id, 'VS'), G = x.net(u.id, 'GND'), IP = x.net(u.id, 'IN+'), IM = x.net(u.id, 'IN-'), O = x.net(u.id, 'OUT');
  if (VS !== pos || G !== neg) out.power = { pass: false, detail: 'ต่อขา 6 (VS) เข้าไฟบวก และขา 4 (GND) เข้าขั้วลบ' };
  else if (sup.params.voltage < 4 || sup.params.voltage > 12) out.power = { pass: false, detail: 'ตั้งแหล่งจ่าย 4–12 V (เช่น 9 V)' };
  else out.power = { pass: true };
  if (!fg) out.input = { pass: false, detail: 'วางเครื่องกำเนิดสัญญาณ: OUT เข้าขา 3 (+IN), COM ลงกราวด์' };
  else if (x.net(fg.id, 'OUT') !== IP) out.input = { pass: false, detail: 'ต่อขั้ว OUT ของเครื่องกำเนิดสัญญาณเข้าขา 3 (+IN)' };
  else if (x.net(fg.id, 'COM') !== neg) out.input = { pass: false, detail: 'ต่อขั้ว COM ของเครื่องกำเนิดสัญญาณลงกราวด์' };
  else if (IM !== neg) out.input = { pass: false, detail: 'ต่อขา 2 (−IN) ลงกราวด์' };
  else out.input = { pass: true };
  const cap = x.c.doc.parts.find((p): p is CapacitorPart => p.kind === 'capacitor' && x.net(p.id, 'P') === O && p.params.capacitance >= 47e-6);
  const spN = sp ? [x.net(sp.id, 'P'), x.net(sp.id, 'N')] : [];
  if (!sp) out.output = { pass: false, detail: 'วางลำโพง 8 Ω บนโต๊ะ' };
  else if (spN.includes(O)) out.output = { pass: false, detail: 'ลำโพงต่อตรงขาออก — ต้องคั่นด้วยตัวเก็บประจุ 220–250 µF (ขา + ทางขา 5)' };
  else if (!cap) out.output = { pass: false, detail: 'ต่อตัวเก็บประจุอิเล็กโทรไลต์ ≥ 100 µF จากขา 5 (ขา +) ไปลำโพง' };
  else if (!(spN.includes(x.net(cap.id, 'N')) && spN.includes(neg))) out.output = { pass: false, detail: 'ต่อขา − ของตัวเก็บประจุเข้าลำโพง และขั้วอีกข้างของลำโพงลงกราวด์' };
  else out.output = { pass: true };
  const sc = x.c.doc.parts.find((p): p is ScopePart => p.kind === 'scope');
  const outSide = cap ? x.net(cap.id, 'N') : -2;
  if (!sc) out.scope = { pass: false, detail: 'วางออสซิลโลสโคป: CH1 ที่ขา 3 (ขาเข้า), CH2 ที่ลำโพง (หลังตัวเก็บประจุ) หรือขา 5' };
  else if (x.net(sc.id, 'CH1') !== IP) out.scope = { pass: false, detail: 'ต่อ CH1 ของสโคปที่ขา 3 (+IN)' };
  else if (![O, outSide].includes(x.net(sc.id, 'CH2'))) out.scope = { pass: false, detail: 'ต่อ CH2 ของสโคปที่ลำโพง (หลังตัวเก็บประจุ) หรือขา 5' };
  else if (x.net(sc.id, 'GND') !== neg) out.scope = { pass: false, detail: 'ต่อ GND ของสโคปลงกราวด์' };
  else out.scope = { pass: true };
  const e = x.c.analysis.parts[u.id]?.extra;
  const [m1, m2] = x.c.scopeMeasure ?? [null, null];
  if (!out.power.pass || !out.input.pass || !out.output.pass || !out.scope.pass || !e) return out;
  const vs = sup.params.voltage;
  const g = m1 && m2 && m1.vpp > 1e-3 ? m2.vpp / m1.vpp : null;
  const clipped = !!m2 && m2.vpp > vs - 2.6;
  if (g !== null && !clipped && !e.gain200 && g >= 17 && g <= 23) out._g20 = { pass: true };
  if (g !== null && !clipped && e.gain200 && g >= 170 && g <= 230) out._g200 = { pass: true };
  if (clipped && g !== null) out._clip = { pass: true };
  const seen = (k: string) => !!ach[k] || !!out[k]?.pass;
  const now = g === null ? 'กด Run แล้วรอให้มีรูปคลื่นทั้งสองช่องบนจอสโคป' : `ตอนนี้ ${m2!.vpp.toFixed(3)} / ${m1!.vpp.toFixed(4)} Vpp = ${g.toFixed(1)} เท่า${clipped ? ' (ขาออกถูกตัดยอด — ลดสัญญาณเข้า)' : ''}`;
  out.gain20 = seen('_g20') ? { pass: true } : { pass: false, detail: e.gain200 ? 'ถอดตัวเก็บประจุขา 1–8 ออกก่อน แล้ววัดอัตราขยาย 20 เท่า' : now };
  out.gain200 = seen('_g200') ? { pass: true } : { pass: false, detail: e.gain200 ? now : 'ใส่ตัวเก็บประจุ 10 µF ระหว่างขา 1 (+) กับขา 8 แล้ววัดอัตราขยาย ≈ 200 เท่า (สัญญาณเข้า 20 mVpp)' };
  out.clip = seen('_clip') ? { pass: true } : { pass: false, detail: 'เพิ่มสัญญาณเข้า (เช่น 60 mVpp ที่อัตราขยาย 200) จนยอดคลื่นขาออกแบน แล้วสังเกตเสียงและคำเตือนกำลังลำโพง' };
  return out;
};
