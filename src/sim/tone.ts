import type { SimResult } from './solver';
import type { MeterSpec, ServoSpec, StepperSpec } from './netlist';
import { SERVO_DEADBAND, servoAngleFor, stepperIndexOf } from '../model/catalog';

/**
 * วัดความถี่และขนาดกระแสสลับของบัซเซอร์จากผลจำลองทุกก้าว (ก่อนลดจำนวนตัวอย่างสำหรับกราฟ)
 * เก็บย้อนหลัง WINDOW วินาทีของเวลาจำลอง — นับจุดตัดขาขึ้นแบบมี hysteresis (20% ของค่ายอดถึงยอด)
 * ใช้ได้ทั้งการจำลองตามเวลา (C/L/เครื่องกำเนิดสัญญาณ) และ Pico (ทุกครั้งที่ขาเปลี่ยนสถานะ)
 */
export const TONE_WINDOW = 0.04;

export interface ToneReading {
  /** ความถี่ (Hz) — null ถ้าไม่พบการแกว่งอย่างน้อย 2 รอบในหน้าต่าง */
  freq: number | null;
  /** ครึ่งหนึ่งของกระแสยอดถึงยอด (A) */
  iac: number;
  /** กระแสเฉลี่ยตามเวลา (A) */
  idc: number;
  /** ไอซี 555: สัดส่วนเวลาที่ขาออก HIGH ต่อคาบ (duty cycle) */
  duty?: number;
  /** ไอซี 555: เวลา HIGH / LOW ของคาบล่าสุด (s) */
  tHigh?: number;
  tLow?: number;
  /** หม้อแปลง: ค่า rms ของแรงดันขั้ว/กระแสต่อครึ่งขด และกระแสยอด (หน้าต่าง RMS_WINDOW) */
  vrmsA?: number; vrmsB?: number; irmsA?: number; irmsB?: number; ipk?: number;
  /** เซอร์โว: มุมปัจจุบัน/เป้าหมาย (องศา), ความกว้างพัลส์และคาบล่าสุด (s), กำลังหมุน (1/0), ไฟเลี้ยง (V) */
  angle?: number; target?: number; pw?: number; period?: number; moving?: number; vcc?: number;
  /** สเต็ปเปอร์: ตำแหน่ง (ฮาล์ฟสเต็ปสะสม), เฟสที่มีไฟ (บิต), ความถี่สเต็ปล่าสุด (Hz), ความเร็วแกนออก (rpm), จำนวนสเต็ปที่หลุด, สเต็ปล่าสุด (±1 = ฮาล์ฟ, ±2 = ฟูล) */
  pos?: number; mask?: number; stepRate?: number; rpm?: number; missed?: number; lastStep?: number; holding?: number;
  /** สเต็ปเปอร์: ตำแหน่งสูงสุด/ต่ำสุดที่เคยไป และจำนวนการขยับเดินหน้า/ถอยหลังสะสม (ตั้งแต่เริ่มจำลอง) */
  posMax?: number; posMin?: number; fwd?: number; rev?: number;
  /** มัลติมิเตอร์: ค่าเฉลี่ยตามเวลา (ย่าน DC), ค่าย่าน AC แบบตอบสนองค่าเฉลี่ยปรับเทียบ rms ของคลื่นไซน์ (1.111 × ค่าเฉลี่ยของ |x − ค่าเฉลี่ย|),
   *  ค่า rms จริงของส่วน AC, ช่วงเวลาที่เฉลี่ย (s) */
  mavg?: number; mac?: number; mrms?: number; mdur?: number;
}

/** เวลาที่รูปแบบเฟสต้องคงอยู่ก่อนโรเตอร์ตอบสนอง (s) — สั้นกว่าคาบสเต็ปที่เร็วที่สุด (1 ms) มาก */
const STEPPER_SETTLE = 150e-6;
interface StepperState { posMax: number; posMin: number; fwd: number; rev: number; tField: number; pend: number | null; pendT: number; pos: number; idx: number | null; tMove: number; tPrevMove: number; tLast: number | null; missed: number; mask: number; lastStep: number; moves: number[] }

interface ServoState { hi: boolean; rise: number | null; prevRise: number | null; pw: number | null; period: number | null; pwUsed: number | null; angle: number; target: number; tLast: number | null; tPulse: number; vcc: number }

/** หน้าต่างคำนวณ rms ของหม้อแปลง (5 คาบที่ 50 Hz) */
export const RMS_WINDOW = 0.1;

