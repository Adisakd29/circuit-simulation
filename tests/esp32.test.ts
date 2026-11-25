import { describe, expect, it, afterAll } from 'vitest';
import { runSensor } from './sensor-rig';
import { buildNetlist } from '../src/sim/netlist';
import { catalogEntry, pinDefs, ESP32DK_GPIO } from '../src/model/catalog';
import { coveredHoles, pinHolesFor } from '../src/model/geometry';
import { isPico, isMicroPy } from '../src/model/types';
import { setBoardModel } from '../src/editor/ops';
import { netOfPin } from '../src/connectivity/connectivity';
import { setEsp32LinkFactory } from '../src/mcu/esp32-emu';
import { esp32PathsFromEnv, openEsp32Link } from '../server/esp32/link.mjs';
import { Builder, H, P, onBoard, onTable } from './helpers';

/**
 * ESP32-DevKitC V4 — CPU ESP32 ใน QEMU (lcgamboa/qemu สาขา picsimlab-esp32) ผ่าน esp32-bridge รันเฟิร์มแวร์ MicroPython v1.24.1 ESP32_GENERIC ทางการ
 * ข้อที่ต้องใช้ QEMU จะข้ามเมื่อไม่ได้ตั้ง ESP32_BRIDGE / ESP32_QEMU_LIB / ESP32_QEMU_BIOS / ESP32_FLASH (ดู server/esp32/README.md)
 *
 * วงจร (MB-102 + บอร์ดวางบนโต๊ะ ต่อสายที่ขา): 3V3 → bp1 · GND.1 → bn2 · GND.2 → tn2
 * LED1: IO2 → a30 · R 330 Ω b30–b34 · LED c34/c35 · a35 → tn35
 * ตัวแบ่งแรงดันที่ IO34: → h40 · R 10 kΩ f36–f40 (j36 → bn36) · R 10 kΩ g40–g44 (j44 → bp44)
 * SW1 ปุ่ม f50: คอลัมน์ 50 ด้านบน ← IO5 (→ a50) ใช้ PULL_UP ภายใน · คอลัมน์ 52 ด้านล่าง → GND (j52 → bn52)
 * BH1750 j56 (VCC 56, GND 57, SCL 58, SDA 59): i56 → bp56, i57 → bn57, IO22 → i58, IO21 → i59
 */
const paths = esp32PathsFromEnv();
if (paths) setEsp32LinkFactory(() => openEsp32Link(paths));
afterAll(() => setEsp32LinkFactory(null));

function rig(code: string) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  // DevKitC กว้าง 1 นิ้ว: บนเบรดบอร์ดเหลือรูว่างแค่แถว a ฝั่ง J3 (ฝั่ง J2 ไม่มีรูว่าง เหมือนบอร์ดจริง) — ชุดทดสอบวางบนโต๊ะแล้วต่อสายที่ขาโดยตรง
  b.part('esp32devkitc', onTable(10, 40), 'PICO1', { code, autorun: code !== '' });
  const E = (pin: string) => P('PICO1', pin);
  b.wire(E('3V3'), H('bp3'), 'wv', '#e53935').wire(E('GND.1'), H('bn4'), 'wg1', '#212121').wire(E('GND.2'), H('tn4'), 'wg2', '#212121');
  b.wire(E('IO2'), H('a30'), 'wl', '#43a047');
  b.part('resistor', onBoard('b30'), 'R1', { resistance: 330, span: 4 });
  b.part('led', onBoard('c34'), 'LED1', { color: 'red' });
  b.wire(H('a35'), H('tn35'), 'wk', '#212121');
  b.wire(E('IO34'), H('h40'), 'wa', '#fb8c00');
  b.part('resistor', onBoard('f36'), 'RD1', { resistance: 10000, span: 4 }).part('resistor', onBoard('g40'), 'RD2', { resistance: 10000, span: 4 });
  b.wire(H('j36'), H('bn36'), 'wdg', '#212121').wire(H('j44'), H('bp44'), 'wdv', '#e53935');
  b.part('pushbutton', onBoard('f50'), 'SW1', {});
  b.wire(E('IO5'), H('a50'), 'wsw', '#1e88e5').wire(H('j52'), H('bn52'), 'wsg', '#212121');
  b.part('bh1750', onBoard('j56'), 'LUX1', {});
  b.wire(H('i56'), H('bp56'), 'wlv', '#e53935').wire(H('i57'), H('bn57'), 'wlg', '#212121').wire(E('IO22'), H('i58'), 'wscl', '#fdd835').wire(E('IO21'), H('i59'), 'wsda', '#8e24aa');
  return b;
}

