import { describe, expect, it } from 'vitest';
import { runSensor } from './sensor-rig';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { catalogEntry, pinDefs, XIAO_PINOUT } from '../src/model/catalog';
import { coveredHoles, pinHolesFor } from '../src/model/geometry';
import { isPico, isMicroPy } from '../src/model/types';
import { setBoardModel } from '../src/editor/ops';
import { FIRMWARE_B64, FIRMWARE_PICOW_B64, FIRMWARE_XIAO_B64 } from '../src/mcu/firmware-data';
import { netOfPin } from '../src/connectivity/connectivity';
import { Builder, H, onBoard } from './helpers';

/**
 * Seeed Studio XIAO RP2040 — CPU RP2040 (rp2040js) รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build จากบอร์ด CIRCUITLAB_XIAO_RP2040
 * (firmware/board-xiao: นิยามบอร์ด SEEED_XIAO_RP2040 ยกมาจาก MicroPython v1.28.0) · ทุกข้อรันเฟิร์มแวร์จริงบนตัวจำลอง
 *
 * วงจร (เบรดบอร์ด MB-102, XIAO ที่ h1): D0–D6 = h1–h7, 5V d1, GND d2, 3V3 d3, D10 d4, D9 d5, D8 d6, D7 d7
 * GND c2 → tn2, 3V3 c3 → tp3, ราง tn5–bn5 / tp6–bp6
 * LED1: D0 (j1 → j20) · R 330 Ω g20–g24 · LED f24/f25 · i25 → bn26
 * SW1: ปุ่ม f30 — คอลัมน์ 30 ด้านบน → GND (a30 → tn30), คอลัมน์ 32 ด้านล่าง → D1 (j2 → g32) ใช้ PULL_UP ภายใน
 * ตัวแบ่งแรงดัน D3/A3 (GPIO29 = ADC3): j4 → j40 · R 10 kΩ g36–g40 (col 36 → bn36) · R 10 kΩ h40–h44 (col 44 → bp44)
 * BH1750 j50 (VCC 50, GND 51, SCL 52, SDA 53, ADDR 54): i50 → bp50, i51 → bn51, D5 SCL (j6 → i52), D4 SDA (j5 → i53)
 */
function rig(code: string, o: { fiveVoltOn?: string } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part('xiao', onBoard('h1'), 'PICO1', { code, autorun: code !== '' });
  b.wire(H('c2'), H('tn2'), 'wg', '#212121').wire(H('c3'), H('tp3'), 'wv', '#e53935').wire(H('tn5'), H('bn5'), 'wgg', '#212121').wire(H('tp6'), H('bp6'), 'wvv', '#e53935');
  b.wire(H('j1'), H('j20'), 'wl', '#43a047');
  b.part('resistor', onBoard('g20'), 'R1', { resistance: 330, span: 4 });
  b.part('led', onBoard('f24'), 'LED1', { color: 'red' });
  b.wire(H('i25'), H('bn26'), 'wk', '#212121');
  b.part('pushbutton', onBoard('f30'), 'SW1', {});
  b.wire(H('a30'), H('tn30'), 'wsg', '#212121').wire(H('j2'), H('g32'), 'wsw', '#1e88e5');
  b.wire(H('j4'), H('j40'), 'wa', '#fb8c00');
  b.part('resistor', onBoard('g36'), 'RD1', { resistance: 10000, span: 4 }).part('resistor', onBoard('h40'), 'RD2', { resistance: 10000, span: 4 });
  b.wire(H('j36'), H('bn36'), 'wdg', '#212121').wire(H('j44'), H('bp44'), 'wdv', '#e53935');
  b.part('bh1750', onBoard('j50'), 'LUX1', {});
  b.wire(H('i50'), H('bp50'), 'wlv', '#e53935').wire(H('i51'), H('bn51'), 'wlg', '#212121').wire(H('j6'), H('i52'), 'wscl', '#fdd835').wire(H('j5'), H('i53'), 'wsda', '#8e24aa');
  // ขา 5V (d1) ต่อเข้าขาสัญญาณ (ทดสอบคำเตือนแรงดันเกิน): สายจาก a1 (คอลัมน์เดียวกับ 5V) ไปรูในคอลัมน์ของขานั้น
  if (o.fiveVoltOn) b.wire(H('a1'), H(o.fiveVoltOn), 'w5', '#ff7043');
  return b;
}

