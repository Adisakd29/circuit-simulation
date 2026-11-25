import { netOfPin, type Connectivity } from '../connectivity/connectivity';
import { DMM_COUNTS, DMM_RANGES, vomOhmAt, vomPosition } from '../model/catalog';
import type { CircuitDoc, DmmPart, VomPart } from '../model/types';
import type { BuiltNetlist } from '../sim/netlist';
import type { SimResult } from '../sim/solver';
import type { ToneReading } from '../sim/tone';
import type { Diagnostic, PartReading } from './measure';

/**
 * มัลติมิเตอร์ดิจิทัล / แบบเข็ม: แปลงผลจำลองเป็นค่าที่เครื่องแสดง + คำเตือนการใช้งานผิดแบบที่พบบ่อยในห้องแลป
 * - ย่าน DC = ค่าเฉลี่ยตามเวลา (เหมือนเครื่องจริงที่เฉลี่ยในช่วงวัด) · ย่าน AC = ตอบสนองค่าเฉลี่ย ปรับเทียบ rms ของไซน์ ตัด DC ออก
 * - ย่าน Ω = แหล่งทดสอบภายในจ่ายกระแสผ่านวงจร แล้วคำนวณจากแรงดัน/กระแสที่ขั้ว (วงจรมีไฟอยู่ → ค่าผิด)
 * - ฟิวส์ขาดเมื่อกระแสเกิน 1.5 เท่าของพิกัด (ค้างจนเริ่มจำลองใหม่)
 */

const teach = '(แบบจำลองการสอน)';

/** มีสายเสียบขั้วนี้หรือไม่ */
export function jackUsed(doc: CircuitDoc, id: string, pin: string): boolean {
  return doc.wires.some((w) => [w.a, w.b].some((t) => t.kind === 'pin' && t.partId === id && t.pin === pin));
}

/** วงจรส่วนที่ต่อกับขั้วมิเตอร์มีแหล่งจ่ายอื่นที่ทำงานอยู่หรือไม่ (ใช้เตือนการวัด Ω ขณะมีไฟ) */
function livePowered(built: BuiltNetlist, result: SimResult, meterId: string, nets: Array<number | undefined>): boolean {
  const comps = new Set(nets.filter((n): n is number => n !== undefined && n >= 0).map((n) => result.component[n]).filter((x) => x >= 0));
  if (!comps.size) return false;
  for (const e of built.netlist.elements) {
    if (e.id.startsWith(`${meterId}#`)) continue;
    if ((e.type === 'SUPPLY' && e.V !== 0) || (e.type === 'FGEN' && (e.vpp !== 0 || e.offset !== 0))) {
      if (comps.has(result.component[e.p]) || comps.has(result.component[e.n])) return true;
    }
  }
  for (const m of built.netlist.mcus ?? []) if (comps.has(result.component[m.gnd]) || comps.has(result.component[m.v33])) return true;
  return false;
}

export interface DmmDisplay { text: string; unit: string; ann: string; ol: boolean }

/** จัดรูปแบบตัวเลขบนจอ 4000 count ตามย่าน (หน่วยฐาน V, A, Ω) */
export function dmmFormat(value: number, range: number, base: string): { text: string; unit: string } {
  const k = Math.floor(Math.log10(range) / 3 + 1e-9);
  const s = 10 ** (3 * Math.min(2, Math.max(-2, k)));
  const pre = { [-2]: 'µ', [-1]: 'm', 0: '', 1: 'k', 2: 'M' }[Math.round(Math.log10(s) / 3)] ?? '';
  const r = range / s;
  const dec = r <= 4.0001 ? 3 : r <= 40.001 ? 2 : r <= 400.01 ? 1 : 0;
  const v = value / s;
  const t = v.toFixed(dec);
  return { text: t === `-${(0).toFixed(dec)}` ? (0).toFixed(dec) : t, unit: `${pre}${base}` };
}

