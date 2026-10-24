import type { ToneMeter } from '../sim/tone';
import type { McuSpec, Netlist, NetlistElement } from '../sim/netlist';
import { hasReactive } from '../sim/netlist';
import { solveDC, voltageBetween, type ElementResult, type SimResult } from '../sim/solver';
import { advance, newTranState, nextSonarEvent, restart, type TranState } from '../sim/transient';
import type { EngineRequest, EngineResponse, Sample, WatchItem } from '../sim/engine';
import { readWatch } from '../sim/engine';
import { FIRMWARE_B64, LFS_HEAD_B64 } from './firmware-data';
import { PicoEmulator, RawReplFilter, decodeB64, rawRunBytes, type PinMode } from './pico-emu';

/**
 * การจำลองร่วม (co-simulation) ไมโครคอนโทรลเลอร์ + วงจร
 *
 * เวลา: นาฬิกาของ CPU ที่จำลองคือเวลาของวงจร
 * วงจรไม่มี C/L (ตอบสนองทันที): แบบ "ตามเหตุการณ์" — CPU ทำงานจนกว่าสถานะขาใดเปลี่ยน แล้วแก้วงจรใหม่ทันที
 *   และตั้งค่าขาเข้า/ADC จากแรงดันที่คำนวณได้ ก่อน CPU ทำงานต่อ (ไม่มีความหน่วงระหว่างขาออกกับขาเข้า)
 *   ค่าที่แสดง (มิเตอร์, ความสว่าง LED) = ค่าเฉลี่ยถ่วงเวลาในแต่ละช่วง 50 ms เหมือนมัลติมิเตอร์จริง
 *   คำตอบของแต่ละสถานะขาถูกเก็บไว้ (cache) จึงรองรับ PWM ได้โดยไม่ต้องแก้วงจรซ้ำ
 * วงจรมี C/L: เดินเวลาวงจร (transient) เป็นช่วงสั้นไม่เกิน QUANTUM หรือถึงเหตุการณ์ขาเปลี่ยน แล้วอัปเดตขาเข้า
 *
 * แบบจำลองขา GPIO (ประมาณจาก datasheet RP2040, drive 4 mA):
 *   ขาออก = แหล่ง 3.3 V หรือ 0 V ต่ออนุกรม 80 Ω (จำกัดกระแสลัดวงจร 50 mA)
 *   ขาเข้า: pull-up/pull-down ≈ 50 kΩ, ระดับลอจิก: สูงเมื่อ > 1.8 V, ต่ำเมื่อ < 1.4 V (มี hysteresis)
 *   ADC (GP26–28): 0–3.3 V → 0–4095 (12 บิต)
 *   ขา 3V3 = 3.3 V จากเรกูเลเตอร์ (≤ 300 mA), VBUS = 5 V จาก USB, VSYS ≈ 4.7 V
 */

export const GPIO_R_OUT = 80;
export const GPIO_R_PULL = 50e3;
export const V_IH = 1.8;
export const V_IL = 1.4;
const QUANTUM = 50e-6;
/** ช่วงยาวขึ้นเมื่อไม่มีขาใดของบอร์ดที่ต้องอ่านค่าจากวงจร (ขาเข้า/ADC ที่ต่อวงจร) — ขาออกเปลี่ยนเมื่อไรก็หยุดตรงขอบอยู่แล้ว */
const QUANTUM_OUT_ONLY = 1e-3;
const MAX_EVENTS = 20000;

export interface McuCommand {
  /** ไบต์ที่พิมพ์เข้า REPL */
  serial?: number[];
  /** โค้ดที่จะรันผ่าน raw REPL */
  run?: string;
  /** หยุดโปรแกรม (Ctrl-C) */
  stop?: boolean;
}

export interface McuStatus {
  id: string;
  console: string;
  /** โปรแกรมที่ส่งไปกำลังทำงาน */
  running: boolean;
  /** ผลของโปรแกรมที่เพิ่งจบ */
  finished: null | { ok: boolean };
  booted: boolean;
  pins: PinMode[];
  /** สัดส่วนเวลาที่ขาเป็น HIGH ในช่วงล่าสุด (ขาออก) — ใช้แสดง PWM */
  duty: number[];
  /** ความสว่าง LED บนบอร์ด (GP25) 0–1 */
  led: number;
  /** คำสั่งที่ประมวลผลต่อวินาทีจริง (ล้านคำสั่ง) */
  mips: number;
  /** อัตราส่วนเวลาจำลอง/เวลาจริงในคำขอล่าสุด */
  ratio: number;
}

