import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { WATCH_CODE } from '../src/model/catalog';
import { screenText, type I2cDevState } from '../src/mcu/i2c-bus';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * แลป 46 (smart watch) บน MB-102: Pico h1 (GP4 = SDA, GP5 = SCL ของ I2C0) · รางบน tp = 3V3 tn = GND · รางล่างต่อกับรางบน
 * OLED j24 (GND VCC SCL SDA — ตัวโมดูลวางราบยื่นออกด้านหน้าเหนือรางไฟล่าง คอลัมน์ ≈ 20–31: สายไฟเลี้ยงจึงไปรางที่คอลัมน์ 17–18) · DS3231 j30 (32K SQW SCL SDA VCC GND) · MPU6050 j38 (VCC GND SCL SDA XDA XCL AD0 INT) AD0 → 3V3 (0x69)
 * SDA: GP4 → g27 → g33 → g41 · SCL: GP5 → h26 → h32 → h40
 * ปุ่ม f50 (GP15 → g50, g52 → bn52) · มอเตอร์สั่น: GP16 → R 1 kΩ (c55–c58) → B ของ 2N3904 (a54 E, a55 B, a56 C) · E → tn54 · C → สายน้ำเงินมอเตอร์ · สายแดง → tp · 1N4148 (e56 A – e59 K) → tp
 */
export function watchRig(o: { code?: string; motion?: 'still' | 'walk' | 'shake'; spm?: number; ad0?: boolean; noPullAd0?: boolean; clock?: string; skip?: string[] } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  const skip = new Set(o.skip ?? []);
  b.part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? WATCH_CODE, autorun: true });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  // ไฟเลี้ยง: 3V3 → tp, GND → tn, รางล่างต่อรางบน
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  if (!skip.has('oled')) b.part('ssd1306', onBoard('j24'), 'OLED1').wire(H('i24'), H('bn18'), 'wog', '#212121').wire(H('h25'), H('bp17'), 'wov', '#e53935');
  if (!skip.has('rtc')) b.part('ds3231', onBoard('j30'), 'RTC1', { ...(o.clock ? { clock: o.clock } : {}) }).wire(H('i35'), H('bn35'), 'wrg', '#212121').wire(H('i34'), H('bp34'), 'wrv', '#e53935');
  if (!skip.has('mpu')) {
    b.part('mpu6050', onBoard('j38'), 'IMU1', { motion: o.motion ?? 'still', spm: o.spm ?? 100 }).wire(H('i39'), H('bn39'), 'wmg', '#212121').wire(H('i38'), H('bp38'), 'wmv', '#e53935');
    if (o.ad0 !== false) b.wire(H('i44'), H('bp44'), 'wad0', '#ff9800');
  }
  // บัส I²C
  b.wire(H(`j${col('GP4')}`), H('g27'), 'wsda', '#1e88e5').wire(H('f27'), H('g33'), 'wsda2', '#1e88e5').wire(H('f33'), H('g41'), 'wsda3', '#1e88e5')
    .wire(H(`i${col('GP5')}`), H('h26'), 'wscl', '#fdd835').wire(H('g26'), H('h32'), 'wscl2', '#fdd835').wire(H('g32'), H('h40'), 'wscl3', '#fdd835');
  // ปุ่ม GP15
  b.part('pushbutton', onBoard('f50'), 'SW1').wire(H(`j${col('GP15')}`), H('g50'), 'wbtn', '#43a047').wire(H('g52'), H('bn52'), 'wbg', '#212121');
  // มอเตอร์สั่นผ่าน 2N3904
  if (!skip.has('vib')) {
    b.part('bjt', onBoard('a54'), 'Q1').part('resistor', onBoard('c55'), 'RB', { resistance: 1000, span: 3 })
      .part('diode', onBoard('e56'), 'D1', { span: 3 }).part('vibmotor', onTable(46, 4), 'M1')
      .wire(H(`b${col('GP16')}`), H('d58'), 'wvb', '#8e24aa').wire(H('b54'), H('tn54'), 'wqe', '#212121')
      .wire(P('M1', 'B'), H('b56'), 'wmb', '#1e88e5').wire(P('M1', 'A'), H('tp57'), 'wma', '#e53935').wire(H('d59'), H('tp59'), 'wdk', '#e53935');
  }
  return b;
}

export interface WatchStep { t: number; con: string; i2c: Record<string, I2cDevState>; text: string[]; vib: number; an: ReturnType<typeof analyze> }

export function runWatch(b: Builder, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '', log: string[] = [];
  const st: WatchStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    if (cmd?.(t, b)) built = buildNetlist(b.doc);
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9 });
    const m = r.mcu?.find((x) => x.id === 'PICO1');
    con += m?.console ?? '';
    if (m?.i2c) log = log.concat(m.i2c);
    const an = analyze(b.doc, built, r.result, r.tones);
    const i2c = r.result.i2c ?? {};
    st.push({ t, con, i2c, text: screenText(i2c.OLED1), vib: an.parts.M1?.current ?? 0, an });
  }
  return { con, st, log, built };
}
