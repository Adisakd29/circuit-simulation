/**
 * รูปคลื่นบนสาย SDA/SCL ของ I²C ฮาร์ดแวร์ (Uno/Nano TWI, Pico I2C0/1)
 *
 * ตัวจำลองทำธุรกรรมเป็นขั้น (START · ที่อยู่ · ไบต์ · STOP) ส่วนนี้แปลงแต่ละขั้นเป็นขอบสัญญาณตามคาบ SCL ที่ตั้งในรีจิสเตอร์ของชิป
 * และบอกระยะเวลาที่ขั้นนั้นใช้ (cosim หน่วงการแจ้ง "เสร็จ" ให้ CPU ตามเวลานี้ — โปรแกรมจึงใช้เวลาเท่าบัสจริง)
 *
 * ลำดับตามข้อกำหนด I²C (NXP UM10204): SDA เปลี่ยนเฉพาะตอน SCL ต่ำ · บิตถูกอ่านตอน SCL สูง · บิตสูงสุดก่อน
 *   START: SDA ลงขณะ SCL สูง · STOP: SDA ขึ้นขณะ SCL สูง · บิตที่ 9 = ACK (0) / NACK (1) จากฝั่งรับ
 * ช่วงเวลาของ START/STOP ใช้ครึ่งคาบ (ค่าประมาณ — ชิปจริงมีค่า tHD;STA/tSU;STO ของตัวเอง) · ไม่จำลองเวลาขึ้นของสายจากตัวต้านทานดึงขึ้น
 */
export type I2cLine = 'sda' | 'scl';
export interface I2cEdge { t: number; line: I2cLine; v: 0 | 1 }

export class I2cWave {
  sda: 0 | 1 = 1;
  scl: 0 | 1 = 1;
  private out: I2cEdge[] = [];

  private set(t: number, line: I2cLine, v: 0 | 1) {
    if (this[line] === v) return;
    this[line] = v;
    this.out.push({ t, line, v });
  }
  /** ขอบที่สร้างไว้ตั้งแต่ครั้งก่อน */
  take(): I2cEdge[] { const o = this.out; this.out = []; return o; }

  /** START (หรือ repeated START เมื่อบัสยังไม่ว่าง) เริ่มที่ t — คืนเวลาที่ใช้ (s) */
  start(t: number, T: number): number {
    if (this.scl === 1 && this.sda === 1) { this.set(t, 'sda', 0); this.set(t + T / 2, 'scl', 0); return T / 2; }
    // repeated START: ปล่อย SDA ขณะ SCL ต่ำ → SCL ขึ้น → SDA ลงขณะ SCL สูง → SCL ลง
    this.set(t + T / 4, 'sda', 1); this.set(t + T / 2, 'scl', 1); this.set(t + T, 'sda', 0); this.set(t + 1.5 * T, 'scl', 0);
    return 1.5 * T;
  }

  /** หนึ่งไบต์ (บิตสูงสุดก่อน) + บิต ACK/NACK — 9 คาบ */
  byte(t: number, T: number, value: number, ack: boolean): number {
    for (let k = 0; k < 9; k++) {
      const bit: 0 | 1 = k < 8 ? (((value >> (7 - k)) & 1) as 0 | 1) : ack ? 0 : 1;
      const tb = t + k * T;
      this.set(tb + T / 4, 'sda', bit); // เปลี่ยน SDA กลางช่วง SCL ต่ำ (ไม่พร้อมขอบลงของ SCL)
      this.set(tb + T / 2, 'scl', 1);
      this.set(tb + T, 'scl', 0);
    }
    return 9 * T;
  }

  /** STOP: SDA ต่ำขณะ SCL ต่ำ → SCL ขึ้น → SDA ขึ้น */
  stop(t: number, T: number): number {
    if (this.scl === 1 && this.sda === 1) return 0;
    this.set(t + T / 4, 'sda', 0); this.set(t + T / 2, 'scl', 1); this.set(t + T, 'sda', 1);
    return T;
  }
}
