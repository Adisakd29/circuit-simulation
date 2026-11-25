import { describe, expect, it } from 'vitest';
import glbData from '../src/assets/models/unoq.glb?inline';
import pads from './fixtures/cad/unoq-header-pads.json';
import { UNOQ_HDR, UNOQ_PIN_LOCAL, UNOQ_PCB_TOP } from '../src/render/board-parts';
import { tablePinLocal } from '../src/render/models';
import { defaultPart, pinDefs } from '../src/model/catalog';
import type { Part } from '../src/model/types';

/** แปลงพิกัด IPC-356 (mm) → กรอบของแอป: x จากขอบ USB-C, ระยะจากขอบหัวต่อดิจิทัล */
const conv = (x: number, y: number) => ({ fromUsb: 68.58 - y, fromTop: 53.34 - x });
const DIG = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'GND.1', 'AREF', 'SDA', 'SCL'];
const ANA = ['BOOT', 'IOREF', 'RESET', '3V3', '5V', 'GND.2', 'GND.3', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
const nameOf = (ref: string, pin: string) => (ref === 'JDIGIT' ? DIG : ANA)[Number(pin) - 1];

describe('Arduino UNO Q: ตำแหน่งขาในโมเดล 3D ตรงกับไฟล์ CAD ของผู้ผลิต (IPC-356)', () => {
  const header = pads.pads.filter((p) => p.ref === 'JDIGIT' || p.ref === 'JANALO');
  it('หัวต่อ 18 + 14 ขา: ทุกขามีในแอป ตำแหน่งตรงแพดจริงภายใน 0.01 mm', () => {
    expect(header.length).toBe(32);
    for (const p of header) {
      const n = nameOf(p.ref, p.pin);
      const c = conv(p.x, p.y);
      const [x, row] = UNOQ_HDR[n];
      expect(Math.abs(x - c.fromUsb), n).toBeLessThan(0.01);
      expect(row, n).toBe(c.fromTop < 10 ? 'top' : 'bot');
      expect(Math.abs((row === 'top' ? 2.54 : 50.8) - c.fromTop), n).toBeLessThan(0.01);
    }
  });
  it('ชื่อขาในแอปตรงกับเน็ตในแบบวงจร (พอร์ต STM32 และรางไฟ)', () => {
    const q = defaultPart('unoq', 'Q', 'Q', { kind: 'table', x: 0, z: 0, rotation: 0 }) as Part;
    const defs = Object.fromEntries(pinDefs(q).map((d) => [d.name, d.label]));
    for (const p of header) expect(defs[nameOf(p.ref, p.pin)], `${p.ref}.${p.pin}`).toBeDefined();
    const net = (n: string) => header.find((p) => nameOf(p.ref, p.pin) === n)!.net;
    for (const [pin, port] of [['A0', 'PA4'], ['A1', 'PA5'], ['A2', 'PA6'], ['A3', 'PA7'], ['A4', 'PC1'], ['A5', 'PC0'], ['D3', 'PB0'], ['D4', 'PA12'], ['D5', 'PA11'], ['D6', 'PB1'], ['D7', 'PB2'], ['D9', 'PB8']] as const) {
      expect(net(pin), pin).toBe(`MCU_${port}`);
      expect(defs[pin], pin).toContain(`(${port})`);
    }
    expect(net('IOREF')).toBe('PWR_3P3V'); expect(net('3V3')).toBe('PWR_3P3V');
    expect(net('5V')).toBe('5V_SYS'); expect(net('VIN')).toBe('DC_IN'); expect(net('BOOT')).toBe('MCU_BOOT0');
    expect(net('GND.1')).toBe('GND'); expect(net('GND.2')).toBe('GND'); expect(net('AREF')).toBe('MCU_VREF+');
  });
  it('จุดต่อสาย (ปลายขาบนหัวต่อ) อยู่เหนือรูแพดจริง และใช้ตำแหน่งเดียวกันทั้งโมเดลและตัวต่อสาย', () => {
    const q = defaultPart('unoq', 'Q', 'Q', { kind: 'table', x: 0, z: 0, rotation: 0 }) as Part;
    for (const [n, [x, , z]] of Object.entries(UNOQ_PIN_LOCAL)) {
      const t = tablePinLocal(q, n);
      expect([t.x, t.z]).toEqual([x, z]);
      expect(t.y * 2.54).toBeCloseTo(UNOQ_PCB_TOP + 8.5, 6);
    }
    // ระยะห่างขาทุกคู่ในแถว = 2.54 mm ยกเว้นช่องว่างตามมาตรฐาน UNO (D7–D8 4.064 mm, VIN–A0 5.08 mm)
    const gap = (a: string, b: string) => Math.abs(UNOQ_PIN_LOCAL[a][0] - UNOQ_PIN_LOCAL[b][0]) * 2.54;
    expect(gap('D7', 'D8')).toBeCloseTo(4.064, 3);
    expect(gap('VIN', 'A0')).toBeCloseTo(5.08, 3);
    expect(gap('D0', 'D1')).toBeCloseTo(2.54, 3);
  });
  it('ไฟล์โมเดล GLB: ข้อมูลแหล่งที่มา/ใบอนุญาต ชิ้นส่วนหลัก และขนาดไฟล์เหมาะกับเว็บ', () => {
    const bin = atob(glbData.slice(glbData.indexOf(',') + 1));
    const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const dv = new DataView(b.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(b.length).toBeLessThan(1_600_000);
    const jl = dv.getUint32(12, true);
    const j = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jl)));
    expect(j.asset.copyright).toContain('CC BY-SA 4.0');
    expect(j.extensionsUsed).toContain('EXT_meshopt_compression');
    const names = j.nodes.map((n: { name: string }) => n.name);
    for (const n of ['pcbTop', 'pcbBot', 'hdr', 'gold', 'steel', 'atlas', 'ledBody']) expect(names, n).toContain(n);
    expect(j.images.length).toBeGreaterThanOrEqual(5);
  });
});