export class ToneMeter {
  private t: number[] = [];
  private i = new Map<string, number[]>();
  /** ไอซี 555: เวลาขอบขึ้น/ลงของขาออก (จากสถานะฟลิปฟล็อปทุกก้าว — ไม่ขึ้นกับหน้าต่าง 40 ms) */
  private timerIds: string[] = [];
  private edges = new Map<string, { q: boolean | null; rises: number[]; falls: number[]; tLast: number }>();
  /** หม้อแปลง: ตัวอย่าง [t, vA, vB, iA, iB] ทุกก้าว */
  private rmsIds: string[] = [];
  private rms = new Map<string, number[][]>();
  private servoSpecs: ServoSpec[] = [];
  private servo = new Map<string, ServoState>();
  private meterSpecs: MeterSpec[] = [];
  /** มัลติมิเตอร์: ตัวอย่าง [t, ค่า] ทุกก้าว */
  private meter = new Map<string, number[][]>();
  private stepperSpecs: StepperSpec[] = [];
  private stepper = new Map<string, StepperState>();
  constructor(public ids: string[] = []) {}

  setServos(specs: ServoSpec[]) {
    const key = (x: ServoSpec[]) => x.map((s) => `${s.id}:${s.sig}:${s.gnd}:${s.vcc}:${s.pulseMin}:${s.pulseMax}:${s.speed}`).join('|');
    if (key(specs) === key(this.servoSpecs)) return;
    this.servoSpecs = specs;
    // คงมุมเดิมของเซอร์โวที่ยังอยู่ (แก้วงจรระหว่างจำลองแขนไม่กระโดด)
    for (const id of [...this.servo.keys()]) if (!specs.some((s) => s.id === id)) this.servo.delete(id);
  }

  setMeters(specs: MeterSpec[]) {
    const key = (x: MeterSpec[]) => x.map((m) => `${m.id}:${m.el}:${m.q}:${m.mode}`).join('|');
    if (key(specs) === key(this.meterSpecs)) return;
    this.meterSpecs = specs;
    this.meter.clear(); // เปลี่ยนย่าน/ขั้ว: เริ่มเฉลี่ยใหม่
  }

  setSteppers(specs: StepperSpec[]) {
    const key = (x: StepperSpec[]) => x.map((s) => `${s.id}:${s.coils.join(',')}:${s.stepsPerRev}:${s.pullIn}:${s.pullOut}:${s.minCoilCurrent}`).join('|');
    if (key(specs) === key(this.stepperSpecs)) return;
    this.stepperSpecs = specs;
    for (const id of [...this.stepper.keys()]) if (!specs.some((s) => s.id === id)) this.stepper.delete(id);
  }

  /**
   * กลไกสเต็ปเปอร์: เฟสที่มีกระแสพอ (≥ minCoilCurrent) กำหนดตำแหน่งสนามแม่เหล็ก 0–7 (ลำดับฮาล์ฟสเต็ป)
   * โรเตอร์ตามสนามเมื่อห่าง 1 หรือ 2 ฮาล์ฟสเต็ป (ฮาล์ฟ/ฟูลสเต็ป) และสเต็ปไม่ถี่เกิน: ออกตัวจากหยุดนิ่ง ≤ pullIn Hz, หมุนต่อเนื่อง ≤ pullOut Hz
   * ถี่เกินหรือสนามกระโดด ≥ 3 ฮาล์ฟสเต็ป (ลำดับผิด) → หลุดสเต็ป (โรเตอร์อยู่ที่เดิม) · ไม่มีเฟสใดมีไฟ → ไม่มีแรงยึด (คงตำแหน่ง)
   */
  private feedSteppers(t: number, r: SimResult) {
    for (const sp of this.stepperSpecs) {
      let s = this.stepper.get(sp.id);
      if (!s || (s.tLast !== null && t < s.tLast)) {
        s = { posMax: s?.pos ?? 0, posMin: s?.pos ?? 0, fwd: 0, rev: 0, tField: -Infinity, pend: null, pendT: 0, pos: s?.pos ?? 0, idx: null, tMove: -Infinity, tPrevMove: -Infinity, tLast: null, missed: 0, mask: 0, lastStep: 0, moves: [] };
        this.stepper.set(sp.id, s);
      }
      s.tLast = t;
      let mask = 0;
      sp.coils.forEach((id, k) => { if (Math.abs(r.elements[id]?.current ?? 0) >= sp.minCoilCurrent) mask |= 1 << k; });
      s.mask = mask;
      // สนามที่เกิดชั่วขณะ (เช่น ระหว่างคำสั่ง pin.value ทีละขา ห่างกันไม่กี่ µs) ไม่ทำให้โรเตอร์ขยับ:
      // ยอมรับรูปแบบเฟสเมื่อคงอยู่ ≥ STEPPER_SETTLE แล้วจึงตัดสินการเคลื่อนที่ ณ เวลาที่เริ่มรูปแบบนั้น
      if (s.pend !== null && t - s.pendT >= STEPPER_SETTLE) { this.stepTo(sp, s, s.pend, s.pendT); s.pend = null; }
      const idx = stepperIndexOf(mask);
      if (idx >= 0 && idx !== (s.pend ?? s.idx)) { s.pend = idx; s.pendT = t; }
      else if (idx < 0 || idx === s.idx) s.pend = null; // ไม่มีสนาม/สนามหักล้าง หรือกลับไปรูปแบบเดิมก่อนโรเตอร์ทันขยับ
    }
  }

