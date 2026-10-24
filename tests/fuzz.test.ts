import { describe, expect, it } from 'vitest';
import { addPart, addWire } from '../src/editor/ops';
import { allHoles } from '../src/model/breadboard';
import { emptyCircuit, type CircuitDoc, type PartKind, type Rotation, type TerminalRef } from '../src/model/types';
import { buildNetlist } from '../src/sim/netlist';
import { solveDC, terminalCurrents } from '../src/sim/solver';

/** ตัวสุ่มที่ทำซ้ำได้ */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function randomCircuit(seed: number): CircuitDoc {
  const r = rng(seed);
  const holes = allHoles().map((h) => h.name);
  let doc = emptyCircuit();
  const tryAdd = (kind: PartKind, placement: Parameters<typeof addPart>[2]) => {
    const res = addPart(doc, kind, placement);
    if (res.ok) doc = res.doc;
  };
  const nSup = 1 + Math.floor(r() * 2);
  for (let i = 0; i < nSup; i++) tryAdd('dcsupply', { kind: 'table', x: -25, z: -8 + i * 9, rotation: 0 });
  if (r() < 0.5) tryAdd('ammeter', { kind: 'table', x: 25, z: 0, rotation: 0 });
  const kinds: PartKind[] = ['resistor', 'resistor', 'led', 'led', 'switch', 'diode', 'bjt', 'opamp'];
  for (let i = 0; i < 3 + Math.floor(r() * 6); i++) {
    const kind = kinds[Math.floor(r() * kinds.length)];
    tryAdd(kind, { kind: 'board', boardId: 'bb1', anchor: holes[Math.floor(r() * holes.length)], rotation: ([0, 90, 180, 270] as Rotation[])[Math.floor(r() * 4)] });
  }
  const pins: TerminalRef[] = [];
  for (const p of doc.parts) if (p.placement.kind === 'table') for (const pin of p.kind === 'dcsupply' ? ['pos', 'neg'] : ['A', 'COM']) pins.push({ kind: 'pin', partId: p.id, pin });
  const pickEnd = (): TerminalRef => (r() < 0.3 && pins.length ? pins[Math.floor(r() * pins.length)] : { kind: 'hole', boardId: 'bb1', hole: holes[Math.floor(r() * holes.length)] });
  for (let i = 0; i < 4 + Math.floor(r() * 8); i++) {
    const res = addWire(doc, pickEnd(), pickEnd());
    if (res.ok) doc = res.doc;
  }
  return doc;
}

