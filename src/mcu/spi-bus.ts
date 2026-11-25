import { Gc9a01 } from './watch-devices';

/**
 * บัส SPI ใน co-simulation (เฉพาะทิศ MCU → อุปกรณ์: จอ GC9A01)
 * ไบต์มาจาก SPI ฮาร์ดแวร์ของ RP2040 (rp2040js RPSPI.onTransmit) — ขาต้องตั้งเป็นฟังก์ชัน SPI (FUNCSEL 1) ของ instance เดียวกัน:
 *   GPn → SPI((n >> 3) & 1), หน้าที่ n % 4: 0 = RX (MISO), 1 = CSn, 2 = SCK, 3 = TX (MOSI)  (ตาราง GPIO function ของ RP2040)
 * จอรับไบต์เมื่อ: มีไฟเลี้ยงในช่วงและกราวด์ร่วม, SCK/MOSI ของจอต่อกับขา SCK/TX ของ SPI ตัวนั้น, ขา CS ต่ำ
 * ขา DC (ต่ำ = คำสั่ง, สูง = ข้อมูล), CS, RST อ่านจากระดับที่ขา MCU ขับ ณ ขณะที่ส่งไบต์ (ซอฟต์แวร์สลับขาก่อนเขียน SPI)
 * ไม่จำลองเวลาส่งของ SPI (ไบต์ถึงทันทีที่เข้า FIFO) และไม่จำลองการอ่านกลับทาง MISO (อ่านได้ 0)
 */
export interface LcdSpec {
  id: string;
  vcc: number; gnd: number;
  sck: number; mosi: number; cs: number; dc: number; rst: number; bl: number;
  vMin: number; vMax: number;
}

export interface LcdState {
  powered: boolean;
  on: boolean; sleep: boolean; inv: boolean; madctl: number; colmod: number;
  /** ความสว่างไฟพื้นหลัง 0–1 */
  bl: number;
  /** เลขรุ่นของภาพ (เปลี่ยนเมื่อภาพอาจเปลี่ยน) */
  ver: number;
  /** หน่วยความจำภาพ 240×240×16 บิต (ส่งเฉพาะเมื่อเปลี่ยน — หน้าเว็บเก็บรุ่นล่าสุดไว้) */
  fb?: Uint16Array;
  bytes: number; cmds: number; pixels: number; resets: number;
  /** ไบต์ที่ส่งถึงขา SCK/MOSI แต่จอไม่รับ (CS สูง/ลอย หรือ DC ลอย) */
  dropped: number;
  /** ขา DC ไม่ได้ต่อกับขา MCU ตอนที่ส่งไบต์ */
  dcFloating: boolean;
}

interface Dev { spec: LcdSpec; lcd: Gc9a01; dropped: number; dcFloating: boolean; wasPowered: boolean; inReset: boolean; sentVer: number; sentAt: number }

export class LcdHub {
  private devs = new Map<string, Dev>();
  levels: { v(net: number, ref: number): number | null } | null = null;
  drive: ((net: number) => boolean | null) | null = null;
  private seed = 1;

  sync(specs: LcdSpec[]) {
    for (const id of [...this.devs.keys()]) if (!specs.some((s) => s.id === id)) this.devs.delete(id);
    for (const s of specs) {
      let d = this.devs.get(s.id);
      if (!d) { d = { spec: s, lcd: new Gc9a01(), dropped: 0, dcFloating: false, wasPowered: false, inReset: false, sentVer: -1, sentAt: 0 }; d.lcd.powerOn(this.seed++); this.devs.set(s.id, d); }
      d.spec = s;
    }
  }

  reset() { this.devs.clear(); }
  get size() { return this.devs.size; }

  private v(net: number, ref: number) { return net < 0 || ref < 0 ? null : (this.levels?.v(net, ref) ?? null); }

  powered(d: Dev, boardGnd: number): boolean {
    const vcc = this.v(d.spec.vcc, d.spec.gnd);
    if (vcc === null || vcc < d.spec.vMin || vcc > d.spec.vMax + 0.5) return false;
    const g = this.v(d.spec.gnd, boardGnd);
    return g !== null && Math.abs(g) < 0.4;
  }

  /** ไบต์หนึ่งไบต์จาก SPI ที่ขา SCK/MOSI อยู่บนเน็ตเหล่านี้ */
  byte(sck: number, mosi: number, b: number, boardGnd: number) {
    for (const d of this.devs.values()) {
      if (d.spec.sck !== sck || d.spec.mosi !== mosi || d.inReset || !this.powered(d, boardGnd)) continue;
      const cs = this.drive?.(d.spec.cs) ?? null;
      if (cs !== false) { d.dropped++; continue; }
      const dc = this.drive?.(d.spec.dc) ?? null;
      if (dc === null) { d.dropped++; d.dcFloating = true; continue; }
      if (dc) d.lcd.data(b); else d.lcd.command(b);
    }
  }

  /** ตรวจไฟเลี้ยงและขา RST (ต่ำ = รีเซ็ตค้าง · ลอย = สูงจากตัวต้านทานดึงขึ้นบนโมดูล) */
  check(boardGnd: number) {
    for (const d of this.devs.values()) {
      const p = this.powered(d, boardGnd);
      if (p && !d.wasPowered) d.lcd.powerOn(this.seed++);
      d.wasPowered = p;
      const low = (this.drive?.(d.spec.rst) ?? null) === false;
      if (low && !d.inReset) d.lcd.reset();
      d.inReset = low;
    }
  }

  /** สถานะทุกจอ · bl(spec) = ความสว่างไฟพื้นหลังที่ cosim คำนวณจากขา BL */
  snapshot(boardGnd: number, bl: (s: LcdSpec) => number, t: number): Record<string, LcdState> {
    const out: Record<string, LcdState> = {};
    for (const [id, d] of this.devs) {
      const l = d.lcd;
      const st: LcdState = { powered: this.powered(d, boardGnd), on: l.on, sleep: l.sleep, inv: l.inv, madctl: l.madctl, colmod: l.colmod, bl: bl(d.spec), ver: l.ver, bytes: l.bytes, cmds: l.cmds, pixels: l.pixels, resets: l.resets, dropped: d.dropped, dcFloating: d.dcFloating };
      // ส่งภาพเมื่อเปลี่ยน และส่งซ้ำทุก 1 วินาทีจำลอง (กันหน้าเว็บพลาดผลบางรอบ)
      if (l.ver !== d.sentVer || t - d.sentAt > 1) { st.fb = l.gram.slice(); d.sentVer = l.ver; d.sentAt = t; }
      out[id] = st;
    }
    return out;
  }
}

/** เก็บภาพล่าสุดของแต่ละจอ (ผลบางรอบไม่มี fb เพราะภาพไม่เปลี่ยน) */
const frames = new Map<string, { ver: number; fb: Uint16Array }>();
export function lcdFrame(id: string, st: LcdState | undefined): Uint16Array | null {
  if (!st) return null;
  if (st.fb) frames.set(id, { ver: st.ver, fb: st.fb });
  return frames.get(id)?.fb ?? null;
}