  private stepTo(sp: StepperSpec, s: StepperState, idx: number, t: number) {
    const prev = s.idx;
    s.idx = idx;
    if (prev === idx) return;
    // หมุนอยู่ = ขยับแล้วอย่างน้อย 8 ฮาล์ฟสเต็ปใน 50 ms ล่าสุด (โรเตอร์มีความเร็วแล้ว จึงใช้ขีดจำกัดขณะหมุน pullOut)
    const running = s.moves.filter((x) => x > t - 0.05).length >= 8;
    // สนามหมุนเร็วกว่าที่โรเตอร์ตามได้ → แรงบิดเฉลี่ยเป็นศูนย์ โรเตอร์สั่นอยู่กับที่ (ไม่ค่อย ๆ ไล่ตามทีละสเต็ป)
    if (prev !== null) {
      let df = (idx - prev + 8) % 8;
      if (df > 4) df -= 8;
      const fieldRate = Math.abs(df) / Math.max(1e-9, t - s.tField);
      s.tField = t;
      if (fieldRate > (running ? sp.pullOut : sp.pullIn) * 1.001) { s.missed++; return; }
    } else s.tField = t;
    const here = ((s.pos % 8) + 8) % 8;
    let d = (idx - here + 8) % 8;
    if (d > 4) d -= 8;
    if (d === 0) return;
    // ขีดจำกัดความเร็วของโรเตอร์ในหน่วยฮาล์ฟสเต็ป/วินาที (ออกตัว pullIn, หมุนต่อเนื่อง pullOut) — ขยับ d ฮาล์ฟสเต็ปต้องใช้เวลา ≥ |d| / ขีดจำกัด
    // (สอดคล้องกับความเร็วสูงสุดที่วัดได้ทั่วไป ≈ 15 rpm = 1024 ฮาล์ฟสเต็ป/วินาที; ฟูลสเต็ปจึงเปลี่ยนเฟสได้ราวครึ่งหนึ่ง)
    const minDt = Math.abs(d) / (running ? sp.pullOut : sp.pullIn);
    // โรเตอร์ที่หยุดนิ่ง (หรือเพิ่งได้ไฟ) ถูกดึงเข้าหาสนามที่ห่างได้ถึง 3 ฮาล์ฟสเต็ป (135° ทางไฟฟ้า) — ห่าง 4 (ตรงข้าม) ไม่มีแรงบิด
    const reach = running ? 2 : 3;
    if (Math.abs(d) <= reach && Math.abs(d) < 4 && t - s.tMove >= minDt * 0.999) {
      s.pos += d; s.tPrevMove = s.tMove; s.tMove = t; s.lastStep = d;
      s.posMax = Math.max(s.posMax, s.pos); s.posMin = Math.min(s.posMin, s.pos);
      if (d > 0) s.fwd++; else s.rev++;
      s.moves.push(t); if (s.moves.length > 64) s.moves.shift();
    } else s.missed++;
  }