describe('ESP32-DevKitC V4 (QEMU บนเซิร์ฟเวอร์)', () => {
  it('หัวต่อ J2/J3 อย่างละ 19 ขาตาม User Guide · แถวห่าง 10 แถว (1 นิ้ว) · GPIO ตามตาราง · ขาแฟลช GPIO6–11 ไม่ต่อ · สเปกวงจร fw esp32', () => {
    const b = rig('');
    const p = b.doc.parts[0];
    expect(catalogEntry('esp32devkitc')!.supported).toBe(true);
    expect(isPico(p)).toBe(false);
    expect(isMicroPy(p)).toBe(true);
    expect(pinDefs(p)).toHaveLength(38);
    const onbb = new Builder().part('esp32devkitc', onBoard('j1'), 'E1', {}).doc.parts[0];
    const holes = Object.fromEntries(pinHolesFor(onbb).map((x) => [x.pin, x.hole]));
    expect(holes).toMatchObject({ '3V3': 'j1', IO34: 'j5', 'GND.1': 'j14', '5V': 'j19', 'GND.2': 'b1', IO22: 'b3', TX: 'b4', IO21: 'b6', IO5: 'b10', IO2: 'b15', CLK: 'b19' });
    expect(coveredHoles(onbb).filter((h) => /^[a-j]/.test(h)).map((h) => h[0]).filter((v, k, a) => a.indexOf(v) === k).sort().join('')).toBe('cdefghi');
    const built = buildNetlist(b.doc);
    const m = built.netlist.mcus![0];
    expect(m.fw).toBe('esp32');
    expect(m.gp).toHaveLength(40);
    for (const [name, g] of ESP32DK_GPIO) expect(m.gp[g]).toBe(netOfPin(built.connectivity, p.id, name));
    for (const g of [6, 7, 8, 9, 10, 11]) expect(m.gp[g]).toBe(-1);
    expect(ESP32DK_GPIO).toHaveLength(26);
  });

  it.skipIf(!paths)('บูต MicroPython ESP32_GENERIC v1.24.1 จริงใน QEMU · LED ที่ IO2 กะพริบ · ADC IO34 อ่านตัวแบ่งแรงดัน ≈ 2048 · ปุ่ม IO5 + PULL_UP อ่าน 1/0', { timeout: 240000 }, () => {
    const code = [
      'from machine import Pin, ADC', 'import time',
      'led = Pin(2, Pin.OUT)', 'sw = Pin(5, Pin.IN, Pin.PULL_UP)', 'a = ADC(Pin(34))', 'a.atten(ADC.ATTN_11DB)',
      'while True:', '    led.value(not led.value())', '    print("SW", sw.value(), "ADC", a.read())', '    time.sleep(0.2)',
    ].join('\n') + '\n';
    const press = (bb: Builder) => { (bb.doc.parts.find((x) => x.id === 'SW1')!.params as { pressed: boolean }).pressed = true; return true; };
    const { st, con } = runSensor(rig(code), 4.6, 0.1, (t, bb) => { if (Math.abs(t - 4.0) < 1e-6) return press(bb); });
    expect(con).toContain('MicroPython v1.24.1 on 2024-11-29; Generic ESP32 module with ESP32');
    const i = st.slice(-14).map((s) => s.an.parts.LED1?.current ?? 0);
    expect(Math.max(...i)).toBeGreaterThan(2e-3);
    expect(Math.min(...i)).toBeLessThan(1e-5);
    expect(con).toMatch(/SW 1 ADC \d+/);
    expect(con).toMatch(/SW 0 ADC \d+/);
    const adc = [...con.matchAll(/ADC (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.abs(adc[adc.length - 1] - 2048)).toBeLessThan(40);
  });

  it.skipIf(!paths)('PWM (LEDC) ที่ IO2 1 kHz duty 25 % → ขาสลับจริงในวงจร (สร้างจากรีจิสเตอร์ LEDC) · I²C(0) ที่ IO21/IO22 เจอ BH1750 0x23 และอ่านค่าแสงได้', { timeout: 240000 }, () => {
    const code = [
      'from machine import Pin, PWM, I2C', 'import time',
      'p = PWM(Pin(2), freq=1000, duty_u16=16384)',
      'i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)', 'print("scan", i2c.scan())',
      'i2c.writeto(0x23, bytes([0x10]))', 'time.sleep(0.2)', 'd = i2c.readfrom(0x23, 2)', 'print("lux", (d[0] << 8 | d[1]) / 1.2)',
    ].join('\n') + '\n';
    const { st, con } = runSensor(rig(code), 4.4, 0.1);
    expect(con).toContain('scan [35]');
    const lux = Number(/lux ([\d.]+)/.exec(con)![1]);
    expect(Math.abs(lux - 300)).toBeLessThan(15);
    const m = st[st.length - 1].r.mcu![0];
    expect(Math.abs(m.duty[2] - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(m.edges![2] / 2 / 0.1 - 1000)).toBeLessThan(40);
    const led = st[st.length - 1].an.parts.LED1?.current ?? 0;
    expect(led).toBeGreaterThan(0.5e-3); // กระแสเฉลี่ยราว 1/4 ของตอนติดเต็ม
  });

  it('ในเบราว์เซอร์ (ไม่มีบริการ QEMU) ไม่จำลองแทนด้วยบอร์ดอื่น — แจ้งว่าต้องใช้เซิร์ฟเวอร์', () => {
    setEsp32LinkFactory(null);
    const b = rig('print(1)\n');
    let err = '';
    try { runSensor(b, 0.1, 0.1); } catch (e) { err = String((e as Error).message); }
    if (paths) setEsp32LinkFactory(() => openEsp32Link(paths));
    expect(err).toContain('ESP32 ต้องจำลองบนเซิร์ฟเวอร์');
  });
});