/** วงจรสุ่มแบบมีโครงสร้าง: แหล่งจ่ายต่อรางไฟเสมอ อุปกรณ์เสียบจากรางลงแถบ และสายเชื่อมแถบแบบสุ่ม */
function railCircuit(seed: number): CircuitDoc {
  const r = rng(seed * 7919);
  let doc = emptyCircuit();
  const apply = (res: ReturnType<typeof addPart> | ReturnType<typeof addWire>) => { if (res.ok) doc = res.doc; };
  apply(addPart(doc, 'dcsupply', { kind: 'table', x: -25, z: 0, rotation: 0 }, 'PS1'));
  doc = { ...doc, parts: doc.parts.map((p) => (p.kind === 'dcsupply' ? { ...p, params: { ...p.params, voltage: 1 + Math.round(r() * 120) / 10, currentLimit: 0.02 + r() * 0.5 } } : p)) };
  apply(addWire(doc, { kind: 'pin', partId: 'PS1', pin: 'pos' }, { kind: 'hole', boardId: 'bb1', hole: 'tp2' }));
  apply(addWire(doc, { kind: 'pin', partId: 'PS1', pin: 'neg' }, { kind: 'hole', boardId: 'bb1', hole: 'tn2' }));
  const cols = () => 3 + Math.floor(r() * 27);
  for (let i = 0; i < 2 + Math.floor(r() * 7); i++) {
    const c = cols();
    const roll = r();
    if (roll < 0.35) apply(addPart(doc, 'resistor', { kind: 'board', boardId: 'bb1', anchor: `${r() < 0.5 ? 'tp' : 'tn'}${c}`, rotation: 90 }));
    else if (roll < 0.7) apply(addPart(doc, 'led', { kind: 'board', boardId: 'bb1', anchor: `${'abcde'[Math.floor(r() * 5)]}${c}`, rotation: r() < 0.5 ? 0 : 180 }));
    else if (roll < 0.76) apply(addPart(doc, ['diode', 'bjt', 'opamp'][Math.floor(r() * 3)] as PartKind, { kind: 'board', boardId: 'bb1', anchor: `${'abcde'[Math.floor(r() * 5)]}${c}`, rotation: r() < 0.5 ? 0 : 180 }));
    else if (roll < 0.85) apply(addPart(doc, 'resistor', { kind: 'board', boardId: 'bb1', anchor: `${'abcde'[Math.floor(r() * 5)]}${c}`, rotation: 0 }));
    else apply(addPart(doc, 'switch', { kind: 'board', boardId: 'bb1', anchor: `${'abcde'[Math.floor(r() * 5)]}${c}`, rotation: 0 }));
  }
  // สาขา R–LED จาก T+ ลง T− (บางสาขากลับขั้ว บางสาขาไม่มีสายปิดวงจร)
  for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
    const c = [3, 4, 5, 8, 9, 10, 14, 15, 20, 21, 26, 27][Math.floor(r() * 12)];
    apply(addPart(doc, 'resistor', { kind: 'board', boardId: 'bb1', anchor: `tp${c}`, rotation: 90 }));
    apply(addPart(doc, 'led', r() < 0.75 ? { kind: 'board', boardId: 'bb1', anchor: `e${c}`, rotation: 0 } : { kind: 'board', boardId: 'bb1', anchor: `e${c + 1}`, rotation: 180 }));
    if (r() < 0.85) apply(addWire(doc, { kind: 'hole', boardId: 'bb1', hole: `c${c + 1}` }, { kind: 'hole', boardId: 'bb1', hole: `tn${[2, 3, 4, 5, 6, 8, 9, 10][Math.floor(r() * 8)]}` }));
  }
  // ให้ตัวต้านทานแนวตั้งยาวถึงแถวหลัก
  doc = { ...doc, parts: doc.parts.map((p) => (p.kind === 'resistor' && p.placement.kind === 'board' && p.placement.rotation === 90 ? { ...p, params: { ...p.params, span: p.placement.anchor.startsWith('tp') ? 3 + Math.floor(r() * 5) : 2 + Math.floor(r() * 5), resistance: [10, 47, 220, 1000, 4700, 1e5][Math.floor(r() * 6)] } } : p)) };
  for (let i = 0; i < 2 + Math.floor(r() * 6); i++) {
    const a = `${'abcde'[Math.floor(r() * 5)]}${cols()}`;
    const b = r() < 0.4 ? `${r() < 0.5 ? 'tp' : 'tn'}${[2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15][Math.floor(r() * 12)]}` : `${'abcde'[Math.floor(r() * 5)]}${cols()}`;
    apply(addWire(doc, { kind: 'hole', boardId: 'bb1', hole: a }, { kind: 'hole', boardId: 'bb1', hole: b }));
  }
  return doc;
}

describe('fuzz: วงจรสุ่ม 800 วง (สุ่มอิสระ 400 + แบบรางไฟ 400) — solver ลู่เข้าและผลเป็นไปตาม KCL', () => {
  it('ทุกวงจรคำนวณได้ และผลรวมกระแสที่ทุกเน็ต ≈ 0', () => {
    let failures = 0;
    const messages: string[] = [];
    for (let seed = 1; seed <= 800; seed++) {
      const doc = seed <= 400 ? randomCircuit(seed) : railCircuit(seed);
      const { netlist } = buildNetlist(doc);
      const res = solveDC(netlist);
      if (!res.ok) { failures++; messages.push(`seed ${seed}: ${res.error?.code}`); continue; }
      // ตรวจ KCL อิสระจากผลลัพธ์ของแต่ละอุปกรณ์
      const sum = new Float64Array(netlist.nodeCount);
      const scale = new Float64Array(netlist.nodeCount);
      for (const e of netlist.elements) {
        for (const [node, I] of terminalCurrents(e, res.elements[e.id])) { sum[node] -= I; scale[node] = Math.max(scale[node], Math.abs(I)); }
      }
      for (let n = 0; n < netlist.nodeCount; n++) {
        if (Math.abs(sum[n]) > 1e-9 + 1e-6 * scale[n]) { failures++; messages.push(`seed ${seed}: KCL net ${n} = ${sum[n]}`); break; }
      }
      for (const v of Object.values(res.elements)) if (!isFinite(v.current) || !isFinite(v.voltage)) { failures++; messages.push(`seed ${seed}: non-finite`); break; }
    }
    expect(messages).toEqual([]);
    expect(failures).toBe(0);
  });
});

