import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pinHolesFor } from '../src/model/geometry';
import { setBoardModel } from '../src/editor/ops';
import { lcdFrame, type LcdState } from '../src/mcu/spi-bus';
import type { I2cDevState } from '../src/mcu/i2c-bus';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * แลป 47 (นาฬิกาจอกลม) บน MB-102: Pico h1 · รางบน tp = 3V3 tn = GND · รางล่างต่อกับรางบน
 * จอกลม j24 (VCC24 GND25 MISO26 MOSI27 SCLK28 CS29 DC30 RST31 BL32 TP_SDA33 TP_SCL34 TP_INT35 TP_RST36) — ตัวจอยื่นออกด้านหน้า
 * DS3231 j40 (32K SQW SCL42 SDA43 VCC44 GND45) · QMI8658 j48 (VCC48 GND49 SCL50 SDA51 SA0 52)
 * SPI1: GP10 → SCLK, GP11 → MOSI · GP9 → CS, GP8 → DC, GP13 → RST, GP14 → BL · I2C1: GP6 → SDA, GP7 → SCL · GP16 → TP_RST, GP17 ← TP_INT
 * มอเตอร์สั่น: GP18 → R 1 kΩ → 2N3904 (a54 E, a55 B, a56 C) + 1N4148
 */
export function roundRig(o: { code?: string; motion?: 'still' | 'walk' | 'shake'; spm?: number; clock?: string; skip?: string[]; bg?: string; lcdVcc?: 'vbus' } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  const skip = new Set(o.skip ?? []);
  b.part('pico', onBoard('h1'), 'PICO1', { code: o.code ?? '', autorun: !!o.code, ...(o.bg ? { bg: o.bg } : {}) });
  const col = (pin: string) => Number(pinHolesFor(b.doc.parts.find((p) => p.id === 'PICO1')!).find((x) => x.pin === pin)!.hole!.slice(1));
  const side = (pin: string) => (col(pin) && Number(pin.replace(/\D/g, '')) <= 15 && pin.startsWith('GP') ? 'j' : 'b');
  const pin = (gp: string) => H(`${side(gp)}${col(gp)}`);
  b.wire(H(`b${col('3V3')}`), H(`tp${col('3V3')}`), 'wv', '#e53935').wire(H(`b${col('GND.23')}`), H(`tn${col('GND.23')}`), 'wg', '#212121')
    .wire(H('tp2'), H('bp2'), 'wvv', '#e53935').wire(H('tn3'), H('bn3'), 'wgg', '#212121');
  if (o.lcdVcc === 'vbus') b.wire(H(`b${col('VBUS')}`), H('tp62'), 'wvbus', '#ff7043');
  if (!skip.has('lcd')) {
    b.part('gc9a01', onBoard('j24'), 'LCD1').wire(H('i24'), H('bp17'), 'wlv', '#e53935').wire(H('i25'), H('bn18'), 'wlg', '#212121');
    const w: Array<[string, string, string]> = [['GP10', 'h28', '#fdd835'], ['GP11', 'h27', '#1e88e5'], ['GP9', 'h29', '#8e24aa'], ['GP8', 'g30', '#43a047'], ['GP13', 'h31', '#ff9800'], ['GP14', 'g32', '#9e9e9e']];
    if (skip.has('dc')) w.splice(3, 1);
    for (const [gp, hole, c] of w) b.wire(pin(gp), H(hole), `w${gp}`, c);
    b.wire(pin('GP16'), H('i36'), 'wtprst', '#ff9800').wire(pin('GP17'), H('i35'), 'wtpint', '#00acc1');
  }
  // บัส I²C1: GP6 = SDA → h33 (TP_SDA) → g43 → g51 · GP7 = SCL → g34 (TP_SCL) → h42 → h50
  b.wire(pin('GP6'), H('i33'), 'wsda', '#1e88e5').wire(H('h33'), H('i43'), 'wsda2', '#1e88e5').wire(H('h43'), H('i51'), 'wsda3', '#1e88e5')
    .wire(pin('GP7'), H('f34'), 'wscl', '#fdd835').wire(H('g34'), H('i42'), 'wscl2', '#fdd835').wire(H('h42'), H('i50'), 'wscl3', '#fdd835');
  if (!skip.has('rtc')) b.part('ds3231', onBoard('j40'), 'RTC1', { ...(o.clock ? { clock: o.clock } : {}) }).wire(H('f45'), H('bn45'), 'wrg', '#212121').wire(H('f44'), H('bp44'), 'wrv', '#e53935');
  if (!skip.has('imu')) b.part('qmi8658', onBoard('j48'), 'IMU1', { motion: o.motion ?? 'still', spm: o.spm ?? 100 }).wire(H('f49'), H('bn50'), 'wmg', '#212121').wire(H('f48'), H('bp47'), 'wmv', '#e53935');
  if (!skip.has('vib')) {
    b.part('bjt', onBoard('a54'), 'Q1').part('resistor', onBoard('c55'), 'RB', { resistance: 1000, span: 3 })
      .part('diode', onBoard('e56'), 'D1', { span: 3 }).part('vibmotor', onTable(46, 4), 'M1')
      .wire(pin('GP18'), H('d58'), 'wvb', '#8e24aa').wire(H('b54'), H('tn54'), 'wqe', '#212121')
      .wire(P('M1', 'B'), H('b56'), 'wmb', '#1e88e5').wire(P('M1', 'A'), H('tp57'), 'wma', '#e53935').wire(H('d59'), H('tp59'), 'wdk', '#e53935');
  }
  return b;
}

export interface RoundStep { t: number; con: string; lcd?: LcdState; fb: Uint16Array | null; i2c: Record<string, I2cDevState>; vib: number; an: ReturnType<typeof analyze> }

export function runRound(b: Builder, seconds: number, dt = 0.1, cmd?: (t: number, b: Builder) => boolean | void | { touch: Array<{ x: number; y: number; down: boolean }> }, e = new SimEngine()) {
  let built = buildNetlist(b.doc);
  let con = '', log: string[] = [];
  const st: RoundStep[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    const t = (k + 1) * dt;
    const c = cmd?.(t, b);
    if (c === true) built = buildNetlist(b.doc);
    const touch = c && typeof c === 'object' ? { LCD1: c.touch } : undefined;
    const r = e.handle({ seq: k + 1, netlist: built.netlist, advance: dt, restart: k === 0, watch: [], budgetMs: 1e9, ...(touch ? { touch } : {}) });
    const m = r.mcu?.find((x) => x.id === 'PICO1');
    con += m?.console ?? '';
    if (m?.i2c) log = log.concat(m.i2c);
    const an = analyze(b.doc, built, r.result, r.tones);
    const lcd = r.result.lcd?.LCD1;
    st.push({ t, con, lcd, fb: lcdFrame('LCD1', lcd), i2c: r.result.i2c ?? {}, vib: an.parts.M1?.current ?? 0, an });
  }
  return { con, st, log, built };
}
