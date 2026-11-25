import { describe, expect, it } from 'vitest';
import { runSensor } from './sensor-rig';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { catalogEntry, pinDefs, NANOCONNECT_GPIO } from '../src/model/catalog';
import { coveredHoles, pinHolesFor } from '../src/model/geometry';
import { isPico, isMicroPy } from '../src/model/types';
import { setBoardModel } from '../src/editor/ops';
import { netOfPin } from '../src/connectivity/connectivity';
import { FIRMWARE_B64, FIRMWARE_NANOCONNECT_B64 } from '../src/mcu/firmware-data';
import { Builder, H, onBoard } from './helpers';

/**
 * Arduino Nano RP2040 Connect — CPU RP2040 (rp2040js) รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build จากบอร์ด CIRCUITLAB_NANO_RP2040_CONNECT
 * (firmware/board-nanoconnect: นิยามบอร์ด ARDUINO_NANO_RP2040_CONNECT ที่ปิด NINA-W102) · IMU LSM6DSOX บนบอร์ดจำลองระดับรีจิสเตอร์ · ทุกข้อรันเฟิร์มแวร์จริง
 *
 * วงจร (MB-102, บอร์ดที่ h1): ขา 1–15 = h1–h15 (TX RX RST GND.1 D2…D12), ขา 16–30 = d15…d1 (D13 3V3 REF A0 A1 A2 A3 A4 A5 A6 A7 VUSB REC GND.2 VIN)
 * GND.1 j4 → bn4, GND.2 c2 → tn2, 3V3 c14 → tp14, ราง tp20–bp20
 * LED1: D2 (j5 → j30) · R 330 Ω g30–g34 · LED f34/f35 · i35 → bn36
 * SW1 ปุ่ม f40: คอลัมน์ 40 ด้านบน → GND (a40 → tn40), คอลัมน์ 42 ด้านล่าง → D3 (j6 → g42) ใช้ PULL_UP ภายใน
 * ตัวแบ่งแรงดันที่ A3 (d9): b9 → b50 · R 10 kΩ c46–c50 (a46 → tn46) · R 10 kΩ d50–d54 (a54 → tp54)
 * BH1750 j56 (VCC 56, GND 57, SCL 58, SDA 59): i56 → bp56, i57 → bn57, A5 (a7 → i58), A4 (a8 → i59) — บัสเดียวกับ IMU บนบอร์ด
 */
function rig(code: string, o: { motion?: 'still' | 'walk' | 'shake'; extra?: (b: Builder) => void } = {}) {
  const b = new Builder();
  const r = setBoardModel(b.doc, 'bb1', 'MB-102');
  if (!r.ok) throw new Error(r.errors.join());
  b.doc = r.doc;
  b.part('nanoconnect', onBoard('h1'), 'PICO1', { code, autorun: code !== '', motion: o.motion ?? 'still', spm: 100 });
  b.wire(H('j4'), H('bn4'), 'wg1', '#212121').wire(H('c2'), H('tn2'), 'wg2', '#212121').wire(H('c14'), H('tp14'), 'wv', '#e53935').wire(H('tp20'), H('bp20'), 'wvv', '#e53935');
  b.wire(H('j5'), H('j30'), 'wl', '#43a047');
  b.part('resistor', onBoard('g30'), 'R1', { resistance: 330, span: 4 });
  b.part('led', onBoard('f34'), 'LED1', { color: 'red' });
  b.wire(H('i35'), H('bn36'), 'wk', '#212121');
  b.part('pushbutton', onBoard('f40'), 'SW1', {});
  b.wire(H('a40'), H('tn40'), 'wsg', '#212121').wire(H('j6'), H('g42'), 'wsw', '#1e88e5');
  b.wire(H('b9'), H('b50'), 'wa', '#fb8c00');
  b.part('resistor', onBoard('c46'), 'RD1', { resistance: 10000, span: 4 }).part('resistor', onBoard('d50'), 'RD2', { resistance: 10000, span: 4 });
  b.wire(H('a46'), H('tn46'), 'wdg', '#212121').wire(H('a54'), H('tp54'), 'wdv', '#e53935');
  b.part('bh1750', onBoard('j56'), 'LUX1', {});
  b.wire(H('i56'), H('bp56'), 'wlv', '#e53935').wire(H('i57'), H('bn57'), 'wlg', '#212121').wire(H('a7'), H('i58'), 'wscl', '#fdd835').wire(H('a8'), H('i59'), 'wsda', '#8e24aa');
  o.extra?.(b);
  return b;
}