export function pinElements(m: McuSpec, modes: PinMode[], used: (net: number) => boolean): NetlistElement[] {
  const S = (id: string, p: number, V: number, Rint: number, Ilim: number): NetlistElement => ({ type: 'SUPPLY', id: `${m.id}#${id}`, p, n: m.gnd, V, Rint, Ilim });
  const out: NetlistElement[] = [];
  if (used(m.v33)) out.push(S('3V3', m.v33, 3.3, 0.05, 0.3));
  if (used(m.vbus)) out.push(S('VBUS', m.vbus, 5, 0.1, 0.5));
  if (used(m.vsys)) out.push(S('VSYS', m.vsys, 4.7, 0.2, 0.5));
  if (used(m.vref)) out.push(S('ADC_VREF', m.vref, 3.3, 200, 0.05));
  m.gp.forEach((net, i) => {
    if (net < 0 || !used(net)) return;
    const mode = modes[i];
    if (mode === 'out-high') out.push(S(`GP${i}`, net, 3.3, GPIO_R_OUT, 0.05));
    else if (mode === 'out-low') out.push(S(`GP${i}`, net, 0, GPIO_R_OUT, 0.05));
    else if (mode === 'in-pullup') out.push(S(`GP${i}`, net, 3.3, GPIO_R_PULL, 1));
    else if (mode === 'in-pulldown') out.push(S(`GP${i}`, net, 0, GPIO_R_PULL, 1));
  });
  return out;
}

/** เน็ตที่มีอุปกรณ์อื่นต่ออยู่ (ขา MCU ที่ไม่ได้ต่ออะไรไม่ต้องสร้างแหล่งแรงดัน) */
function usedNets(nl: Netlist): Set<number> {
  const s = new Set<number>();
  for (const e of nl.elements) {
    if (e.type === 'R' || e.type === 'C' || e.type === 'L') { s.add(e.a); s.add(e.b); }
    else if (e.type === 'LED' || e.type === 'D') { s.add(e.a); s.add(e.k); }
    else if (e.type === 'BJT') { s.add(e.c); s.add(e.b); s.add(e.e); }
    else if (e.type === 'MOS') { s.add(e.d); s.add(e.g); s.add(e.s); }
    else if (e.type === 'OPAMP') { [e.inp, e.inn, e.out, e.vp, e.vn].forEach((n) => s.add(n)); }
    else { s.add(e.p); s.add(e.n); }
  }
  // ขาของ MCU ด้วยกันที่ต่อถึงกันผ่านสาย (เช่น GP2 → GP3)
  const cnt = new Map<number, number>();
  for (const m of nl.mcus ?? []) for (const n of [...m.gp, m.v33, m.vbus, m.vsys, m.vref]) if (n >= 0) cnt.set(n, (cnt.get(n) ?? 0) + 1);
  for (const [n, c] of cnt) if (c > 1) s.add(n);
  return s;
}

class Board {
  emu = new PicoEmulator(decodeB64(FIRMWARE_B64), decodeB64(LFS_HEAD_B64));
  filter = new RawReplFilter();
  console = '';
  booted = false;
  autorunDone = false;
  finished: null | { ok: boolean } = null;
  /** ผู้ใช้สั่งหยุด — ส่ง Ctrl-C ซ้ำทุกคำขอจนโปรแกรมจบ (Ctrl-C ที่มาถึงก่อนโปรแกรมเริ่มจะไม่มีผล) */
  stopPending = false;
  /** เวลา HIGH สะสมต่อขา (ns) ในช่วงล่าสุด */
  highNs = new Float64Array(30);
  lastLevel = new Uint8Array(30);
  constructor(readonly id: string) {}

  modes(): PinMode[] {
    const m: PinMode[] = [];
    for (let i = 0; i < 30; i++) m.push(this.emu.pinMode(i));
    // GP0 = UART TX ของ REPL: ว่างอยู่ที่ HIGH (ตัวจำลองไม่ส่งสัญญาณบิตออกขา)
    m[0] = 'out-high';
    return m;
  }

  pump() {
    const r = this.filter.feed(this.emu.takeSerial());
    this.console += r.text;
    if (!this.booted && this.console.includes('>>> ')) this.booted = true;
    if (r.finished) { this.finished = r.finished; this.emu.sendSerial([2]); }
  }