describe('fuzz ตามเวลา: วงจรสุ่มที่มีตัวเก็บประจุ/ตัวเหนี่ยวนำ/เครื่องกำเนิดสัญญาณ 200 วง', () => {
  it('เดินเวลาได้ทุกวง และ KCL ทุกเน็ตสมดุล ณ เวลาสุดท้าย', async () => {
    const { advance, newTranState } = await import('../src/sim/transient');
    const messages: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 31337);
      let doc = railCircuit(seed);
      const holes = allHoles().map((h) => h.name);
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        const kind: PartKind = r() < 0.65 ? 'capacitor' : 'inductor';
        const res = addPart(doc, kind, { kind: 'board', boardId: 'bb1', anchor: holes[Math.floor(r() * holes.length)], rotation: ([0, 90, 180, 270] as Rotation[])[Math.floor(r() * 4)] });
        if (res.ok) doc = res.doc;
      }
      if (r() < 0.4) {
        // เครื่องกำเนิดสัญญาณสุ่มรูปคลื่น/ความถี่ ต่อเข้าวงจร
        const wave = (['sine', 'square', 'triangle', 'dc'] as const)[Math.floor(r() * 4)];
        const fgp = addPart(doc, 'fgen', { kind: 'table', x: 25, z: -8, rotation: 0 }, 'FGZ');
        if (fgp.ok) {
          doc = { ...fgp.doc, parts: fgp.doc.parts.map((p) => (p.kind === 'fgen' ? { ...p, params: { ...p.params, wave, frequency: [10, 100, 1000, 5000][Math.floor(r() * 4)], vpp: 1 + r() * 8 } } : p)) };
          const w1 = addWire(doc, { kind: 'pin', partId: 'FGZ', pin: 'OUT' }, { kind: 'hole', boardId: 'bb1', hole: holes[Math.floor(r() * holes.length)] });
          if (w1.ok) doc = w1.doc;
          const w2 = addWire(doc, { kind: 'pin', partId: 'FGZ', pin: 'COM' }, { kind: 'hole', boardId: 'bb1', hole: `tn${[2, 3, 4, 5, 6][Math.floor(r() * 5)]}` });
          if (w2.ok) doc = w2.doc;
        }
      }
      const { netlist } = buildNetlist(doc);
      const st = newTranState();
      // จำกัดเวลาไม่เกิน 30 คาบของเครื่องกำเนิดสัญญาณ (64 ก้าวต่อคาบ)
      const fgf = netlist.elements.find((e) => e.type === 'FGEN' && e.wave !== 'dc');
      const tEnd = Math.min(0.05 + r() * 0.5, fgf && fgf.type === 'FGEN' ? 30 / fgf.freq : Infinity);
      const out = advance(netlist, st, tEnd, { maxSteps: 50000 });
      if (!out.ok) { messages.push(`seed ${seed}: ${out.result.error?.code}`); continue; }
      if (!out.reached) { messages.push(`seed ${seed}: not reached`); continue; }
      const res = out.result;
      const sum = new Float64Array(netlist.nodeCount);
      const scale = new Float64Array(netlist.nodeCount);
      for (const e of netlist.elements) {
        for (const [node, I] of terminalCurrents(e, res.elements[e.id])) { sum[node] -= I; scale[node] = Math.max(scale[node], Math.abs(I)); }
      }
      for (let n = 0; n < netlist.nodeCount; n++) {
        if (Math.abs(sum[n]) > 1e-9 + 1e-6 * scale[n]) { messages.push(`seed ${seed}: KCL net ${n} = ${sum[n]}`); break; }
      }
    }
    expect(messages).toEqual([]);
  }, 60000);
});