/** ค่าที่แสดงบนจอมัลติมิเตอร์ดิจิทัลจากผลการวัด (extra ของ PartReading) */
export function dmmDisplay(p: DmmPart, r: PartReading | undefined, running: boolean): DmmDisplay {
  const mode = p.params.mode;
  if (mode === 'off') return { text: '', unit: '', ann: '', ol: false };
  const ann = { acv: 'AC', dcv: 'DC', mv: 'DC', ohm: '', dca: 'DC', dcma: 'DC' }[mode];
  const base = mode === 'ohm' ? 'Ω' : mode === 'dca' || mode === 'dcma' ? 'A' : 'V';
  const x = r?.extra;
  if (!running || !x) return { text: mode === 'ohm' ? '0.L' : '0.000', unit: base, ann: `AUTO ${ann}`.trim(), ol: false };
  if (x.ol) {
    const rng = DMM_RANGES[mode];
    return { text: 'OL', unit: dmmFormat(1, rng[rng.length - 1], base).unit, ann: `${mode === 'mv' ? '' : 'AUTO '}${ann}`.trim(), ol: true };
  }
  const f = dmmFormat(x.value, x.range, base);
  return { text: f.text, unit: f.unit, ann: `${mode === 'mv' ? '' : 'AUTO '}${ann}`.trim(), ol: false };
}

/** อ่านค่ามัลติมิเตอร์ดิจิทัล */
export function readDmm(doc: CircuitDoc, part: DmmPart, built: BuiltNetlist, result: SimResult, tones: Record<string, ToneReading> | undefined, diags: Diagnostic[]): PartReading {
  const c: Connectivity = built.connectivity;
  const id = part.id, pr = part.params, mode = pr.mode;
  const el = (k: string) => result.elements[`${id}#${k}`];
  const tone = tones?.[id];
  const blownMa = !!result.relayStates?.[`${id}#ma#blown`], blownA = !!result.relayStates?.[`${id}#a10#blown`];
  const used = { V: jackUsed(doc, id, 'V'), mA: jackUsed(doc, id, 'mA'), A10: jackUsed(doc, id, 'A10'), COM: jackUsed(doc, id, 'COM') };
  const iMa = el('ma')?.current ?? 0, iA = el('a10')?.current ?? 0;
  let value = 0, range = 0, ol = false;
  let voltage = 0, current = 0;
  const pick = (v: number, ranges: number[]) => {
    const r = ranges.find((x) => Math.abs(v) < x * (1 - 0.5 / DMM_COUNTS));
    if (r === undefined) { ol = true; return ranges[ranges.length - 1]; }
    return r;
  };
  if (mode === 'dcv' || mode === 'mv') {
    voltage = value = tone?.mavg ?? el('m')?.voltage ?? 0;
    range = pick(value, DMM_RANGES[mode]);
  } else if (mode === 'acv') {
    voltage = value = tone?.mac ?? 0;
    range = pick(value, DMM_RANGES.acv);
  } else if (mode === 'ohm') {
    const vt = tone?.mavg ?? el('m')?.voltage ?? 0;
    voltage = vt;
    const i = (pr.ohmVoc - vt) / pr.ohmRs;
    current = i;
    if (vt >= pr.ohmVoc * (1 - 1e-7) || i <= 0) { ol = true; value = Infinity; range = DMM_RANGES.ohm[DMM_RANGES.ohm.length - 1]; }
    else { value = vt / i; range = pick(value, DMM_RANGES.ohm); }
  } else if (mode === 'dca' || mode === 'dcma') {
    current = value = tone?.mavg ?? (mode === 'dca' ? iA : iMa);
    range = pick(value, DMM_RANGES[mode]);
  }
  // คำเตือน
  if (blownMa || blownA) {
    diags.push({ severity: 'danger', partId: id, message: `${part.label}: ฟิวส์ขั้ว ${[blownMa ? 'mA µA (440 mA)' : '', blownA ? '10 A (11 A)' : ''].filter(Boolean).join(' และขั้ว ')} ขาด — กระแสผ่านขั้วนี้เกินพิกัดฟิวส์ (มักเกิดจากเสียบสายแดงที่ขั้ววัดกระแสแล้วนำไปแตะคร่อมแหล่งจ่าย) เครื่องจริงต้องเปลี่ยนฟิวส์ · ในแอป: แก้การต่อแล้วกดเริ่มจำลองใหม่ = ใส่ฟิวส์ใหม่ ${teach}` });
  }
  if ((mode === 'dcv' || mode === 'mv' || mode === 'acv' || mode === 'ohm') && (used.mA || used.A10)) {
    diags.push({ severity: 'warn', partId: id, message: `${part.label}: เลือกย่าน${mode === 'ohm' ? 'ความต้านทาน' : 'แรงดัน'} แต่มีสายเสียบขั้ว ${used.A10 ? '10 A' : 'mA'} — ขั้ววัดกระแสต่อ shunt ความต้านทานต่ำมากไว้ตลอด ถ้าแตะคร่อมแหล่งจ่าย = ลัดวงจร ฟิวส์ขาด ให้ย้ายสายแดงไปขั้ว VΩ` });
  }
  if ((mode === 'dca' || mode === 'dcma') && used.V && !used.mA && !used.A10) {
    diags.push({ severity: 'info', partId: id, message: `${part.label}: เลือกย่านกระแสแต่สายแดงเสียบขั้ว VΩ — วัดกระแสต้องย้ายสายแดงไปขั้ว ${mode === 'dca' ? '10 A' : 'mA µA'} แล้วต่ออนุกรมในเส้นทางกระแส` });
  }
  if (mode === 'dca' && used.mA && !used.A10) diags.push({ severity: 'info', partId: id, message: `${part.label}: ย่าน A⎓ อ่านจากขั้ว 10 A แต่สายแดงเสียบขั้ว mA — หมุนสวิตช์ไปที่ mA⎓ หรือย้ายสาย` });
  if (mode === 'dcma' && used.A10 && !used.mA) diags.push({ severity: 'info', partId: id, message: `${part.label}: ย่าน mA⎓ อ่านจากขั้ว mA แต่สายแดงเสียบขั้ว 10 A — หมุนสวิตช์ไปที่ A⎓ หรือย้ายสาย` });
  if (mode === 'ohm' && livePowered(built, result, id, [netOfPin(c, id, 'V'), netOfPin(c, id, 'COM')])) {
    diags.push({ severity: 'warn', partId: id, message: `${part.label}: วัดความต้านทานขณะวงจรมีไฟ — ค่าที่อ่านไม่ถูกต้องและอาจทำให้มิเตอร์เสียหาย ปิดแหล่งจ่าย (หรือถอดอุปกรณ์ออกมาวัด) ก่อนวัด Ω` });
  }
  if (ol && mode !== 'ohm' && mode !== 'off') diags.push({ severity: 'warn', partId: id, message: `${part.label}: ค่าเกินย่านสูงสุด (OL) ${teach}` });
  if (mode !== 'off' && !used.COM && (used.V || used.mA || used.A10)) diags.push({ severity: 'info', partId: id, message: `${part.label}: ยังไม่ได้เสียบสายดำที่ขั้ว COM` });
  return {
    current, voltage, power: 0, overRated: ol || blownMa || blownA,
    extra: { value: isFinite(value) ? value : 0, range, ol: ol ? 1 : 0, blownMa: blownMa ? 1 : 0, blownA: blownA ? 1 : 0, iMa, iA },
  };
}