  private feedServos(t: number, r: SimResult) {
    for (const sp of this.servoSpecs) {
      let s = this.servo.get(sp.id);
      if (!s || (s.tLast !== null && t < s.tLast)) {
        const keep = s?.angle ?? 90;
        s = { hi: false, rise: null, prevRise: null, pw: null, period: null, pwUsed: null, angle: keep, target: keep, tLast: null, tPulse: -Infinity, vcc: 0 };
        this.servo.set(sp.id, s);
      }
      const v = (n: number) => r.nodeVoltage[n] ?? 0;
      const g = v(sp.gnd), vs = v(sp.sig) - g;
      s.vcc = v(sp.vcc) - g;
      // หมุนตามเวลาที่ผ่านไป (ก่อนรับพัลส์ใหม่): ความเร็วแปรตามไฟเลี้ยง (เอกสาร 0.1 s/60° ที่ 4.8 V)
      if (s.tLast !== null && t > s.tLast && s.vcc >= sp.vMin) {
        const rate = sp.speed * Math.min(s.vcc, sp.vMax) / 4.8;
        const d = s.target - s.angle, step = rate * (t - s.tLast);
        s.angle = Math.abs(d) <= step ? s.target : s.angle + Math.sign(d) * step;
      }
      s.tLast = t;
      const hi = s.hi ? vs > 1.2 : vs > 1.8;
      if (hi && !s.hi) { if (s.rise !== null) s.period = t - s.rise; s.prevRise = s.rise; s.rise = t; }
      if (!hi && s.hi && s.rise !== null) {
        s.pw = t - s.rise;
        s.tPulse = t;
        // วงจรควบคุมรับพัลส์ 0.3–3 ms (นอกช่วงถือว่าไม่ใช่สัญญาณเซอร์โว) และไม่ตอบสนองการเปลี่ยนน้อยกว่า dead band 10 µs
        if (s.pw >= 0.3e-3 && s.pw <= 3e-3 && s.vcc >= sp.vMin && (s.pwUsed === null || Math.abs(s.pw - s.pwUsed) > SERVO_DEADBAND)) {
          s.pwUsed = s.pw;
          s.target = servoAngleFor(sp, s.pw);
        }
      }
      s.hi = hi;
    }
  }

  setRms(ids: string[]) {
    if (ids.join('|') === this.rmsIds.join('|')) return;
    this.rmsIds = ids;
    this.rms.clear();
  }

  setTimers(ids: string[]) {
    if (ids.join('|') === this.timerIds.join('|')) return;
    this.timerIds = ids;
    this.edges.clear();
  }

  setIds(ids: string[]) {
    if (ids.join('|') === this.ids.join('|')) return;
    this.ids = ids;
    this.reset();
  }

  reset() { this.t = []; this.i.clear(); this.edges.clear(); this.rms.clear(); this.servo.clear(); this.stepper.clear(); this.meter.clear(); }

  get active() { return this.ids.length > 0 || this.timerIds.length > 0 || this.rmsIds.length > 0 || this.servoSpecs.length > 0 || this.stepperSpecs.length > 0 || this.meterSpecs.length > 0; }

  private feedTimers(t: number, r: SimResult) {
    for (const id of this.timerIds) {
      let e = this.edges.get(id);
      if (!e || t < e.tLast) { e = { q: null, rises: [], falls: [], tLast: t }; this.edges.set(id, e); }
      const q = !!r.relayStates?.[id];
      if (e.q !== null && q !== e.q) { const a = q ? e.rises : e.falls; a.push(t); if (a.length > 4) a.shift(); }
      e.q = q; e.tLast = t;
    }
  }

  feed(t: number, r: SimResult) {
    if (!r.ok) return;
    this.feedTimers(t, r);
    this.feedServos(t, r);
    this.feedSteppers(t, r);
    for (const m of this.meterSpecs) {
      let a = this.meter.get(m.id);
      if (!a || (a.length && t < a[a.length - 1][0])) { a = []; this.meter.set(m.id, a); }
      const e = r.elements[m.el];
      const val = (m.q === 'v' ? e?.voltage : e?.current) ?? 0;
      a.push([t, val]); // เวลาซ้ำได้ (ค่าเปลี่ยนแบบขั้นที่เวลาเดียวกัน → ช่วงกว้าง 0 ไม่มีผลต่อค่าเฉลี่ย)
      let k = 0;
      while (k < a.length - 2 && a[k][0] < t - 2 * RMS_WINDOW) k++;
      if (k > 0) a.splice(0, k);
    }
    for (const id of this.rmsIds) {
      let a = this.rms.get(id);
      if (!a || (a.length && t < a[a.length - 1][0])) { a = []; this.rms.set(id, a); }
      const ea = r.elements[`${id}#a`], eb = r.elements[`${id}#b`];
      a.push([t, ea?.voltage ?? 0, eb?.voltage ?? 0, ea?.current ?? 0, eb?.current ?? 0]);
      let k = 0;
      while (k < a.length - 2 && a[k][0] < t - 2 * RMS_WINDOW) k++;
      if (k > 0) a.splice(0, k);
    }
    if (!this.ids.length) return;
    const n = this.t.length;
    if (n && t <= this.t[n - 1]) {
      // เวลาเท่าเดิม (ผลใหม่ ณ เวลาเดียวกัน เช่น ขาเปลี่ยนสถานะ): แทนค่าจุดสุดท้ายด้วยจุดใหม่ที่เวลาห่างเล็กน้อย
      if (t < this.t[n - 1]) this.reset();
      else t = this.t[n - 1] + 1e-12;
    }
    this.t.push(t);
    for (const id of this.ids) {
      let a = this.i.get(id);
      if (!a) { a = new Array(this.t.length - 1).fill(0); this.i.set(id, a); }
      a.push(r.elements[id]?.current ?? 0);
    }
    // ตัดของเก่า
    const cut = t - TONE_WINDOW;
    let k = 0;
    while (k < this.t.length - 2 && this.t[k] < cut) k++;
    if (k > 64) { this.t.splice(0, k); for (const a of this.i.values()) a.splice(0, k); }
  }

