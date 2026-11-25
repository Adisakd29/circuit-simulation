import type { PinMode } from './pico-emu';

/**
 * Raspberry Pi 5 — จำลองระดับไลบรารี (ไม่จำลอง CPU BCM2712, ชิป RP1 หรือ Linux)
 *
 * โค้ด Python ของผู้ใช้รันด้วย CPython ใน WebAssembly (Pyodide) ภายใน Web Worker ของการจำลอง แล้วสั่งขาผ่านโมดูล gpiozero
 * ชุดย่อยที่เขียนขึ้นใหม่ (src/mcu/pi/gpiozero.py) — ตัวนี้เก็บสถานะขา GPIO0–27 และเวลาของบอร์ด
 *
 * เวลา: เวลาของบอร์ดคือเวลาของวงจร · Python ทำงาน "ไม่กินเวลาจำลอง" ระหว่างจุดพัก — หยุดพักเมื่อ sleep()/pause()/wait_for_*()
 *   ลูปที่ไม่พักเลยถูกพักทุก ~2 ms ของเวลาจริง แล้วเดินเวลาจำลองเท่ากับเวลาที่ Python ใช้ในเบราว์เซอร์ (ไม่ใช่ความเร็ว CPU ของบอร์ดจริง)
 *   ระหว่างพัก วงจรเดินเวลาต่อ
 * PWM ซอฟต์แวร์ (PWMLED, blink, Servo) สร้างขอบสัญญาณตามเวลาจำลองที่นี่ (ไม่ต้องปลุก Python ทุกขอบ)
 * ขาเข้าที่ Python เฝ้าดู (when_pressed ฯลฯ): ขอบสัญญาณที่วงจรสร้างถูกเก็บพร้อมเวลา แล้วปลุก Python ให้เรียก callback ทันที
 */

export const RPI_GPIO = 28;

/** ลำดับช่วงของรูปคลื่น: [ระยะเวลา s, duty 0–1] */
type Seg = [number, number];
interface Pattern { freq: number; segs: Seg[]; n: number; end: number; seg: number; segEnd: number; cycle: number; level: boolean; next: number; duty: number }

export interface PiFinish { ok: boolean; error?: string; line?: number | null; stopped?: boolean }

/** ตัวรัน Python (Pyodide) — ใช้ร่วมกันทั้ง worker */
export interface PiHost {
  readonly state: 'idle' | 'loading' | 'ready' | 'failed';
  readonly error: string;
  ensureLoaded(): void;
  start(emu: PiEmulator, code: string): Promise<PiFinish>;
  readonly busy: PiEmulator | null;
}

/** ตั้งค่าขาเริ่มต้นหลังบูต: GPIO0–8 ดึงขึ้น, GPIO9–27 ดึงลง (ตามค่าเริ่มต้นของ Pi รุ่นก่อน — ค่าของ RP1 อาจต่าง) */
const defaultPull = (i: number): 1 | 2 => (i <= 8 ? 1 : 2);

export class PiEmulator {
  nanos = 0;
  /** จำนวนบรรทัด Python ที่รันแล้ว (โดยประมาณ — นับทีละช่วงพัก) */
  instructions = 0;
  /** 0 = ขาเข้าไม่ดึง, 1 = ดึงขึ้น, 2 = ดึงลง, 3 = ขาออก */
  private mode = new Uint8Array(RPI_GPIO);
  private out = new Uint8Array(RPI_GPIO);
  private inLevel = new Uint8Array(RPI_GPIO);
  private patterns = new Map<number, Pattern>();
  private watched = new Set<number>();
  private edges: Array<[number, number, number]> = [];
  private wakeNs = Infinity;
  private waitResolve: ((v: string) => void) | null = null;
  private onSuspend: (() => void) | null = null;
  private serial = '';
  /** Python ต้องทำงานต่อก่อนเดินเวลาต่อ (ถึงเวลาตื่น มีขอบสัญญาณ หรือมีคำสั่งรัน/หยุด) */
  pending = false;
  running = false;
  private startQueued: string | null = null;
  private stopReq = false;
  finished: PiFinish | null = null;
  private failNoted = false;
  /** บอร์ดถูกนำออก/รีเซ็ต: Python ที่ค้างอยู่ได้รับ KeyboardInterrupt ทุกครั้งที่พัก */
  disposed = false;
  /** รอโปรแกรมของบอร์ดเดิม (ที่ถูกรีเซ็ต) จบก่อนเริ่มโปรแกรมใหม่ */
  waitingHost = false;