  runCode(code: string) {
    this.filter.start();
    this.finished = null;
    this.emu.sendSerial(rawRunBytes(code));
  }
}

export class McuCosim {
  private boards = new Map<string, Board>();
  private st: TranState = newTranState();
  private cache = new Map<string, SimResult>();
  /** สถานะรีเลย์ล่าสุด (โหมด DC ที่มี Pico) */
  private relayStates: Record<string, boolean> = {};
  private cacheNl = '';
  private wall0 = 0;

  reset() {
    this.boards.clear();
    restart(this.st);
    this.cache.clear();
    this.relayStates = {};
  }

  handle(req: EngineRequest, cmds: Record<string, McuCommand> = {}, tone?: ToneMeter): EngineResponse & { mcu: McuStatus[] } {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const deadline = t0 + req.budgetMs;
    const nl = req.netlist;
    const specs = nl.mcus ?? [];
    if (req.restart) this.reset();
    for (const id of [...this.boards.keys()]) if (!specs.some((m) => m.id === id)) this.boards.delete(id);
    for (const m of specs) if (!this.boards.has(m.id)) this.boards.set(m.id, new Board(m.id));
    const boards = specs.map((m) => this.boards.get(m.id)!);
    const main = boards[0];
    const emu = main.emu;
    // คำสั่งจากผู้ใช้
    for (const b of boards) {
      const c = cmds[b.id];
      if (!c) continue;
      if (c.stop) { b.emu.sendSerial([3, 3]); b.stopPending = b.filter.running; }
      if (c.run !== undefined) b.runCode(c.run);
      if (c.serial?.length) b.emu.sendSerial(c.serial);
    }
    for (const b of boards) {
      if (b.stopPending && b.filter.running) b.emu.sendSerial([3]);
      else b.stopPending = false;
    }
    const tran = hasReactive(nl);
    const nlKey = JSON.stringify(nl.elements) + JSON.stringify(specs.map((m) => ({ ...m, autorun: null })));
    if (nlKey !== this.cacheNl) { this.cache.clear(); this.cacheNl = nlKey; }
    const used = usedNets(nl);
    const isUsed = (n: number) => used.has(n);
    const tStartNs = emu.nanos;
    const targetNs = tStartNs + Math.max(0, req.advance) * 1e9;
    const spacing = Math.max(req.sampleSpacing ?? req.advance / 120, req.advance / 8000, 1e-7);
    const samples: Sample[] = [];
    let lastSampleT = -Infinity;
    const pushSample = (t: number, r: SimResult, force = false) => {
      tone?.feed(t, r);
      if (force || t - lastSampleT >= spacing) { samples.push({ t, v: readWatch(r, req.watch) }); lastSampleT = t; }
    };
    for (const b of boards) { b.highNs.fill(0); }
    const instr0 = boards.reduce((a, b) => a + b.emu.instructions, 0);

    const expanded = (): { key: string; nl: Netlist } => {
      const els: NetlistElement[] = [...nl.elements];
      let key = '';
      specs.forEach((m, k) => {
        const modes = boards[k].modes();
        key += modes.map((x, i) => (m.gp[i] >= 0 && used.has(m.gp[i]) ? x : '')).join(',') + '|';
        els.push(...pinElements(m, modes, isUsed));
      });
      // รีเลย์มี hysteresis: สถานะก่อนหน้าเป็นส่วนหนึ่งของคำตอบ (คีย์แคชต้องรวมสถานะ)
      const latches = [...(nl.relays ?? []), ...(nl.timers ?? []), ...(nl.gates ?? [])].map((r) => r.id);
      for (const c of nl.counters ?? []) for (let k = 0; k < 10; k++) latches.push(`${c.id}#q${k}`);
      for (const d of nl.drivers ?? []) latches.push(`${d.id}#e`, `${d.id}#h`);
      // 74HC595: รวมทุกสถานะ (บิตและระดับนาฬิกาครั้งก่อน) — คำตอบที่เก็บไว้จึงตรงกับการแก้ใหม่ทุกครั้ง
      for (const s of nl.shiftregs ?? []) for (const x of ['sck', 'rck', 'oe', ...Array.from({ length: 8 }, (_, k) => `s${k}`), ...Array.from({ length: 8 }, (_, k) => `o${k}`)]) latches.push(`${s.id}#${x}`);
      for (const e of nl.elements) if (e.type === 'R' && e.fuse) latches.push(`${e.id}#blown`);
      for (const c of nl.scrs ?? []) latches.push(c.id);
      for (const c of nl.comps ?? []) latches.push(c.id);
      if (latches.length) key += 'R' + latches.map((id) => (this.relayStates[id] ? 1 : 0)).join('');
      return { key, nl: { ...nl, nodeCount: nl.nodeCount, elements: els } };
    };
    /** ตั้งขาเข้าและ ADC จากแรงดันที่คำนวณได้ */
    const applyInputs = (r: SimResult) => {
      if (!r.ok) return;
      specs.forEach((m, k) => {
        const b = boards[k];
        m.gp.forEach((net, i) => {
          if (net < 0 || i === 0 || i === 1) return;
          const v = voltageBetween(r, net, m.gnd).value;
          const mode = b.emu.pinMode(i);
          let high: boolean;
          if (v === null) high = mode === 'in-pullup' || mode === 'out-high';
          else high = b.lastLevel[i] ? v > V_IL : v > V_IH;
          b.lastLevel[i] = high ? 1 : 0;
          b.emu.setInput(i, high);
          if (i >= 26 && i <= 29) b.emu.setAdc(i - 26, v ?? 0);
        });
      });
    };
    /** สถานะ HIGH ของขาก่อนช่วงเวลาที่จะเดิน (ใช้สะสม duty) */
    const highNow = () => boards.map((b) => Array.from({ length: 30 }, (_, i) => b.emu.pinMode(i) === 'out-high'));
    const accHigh = (before: boolean[][], dtNs: number) => {
      boards.forEach((b, k) => { for (let i = 0; i < 30; i++) if (before[k][i]) b.highNs[i] += dtNs; });
    };
    const runBoards = (until: number, stopOnPin: boolean) => {
      // บอร์ดหลักกำหนดเวลา บอร์ดอื่นวิ่งตามให้ถึงเวลาเดียวกัน
      const r = emu.run(until, deadline, stopOnPin);
      for (const b of boards) if (b !== main) b.emu.run(emu.nanos, Infinity, false);
      for (const b of boards) b.pump();
      return r;
    };

    let result: SimResult | null = null;
    let reached = true;
    let steps = 0;
    if (!tran) {
      const weights = new Map<string, number>();
      let events = 0;
      for (;;) {
        const ex = expanded();
        let r = this.cache.get(ex.key);
        if (!r) { r = solveDC(ex.nl, { relayStates: this.relayStates }); delete r.x; this.cache.set(ex.key, r); }
        if (r.relayStates) this.relayStates = { ...r.relayStates };
        steps++;
        applyInputs(r);
        result = r;
        const ta = emu.nanos;
        const hi = highNow();
        pushSample(ta / 1e9, r, true);
        if (emu.nanos >= targetNs) { weights.set(ex.key, (weights.get(ex.key) ?? 0) + 1e-9); break; }
        const why = runBoards(targetNs, true);
        const dt = emu.nanos - ta;
        weights.set(ex.key, (weights.get(ex.key) ?? 0) + dt);
        accHigh(hi, dt);
        pushSample(emu.nanos / 1e9, r);
        if (why === 'deadline' || ++events > MAX_EVENTS) { reached = emu.nanos >= targetNs; break; }
        if (why === 'target') break;
      }
      // ค่าเฉลี่ยถ่วงเวลา (เหมือนมัลติมิเตอร์ที่เฉลี่ยค่าในช่วงวัด)
      result = averageResults([...weights].map(([k, w]) => [this.cache.get(k)!, w]), result!);
      const fin = expanded();
      const rNow = this.cache.get(fin.key) ?? solveDC(fin.nl, { relayStates: this.relayStates });
      if (rNow.relayStates) this.relayStates = { ...rNow.relayStates };
      applyInputs(rNow);
    } else {
      if (this.st.t === 0 && emu.nanos > 0) this.st.t = emu.nanos / 1e9;
      for (let guard = 0; guard < MAX_EVENTS; guard++) {
        const ex = expanded();
        // ต้องอัปเดตขาเข้าถี่ ๆ เฉพาะเมื่อมีขาเข้า (หรือขา ADC GP26–28) ที่ต่อกับวงจร
        const needInputs = specs.some((m, k) => m.gp.some((net, i) => net >= 0 && i > 1 && used.has(net) && (i >= 26 || boards[k].emu.pinMode(i).startsWith('in'))));
        // หยุด CPU ตรงขอบ ECHO ของ HC-SR04 ด้วย (ขาเข้าได้ค่าใหม่ทันที — วัดความกว้างพัลส์ได้ละเอียดระดับ µs)
        const ev = nextSonarEvent(this.st, emu.nanos / 1e9);
        const tSeg = Math.min(targetNs, emu.nanos + (needInputs ? QUANTUM : QUANTUM_OUT_ONLY) * 1e9, isFinite(ev) ? Math.ceil(ev * 1e9) : Infinity);
        const ta = emu.nanos;
        const hi = highNow();
        const why = emu.nanos < targetNs ? runBoards(tSeg, true) : 'target';
        accHigh(hi, emu.nanos - ta);
        const out = advance(ex.nl, this.st, emu.nanos / 1e9, { deadline: Infinity, maxSteps: 2000, onSample: (t, r) => pushSample(t, r) });
        steps += out.steps;
        result = out.result;
        if (!out.ok) { reached = false; break; }
        applyInputs(out.result);
        if (emu.nanos >= targetNs) break;
        if (why === 'deadline' || now() > deadline) { reached = false; break; }
      }
      if (result) { result = { ...result }; delete result.x; }
    }
    const dtNs = emu.nanos - tStartNs;
    const wall = now() - t0;
    const instr = boards.reduce((a, b) => a + b.emu.instructions, 0) - instr0;
    const status: McuStatus[] = boards.map((b) => {
      const pins = b.modes();
      const duty = pins.map((p, i) => (dtNs > 0 ? b.highNs[i] / dtNs : p === 'out-high' ? 1 : 0));
      const c = b.console;
      b.console = '';
      const fin = b.finished;
      b.finished = null;
      return { id: b.id, console: c, running: b.filter.running, finished: fin, booted: b.booted, pins, duty, led: duty[25], mips: wall > 0 ? instr / wall / 1e3 : 0, ratio: wall > 0 ? dtNs / 1e6 / wall : 0 };
    });
    // รันโค้ดอัตโนมัติหลังบูต (เหมือน main.py)
    specs.forEach((m, k) => {
      const b = boards[k];
      if (b.booted && !b.autorunDone) { b.autorunDone = true; if (m.autorun) b.runCode(m.autorun); }
    });
    if (!samples.length && result) samples.push({ t: emu.nanos / 1e9, v: readWatch(result, req.watch) });
    void this.wall0;
    return { seq: req.seq, mode: 'tran', result: result!, t: emu.nanos / 1e9, reached: reached && emu.nanos >= targetNs, samples, steps, mcu: status };
  }
}

