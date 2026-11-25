import { describe, expect, it } from 'vitest';
import roadmap from '../docs/MCU-ROADMAP.md?raw';
import { CATALOG } from '../src/model/catalog';
import { SUPPORT, supportSummary } from '../src/model/support';
import { supportTableMarkdown } from '../src/model/support-table';

describe('ระดับการรองรับของอุปกรณ์', () => {
  it('ทุกชนิดในคลังมีข้อมูล 6 ด้าน + ข้อจำกัด · อุปกรณ์ที่วางได้ต้องไม่ใช่ "ยังไม่รองรับ" · อุปกรณ์ที่ปิดไว้ต้องเป็น "ยังไม่รองรับ"', () => {
    for (const c of CATALOG) {
      const s = SUPPORT[c.kind];
      expect(s, c.kind).toBeDefined();
      expect(s.limits.length, c.kind).toBeGreaterThan(10);
      if (c.supported) expect(supportSummary(s).tone, c.kind).not.toBe('none');
      else expect(supportSummary(s).text, c.kind).toBe('ยังไม่รองรับ');
    }
  });
  it('ตารางใน docs/MCU-ROADMAP.md ตรงกับข้อมูลในแอป', () => {
    const m = roadmap.match(/<!-- SUPPORT-TABLE:START -->\n([\s\S]*?)\n<!-- SUPPORT-TABLE:END -->/);
    expect(m?.[1].trim()).toBe(supportTableMarkdown());
  });
});
