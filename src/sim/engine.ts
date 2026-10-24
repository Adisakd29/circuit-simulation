import { hasMcu, hasReactive, type Netlist } from './netlist';
import { McuCosim, type McuCommand, type McuStatus } from '../mcu/cosim';
import { solveDC, voltageBetween, type SimResult } from './solver';
import { advance, newTranState, restart } from './transient';
import { ToneMeter, type ToneReading } from './tone';

/**
 * Simulation engine — ใช้ทั้งใน Web Worker และ fallback บน main thread
 * - วงจรไม่มี C/L: วิเคราะห์ DC operating point
 * - วงจรมี C/L: วิเคราะห์ตามเวลา เก็บสถานะข้ามคำขอ (เวลาจำลองเดินต่อเนื่อง)
 */

export type WatchItem =
  | { key: string; kind: 'v'; a: number | undefined; b: number | undefined }
  | { key: string; kind: 'i'; id: string };

export interface EngineRequest {
  seq: number;
  netlist: Netlist;
  /** เวลาจำลองที่ต้องการเดินเพิ่ม (s) — 0 = หยุดเวลาไว้ */
  advance: number;
  restart: boolean;
  watch: WatchItem[];
  /** งบเวลาประมวลผลต่อคำขอ (ms) */
  budgetMs: number;
  /** ระยะห่างขั้นต่ำระหว่างตัวอย่างที่ส่งกลับ (s) — ไม่ระบุ = advance/120; ออสซิลโลสโคปขอถี่กว่า */
  sampleSpacing?: number;
  /** คำสั่งถึงไมโครคอนโทรลเลอร์ตาม id (พิมพ์ REPL, รันโค้ด, หยุด) */
  mcu?: Record<string, McuCommand>;
}

export interface Sample { t: number; v: Array<number | null> }

export interface EngineResponse {
  seq: number;
  mode: 'dc' | 'tran';
  result: SimResult;
  /** เวลาจำลองปัจจุบัน */
  t: number;
  /** เดินถึงเวลาที่ขอหรือไม่ (false = คำนวณไม่ทันเวลาจริง) */
  reached: boolean;
  samples: Sample[];
  steps: number;
  /** สถานะไมโครคอนโทรลเลอร์ (ถ้ามีในวงจร) */
  mcu?: McuStatus[];
  /** ความถี่/กระแสสลับของบัซเซอร์ (เฉพาะการจำลองตามเวลา) */
  tones?: Record<string, ToneReading>;
}

const MAX_SAMPLES_PER_REQUEST = 8000;

export function readWatch(r: SimResult, watch: WatchItem[]): Array<number | null> {
  return watch.map((w) => {
    if (!r.ok) return null;
    if (w.kind === 'v') return voltageBetween(r, w.a, w.b).value;
    return r.elements[w.id]?.current ?? null;
  });
}

export class SimEngine {
  private st = newTranState();
  private wasTran = false;
  private cosim: McuCosim | null = null;
  private tone = new ToneMeter();
  private dcLatch: Record<string, boolean> = {};

  handle(req: EngineRequest): EngineResponse {
    this.tone.setIds(req.netlist.tones ?? []);
    this.tone.setTimers((req.netlist.timers ?? []).map((t) => t.id));
    this.tone.setRms(req.netlist.transformers ?? []);
    this.tone.setServos(req.netlist.servos ?? []);
    this.tone.setSteppers(req.netlist.steppers ?? []);
    this.tone.setMeters(req.netlist.meters ?? []);
    if (req.restart) this.tone.reset();
    const r = this.handleInner(req);
    if (this.tone.active && r.mode === 'tran') {
      r.tones = this.tone.read();
      // หยุดเวลา/แก้วงจรระหว่างหยุด (advance = 0): ไม่มีตัวอย่างใหม่ → ค่า DC ของมิเตอร์ใช้ค่าขณะนั้น ไม่ใช้ค่าเฉลี่ยเก่า
      if (req.advance === 0) for (const m of req.netlist.meters ?? []) { const t = r.tones[m.id]; if (t) delete t.mavg; }
    }
    return r;
  }

  private handleInner(req: EngineRequest): EngineResponse {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    if (hasMcu(req.netlist)) {
      this.wasTran = false;
      this.cosim ??= new McuCosim();
      return this.cosim.handle(req, req.mcu, this.tone);
    }
    this.cosim = null;
    if (!hasReactive(req.netlist)) {
      this.wasTran = false;
      restart(this.st);
      // สถานะที่มีความจำ (รีเลย์ hysteresis, เกต latch) ต่อเนื่องระหว่างการคำนวณ DC แต่ละครั้ง — เริ่มใหม่เมื่อกด Run/เริ่มเวลาใหม่
      if (req.restart) this.dcLatch = {};
      const result = solveDC(req.netlist, { relayStates: this.dcLatch });
      if (result.ok && result.relayStates) this.dcLatch = { ...result.relayStates };
      delete result.x;
      return { seq: req.seq, mode: 'dc', result, t: 0, reached: true, samples: [{ t: 0, v: readWatch(result, req.watch) }], steps: 1 };
    }
    if (req.restart || !this.wasTran) restart(this.st);
    this.wasTran = true;
    const target = this.st.t + Math.max(0, req.advance);
    const samples: Sample[] = [];
    const spacing = Math.max(req.sampleSpacing ?? req.advance / 120, req.advance / MAX_SAMPLES_PER_REQUEST);
    let lastSampleT = -Infinity;
    const out = advance(req.netlist, this.st, target, {
      deadline: t0 + req.budgetMs,
      onSample: (t, r) => {
        this.tone.feed(t, r);
        if (t - lastSampleT >= spacing) { samples.push({ t, v: readWatch(r, req.watch) }); lastSampleT = t; }
      },
    });
    if (!out.ok) {
      // คำนวณไม่ได้ ณ เวลานี้: หยุดเวลาไว้ที่จุดล่าสุดที่คำนวณได้ และส่งข้อผิดพลาด
      const result = { ...out.result };
      delete result.x;
      return { seq: req.seq, mode: 'tran', result, t: this.st.t, reached: false, samples, steps: out.steps };
    }
    const result = { ...out.result };
    delete result.x;
    if (!samples.length || samples[samples.length - 1].t !== this.st.t) samples.push({ t: this.st.t, v: readWatch(result, req.watch) });
    // ไม่สะสมเวลาค้าง: ถ้าคำนวณไม่ทัน เวลาจำลองจะช้ากว่าที่ตั้ง (แจ้งใน UI)
    return { seq: req.seq, mode: 'tran', result, t: this.st.t, reached: out.reached, samples, steps: out.steps };
  }
}
