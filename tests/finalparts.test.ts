import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { solveDC } from '../src/sim/solver';
import { validateCircuit } from '../src/model/schema';
import { Builder, H, P, onTable } from './helpers';

const dc = (b: Builder) => { const built = buildNetlist(b.doc); const r = solveDC(built.netlist); return { r, an: analyze(b.doc, built, r) }; };

describe('อุปกรณ์โครงงาน: ปุ่มอาร์เคด, ปุ่ม 16 mm, อะแดปเตอร์ 5 V 3 A, บอร์ดกระจายไฟเซอร์โว', () => {
  it('ปุ่มอาร์เคด: ปล่อย = COM–NC ต่อ, กด = COM–NO ต่อ · ปุ่ม 16 mm: กด = ขา 1–2 ต่อ', () => {
    // อะแดปเตอร์ 5 V → ตัวต้านทาน 1 kΩ ผ่านหน้าสัมผัส
    const rig = (kind: 'arcadebtn' | 'pushbtn16', pressed: boolean, out: string) => {
      const b = new Builder().part('dcadapter', onTable(60, 40), 'ADP1').part(kind, onTable(-40, 40), 'B1', { pressed })
        .part('resistor', { kind: 'board', boardId: 'bb1', anchor: 'a5', rotation: 0 }, 'R1', { resistance: 1000, span: 3 })
        .wire(P('ADP1', '+'), P('B1', kind === 'arcadebtn' ? 'COM' : '1'), 'w1').wire(P('B1', out), H('b5'), 'w2').wire(H('b8'), P('ADP1', '-'), 'w3', '#212121');
      return dc(b).an.parts.R1.current;
    };
    expect(rig('arcadebtn', false, 'NC')).toBeCloseTo(0.005, 4);
    expect(rig('arcadebtn', false, 'NO')).toBeLessThan(1e-9);
    expect(rig('arcadebtn', true, 'NO')).toBeCloseTo(0.005, 4);
    expect(rig('arcadebtn', true, 'NC')).toBeLessThan(1e-9);
    expect(rig('pushbtn16', false, '2')).toBeLessThan(1e-9);
    expect(rig('pushbtn16', true, '2')).toBeCloseTo(0.005, 4);
  });

  it('อะแดปเตอร์: ถอดปลั๊ก = ไม่มีไฟ · โหลดเกิน 3 A → จำกัดกระแส + คำเตือนอันตราย · ขั้วลบชนขา 5V ของบอร์ด = กลับขั้ว', () => {
    const load = (R: number, plugged = true) => {
      const b = new Builder().part('dcadapter', onTable(60, 40), 'ADP1', { plugged })
        .part('resistor', { kind: 'board', boardId: 'bb1', anchor: 'a5', rotation: 0 }, 'R1', { resistance: R, span: 3, powerRating: 10 })
        .wire(P('ADP1', '+'), H('b5'), 'w1').wire(H('b8'), P('ADP1', '-'), 'w2', '#212121');
      return dc(b);
    };
    const ok = load(10);
    expect(ok.an.parts.R1.current).toBeCloseTo(5 / 10.08, 2);
    expect(ok.an.diagnostics.filter((d) => d.severity === 'danger' && d.partId === 'ADP1')).toEqual([]);
    expect(load(10, false).an.parts.R1.current).toBeLessThan(1e-9);
    const over = load(1);
    expect(over.an.parts.R1.current).toBeLessThan(3.01);
    expect(over.an.parts.R1.current).toBeGreaterThan(2.9);
    expect(over.an.diagnostics.some((d) => d.severity === 'danger' && d.partId === 'ADP1' && d.message.includes('3 A'))).toBe(true);
    const rev = new Builder().part('unoq', onTable(-50, -2), 'Q1').part('dcadapter', onTable(60, 40), 'ADP1').wire(P('ADP1', '-'), P('Q1', '5V'), 'w1');
    expect(dc(rev).an.diagnostics.some((d) => d.severity === 'danger' && d.message.includes('กลับขั้ว'))).toBe(true);
  });

  it('บอร์ดกระจายไฟ: ช่อง CH1–CH4 ต่อ V+/GND/สัญญาณภายใน · LED ไฟเข้าติด · เซอร์โวได้ไฟเลี้ยงผ่านช่อง (กระแสมอเตอร์ตรวจใน finalproj.test.ts)', { timeout: 60000 }, () => {
    const b = new Builder().part('dcadapter', onTable(60, 40), 'ADP1').part('servohub', onTable(45, -2), 'HUB1').part('servo', onTable(82, -30), 'SV1')
      .part('fgen', onTable(-60, 0), 'FG1', { wave: 'square', frequency: 50, vpp: 5, offset: 2.5, outputOn: true })
      .wire(P('ADP1', '+'), P('HUB1', 'V+'), 'wv').wire(P('ADP1', '-'), P('HUB1', 'GND'), 'wg', '#212121')
      .wire(P('SV1', 'SIG'), P('HUB1', 'CH1.S'), 'ws').wire(P('SV1', 'V'), P('HUB1', 'CH1.V'), 'wsv').wire(P('SV1', 'GND'), P('HUB1', 'CH1.G'), 'wsg', '#212121')
      .wire(P('FG1', 'OUT'), P('HUB1', 'S1'), 'wf').wire(P('FG1', 'COM'), P('HUB1', 'SG'), 'wfg', '#212121');
    const errs: string[] = [];
    expect(validateCircuit(b.doc, errs, [])).not.toBeNull();
    expect(errs).toEqual([]);
    const built = buildNetlist(b.doc);
    expect(built.netlist.servos?.[0].sig).toBe(built.connectivity.nets.findIndex((n) => n.partPins.some((pp) => pp.partId === 'HUB1' && pp.pin === 'S1')));
    // fgen 50 Hz สี่เหลี่ยม 50% = พัลส์ 10 ms (นอกช่วง 0.3–3 ms) → เซอร์โวไม่รับคำสั่ง แต่ไฟเลี้ยง/LED ต้องทำงาน
    const e = new SimEngine();
    const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0.2, restart: true, watch: [], budgetMs: 1e9 });
    const an = analyze(b.doc, built, r.result, r.tones);
    expect(an.parts.SV1.extra!.vcc).toBeGreaterThan(4.9);
    expect(Math.abs(r.result.elements['HUB1#led']?.current ?? 0)).toBeGreaterThan(0.002);
  });
});