  read(): Record<string, ToneReading> {
    const out: Record<string, ToneReading> = this.ids.length ? this.readTones() : {};
    for (const sp of this.servoSpecs) {
      const s = this.servo.get(sp.id);
      const fresh = !!s && s.tLast !== null && s.tLast - s.tPulse < 0.1; // มีพัลส์ภายใน 100 ms ล่าสุด
      out[sp.id] = { freq: fresh && s!.period ? 1 / s!.period : null, iac: 0, idc: 0, angle: s?.angle ?? 90, target: s?.target ?? 90,
        pw: fresh ? s!.pw ?? 0 : 0, period: fresh ? s!.period ?? 0 : 0, moving: s && Math.abs(s.target - s.angle) > 0.5 ? 1 : 0, vcc: s?.vcc ?? 0 };
    }
    for (const sp of this.stepperSpecs) {
      const s = this.stepper.get(sp.id);
      // ความถี่สเต็ป: เฉลี่ยจากสเต็ปใน 0.2 s ล่าสุด (หยุดนิ่งเกิน 0.1 s = 0)
      let rate = 0;
      if (s && s.tLast !== null && s.tLast - s.tMove < 0.1) {
        const recent = s.moves.filter((x) => x >= s.tMove - 0.2);
        if (recent.length >= 2) rate = (recent.length - 1) / (recent[recent.length - 1] - recent[0]);
      }
      const half = Math.abs(s?.lastStep ?? 1) === 2 ? 2 : 1;
      out[sp.id] = { freq: null, iac: 0, idc: 0, pos: s?.pos ?? 0, mask: s?.mask ?? 0, stepRate: rate, rpm: (rate * half * 60) / sp.stepsPerRev * Math.sign(s?.lastStep ?? 0),
        missed: s?.missed ?? 0, lastStep: s?.lastStep ?? 0, posMax: s?.posMax ?? 0, posMin: s?.posMin ?? 0, fwd: s?.fwd ?? 0, rev: s?.rev ?? 0, holding: s && stepperIndexOf(s.mask) >= 0 ? 1 : 0 };
    }
    for (const m of this.meterSpecs) {
      const a = this.meter.get(m.id) ?? [];
      const tEnd = a.length ? a[a.length - 1][0] : 0;
      // สี่เหลี่ยมคางหมูระหว่างตัวอย่าง (Pico ส่งตัวอย่างต้นและท้ายช่วงที่ขาคงที่ → ขั้นบันไดของ PWM ถูกต้อง)
      let sum = 0, dur = 0;
      for (let k = 1; k < a.length; k++) { if (a[k][0] < tEnd - RMS_WINDOW) continue; const dt = a[k][0] - a[k - 1][0]; sum += ((a[k][1] + a[k - 1][1]) / 2) * dt; dur += dt; }
      const avg = dur > 0 ? sum / dur : a.length ? a[a.length - 1][1] : 0;
      let ab = 0, sq = 0;
      for (let k = 1; k < a.length; k++) {
        if (a[k][0] < tEnd - RMS_WINDOW) continue;
        const dt = a[k][0] - a[k - 1][0], x0 = a[k - 1][1] - avg, x1 = a[k][1] - avg;
        ab += ((Math.abs(x0) + Math.abs(x1)) / 2) * dt; sq += ((x0 * x0 + x1 * x1) / 2) * dt;
      }
      // ยังไม่มีตัวอย่าง (เพิ่งเริ่ม/เพิ่งเปลี่ยนย่าน): ไม่ส่งค่า → ผู้อ่านใช้ค่าขณะนั้นจากผลจำลองแทน
      if (!a.length) continue;
      out[m.id] = { freq: null, iac: 0, idc: 0, mavg: avg, mac: dur > 0 ? 1.1107 * (ab / dur) : undefined, mrms: dur > 0 ? Math.sqrt(sq / dur) : undefined, mdur: dur };
    }
    for (const id of this.rmsIds) {
      const a = this.rms.get(id) ?? [];
      const sq = [0, 0, 0, 0];
      let dur = 0, ipk = 0;
      const tEnd = a.length ? a[a.length - 1][0] : 0;
      for (let k = 1; k < a.length; k++) {
        if (a[k][0] < tEnd - RMS_WINDOW) continue;
        const dt = a[k][0] - a[k - 1][0];
        for (let j = 0; j < 4; j++) sq[j] += ((a[k][j + 1] ** 2 + a[k - 1][j + 1] ** 2) / 2) * dt; // สี่เหลี่ยมคางหมู
        dur += dt;
        ipk = Math.max(ipk, Math.abs(a[k][3]), Math.abs(a[k][4]));
      }
      const r = (j: number) => (dur > 0 ? Math.sqrt(sq[j] / dur) : 0);
      out[id] = { freq: null, iac: 0, idc: dur, vrmsA: r(0), vrmsB: r(1), irmsA: r(2), irmsB: r(3), ipk };
    }
    for (const id of this.timerIds) {
      const e = this.edges.get(id);
      const R = e?.rises ?? [], F = e?.falls ?? [];
      let freq: number | null = null, duty: number | undefined, tHigh: number | undefined, tLow: number | undefined;
      if (e && R.length >= 2) {
        const r1 = R[R.length - 1], r0 = R[R.length - 2], T = r1 - r0;
        const f = F.filter((x) => x > r0 && x < r1).pop();
        // หยุดแกว่งแล้ว (ไม่มีขอบใหม่นานกว่า 3 คาบ) → ไม่แสดงความถี่
        if (T > 0 && e.tLast - Math.max(r1, F[F.length - 1] ?? 0) < 3 * T) {
          freq = 1 / T;
          if (f !== undefined) { tHigh = f - r0; tLow = r1 - f; duty = tHigh / T; }
        }
      }
      out[id] = { freq, iac: 0, idc: 0, duty, tHigh, tLow };
    }
    return out;
  }

