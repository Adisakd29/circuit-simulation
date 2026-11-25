import type { ToneReading } from './tone';
import type { CircuitDoc } from '../model/types';
import { SimEngine, type EngineRequest, type EngineResponse, type Sample, type WatchItem } from './engine';
import { buildNetlist, hasMcu, hasReactive, type BuiltNetlist } from './netlist';
import type { McuCommand, McuStatus } from '../mcu/cosim';
import type { SimResult } from './solver';
import SimWorker from './sim.worker?worker&inline';

/**
 * ตัวควบคุมการจำลอง
 * - อัตราการคำนวณแยกจาก frame rate: "sim tick" ทุก 20–50 ms (ปรับตามเวลาที่ใช้ต่อรอบ: เครื่องเร็ว → ถี่ขึ้น
 *   ไฟกะพริบจึงเปลี่ยนตรงจังหวะกว่า เพราะสถานะที่แสดงคือสถานะตอนท้ายแต่ละช่วง)
 *   DC: คำนวณใหม่เมื่อวงจรเปลี่ยนเท่านั้น
 *   ตามเวลา: ทุก tick เดินเวลาจำลอง = เวลาจริงที่ผ่านไป × speed (หยุดเวลาได้)
 * - การคำนวณอยู่ใน Web Worker (fallback: main thread)
 * - ผลที่ไม่ตรงกับคำขอล่าสุดถูกทิ้ง
 */
export interface SimUpdate {
  doc: CircuitDoc;
  built: BuiltNetlist;
  result: SimResult;
  mode: 'dc' | 'tran';
  t: number;
  reached: boolean;
  samples: Sample[];
  watch: WatchItem[];
  restarted: boolean;
  mcu?: McuStatus[];
  tones?: Record<string, ToneReading>;
  /** ข้อมูลเครื่องวิเคราะห์ลอจิกของช่วงนี้ */
  logic?: Record<string, import('../instruments/logic').LogicChunk>;
  /** กำลังเฉลี่ยของ element ในช่วงนี้ */
  power?: import('../instruments/power').PowerChunk;
}

/**
 * ที่อยู่ไฟล์ Python (Pyodide) ของบอร์ด Raspberry Pi: เว็บที่ deploy เสิร์ฟเองที่ ./pyodide/ · หน้าเว็บไฟล์เดียวใช้ CDN (npm package เดียวกัน)
 */
export function pyodideBase(): string {
  if (import.meta.env.MODE === 'single') return 'https://cdn.jsdelivr.net/npm/pyodide@314.0.7/';
  return new URL('pyodide/', document.baseURI).href;
}

export class SimulationController {
  private worker: Worker | null = null;
  private engine: SimEngine | null = null;
  private seq = 0;
  private pending: { seq: number; doc: CircuitDoc; built: BuiltNetlist; watch: WatchItem[]; restarted: boolean } | null = null;
  private doc: CircuitDoc | null = null;
  private built: BuiltNetlist | null = null;
  private dirty = false;
  private needRestart = false;
  private lastTick = 0;
  private timer: number | null = null;
  running = false;
  paused = false;
  /** วินาทีของวงจร ต่อ 1 วินาทีจริง */
  speed = 1;
  /** ระยะห่างตัวอย่างที่ต้องการ (s) — ออสซิลโลสโคปตั้งให้ถี่ตาม time/div */
  sampleSpacing: number | undefined = undefined;
  /** ตัวจับเวลาเรียกทุก 25 ms แต่ส่งคำขอจริงห่างตาม tickGap (25 หรือ 50 ms) */
  readonly tickMs = 25;
  /** เวลาต่อรอบ (ส่งคำขอ → คำนวณ → แสดงผล) เฉลี่ย ms */
  private roundMs = 20;
  private sentAt = 0;
  /** ช่วงห่างของคำขอ: 2.5 เท่าของเวลาต่อรอบ อยู่ในช่วง 25–50 ms (เหลือเวลาให้ main thread วาดภาพ/ตอบสนอง) */
  get tickGap(): number { return Math.min(50, Math.max(25, 2.5 * this.roundMs)); }
  readonly budgetMs = 30;
  onResult: (u: SimUpdate) => void = () => {};
  watchFor: (doc: CircuitDoc, built: BuiltNetlist) => WatchItem[] = () => [];
  workerMode: 'worker' | 'sync' = 'sync';
  /** คำสั่งไมโครคอนโทรลเลอร์ที่รอส่งพร้อมคำขอถัดไป */
  private mcuCmds: Record<string, McuCommand> = {};
  /** เหตุการณ์สัมผัสจอทัชที่รอส่งพร้อมคำขอถัดไป */
  private touchQ: Record<string, Array<{ x: number; y: number; down: boolean }>> = {};
  private encQ: Record<string, number> = {};
  /**
   * วงจรที่มี ESP32: ตัวจำลองวงจร + QEMU ทำงานบนเซิร์ฟเวอร์ (POST {remoteBase}/api/sim/esp32) — หน้าเว็บส่งคำขอชุดเดียวกับที่ส่งให้ Web Worker
   * remoteBase = ที่อยู่บริการ (เหมือนบริการคอมไพล์) · '' = เซิร์ฟเวอร์เดียวกับหน้าเว็บ
   */
  remoteBase = '';
  private sid = '';