  constructor(readonly host: PiHost | null) { this.resetPins(); }

  resetPins() {
    for (let i = 0; i < RPI_GPIO; i++) { this.mode[i] = defaultPull(i); this.out[i] = 0; }
    this.patterns.clear();
    this.watched.clear();
    this.edges = [];
  }

  // ---------- อินเทอร์เฟซเดียวกับตัวจำลองบอร์ดอื่น (ใช้ใน McuCosim) ----------
  pinMode(i: number): PinMode {
    const m = this.mode[i];
    if (m === 3) return this.out[i] ? 'out-high' : 'out-low';
    return m === 1 ? 'in-pullup' : m === 2 ? 'in-pulldown' : 'in';
  }
  setInput(i: number, high: boolean) {
    const v = high ? 1 : 0;
    if (this.inLevel[i] === v) return;
    this.inLevel[i] = v;
    if (this.mode[i] !== 3 && this.watched.has(i)) {
      this.edges.push([i, v, this.nanos / 1e9]);
      if (this.waitResolve) this.pending = true;
    }
  }
  setAdc() { /* Pi ไม่มี ADC */ }
  sendSerial() { /* ไม่มี REPL แบบพิมพ์ทีละบรรทัด */ }
  takeSerial(): string { const s = this.serial; this.serial = ''; return s; }

  /** เดินเวลาถึง until (ns): สร้างขอบ PWM/blink · หยุดเมื่อถึงเวลาตื่นของ Python (pending) หรือขาเปลี่ยน (stopOnPin) */
  run(until: number, _deadline: number, stopOnPin: boolean): 'pin' | 'target' | 'deadline' {
    for (let guard = 0; guard < 1e6; guard++) {
      let nxt = this.wakeNs;
      for (const p of this.patterns.values()) if (p.next < nxt) nxt = p.next;
      if (nxt > until) { if (until > this.nanos) this.nanos = until; return 'target'; }
      if (nxt > this.nanos) this.nanos = nxt;
      if (this.wakeNs <= this.nanos) {
        this.wakeNs = Infinity;
        if (this.waitResolve) { this.pending = true; return 'pin'; }
      }
      let changed = false;
      for (const [pin, p] of [...this.patterns]) if (p.next <= this.nanos) changed = this.stepPattern(pin, p) || changed;
      if (changed && stopOnPin) return 'pin';
    }
    return 'target';
  }

  /** เวลาเหตุการณ์ถัดไป (s): ตื่นจากการพัก หรือขอบของรูปคลื่น */
  nextEvent(): number {
    let t = this.waitResolve ? this.wakeNs : Infinity;
    for (const p of this.patterns.values()) if (p.next < t) t = p.next;
    return t / 1e9;
  }