  private readTones(): Record<string, ToneReading> {
    const out: Record<string, ToneReading> = {};
    const T = this.t;
    if (T.length < 2) { for (const id of this.ids) out[id] = { freq: null, iac: 0, idc: 0 }; return out; }
    const t0 = T[T.length - 1] - TONE_WINDOW;
    let s = 0;
    while (s < T.length - 1 && T[s] < t0) s++;
    s = Math.max(0, s - 1);
    for (const id of this.ids) {
      const a = this.i.get(id)!;
      let mn = Infinity, mx = -Infinity, area = 0, dur = 0;
      for (let k = s; k < T.length; k++) {
        mn = Math.min(mn, a[k]); mx = Math.max(mx, a[k]);
        if (k > s) { const dt = T[k] - T[k - 1]; area += a[k - 1] * dt; dur += dt; } // ค่าคงที่ช่วงระหว่างเหตุการณ์ (ขา MCU) / ใกล้เคียงสำหรับก้าวสั้น
      }
      const pp = mx - mn;
      const mid = (mx + mn) / 2, hy = pp * 0.2;
      const rises: number[] = [];
      let armed = false;
      if (pp > 1e-6) for (let k = s + 1; k < T.length; k++) {
        if (a[k] < mid - hy) armed = true;
        if (armed && a[k - 1] < mid && a[k] >= mid) { rises.push(T[k - 1] + (T[k] - T[k - 1]) * (mid - a[k - 1]) / (a[k] - a[k - 1])); armed = false; } // เส้นตรงระหว่างก้าว (ไม่ปัดเวลาข้ามจุดกลางเป็นก้าว)
      }
      const freq = rises.length >= 3 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : null;
      out[id] = { freq, iac: pp / 2, idc: dur > 0 ? area / dur : a[a.length - 1] };
    }
    return out;
  }
}
