import { describe, expect, it } from 'vitest';
import { Builder, onBoard } from './helpers';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';

function console_(code: string, seconds = 2.5) {
  const b = new Builder().part('pico', onBoard('h1'), 'PICO1', { code, autorun: true });
  const built = buildNetlist(b.doc); const e = new SimEngine(); let con = '';
  for (let k = 0; k <= seconds / 0.05; k++) con += e.handle({ seq: k, netlist: built.netlist, advance: k ? 0.05 : 0, restart: k === 0, watch: [], budgetMs: 1e9 }).mcu?.[0]?.console ?? '';
  return con;
}

describe('Pico: ส่งโปรแกรมและข้อความ console', () => {
  it('โปรแกรมยาว 0.5–3 kB รันได้ (เดิม > ~500 ไบต์ ไม่ทำงานเพราะบัฟเฟอร์รับล้น)', () => {
    for (const n of [600, 1500, 3000]) {
      let c = 'print("start")\n';
      while (c.length < n) c += '# ' + 'คอมเมนต์ภาษาไทย ' + 'a'.repeat(20) + '\n';
      const con = console_(c + 'print("end")\n');
      expect(con).toContain('start'); expect(con).toContain('end');
    }
  }, 120000);
  it('print ข้อความภาษาไทย แสดงถูกต้อง (ถอดรหัส UTF-8)', () => {
    expect(console_('print("อุณหภูมิ", 25)\n', 1.5)).toContain('อุณหภูมิ 25');
  }, 60000);
});