describe('Arduino Nano RP2040 Connect (ไม่จำลอง NINA-W102)', () => {
  it('หัวต่อ 30 ขาตาม JP1/JP2 ของ datasheet ตำแหน่งแบบ Nano · GPIO ตามนิยามบอร์ด · บัส I²C ของ A4/A5 มีตัวดึงขึ้น 4.7 kΩ และ IMU 0x6A · ไม่ใช่หัวต่อแบบ Pico', () => {
    const b = rig('');
    const p = b.doc.parts[0];
    expect(catalogEntry('nanoconnect')!.supported).toBe(true);
    expect(isPico(p)).toBe(false);
    expect(isMicroPy(p)).toBe(true);
    expect(pinDefs(p)).toHaveLength(30);
    const holes = Object.fromEntries(pinHolesFor(p).map((x) => [x.pin, x.hole]));
    expect(holes).toMatchObject({ D1: 'h1', D0: 'h2', 'GND.1': 'h4', D2: 'h5', D12: 'h15', D13: 'd15', '3V3': 'd14', A0: 'd12', A3: 'd9', A4: 'd8', A5: 'd7', A7: 'd5', VUSB: 'd4', 'GND.2': 'd2', VIN: 'd1' });
    expect(coveredHoles(p)).toHaveLength(45);
    const built = buildNetlist(b.doc);
    const m = built.netlist.mcus![0];
    expect(m.fw).toBe('nanoconnect');
    const n = (pin: string) => netOfPin(built.connectivity, p.id, pin);
    for (const [name, g] of NANOCONNECT_GPIO) expect(m.gp[g]).toBe(n(name));
    expect(m.gp[12]).toBe(n('A4'));
    expect(m.gp.filter((x) => x >= 0)).toHaveLength(20);
    expect(n('GND.1')).toBe(n('GND.2'));
    const pu = built.netlist.elements.filter((e) => e.id === 'PICO1#psda' || e.id === 'PICO1#pscl');
    expect(pu.map((e) => (e.type === 'R' ? e.R : 0))).toEqual([4700, 4700]);
    expect(built.netlist.i2cs!.find((s) => s.id === 'PICO1#imu')).toMatchObject({ dev: 'lsm6dsox', addr: 0x6a, sda: n('A4'), scl: n('A5'), vcc: n('3V3') });
    expect(FIRMWARE_NANOCONNECT_B64).not.toBe(FIRMWARE_B64);
  });

  it('บูตเฟิร์มแวร์: banner + ชื่อขา TX/D2/D13/A3/SDA/SCL/LED ตรง GPIO · Pin("LEDR") (LED RGB ผ่าน NINA) → ValueError · ไม่มีโมดูล network · มีไดรเวอร์ lsm6dsox', { timeout: 60000 }, () => {
    const code = [
      'import sys', 'from machine import Pin', 'print("M:", sys.implementation._machine)',
      'for nm in ("TX", "RX", "D2", "D12", "D13", "A3", "SDA", "SCL", "LED"):', '    print(nm, str(Pin(nm)).split(",")[0])',
      'for nm in ("LEDR", "A6"):', '    try:', '        Pin(nm)', '    except ValueError as e:', '        print(nm, "err:", e)',
      'try:', '    import network', '    print("net ok")', 'except ImportError:', '    print("no network")',
      'import lsm6dsox', 'print("lsm6dsox ok")',
    ].join('\n') + '\n';
    const { con } = runSensor(rig(code), 1.4, 0.1);
    expect(con).toContain('Arduino Nano RP2040 Connect (Circuit Lab 3D emulator, no NINA-W102) with RP2040');
    for (const [nm, g] of [['TX', 0], ['RX', 1], ['D2', 25], ['D12', 4], ['D13', 6], ['A3', 29], ['SDA', 12], ['SCL', 13], ['LED', 6]] as const) expect(con).toContain(`${nm} Pin(GPIO${g}`);
    expect(con).toContain('LEDR err: unknown named pin "LEDR"');
    expect(con).toContain('A6 err: unknown named pin "A6"');
    expect(con).toContain('no network');
    expect(con).toContain('lsm6dsox ok');
  });

  it('LED ภายนอก D2 + LED บนบอร์ด (D13) กะพริบ · ปุ่ม D3 (PULL_UP) อ่านได้ · ADC A3 (GPIO29) อ่านตัวแบ่งแรงดัน ≈ 1.65 V', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, ADC', 'import time',
      'led = Pin("D2", Pin.OUT)', 'onb = Pin("LED", Pin.OUT)', 'sw = Pin("D3", Pin.IN, Pin.PULL_UP)', 'a = ADC(Pin("A3"))',
      'while True:', '    led.toggle()', '    onb.toggle()', '    print("SW", sw.value(), "ADC", a.read_u16())', '    time.sleep(0.2)',
    ].join('\n') + '\n';
    const press = (bb: Builder) => { (bb.doc.parts.find((x) => x.id === 'SW1')!.params as { pressed: boolean }).pressed = true; return true; };
    const { st, con } = runSensor(rig(code), 2.6, 0.05, (t, bb) => { if (Math.abs(t - 1.8) < 1e-6) return press(bb); });
    const i = st.slice(20).map((s) => s.an.parts.LED1?.current ?? 0);
    expect(Math.max(...i)).toBeGreaterThan(2e-3);
    expect(Math.min(...i)).toBeLessThan(1e-5);
    const onb = st.slice(20).map((s) => s.r.mcu![0].led);
    expect(Math.max(...onb)).toBeGreaterThan(0.9);
    expect(Math.min(...onb)).toBeLessThan(0.1);
    expect(con).toMatch(/SW 1 ADC \d+/);
    expect(con).toMatch(/SW 0 ADC \d+/);
    const adc = [...con.matchAll(/ADC (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.abs((adc[adc.length - 1] / 65535) * 3.3 - 1.65)).toBeLessThan(0.1);
  });

  it('IMU LSM6DSOX บนบอร์ด: WHO_AM_I = 0x6C · scan เห็น IMU (0x6A) และ BH1750 ภายนอก (0x23) บนบัสเดียวกัน · ไดรเวอร์ lsm6dsox: วางนิ่ง ≈ (0, 0, 1) g ไจโร ≈ 0 · ค่าดิบ ±2 g ตาม 0.061 mg/LSB', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, I2C', 'from lsm6dsox import LSM6DSOX', 'import time',
      'i2c = I2C(0, scl=Pin(13), sda=Pin(12))', 'print("scan", i2c.scan())', 'print("who %02x" % i2c.readfrom_mem(0x6a, 0x0f, 1)[0])',
      'imu = LSM6DSOX(i2c, accel_scale=2)', 'time.sleep(0.1)',
      'print("acc %.3f %.3f %.3f" % imu.accel())', 'print("gyr %.2f %.2f %.2f" % imu.gyro())',
      'raw = i2c.readfrom_mem(0x6a, 0x2c, 2)', 'print("rawz", raw[0] | raw[1] << 8)',
    ].join('\n') + '\n';
    const { con } = runSensor(rig(code), 1.6, 0.1);
    expect(con).toContain('scan [35, 106]');
    expect(con).toContain('who 6c');
    const acc = /acc (\S+) (\S+) (\S+)/.exec(con)!.slice(1).map(Number);
    expect(Math.abs(acc[0])).toBeLessThan(0.05);
    expect(Math.abs(acc[1])).toBeLessThan(0.05);
    expect(Math.abs(acc[2] - 1)).toBeLessThan(0.05);
    const gyr = /gyr (\S+) (\S+) (\S+)/.exec(con)!.slice(1).map(Number);
    for (const v of gyr) expect(Math.abs(v)).toBeLessThan(2);
    const rawz = Number(/rawz (\d+)/.exec(con)![1]);
    expect(Math.abs(rawz - 1 / 0.061e-3)).toBeLessThan(200); // 1 g ที่ ±2 g ≈ 16393 LSB
  });

  it('IMU ตามการเคลื่อนไหวที่ตั้งในแผง: เขย่า → ความเร่งแกน x แกว่ง > 0.5 g และไจโรหลายสิบ °/s · ปิดเซนเซอร์ (ODR = 0) แล้วค่าค้าง', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, I2C', 'from lsm6dsox import LSM6DSOX', 'import time',
      'imu = LSM6DSOX(I2C(0, scl=Pin(13), sda=Pin(12)))', 'mx = 0', 'mg = 0',
      'for k in range(40):', '    ax, ay, az = imu.accel()', '    gx, gy, gz = imu.gyro()', '    mx = max(mx, abs(ax))', '    mg = max(mg, abs(gx))', '    time.sleep(0.01)',
      'print("max %.2f %.1f" % (mx, mg))',
      'imu.bus.writeto_mem(0x6a, 0x10, bytes([0]))', 'a1 = imu.accel()', 'time.sleep(0.05)', 'a2 = imu.accel()', 'print("hold", a1 == a2)',
    ].join('\n') + '\n';
    const { con } = runSensor(rig(code, { motion: 'shake' }), 2.0, 0.1);
    const [mx, mg] = /max (\S+) (\S+)/.exec(con)!.slice(1).map(Number);
    expect(mx).toBeGreaterThan(0.5);
    expect(mg).toBeGreaterThan(30);
    expect(con).toContain('hold True');
  });

  it('คำเตือน: VUSB (5 V) ต่อเข้า D3 → อันตราย "D3 (GPIO15)" · ใช้ A6 → แจ้งว่าต่อกับ NINA-W102 (ไม่จำลอง) · กระแสขาเกิน 8 mA ตาม datasheet', { timeout: 60000 }, () => {
    const b = rig('from machine import Pin\nPin("D4", Pin.OUT).value(1)\n', {
      extra: (x) => {
        x.wire(H('a4'), H('i6'), 'w5', '#ff7043');
        x.wire(H('a6'), H('a52'), 'wa6', '#90a4ae').part('resistor', onBoard('b52'), 'RA6', { resistance: 10000, span: 4 }).wire(H('a56'), H('tn56'), 'wa6g', '#212121');
        x.wire(H('j7'), H('j44'), 'wd4', '#43a047').part('resistor', onBoard('i44'), 'RL', { resistance: 220, span: 4 }).wire(H('j48'), H('bn48'), 'wd4g', '#212121');
      },
    });
    const { st, built } = runSensor(b, 1.2, 0.1);
    const last = st[st.length - 1];
    const an = analyze(b.doc, built, last.r.result, last.r.tones);
    const msgs = an.ok ? an.diagnostics.map((d) => d.message) : [];
    expect(msgs.some((m) => m.includes('D3 (GPIO15)') && m.includes('ไม่ทนแรงดัน 5 V'))).toBe(true);
    expect(msgs.some((m) => m.includes('A6') && m.includes('NINA-W102'))).toBe(true);
    expect(msgs.some((m) => m.includes('D4 (GPIO16)') && m.includes('≈ 8 mA'))).toBe(true);
  });
  it('PWM ที่ D2 1 kHz duty 25 % · Pin.irq ที่ D3 นับการกด · machine.Timer สลับ LED บนบอร์ด (D13) ทุก 50 ms → 10 Hz', { timeout: 120000 }, () => {
    const code = [
      'from machine import Pin, PWM, Timer', 'import time',
      'p = PWM(Pin("D2"))', 'p.freq(1000)', 'p.duty_u16(16384)',
      'onb = Pin("LED", Pin.OUT)', 'sw = Pin("D3", Pin.IN, Pin.PULL_UP)', 'n = [0]',
      'def hit(x):', '    n[0] += 1', 'sw.irq(trigger=Pin.IRQ_FALLING, handler=hit)',
      'tm = Timer(period=50, mode=Timer.PERIODIC, callback=lambda t: onb.toggle())',
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
    expect(Math.abs(m.duty[25] - 0.25)).toBeLessThan(0.02); // GPIO25 = D2
    expect(Math.abs(m.edges![25] / 2 / 0.1 - 1000)).toBeLessThan(40);
    expect(Math.abs(m.edges![6] / 2 / 0.1 - 10)).toBeLessThan(1.5); // GPIO6 = D13 / LED
  });
});