/** อ่านค่ามัลติมิเตอร์แบบเข็ม: frac = สัดส่วนการตีเข็ม (0 = ซ้ายสุด, 1 = เต็มสเกล) ยังไม่จำกัดช่วง */
export function readVom(doc: CircuitDoc, part: VomPart, built: BuiltNetlist, result: SimResult, tones: Record<string, ToneReading> | undefined, diags: Diagnostic[]): PartReading {
  const c: Connectivity = built.connectivity;
  const id = part.id, pr = part.params, pos = vomPosition(pr.sel);
  const m = result.elements[`${id}#m`];
  const tone = tones?.[id];
  const blown = !!result.relayStates?.[`${id}#fuse#blown`];
  let frac = 0, value = 0, ohm = 0, voltage = 0, current = 0;
  if (pos.mode === 'dcv') { voltage = value = tone?.mavg ?? m?.voltage ?? 0; frac = value / pos.full; }
  else if (pos.mode === 'acv') { voltage = value = tone?.mac ?? 0; frac = value / pos.full; }
  else if (pos.mode === 'dca') { current = value = tone?.mavg ?? m?.current ?? 0; frac = value / pos.full; }
  else if (pos.mode === 'ohm') {
    current = tone?.mavg ?? m?.current ?? 0;
    const ifs = pr.battery / (pr.centerOhm * pos.full);
    frac = current / ifs;
    ohm = Math.max(0, vomOhmAt(frac, pr.centerOhm)) * pos.full; // เข็มเลย 0 Ω เล็กน้อย = 0 Ω
    value = isFinite(ohm) ? ohm : 0;
  }
  if (blown) {
    diags.push({ severity: 'danger', partId: id, message: `${part.label}: ฟิวส์ 0.5 A ในมิเตอร์ขาด — กระแสเกินพิกัด (มักเกิดจากเลือกย่าน DCA หรือ Ω แล้วนำไปแตะคร่อมแหล่งจ่าย) ในแอป: แก้การต่อแล้วกดเริ่มจำลองใหม่ = ใส่ฟิวส์ใหม่ ${teach}` });
  }
  const used = jackUsed(doc, id, 'P') && jackUsed(doc, id, 'COM');
  if (used && pos.mode !== 'off' && pos.mode !== 'ohm') {
    if (frac < -0.02) diags.push({ severity: 'warn', partId: id, message: `${part.label}: เข็มตีกลับ (ต่ำกว่า 0) — ขั้วกลับ ให้สลับสายแดง (+) กับสายดำ (COM)${pos.mode === 'acv' ? '' : ' หรือวัดจากจุดที่ศักย์สูงกว่าด้วยสายแดง'}` });
    else if (frac > 1.02) diags.push({ severity: frac > 2 ? 'danger' : 'warn', partId: id, message: `${part.label}: เข็มตีเกินสเกล (${(frac * 100).toFixed(0)}% ของย่าน ${pos.label}) — หมุนไปย่านที่สูงกว่า${frac > 2 ? ' เครื่องจริงเข็มอาจงอหรือขดลวดไหม้' : ''} ${teach}` });
    else if (Math.abs(frac) < 0.1 && Math.abs(frac) > 1e-4) diags.push({ severity: 'info', partId: id, message: `${part.label}: เข็มขยับน้อยมาก (${(frac * 100).toFixed(1)}% ของสเกล) — เลือกย่านต่ำลงเพื่ออ่านค่าได้ละเอียดขึ้น` });
  }
  if (pos.mode === 'ohm' && livePowered(built, result, id, [netOfPin(c, id, 'P'), netOfPin(c, id, 'COM')])) {
    diags.push({ severity: 'warn', partId: id, message: `${part.label}: วัดความต้านทานขณะวงจรมีไฟ — เข็มชี้ผิดและมิเตอร์อาจเสียหาย ปิดแหล่งจ่ายก่อนวัด Ω` });
  }
  return { current, voltage, power: 0, overRated: blown || frac > 1.02 || frac < -0.02, extra: { frac: blown ? 0 : frac, value, ohm: isFinite(ohm) ? ohm : -1, full: pos.full, blown: blown ? 1 : 0 } };
}

