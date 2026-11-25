import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine';
import { buildNetlist } from '../src/sim/netlist';
import { analyze } from '../src/instruments/measure';
import { pumpFlow, pumpOmega, PUMP_DEFAULTS, soilVout, SOIL_DEFAULTS } from '../src/model/catalog';
import { Builder, P, onTable } from './helpers';
import { farmRig, runFarm } from './farm-rig';
import { checkLesson } from '../src/lessons/checks';
import { emptyWork } from '../src/model/types';
import { LESSONS } from '../src/lessons/lessons';

describe('ปั๊มน้ำจุ่มและเซนเซอร์ความชื้นในดิน (ค่าจำลองเทียบข้อมูลผู้ขาย/เอกสาร)', () => {
  it('ปั๊ม: กระแส 130–220 mA ช่วง 3–6 V, อัตราไหล 5 V ≈ 90 L/h (80–120 L/h ในข้อมูล), 2 V ดันน้ำขึ้น 10 cm ไม่ได้', () => {
    const pr = PUMP_DEFAULTS;
    const I = (V: number) => (V - pr.ke * pumpOmega(V, pr)) / pr.resistance;
    expect(I(3)).toBeGreaterThan(0.12); expect(I(3)).toBeLessThan(0.14);
    expect(I(6)).toBeGreaterThan(0.19); expect(I(6)).toBeLessThan(0.22);
    expect(pumpFlow(pumpOmega(5, pr), pr)).toBeGreaterThan(80); expect(pumpFlow(pumpOmega(5, pr), pr)).toBeLessThan(105);
    expect(pumpFlow(pumpOmega(6, pr), pr)).toBeGreaterThan(100); expect(pumpFlow(pumpOmega(6, pr), pr)).toBeLessThanOrEqual(120);
    expect(pumpFlow(pumpOmega(2, pr), pr)).toBe(0);
    expect(soilVout(0, SOIL_DEFAULTS)).toBeCloseTo(2.5); expect(soilVout(100, SOIL_DEFAULTS)).toBeCloseTo(1.25);
  });

  it('Pico + รีเลย์: ดินแห้ง 25% → ปั๊มทำงาน (≈ 0.18 A, ≈ 90 L/h) ความชื้นเพิ่มจนเกิน 60% → หยุด แล้วดินแห้งลงช้า ๆ · AOUT ตรงกับความชื้น', () => {
    const { tr, an } = runFarm(farmRig({ dryRate: 2 }), 12);
    const on = tr.filter((x) => x.on && x.flow > 1);
    expect(on.length).toBeGreaterThan(5);
    const mid = on[Math.floor(on.length / 2)];
    expect(mid.ip).toBeGreaterThan(0.15); expect(mid.ip).toBeLessThan(0.21);
    expect(mid.flow).toBeGreaterThan(75); expect(mid.flow).toBeLessThan(100);
    expect(Math.max(...tr.map((x) => x.m))).toBeGreaterThan(60);
    expect(Math.max(...tr.map((x) => x.m))).toBeLessThan(70);
    const stop = tr.findIndex((x) => x.m > 60);
    expect(tr.slice(stop + 5).every((x) => !x.on)).toBe(true);
    expect(tr[tr.length - 1].m).toBeLessThan(Math.max(...tr.map((x) => x.m)) - 5); // แห้งลง
    for (const x of tr.filter((q) => q.t > 0.5)) expect(x.vout).toBeCloseTo(soilVout(x.m, SOIL_DEFAULTS), 1);
    expect(an.diagnostics.filter((d) => ['MS1', 'P1'].includes(d.partId ?? ''))).toEqual([]);
  }, 120000);

  it('วงปิด: dryRate สูง → ปั๊มเปิด–ปิดซ้ำหลายรอบ ความชื้นแกว่งอยู่ในช่วง ≈ 30–60%', () => {
    const { tr } = runFarm(farmRig({ dryRate: 4, moisture: 50 }), 24, 0.2);
    let cycles = 0;
    for (let k = 1; k < tr.length; k++) if (tr[k].on && !tr[k - 1].on) cycles++;
    expect(cycles).toBeGreaterThanOrEqual(2);
    const late = tr.slice(Math.floor(tr.length / 3));
    expect(Math.min(...late.map((x) => x.m))).toBeGreaterThan(20);
    expect(Math.max(...late.map((x) => x.m))).toBeLessThan(72);
  }, 120000);

  it('ปั๊มต่อขา GPIO ตรง → อันตราย · ไม่มีกระถางปลายสายยาง → แจ้ง · เซนเซอร์ใช้ไฟต่ำ/สูงเกิน → เตือน', () => {
    const d1 = runFarm(farmRig({ direct: true }), 0.6).an.diagnostics.filter((d) => d.partId === 'P1');
    expect(d1.some((d) => d.severity === 'danger' && d.message.includes('GP15'))).toBe(true);
    const d2 = runFarm(farmRig({ target: '' }), 1.5).an.diagnostics.filter((d) => d.partId === 'P1');
    expect(d2.some((d) => d.message.includes('สายยาง'))).toBe(true);
    const b3 = farmRig(); b3.doc.parts.find((p) => p.id === 'MS1')!.params = { ...b3.doc.parts.find((p) => p.id === 'MS1')!.params, vMin: 3.3 };
    const b4 = new Builder().part('dcsupply', onTable(0, -40), 'PS1', { voltage: 9 }).part('soilsensor', onTable(-50, 30), 'MS1', {})
      .wire(P('PS1', 'pos'), P('MS1', 'VCC')).wire(P('PS1', 'neg'), P('MS1', 'GND'));
    const e = new SimEngine(); const built = buildNetlist(b4.doc);
    const r = e.handle({ seq: 1, netlist: built.netlist, advance: 0, restart: true, watch: [], budgetMs: 1e9 });
    expect(analyze(b4.doc, built, r.result).diagnostics.some((d) => d.partId === 'MS1' && d.severity === 'danger')).toBe(true);
  }, 120000);

  it('แลป 40: ลำดับเป้าหมาย — ต่อครบ + วัด AOUT → รดน้ำเอง → หยุดเอง → รอบที่สอง · ปั๊มต่อ GPIO ตรง/ไม่เลือกกระถาง → เป้าหมายปั๊มไม่ผ่าน', () => {
    expect(LESSONS.find((l) => l.id === 'smartfarm')?.number).toBe(40);
    const run = (b: ReturnType<typeof farmRig>, sec: number) => {
      const work = emptyWork(); work.achieved.smartfarm = {};
      let st: Record<string, { pass: boolean; detail?: string }> = {};
      runFarm(b, sec, 0.2, (_t, an, result, built) => {
        st = checkLesson('smartfarm', { doc: b.doc, built, result, analysis: an, work });
        for (const [g, v] of Object.entries(st)) if (v.pass) work.achieved.smartfarm[g] = true;
      });
      return { st, ach: work.achieved.smartfarm };
    };
    const b = farmRig({ dryRate: 4, moisture: 25 }).probe(P('MS1', 'AOUT'), P('MS1', 'GND'));
    const { ach } = run(b, 28);
    for (const g of ['sensor', 'signal', 'measure', 'relay', 'pump', 'water', 'stop', 'cycle']) expect(ach[g], g).toBe(true);
    const r2 = run(farmRig({ target: '' }), 1);
    expect(r2.st.pump.pass).toBe(false); expect(r2.st.pump.detail).toContain('สายยาง');
    const r3 = run(farmRig({ direct: true }), 1);
    expect(r3.st.pump.pass).toBe(false);
  }, 180000);
});