/** เฉลี่ยค่าของอุปกรณ์และแรงดันโหนดตามน้ำหนักเวลา */
export function averageResults(list: Array<[SimResult, number]>, fallback: SimResult): SimResult {
  const ok = list.filter(([r, w]) => r.ok && w > 0);
  if (!ok.length) return fallback;
  if (ok.length === 1) return ok[0][0];
  const W = ok.reduce((a, [, w]) => a + w, 0);
  const base = ok[ok.length - 1][0];
  const elements: Record<string, ElementResult> = {};
  for (const id of Object.keys(base.elements)) {
    const e: ElementResult = { ...base.elements[id], current: 0, voltage: 0, power: 0 };
    let extra: Record<string, number> | undefined;
    for (const [r, w] of ok) {
      const x = r.elements[id];
      if (!x) continue;
      e.current += (x.current * w) / W; e.voltage += (x.voltage * w) / W; e.power += (x.power * w) / W;
      if (x.extra) { extra ??= {}; for (const [k, v] of Object.entries(x.extra)) extra[k] = (extra[k] ?? 0) + (v * w) / W; }
    }
    if (extra) e.extra = { ...base.elements[id].extra, ...extra, ...(base.elements[id].extra?.region !== undefined ? { region: base.elements[id].extra!.region } : {}) };
    elements[id] = e;
  }
  const nodeVoltage = base.nodeVoltage.map((v, i) => {
    if (v === null) return null;
    let s = 0;
    for (const [r, w] of ok) { const x = r.nodeVoltage[i]; if (x === null) return v; s += ((x as number) * w) / W; }
    return s;
  });
  return { ...base, elements, nodeVoltage };
}

export type { WatchItem };