describe('Seeed Studio XIAO RP2040', () => {
  it('ขา 14 ขา: D0–D6 แถวที่แตะ, D7…5V อีกฝั่งห่าง 6 แถว (ขา 14 = 5V ตรงข้ามขา 1 = D0) · ตัวบอร์ดปิดรูแถว e–g · GPIO ตามนิยามบอร์ด · ไม่ใช่หัวต่อแบบ Pico', () => {
    const b = rig('');
    const p = b.doc.parts[0];
    expect(catalogEntry('xiao')!.supported).toBe(true);
    expect(isPico(p)).toBe(false);
    expect(isMicroPy(p)).toBe(true);
    const holes = Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]));
    expect(holes).toMatchObject({ D0: 'h1', D6: 'h7', D7: 'd7', D8: 'd6', D9: 'd5', D10: 'd4', '3V3': 'd3', GND: 'd2', '5V': 'd1' });
    expect(pinDefs(p)).toHaveLength(14);
    expect(coveredHoles(p)).toHaveLength(21); // แถว e f g × 7 คอลัมน์ (ร่องกลางไม่มีรู)
    expect(coveredHoles(p)).toContain('e4');
    const m = buildNetlist(b.doc).netlist.mcus![0];
    expect(m.fw).toBe('xiao');
    expect(m.gp).toHaveLength(30);
    const conn = buildNetlist(b.doc).connectivity;
    const n = (pin: string) => netOfPin(conn, p.id, pin);
    for (const [name, g] of XIAO_PINOUT) if (g >= 0) expect(m.gp[g]).toBe(n(name));
    expect(m.gp.filter((x) => x >= 0)).toHaveLength(11);
    expect(m.gp[12]).toBe(-1); // NeoPixel อยู่บนบอร์ด ไม่ออกขา
    expect(FIRMWARE_XIAO_B64).not.toBe(FIRMWARE_B64);
    expect(FIRMWARE_XIAO_B64).not.toBe(FIRMWARE_PICOW_B64);
  });

  it('บูตเฟิร์มแวร์ XIAO: banner + ชื่อขา "D0"…"D10"/"A3"/"LED_R/G/B"/"NEOPIXEL" ตรงกับ GPIO ตามนิยามบอร์ด SEEED_XIAO_RP2040', { timeout: 60000 }, () => {
    const code = 'from machine import Pin\nfor n in ("D0","D3","D4","D6","D9","D10","A3","LED_R","LED_G","LED_B","NEOPIXEL","NEOPIXEL_POWER"):\n    print(n, str(Pin(n)).split(",")[0])\n';
    const { con } = runSensor(rig(code), 1.4, 0.1);
    expect(con).toContain('Seeed Studio XIAO RP2040 (Circuit Lab 3D emulator) with RP2040');
    for (const [n, g] of [['D0', 26], ['D3', 29], ['D4', 6], ['D6', 0], ['D9', 4], ['D10', 3], ['A3', 29], ['LED_R', 17], ['LED_G', 16], ['LED_B', 25], ['NEOPIXEL', 12], ['NEOPIXEL_POWER', 11]] as const) {
      expect(con).toContain(`${n} Pin(GPIO${g}`);
    }
  });

  it('LED ภายนอกที่ D0 กะพริบตามโค้ด · ปุ่มที่ D1 (PULL_UP ภายใน) อ่านได้ · ADC ที่ D3/A3 (GPIO29 = ADC3) อ่านตัวแบ่งแรงดัน ≈ 1.65 V', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, ADC', 'import time',
      'led = Pin("D0", Pin.OUT)', 'sw = Pin("D1", Pin.IN, Pin.PULL_UP)', 'a = ADC(Pin("A3"))',
      'while True:', '    led.toggle()', '    print("SW", sw.value(), "ADC", a.read_u16())', '    time.sleep(0.2)',
    ].join('\n') + '\n';
    const press = (bb: Builder, v: boolean) => { (bb.doc.parts.find((x) => x.id === 'SW1')!.params as { pressed: boolean }).pressed = v; return true; };
    const { st, con } = runSensor(rig(code), 2.6, 0.05, (t, bb) => { if (Math.abs(t - 1.8) < 1e-6) return press(bb, true); });
    const i = st.map((s) => s.an.parts.LED1?.current ?? 0);
    const late = i.slice(20);
    expect(Math.max(...late)).toBeGreaterThan(2e-3);
    expect(Math.min(...late)).toBeLessThan(1e-5);
    expect(con).toMatch(/SW 1 ADC \d+/);
    expect(con).toMatch(/SW 0 ADC \d+/);
    const adc = [...con.matchAll(/ADC (\d+)/g)].map((m) => Number(m[1]));
    const v = (adc[adc.length - 1] / 65535) * 3.3;
    expect(Math.abs(v - 1.65)).toBeLessThan(0.1);
  });

  it('LED RGB บนบอร์ด: ติดเมื่อขาเป็น LOW · PWM ที่ LED_G duty 25 % → สว่าง ≈ 75 % · เปลี่ยนเป็นขาเข้า = ดับ', { timeout: 60000 }, () => {
    const code = 'from machine import Pin, PWM\nimport time\nr = Pin("LED_R", Pin.OUT)\nr.value(0)\nPin("LED_B", Pin.OUT).value(1)\np = PWM(Pin("LED_G"))\np.freq(1000)\np.duty_u16(16384)\nprint("M1:")\ntime.sleep(0.4)\nr.init(Pin.IN)\nprint("M2:")\n';
    const { st, con } = runSensor(rig(code), 1.6, 0.05);
    const at = (s: string) => { const k = st.findIndex((x) => x.con.includes(s)); return st[Math.min(st.length - 1, k + 2)].r.mcu![0].onboard!; };
    expect(con).toContain('M2:');
    const a = at('M1:');
    expect(a.rgb[0]).toBeGreaterThan(0.98);
    expect(Math.abs(a.rgb[1] - 0.75)).toBeLessThan(0.03);
    expect(a.rgb[2]).toBeLessThan(0.02);
    expect(at('M2:').rgb[0]).toBe(0);
  });

  it('NeoPixel บนบอร์ด: ถอดรหัสสัญญาณ WS2812 ที่ GPIO12 จากโมดูล neopixel (GRB บิตสูงก่อน) · ต้องเปิดไฟที่ GPIO11 · ปิดไฟแล้วดับและลืมสี', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin', 'import neopixel, time',
      'np = neopixel.NeoPixel(Pin("NEOPIXEL"), 1)', 'np[0] = (10, 20, 30)', 'np.write()', 'print("M1:")', 'time.sleep(0.3)',
      'pw = Pin("NEOPIXEL_POWER", Pin.OUT)', 'pw.value(1)', 'np[0] = (255, 16, 128)', 'np.write()', 'print("M2:")', 'time.sleep(0.3)',
      'pw.value(0)', 'print("M3:")', 'time.sleep(0.3)', 'pw.value(1)', 'print("M4:")', 'time.sleep(0.3)',
      'np[0] = (0, 0, 7)', 'np.write()', 'print("M5:")',
    ].join('\n') + '\n';
    const { st, con } = runSensor(rig(code), 3.0, 0.05);
    expect(con).toContain('M5:');
    const at = (s: string) => { const k = st.findIndex((x) => x.con.includes(s)); return st[Math.min(st.length - 1, k + 1)].r.mcu![0].onboard!; };
    expect(at('M1:')).toMatchObject({ neoPower: false, neo: null }); // ส่งข้อมูลตอนไม่มีไฟ = ไม่ติด
    expect(at('M2:')).toMatchObject({ neoPower: true, neo: [255, 16, 128] });
    expect(at('M3:')).toMatchObject({ neoPower: false, neo: null });
    expect(at('M4:')).toMatchObject({ neoPower: true, neo: null }); // ไฟกลับมาแต่ยังไม่ได้ส่งข้อมูลใหม่ = ดับ
    expect(at('M5:')).toMatchObject({ neoPower: true, neo: [0, 0, 7] });
  });

  it('I²C ที่ D4 (SDA) / D5 (SCL) = I2C1 ของ RP2040: I2C(1) เจอ BH1750 ที่ 0x23 และอ่านค่าแสงได้', { timeout: 120000 }, () => {
    const code = [
      'from machine import I2C, Pin', 'import time',
      'i2c = I2C(1, sda=Pin("D4"), scl=Pin("D5"), freq=100000)', 'print("scan", i2c.scan())',
      'i2c.writeto(0x23, bytes([0x10]))', 'time.sleep(0.2)', 'd = i2c.readfrom(0x23, 2)', 'print("lux", (d[0] << 8 | d[1]) / 1.2)',
    ].join('\n') + '\n';
    const { con } = runSensor(rig(code), 2.0, 0.1);
    expect(con).toContain('scan [35]');
    const lux = Number(/lux ([\d.]+)/.exec(con)![1]);
    expect(Math.abs(lux - 300)).toBeLessThan(15);
  });

  it('คำเตือน: ขา 5V ต่อเข้า D2 → อันตราย "D2 (GPIO28) … ไม่ทนแรงดัน 5 V" · ใช้ D6/D7 = แจ้งว่าเป็น REPL', { timeout: 60000 }, () => {
    const b = rig('', { fiveVoltOn: 'j3' });
    b.wire(H('j7'), H('j56'), 'wrepl', '#90a4ae').part('resistor', onBoard('g56'), 'RX', { resistance: 10000, span: 4 }).wire(H('j60'), H('bn60'), 'wrx', '#212121');
    const { st, built } = runSensor(b, 0.4, 0.1);
    const an = analyze(b.doc, built, st[st.length - 1].r.result, st[st.length - 1].r.tones);
    const msgs = an.ok ? an.diagnostics.map((d) => d.message) : [];
    expect(msgs.some((m) => m.includes('D2 (GPIO28)') && m.includes('ไม่ทนแรงดัน 5 V'))).toBe(true);
    expect(msgs.some((m) => m.includes('D6 (GPIO0)') && m.includes('REPL'))).toBe(true);
  });
  it('Pin.irq ที่ D1 นับการกดปุ่ม (ขอบขาลง) · machine.Timer สลับ D0 ทุก 50 ms → LED ภายนอก 10 Hz', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, Timer', 'import time',
      'led = Pin("D0", Pin.OUT)', 'sw = Pin("D1", Pin.IN, Pin.PULL_UP)', 'n = [0]',
      'def hit(p):', '    n[0] += 1', 'sw.irq(trigger=Pin.IRQ_FALLING, handler=hit)',
      'tm = Timer(period=50, mode=Timer.PERIODIC, callback=lambda t: led.toggle())',
      'while True:', '    print("presses", n[0])', '    time.sleep(0.25)',
    ].join('\n') + '\n';
    const press = (bb: Builder, v: boolean) => { (bb.doc.parts.find((x) => x.id === 'SW1')!.params as { pressed: boolean }).pressed = v; return true; };
    const { st, con } = runSensor(rig(code), 3.0, 0.1, (t, bb) => {
      if ([1.5, 2.1].some((x) => Math.abs(t - x) < 1e-6)) return press(bb, true);
      if ([1.8, 2.4].some((x) => Math.abs(t - x) < 1e-6)) return press(bb, false);
    });
    expect(con).toMatch(/presses 2/);
    expect(con).not.toMatch(/presses 3/);
    const m = st[st.length - 1].r.mcu![0];
    expect(Math.abs(m.edges![26] / 2 / 0.1 - 10)).toBeLessThan(1.5); // GPIO26 = D0: 10 Hz (สลับทุก 50 ms)
  });
});