  // ---------- คำสั่งจากผู้ใช้ ----------
  /** รันโค้ดใหม่ (ถ้ากำลังรันอยู่ ส่ง KeyboardInterrupt ก่อน) */
  requestRun(code: string) {
    this.startQueued = code;
    if (this.running) this.requestStop();
    this.poll();
  }
  requestStop() {
    if (!this.running) { this.startQueued = null; return; }
    this.stopReq = true;
    if (this.waitResolve) this.pending = true;
  }
  /** เรียกต้นทุกคำขอ: Python โหลดเสร็จแล้วและมีโค้ดรอรัน → ให้ทำงาน */
  poll() {
    const h = this.host;
    if (this.startQueued === null || this.running) return;
    if (!h) { this.failStart('บอร์ด Raspberry Pi ต้องรันในโหมด Web Worker (เบราว์เซอร์นี้ใช้ worker ไม่ได้)'); return; }
    h.ensureLoaded();
    if (h.state === 'ready') {
      this.waitingHost = false;
      if (!h.busy || h.busy === this) this.pending = true;
      else if (h.busy.disposed) this.waitingHost = true;
      else this.failStart('รัน Python ได้ทีละบอร์ด — มี Raspberry Pi อีกบอร์ดกำลังรันอยู่');
      // บอร์ดเดิมเพิ่งถูกรีเซ็ต: รอให้โปรแกรมเก่าจบ (KeyboardInterrupt) ก่อน แล้วจึงเริ่มในคำขอถัดไป
    }
    else if (h.state === 'failed') this.failStart(h.error);
  }
  private failStart(msg: string) {
    this.startQueued = null;
    if (!this.failNoted) this.serial += `\n[ระบบ] ${msg}\n`;
    this.failNoted = true;
    this.finished = { ok: false, error: msg, line: null };
  }

  /** ให้ Python ทำงานจนถึงจุดพักถัดไป (sleep/pause/รอปุ่ม/ลูปที่ทำงานเกิน ~2 ms) หรือจบโปรแกรม */
  resume(): Promise<void> {
    this.pending = false;
    return new Promise<void>((res) => {
      this.onSuspend = () => { this.onSuspend = null; res(); };
      if (this.startQueued !== null && !this.running) {
        const code = this.startQueued;
        this.startQueued = null;
        this.running = true;
        this.stopReq = false;
        this.failNoted = false;
        this.resetPins();
        this.wakeNs = Infinity;
        this.host!.start(this, code).then((fin) => this.ended(fin), (e) => this.ended({ ok: false, error: String((e as Error)?.message ?? e), line: null }));
        return;
      }
      const r = this.waitResolve;
      if (r) {
        this.waitResolve = null;
        const ev = this.edges;
        this.edges = [];
        r(this.stopReq ? 'STOP' : JSON.stringify(ev));
        return;
      }
      this.onSuspend();
    });
  }
  private ended(fin: PiFinish) {
    this.running = false;
    this.finished = fin;
    this.waitResolve = null;
    this.wakeNs = Infinity;
    this.stopReq = false;
    // gpiozero ปิดอุปกรณ์ทั้งหมดเมื่อโปรแกรมจบ: ขากลับเป็นขาเข้าตามค่าเริ่มต้น
    this.resetPins();
    if (this.startQueued !== null) this.pending = true;
    this.onSuspend?.();
  }

  // ---------- เรียกจาก Python (ผ่านโมดูล _pi) ----------
  out_(s: string) { this.serial += s; if (this.serial.length > 200000) this.serial = this.serial.slice(-100000); }
  now(): number { return this.nanos / 1e9; }
  /** โหมดขา: 'out' | 'up' | 'down' | 'none' */
  setup(pin: number, m: string) {
    this.patterns.delete(pin);
    const v = m === 'out' ? 3 : m === 'up' ? 1 : m === 'down' ? 2 : 0;
    if (v === 3 && this.mode[pin] !== 3) this.out[pin] = 0;
    this.mode[pin] = v;
  }
  write(pin: number, level: number) { this.patterns.delete(pin); this.mode[pin] = 3; this.out[pin] = level ? 1 : 0; }
  read(pin: number): number { return this.mode[pin] === 3 ? this.out[pin] : this.inLevel[pin]; }
  /** ระดับขาออกตอนนี้ (ระหว่าง blink/PWM) */
  level(pin: number): number { return this.out[pin]; }
  /** duty ของรูปคลื่นตอนนี้ (−1 = ไม่มีรูปคลื่น) */
  duty(pin: number): number { const p = this.patterns.get(pin); return p ? p.duty : -1; }
  busyPattern(pin: number): boolean { return this.patterns.has(pin); }
  /** รูปคลื่นซอฟต์แวร์: ลำดับช่วง [ระยะเวลา, duty] ซ้ำ n รอบ (≤ 0 = ไม่จำกัด) แล้วจบที่ duty end — PWM ความถี่ freq Hz */
  pattern(pin: number, freq: number, segsJson: string, n: number, end: number) {
    const segs = (JSON.parse(segsJson) as Seg[]).map(([d, u]) => [d < 0 || d === null ? Infinity : d, Math.max(0, Math.min(1, u))] as Seg);
    this.mode[pin] = 3;
    if (!segs.length) { this.patterns.delete(pin); this.out[pin] = end >= 1 ? 1 : 0; return; }
    const p: Pattern = { freq: Math.max(1e-3, freq), segs, n: n > 0 ? n : Infinity, end, seg: 0, segEnd: 0, cycle: 0, level: false, next: this.nanos, duty: 0 };
    this.patterns.set(pin, p);
    this.enterSeg(pin, p, this.nanos);
  }
  watch(pin: number, on: number) { if (on) this.watched.add(pin); else this.watched.delete(pin); }
  /** นำบอร์ดออก/รีเซ็ต: หยุดโปรแกรมที่ค้าง */
  dispose() {
    this.disposed = true;
    this.startQueued = null;
    const r = this.waitResolve;
    this.waitResolve = null;
    r?.('STOP');
  }

