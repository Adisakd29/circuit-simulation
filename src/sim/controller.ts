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
    if (cmd.serial?.length) c.serial = [...(c.serial ?? []), ...cmd.serial];
    this.dirty = true;
    if (this.paused) this.tick();
  }

  private tick() {
    if (!this.running || !this.doc || this.pending) return;
    const now = performance.now();
    if (!this.dirty && now - this.lastTick < this.tickGap - 2) return;
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
      advance: tran && !this.paused && !restarted ? elapsed * this.speed : 0,
      restart: restarted, watch, budgetMs: this.budgetMs, sampleSpacing: this.sampleSpacing,
      ...(Object.keys(this.mcuCmds).length ? { mcu: this.mcuCmds } : {}),
    };
    this.mcuCmds = {};
    const p = { seq: req.seq, doc: this.doc, built: this.built, watch, restarted };
    this.sentAt = now;
    if (this.worker) {
      this.pending = p;
      this.worker.postMessage(req);
    } else {
      this.deliver(p, this.engine!.handle(req));
      this.noteRound();
    }
  }

  private handle(data: EngineResponse & { crash?: string }) {
    const p = this.pending;
    this.pending = null;
    if (!p || data.seq !== p.seq || !this.running) return;
    if (data.crash) {
      data = {
        seq: data.seq, mode: 'dc', t: 0, reached: false, samples: [], steps: 0,
        result: { ok: false, error: { code: 'numeric', message: 'ตัวคำนวณขัดข้อง', detail: data.crash }, nodeVoltage: [], component: [], energized: [], elements: {}, iterations: 0, modeIterations: 0, solveMs: 0 },
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
    this.onResult({ doc: p.doc, built: p.built, result: r.result, mode: r.mode, t: r.t, reached: r.reached, samples: r.samples, watch: p.watch, restarted: p.restarted, mcu: r.mcu, tones: r.tones });
  }
}
