import type { Sample, WatchItem } from '../sim/engine';

/**
 * กราฟบันทึกค่า (data logger) — เก็บค่าจากโพรบและแอมมิเตอร์ตามเวลาจำลอง
 * เป็นเครื่องบันทึกค่าธรรมดา ไม่ใช่ออสซิลโลสโคป (ไม่มี trigger / time-base แบบสโคป)
 */

export interface Channel {
  key: string;
  label: string;
  unit: 'V' | 'mA';
  color: string;
}

export const LOGGER_MAX_POINTS = 6000;

export class DataLogger {
  channels: Channel[] = [];
  t: number[] = [];
  /** ค่าต่อช่อง (V หรือ mA) — null = วัดไม่ได้ ณ เวลานั้น */
  data: Array<Array<number | null>> = [];
  /** เริ่มเก็บตั้งแต่ t = 0 หลังเริ่มเวลาใหม่หรือไม่ (ใช้วัดค่าคงที่เวลา) */
  fromZero = false;
  private sig = '';

  reset(fromZero: boolean) {
    this.t = [];
    this.data = this.channels.map(() => []);
    this.fromZero = fromZero;
  }

  /** ตั้งช่องสัญญาณ — ถ้ารายการช่องเปลี่ยน ข้อมูลเก่าถูกล้าง */
  setChannels(chs: Channel[], watch: WatchItem[]) {
    const sig = JSON.stringify([chs.map((c) => c.key), watch]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.channels = chs;
    this.reset(false);
  }

  push(samples: Sample[]) {
    for (const s of samples) {
      if (this.t.length && s.t <= this.t[this.t.length - 1]) continue;
      this.t.push(s.t);
      s.v.forEach((v, i) => this.data[i]?.push(v === null ? null : this.channels[i].unit === 'mA' ? v * 1000 : v));
    }
    const extra = this.t.length - LOGGER_MAX_POINTS;
    if (extra > 0) {
      this.t.splice(0, extra);
      this.data.forEach((d) => d.splice(0, extra));
      this.fromZero = false;
    }
  }

  get duration() { return this.t.length ? this.t[this.t.length - 1] - this.t[0] : 0; }

  /** เวลาแรกที่ช่องสัญญาณข้ามค่า threshold (ประมาณค่าเชิงเส้นระหว่างจุด) */
  crossing(ch: number, threshold: number): number | null {
    const d = this.data[ch];
    if (!d) return null;
    for (let i = 1; i < d.length; i++) {
      const a = d[i - 1], b = d[i];
      if (a === null || b === null) continue;
      if ((a - threshold) * (b - threshold) <= 0 && a !== b) {
        return this.t[i - 1] + ((threshold - a) / (b - a)) * (this.t[i] - this.t[i - 1]);
      }
    }
    return null;
  }

  toCSV(): string {
    const head = ['time_s', ...this.channels.map((c) => `${c.label.replace(/[",]/g, ' ')} (${c.unit})`)];
    const rows = this.t.map((t, i) => [t.toPrecision(8), ...this.data.map((d) => (d[i] === null ? '' : (d[i] as number).toPrecision(7)))].join(','));
    return [head.join(','), ...rows].join('\n');
  }
}
