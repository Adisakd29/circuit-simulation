/**
 * ESP32 (Xtensa LX6) ผ่าน QEMU — ตัวจำลอง CPU อยู่ในโปรแกรมแยก `esp32-bridge` (server/esp32/bridge.c, GPL-2.0-or-later)
 * ที่โหลด libqemu-xtensa (lcgamboa/qemu สาขา picsimlab-esp32) · ไฟล์นี้เป็นฝั่งแอป: คุยกับ bridge ทีละบรรทัดแบบ synchronous ผ่าน Esp32Link
 * (ใช้ได้เฉพาะบน Node — เซิร์ฟเวอร์ตั้ง factory ด้วย setEsp32LinkFactory; ในเบราว์เซอร์ไม่มี factory จึงสร้างบอร์ดไม่ได้)
 *
 * เวลา: นาฬิกาเสมือนของ QEMU (-icount) เริ่มที่ 0 เมื่อบูต → nanos = startNs + เวลา QEMU
 * ขา: ระดับ/ทิศทางขาออกจากเหตุการณ์ G/D · ตัวดึงขึ้น/ลงจากรีจิสเตอร์ IO_MUX (ขาที่เป็น RTC IO ไม่มี — QEMU ไม่จำลอง RTC_IO)
 * ขาเข้า: ส่ง "P gpio level" เมื่อระดับเปลี่ยน · ADC: "A index raw12" ตามช่อง ADC1/ADC2 ของขา
 * UART0: ไบต์ขาออกจากเหตุการณ์ T · ไบต์ขาเข้าป้อนทีละชุดตามจังหวะ 115200 baud (FIFO รับของ ESP32 128 ไบต์)
 * I²C: ธุรกรรมจาก callback ของ QEMU (START/WRITE/READ/STOP) → onI2c ตอบทันทีขณะ CPU รอ
 */
import type { PinMode } from './pico-emu';

/** ช่องทางสื่อสารกับ bridge: ส่งหนึ่งบรรทัด / อ่านหนึ่งบรรทัด (รอจนได้) */
export interface Esp32Link {
  send(line: string): void;
  readLine(): string;
  close(): void;
}
let factory: (() => Esp32Link) | null = null;
/** เซิร์ฟเวอร์ (หรือชุดทดสอบ) ตั้งวิธีเปิด bridge */
export function setEsp32LinkFactory(f: (() => Esp32Link) | null) { factory = f; }
export function esp32Available() { return factory !== null; }

/** ESP32: GPIO ที่ต่อ ADC — [GPIO, index ใน bridge] (ADC1_CH0–7 = 0–7, ADC2_CHn = 8 + n) ตาม ESP32 TRM ตาราง IO_MUX/RTC_MUX */
export const ESP32_ADC: Array<[number, number]> = [
  [36, 0], [37, 1], [38, 2], [39, 3], [32, 4], [33, 5], [34, 6], [35, 7],
  [4, 8], [0, 9], [2, 10], [15, 11], [13, 12], [12, 13], [14, 14], [27, 15], [25, 16], [26, 17],
];

/** 115200 baud 8N1 = 86.8 µs ต่อไบต์ · ป้อน RX ครั้งละไม่เกิน 32 ไบต์ ทุก 5 ms (≤ 6.4 ไบต์/ms ช้ากว่าความเร็วสาย ไม่ล้น FIFO) */
const RX_CHUNK = 32, RX_GAP_NS = 5_000_000;
/** ช่วงเวลาสูงสุดต่อการสั่ง R หนึ่งครั้ง (ตรวจงบเวลาจริงระหว่างช่วง) */
const SLICE_NS = 2_000_000;

export interface Esp32I2cHandler { (bus: number, addr: number, event: number, tNs: number): number }

export class Esp32Emulator {
  private link: Esp32Link;
  private vt = 0;
  private level = new Uint8Array(40);
  private out = new Uint8Array(40);
  private pu = 0n;
  private pd = 0n;
  private inLevel = new Int8Array(40).fill(-1);
  private adc = new Int16Array(18).fill(-1);
  private rx: number[] = [];
  private rxNext = 0;
  private serialOut: number[] = [];
  private dec = new TextDecoder('utf-8');
  private pending: string[] = [];
  instructions = 0;
  rebootPending = false;
  onI2c: Esp32I2cHandler | null = null;
  onTrace: ((e: { kind: 'pin'; i: number; high: boolean | null; tNs: number }) => void) | null = null;
  /** ขาที่เพิ่งเปลี่ยนระหว่างช่วงล่าสุด (เวลา ns ของ QEMU) — ใช้หาสัดส่วน HIGH ของ PWM ที่สลับขาจริง */
  edges: Array<{ g: number; v: number; t: number }> = [];

