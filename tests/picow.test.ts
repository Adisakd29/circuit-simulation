import { describe, expect, it } from 'vitest';
import { pulldownRig, runSensor } from './sensor-rig';
import { buildNetlist } from '../src/sim/netlist';
import { catalogEntry, pinDefs } from '../src/model/catalog';
import { pinHolesFor } from '../src/model/geometry';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork, isPico } from '../src/model/types';
import { FIRMWARE_B64, FIRMWARE_PICOW_B64 } from '../src/mcu/firmware-data';
import { Builder, onBoard } from './helpers';

/**
 * Raspberry Pi Pico W (ไม่มีไร้สาย) — CPU RP2040 (rp2040js) รันเฟิร์มแวร์ MicroPython v1.24.1 ที่ build จากบอร์ด CIRCUITLAB_PICO_W
 * (firmware/board-picow: PICO_BOARD pico_w, ไม่เปิด CYW43/network) · ทุกข้อรันเฟิร์มแวร์จริงบนตัวจำลอง ไม่ได้ใช้เฟิร์มแวร์ของ Pico แทน
 */
const sendRun = (code: string) => pulldownRig({ code, kind: 'picow' });

describe('Raspberry Pi Pico W (ไม่มีไร้สาย)', () => {
  it('หัวต่อ 40 ขาและตำแหน่งรูเหมือน Pico · สเปกในวงจรระบุเฟิร์มแวร์ picow · เฟิร์มแวร์ต่างไฟล์จาก Pico', () => {
    const a = new Builder().part('pico', onBoard('h1'), 'A', {}), b = new Builder().part('picow', onBoard('h1'), 'B', {});
    expect(catalogEntry('picow')!.supported).toBe(true);
    expect(pinDefs(b.doc.parts[0]).map((d) => [d.name, d.dx, d.dy])).toEqual(pinDefs(a.doc.parts[0]).map((d) => [d.name, d.dx, d.dy]));
    expect(pinHolesFor(b.doc.parts[0]).map((x) => x.hole)).toEqual(pinHolesFor(a.doc.parts[0]).map((x) => x.hole));
    expect(isPico(b.doc.parts[0])).toBe(true);
    expect(buildNetlist(b.doc).netlist.mcus![0]).toMatchObject({ fw: 'picow' });
    expect(buildNetlist(a.doc).netlist.mcus![0].fw).toBeUndefined();
    expect(FIRMWARE_PICOW_B64).not.toBe(FIRMWARE_B64);
  });

  it('บูตเฟิร์มแวร์ Pico W: banner และ sys.implementation บอกรุ่น · Pin("LED") → ValueError (LED ต่อกับ CYW43 ที่ไม่ได้จำลอง) · ไม่มีโมดูล network', { timeout: 60000 }, () => {
    const code = 'import sys\nprint("M:", sys.implementation._machine)\ntry:\n    from machine import Pin\n    Pin("LED")\nexcept ValueError as e:\n    print("LED err:", e)\ntry:\n    import network\n    print("net ok")\nexcept ImportError:\n    print("no network")\n';
    const { con } = runSensor(sendRun(code), 1.5, 0.05);
    expect(con).toContain('Raspberry Pi Pico W (Circuit Lab 3D emulator, no wireless) with RP2040');
    expect(con).toContain('LED err: unknown named pin "LED"');
    expect(con).toContain('no network');
  });

  it('แลป 52 บน Pico W: กด SW1 → LED1 (GP16) ติด · กด SW2 (PULL_UP ภายใน) → LED2 ติด · ตัวตรวจแลปเห็นบอร์ด Pico W', { timeout: 120000 }, () => {
    const press = (b: Builder, id: string, v: boolean) => { const p = b.doc.parts.find((x) => x.id === id)!; (p.params as { pressed: boolean }).pressed = v; return true; };
    const b = pulldownRig({ kind: 'picow' });
    const { st, con } = runSensor(b, 2.4, 0.1, (t, bb) => {
      if (Math.abs(t - 1.2) < 1e-6) return press(bb, 'SW1', true);
      if (Math.abs(t - 1.6) < 1e-6) { press(bb, 'SW1', false); return press(bb, 'SW2', true); }
    });
    const i = (k: number, id: string) => st[k].an.parts[id]?.current ?? 0;
    expect(i(10, 'LED1')).toBeLessThan(1e-5);
    expect(i(13, 'LED1')).toBeGreaterThan(1e-3);
    expect(i(17, 'LED2')).toBeGreaterThan(1e-3);
    expect(i(17, 'LED1')).toBeLessThan(1e-5);
    expect(con).toMatch(/SW1 = 1 {2}SW2 = 1 {2}presses: 1 0/);
    const last = st[st.length - 1];
    const res = checkLesson('pulldown', { doc: b.doc, built: buildNetlist(b.doc), result: last.r.result, analysis: last.an, work: emptyWork(), logger: null, time: last.t, mcu: last.r.mcu?.[0] ?? null } as never);
    expect(res.wire).toMatchObject({ pass: true }); // ตัวตรวจหา Pico W เจอ (ไม่ใช่ "วาง Raspberry Pi Pico") และการต่อปุ่มถูกต้อง
  });

  it('ADC GP26 อ่านแรงดันจากวงจร · PWM GP16 1 kHz duty 25% ตามตัวจับเวลาของ RP2040', { timeout: 60000 }, () => {
    const code = 'from machine import ADC, PWM, Pin\nimport time\np = PWM(Pin(16))\np.freq(1000)\np.duty_u16(16384)\ntime.sleep(0.2)\nprint("adc", ADC(26).read_u16())\n';
    const { st, con } = runSensor(sendRun(code), 1.2, 0.05);
    expect(con).toMatch(/adc \d+/);
    const m = st[st.length - 1].r.mcu![0];
    expect(Math.abs(m.duty[16] - 0.25)).toBeLessThan(0.02);
    expect(Math.abs(m.edges![16] / 2 / 0.05 - 1000)).toBeLessThan(40);
    expect(m.led).toBe(0); // LED บนบอร์ด Pico W ไม่ผูกกับ GP25
  });
});
