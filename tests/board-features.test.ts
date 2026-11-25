import { describe, expect, it } from 'vitest';
import { BOARD_PROFILES, FEATURE_LABELS, STATUS4 } from '../src/model/board-features';
import { CATALOG } from '../src/model/catalog';

/** ไฟล์เทสต์ทั้งหมดในโปรเจกต์ (ตรวจว่าหลักฐานที่อ้างมีอยู่จริง) */
const FILES = new Set(Object.keys(import.meta.glob(['./*.test.ts', './e2e/*.py'], { query: '?raw' })).map((f) => `tests/${f.slice(2)}`));
const existsSync = (f: string) => FILES.has(f);

describe('ตารางความสามารถของบอร์ด (Audit)', () => {
  it('ทุกบอร์ดมีครบทุกหัวข้อ · ข้อ Supported ต้องอ้างไฟล์เทสต์ที่มีอยู่จริง', () => {
    for (const b of BOARD_PROFILES) {
      expect(b.features.map((f) => f.id), b.kind).toEqual(FEATURE_LABELS.map(([id]) => id));
      expect(CATALOG.some((c) => c.kind === b.kind), b.kind).toBe(true);
      for (const f of b.features) {
        if (f.level === 'supported') expect(f.evidence?.length, `${b.kind}.${f.id}`).toBeGreaterThan(0);
        for (const e of f.evidence ?? []) expect(existsSync(e), `${b.kind}.${f.id}: ${e}`).toBe(true);
        expect(f.note.length, `${b.kind}.${f.id}`).toBeGreaterThan(3);
      }
    }
  });
  it('บอร์ดที่ไม่มีตัวจำลอง CPU (ESP32-S2, ESP32-S3, Blue Pill, Pico 2, Teensy 4.1) ไม่มีข้อใดอ้างว่า Supported/Partial', () => {
    for (const k of ['esp32s2', 'esp32s3lcd', 'bluepill', 'pico2', 'teensy41']) {
      const b = BOARD_PROFILES.find((x) => x.kind === k)!;
      expect(b.features.every((f) => f.level === 'unsupported')).toBe(true);
      expect(b.languages.every((l) => l.level === 'unsupported')).toBe(true);
    }
  });
  it('Raspberry Pi 5 ระบุว่าเป็นการจำลองระดับไลบรารี ไม่ใช่ Linux', () => {
    const b = BOARD_PROFILES.find((x) => x.kind === 'rpi5')!;
    expect(b.engine).toContain('ไม่จำลอง');
    expect(b.engine).toContain('Linux');
  });
  it('สถานะ 4 ด้านของบอร์ดที่รันโค้ดได้: ครบทุกด้าน · UNO Q ยังเป็น "บางส่วน" ในด้านเฟิร์มแวร์/ไฟฟ้า และแสดงสิ่งที่ยังจำลองไม่ได้ (ห้ามเปลี่ยนเป็น "ครบ" จนกว่าจะมีตัวจำลอง STM32U585/Linux)', () => {
    for (const k of ['uno', 'nano', 'promini', 'attiny85', 'mega', 'unoq', 'pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5']) {
      const s4 = STATUS4[k];
      expect(s4, k).toBeDefined();
      for (const a of ['fidelity', 'electrical', 'firmware'] as const) expect(s4[a][1].length, `${k}.${a}`).toBeGreaterThan(20);
      expect(s4.unsupported.length, k).toBeGreaterThan(0);
    }
    expect(STATUS4.unoq.firmware[0]).toBe('partial');
    expect(STATUS4.unoq.electrical[0]).toBe('partial');
    expect(STATUS4.unoq.unsupported.join(' ')).toContain('Linux');
    expect(STATUS4.unoq.unsupported.join(' ')).toContain('Bridge');
    expect(STATUS4.unoq.fidelity[1]).toContain('CAD');
    // Pro Mini: ถือว่าต่อตัวแปลง USB-serial — ยังไม่จำลองไฟจาก RAW จึงห้ามเป็น "ครบ" ด้านไฟฟ้า
    expect(STATUS4.promini.electrical[0]).toBe('partial');
    expect(STATUS4.promini.unsupported.join(' ')).toContain('RAW');
  });
});