/** ข้อความอ่านค่าจากสเกลของมิเตอร์แบบเข็ม (สำหรับแผงค่าวัด) */
export function vomReadout(p: VomPart, r: PartReading | undefined): string {
  const pos = vomPosition(p.params.sel);
  if (pos.mode === 'off') return 'ปิดเครื่อง (OFF)';
  const x = r?.extra;
  if (!x) return '—';
  if (x.blown) return 'ฟิวส์ขาด — เข็มไม่ขยับ';
  const f = x.frac;
  if (f > 1.02) return 'เข็มตีเกินสเกล';
  if (f < -0.02) return 'เข็มตีกลับ (ขั้วกลับ)';
  if (pos.mode === 'ohm') {
    if (f < 0.005) return '∞ (ไม่มีกระแส)';
    const R = Math.max(0, vomOhmAt(f, p.params.centerOhm));
    return `${R < 10 ? R.toFixed(1) : R.toFixed(0)} × ${pos.dial.replace('×', '')} = ${fmtOhm(R * pos.full)}`;
  }
  const unit = pos.mode === 'dca' ? 'A' : 'V';
  return `${fmtSi(x.value, unit)} (${(Math.max(0, f) * 100).toFixed(0)}% ของย่าน ${pos.label})`;
}

export function fmtOhm(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toPrecision(3)} MΩ`;
  if (r >= 1e3) return `${+(r / 1e3).toPrecision(3)} kΩ`;
  return `${+r.toPrecision(3)} Ω`;
}

export function fmtSi(v: number, unit: string): string {
  const a = Math.abs(v);
  if (a >= 1 || a === 0) return `${+v.toPrecision(3)} ${unit}`;
  if (a >= 1e-3) return `${+(v * 1e3).toPrecision(3)} m${unit}`;
  return `${+(v * 1e6).toPrecision(3)} µ${unit}`;
}
