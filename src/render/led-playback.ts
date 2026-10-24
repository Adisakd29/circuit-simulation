/**
 * เล่นความสว่าง LED ตามเวลาจำลองจริง (หน่วงคงที่) แทนการแสดงสถานะตอนท้ายแต่ละช่วงคำนวณ
 *
 * ผลจำลองมาเป็นช่วง ๆ (25–50 ms) — ถ้าแสดงสถานะตอนท้ายช่วง ขอบไฟกะพริบจะถูกปัดไปที่ขอบช่วง (คลาด ±25 ms)
 * และเวลาที่ผลมาถึงก็แกว่งตามภาระเครื่อง ตัวนี้เก็บตัวอย่างกระแส LED ตลอดช่วง แล้วแสดง ณ เวลาจำลอง
 * tp = (เวลาจริงตอนนี้ − ส่วนต่างเวลา − หน่วง) × ความเร็ว โดยเฉลี่ยกระแสในช่วงเฟรม (PWM จึงเห็นเป็นความสว่างเฉลี่ย)
 */
export interface LedSample { t: number; i: number[] }

export class LedPlayback {
  private buf: LedSample[] = [];
  private offset: number | null = null;
  private tEnd = 0;
  private tPrev: number | null = null;
  /** หน่วงการแสดงผล (วินาทีจริง) — มากกว่าช่วงคำนวณสองช่วงเล็กน้อย เพื่อให้มีข้อมูลรออยู่เสมอ */
  delay = 0.1;
  constructor(readonly ids: string[], readonly rated: number[], private speed: number) {}

  /** รับตัวอย่างจากผลจำลองหนึ่งช่วง (เวลาจำลองสิ้นสุด tEnd) ที่มาถึงเมื่อ wallMs */
  push(samples: LedSample[], tEnd: number, wallMs: number, speed: number, restarted: boolean) {
    if (restarted || speed !== this.speed || tEnd < this.tEnd) { this.buf = []; this.offset = null; this.tPrev = null; }
    this.speed = speed;
    for (const s of samples) if (!this.buf.length || s.t > this.buf[this.buf.length - 1].t) this.buf.push(s);
    this.tEnd = tEnd;
    const est = wallMs / 1000 - tEnd / speed;
    // ส่วนต่างเวลาจริง−เวลาจำลอง: กรองความแกว่งของเวลาที่ผลมาถึง; กระโดดมาก (หยุดเวลา/คำนวณไม่ทัน) → ตั้งใหม่
    if (this.offset === null || Math.abs(est - this.offset) > 0.15) this.offset = est;
    else this.offset += (est - this.offset) * 0.05;
  }

  /** ความสว่างของ LED แต่ละดวง ณ เฟรมนี้ (null = ยังไม่มีข้อมูล) */
  frame(wallMs: number, brightness: (i: number, rated: number) => number): number[] | null {
    if (this.offset === null || !this.buf.length) return null;
    // ไม่ย้อนเวลา: ถ้าตัวคำนวณช้ากว่าเวลาจริง ส่วนต่างเวลาจะถูกตั้งใหม่ (กระโดด) — ค้างไว้ที่เวลาเดิมจนตามทัน
    let tp = Math.min(this.tEnd, Math.max(this.buf[0].t, (wallMs / 1000 - this.offset - this.delay) * this.speed));
    if (this.tPrev !== null && tp < this.tPrev) tp = this.tPrev;
    // เฉลี่ยย้อนหลังไม่เกิน 1/30 วินาทีจริง: เครื่องที่เฟรมช้ามากจะไม่เห็น LED หลายดวงสลัว ๆ พร้อมกัน (เห็นสถานะ ณ ตอนนั้นแทน)
    const t0 = this.tPrev !== null && this.tPrev < tp ? Math.max(this.tPrev, tp - this.speed / 30) : tp;
    this.tPrev = tp;
    const out = this.ids.map((_, k) => brightness(this.average(k, t0, tp), this.rated[k]));
    // ทิ้งตัวอย่างที่เก่ากว่าเฟรมนี้ (เก็บตัวก่อนหน้า tp ไว้หนึ่งตัวเป็นค่าที่ค้างอยู่)
    let cut = 0;
    while (cut + 1 < this.buf.length && this.buf[cut + 1].t <= tp) cut++;
    if (cut > 0) this.buf.splice(0, cut);
    return out;
  }

  /** กระแสเฉลี่ยของ LED k ในช่วง [a, b] (ค่าตัวอย่างค้างไว้จนถึงตัวอย่างถัดไป) — a = b คืนค่า ณ จุดนั้น */
  private average(k: number, a: number, b: number): number {
    const at = (t: number) => { let v = this.buf[0].i[k]; for (const s of this.buf) { if (s.t > t) break; v = s.i[k]; } return v; };
    if (b - a <= 1e-12) return at(b);
    let sum = 0, t = a, v = at(a);
    for (const s of this.buf) {
      if (s.t <= a) continue;
      if (s.t >= b) break;
      sum += v * (s.t - t); t = s.t; v = s.i[k];
    }
    sum += v * (b - t);
    return sum / (b - a);
  }
}