  /** Python พักจนถึงเวลา until (s) — คืนรายการขอบสัญญาณ (JSON) หรือ 'STOP' */
  wait(until: number): Promise<string> {
    if (this.disposed) return Promise.resolve('STOP');
    return new Promise<string>((res) => {
      this.waitResolve = res;
      this.wakeNs = until === Infinity || !isFinite(until) ? Infinity : Math.max(this.nanos, Math.ceil(until * 1e9));
      if (this.edges.length || this.stopReq) this.pending = true;
      this.instructions += 1000;
      this.onSuspend?.();
    });
  }

  // ---------- รูปคลื่น ----------
  private enterSeg(pin: number, p: Pattern, t: number) {
    for (let guard = 0; guard < 10000; guard++) {
      const [dur, duty] = p.segs[p.seg];
      if (dur > 0 || dur === Infinity) {
        p.duty = duty;
        p.segEnd = dur === Infinity ? Infinity : t + dur * 1e9;
        const P = 1e9 / p.freq;
        if (duty <= 0) { p.level = false; p.next = p.segEnd; }
        else if (duty >= 1) { p.level = true; p.next = p.segEnd; }
        else { p.level = true; p.next = Math.min(p.segEnd, t + duty * P); }
        this.out[pin] = p.level ? 1 : 0;
        return;
      }
      if (!this.advanceSeg(pin, p)) return;
    }
  }
  /** ไปช่วงถัดไป — false = จบรูปคลื่นแล้ว */
  private advanceSeg(pin: number, p: Pattern): boolean {
    p.seg++;
    if (p.seg >= p.segs.length) {
      p.seg = 0;
      p.cycle++;
      if (p.cycle >= p.n) {
        this.patterns.delete(pin);
        const e = p.end;
        if (e > 0 && e < 1) this.pattern(pin, p.freq, JSON.stringify([[-1, e]]), 0, e);
        else this.out[pin] = e >= 1 ? 1 : 0;
        return false;
      }
    }
    return true;
  }
  /** ขอบถัดไปของรูปคลื่น — คืน true ถ้าระดับขาเปลี่ยน */
  private stepPattern(pin: number, p: Pattern): boolean {
    const before = this.out[pin];
    const t = p.next;
    if (t >= p.segEnd) {
      if (this.advanceSeg(pin, p)) this.enterSeg(pin, p, p.segEnd);
    } else {
      const P = 1e9 / p.freq;
      p.level = !p.level;
      p.next = Math.min(p.segEnd, t + (p.level ? p.duty : 1 - p.duty) * P);
      this.out[pin] = p.level ? 1 : 0;
    }
    return this.out[pin] !== before;
  }
}