  constructor(readonly startNs = 0) {
    if (!factory) throw new Error('ESP32 ต้องจำลองบนเซิร์ฟเวอร์ (QEMU) — หน้านี้ไม่มีบริการจำลอง ESP32');
    this.link = factory();
    // bridge หยุดรอคำสั่งครั้งแรกที่เวลา 0
    this.readUntilStop();
  }
  get nanos() { return this.startNs + this.vt; }
  get seconds() { return this.nanos / 1e9; }

  /**
   * PWM จาก LEDC: QEMU เก็บค่ารีจิสเตอร์ (duty, ความถี่ของ timer, สัญญาณที่ GPIO matrix ส่งออก) แต่ไม่สลับขาจริง
   * → สร้างรูปคลื่นเองจากรีจิสเตอร์: ระดับ = HIGH ช่วง duty × คาบ แรกของแต่ละคาบ (เริ่มคาบที่เวลา QEMU 0) · อ่านรีจิสเตอร์ใหม่ทุก 1 ms ของเวลาจำลอง
   */
  private pwm = new Map<number, { T: number; on: number }>();
  private pwmAt = -Infinity;
  private refreshPwm() {
    this.pwmAt = this.vt;
    this.pwm.clear();
    for (const p of this.ledc()) if (p.freq > 0) this.pwm.set(p.gpio, { T: 1e9 / p.freq, on: Math.max(0, Math.min(1, p.duty)) * (1e9 / p.freq) });
  }
  private lvl(i: number): number {
    const p = this.pwm.get(i);
    if (!p) return this.level[i];
    if (p.on <= 0) return 0;
    if (p.on >= p.T) return 1;
    return this.vt % p.T < p.on ? 1 : 0;
  }
  /** เวลา QEMU ของขอบ PWM ถัดไปหลัง vt (Infinity = ไม่มี) */
  private nextPwmEdge(): number {
    let best = Infinity;
    for (const p of this.pwm.values()) {
      if (p.on <= 0 || p.on >= p.T) continue;
      const k = Math.floor(this.vt / p.T), base = k * p.T;
      const e = this.vt < base + p.on ? base + p.on : base + p.T;
      best = Math.min(best, Math.ceil(e));
    }
    return best;
  }