  constructor() {
    try {
      this.worker = new SimWorker();
      this.workerMode = 'worker';
      this.worker.onmessage = (ev) => this.handle(ev.data);
      this.worker.onerror = () => this.fallback();
    } catch {
      this.fallback();
    }
  }

  private fallback() {
    this.worker = null;
    this.engine = new SimEngine();
    this.workerMode = 'sync';
    this.pending = null;
  }

  start(doc: CircuitDoc) {
    this.sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.running = true;
    this.paused = false;
    this.doc = doc;
    this.dirty = true;
    this.needRestart = true;
    this.lastTick = performance.now();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  stop() {
    if (this.sid) {
      const sid = this.sid;
      this.sid = '';
      fetch(`${this.remoteBase}/api/sim/esp32/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid }), keepalive: true }).catch(() => { /* ไม่มีบริการ */ });
    }
    this.running = false;
    this.seq++;
    this.pending = null;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  invalidate(doc: CircuitDoc) {
    if (!this.running) return;
    this.doc = doc;
    this.dirty = true;
    if (this.paused) this.tick(); // คำนวณ ณ เวลาปัจจุบันทันที
  }

  /** เริ่มเวลาใหม่ (t = 0, ตัวเก็บประจุกลับเป็นแรงดันเริ่มต้น) */
  restartTime() {
    this.needRestart = true;
    this.dirty = true;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.lastTick = performance.now();
  }

  get isTransient(): boolean {
    return !!this.built && (hasReactive(this.built.netlist) || hasMcu(this.built.netlist));
  }

  /** ส่งคำสั่งถึงบอร์ดไมโครคอนโทรลเลอร์ (รวมกับคำสั่งที่ยังไม่ได้ส่ง) */
  mcuCommand(id: string, cmd: McuCommand) {
    const c = (this.mcuCmds[id] ??= {});
    if (cmd.stop) { c.stop = true; delete c.run; }
    if (cmd.run !== undefined) c.run = cmd.run;
    if (cmd.reset) c.reset = true;
    if (cmd.serial?.length) c.serial = [...(c.serial ?? []), ...cmd.serial];
    this.dirty = true;
    if (this.paused) this.tick();
  }

  /** ส่งเหตุการณ์สัมผัสจอทัช (กด/ลาก/ยก) ถึงชิ้นส่วน id */
  touch(id: string, ev: { x: number; y: number; down: boolean }) {
    (this.touchQ[id] ??= []).push(ev);
    this.dirty = true;
    if (this.paused) this.tick();
  }

  /** หมุน rotary encoder n คลิก (บวก = ตามเข็ม) */
  turnEncoder(id: string, n: number) {
    this.encQ[id] = (this.encQ[id] ?? 0) + n;
    this.dirty = true;
    if (this.paused) this.tick();
  }

  private tick() {
    if (!this.running || !this.doc || this.pending) return;
    const now = performance.now();
    if (!this.dirty && now - this.lastTick < this.tickGap - 2) return;
    // หยุดเวลาและวงจรไม่เปลี่ยน: คงผลล่าสุดไว้ (ค่าเฉลี่ย PWM ของก้าวสุดท้าย) — คำนวณซ้ำที่เวลาเดิมจะได้สถานะขาชั่วขณะ
    // (HIGH หรือ LOW) ทำให้ LED ที่หรี่ด้วย PWM ดูเหมือนติดเต็มหรือดับขณะหยุดเวลา
    if (this.paused && !this.dirty) { this.lastTick = now; return; }
    const elapsed = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.dirty || !this.built) { this.built = buildNetlist(this.doc); }
    const tran = hasReactive(this.built.netlist) || hasMcu(this.built.netlist);
    if (!tran && !this.dirty) return;
    this.dirty = false;
    const restarted = this.needRestart;
    this.needRestart = false;
    const watch = this.watchFor(this.doc, this.built);
    const req: EngineRequest = {
      seq: ++this.seq, netlist: this.built.netlist,
      ...(this.built.netlist.mcus?.some((m) => m.kind === 'rpi5') ? { pyBase: pyodideBase() } : {}),
      advance: tran && !this.paused && !restarted ? elapsed * this.speed : 0,
      restart: restarted, watch, budgetMs: this.budgetMs, sampleSpacing: this.sampleSpacing,
      ...(Object.keys(this.mcuCmds).length ? { mcu: this.mcuCmds } : {}),
      ...(Object.keys(this.touchQ).length ? { touch: this.touchQ } : {}),
      ...(Object.keys(this.encQ).length ? { encoder: this.encQ } : {}),
    };
    this.mcuCmds = {};
    this.touchQ = {};
    this.encQ = {};
    const p = { seq: req.seq, doc: this.doc, built: this.built, watch, restarted };
    this.sentAt = now;
    if (this.built.netlist.mcus?.some((m) => m.fw === 'esp32')) {
      this.pending = p;
      const fail = (msg: string) => ({ seq: req.seq, crash: msg, remote: true });
      fetch(`${this.remoteBase}/api/sim/esp32`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: this.sid, req }) })
        .then(async (r) => { const j = await r.json().catch(() => null); return r.ok && j ? j : fail(j?.error ?? `บริการจำลอง ESP32 ตอบ ${r.status}`); }, () => fail(`ติดต่อบริการจำลอง ESP32 ไม่ได้ (${this.remoteBase || 'เซิร์ฟเวอร์ของหน้านี้'}) — ตั้งที่อยู่บริการในแผงบอร์ด`))
        .then((d) => this.handle(d));
    } else if (this.worker) {
      this.pending = p;
      this.worker.postMessage(req);
    } else {
      this.deliver(p, this.engine!.handle(req));
      this.noteRound();
    }
  }

  private handle(data: EngineResponse & { crash?: string; remote?: boolean }) {
    const p = this.pending;
    this.pending = null;
    if (!p || data.seq !== p.seq || !this.running) return;
    if (data.crash) {
      data = {
        seq: data.seq, mode: 'dc', t: 0, reached: false, samples: [], steps: 0,
        result: { ok: false, error: { code: 'numeric', message: data.remote || /ESP32/.test(data.crash) ? 'จำลอง ESP32 ไม่ได้' : 'ตัวคำนวณขัดข้อง', detail: data.crash }, nodeVoltage: [], component: [], energized: [], elements: {}, iterations: 0, modeIterations: 0, solveMs: 0 },
      };
    }
    this.deliver(p, data);
    this.noteRound();
    if (this.dirty && this.paused) this.tick();
  }

  private noteRound() {
    const ms = performance.now() - this.sentAt;
    this.roundMs = this.roundMs * 0.8 + Math.min(ms, 200) * 0.2;
  }

  private deliver(p: NonNullable<SimulationController['pending']>, r: EngineResponse) {
    this.onResult({ doc: p.doc, built: p.built, result: r.result, mode: r.mode, t: r.t, reached: r.reached, samples: r.samples, watch: p.watch, restarted: p.restarted, mcu: r.mcu, tones: r.tones, logic: r.logic, power: r.power });
  }
}