  pinMode(i: number): PinMode {
    if (i < 0 || i >= 40) return 'in';
    if (this.out[i]) return this.lvl(i) ? 'out-high' : 'out-low';
    const b = 1n << BigInt(i);
    if (this.pu & b) return 'in-pullup';
    if (this.pd & b) return 'in-pulldown';
    return 'in';
  }
  setInput(i: number, high: boolean) {
    if (i < 0 || i >= 40) return;
    const v = high ? 1 : 0;
    if (this.inLevel[i] === v) return;
    this.inLevel[i] = v;
    this.pending.push(`P ${i} ${v}`);
  }
  /** ช่อง ADC ตามลำดับ ESP32_ADC · แรงดันเทียบ GND → ค่าดิบ 12 บิต ที่ ATTN_11DB (เต็มสเกล ≈ 3.3 V ตามเอกสาร MicroPython: 150 mV–2450 mV ใช้งานได้ดี) */
  setAdc(ch: number, volts: number) {
    if (ch < 0 || ch >= ESP32_ADC.length) return;
    const raw = Math.max(0, Math.min(4095, Math.round((volts / 3.3) * 4095)));
    if (this.adc[ch] === raw) return;
    this.adc[ch] = raw;
    this.pending.push(`A ${ESP32_ADC[ch][1]} ${raw}`);
  }
  sendSerial(bytes: number[] | string) {
    for (const b of typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0) & 0xff) : bytes) this.rx.push(b & 0xff);
  }
  takeSerial(): string {
    const s = this.dec.decode(new Uint8Array(this.serialOut), { stream: true });
    this.serialOut = [];
    return s;
  }
  poke() { /* อุปกรณ์ภายนอกเปลี่ยนขาออก — คำนวณวงจรใหม่ในช่วงถัดไป */ }
  traceAll() { for (let i = 0; i < 40; i++) if (this.out[i]) this.onTrace?.({ kind: 'pin', i, high: !!this.lvl(i), tNs: this.nanos }); }

  private regs: { ch: Array<{ conf: number; duty: number }>; freq: number[]; osel: number[] } | null = null;
  /** รีจิสเตอร์ LEDC + GPIO matrix ณ จุดหยุดปัจจุบัน (อ่านครั้งเดียวต่อจุดหยุด) */
  private readRegs() {
    if (this.regs) return this.regs;
    this.link.send('L');
    const l = this.link.readLine();
    const m = /^O ledc (.*) freq (.*) osel (.*)$/.exec(l.trim());
    this.regs = m
      ? { ch: m[1].split(' ').map((x) => { const [c, d] = x.split(':'); return { conf: Number(c), duty: Number(d) / 100 }; }), freq: m[2].split(' ').map(Number), osel: m[3].split(' ').map(Number) }
      : { ch: [], freq: [], osel: new Array(40).fill(256) };
    return this.regs;
  }
  /** สัญญาณที่ GPIO matrix ส่งออกแต่ละขา (gpio_out_sel, 256 = ค่าจากรีจิสเตอร์ GPIO_OUT) */
  matrix(): number[] { return this.readRegs().osel; }
  /** สถานะ LEDC (PWM): ช่อง → [GPIO, duty 0–1, ความถี่ Hz] ตามรีจิสเตอร์ (QEMU ไม่สลับขาจริงสำหรับ PWM) */
  ledc(): Array<{ gpio: number; duty: number; freq: number }> {
    const { ch, freq, osel } = this.readRegs();
    const out: Array<{ gpio: number; duty: number; freq: number }> = [];
    // gpio_out_sel: สัญญาณ 71–78 = LEDC high-speed ch0–7, 79–86 = low-speed ch0–7 (ESP32 TRM ตาราง GPIO Matrix)
    osel.forEach((sig, g) => {
      if (!this.out[g]) return;
      const k = sig >= 71 && sig <= 86 ? sig - 71 : -1;
      if (k < 0 || !ch[k]) return;
      const timer = (ch[k].conf & 3) + (k >= 8 ? 4 : 0);
      out.push({ gpio: g, duty: ch[k].duty, freq: freq[timer] ?? 0 });
    });
    return out;
  }

  private readUntilStop(): 't' | 'p' {
    for (;;) {
      const l = this.link.readLine();
      const c = l.charCodeAt(0);
      if (c === 71 /* G */) {
        const [, g, v, t] = l.split(' ');
        const gi = Number(g), vi = Number(v);
        this.level[gi] = vi;
        this.edges.push({ g: gi, v: vi, t: Number(t) });
        if (this.out[gi]) this.onTrace?.({ kind: 'pin', i: gi, high: !!vi, tNs: this.startNs + Number(t) });
      } else if (c === 68 /* D */) {
        const [, g, d] = l.split(' ');
        this.out[Number(g)] = Number(d) ? 1 : 0;
      } else if (c === 84 /* T */) {
        const [, u, b] = l.split(' ');
        if (u === '0') this.serialOut.push(Number(b));
      } else if (c === 73 /* I */) {
        const [, bus, addr, ev, t] = l.split(' ');
        const v = this.onI2c ? this.onI2c(Number(bus), Number(addr), Number(ev), Number(t)) : 1;
        this.link.send(`i ${v}`);
      } else if (c === 83 /* S */) {
        const [, t, why, pu, pd] = l.trim().split(' ');
        this.vt = Number(t);
        this.pu = BigInt('0x' + (pu ?? '0'));
        this.pd = BigInt('0x' + (pd ?? '0'));
        return why === 'p' ? 'p' : 't';
      }
    }
  }

  /** เดินเวลาถึง targetNs หรือจนขาออกเปลี่ยน (คืน 'pin') หรือหมดงบเวลาจริง (คืน 'deadline') */
  run(targetNs: number, deadline: number, stopOnPin = true): 'target' | 'pin' | 'deadline' {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    while (this.nanos < targetNs) {
      if (this.vt - this.pwmAt >= 1e6) this.refreshPwm();
      // ไบต์เข้า UART ตามจังหวะ
      if (this.rx.length && this.vt >= this.rxNext) {
        const chunk = this.rx.splice(0, RX_CHUNK);
        this.pending.push('U ' + chunk.map((b) => b.toString(16).padStart(2, '0')).join(''));
        this.rxNext = this.vt + RX_GAP_NS;
      }
      for (const p of this.pending) this.link.send(p);
      this.pending = [];
      let end = Math.min(targetNs - this.startNs, this.vt + SLICE_NS);
      if (this.rx.length) end = Math.min(end, Math.max(this.vt + 1000, this.rxNext));
      const edge = stopOnPin ? this.nextPwmEdge() : Infinity;
      const atEdge = edge <= end;
      if (atEdge) end = edge;
      const before = this.pwm.size ? [...this.pwm.keys()].map((g) => this.lvl(g)).join() : '';
      this.regs = null;
      this.link.send(`R ${Math.max(this.vt + 1, Math.round(end))} ${stopOnPin ? 1 : 0}`);
      const why = this.readUntilStop();
      if (why === 'p') { this.refreshPwm(); return 'pin'; }
      if (atEdge && [...this.pwm.keys()].map((g) => this.lvl(g)).join() !== before) {
        for (const g of this.pwm.keys()) if (this.out[g]) this.onTrace?.({ kind: 'pin', i: g, high: !!this.lvl(g), tNs: this.nanos });
        return 'pin';
      }
      if (this.nanos < targetNs && now() > deadline) return 'deadline';
    }
    return 'target';
  }

  dispose() {
    try { this.link.send('Q'); } catch { /* bridge จบไปแล้ว */ }
    this.link.close();
  }
}
