import { isPico, isMicroPy, type PicoPart } from '../model/types';
import { RMS_WINDOW, stepperLimit, type ToneReading } from '../sim/tone';
import { netLinked, netOfPin, netOfTerminal, terminalLabel, type Connectivity } from '../connectivity/connectivity';
import { ATTINY85_DIGITAL, pirInView, PIR_CONE, PIR_WARMUP, pinDefs, STEPPER_INPUTS, HC595_OUTS, HC595_PINOUT, PICO_GPIO, rp2Pins, UNO_DIGITAL, NANO_DIGITAL, MEGA_DIGITAL, SEG_NAMES, RGB_CH, astable555, decodeSegments, ldrResistance, ntcResistance, motorRpm, transformerModel, vregThermalResistance, tip120ThermalResistance, logicGates, LOGIC_PINOUT, LM393_CHANNELS, CD4017_OUTS, CD4017_PINOUT, lm35Vout, soilVout, pumpFlow, dht22Bytes, dht11Bytes, irRange, irDetected, L293D_CHANNELS, soundSpeed, sonarEchoWidth, SONAR_MAX_CM } from '../model/catalog';
import type { BuiltNetlist } from '../sim/netlist';
import { readDmm, readVom } from './meters';
import { voltageBetween, type SimResult } from '../sim/solver';
import type { CapacitorPart, CircuitDoc, Part, ResistorPart } from '../model/types';
import { terminalKey } from '../model/types';
import { charLcdContrast, charLcdGhost } from '../mcu/i2c-sensors';
import { isSensor, mcu3v3Pins, measureSensor } from '../model/sensors';

/**
 * เครื่องมือวัดและการตีความผลจำลอง
 * - โพรบวัดแรงดันสองจุด: V(แดง) − V(ดำ), ความต้านทานเข้าเป็นอนันต์ (ไม่โหลดวงจร)
 * - แอมมิเตอร์: กระแสผ่าน shunt (อุปกรณ์จริงในวงจร มีผลต่อวงจรตามค่า shunt)
 * - ความสว่าง LED: คำนวณจากกระแสที่ได้ (เชิงประมาณ ไม่ใช่ค่าความเข้มแสงจริง)
 * - การแจ้งเตือนพิกัด: เป็นแบบจำลองการสอน ไม่ใช่การรับรองความปลอดภัยของวงจรจริง
 */

export const MEASUREMENT_TOLERANCE = {
  /** ความคลาดเคลื่อนของ solver เทียบคำตอบเชิงวิเคราะห์ (วงจรเชิงเส้น) */
  solverRelative: 1e-6,
  /** ค่าที่ใช้ตรวจผลแลป (สัมพัทธ์) */
  lessonRelative: 0.02,
  /** ความละเอียดการแสดงผลมิเตอร์ (เลขนัยสำคัญ) */
  displayDigits: 4,
};

export type Severity = 'info' | 'warn' | 'danger';

export interface Diagnostic {
  severity: Severity;
  partId?: string;
  message: string;
}

export interface PartReading {
  current: number;
  voltage: number;
  power: number;
  mode?: 'CV' | 'CC';
  /** 0..1 (ความสว่างเชิงประมาณ) สำหรับ LED */
  brightness?: number;
  overRated?: boolean;
  /** ค่าเพิ่มเติมของอุปกรณ์หลายขา (เช่น BJT: ib, vbe, region) */
  extra?: Record<string, number>;
}

export interface Analysis {
  ok: boolean;
  errorTitle?: string;
  errorDetail?: string;
  parts: Record<string, PartReading>;
  probe: { value: number | null; reason?: string; redLabel?: string; blackLabel?: string };
  diagnostics: Diagnostic[];
  /** อุปกรณ์บนบัส I²C (สถานะจากการจำลอง: หน่วยความจำจอ, เวลา RTC, MPU) */
  i2c?: SimResult['i2c'];
  lcd?: SimResult['lcd'];
  seg?: SimResult['seg'];
  plcd?: SimResult['plcd'];
  enc?: SimResult['enc'];
}

export function ledBrightness(current: number, rated: number): number {
  if (!(current > 0)) return 0;
  // ความสว่างรับรู้โดยประมาณ ∝ (I/Irated)^0.5 (ปรับให้ตาเห็นความต่างที่กระแสต่ำ) จำกัดที่ 1.25
  return Math.min(1.25, Math.sqrt(current / rated));
}

/**
 * หาค่า RA (VCC → DIS), RB (DIS → THR) และ C (THR → GND) ของวงจร astable มาตรฐานรอบไอซี 555 จากการต่อจริง
 * (ตัวต้านทาน/ตัวเก็บประจุตัวเดียวต่อช่วง — ถ้าขา 7 ต่อตรงกับขา 6 ถือว่า RB = 0) คืน null ถ้าไม่ใช่รูปแบบนี้
 */
export function detectAstable(doc: CircuitDoc, c: Connectivity, id: string): { ra: number; rb: number; c: number } | null {
  const net = (pid: string, pin: string) => netOfPin(c, pid, pin);
  const vcc = net(id, 'VCC'), dis = net(id, 'DIS'), thr = net(id, 'THR'), trig = net(id, 'TRIG'), gnd = net(id, 'GND');
  if (vcc === undefined || dis === undefined || thr === undefined || gnd === undefined || thr !== trig) return null;
  const between = (kind: 'resistor' | 'capacitor', a: number, b: number) => doc.parts.find((p) => {
    if (p.kind !== kind) return false;
    const [x, y] = kind === 'resistor' ? [net(p.id, '1'), net(p.id, '2')] : [net(p.id, 'P'), net(p.id, 'N')];
    return (x === a && y === b) || (x === b && y === a);
  });
  const ra = between('resistor', vcc, dis), rb = dis === thr ? null : between('resistor', dis, thr), cap = between('capacitor', thr, gnd);
  if (!ra || (!rb && dis !== thr) || !cap) return null;
  return { ra: (ra as ResistorPart).params.resistance, rb: rb ? (rb as ResistorPart).params.resistance : 0, c: (cap as CapacitorPart).params.capacitance };
}

export function analyze(doc: CircuitDoc, built: BuiltNetlist, result: SimResult, tones?: Record<string, ToneReading>): Analysis {
  const diags: Diagnostic[] = [];
  const parts: Record<string, PartReading> = {};
  const c = built.connectivity;
  const label = (id: string) => doc.parts.find((p) => p.id === id)?.label ?? id;

  const probe: Analysis['probe'] = { value: null };
  if (doc.probes.red) probe.redLabel = terminalLabel(doc, doc.probes.red);
  if (doc.probes.black) probe.blackLabel = terminalLabel(doc, doc.probes.black);

  if (!result.ok) {
    probe.reason = 'ไม่แสดงค่า เพราะการจำลองล้มเหลว';
    return {
      ok: false, errorTitle: result.error?.message ?? 'การจำลองล้มเหลว', errorDetail: result.error?.detail,
      parts, probe, diagnostics: [{ severity: 'danger', message: `${result.error?.message}${result.error?.detail ? ' — ' + result.error.detail : ''}` }],
    };
  }

  for (const inactive of built.inactive) diags.push({ severity: 'info', partId: inactive.id, message: `${label(inactive.id)}: ${inactive.reason}` });

  for (const part of doc.parts) {
    if (part.kind === 'dmm') { parts[part.id] = readDmm(doc, part, built, result, tones, diags); continue; }
    if (part.kind === 'vom') { parts[part.id] = readVom(doc, part, built, result, tones, diags); continue; }
    if (part.kind === 'logic') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const conn = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins.length ?? 0) > 1;
      // ขับจริง = มีขาอุปกรณ์อื่นที่ทำงานอยู่ในเน็ต (สวิตช์ที่เปิดอยู่ไม่นับ — ขาเข้าที่ต่อแค่สวิตช์เปิดก็ยังลอย)
      const off = new Set(built.inactive.map((i) => i.id));
      const driven = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins ?? []).some((pp) => !(pp.partId === part.id && pp.pin === pin) && !off.has(pp.partId));
      const extra: Record<string, number> = { vcc };
      let imax = 0;
      for (const gt of logicGates(pr.model)) {
        const q = !!result.relayStates?.[`${part.id}#${gt.n}`];
        const io = result.elements[`${part.id}#${gt.n}#${q ? 'h' : 'l'}`]?.current ?? 0;
        extra[`q${gt.n}`] = q ? 1 : 0; extra[`vo${gt.n}`] = nv(gt.out) - g; extra[`io${gt.n}`] = q ? io : -io;
        gt.inputs.forEach((p) => { const vi = nv(p) - g; extra[`v${p}`] = vi; extra[`b${p}`] = vi > vcc / 2 ? 1 : 0; });
        imax = Math.max(imax, Math.abs(io));
        const used = [...gt.inputs, gt.out].some((p) => conn(p));
        if (!used || vcc < pr.vMin) continue;
        for (const p of gt.inputs) {
          const vi = nv(p) - g;
          if (!driven(p)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${p} ลอย — ขาเข้า CMOS ที่ไม่ได้ต่ออ่านค่าไม่แน่นอน (ของจริงอาจกระพริบ/กินกระแส) ต่อเข้า VCC หรือ GND หรือใช้ตัวต้านทาน pull-up/pull-down (แบบจำลองอ่านเป็น 0)` });
          else if (vi > 0.3 * vcc && vi < 0.7 * vcc) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${p} = ${vi.toFixed(2)} V อยู่ในช่วงไม่แน่นอน (0.3–0.7 VCC) — ของจริงอ่านค่าไม่แน่นอนและกินกระแสสูง` });
        }
        if (Math.abs(io) > pr.maxOutputCurrent) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขาออก ${gt.out} จ่าย/รับกระแส ${fmtA(Math.abs(io))} เกิน ${fmtA(pr.maxOutputCurrent)} — ตรวจการลัดวงจร (ขาออกชนกัน/ต่อตรงไฟเลี้ยง) หรือใส่ตัวต้านทานจำกัดกระแส` });
        else if (Math.abs(io) > 0.0065) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขาออก ${gt.out} กระแส ${fmtA(Math.abs(io))} เกินพิกัดใช้งาน ≈ 4–6 mA — แรงดันขาออกจะเบี่ยงจาก 0 V/VCC (ใช้ตัวต้านทาน LED ≥ 470 Ω)` });
      }
      const reading: PartReading = { current: imax, voltage: vcc, power: 0, extra };
      if (vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 14 VCC ต่อไฟบวก ขา 7 GND ต่อลบ (ของจริงเสียหาย)` });
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน ${pr.vMax} V ของตระกูล 74HC` }); }
      else if (vcc < pr.vMin && [...Array(14)].some((_, k) => conn(LOGIC_PINOUT[pr.model][k]) && !['VCC', 'GND'].includes(LOGIC_PINOUT[pr.model][k]))) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V — ต่อขา 14 (VCC) เข้า 5 V และขา 7 (GND) ลงกราวด์ ไอซีจึงจะทำงาน` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'lm386') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vs = nv('VS') - g, vout = nv('OUT') - g, vin = nv('IN+') - nv('IN-');
      const a1 = result.elements[`${part.id}#a1`];
      const nG1 = netOfPin(c, part.id, 'G1'), nG8 = netOfPin(c, part.id, 'G8'), nO = netOfPin(c, part.id, 'OUT');
      // อุปกรณ์ระหว่างขา 1–8: ตัวเก็บประจุ (อาจอนุกรมตัวต้านทาน) → อัตราขยายสูงขึ้น
      const capG = doc.parts.some((q) => q.kind === 'capacitor' && [netOfPin(c, q.id, 'P'), netOfPin(c, q.id, 'N')].sort().join() === [nG1, nG8].sort().join());
      const gainTh = capG ? 1 + pr.rf / pr.ra : 1 + pr.rf / (pr.ra + pr.rb);
      const iout = Math.abs(a1?.current ?? 0);
      const iq = Math.abs(result.elements[`${part.id}#iq`]?.current ?? 0);
      const pd = Math.max(0, vs * iq + Math.abs((vs - vout) * (a1?.current ?? 0)));
      const reading: PartReading = { current: a1?.current ?? 0, voltage: vout, power: pd, extra: { vs, vout, vin, gainTh, gain200: capG ? 1 : 0, sat: a1?.extra?.saturated ?? 0, iout } };
      // ลำโพงต่อตรงขาออก (ไม่มีตัวเก็บประจุคัปปลิ้ง) → กระแสตรง VS/2 ไหลผ่านลำโพง
      const directSpk = doc.parts.some((q) => q.kind === 'speaker' && [netOfPin(c, q.id, 'P'), netOfPin(c, q.id, 'N')].includes(nO));
      if (vs < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 6 VS ต่อไฟบวก ขา 4 GND ต่อลบ` });
      else if (vs > pr.vMax) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vs.toFixed(1)} V เกิน ${pr.vMax} V ของ LM386N-1 (รุ่น -4 ใช้ได้ถึง 18 V)` }); }
      else if (vs > 1 && vs < pr.vMin) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vs.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — ขาออกแกว่งได้น้อยมาก เสียงแตก` });
      if (directSpk && vs > 1) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ลำโพงต่อตรงขาออก — ขาออกมีไฟตรง ≈ VS/2 (${(vs / 2).toFixed(1)} V) ไหลผ่านลำโพงตลอด ต้องต่อตัวเก็บประจุคัปปลิ้ง (เช่น 250 µF ขา + ทางขา 5) คั่น` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'speaker') {
      const er = result.elements[part.id];
      const tn = tones?.[part.id];
      const pr = part.params;
      const reading: PartReading = er ? { current: er.current, voltage: er.voltage, power: er.power } : { current: 0, voltage: 0, power: 0 };
      const iac = tn?.iac ?? 0, idc = tn ? tn.idc : reading.current;
      const pac = (iac * iac * pr.impedance) / 2; // กำลังของส่วนสลับ (ไซน์: ค่ายอด²·R/2)
      const sounding = !!tn && tn.freq !== null && tn.freq >= 20 && tn.freq <= 20000 && iac > 2e-4;
      reading.extra = { sounding: sounding ? 1 : 0, freq: sounding ? tn!.freq! : 0, level: sounding ? Math.min(1, Math.sqrt(pac / pr.maxPower)) : 0, pac, iac, idc };
      if (Math.abs(idc) > 0.02) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสตรง ${fmtA(Math.abs(idc))} ไหลผ่านลำโพง — กรวยถูกดันค้างข้างเดียว เสียงเพี้ยนและขดลวดร้อน ต้องมีตัวเก็บประจุคัปปลิ้งคั่น` });
      if (pac > pr.maxPower) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลัง ${(pac * 1000).toFixed(0)} mW เกินพิกัด ${(pr.maxPower * 1000).toFixed(0)} mW — ลดความดัง` }); }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'darlington') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const vb = nv('B'), vc = nv('C'), ve = nv('E');
      const el = (s: string) => result.elements[`${part.id}#${s}`];
      const ic = el('rc')?.current ?? 0;
      const ib = (el('q1')?.extra?.ib ?? 0) + (el('r1')?.current ?? 0);
      const vce = vc - ve, vbe = vb - ve;
      const pd = Math.max(0, vce * ic + vbe * ib);
      const rth = tip120ThermalResistance(pr.heatsink), tj = 25 + pd * rth;
      const hfe = ib > 1e-9 ? ic / ib : 0;
      // ย่านทำงาน: ดับ (IC เล็ก), อิ่มตัว (VCE ต่ำกว่า VBE — Q1 อิ่มตัว), ขยาย
      const region = ic < 1e-4 ? 0 : vce < vbe ? 2 : 1;
      const reading: PartReading = { current: ic, voltage: vce, power: pd, extra: { ic, ib, vce, vbe, hfe, pd, tj, rth, region } };
      if (ic > pr.maxIc) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: IC ${fmtA(ic)} เกินพิกัด ${fmtA(pr.maxIc)} — ตรวจโหลดลัดวงจร` }); }
      if (vce > pr.maxVce) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VCE ${vce.toFixed(1)} V เกินพิกัด ${pr.maxVce} V — ถ้าเป็นโหลดขดลวด (มอเตอร์/รีเลย์) ต้องมีไดโอดกันย้อนคร่อมโหลด` }); }
      if (ib > 0.12) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสเบส ${fmtA(ib)} เกินพิกัด 120 mA — ขา B ต่อเข้าไฟโดยไม่มีตัวต้านทานจำกัดกระแส` });
      if (tj > 150) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W → อุณหภูมิรอยต่อประมาณ ${tj.toFixed(0)} °C เกิน 150 °C${pr.heatsink ? '' : ' — ตัวเปล่าระบายได้เพียง ≈ 2 W ต้องติดแผ่นระบายความร้อน'}` }); }
      else if (tj > 85) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W (VCE ${vce.toFixed(2)} V × IC ${fmtA(ic)}) → ประมาณ ${tj.toFixed(0)} °C ร้อนจนแตะไม่ได้${pr.heatsink ? '' : ' — ควรติดแผ่นระบายความร้อน'}` });
      if (region === 1 && ic > 0.05 && vce > 2 && pd > 0.5) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ทำงานในย่านขยาย (VCE ${vce.toFixed(2)} V) ไม่อิ่มตัว — กระแสเบส ${fmtA(ib)} ไม่พอ ลดตัวต้านทานเบสเพื่อให้อิ่มตัวและร้อนน้อยลง` });
      if (vbe < -5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VBE ย้อน ${vbe.toFixed(1)} V เกินพิกัด −5 V` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'comparator') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const conn = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins.length ?? 0) > 1;
      // ช่องที่ไม่ใช้: ดาต้าชีตแนะนำให้ต่อขาเข้าทั้งสองลง GND — ถือว่าไม่ได้ใช้ ไม่ต้องเตือนขาออกลอย
      const gNet = netOfPin(c, part.id, 'GND');
      const parked = (a: string, b: string) => netOfPin(c, part.id, a) === gNet && netOfPin(c, part.id, b) === gNet;
      const extra: Record<string, number> = { vcc };
      let imax = 0;
      for (const ch of LM393_CHANNELS) {
        const on = !!result.relayStates?.[`${part.id}#${ch.n}`];
        const isink = on ? Math.abs(result.elements[`${part.id}#${ch.n}#on`]?.current ?? 0) : 0;
        const vp = nv(ch.inp) - g, vn = nv(ch.inn) - g, vo = nv(ch.out) - g;
        Object.assign(extra, { [`on${ch.n}`]: on ? 1 : 0, [`vp${ch.n}`]: vp, [`vn${ch.n}`]: vn, [`vo${ch.n}`]: vo, [`i${ch.n}`]: isink, [`used${ch.n}`]: [ch.inp, ch.inn, ch.out].some(conn) && !parked(ch.inp, ch.inn) ? 1 : 0 });
        imax = Math.max(imax, isink);
        if (!extra[`used${ch.n}`] || vcc < pr.vMin) continue;
        for (const [pin, v] of [[ch.inp, vp], [ch.inn, vn]] as const) {
          if (!conn(pin)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${pin} ลอย — ต่อเข้ากับแรงดันที่ต้องการเปรียบเทียบ (ขาเข้าที่ลอยทำให้ขาออกเปลี่ยนเองแบบสุ่ม)` });
          else if (v > vcc - 1.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${pin} = ${v.toFixed(2)} V เกินช่วง common mode (0 ถึง VCC − 1.5 V = ${(vcc - 1.5).toFixed(1)} V) — ผลการเปรียบเทียบอาจผิด ลดแรงดันขาเข้าด้วยวงแบ่ง` });
          else if (v < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขาเข้า ${pin} ต่ำกว่า GND ${(-v).toFixed(2)} V (พิกัด −0.3 V) — ของจริงอาจเสียหายหรือขาออกกลับสถานะผิด` });
        }
        if (!conn(ch.out)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาออก ${ch.out} ไม่ได้ต่ออะไร — ขาออกเป็น open collector ต้องมีตัวต้านทาน pull-up (เช่น 10 kΩ) หรือ LED + ตัวต้านทานจากไฟบวก` });
        if (isink > pr.sinkMax) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขาออก ${ch.out} รับกระแส ${fmtA(isink)} เกิน ${fmtA(pr.sinkMax)} — ของจริงจำกัดกระแสและแรงดันขาออกไม่ลงถึง 0 V (ตัวต้านทาน pull-up/LED ต้องค่าสูงขึ้น)` });
        else if (isink > 0.006) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขาออก ${ch.out} รับกระแส ${fmtA(isink)} เกิน 6 mA ที่ดาต้าชีตรับประกัน — ใช้ได้ส่วนใหญ่ (ค่าทั่วไป 16 mA) แต่ควรลดกระแส` });
      }
      const reading: PartReading = { current: imax, voltage: vcc, power: 0, extra };
      if (vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 8 VCC ต่อไฟบวก ขา 4 GND ต่อลบ` });
      else if (vcc > pr.vMax) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน ${pr.vMax} V` }); }
      else if (vcc < pr.vMin && (extra.usedA || extra.usedB)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V — ต่อขา 8 (VCC) เข้าไฟบวก 2–36 V และขา 4 (GND) ลงกราวด์` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'sonar') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const so = result.sonars?.[part.id];
      const width = so?.width ?? 0;
      const extra: Record<string, number> = { vcc, echo: so?.echo ?? 0, width, count: so?.count ?? 0, vEcho: nv('ECHO') - g, vTrig: nv('TRIG') - g,
        dist: width > 0 && width < 0.03 ? (width * soundSpeed(pr.temperature)) / 2 * 100 : -1, set: pr.distance, expect: sonarEchoWidth(pr.distance, pr.temperature) };
      const reading: PartReading = { current: result.elements[`${part.id}#iq`]?.current ?? 0, voltage: vcc, power: 0, extra };
      const used = ['TRIG', 'ECHO'].some((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — VCC ต่อ 5 V, GND ต่อกราวด์` });
      else if (vcc > pr.vMax + 0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน 5 V ของโมดูล` }); }
      else if (used && vcc < pr.vMin - 0.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V — โมดูลต้องการ 5 V (Pico: ขา VBUS) จาก 3V3 จะไม่วัด` });
      if (pr.distance > SONAR_MAX_CM) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไม่มีวัตถุในระยะ 4 m — ECHO สูงค้าง ≈ 38 ms (โค้ดควรตั้ง timeout ของ time_pulse_us)` });
      else if (pr.distance < 2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ใกล้กว่า 2 cm — ต่ำกว่าระยะที่โมดูลวัดได้ (ค่าที่อ่านไม่น่าเชื่อถือ)` });
      // ECHO 5 V เข้า GPIO ของ Pico (ทน 3.3 V): ต่อตรง หรือผ่านตัวแบ่งแรงดันที่ให้เกิน 3.6 V
      const eN = netOfPin(c, part.id, 'ECHO')!;
      for (const pc of doc.parts) {
        if (!isPico(pc) || vcc < 4) continue;
        for (const gp of PICO_GPIO) {
          const gN = netOfPin(c, pc.id, `GP${gp}`)!;
          if (gN === eN) { diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ECHO (5 V) ต่อตรงเข้า GP${gp} ของ Pico ซึ่งทนได้ 3.3 V — ใช้ตัวแบ่งแรงดัน เช่น 1 kΩ จาก ECHO ถึงขา GP และ 2 kΩ จากขา GP ลงกราวด์ (≈ 3.3 V)` }); continue; }
          const rs = doc.parts.filter((p): p is ResistorPart => p.kind === 'resistor');
          const nets = (r: ResistorPart) => [netOfPin(c, r.id, '1'), netOfPin(c, r.id, '2')];
          const top = rs.find((r) => nets(r).includes(eN) && nets(r).includes(gN));
          const bot = rs.find((r) => r !== top && nets(r).includes(gN) && nets(r).includes(netOfPin(c, part.id, 'GND')!));
          if (top && bot) {
            const ve = (vcc * bot.params.resistance) / (top.params.resistance + bot.params.resistance);
            extra.vDiv = ve; extra.divGp = gp;
            if (ve > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ตัวแบ่งแรงดันให้ ${ve.toFixed(2)} V ที่ GP${gp} ตอน ECHO สูง — เกิน 3.3 V ปรับให้ตัวล่างมากขึ้น (เช่น 1 kΩ / 2 kΩ)` });
            else if (ve < 2.0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ตัวแบ่งแรงดันให้แค่ ${ve.toFixed(2)} V ที่ GP${gp} — ต่ำกว่าระดับที่ Pico อ่านเป็น 1 แน่นอน (≈ 2 V)` });
          }
        }
      }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'hbridge') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc1 = nv('VCC1') - g, vcc2 = nv('VCC2') - g;
      const rs = result.relayStates ?? {};
      const off = new Set(built.inactive.map((i) => i.id));
      const driven = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins ?? []).some((pp) => !(pp.partId === part.id && pp.pin === pin) && !off.has(pp.partId));
      const linked = (pin: string) => netLinked(c, doc, netOfPin(c, part.id, pin)!);
      const extra: Record<string, number> = { vcc1, vcc2 };
      let pd = 0, imax = 0;
      for (const ch of L293D_CHANNELS) {
        const id = `${part.id}#${ch.n}`;
        const en = !!rs[`${id}#e`], hi = !!rs[`${id}#h`];
        const vy = nv(ch.y) - g;
        const io = en ? result.elements[`${id}#${hi ? 'h' : 'l'}`]?.current ?? 0 : 0;
        const ik = (result.elements[`${part.id}#k${ch.n}h`]?.current ?? 0) + (result.elements[`${part.id}#k${ch.n}l`]?.current ?? 0);
        extra[`s${ch.n}`] = en ? (hi ? 1 : 0) : -1;
        extra[`vy${ch.n}`] = vy; extra[`iy${ch.n}`] = io; extra[`ik${ch.n}`] = ik;
        pd += en ? Math.abs(io) * (hi ? vcc2 - vy : vy) : 0;
        imax = Math.max(imax, Math.abs(io));
        if (!linked(ch.y)) continue;
        if (Math.abs(io) > pr.peakOutputCurrent) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${ch.y} กระแส ${fmtA(Math.abs(io))} เกินกระแสยอด ${fmtA(pr.peakOutputCurrent)} — มอเตอร์หยุดค้างหรือขาออกลัดวงจร (ไอซีจริงร้อนจนตัดตัวเอง)` });
        else if (Math.abs(io) > pr.maxOutputCurrent) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${ch.y} กระแส ${fmtA(Math.abs(io))} เกินพิกัดต่อเนื่อง ${fmtA(pr.maxOutputCurrent)} — ช่วงเริ่มหมุนสั้น ๆ ได้ (≤ 1.2 A) แต่ถ้าค้างไว้ไอซีจะร้อนเกิน` });
        for (const pin of [ch.a, ch.en]) if (!driven(pin) && vcc1 >= 4) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${pin === ch.en ? (ch.n <= 2 ? '1 (1,2EN)' : '9 (3,4EN)') : pin} ลอย — ต่อเข้า GPIO หรือ 5 V/GND ให้แน่นอน (ขาเข้าลอยของไอซีจริงอ่านค่าไม่แน่นอน)` });
      }
      extra.pd = pd;
      const reading: PartReading = { current: imax, voltage: vcc2, power: pd, extra };
      const usedAny = L293D_CHANNELS.some((ch) => linked(ch.y));
      if (vcc1 < -0.3 || vcc2 < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 16 VCC1 และขา 8 VCC2 ต้องเป็นบวกเทียบ GND (ขา 4/5/12/13)` });
      if (vcc1 > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VCC1 ${vcc1.toFixed(1)} V เกิน ${pr.vMax} V — ขา 16 ใช้ไฟ 5 V เท่านั้น (ไฟมอเตอร์ต่อที่ขา 8)` }); }
      if (vcc2 > pr.vMotorMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VCC2 ${vcc2.toFixed(1)} V เกิน ${pr.vMotorMax} V` }); }
      if (usedAny && vcc1 < pr.vMin - 0.05 && vcc1 > -0.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: VCC1 (ขา 16) ${vcc1.toFixed(2)} V — ต้อง 4.5–7 V (Pico: ขา VBUS 5 V) ${vcc1 < 4 ? 'วงจรตรรกะไม่ทำงาน ขาออกลอยทั้งหมด' : ''}` });
      if (usedAny && vcc1 >= pr.vMin - 0.05 && vcc2 < vcc1 - 0.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: VCC2 (ขา 8 ไฟมอเตอร์) ${vcc2.toFixed(2)} V ต่ำกว่า VCC1 — ต่อแหล่งจ่ายมอเตอร์เข้าขา 8 (ดาต้าชีตกำหนด VCC2 ≥ VCC1)` });
      if (pd > 2) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กำลังสูญเสียในไอซี ${pd.toFixed(2)} W — แรงดันตกในไอซีราว 2–3 V × กระแสมอเตอร์ (DIP-16 ไม่มีแผ่นระบาย ≈ 36 °C/W ร้อนเกิน 70 °C) ` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'scr') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const vk = nv('K'), vak = nv('A') - vk, vgk = nv('G') - vk;
      const on = !!result.relayStates?.[part.id];
      const ig = result.elements[`${part.id}#gk`]?.current ?? 0;
      const ia = on ? result.elements[`${part.id}#ak`]?.current ?? 0 : result.elements[`${part.id}#off`]?.current ?? 0;
      const reading: PartReading = { current: ia, voltage: vak, power: Math.abs(ia * vak) + Math.abs(ig * vgk), extra: { on: on ? 1 : 0, ia, ig, vak, vgk, igt: pr.igt, ih: pr.ih } };
      const gNet = netOfPin(c, part.id, 'G')!, kNet = netOfPin(c, part.id, 'K')!;
      const gateUsed = netLinked(c, doc, gNet);
      const rgk = doc.parts.some((q) => q.kind === 'resistor' && [netOfPin(c, q.id, '1'), netOfPin(c, q.id, '2')].sort().join() === [gNet, kNet].sort().join());
      if (Math.abs(ia) > pr.maxCurrent) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสแอโนด ${fmtA(Math.abs(ia))} เกินพิกัด ${fmtA(pr.maxCurrent)} — ใส่โหลด/ตัวต้านทานจำกัดกระแสอนุกรมกับขา A (แบบจำลองการสอน)` }); }
      if (!on && Math.abs(vak) > pr.vdrm) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันคร่อม A–K ${Math.abs(vak).toFixed(1)} V เกิน VDRM ${pr.vdrm} V — SCR นำกระแสเองโดยไม่มีเกต (breakover) ของจริงอาจเสียหาย` });
      if (vgk < -5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันย้อนที่เกต ${(-vgk).toFixed(1)} V เกิน 5 V (VRGM) — ขาเกตอาจเสียหาย` });
      if (ig * vgk > 0.01) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กำลังที่เกต ${(ig * vgk * 1000).toFixed(0)} mW เกินพิกัดเฉลี่ย 10 mW — เพิ่มตัวต้านทานอนุกรมขาเกต (กระแสเกตแค่ 0.2–1 mA ก็พอ)` });
      if (on) {
        if (ig >= pr.igt && Math.abs(ia) < pr.ih) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: นำเพราะยังมีกระแสเกต — กระแสแอโนด ${fmtA(Math.abs(ia))} ต่ำกว่า IH ${fmtA(pr.ih)} ปล่อยเกตแล้วจะดับ (โหลดเบาเกินไปที่จะค้าง)` });
        else diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ติด (ค้างสถานะ) กระแสแอโนด ${fmtA(Math.abs(ia))} — ดับได้เมื่อกระแสแอโนดต่ำกว่า IH ${fmtA(pr.ih)} เช่น ตัดวงจรหรือกดลัดขา A–K` });
      } else if (vak > 0.5 && ig > 1e-6 && ig < pr.igt) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสเกต ${(ig * 1e6).toFixed(0)} µA ต่ำกว่า IGT ${(pr.igt * 1e6).toFixed(0)} µA — ยังไม่ติด ลดค่าตัวต้านทานเกต` });
      if (gateUsed && !rgk) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ค่าในดาต้าชีตวัดโดยมีตัวต้านทาน RGK 1 kΩ จาก G ลง K — เกตไวมาก ควรต่อไว้กันติดเองจากสัญญาณรบกวน (แบบจำลองนี้ไม่จำลองสัญญาณรบกวน)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'dht22' || part.kind === 'dht11') {
      const pr = part.params;
      const d11 = part.kind === 'dht11';
      const nv = (n: number | undefined) => { const x = n === undefined ? undefined : result.nodeVoltage[n]; return typeof x === 'number' ? x : 0; };
      const nG = netOfPin(c, part.id, 'GND'), nD = netOfPin(c, part.id, 'DATA'), nV = netOfPin(c, part.id, 'VDD');
      const g = nv(nG), vdd = nv(nV) - g, vdata = nv(nD) - g;
      const dr = result.dhts?.[part.id];
      // ตัวต้านทานดึงขึ้น: ปลายหนึ่งที่ DATA อีกปลายที่เน็ตแรงดันบวก (≥ 2.5 V)
      let pull = 0, pullV = 0;
      for (const q of doc.parts) if (q.kind === 'resistor') {
        const a = netOfPin(c, q.id, '1'), b = netOfPin(c, q.id, '2');
        const other = a === nD ? b : b === nD ? a : undefined;
        if (other === undefined || other === nD) continue;
        const vo = nv(other) - g;
        if (vo > 2.5) { pull = q.params.resistance; pullV = vo; }
      }
      const bytes = dr?.bytes?.length ? dr.bytes : d11 ? dht11Bytes(pr.temperature, pr.humidity) : dht22Bytes(pr.temperature, pr.humidity);
      const tw = (bytes[2] << 8) | bytes[3];
      const extra: Record<string, number> = { temp: pr.temperature, hum: pr.humidity, vdd, vdata, count: dr?.count ?? 0, interval: dr?.interval ?? 0, fast: dr?.fast ?? 0, busy: dr?.busy ?? 0, pull, pullV,
        sentT: d11 ? bytes[2] + bytes[3] / 10 : (tw & 0x7fff) / 10 * (tw & 0x8000 ? -1 : 1), sentH: d11 ? bytes[0] + bytes[1] / 10 : ((bytes[0] << 8) | bytes[1]) / 10 };
      const iq = Math.abs(result.elements[`${part.id}#iq`]?.current ?? 0) + Math.abs(result.elements[`${part.id}#ib`]?.current ?? 0);
      const reading: PartReading = { current: iq, voltage: vdd, power: Math.abs(vdd * iq), extra };
      const toMcu = doc.parts.some((p) => isPico(p) && PICO_GPIO.some((gp) => netOfPin(c, p.id, `GP${gp}`) === nD));
      if (vdd < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 1 (ซ้ายเมื่อมองด้านตะแกรง) VDD ขา 4 GND · ของจริงเสียหาย` });
      else if (vdd > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vdd.toFixed(1)} V เกิน ${pr.vMax} V` }); }
      else if (vdd < pr.vMin - 0.15 && (toMcu || vdd > 0.5)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vdd.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — เซนเซอร์อาจไม่ตอบ ต่อ VDD เข้า 3V3 หรือ VBUS` });
      if (toMcu && !pull) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: DATA ไม่มีตัวต้านทานดึงขึ้น — บัสสายเดียวเป็นแบบ open-drain ต้องมี 4.7–10 kΩ จาก DATA ไป VDD ไม่งั้นอ่านไม่ได้ (OSError: ETIMEDOUT)` });
      else if (toMcu && pullV > 3.6) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ตัวต้านทานดึงขึ้นต่อไฟ ${pullV.toFixed(1)} V — ขา GPIO ของ Pico ทนได้ 3.3 V ให้ดึงขึ้นไป 3V3` });
      else if (toMcu && (pull < 1000 || pull > 22000)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ตัวต้านทานดึงขึ้น ${fmtOhmShort(pull)} — ค่าที่ใช้ทั่วไป 4.7–10 kΩ` });
      if ((dr?.early ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: โค้ดสั่งอ่านภายใน 1 วินาทีหลังจ่ายไฟ (${dr!.early} ครั้ง) — เอกสารกำหนดให้รอ 1 s ให้เซนเซอร์เสถียรก่อน ช่วงนี้เซนเซอร์ไม่ตอบ (โค้ดได้ข้อผิดพลาด ETIMEDOUT) · ใส่ time.sleep(1) ก่อนอ่านครั้งแรก` });
      if ((dr?.fast ?? 0) > 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: อ่านถี่กว่าทุก ${d11 ? 1 : 2} วินาที (ล่าสุดห่าง ${(dr!.interval).toFixed(2)} s) — เอกสารกำหนดรอบการวัด ≥ ${d11 ? 1 : 2} s ค่าที่ได้อาจซ้ำของเดิม` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'soilsensor') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g, vout = nv('AOUT') - g;
      const m = result.soils?.[part.id] ?? pr.moisture;
      const io = result.elements[`${part.id}#ref`]?.current ?? 0;
      const iq = result.elements[`${part.id}#iq`]?.current ?? 0;
      const used = netLinked(c, doc, netOfPin(c, part.id, 'AOUT')!);
      let inflow = 0;
      for (const q of doc.parts) if (q.kind === 'pump' && q.params.target === part.id) inflow += result.pumpFlows?.[q.id] ?? 0;
      const extra: Record<string, number> = { moisture: m, vcc, vout, vexp: soilVout(m, pr), iout: Math.abs(io), iq, inflow, adc: Math.round((Math.min(3.3, Math.max(0, vout)) / 3.3) * 65535) };
      const reading: PartReading = { current: Math.abs(iq), voltage: vcc, power: Math.abs(vcc * iq), extra };
      if (vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — สายแดง VCC ต่อไฟบวก สายดำ GND ต่อกราวด์ (โมดูลไม่มีไดโอดกันกลับขั้ว ของจริงเสียหาย)` });
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน ${pr.vMax} V` }); }
      else if (vcc < pr.vMin - 0.15 && (used || vcc > 0.5)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — ต่อ VCC เข้า 3V3 หรือ VBUS ของ Pico` });
      else if (Math.abs(vout - soilVout(m, pr)) > 0.5 && vcc >= pr.vMin - 0.15) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา AOUT ถูกโหลดจนแรงดันเพี้ยน (${vout.toFixed(2)} V จาก ${soilVout(m, pr).toFixed(2)} V) — ต่อเข้าขา ADC หรือโวลต์มิเตอร์เท่านั้น` });
      if (m >= 99.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ดินอิ่มน้ำ 100% — น้ำล้นกระถาง รากขาดอากาศ (ปั๊มควรหยุดก่อนถึงจุดนี้)` });
      else if (m <= 5) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ดินแห้งมาก (${m.toFixed(0)}%) — ต้นไม้เริ่มเหี่ยว` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'pump') {
      const er = result.elements[part.id];
      const pr = part.params;
      const w = result.motorSpeeds?.[part.id] ?? 0;
      const i = er?.current ?? 0, v = er?.voltage ?? 0;
      const flow = result.pumpFlows?.[part.id] ?? pumpFlow(w, pr);
      const tgt = doc.parts.find((q) => q.id === pr.target && q.kind === 'soilsensor');
      const reading: PartReading = { current: i, voltage: v, power: v * i, extra: { w, rpm: (w * 60) / (2 * Math.PI), flow, mlps: flow / 3.6, watering: tgt && flow > 0.5 ? 1 : 0, stalled: Math.abs(w) < 1 && Math.abs(i) > 0.3 ? 1 : 0 } };
      if (Math.abs(v) > pr.vMax + 0.5) { reading.overRated = true; diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดัน ${Math.abs(v).toFixed(1)} V เกินพิกัด 3–${pr.vMax} V ของปั๊ม — มอเตอร์ร้อน อายุสั้น` }); }
      if (v < -0.5 && Math.abs(i) > 0.01) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ต่อกลับขั้ว — ใบพัดหมุนกลับ น้ำแทบไม่ไหล (สายแดง + สายดำ −)` });
      else if (v > 0.5 && flow < 0.5 && Math.abs(i) > 0.01) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: แรงดัน ${v.toFixed(2)} V ต่ำเกินไป ใบพัดหมุนแต่ดันน้ำขึ้นสูง ${pr.lift} cm ไม่ได้ — ใช้ 3–6 V` });
      if (flow > 0.5 && !tgt) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ปั๊มทำงานแต่สายยางยังไม่ได้ไปที่กระถางใด — เลือกกระถาง (เซนเซอร์ความชื้น) ในแผงคุณสมบัติของปั๊ม` });
      for (const p of doc.parts) if (isPico(p)) for (const g of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${g}`);
        if (gn !== undefined && (gn === netOfPin(c, part.id, 'P') || gn === netOfPin(c, part.id, 'N'))) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ต่อตรงกับขา GP${g} ของ Pico — ขา GPIO จ่ายได้ราว 12 mA แต่ปั๊มกิน 130–220 mA ต้องขับผ่านรีเลย์หรือมอสเฟต + ไดโอดกันย้อน` });
      }
      const nA = netOfPin(c, part.id, 'P'), nB = netOfPin(c, part.id, 'N');
      const switched = doc.parts.some((p) => (p.kind === 'mosfet' && [nA, nB].includes(netOfPin(c, p.id, 'D'))) || (p.kind === 'bjt' && [nA, nB].includes(netOfPin(c, p.id, 'C'))) || (p.kind === 'darlington' && [nA, nB].includes(netOfPin(c, p.id, 'C'))));
      const flyback = doc.parts.some((p) => p.kind === 'diode' && [netOfPin(c, p.id, 'A'), netOfPin(c, p.id, 'K')].sort().join() === [nA, nB].sort().join());
      if (switched && !flyback) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขับด้วยทรานซิสเตอร์/มอสเฟตแต่ไม่มีไดโอดกันย้อนคร่อมปั๊ม — ตอนตัดกระแส ขดลวดมอเตอร์สร้างแรงดันกระชากสูง (แคโทดไปด้านไฟบวก)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'lm35') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vs = nv('VS') - g, vout = nv('OUT') - g;
      const io = result.elements[`${part.id}#on`]?.current ?? 0;
      const iq = result.elements[`${part.id}#iq`]?.current ?? 0;
      const used = netLinked(c, doc, netOfPin(c, part.id, 'OUT')!);
      const extra: Record<string, number> = { temp: pr.temperature, vs, vout, vexp: lm35Vout(pr.temperature), iout: io, iq };
      const reading: PartReading = { current: Math.abs(io) + Math.abs(iq), voltage: vs, power: Math.abs(vs * iq) + Math.abs((vs - vout) * io), extra };
      if (vs < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — +VS ต่อไฟบวก GND ต่อลบ (มองหน้าแบน ขาลง: ซ้าย +VS กลาง VOUT ขวา GND) ของจริงร้อนและเสียหาย` });
      else if (vs > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vs.toFixed(1)} V เกิน ${pr.vMax} V` }); }
      else if (vs < pr.vMin - 0.05) { if (used || vs > 0.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vs.toFixed(2)} V ต่ำกว่า ${pr.vMin} V ตามดาต้าชีต — ใช้ 5 V (Pico: ขา VBUS) ค่าที่อ่านได้จาก 3.3 V ไม่รับประกันความแม่นยำ` }); }
      else {
        if (pr.temperature < 2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ${pr.temperature} °C ต่ำกว่าช่วงของวงจรพื้นฐาน (2–150 °C) — ขาออกไม่ลงต่ำกว่า 0 V ถ้าต้องวัดค่าติดลบต้องมีแหล่งจ่ายลบและตัวต้านทานดึงลง` });
        else if (pr.temperature > 100) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: รุ่น LM35D ใช้งาน 0–100 °C (${pr.temperature} °C เกินช่วง)` });
      }
      if (Math.abs(io) > pr.maxOutputCurrent) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสขาออก ${fmtA(Math.abs(io))} เกิน ${fmtA(pr.maxOutputCurrent)} — ขา VOUT ต่อเข้าโหลดหนักหรือลัดลงกราวด์ (ต่อเข้าขาเข้า ADC/โวลต์มิเตอร์เท่านั้น)` });
      else if (Math.abs(vout - lm35Vout(pr.temperature)) > 0.02 && vs >= pr.vMin && Math.abs(io) > 1e-4) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาออกถูกโหลดจนแรงดันเพี้ยน (${(vout * 100).toFixed(1)} °C จาก ${pr.temperature} °C)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'counter') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('VSS'), vdd = nv('VDD') - g;
      const conn = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins.length ?? 0) > 1 || doc.wires.some((w) => [w.a, w.b].some((t) => netOfTerminal(c, t) === netOfPin(c, part.id, pin)));
      const off = new Set(built.inactive.map((i) => i.id));
      const driven = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins ?? []).some((pp) => !(pp.partId === part.id && pp.pin === pin) && !off.has(pp.partId));
      const rs = result.relayStates ?? {};
      let count = 0;
      for (let k = 0; k < 10; k++) if (rs[`${part.id}#q${k}`]) count = k;
      const extra: Record<string, number> = { vdd, count, clk: rs[`${part.id}#clk`] ? 1 : 0, vclk: nv('CLK') - g, inh: nv('INH') - g > vdd / 2 ? 1 : 0, rst: nv('RST') - g > vdd / 2 ? 1 : 0 };
      let imax = 0;
      const outs = [...CD4017_OUTS.map((q, k) => [q, `q${k}`, k === count] as const), ['CO', 'co', count <= 4] as const];
      for (const [pin, id, hi] of outs) {
        const io = result.elements[`${part.id}#${id}${hi ? 'h' : 'l'}`]?.current ?? 0;
        const vo = nv(pin) - g;
        extra[`v${pin}`] = vo; extra[`i${pin}`] = Math.abs(io);
        imax = Math.max(imax, Math.abs(io));
        if (vdd < pr.vMin) continue;
        if (Math.abs(io) > pr.maxOutputCurrent) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} กระแส ${fmtA(Math.abs(io))} เกิน ${fmtA(pr.maxOutputCurrent)} (absolute maximum) — ใส่ตัวต้านทานอนุกรมกับ LED (เช่น 1 kΩ) หรือขับผ่านทรานซิสเตอร์` });
        else if (hi && vo < 0.7 * vdd && Math.abs(io) > 1e-4) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา ${pin} สูงแต่แรงดันเหลือ ${vo.toFixed(2)} V (ไฟเลี้ยง ${vdd.toFixed(1)} V) — ขาออก CMOS 4000B จ่ายกระแสได้น้อย (ราว 1–3 mA ที่ 5 V) LED จึงสว่างไม่เต็ม ใช้ไฟเลี้ยงสูงขึ้นหรือขับผ่านทรานซิสเตอร์` });
      }
      const reading: PartReading = { current: imax, voltage: vdd, power: 0, extra };
      const used = CD4017_PINOUT.some((p) => p !== 'VDD' && p !== 'VSS' && conn(p));
      if (vdd < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 16 VDD ต่อไฟบวก ขา 8 VSS ต่อลบ (ของจริงเสียหาย)` });
      else if (vdd > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vdd.toFixed(1)} V เกิน ${pr.vMax} V ของตระกูล 4000B` }); }
      else if (vdd < pr.vMin) { if (used) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vdd.toFixed(2)} V — ต่อขา 16 (VDD) เข้าไฟบวก 3–18 V และขา 8 (VSS) ลงกราวด์ ไอซีจึงจะทำงาน` }); }
      else {
        for (const [pin, nm] of [['CLK', 'ขา 14 CLOCK'], ['RST', 'ขา 15 RESET'], ['INH', 'ขา 13 CLOCK INHIBIT']] as const) {
          if (!driven(pin)) diags.push({ severity: 'warn', partId: part.id, message: pin === 'CLK'
            ? `${part.label}: ${nm} ลอย — ต่อสัญญาณนาฬิกา (เช่น ขา 3 ของ 555) หรือปุ่มกดกับตัวต้านทานดึงลง` 
            : `${part.label}: ${nm} ลอย — ขาเข้า CMOS ที่ลอยอ่านค่าสุ่ม ไอซีจริงอาจรีเซ็ต/หยุดนับเอง ต่อลง VSS (ขา 8)` });
        }
        if (extra.rst && driven('RST')) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: RESET (ขา 15) เป็นสูง — ไอซีค้างที่ Q0 ไม่นับ` });
        if (extra.inh && driven('INH')) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: CLOCK INHIBIT (ขา 13) เป็นสูง — หยุดนับ` });
      }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'opto') {
      const pr = part.params;
      const led = result.elements[`${part.id}#led`], q = result.elements[`${part.id}#q`];
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : null; };
      const iF = led?.current ?? 0, vF = led?.voltage ?? 0, iC = q?.current ?? 0;
      const vC = nv('C'), vE = nv('E');
      const vce = vC !== null && vE !== null ? vC - vE : 0;
      const sat = iF > 1e-4 && iC < 0.9 * pr.ctr * iF && vce < 0.4 ? 1 : 0;
      const inNets = ['A', 'K'].map((p) => netOfPin(c, part.id, p)), outNets = ['C', 'E'].map((p) => netOfPin(c, part.id, p));
      const cA = result.component[netOfPin(c, part.id, 'A')!] ?? -1, cC = result.component[netOfPin(c, part.id, 'C')!] ?? -1;
      const shared = inNets.some((nn) => outNets.includes(nn)) || (cA >= 0 && cA === cC) ? 1 : 0;
      const extra: Record<string, number> = { iF, vF, iC, vce, ctr: pr.ctr, ctrMeas: iF > 1e-4 ? iC / iF : 0, sat, shared, pc: vce * iC };
      const reading: PartReading = { current: iF, voltage: vF, power: vF * iF + vce * iC, extra };
      if (iF > pr.maxForwardCurrent) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแส LED ${fmtA(iF)} เกิน ${fmtA(pr.maxForwardCurrent)} — ใส่ตัวต้านทานอนุกรมขา 1 (เช่น 330 Ω จาก 3.3 V ได้ ≈ 6 mA)` }); }
      if (-vF > pr.maxReverseVoltage) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: LED ด้านขาเข้าได้แรงดันย้อนกลับ ${(-vF).toFixed(1)} V เกิน ${pr.maxReverseVoltage} V — ขา 1 (แอโนด) ต้องเป็นบวก ขา 2 (แคโทด) ลบ` }); }
      else if (vF < -0.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: LED ขาเข้าต่อกลับขั้ว (ขา 1 แอโนด ต้องต่อด้านบวก) — LED ไม่ติด ขาออกไม่นำ` });
      if (iC > pr.maxCollectorCurrent) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสคอลเลกเตอร์ ${fmtA(iC)} เกิน ${fmtA(pr.maxCollectorCurrent)} — เพิ่มตัวต้านทานโหลดที่ขา 4` }); }
      if (vce > pr.vceo) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VCE ${vce.toFixed(1)} V เกิน ${pr.vceo} V` }); }
      else if (vce < -0.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาออกต่อกลับ — ขา 4 คอลเลกเตอร์ต่อด้านบวก (ผ่านโหลด) ขา 3 อิมิตเตอร์ต่อลบ` });
      if (vce * iC > 0.15) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: โฟโต้ทรานซิสเตอร์สูญเสีย ${(vce * iC * 1000).toFixed(0)} mW เกิน 150 mW — ให้ทำงานแบบสวิตช์ (อิ่มตัว) หรือเพิ่มโหลด` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'shiftreg') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const conn = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins.length ?? 0) > 1 || doc.wires.some((w) => [w.a, w.b].some((t) => netOfTerminal(c, t) === netOfPin(c, part.id, pin)));
      const off = new Set(built.inactive.map((i) => i.id));
      const driven = (pin: string) => (c.nets[netOfPin(c, part.id, pin)!]?.partPins ?? []).some((pp) => !(pp.partId === part.id && pp.pin === pin) && !off.has(pp.partId));
      const rs = result.relayStates ?? {};
      let sreg = 0, out = 0;
      for (let k = 0; k < 8; k++) { if (rs[`${part.id}#s${k}`]) sreg |= 1 << k; if (rs[`${part.id}#o${k}`]) out |= 1 << k; }
      const oe = rs[`${part.id}#oe`] ? 1 : 0;
      const extra: Record<string, number> = { vcc, sreg, out, oe, clr: nv('SRCLR') - g < vcc / 2 ? 1 : 0, sck: rs[`${part.id}#sck`] ? 1 : 0, rck: rs[`${part.id}#rck`] ? 1 : 0, vser: nv('SER') - g };
      let isrc = 0, isink = 0, imax = 0;
      const weak: Array<[string, number, number]> = [];
      const outs = [...HC595_OUTS.map((q, k) => [q, `q${k}`, !!(out & (1 << k))] as const), ['QH2', 'qh2', !!(sreg & 0x80)] as const];
      for (const [pin, id, hi] of outs) {
        const io = Math.abs(result.elements[`${part.id}#${id}${hi ? 'h' : 'l'}`]?.current ?? 0);
        const vo = nv(pin) - g;
        extra[`v${pin}`] = vo; extra[`i${pin}`] = io;
        if (hi) isrc += io; else isink += io;
        imax = Math.max(imax, io);
        if (vcc < pr.vMin || (oe && pin !== 'QH2')) continue;
        if (io > pr.maxOutputCurrent) { diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} กระแส ${fmtA(io)} เกิน ${fmtA(pr.maxOutputCurrent)} (absolute maximum) — ใส่ตัวต้านทานจำกัดกระแสกับ LED ทุกดวง (เช่น 330 Ω)` }); }
        else if (hi && io > 1e-4 && vo < 0.8 * vcc) weak.push([pin, vo, io]);
      }
      if (weak.length) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา ${weak.map((w) => w[0]).join(', ')} สูงแต่แรงดันเหลือ ${weak[0][1].toFixed(2)} V (ไฟเลี้ยง ${vcc.toFixed(1)} V) ที่ ${fmtA(weak[0][2])} — ขาออก 74HC ออกแบบให้จ่ายราว 6 mA ต่อขา ใส่ตัวต้านทานจำกัดกระแส` });
      extra.isrc = isrc; extra.isink = isink;
      const reading: PartReading = { current: Math.max(isrc, isink), voltage: vcc, power: 0, extra };
      const used = HC595_PINOUT.some((p) => p !== 'VCC' && p !== 'GND' && conn(p));
      if (vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 16 VCC ต่อไฟบวก ขา 8 GND ต่อลบ (ของจริงเสียหาย)` });
      else if (vcc > 7) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน 7 V (absolute maximum ของ 74HC) — ใช้ 5 V หรือ 3.3 V` }); }
      else if (vcc > pr.vMax + 0.2) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินช่วงใช้งาน 2–6 V` });
      else if (vcc < pr.vMin) { if (used) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V — ต่อขา 16 (VCC) เข้าไฟบวก 2–6 V (Pico: 3V3) และขา 8 (GND) ลงกราวด์ ไอซีจึงจะทำงาน` }); }
      else {
        if (Math.max(isrc, isink) > pr.maxSupplyCurrent) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสรวมขา ${isrc >= isink ? 'VCC' : 'GND'} ${fmtA(Math.max(isrc, isink))} เกิน ${fmtA(pr.maxSupplyCurrent)} — LED ติดพร้อมกันหลายดวงกินกระแสรวมเกิน เพิ่มค่าตัวต้านทาน` }); }
        for (const [pin, nm, hint] of [['SER', 'ขา 14 SER', 'ต่อ GPIO ที่ส่งข้อมูล'], ['SRCLK', 'ขา 11 SRCLK', 'ต่อ GPIO ที่ส่งสัญญาณเลื่อนบิต'], ['RCLK', 'ขา 12 RCLK', 'ต่อ GPIO ที่สั่งแสดงผล (latch)'],
          ['SRCLR', 'ขา 10 SRCLR', 'ต่อ VCC (ขา 16) ถ้าไม่ใช้ล้างข้อมูล'], ['OE', 'ขา 13 OE', 'ต่อ GND (ขา 8) เพื่อเปิดขาออก']] as const) {
          if (!driven(pin)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ${nm} ลอย — ขาเข้า CMOS ที่ลอยอ่านค่าสุ่ม ${hint}` });
        }
        if (extra.clr && driven('SRCLR')) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: SRCLR (ขา 10) เป็นต่ำ — รีจิสเตอร์เลื่อนถูกล้างค้างไว้ ต่อเข้า VCC` });
        if (oe && driven('OE')) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: OE (ขา 13) เป็นสูง — ขาออก QA–QH ปิด (ลอย) LED ไม่ติด ต่อ OE ลง GND` });
        // ไฟเลี้ยง 5 V แต่ขับขาเข้าจาก Pico 3.3 V: VIH ≈ 0.7 VCC = 3.5 V
        const fromPico = vcc > 4.2 ? doc.parts.filter((pc) => isPico(pc)).flatMap((pc) => PICO_GPIO.filter((gp) => ['SER', 'SRCLK', 'RCLK'].some((p) => netOfPin(c, part.id, p) === netOfPin(c, pc.id, `GP${gp}`)))) : [];
        if (fromPico.length) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V ต้องการขาเข้าสูง ≥ ${(0.7 * vcc).toFixed(2)} V (VIH) แต่ขา ${fromPico.map((g) => `GP${g}`).join(', ')} ของ Pico ให้แค่ 3.3 V — อาจอ่านผิดพลาด ใช้ไฟเลี้ยง 3V3 หรือไอซีรุ่น 74HCT595` });
      }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'lcd1602p') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('VSS'), vcc = nv('VDD') - g, v0 = nv('V0') - g;
      const st = result.plcd?.[part.id];
      const iBl = Math.max(0, result.elements[`${part.id}#bl`]?.current ?? 0);
      const vlcd = vcc - v0;
      const extra: Record<string, number> = { vcc, v0, vlcd, contrast: st?.powered ? charLcdContrast(vlcd, 1) : 0, ghost: st?.powered ? charLcdGhost(vlcd, 1) : 0, bl: iBl, powered: st?.powered ? 1 : 0, on: st?.lcd.displayOn ? 1 : 0, chars: st?.chars ?? 0, writes: st?.writes ?? 0, dropped: st?.dropped ?? 0, reads: st?.reads ?? 0, dl8: st ? (st.dl8 ? 1 : 0) : 1 };
      const i = Math.abs(result.elements[`${part.id}#load`]?.current ?? 0) + iBl;
      const reading: PartReading = { current: i, voltage: vcc, power: vcc * i, extra };
      const wired = ['VSS', 'VDD'].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VDD ต่ำกว่า VSS) — ขา 1 (VSS) ต่อกราวด์ ขา 2 (VDD) ต่อ 5 V` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V ของ HD44780` }); }
      else if (wired && vcc < pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — จอไม่ทำงาน (ขา 1 VSS → GND, ขา 2 VDD → 5 V)` });
      if (iBl > pr.blMax) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟพื้นหลังกินกระแส ${(iBl * 1000).toFixed(0)} mA เกิน ${(pr.blMax * 1000).toFixed(0)} mA — ใส่ตัวต้านทานอนุกรมที่ขา A (เช่น 220 Ω)` }); }
      if (st?.powered && vcc < 4.3) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V — จอ LCD 5 V ต้องการ ≈ 5 V ตัวอักษรจึงชัด` });
      if (st?.powered && (st.chars ?? 0) > 0 && extra.contrast < 0.25) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ตัวอักษรจาง — แรงดัน VDD − V0 = ${vlcd.toFixed(2)} V (ต้องราว 4–4.7 V) หมุน VR ที่ขา V0 ให้แรงดัน V0 ต่ำลง (≈ 0.3–1 V)` });
      if (st?.powered && extra.ghost > 0.25) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: V0 ต่ำเกินไป (VDD − V0 = ${vlcd.toFixed(2)} V) — เห็นกล่องจุดทุกช่อง หมุน VR ให้ V0 สูงขึ้นเล็กน้อย` });
      if ((st?.dropped ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ส่งข้อมูลเร็วกว่าเวลาประมวลผลของ HD44780 ${st!.dropped} ครั้ง (คำสั่งทั่วไป 37 µs, clear/home 1.52 ms) — ข้อมูลถูกทิ้ง ใส่ delay หลังคำสั่ง` });
      if ((st?.reads ?? 0) > 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา RW เป็น 1 ขณะส่ง E (${st!.reads} ครั้ง) — จอไม่รับข้อมูลในโหมดอ่าน ต่อ RW กับ GND หรือกำหนดขา rw ใน LiquidCrystal` });
      if (st?.powered && (st.writes ?? 0) === 0 && result.elements) {
        const eNet = netOfPin(c, part.id, 'E');
        if (eNet !== undefined && !netLinked(c, doc, eNet)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา E (ขา 6) ยังไม่ได้ต่อ — จอรับข้อมูลที่ขอบลงของ E` });
      }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'tm1637') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const st = result.seg?.[part.id];
      const i = Math.abs(result.elements[`${part.id}#led`]?.current ?? 0);
      const extra: Record<string, number> = { iled: i, vcc, vclk: nv('CLK') - g, vdio: nv('DIO') - g, powered: st?.powered ? 1 : 0, on: st?.on ? 1 : 0, brightness: st?.brightness ?? 0, cmds: st?.cmds ?? 0, dataBytes: st?.dataBytes ?? 0 };
      const reading: PartReading = { current: i, voltage: vcc, power: vcc * i, extra };
      const wired = ['VCC', 'GND', 'CLK', 'DIO'].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VCC ต่ำกว่า GND) — ตรวจขา VCC/GND ของโมดูล` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V ของ TM1637` }); }
      else if (wired && vcc < pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — TM1637 ไม่ทำงาน (ต่อ VCC กับ 3V3 หรือ 5 V และ GND กับกราวด์ของบอร์ด)` });
      for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${gp}`);
        for (const line of ['CLK', 'DIO'] as const) {
          if (gn === undefined || gn !== netOfPin(c, part.id, line)) continue;
          const v = line === 'CLK' ? extra.vclk : extra.vdio;
          if (v > 3.6 && vcc > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: สาย ${line} ถูกดึงขึ้นถึง ${v.toFixed(1)} V (ตัวต้านทานดึงขึ้น 10 kΩ บนโมดูลต่อกับ VCC) — เกินขา GP${gp} ของ Pico ที่ทนได้ 3.3 V ให้ใช้ไฟเลี้ยงโมดูลจาก 3V3` });
        }
      }
      if (st && st.minPulse < 400e-9) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: พัลส์ CLK สั้นสุด ${(st.minPulse * 1e9).toFixed(0)} ns ต่ำกว่า 400 ns ที่ดาต้าชีตกำหนด (ความถี่สูงสุด 500 kHz) — ของจริงอาจรับข้อมูลผิด` });
      if (st && st.minKeyPeriod < 4e-6) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: อ่านปุ่มด้วยคาบ CLK ${(st.minKeyPeriod * 1e6).toFixed(2)} µs — ดาต้าชีตกำหนดให้อ่านปุ่มที่ ≤ 250 kHz (คาบ ≥ 4 µs)` });
      if (st?.powered && wired && (st.dataBytes ?? 0) > 0 && !st.on) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ส่งข้อมูลตัวเลขแล้วแต่จอยังปิด — ส่งคำสั่งควบคุมจอ 0x88–0x8F (เปิดจอ + ความสว่าง)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'ina219') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const st = result.i2c?.[part.id];
      const regs = st?.inaRegs ?? [0x399f, 0, 0, 0, 0, 0];
      const s16 = (v: number) => (v << 16) >> 16;
      const ish = result.elements[`${part.id}#shunt`]?.current ?? 0;
      const vsh = nv('VIN+') - nv('VIN-'), vbus = nv('VIN-') - g;
      const extra: Record<string, number> = { vcc, vsda: nv('SDA') - g, vscl: nv('SCL') - g, powered: st?.powered ? 1 : 0, acks: st?.acks ?? 0, addr: st?.addr ?? pr.addr, conflicts: st?.conflicts ?? 0,
        vsh, vbus, ishunt: ish, cal: regs[5], regShunt: s16(regs[1]) * 10e-6, regBus: (regs[2] >> 3) * 4e-3, regCurrent: s16(regs[4]), regPower: regs[3], config: regs[0], inaReads: st?.inaReads ?? 0 };
      const i = Math.abs(result.elements[`${part.id}#load`]?.current ?? 0);
      const reading: PartReading = { current: i, voltage: vcc, power: vcc * i, extra };
      const wired = ['VCC', 'GND', 'SDA', 'SCL'].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VCC ต่ำกว่า GND) — ตรวจขา VCC/GND ของโมดูล` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V ของ INA219` }); }
      else if (wired && vcc < pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — INA219 ไม่ทำงาน ไม่ตอบบนบัส I²C (ต่อ VCC กับ 3V3 และ GND กับกราวด์ของบอร์ด)` });
      if (vbus > 26.3 || nv('VIN+') - g > 26.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันที่ขา VIN± เกิน 26 V (พิกัดของ INA219)` }); }
      if (Math.abs(vsh) > 0.32) { reading.overRated = true; diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดันคร่อม shunt ${(vsh * 1000).toFixed(0)} mV เกินช่วงวัด ±320 mV (กระแส > ${(0.32 / pr.shunt).toFixed(1)} A) — ค่าที่อ่านได้ค้างที่ค่าสูงสุด` }); }
      if (ish < -1e-4) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: กระแสไหลจาก VIN− ไป VIN+ (กลับทาง) ค่าที่อ่านได้ติดลบ — ต่อแหล่งจ่ายเข้า VIN+ และโหลดที่ VIN−` });
      const lineOk = netLinked(c, doc, netOfPin(c, part.id, 'VIN+')!) && netLinked(c, doc, netOfPin(c, part.id, 'VIN-')!);
      if (wired && !lineOk) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ยังไม่ได้ต่อ VIN+/VIN− — ต่อโมดูลอนุกรมด้านบวกของโหลด: แหล่งจ่าย → VIN+ → (shunt 0.1 Ω) → VIN− → โหลด` });
      if (st && (st.inaReads ?? 0) > 2 && regs[5] === 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ยังไม่ได้เขียนรีจิสเตอร์ calibration (0x05) — กระแส (0x04) และกำลัง (0x03) อ่านได้ 0 เสมอ เขียน 4096 สำหรับ shunt 0.1 Ω (0.1 mA ต่อบิต)` });
      for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${gp}`);
        for (const line of ['SDA', 'SCL'] as const) {
          if (gn === undefined || gn !== netOfPin(c, part.id, line)) continue;
          const v = line === 'SDA' ? extra.vsda : extra.vscl;
          if (v > 3.6 && vcc > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: สาย ${line} ถูกดึงขึ้นถึง ${v.toFixed(1)} V (ตัวต้านทานดึงขึ้นบนโมดูลต่อกับ VCC) — เกินขา GP${gp} ของ Pico ที่ทนได้ 3.3 V ให้ใช้ไฟเลี้ยงโมดูลจาก 3V3` });
          const role = gp % 2 === 0 ? 'SDA' : 'SCL';
          if (role !== line) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${line} ต่อกับ GP${gp} ซึ่งเป็น ${role} ของ I2C${(gp >> 1) & 1} — สลับสาย SDA/SCL หรือเลือกขาใหม่ (GP คู่ = SDA, GP คี่ = SCL)` });
        }
      }
      if ((st?.conflicts ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ที่อยู่ 0x${extra.addr.toString(16)} ซ้ำกับอุปกรณ์อื่นบนบัสเดียวกัน — บัดกรีจัมเปอร์ A0/A1 ให้ที่อยู่ต่างกัน` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'ssd1306' || part.kind === 'ds3231' || part.kind === 'mpu6050' || part.kind === 'lcd1602' || part.kind === 'bmp280' || part.kind === 'bh1750') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const st = result.i2c?.[part.id];
      const defAddr = part.kind === 'ssd1306' || part.kind === 'lcd1602' ? part.params.addr : part.kind === 'bmp280' ? 0x76 : part.kind === 'bh1750' ? 0x23 : 0x68;
      const extra: Record<string, number> = { vcc, vsda: nv('SDA') - g, vscl: nv('SCL') - g, powered: st?.powered ? 1 : 0, acks: st?.acks ?? 0, addr: st?.addr ?? defAddr, conflicts: st?.conflicts ?? 0 };
      if (part.kind === 'lcd1602') {
        extra.contrast = st?.powered ? charLcdContrast(vcc, part.params.contrast) : 0; extra.chars = st?.lcdChars ?? 0; extra.bl = st?.lcd?.backlight && part.params.blJumper ? 1 : 0; extra.on = st?.lcd?.displayOn ? 1 : 0; extra.dropped = st?.lcdDropped ?? 0; extra.lcdReads = st?.lcdReads ?? 0;
        if ((st?.lcdDropped ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ข้อมูล ${st!.lcdDropped} นิบเบิลถูกทิ้งเพราะส่งระหว่างที่จอยังประมวลผลคำสั่งก่อนหน้า (busy: ล้างจอ/กลับต้น 1.52 ms, คำสั่งอื่น 37 µs, หลังจ่ายไฟ 10 ms) — ใส่หน่วงเวลาหลังคำสั่ง หรืออ่าน busy flag ก่อนส่ง` });
      } else if (part.kind === 'bmp280') {
        extra.mode = st?.bmpMode ?? 0; extra.meas = st?.measurements ?? 0; extra.dataReads = st?.dataReads ?? 0; extra.temp = part.params.temperature; extra.press = part.params.pressure; extra.vsel = nv('SDO') - g;
      } else if (part.kind === 'bh1750') {
        extra.bhOn = st?.bhOn ? 1 : 0; extra.bhValue = st?.bhValue ?? 0; extra.bhReads = st?.bhReads ?? 0; extra.lux = part.params.lux; extra.vsel = nv('ADDR') - g; extra.bhMode = st?.bhMode ? 1 : 0;
      } else if (part.kind === 'ssd1306') {
        extra.on = st?.on && st?.pump ? 1 : 0; extra.dataBytes = st?.dataBytes ?? 0;
      } else if (part.kind === 'ds3231') {
        extra.clock = st?.clock ?? 0; extra.temp = part.params.temperature; extra.timeReads = st?.timeReads ?? 0;
      } else {
        extra.asleep = st ? (st.asleep ? 1 : 0) : 1; extra.steps = st?.steps ?? 0; extra.dataReads = st?.dataReads ?? 0; extra.vad0 = nv('AD0') - g;
      }
      const i = Math.abs(result.elements[`${part.id}#load`]?.current ?? 0);
      const reading: PartReading = { current: i, voltage: vcc, power: vcc * i, extra };
      const name = part.kind === 'ssd1306' ? 'จอ OLED' : part.kind === 'ds3231' ? 'DS3231' : part.kind === 'lcd1602' ? 'จอ LCD' : part.kind === 'bmp280' ? 'BMP280' : part.kind === 'bh1750' ? 'BH1750' : 'MPU6050';
      const wired = ['VCC', 'GND', 'SDA', 'SCL'].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VCC ต่ำกว่า GND) — ตรวจขา VCC/GND ของโมดูล` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V ของ${name}` }); }
      else if (wired && vcc < pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — ${name}ไม่ทำงาน ไม่ตอบบนบัส I²C (ต่อ VCC กับ 3V3 และ GND กับกราวด์ของบอร์ด)` });
      // สาย I²C ที่ต่อกับขา Pico: ตัวต้านทานดึงขึ้นไปไฟเลี้ยงโมดูล — ถ้าโมดูลใช้ 5 V สายจะสูงเกินขา Pico (ไม่ทน 5 V)
      for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${gp}`);
        for (const line of ['SDA', 'SCL'] as const) {
          if (gn === undefined || gn !== netOfPin(c, part.id, line)) continue;
          const v = line === 'SDA' ? extra.vsda : extra.vscl;
          // โมดูลที่ใช้ไฟ ≤ 3.6 V ไม่ใช่ต้นเหตุ (สายถูกดึงขึ้นโดยโมดูลอื่นที่ใช้ไฟสูงกว่า — โมดูลนั้นรายงานเอง)
          if (v > 3.6 && vcc > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: สาย ${line} ถูกดึงขึ้นถึง ${v.toFixed(1)} V (ตัวต้านทานดึงขึ้นบนโมดูลต่อกับ VCC) — เกินขา GP${gp} ของ Pico ที่ทนได้ 3.3 V ${part.kind === 'lcd1602' ? 'จอ LCD ต้องใช้ 5 V: ถอดตัวต้านทานดึงขึ้นบนบอร์ด I²C (แผงคุณสมบัติ) ให้ตัวดึงขึ้นของโมดูลอื่นที่ใช้ 3V3 ทำงานแทน หรือใช้ตัวแปลงระดับ' : 'ให้ใช้ไฟเลี้ยงโมดูลจาก 3V3'}` });
          const role = gp % 2 === 0 ? 'SDA' : 'SCL';
          if (role !== line) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${line} ต่อกับ GP${gp} ซึ่งเป็น ${role} ของ I2C${(gp >> 1) & 1} — สลับสาย SDA/SCL หรือเลือกขาใหม่ (GP คู่ = SDA, GP คี่ = SCL)` });
        }
      }
      if ((st?.conflicts ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ที่อยู่ 0x${extra.addr.toString(16)} ซ้ำกับอุปกรณ์อื่นบนบัสเดียวกัน — ทั้งสองตอบพร้อมกัน ค่าที่อ่านได้ผิด${part.kind === 'mpu6050' ? ' (ต่อ AD0 กับ 3V3 ให้ MPU6050 ใช้ 0x69)' : part.kind === 'ds3231' ? ' (MPU6050 ที่ AD0 ต่ำใช้ 0x68 เหมือน DS3231 — ต่อ AD0 ของ MPU6050 กับ 3V3)' : ''}` });
      if (part.kind === 'mpu6050' && st && st.asleep && st.acks > 2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: MPU6050 ยังอยู่ในโหมดหลับ (ค่าเริ่มต้นหลังจ่ายไฟ) อ่านค่าได้ 0 ทุกแกน — เขียน 0 ที่รีจิสเตอร์ 0x6B: i2c.writeto_mem(0x${extra.addr.toString(16)}, 0x6B, b'\\x00')` });
      if (part.kind === 'lcd1602' && st?.powered && vcc < 4.3) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V — จอ LCD ต้องการ ≈ 5 V ตัวอักษรจึงชัด (ที่ 3.3 V แทบมองไม่เห็นแม้ปรับทริมพอตสุด) ต่อ VCC กับ VBUS` });
      if (part.kind === 'lcd1602' && st?.powered && vcc >= 4.3 && (st.lcdChars ?? 0) > 0 && (extra.contrast < 0.25)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ตัวอักษรจาง — หมุนทริมพอตบนบอร์ด I²C เพิ่มความคมชัด` });
      if (part.kind === 'lcd1602' && st?.powered && (st.lcdWrites ?? 0) > 4 && !st.lcd?.displayOn && !st.lcd?.lines2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: จอยังไม่ได้ตั้งค่า (เห็นกล่องในแถวบน) — ตรวจที่อยู่ I²C (${'0x' + defAddr.toString(16)}) และลำดับเริ่มต้นของไลบรารี` });
      if (part.kind === 'bmp280' && st && (st.dataReads ?? 0) > 1 && (st.bmpMode ?? 0) !== 3 && (st.measurements ?? 0) === 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: BMP280 ยังอยู่ในโหมดหลับ (ค่าเริ่มหลังจ่ายไฟ) ค่าที่อ่านได้ = 0x80000 — เขียน ctrl_meas: i2c.writeto_mem(0x${extra.addr.toString(16)}, 0xF4, b'\\x27')` });
      if (part.kind === 'bh1750' && st && (st.bhReads ?? 0) > 1 && !st.bhMode && (st.bhValue ?? 0) === 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ยังไม่ได้สั่งวัด — ส่งคำสั่ง 0x10 (วัดต่อเนื่อง ละเอียด 1 lx): i2c.writeto(0x${extra.addr.toString(16)}, b'\\x10') แล้วรอ ≥ 120 ms` });
      if (part.kind === 'ssd1306' && st && st.on && !st.pump && (st.dataBytes ?? 0) > 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: สั่งเปิดจอแล้วแต่ไม่ได้เปิดปั๊มประจุ (คำสั่ง 0x8D 0x14) — โมดูลไม่มีไฟเลี้ยงแผงจากภายนอก จอจึงดับ` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'vibmotor') {
      const er = result.elements[part.id];
      const pr = part.params;
      const w = result.motorSpeeds?.[part.id] ?? 0;
      const i = er?.current ?? 0, v = er?.voltage ?? 0;
      const reading: PartReading = { current: i, voltage: v, power: v * i, extra: { w, rpm: (w * 60) / (2 * Math.PI), emf: pr.ke * w } };
      if (Math.abs(v) > pr.maxVoltage + 0.2) { reading.overRated = true; diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดัน ${Math.abs(v).toFixed(1)} V เกินช่วงใช้งาน 1.5–${pr.maxVoltage} V ของมอเตอร์สั่น — ใช้ไฟ 3.3 V` }); }
      for (const p of doc.parts) if (isPico(p)) for (const g of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${g}`);
        if (gn !== undefined && (gn === netOfPin(c, part.id, 'A') || gn === netOfPin(c, part.id, 'B'))) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ต่อตรงกับขา GP${g} ของ Pico — มอเตอร์สั่นกิน 50–90 mA เกินขา GPIO (≈ 12 mA) ขับผ่านทรานซิสเตอร์ + ไดโอดกันย้อน` });
      }
      const nA = netOfPin(c, part.id, 'A'), nB = netOfPin(c, part.id, 'B');
      const switched = doc.parts.some((p) => (p.kind === 'mosfet' && [nA, nB].includes(netOfPin(c, p.id, 'D'))) || (p.kind === 'bjt' && [nA, nB].includes(netOfPin(c, p.id, 'C'))));
      const flyback = doc.parts.some((p) => p.kind === 'diode' && [netOfPin(c, p.id, 'A'), netOfPin(c, p.id, 'K')].sort().join() === [nA, nB].sort().join());
      if (switched && !flyback) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขับด้วยทรานซิสเตอร์แต่ไม่มีไดโอดกันย้อนคร่อมมอเตอร์ — ขดลวดสร้างแรงดันกระชากตอนตัดกระแส` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'gc9a01' || part.kind === 'qmi8658') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const lcd = part.kind === 'gc9a01';
      const sda = lcd ? 'TP_SDA' : 'SDA', scl = lcd ? 'TP_SCL' : 'SCL';
      const st = result.i2c?.[lcd ? `${part.id}#tp` : part.id];
      const ls = lcd ? result.lcd?.[part.id] : undefined;
      const extra: Record<string, number> = { vcc, vsda: nv(sda) - g, vscl: nv(scl) - g, powered: st?.powered ? 1 : 0, acks: st?.acks ?? 0, addr: st?.addr ?? (lcd ? 0x15 : 0x6a), conflicts: st?.conflicts ?? 0 };
      if (lcd) {
        Object.assign(extra, { on: ls && ls.powered && ls.on && !ls.sleep ? 1 : 0, bl: ls?.bl ?? 0, bytes: ls?.bytes ?? 0, pixels: ls?.pixels ?? 0, inv: ls?.inv ? 1 : 0, madctl: ls?.madctl ?? 0,
          touches: st?.touches ?? 0, gestures: st?.gestures ?? 0, gesture: st?.gesture ?? 0, touchReads: st?.touchReads ?? 0, tpReset: st?.inReset ? 1 : 0, down: st?.down ? 1 : 0, tx: st?.x ?? 0, ty: st?.y ?? 0 });
      } else {
        Object.assign(extra, { aEn: st?.aEn ? 1 : 0, gEn: st?.gEn ? 1 : 0, steps: st?.steps ?? 0, dataReads: st?.dataReads ?? 0, autoInc: st?.autoInc ? 1 : 0, vsa0: nv('SA0') - g });
      }
      const i = Math.abs(result.elements[`${part.id}#load`]?.current ?? 0);
      const reading: PartReading = { current: i, voltage: vcc, power: vcc * i, extra };
      const name = lcd ? 'จอกลม' : 'QMI8658';
      const wired = ['VCC', 'GND', sda, scl].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VCC ต่ำกว่า GND) — ตรวจขา VCC/GND ของโมดูล` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V ของ${name}${lcd ? '' : ' (ชิปทนได้ 3.6 V — ต่อกับ 3V3 ไม่ใช่ VBUS/5 V)'}` }); }
      else if (wired && vcc < pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — ${name}ไม่ทำงาน (ต่อ VCC กับ 3V3 และ GND กับกราวด์ของบอร์ด)` });
      if (lcd && vcc > 4.2 && doc.parts.some((p) => isPico(p))) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยงโมดูล ${vcc.toFixed(1)} V แต่ลอจิกของ Pico เป็น 3.3 V — ผู้ผลิตโมดูลให้ใช้ไฟเลี้ยงระดับเดียวกับลอจิก ต่อ VCC กับ 3V3` });
      for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${gp}`);
        if (gn === undefined) continue;
        for (const [pin, line] of [[sda, 'SDA'], [scl, 'SCL']] as const) {
          if (gn !== netOfPin(c, part.id, pin)) continue;
          const v = line === 'SDA' ? extra.vsda : extra.vscl;
          if (v > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: สาย ${pin} ถูกดึงขึ้นถึง ${v.toFixed(1)} V — เกินขา GP${gp} ของ Pico ที่ทนได้ 3.3 V ให้ใช้ไฟเลี้ยงโมดูลจาก 3V3` });
          const role = gp % 2 === 0 ? 'SDA' : 'SCL';
          if (role !== line) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${pin} ต่อกับ GP${gp} ซึ่งเป็น ${role} ของ I2C${(gp >> 1) & 1} — สลับสาย SDA/SCL หรือเลือกขาใหม่ (GP คู่ = SDA, GP คี่ = SCL)` });
        }
        if (!lcd) continue;
        // SPI: SCLK/MOSI ต้องเป็นขา SCK/TX ของ SPI (GPn % 4 = 2 / 3)
        if (gn === netOfPin(c, part.id, 'SCLK') && gp % 4 !== 2) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: SCLK ต่อกับ GP${gp} ซึ่งไม่ใช่ขา SCK ของ SPI — ใช้ GP2/6/18 (SPI0) หรือ GP10/14 (SPI1)` });
        if (gn === netOfPin(c, part.id, 'MOSI') && gp % 4 !== 3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: MOSI ต่อกับ GP${gp} ซึ่งไม่ใช่ขา TX (MOSI) ของ SPI — ใช้ GP3/7/19 (SPI0) หรือ GP11/15 (SPI1)` });
      }
      if ((st?.conflicts ?? 0) > 0) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ที่อยู่ 0x${extra.addr.toString(16)} ซ้ำกับอุปกรณ์อื่นบนบัสเดียวกัน — ค่าที่อ่านได้ผิด` });
      if (lcd && ls?.powered) {
        if (ls.dcFloating) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา LCD_DC ไม่ได้ต่อกับขาของบอร์ด — จอแยกคำสั่งกับข้อมูลไม่ได้ ภาพไม่ขึ้น` });
        if (ls.dropped > 50 && ls.bytes === 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: มีข้อมูลบนสาย SPI แต่จอไม่รับ — ขา LCD_CS ต้องต่อกับขา GPIO ที่โค้ดดึงเป็นต่ำก่อนส่ง` });
        if (ls.bytes > 100 && ls.on && !ls.inv) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ยังไม่ได้ส่งคำสั่ง INVON (0x21) — จอ IPS นี้แสดงสีกลับ (ไดรเวอร์ gc9a01py ส่งให้แล้วในลำดับเริ่มต้น)` });
      }
      if (!lcd && st && !st.aEn && (st.dataReads ?? 0) > 2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: อ่านค่าความเร่งแต่ยังไม่ได้เปิดเซนเซอร์ — เขียน 0x01 ที่ CTRL7 (0x08): i2c.writeto_mem(0x${extra.addr.toString(16)}, 0x08, b'\\x01')` });
      if (!lcd && st && st.aEn && !st.autoInc && (st.dataReads ?? 0) > 2) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: CTRL1 (0x02) ยังไม่เปิดบิต ADDR_AI — อ่านหลายไบต์ต่อเนื่องจะได้รีจิสเตอร์เดิมซ้ำ (เขียน 0x40 ที่ 0x02)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'esp32s3lcd') {
      parts[part.id] = { current: 0, voltage: 0, power: 0, extra: {} };
      continue;
    }
    if (part.kind === 'esp32s2' || part.kind === 'bluepill' || part.kind === 'pico2' || part.kind === 'teensy41') {
      parts[part.id] = { current: 0, voltage: 0, power: 0, extra: {} };
      // มีอุปกรณ์อื่นหรือสายต่อเข้าขาของบอร์ดนี้ (ไม่นับขา G สองขาที่ต่อถึงกันภายในบอร์ดเอง)
      const anyWire = pinDefs(part).some((d) => {
        const net = netOfPin(c, part.id, d.name)!;
        return c.nets[net].partPins.some((pp) => pp.partId !== part.id) || doc.wires.some((w) => c.netOf.get(terminalKey(w.a)) === net || c.netOf.get(terminalKey(w.b)) === net);
      });
      if (anyWire) {
        const nm = part.kind === 'bluepill' ? 'STM32F103C8T6 Blue Pill' : part.kind === 'pico2' ? 'Raspberry Pi Pico 2' : part.kind === 'teensy41' ? 'Teensy 4.1' : 'ESP32-S2-DevKitM-1';
        const alt = part.kind === 'pico2' ? 'Raspberry Pi Pico (RP2040) ขาเหมือนกันทุกขา' : 'Raspberry Pi Pico หรือ Arduino';
        diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ${nm} เป็นโมเดลเท่านั้น — ยังไม่มีตัวจำลอง CPU ขาทุกขาไม่มีไฟและไม่ทำงาน (ใช้ ${alt} ทำโปรเจกต์ที่รันได้)` });
      }
      continue;
    }
    if (part.kind === 'motor') {
      const er = result.elements[part.id];
      const pr = part.params;
      const w = result.motorSpeeds?.[part.id] ?? 0;
      const i = er?.current ?? 0, v = er?.voltage ?? 0;
      const rpm = motorRpm(w, pr.gearRatio);
      const tq = pr.ke * i * pr.gearRatio * pr.gearEff; // แรงบิดที่แกนออก (N·m)
      const reading: PartReading = { current: i, voltage: v, power: v * i, extra: {
        w, rpm, motorRpm: (w * 60) / (2 * Math.PI), emf: pr.ke * w, torque: tq, angle: result.motorAngles?.[part.id] ?? 0, stalled: Math.abs(w) < 1 && Math.abs(i) > 0.3 ? 1 : 0,
      } };
      if (Math.abs(v) > 6.5) { reading.overRated = true; diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดัน ${Math.abs(v).toFixed(1)} V เกินพิกัด 3–6 V ของมอเตอร์ TT — ร้อนและแปรงถ่านสึกเร็ว` }); }
      if (reading.extra!.stalled) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: มอเตอร์หยุดค้าง (ล้อไม่หมุน) กินกระแส ${fmtA(Math.abs(i))} — ขดลวดร้อน ลดโหลดหรือตัดไฟ` });
      // ต่อขา GPIO ของ Pico ตรงกับมอเตอร์
      for (const p of doc.parts) if (isPico(p)) for (const g of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${g}`);
        if (gn !== undefined && (gn === netOfPin(c, part.id, 'A') || gn === netOfPin(c, part.id, 'B'))) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ต่อตรงกับขา GP${g} ของ Pico — ขา GPIO จ่ายได้ราว 12 mA แต่มอเตอร์กิน 150 mA–1.5 A ต้องใช้วงจรขับ (มอสเฟต/ทรานซิสเตอร์ + ไดโอดกันย้อน)` });
      }
      // ขับด้วยสวิตช์อิเล็กทรอนิกส์แต่ไม่มีไดโอดคร่อมมอเตอร์
      const nA = netOfPin(c, part.id, 'A'), nB = netOfPin(c, part.id, 'B');
      const switched = doc.parts.some((p) => (p.kind === 'mosfet' && [nA, nB].includes(netOfPin(c, p.id, 'D'))) || (p.kind === 'bjt' && [nA, nB].includes(netOfPin(c, p.id, 'C'))) || (p.kind === 'darlington' && [nA, nB].includes(netOfPin(c, p.id, 'C'))));
      const flyback = doc.parts.some((p) => p.kind === 'diode' && [netOfPin(c, p.id, 'A'), netOfPin(c, p.id, 'K')].sort().join() === [nA, nB].sort().join());
      if (switched && !flyback) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขับด้วยทรานซิสเตอร์/มอสเฟตแต่ไม่มีไดโอดกันย้อนคร่อมมอเตอร์ — ตอนตัดกระแส ขดลวดสร้างแรงดันกระชากสูง (แคโทดไปด้านไฟบวก)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'stepper') {
      const tn = tones?.[part.id];
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('G'), vcc = nv('V') - g;
      const extra: Record<string, number> = { vcc, pos: tn?.pos ?? 0, angle: ((tn?.pos ?? 0) * 360) / pr.stepsPerRev, stepRate: tn?.stepRate ?? 0, rpm: tn?.rpm ?? 0, missed: tn?.missed ?? 0, lastStep: tn?.lastStep ?? 0, mask: tn?.mask ?? 0, holding: tn?.holding ?? 0,
        posMax: tn?.posMax ?? 0, posMin: tn?.posMin ?? 0, fwd: tn?.fwd ?? 0, rev: tn?.rev ?? 0 };
      let itot = 0, vsatMax = 0;
      for (let k = 1; k <= 4; k++) {
        const ic = Math.abs(result.elements[`${part.id}#c${k}`]?.current ?? 0), il = Math.abs(result.elements[`${part.id}#led${k}`]?.current ?? 0);
        extra[`ic${k}`] = ic; extra[`iled${k}`] = il; extra[`vin${k}`] = nv(`IN${k}`) - g;
        itot += ic + il;
        if (ic > 0.02) vsatMax = Math.max(vsatMax, vcc - Math.abs(result.elements[`${part.id}#c${k}`]?.voltage ?? 0));
      }
      extra.itot = itot; extra.vsat = vsatMax;
      if (!tn) extra.mask = [1, 2, 3, 4].reduce((m, k) => m | (extra[`ic${k}`] >= pr.minCoilCurrent ? 1 << (k - 1) : 0), 0);
      const reading: PartReading = { current: itot, voltage: vcc, power: vcc * itot, extra };
      const used = STEPPER_INPUTS.some((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา + ต่อ 5 V, ขา − ต่อกราวด์ (ไดโอดในไอซีจะนำกระแสสูง)` }); }
      else if (vcc > 12.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกิน — มอเตอร์ 28BYJ-48 รุ่นนี้พิกัด 5 V (ขดลวดร้อนเกิน)` }); }
      else if (vcc > pr.vRated * 1.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V สูงกว่าพิกัดมอเตอร์ ${pr.vRated} V — ขดลวดกินกระแสและร้อนมากขึ้น (บอร์ดรับได้ 5–12 V แต่ต้องใช้มอเตอร์รุ่น 12 V)` });
      else if (used && vcc < 4) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำ — กระแสขดลวดไม่พอดึงโรเตอร์ ใช้ VBUS (5 V) ของ Pico ไม่ใช่ 3V3` });
      // ใช้เฟสที่มีไฟ ณ ขณะนี้ (ค่ากระแสในแผงเป็นค่าเฉลี่ยช่วงวัด ขณะสเต็ปเร็วจะเห็นทุกเฟสมีกระแสบ้าง)
      const on = [1, 2, 3, 4].filter((k) => extra.mask & (1 << (k - 1)));
      if (on.length > 2) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: มีไฟพร้อมกัน ${on.length} เฟส (IN${on.join(', IN')}) — ไม่ใช่ลำดับสเต็ป แรงดึงหักล้างกัน กินกระแสมาก` });
      if (on.length === 2 && (extra.mask === 0b0101 || extra.mask === 0b1010)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: เฟสตรงข้ามกันมีไฟพร้อมกัน (IN${on.join(' และ IN')}) — สนามหักล้างกัน โรเตอร์ไม่หมุน ตรวจลำดับสเต็ป` });
      if ((tn?.missed ?? 0) > 0) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: หลุดสเต็ปแล้ว ${tn!.missed} ครั้ง — สเต็ปถี่เกิน (ออกตัวได้ ≤ ${Math.round(stepperLimit(pr.pullIn, pr.shaftLoad ?? 0))} ครั้ง/วินาที หมุนต่อเนื่อง ≤ ${Math.round(stepperLimit(pr.pullOut, pr.shaftLoad ?? 0))}${(pr.shaftLoad ?? 0) > 0 ? ` ที่แรงบิดโหลด ${pr.shaftLoad} mN·m` : ''}) หรือลำดับเฟสข้าม เพิ่มดีเลย์ระหว่างสเต็ป (เช่น 2 ms)${stepperLimit(pr.pullIn, pr.shaftLoad ?? 0) <= 0 ? ' — แรงบิดโหลดเกินแรงบิดของมอเตอร์ หมุนไม่ได้' : ''}` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'servohub') {
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const v = nv('V+') - nv('GND');
      const iled = result.elements[`${part.id}#led`]?.current ?? 0;
      parts[part.id] = { current: iled, voltage: v, power: v * iled, extra: { vcc: v, iled } };
      if (v < -0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเข้ากลับขั้ว (V+ ต่ำกว่า GND ${(-v).toFixed(1)} V) — ตัวเก็บประจุอิเล็กโทรไลต์บนแผ่นอาจเสียหาย และเซอร์โวได้ไฟกลับขั้ว (แบบจำลองการสอน)` });
      else if (v > part.params.capRating) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเข้า ${v.toFixed(1)} V เกินพิกัดตัวเก็บประจุ ${part.params.capRating} V (แบบจำลองการสอน)` });
      continue;
    }
    if (part.kind === 'servo') {
      const tn = tones?.[part.id];
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('V') - g, vsig = nv('SIG') - g;
      const iq = result.elements[`${part.id}#q`]?.current ?? 0;
      const im = result.elements[`${part.id}#m`]?.current ?? 0;
      const reading: PartReading = { current: iq + im, voltage: vcc, power: vcc * (iq + im), extra: {
        angle: tn?.angle ?? 90, target: tn?.target ?? 90, pw: tn?.pw ?? 0, period: tn?.period ?? 0, moving: tn?.moving ?? 0, vcc, vsig, imotor: im, stalled: tn?.stalled ?? 0,
      } };
      if (tn?.stalled) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงบิดโหลด ${pr.loadTorque ?? 0} kgf·cm เกินแรงบิดหยุดหมุน (${((pr.stallTorque ?? 1.8) * Math.min(vcc, pr.vMax) / 4.8).toFixed(2)} kgf·cm ที่ ${vcc.toFixed(1)} V) — แขนไม่หมุน มอเตอร์กินกระแสหยุดหมุนค้าง (มอเตอร์/เฟืองของจริงร้อนและเสียหายได้)` });
      if (vcc < -0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — สายแดง (+) ต่อไฟบวก สายน้ำตาลต่อกราวด์` });
      else if (vcc > pr.vMax + 0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินช่วง ${pr.vMin}–${pr.vMax} V` }); }
      else if (vcc > 0.5 && vcc < pr.vMin) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — เซอร์โวไม่หมุน/สั่น · Pico ใช้ขา VBUS (5 V) ไม่ใช่ 3V3` });
      const per = tn?.period ?? 0, pw = tn?.pw ?? 0;
      if (per > 0 && (per < 0.01 || per > 0.03)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: คาบสัญญาณ ${(per * 1000).toFixed(1)} ms — เซอร์โวมาตรฐานใช้ 20 ms (PWM 50 Hz: p.freq(50))` });
      if (pw > 0 && (pw < pr.pulseMin - 1e-5 || pw > pr.pulseMax + 1e-5)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: พัลส์ ${(pw * 1000).toFixed(2)} ms นอกช่วง ${(pr.pulseMin * 1000).toFixed(1)}–${(pr.pulseMax * 1000).toFixed(1)} ms — แขนชนปลายที่ ${pw < pr.pulseMin ? 0 : 180}° (ของจริงเฟืองอาจเสียหายถ้าดันค้าง)` });
      if (tn?.moving && vcc >= pr.vMin) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: กำลังหมุน — กระแสมอเตอร์${im > 0 ? ` ${fmtA(im)}` : ''} (แบบจำลอง: ช่วงเริ่ม 20 ms ≈ ${fmtA(pr.startCurrent ?? 0.5)}, หมุนต่อ ≈ ${fmtA(pr.runCurrent ?? 0.2)} — ค่าประมาณ ของจริงขึ้นกับภาระ) ควรจ่ายไฟจาก 5 V ที่จ่ายกระแสได้พอ` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'transformer') {
      const ea = result.elements[`${part.id}#a`], eb = result.elements[`${part.id}#b`];
      const tn = tones?.[part.id];
      const pr = part.params;
      const m = transformerModel(pr);
      const ready = !!tn && (tn.idc ?? 0) >= RMS_WINDOW * 0.9; // idc เก็บช่วงเวลาที่ใช้คำนวณ
      const reading: PartReading = { current: ea?.current ?? 0, voltage: (ea?.voltage ?? 0) + (eb?.voltage ?? 0), power: 0, extra: {
        on: pr.on ? 1 : 0, ready: ready ? 1 : 0, vA: ea?.voltage ?? 0, vB: eb?.voltage ?? 0, iA: ea?.current ?? 0, iB: eb?.current ?? 0,
        vrmsA: tn?.vrmsA ?? 0, vrmsB: tn?.vrmsB ?? 0, irmsA: tn?.irmsA ?? 0, irmsB: tn?.irmsB ?? 0, ipk: tn?.ipk ?? 0, vnl: m.vnl, vpk: m.vpk,
      } };
      const va = (tn?.vrmsA ?? 0) * (tn?.irmsA ?? 0) + (tn?.vrmsB ?? 0) * (tn?.irmsB ?? 0);
      reading.extra!.va = va;
      reading.power = va;
      const irms = Math.max(tn?.irmsA ?? 0, tn?.irmsB ?? 0);
      if (ready && irms > pr.iRated * 1.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสขดทุติยภูมิ ${fmtA(irms)} rms เกินพิกัด ${fmtA(pr.iRated)} มาก — ขดลวดร้อนจัด ฟิวส์ด้านไฟบ้านควรขาด (ตรวจการลัดวงจร)` }); }
      else if (ready && irms > pr.iRated) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสขดทุติยภูมิ ${fmtA(irms)} rms เกินพิกัด ${fmtA(pr.iRated)} — หม้อแปลงร้อนกว่าปกติ (วงจรเรียงกระแส + ตัวเก็บประจุกินกระแสยอดสูง ควรเลือกพิกัดกระแส ≈ 1.8 เท่าของกระแสโหลด DC)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'vreg') {
      const amp = result.elements[`${part.id}#amp`], ro = result.elements[`${part.id}#ro`];
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vin = nv('IN') - g, vout = nv('OUT') - g;
      const iout = ro?.current ?? 0;
      const ia = amp?.current ?? 0, iq = (result.elements[`${part.id}#iq`]?.current ?? 0) + (amp?.extra?.iq ?? 0);
      const iin = Math.max(ia, 0) + iq;
      const pr = part.params;
      const pd = Math.max(0, vin * iin - vout * iout);
      const rth = vregThermalResistance(pr.heatsink);
      const tj = 25 + pd * rth;
      const regulating = vin - pr.vout >= pr.dropout && Math.abs(vout - pr.vout) < 0.15;
      const reading: PartReading = { current: iout, voltage: vout, power: pd, extra: { vin, vout, iin, iout, iq, pd, tj, rth, regulating: regulating ? 1 : 0, headroom: vin - vout } };
      if (vin < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขาเข้ากลับขั้ว (IN ต่ำกว่า GND) — ตรวจขา 1 IN และขา 2 GND (ของจริงอาจเสียหาย)` });
      else if (vin > pr.maxInput) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันขาเข้า ${vin.toFixed(1)} V เกินพิกัด ${pr.maxInput} V` }); }
      else if (vin > 1 && vin - pr.vout < pr.dropout) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${vin.toFixed(2)} V ต่ำกว่า ${(pr.vout + pr.dropout).toFixed(0)} V (ขาออก ${pr.vout} V + dropout ${pr.dropout} V) — ไม่คงแรงดัน ขาออกตกเหลือ ≈ IN − ${pr.dropout} V` });
      if (vout > vin + 0.5 && vout > 1) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาออกสูงกว่าขาเข้า — ของจริงกระแสไหลย้อนผ่านไอซีได้ ควรต่อไดโอดป้องกันจาก OUT ไป IN` });
      if (iout > pr.maxLoad) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสขาออก ${fmtA(iout)} เกิน ${fmtA(pr.maxLoad)} — ไอซีจริงจะจำกัดกระแส/ตัดการทำงาน (แบบจำลองไม่จำกัดกระแส)` }); }
      if (tj > 125) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W → อุณหภูมิรอยต่อประมาณ ${tj.toFixed(0)} °C เกิน 125 °C — ไอซีจริงจะตัดการทำงานเพราะร้อนเกิน${pr.heatsink ? ' (ลดแรงดันขาเข้าหรือกระแส)' : ' ต้องติดแผ่นระบายความร้อน'}` }); }
      else if (tj > 85) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W → ประมาณ ${tj.toFixed(0)} °C ร้อนจนแตะไม่ได้${pr.heatsink ? '' : ' — ควรติดแผ่นระบายความร้อน'}` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'lm317') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      // ไม่มีขากราวด์: อ่านแรงดันเทียบกับขั้วลบแหล่งจ่าย (หรือกราวด์ของวงจรที่พบก่อน)
      const gref = (() => { for (const [k, pin] of [['dcsupply', 'neg'], ['vreg', 'GND'], ['pico', 'GND'], ['scope', 'GND'], ['transformer', 'CT']] as const) for (const q of doc.parts) if (q.kind === k) { const id = netOfPin(c, q.id, pin); if (id !== undefined && id !== null) { const v = result.nodeVoltage[id]; if (typeof v === 'number') return v; } } return nv('ADJ') - 0; })();
      const vin = nv('IN') - gref, vout = nv('OUT') - gref, vadj = nv('ADJ') - gref;
      const iamp = Math.max(0, result.elements[`${part.id}#ro`]?.current ?? 0);
      const iq = Math.max(0, result.elements[`${part.id}#iq`]?.current ?? 0), iadj = Math.max(0, result.elements[`${part.id}#ia`]?.current ?? 0);
      const iout = iamp + iq; // กระแสที่ไหลออกขา OUT (รวมกระแสผ่าน R1)
      const iin = iout + iadj;
      const vref = vout - vadj, headroom = vin - vout;
      const pd = Math.max(0, headroom * iout + (vin - vadj) * iadj);
      const rth = vregThermalResistance(pr.heatsink);
      const tj = 25 + pd * rth;
      const lowLoad = iamp < 1e-5 && vref > pr.vref + 0.05; // วงจรภายนอกรับกระแสนิ่งไม่หมด → แรงดันขาออกสูงเกิน
      const regulating = headroom >= pr.dropout - 0.05 && Math.abs(vref - pr.vref) < 0.03 && !lowLoad;
      const reading: PartReading = { current: iout, voltage: vout, power: pd, extra: { vin, vout, vadj, vref, headroom, iout, iin, iq, iadj, pd, tj, rth, regulating: regulating ? 1 : 0, lowLoad: lowLoad ? 1 : 0 } };
      if (vin < -0.3 || (vin < vout - 0.5 && vout > 1)) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาออกสูงกว่าขาเข้า (หรือขาเข้ากลับขั้ว) — ตรวจว่าขา 3 (ขวา) คือ IN ขา 2 (กลาง) คือ OUT · ของจริงควรต่อไดโอดป้องกันจาก OUT ไป IN` });
      else if (headroom > pr.maxDiff) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: IN − OUT = ${headroom.toFixed(1)} V เกินพิกัด ${pr.maxDiff} V` }); }
      else if (vin > 1.5 && vadj > vout + 0.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ADJ ลอยหรือต่อผิด (ADJ สูงกว่า OUT) — ต่อ R1 จาก OUT ไป ADJ และ R2 จาก ADJ ลงกราวด์` });
      else if (vin > 1.5 && headroom < pr.dropout - 0.05) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: IN − OUT = ${headroom.toFixed(2)} V ต่ำกว่า dropout ≈ ${pr.dropout} V — ไม่คงแรงดัน ขาออกตกตามขาเข้า (เอกสารแนะนำให้ขาเข้าสูงกว่าขาออก ≥ 3 V)` });
      else if (vin > 1.5 && headroom < 3 && !lowLoad) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: IN − OUT = ${headroom.toFixed(2)} V ยังคงแรงดันได้ แต่เอกสารรับรองค่าที่ ≥ 3 V` });
      if (lowLoad) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสออกจากขา OUT ต่ำกว่ากระแสโหลดต่ำสุด ${fmtA(pr.minLoad)} — แรงดันขาออกสูงเกินค่าที่คำนวณ (OUT − ADJ = ${vref.toFixed(2)} V) · ใช้ R1 ≤ 240 Ω (1.25 V / 240 Ω ≈ 5.2 mA ไหลผ่านตลอด) หรือเพิ่มโหลด` });
      if (iout > pr.maxLoad) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสขาออก ${fmtA(iout)} เกิน ${fmtA(pr.maxLoad)} — ไอซีจริงจะจำกัดกระแส (≈ 2.2 A) (แบบจำลองไม่จำกัดกระแส)` }); }
      if (tj > 125) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W → อุณหภูมิรอยต่อประมาณ ${tj.toFixed(0)} °C เกิน 125 °C — ไอซีจริงจะตัดการทำงานเพราะร้อนเกิน${pr.heatsink ? ' (ลดแรงดันขาเข้าหรือกระแส)' : ' ต้องติดแผ่นระบายความร้อน'}` }); }
      else if (tj > 85) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${pd.toFixed(2)} W → ประมาณ ${tj.toFixed(0)} °C ร้อนจนแตะไม่ได้${pr.heatsink ? '' : ' — ควรติดแผ่นระบายความร้อน'}` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'timer555') {
      const q = !!result.relayStates?.[part.id];
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g;
      const oh = result.elements[`${part.id}#oh`], ol = result.elements[`${part.id}#ol`], dis = result.elements[`${part.id}#dis`];
      // กระแสขาออก: + = จ่ายออก (HIGH), − = รับเข้า (LOW)
      const iout = q ? (oh?.current ?? 0) : -(ol?.current ?? 0);
      const idis = dis?.current ?? 0;
      const tn = tones?.[part.id];
      const pr = part.params;
      const ast = detectAstable(doc, c, part.id);
      const th = ast && ast.c > 0 && ast.ra + 2 * ast.rb > 0 ? astable555(ast.ra, ast.rb, ast.c) : null;
      const reading: PartReading = { current: iout, voltage: nv('OUT') - g, power: 0, extra: {
        fth: th?.f ?? 0, dth: th?.duty ?? 0, ra: ast?.ra ?? 0, rb: ast?.rb ?? 0, ct: ast?.c ?? 0,
        q: q ? 1 : 0, vcc, vout: nv('OUT') - g, vthr: nv('THR') - g, vtrig: nv('TRIG') - g, vctl: nv('CTRL') - g, vrst: nv('RESET') - g,
        iout, idis, freq: tn?.freq ?? 0, duty: tn?.duty ?? 0, tHigh: tn?.tHigh ?? 0, tLow: tn?.tLow ?? 0,
      } };
      reading.power = Math.abs(iout) * Math.abs(q ? vcc - (nv('OUT') - g) : nv('OUT') - g) + (vcc > 0 ? (vcc * vcc) / pr.quiescentResistance : 0);
      if (vcc < -0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ขา 8 (VCC) ต้องต่อไฟบวก ขา 1 (GND) ต่อลบ` });
      else if (vcc > pr.maxSupply) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.maxSupply} V ของ NE555` }); }
      else if (vcc > 0.5 && vcc < pr.minSupply) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่าช่วงใช้งาน ${pr.minSupply}–${pr.maxSupply} V${vcc < 3 ? ' — ไอซีไม่ทำงาน ขาออก LOW' : ' — อาจทำงานไม่แน่นอน'} (รุ่น CMOS เช่น TLC555 ใช้ไฟต่ำกว่านี้ได้)` });
      if (Math.abs(iout) > pr.maxOutputCurrent) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสขาออก ${fmtA(Math.abs(iout))} เกิน ${fmtA(pr.maxOutputCurrent)} — ใส่ตัวต้านทานจำกัดกระแสหรือใช้ทรานซิสเตอร์ขับโหลด` }); }
      if (idis > 0.05) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสขาคายประจุ (DIS) ${fmtA(idis)} สูง — RA ระหว่าง VCC กับขา 7 ควร ≥ 1 kΩ` });
      const rstNet = c.nets[netOfPin(c, part.id, 'RESET')!];
      if (vcc >= 3 && rstNet.partPins.length > 1 && nv('RESET') - g < 0.7) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา 4 RESET ต่ำกว่า 0.7 V — ไอซีถูกรีเซ็ต ขาออก LOW ตลอด (ปกติต่อ RESET เข้า VCC)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'relay') {
      const on = !!result.relayStates?.[part.id];
      const coil = result.elements[`${part.id}#coil`], led = result.elements[`${part.id}#led`];
      const contact = result.elements[`${part.id}#${on ? 'no' : 'nc'}`];
      const nV = netOfPin(c, part.id, 'V')!, nG = netOfPin(c, part.id, 'G')!, nS = netOfPin(c, part.id, 'S')!;
      const vv = (a: number, b: number) => { const x = result.nodeVoltage[a], y = result.nodeVoltage[b]; return typeof x === 'number' && typeof y === 'number' ? x - y : 0; };
      const vcc = vv(nV, nG), vs = vv(nS, nG);
      const ic = Math.abs(contact?.current ?? 0);
      const reading: PartReading = { current: coil?.current ?? 0, voltage: coil?.voltage ?? 0, power: (coil?.power ?? 0), extra: { energized: on ? 1 : 0, vcc, vs, icoil: coil?.current ?? 0, vcoil: coil?.voltage ?? 0, iled: led?.current ?? 0, icontact: ic } };
      if (vs > 1.5 && !on && vcc < part.params.vPick + 0.3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: สั่ง S = HIGH แล้วแต่รีเลย์ไม่ดึง — ไฟเลี้ยงโมดูล (+ เทียบ −) ${vcc.toFixed(2)} V ต่ำเกินไป ต้องการ 5 V (ขดลวดดึงที่ ≥ ${part.params.vPick} V) · Pico ใช้ขา VBUS (5 V จาก USB) ไม่ใช่ 3V3` });
      if (vcc < -0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงโมดูลกลับขั้ว (+ ต่ำกว่า −) — ตรวจขา + และ −` });
      if (ic > part.params.contactRating) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสผ่านหน้าสัมผัส ${fmtA(ic)} เกินพิกัด ${part.params.contactRating} A ${'(แบบจำลองการสอน)'}` }); }
      if (vs > 6) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดันขา S ${vs.toFixed(1)} V สูงกว่าไฟเลี้ยงโมดูล — ใช้สัญญาณ 3.3–5 V` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'rgbled') {
      const extra: Record<string, number> = {};
      let total = 0, power = 0, worst = 0, worstCh = '', rev = 0;
      for (const ch of RGB_CH) {
        const e = result.elements[`${part.id}#${ch}`];
        const i = e?.current ?? 0;
        extra[`i_${ch}`] = i;
        extra[`b_${ch}`] = ledBrightness(i, part.params.ratedCurrent);
        total += Math.max(0, i);
        power += e?.power ?? 0;
        if (i > worst) { worst = i; worstCh = ch; }
        rev = Math.max(rev, -(e?.voltage ?? 0));
      }
      const reading: PartReading = { current: total, voltage: 0, power, extra, brightness: Math.max(extra.b_R, extra.b_G, extra.b_B) };
      const th = { R: 'แดง', G: 'เขียว', B: 'น้ำเงิน' } as Record<string, string>;
      if (worst > part.params.maxCurrent) {
        reading.overRated = true;
        diags.push({ severity: worst > part.params.maxCurrent * 1.5 ? 'danger' : 'warn', partId: part.id, message: `${part.label}: สี${th[worstCh]} (ขา ${worstCh}) กระแส ${fmtA(worst)} เกินพิกัด ${fmtA(part.params.maxCurrent)} — ใส่ตัวต้านทานจำกัดกระแสแยกทุกสี (แบบจำลองการสอน)` });
      }
      if (rev > part.params.maxReverseVoltage) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันย้อนคร่อมสีหนึ่ง ${rev.toFixed(1)} V เกิน ${part.params.maxReverseVoltage} V — ตรวจชนิด (แคโทดร่วม/แอโนดร่วม) และการต่อขาร่วม` });
      else if (rev > 1.5 && total < 1e-4) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ทุกสีถูกไบแอสกลับ — แคโทดร่วมต้องต่อขาร่วม (ขายาว) ลงลบ, แอโนดร่วมต่อขาร่วมขึ้นบวก (เลือกชนิดในแผงคุณสมบัติ)` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'sevenseg') {
      const extra: Record<string, number> = {};
      const lit: Record<string, boolean> = {};
      let total = 0, power = 0, worst = 0, worstSeg = '', rev = 0;
      for (const s of SEG_NAMES) {
        const e = result.elements[`${part.id}#${s}`];
        const i = e?.current ?? 0;
        extra[`i_${s}`] = i;
        const b = ledBrightness(i, part.params.ratedCurrent);
        extra[`b_${s}`] = b;
        lit[s] = b > 0.1; // ≈ 0.1 mA ขึ้นไปจึงเห็นว่าติด
        total += Math.max(0, i);
        power += e?.power ?? 0;
        if (i > worst) { worst = i; worstSeg = s; }
        rev = Math.max(rev, -(e?.voltage ?? 0));
      }
      const ch = decodeSegments(lit);
      extra.digit = ch === null ? -1 : ch.charCodeAt(0);
      extra.dp = lit.dp ? 1 : 0;
      const reading: PartReading = { current: total, voltage: 0, power, extra };
      if (worst > part.params.maxCurrent) {
        reading.overRated = true;
        diags.push({ severity: worst > part.params.maxCurrent * 1.5 ? 'danger' : 'warn', partId: part.id, message: `${part.label}: ส่วน ${worstSeg.toUpperCase()} กระแส ${fmtA(worst)} เกินพิกัด ${fmtA(part.params.maxCurrent)} — ใส่ตัวต้านทานจำกัดกระแสให้แต่ละส่วน (แบบจำลองการสอน)` });
      }
      if (rev > part.params.maxReverseVoltage) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันย้อนคร่อมส่วนหนึ่ง ${rev.toFixed(1)} V เกิน ${part.params.maxReverseVoltage} V — ตรวจชนิด (แคโทดร่วม/แอโนดร่วม) และการต่อขาร่วม` });
      else if (rev > 1.5 && total < 1e-4) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ทุกส่วนถูกไบแอสกลับ — ถ้าใช้ตัวแอโนดร่วม (5161BS) ขาร่วมต้องต่อไฟบวก, แคโทดร่วม (5161AS) ต่อลบ` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'buzzer') {
      const er = result.elements[part.id];
      const tn = tones?.[part.id];
      const reading: PartReading = er ? { current: er.current, voltage: er.voltage, power: er.power } : { current: 0, voltage: 0, power: 0 };
      const b = buzzerSound(part, reading.current, reading.voltage, tn);
      reading.extra = { sounding: b.on ? 1 : 0, freq: b.freq ?? 0, level: b.level, iac: tn?.iac ?? 0, idc: tn?.idc ?? reading.current };
      const p = part.params;
      if (p.type === 'active') {
        if (reading.voltage < -0.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ต่อกลับขั้ว (ขา + ต้องอยู่ฝั่งไฟบวก) — บัซเซอร์แบบมีวงจรในตัวจะไม่ดัง` });
        else if (reading.voltage > 1.5 && reading.voltage < 3.0 && !tn?.freq) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: แรงดัน ${reading.voltage.toFixed(2)} V ต่ำกว่าช่วงทำงาน (4–8 V) — ดังเบามากหรือไม่ดัง` });
        if (reading.voltage > 8.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดัน ${reading.voltage.toFixed(1)} V เกินช่วงทำงาน 4–8 V (แบบจำลองการสอน)` });
      } else {
        const ion = Math.max(Math.abs(reading.current), (tn?.idc ?? 0) + (tn?.iac ?? 0));
        if (!b.on && Math.abs(reading.current) > 5e-3 && !(tn && tn.iac > 1e-3)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: บัซเซอร์แบบไม่มีวงจรในตัว (passive) ป้อนไฟตรงจะไม่ดัง (ดังแกร๊กแค่ตอนต่อ) — ต้องป้อนคลื่นสี่เหลี่ยมหรือ PWM เช่น 2 kHz` });
        if (ion > p.ratedCurrent * 2.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสขดลวด ${fmtA(ion)} สูงกว่าพิกัด ${fmtA(p.ratedCurrent)} มาก — ขดลวดร้อน ควรมีตัวต้านทานอนุกรมหรือลดแรงดัน` });
      }
      parts[part.id] = reading;
      continue;
    }
    if (isSensor(part)) {
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const m33 = mcu3v3Pins(doc, (p) => pinDefs(p).map((d) => d.name));
      parts[part.id] = measureSensor(part, {
        v: nv,
        linked: (pin) => { const nn = netOfPin(c, part.id, pin); return nn !== undefined && netLinked(c, doc, nn); },
        el: (id) => result.elements[id],
        comp: (id) => !!result.relayStates?.[id],
        mcu3v3: (pin) => { const nn = netOfPin(c, part.id, pin); return nn === undefined ? [] : m33.filter((m) => netOfPin(c, m.partId, m.pin) === nn).map((m) => `${m.label} ${m.pin}`); },
      }, diags);
      continue;
    }
    if (part.kind === 'pir' || part.kind === 'irobstacle') {
      const pr = part.params;
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND'), vcc = nv('VCC') - g, vout = nv('OUT') - g;
      const iq = Math.abs(result.elements[`${part.id}#load`]?.current ?? 0);
      const extra: Record<string, number> = { vcc, vout };
      if (part.kind === 'pir') {
        const ps = result.pirs?.[part.id];
        Object.assign(extra, { high: ps?.high ?? 0, triggers: ps?.triggers ?? 0, powered: ps?.powered ?? 0, remain: ps?.remain ?? 0, motion: part.params.motion ? 1 : 0, inView: pirInView(part.params) ? 1 : 0 });
        if (part.params.motion && !pirInView(part.params)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: มีการเคลื่อนไหวแต่อยู่นอกระยะ/มุมตรวจจับ (${part.params.distance ?? 2} m, ${part.params.angle ?? 0}° — ระยะที่ตั้ง ${part.params.senseRange ?? 7} m, กรวย ${PIR_CONE}°) — ไม่ตรวจพบ` });
        if (part.params.warmup && ps?.powered && (ps.since ?? 0) < PIR_WARMUP) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ช่วงเริ่มต้นหลังจ่ายไฟ (${(ps.since ?? 0).toFixed(0)}/${PIR_WARMUP} s) — ยังตรวจจับไม่ได้จริงและอาจให้สัญญาณหลอก` });
      } else Object.assign(extra, { detected: irDetected(part.params) && vcc >= part.params.vMin ? 1 : 0, range: irRange(part.params), distance: part.params.distance });
      const reading: PartReading = { current: iq, voltage: vcc, power: vcc * iq, extra };
      const wired = ['VCC', 'GND', 'OUT'].every((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      if (vcc < -0.5) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ตรวจขา VCC/GND` }); }
      else if (vcc > pr.vMax + 0.3) { reading.overRated = true; diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vcc.toFixed(1)} V เกินพิกัด ${pr.vMax} V` }); }
      else if (wired && vcc < pr.vMin - 0.1) diags.push({ severity: 'warn', partId: part.id, message: part.kind === 'pir' ? `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า 4.5 V — HC-SR501 ไม่ทำงาน (เรกูเลเตอร์ในโมดูลต้องการ ≥ 4.5 V) ต่อ VCC กับ VBUS 5 V` : `${part.label}: ไฟเลี้ยง ${vcc.toFixed(2)} V ต่ำกว่า ${pr.vMin} V — โมดูลไม่ทำงาน` });
      // ขาออกที่ต่อกับขา Pico: FC-51 ดึงขึ้นไป VCC — ถ้าใช้ 5 V สายจะสูงเกินขา Pico
      if (part.kind === 'irobstacle') for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        if (netOfPin(c, p.id, `GP${gp}`) === netOfPin(c, part.id, 'OUT') && vout > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา OUT ถูกดึงขึ้นถึง ${vout.toFixed(1)} V (ตัวต้านทาน 10 kΩ ไป VCC บนโมดูล) ต่อกับ GP${gp} — เกินขา Pico ที่ทนได้ 3.3 V ให้ใช้ไฟเลี้ยงโมดูลจาก 3V3` });
      }
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'keypad') {
      const er = result.elements[part.id];
      const lines = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'];
      const linked = lines.filter((p) => netLinked(c, doc, netOfPin(c, part.id, p)!));
      const reading: PartReading = { current: er?.current ?? 0, voltage: er?.voltage ?? 0, power: er?.power ?? 0, extra: { pressed: part.params.pressed ? 1 : 0, wired: linked.length } };
      if (linked.length > 0 && linked.length < 8) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ต่อสายแล้ว ${linked.length}/8 เส้น (ยังไม่ต่อ ${lines.filter((p) => !linked.includes(p)).join(' ')}) — ปุ่มในแถว/คอลัมน์ที่ไม่ได้ต่ออ่านไม่ได้` });
      if (Math.abs(reading.voltage) > part.params.maxVoltage) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดันคร่อมหน้าสัมผัส ${Math.abs(reading.voltage).toFixed(1)} V เกินพิกัด ${part.params.maxVoltage} V` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'encoder' || part.kind === 'joystick') {
      const nv = (pin: string) => { const x = result.nodeVoltage[netOfPin(c, part.id, pin)!]; return typeof x === 'number' ? x : 0; };
      const g = nv('GND');
      const supply = part.kind === 'encoder' ? '+' : '+5V';
      const vcc = nv(supply) - g;
      const extra: Record<string, number> = { vcc, vsw: nv('SW') - g, pressed: part.params.pressed ? 1 : 0 };
      if (part.kind === 'encoder') {
        const st = result.enc?.[part.id];
        Object.assign(extra, { vclk: nv('CLK') - g, vdt: nv('DT') - g, count: st?.count ?? 0, pending: st?.pending ?? 0 });
      } else Object.assign(extra, { vx: nv('VRx') - g, vy: nv('VRy') - g, x: part.params.x, y: part.params.y });
      const reading: PartReading = { current: 0, voltage: vcc, power: 0, extra };
      const outs = part.kind === 'encoder' ? ['CLK', 'DT'] : ['VRx', 'VRy'];
      for (const p of doc.parts) if (isPico(p)) for (const gp of PICO_GPIO) {
        const gn = netOfPin(c, p.id, `GP${gp}`);
        for (const line of outs) if (gn !== undefined && gn === netOfPin(c, part.id, line) && vcc > 3.6) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ${line} ต่อกับ GP${gp} ของ Pico แต่ไฟเลี้ยงโมดูล ${vcc.toFixed(1)} V — ${part.kind === 'encoder' ? 'ตัวต้านทานดึงขึ้นบนโมดูลดึงสายถึง ' + vcc.toFixed(1) + ' V' : 'แรงดันแกนขึ้นได้ถึง ' + vcc.toFixed(1) + ' V'} เกินขา Pico ที่ทนได้ 3.3 V ให้ต่อขาไฟเลี้ยงโมดูลกับ 3V3` });
        if (part.kind === 'joystick' && gn !== undefined && gp < 26) for (const line of outs) if (gn === netOfPin(c, part.id, line)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ${line} ต่อกับ GP${gp} ซึ่งไม่มี ADC — อ่านแรงดันแกนได้เฉพาะ GP26–GP28 (ADC0–ADC2)` });
      }
      if (vcc < -0.5) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว — ตรวจขา ${supply}/GND` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'pushbutton') {
      const n1 = netOfPin(c, part.id, '1')!, n3 = netOfPin(c, part.id, '3')!;
      const v1 = result.nodeVoltage[n1], v3 = result.nodeVoltage[n3];
      const er = result.elements[part.id];
      const vAcross = typeof v1 === 'number' && typeof v3 === 'number' ? v1 - v3 : 0;
      const reading: PartReading = er ? { current: er.current, voltage: er.voltage, power: er.power, extra: { pressed: 1 } } : { current: 0, voltage: vAcross, power: 0, extra: { pressed: 0 } };
      if (n1 === n3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา 1 กับขา 3 อยู่ในกลุ่มรูเดียวกัน ปุ่มจึงถูกลัดอยู่ตลอด (กดหรือไม่กดก็เหมือนกัน) — ขาคู่ที่ต่อกันภายในต้องคร่อมร่องกลาง ลองหมุนปุ่ม 90°` });
      if (Math.abs(reading.current) > part.params.maxCurrent) { reading.overRated = true; diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสผ่านหน้าสัมผัส ${fmtA(Math.abs(reading.current))} เกินพิกัด ${fmtA(part.params.maxCurrent)} — ปุ่มกดเล็กใช้กับสัญญาณ ไม่ใช่ตัดต่อโหลด (แบบจำลองการสอน)` }); }
      if (!er && Math.abs(vAcross) > part.params.maxVoltage) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดันคร่อมหน้าสัมผัส ${Math.abs(vAcross).toFixed(1)} V เกินพิกัด ${part.params.maxVoltage} V` });
      parts[part.id] = reading;
      continue;
    }
    if (part.kind === 'potentiometer') {
      const a = result.elements[`${part.id}#a`], b = result.elements[`${part.id}#b`];
      if (!a || !b) { parts[part.id] = { current: 0, voltage: 0, power: 0 }; continue; }
      // a: ขา 1 → 2, b: ขา 2 → 3 · กระแสเข้าขา 1 = a.current, ออกขา 3 = b.current, เข้าขาแกนกลาง = b − a
      const reading: PartReading = {
        current: a.current, voltage: b.voltage, power: a.power + b.power,
        extra: { v13: a.voltage + b.voltage, v12: a.voltage, v23: b.voltage, i1: a.current, i3: -b.current, iw: b.current - a.current, pa: a.power, pb: b.power, position: part.params.position },
      };
      checkRatings(part, reading, diags);
      parts[part.id] = reading;
      continue;
    }
    const er = result.elements[part.id];
    if (!er) {
      if (part.kind === 'scope') continue; // ออสซิลโลสโคปไม่มีค่าของตัวเอง (ขาเข้าแสดงในแผงสโคป)
      parts[part.id] = { current: 0, voltage: 0, power: 0, brightness: part.kind === 'led' ? 0 : undefined };
      continue;
    }
    const reading: PartReading = { current: er.current, voltage: er.voltage, power: er.power, mode: er.mode, extra: er.extra };
    checkRatings(part, reading, diags);
    if (part.kind === 'mosfet') {
      const bd = result.elements[`${part.id}#body`];
      if (bd) reading.extra = { ...(reading.extra ?? {}), ibody: bd.current };
      if (bd && bd.current > 1e-3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไดโอดในตัว (body diode) นำกระแส ${fmtA(bd.current)} — ขา D กับ S อาจต่อกลับด้าน${part.params.polarity === 'n' ? ' (ช่อง N: S ต่อด้านลบ/กราวด์ D ต่อด้านโหลด)' : ' (ช่อง P: S ต่อด้านไฟบวก D ต่อด้านโหลด)'}` });
    }
    parts[part.id] = reading;
    if (part.kind === 'dcsupply') {
      const p = netOfPin(c, part.id, 'pos')!, n = netOfPin(c, part.id, 'neg')!;
      if (p === n) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขั้ว + และ − ต่อถึงกันโดยตรง (ลัดวงจร) — แหล่งจ่ายจำกัดกระแสไว้ที่ ${fmtA(part.params.currentLimit)}` });
      else if (er.mode === 'CC') diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: เข้าโหมดจำกัดกระแส (CC) จ่าย ${fmtA(Math.abs(er.current))} แรงดันขั้วลดเหลือ ${er.voltage.toFixed(3)} V — ตรวจหาการลัดวงจรหรือโหลดต่ำเกินไป` });
      if (Math.abs(er.current) < 1e-9 && p !== n) {
        // โหลดที่ต่อผ่านหน้าสัมผัสรีเลย์ซึ่งยังเปิดอยู่: วงจรเปิดเป็นเรื่องปกติ บอกเหตุนี้แทนการบอกว่าต่อไม่ครบ
        const viaRelay = doc.parts.some((k) => k.kind === 'relay' && (c.nets[netOfPin(c, k.id, 'COM')!]?.partPins.length ?? 0) > 1);
        diags.push({ severity: 'info', partId: part.id, message: viaRelay
          ? `${part.label}: แทบไม่มีกระแสไหล (< 1 nA) — ถ้าโหลดต่อผ่านหน้าสัมผัสรีเลย์ นี่คือสถานะที่หน้าสัมผัสเปิดอยู่ (ปกติ) มิฉะนั้นตรวจว่าวงจรครบหรือไม่`
          : `${part.label}: แทบไม่มีกระแสไหล (< 1 nA) — วงจรเปิด (open circuit) ยังไม่ครบวงจร หรือมีอุปกรณ์กั้นกระแส เช่น LED กลับขั้ว` });
      }
    }
  }
  for (const part of doc.parts) if (isMicroPy(part)) checkPico(doc, part, c, result, diags);
  for (const part of doc.parts) if (part.kind === 'rpi5') checkRpi(doc, part, c, result, diags);
  for (const part of doc.parts) if (part.kind === 'uno' || part.kind === 'nano' || part.kind === 'mega' || part.kind === 'promini') checkUno(doc, part, c, result, diags);
  for (const part of doc.parts) if (part.kind === 'attiny85') checkTiny(doc, part, c, result, diags);
  for (const part of doc.parts) if (part.kind === 'unoq') checkUnoQ(doc, part, c, result, diags);
  checkPowerWiring(doc, c, result, diags);
  if (!doc.parts.some((p) => p.kind === 'dcsupply' || p.kind === 'fgen' || isMicroPy(p) || p.kind === 'rpi5' || p.kind === 'uno' || p.kind === 'nano' || p.kind === 'unoq' || p.kind === 'mega' || p.kind === 'promini' || (p.kind === 'dcadapter' && p.params.plugged))) diags.push({ severity: 'info', message: 'ยังไม่มีแหล่งจ่ายไฟหรือเครื่องกำเนิดสัญญาณในวงจร' });

  // อุปกรณ์ที่ขาข้างหนึ่งลอย (เน็ตที่มีอุปกรณ์เพียงขาเดียว)
  for (const net of c.nets) {
    if (net.partPins.length === 1 && result.component[net.index] >= 0) {
      const pp = net.partPins[0];
      const part = doc.parts.find((p) => p.id === pp.partId);
      if (part && part.kind !== 'dcsupply' && part.kind !== 'ammeter' && part.kind !== 'fgen' && part.kind !== 'scope' && part.kind !== 'relay' && part.kind !== 'transformer' && part.kind !== 'servo' && part.kind !== 'servohub' && part.kind !== 'dcadapter' && part.kind !== 'arcadebtn' && part.kind !== 'pushbtn16' && part.kind !== 'motor' && part.kind !== 'stepper' && part.kind !== 'dmm' && part.kind !== 'vom') {
        if (part.kind === 'opamp' && pp.pin.startsWith('NC')) continue; // ขาว่าง (offset) ไม่ต้องต่อ
        if (part.kind === 'lm386' && ['G1', 'G8', 'BYP'].includes(pp.pin)) continue; // ขาตั้งอัตราขยาย/บายพาส ปล่อยว่างได้ (อัตราขยาย 20)
        if ((part.kind === 'dht22' || part.kind === 'dht11') && pp.pin === 'NC') continue; // ขา 3 NC ไม่ต่อตามเอกสาร
        if (part.kind === 'logic' || part.kind === 'comparator' || part.kind === 'counter' || part.kind === 'hbridge' || part.kind === 'sonar' || part.kind === 'shiftreg') continue; // ตรวจขาเข้าลอยเฉพาะเกตที่ใช้งาน (ด้านบน)
        if (part.kind === 'timer555' && (pp.pin === 'CTRL' || pp.pin === 'OUT' || pp.pin === 'DIS')) continue; // ขา 5 ปล่อยว่างได้ (หรือต่อ C 10 nF), ขาออก/คายประจุไม่ใช้ได้ในบางวงจร
        if (part.kind === 'timer555' && (pp.pin === 'RESET' || pp.pin === 'TRIG' || pp.pin === 'THR')) {
          diags.push({ severity: 'warn', partId: part.id, message: pp.pin === 'RESET'
            ? `${part.label} ขา 4 RESET ลอย — ปกติต่อเข้า VCC (ขา 8) ไม่งั้นไอซีจริงอาจรีเซ็ตเองจากสัญญาณรบกวน`
            : `${part.label} ขา ${pp.pin === 'TRIG' ? '2 TRIG' : '6 THR'} ลอย — ขาเข้าคอมพาราเตอร์ต้องต่อกับวงจรตั้งเวลา (astable: ต่อขา 2 กับขา 6 และตัวเก็บประจุ)` });
          continue;
        }
        if (part.kind === 'pushbutton' || part.kind === 'sevenseg' || part.kind === 'rgbled' || part.kind === 'esp32s2' || part.kind === 'bluepill' || part.kind === 'pico2' || part.kind === 'teensy41' || part.kind === 'ssd1306' || part.kind === 'ds3231' || part.kind === 'mpu6050' || part.kind === 'gc9a01' || part.kind === 'qmi8658' || part.kind === 'bmp280' || part.kind === 'bh1750' || part.kind === 'lcd1602' || part.kind === 'ina219' || part.kind === 'tm1637' || part.kind === 'keypad' || part.kind === 'encoder' || part.kind === 'joystick' || part.kind === 'pir' || part.kind === 'irobstacle' || isSensor(part) || part.kind === 'rpi5' || part.kind === 'lcd1602p') continue; // ขาที่ไม่ใช้ (ส่วนที่ไม่ต่อ, ขาร่วมขาที่สอง) เป็นเรื่องปกติ // ปุ่ม 4 ขา: ใช้เพียงขาละฝั่งก็พอ (ขาคู่ต่อกันภายใน)
        const msg = part.kind === 'opamp' && (pp.pin === 'IN+' || pp.pin === 'IN-')
          ? `${part.label} ขา ${pp.pin} ลอย — ขาเข้าออปแอมป์ที่ไม่ได้ต่อทำให้ขาออกไม่แน่นอน ควรต่อเข้ากับวงจรหรือกราวด์`
          : part.kind === 'mosfet' && pp.pin === 'G'
            ? `${part.label} ขาเกตลอย — MOSFET จริงอาจติด/ดับเองจากไฟฟ้าสถิต ควรมีตัวต้านทาน pull-down (เช่น 10 kΩ) จาก G ลง S`
            : `${part.label} ขา ${pp.pin} ไม่ได้ต่อกับอุปกรณ์อื่น (ปลายเปิด)`;
        diags.push({ severity: 'info', partId: part.id, message: msg });
      } else if (part && part.kind === 'ammeter') {
        diags.push({ severity: 'info', partId: part.id, message: `${part.label} ขั้ว ${pp.pin} ยังไม่ได้ต่อ — แอมมิเตอร์ต้องต่ออนุกรมในเส้นทางกระแส` });
      }
    }
  }

  // เกต MOSFET ที่ต่อกับสวิตช์ที่เปิดอยู่เท่านั้น (ไม่มีทางกระแสตรงไปเน็ตอื่น) → เกตลอยขณะปลดสวิตช์
  for (const net of c.nets) {
    const gates = net.partPins.filter((pp) => pp.pin === 'G' && doc.parts.find((p) => p.id === pp.partId)?.kind === 'mosfet');
    if (!gates.length || net.partPins.length === 1) continue;
    const isolated = net.partPins.every((pp) => {
      const p = doc.parts.find((q) => q.id === pp.partId);
      return (p?.kind === 'mosfet' && pp.pin === 'G') || (p?.kind === 'switch' && !p.params.closed) || p?.kind === 'capacitor';
    });
    if (isolated) for (const g of gates) {
      const part = doc.parts.find((p) => p.id === g.partId)!;
      diags.push({ severity: 'warn', partId: part.id, message: `${part.label} ขาเกตลอยเมื่อสวิตช์เปิด — ไม่มีทางคายประจุเกต MOSFET จริงอาจค้างสถานะ ON ควรมีตัวต้านทาน pull-down (เช่น 100 kΩ) จาก G ลง S` });
    }
  }

  // โพรบ
  const ra = doc.probes.red ? netOfTerminal(c, doc.probes.red) : undefined;
  const rb = doc.probes.black ? netOfTerminal(c, doc.probes.black) : undefined;
  const vb = voltageBetween(result, ra, rb);
  probe.value = vb.value;
  probe.reason = vb.reason;
  if (vb.value !== null && ra !== undefined && !result.energized[result.component[ra]]) {
    probe.reason = 'ส่วนวงจรที่วัดไม่มีแหล่งจ่ายทำงาน';
  }
  return { ok: true, parts, probe, diagnostics: diags, ...(result.i2c ? { i2c: result.i2c } : {}), ...(result.lcd ? { lcd: result.lcd } : {}), ...(result.seg ? { seg: result.seg } : {}), ...(result.plcd ? { plcd: result.plcd } : {}), ...(result.enc ? { enc: result.enc } : {}) };
}

/** ขา GPIO: กระแสเกินที่แนะนำ, แรงดันเกิน 3.3 V (ไม่ทน 5 V), ขา REPL ถูกใช้, ไฟเลี้ยงเกินพิกัด — Pico/Pico W (GP0–GP28) และ XIAO RP2040 (D0–D10) */
function checkPico(doc: CircuitDoc, part: PicoPart, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  const xiao = part.kind === 'xiao', nc = part.kind === 'nanoconnect', esp = part.kind === 'esp32devkitc';
  const pins = rp2Pins(part.kind);
  const nameOf = (g: number) => { const d = pins.find(([, x]) => x === g); return d ? (xiao || nc || esp ? `${d[0]} (GPIO${g})` : d[0]) : `GPIO${g}`; };
  // กระแสขาที่แนะนำ: Nano RP2040 Connect datasheet ระบุ IOH/IOL 8 mA · ESP32 datasheet: IOH 40 mA ที่ drive สูงสุด ลดเหลือ ≈ 29 mA เมื่อหลายขาจ่ายพร้อมกัน → เตือนที่ 20 mA · Pico/XIAO ใช้ 12 mA
  const iMax = nc ? 0.008 : esp ? 0.02 : 0.012;
  const gnd = netOfPin(c, part.id, nc || esp ? 'GND.1' : 'GND');
  const chip = esp ? 'ESP32' : 'RP2040';
  const fl = result.floating?.[part.id] ?? [];
  if (fl.length) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${fl.map(nameOf).join(', ')} ลอย (ไม่มีตัวต้านทานดึงขึ้น/ดึงลง และไม่มีสิ่งใดขับ เช่น ต่อแค่ปุ่มที่ปล่อยอยู่) — ค่าที่อ่านได้ค้างค่าเดิม/สุ่ม ใส่ตัวต้านทานดึงลง 10 kΩ ไป GND หรือใช้ Pin.PULL_UP / Pin.PULL_DOWN` });
  for (const [name, pin] of pins) {
    const net = netOfPin(c, part.id, name);
    if (net === undefined) continue;
    if (!netLinked(c, doc, net)) continue;
    if (pin <= 1) { diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ${nameOf(pin)} ใช้เป็น UART ของ REPL ในตัวจำลองนี้ — ควรใช้ขาอื่นต่อวงจร` }); continue; }
    const v = voltageBetween(result, net, gnd).value;
    if (v !== null && (v > 3.6 || v < -0.3)) {
      diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${nameOf(pin)} มีแรงดัน ${v.toFixed(2)} V นอกช่วง 0–3.3 V — ${chip} ไม่ทนแรงดัน 5 V ขาจริงจะเสียหาย ${teach}` });
    }
    const er = result.elements[`${part.id}#GP${pin}`];
    if (er && Math.abs(er.current) > iMax) {
      diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${nameOf(pin)} จ่าย/รับกระแส ${(Math.abs(er.current) * 1000).toFixed(1)} mA เกินที่แนะนำ (≈ ${iMax * 1000} mA ต่อขา) — เพิ่มตัวต้านทาน หรือใช้ทรานซิสเตอร์ขับโหลด ${teach}` });
    }
  }
  const p3 = result.elements[`${part.id}#3V3`];
  if (p3?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 3V3 ถูกใช้กระแสเกิน ${nc ? '800 mA (รวมไอซีบนบอร์ด)' : esp ? '500 mA' : '300 mA'}${xiao ? ' (ค่าประมาณ — Seeed ไม่ระบุพิกัด)' : esp ? ' (ค่าประมาณ — User Guide ไม่ระบุพิกัด)' : ''} (หรือลัดวงจรลงกราวด์) — เรกูเลเตอร์บนบอร์ดจำกัดกระแส ${teach}` });
  const pb = result.elements[`${part.id}#VBUS`];
  if (pb?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${xiao || esp ? '5V' : nc ? 'VUSB' : 'VBUS'} ถูกใช้กระแสเกิน 500 mA หรือลัดวงจร ${teach}` });
  if (esp) {
    // ESP32: ขาแฟลชภายใน, ขาเข้าเท่านั้น (GPIO34–39) และขา strapping (ESP32 datasheet ตาราง Strapping Pins)
    for (const f of ['CLK', 'D0', 'D1', 'D2', 'D3', 'CMD']) { const net = netOfPin(c, part.id, f); if (net !== undefined && netLinked(c, doc, net)) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${f} (GPIO6–11) ต่อกับแฟลชภายในโมดูล — ห้ามต่อวงจร บอร์ดจริงจะค้าง/รีเซ็ต (ตัวจำลองไม่ได้ต่อขานี้กับ CPU) ${teach}` }); }
    const v12 = (() => { const net = netOfPin(c, part.id, 'IO12'); return net !== undefined && netLinked(c, doc, net) ? voltageBetween(result, net, gnd).value : null; })();
    if (v12 !== null && v12 > 1.65) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: IO12 (MTDI) ถูกดึงขึ้น ${v12.toFixed(2)} V — เป็นขา strapping กำหนดแรงดันแฟลช ถ้าเป็น HIGH ตอนเปิดเครื่อง บอร์ด WROOM จริงบูตไม่ขึ้น (ตัวจำลองไม่ได้จำลองผลนี้) ${teach}` });
  }
  // A6/A7 ต่อกับ ADC ของ NINA-W102 เท่านั้น (ไม่จำลอง)
  if (nc) for (const a of ['A6', 'A7']) { const net = netOfPin(c, part.id, a); if (net !== undefined && netLinked(c, doc, net)) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขา ${a} ต่อกับ ADC ของโมดูล NINA-W102 เท่านั้น ซึ่งยังไม่ได้จำลอง — โค้ดในแอปอ่านขานี้ไม่ได้ ใช้ A0–A3 แทน` }); }
}

/**
 * Arduino Uno (ATmega328P datasheet §28.1 Absolute Maximum Ratings / §29.2): กระแสต่อขา ≤ 40 mA (สูงสุด, แนะนำใช้งาน ≤ 20 mA),
 * กระแสรวมผ่าน VCC/GND ≤ 200 mA · ขาออกในแบบจำลองถูกจำกัดที่ 40 mA (ของจริงไม่มีตัวจำกัด — ขาเสียหายได้)
 */
function checkUno(doc: CircuitDoc, part: Extract<Part, { kind: 'uno' | 'nano' | 'mega' | 'promini' }>, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  const nano = part.kind === 'nano', mega = part.kind === 'mega', pm = part.kind === 'promini';
  let total = 0;
  // Pro Mini 3.3 V: ขาทนแรงดันได้ไม่เกิน VCC + 0.5 V (datasheet §28.1) — ต่อสัญญาณ 5 V ตรงเข้าขาไม่ได้
  if (pm && part.params.volt === 3.3) {
    const gnd = netOfPin(c, part.id, 'GND.1');
    for (const pin of NANO_DIGITAL) {
      const net = netOfPin(c, part.id, pin);
      if (net === undefined || !netLinked(c, doc, net)) continue;
      const v = voltageBetween(result, net, gnd).value;
      if (v !== null && v > 3.85) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} มีแรงดัน ${v.toFixed(2)} V เกิน VCC + 0.5 V (3.8 V) ที่ ATmega328P ไฟเลี้ยง 3.3 V ทนได้ — ใช้วงจรแบ่งแรงดันหรือตัวแปลงระดับ ${teach}` });
    }
  }
  (nano || pm ? NANO_DIGITAL : mega ? MEGA_DIGITAL : UNO_DIGITAL).forEach((pin, i) => {
    const net = netOfPin(c, part.id, pin);
    if (net === undefined || !netLinked(c, doc, net)) return;
    const er = result.elements[`${part.id}#GP${i}`];
    if (!er) return;
    const a = Math.abs(er.current);
    total += a;
    if (a >= 0.039) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} จ่าย/รับกระแสถึงพิกัดสูงสุด 40 mA (เช่น ลัดลง GND/5V หรือ LED ไม่มีตัวต้านทาน) — ขาจริงเสียหายได้ ใส่ตัวต้านทานจำกัดกระแส ${teach}` });
    else if (a > 0.02) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${pin} ใช้กระแส ${(a * 1000).toFixed(1)} mA เกินค่าใช้งานที่แนะนำ 20 mA — แรงดันขาตก ใช้ตัวต้านทานค่าสูงขึ้นหรือทรานซิสเตอร์ขับโหลด ${teach}` });
  });
  if (total > 0.2) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสรวมของขา GPIO ${(total * 1000).toFixed(0)} mA เกิน 200 mA ที่ชิป ${mega ? 'ATmega2560' : 'ATmega328P'} รับได้ ${teach}` });
  if (result.elements[`${part.id}#5V`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 5V ถูกใช้กระแสเกิน 500 mA (ฟิวส์ USB) หรือลัดวงจร ${teach}` });
  if (result.elements[`${part.id}#VCC`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา VCC ใช้กระแสเกินที่ตัวแปลง USB-serial จ่ายได้ (${pm && part.params.volt === 3.3 ? '≈ 150 mA ค่าประมาณ ขึ้นกับรุ่นตัวแปลง' : '500 mA จากพอร์ต USB'}) หรือลัดวงจร ${teach}` });
  if (result.elements[`${part.id}#3V3`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: nano ? `${part.label}: ขา 3V3 ถูกใช้กระแสเกิน 50 mA (ไฟจากชิป USB-serial บนบอร์ด) หรือลัดวงจร — ใช้ตัวคุมแรงดัน 3.3 V แยก ${teach}` : `${part.label}: ขา 3.3V ถูกใช้กระแสเกิน 150 mA หรือลัดวงจร ${teach}` });
}

/**
 * ATtiny85 (datasheet Atmel-2586 §21): ใช้งาน VCC 2.7–5.5 V (รุ่นไม่มี V ที่ 0–10 MHz), พิกัดสูงสุด 6.0 V · ขาใด ๆ −0.5 V ถึง VCC + 0.5 V
 * กระแสต่อขา ≤ 40 mA (สูงสุด) · กระแสรวมขา VCC/GND ≤ 200 mA
 */
function checkTiny(doc: CircuitDoc, part: Extract<Part, { kind: 'attiny85' }>, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  const gnd = netOfPin(c, part.id, 'GND'), vccN = netOfPin(c, part.id, 'VCC');
  const linked = (n: number | undefined) => n !== undefined && netLinked(c, doc, n);
  const vcc = linked(vccN) && linked(gnd) ? voltageBetween(result, vccN!, gnd!).value : null;
  if (vcc === null || vcc < 2.7) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ${vcc === null ? 'ขา 8 (VCC) หรือขา 4 (GND) ยังไม่ได้ต่อกับแหล่งจ่าย' : `VCC = ${vcc.toFixed(2)} V ต่ำกว่า 2.7 V`} — ชิปไม่ทำงาน (ไอซีไม่มีบอร์ดจ่ายไฟให้ ต้องต่อไฟเลี้ยงเอง)` });
  if (vcc !== null && vcc < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (VCC ${vcc.toFixed(2)} V) — ขา 8 ต้องเป็นบวก ขา 4 เป็นกราวด์ ${teach}` });
  else if (vcc !== null && vcc > 6.0) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: VCC ${vcc.toFixed(2)} V เกินพิกัดสูงสุด 6.0 V — ชิปเสียหายได้ ${teach}` });
  else if (vcc !== null && vcc > 5.55) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: VCC ${vcc.toFixed(2)} V เกินช่วงใช้งาน 2.7–5.5 V ${teach}` });
  let total = 0;
  ATTINY85_DIGITAL.slice(0, 5).forEach((pin, i) => {
    const net = netOfPin(c, part.id, pin);
    if (!linked(net) || !linked(gnd)) return;
    const v = voltageBetween(result, net!, gnd!).value;
    if (v !== null && vcc !== null && vcc > 0 && v > vcc + 0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} มีแรงดัน ${v.toFixed(2)} V เกิน VCC + 0.5 V (${(vcc + 0.5).toFixed(2)} V) ${teach}` });
    const er = result.elements[`${part.id}#GP${i}`];
    if (!er) return;
    const a = Math.abs(er.current);
    total += a;
    if (a >= 0.04) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} ใช้กระแส ${(a * 1000).toFixed(0)} mA ถึงพิกัดสูงสุด 40 mA (เช่น LED ไม่มีตัวต้านทาน) — ขาจริงเสียหายได้ ${teach}` });
    else if (a > 0.02) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${pin} ใช้กระแส ${(a * 1000).toFixed(1)} mA — แรงดันขาตกมาก ควรไม่เกิน ≈ 10–20 mA ${teach}` });
  });
  if (total > 0.2) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสรวมของขา ${(total * 1000).toFixed(0)} mA เกิน 200 mA ที่ขา VCC/GND ของ ATtiny85 รับได้ ${teach}` });
}

/** ขาที่ทนแรงดันได้เพียง 3.6 V บน UNO Q (datasheet ABX00162/173: A0–A5 ห้ามเกิน VDD + 0.3 V; full pinout: D3 = PB0 ทน 3.6 V) */
export const UNOQ_3V6_PINS = new Set(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'D3']);

/**
 * Arduino UNO Q (โหมดจำลองพฤติกรรม): ตรวจตามพิกัด STM32U585 — แรงดันขาเกิน (3.6 V / 5.5 V), กระแสต่อขา 20 mA, รวม 120 mA,
 * ขาเข้าลอย, ไฟ 5V/3V3 เกิน และโมดูล I²C ที่ต่อ A4/A5 แบบ Uno R3 (บน UNO Q Wire อยู่ที่หัวต่อ SDA/SCL)
 */
function checkUnoQ(doc: CircuitDoc, part: Extract<Part, { kind: 'unoq' }>, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  const gnd = netOfPin(c, part.id, 'GND.1');
  let total = 0;
  const fl = (result.floating?.[part.id] ?? []).filter((i) => { const n = netOfPin(c, part.id, UNO_DIGITAL[i]); return n !== undefined && netLinked(c, doc, n); });
  if (fl.length) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${fl.map((i) => UNO_DIGITAL[i]).join(', ')} ลอย (ไม่มีตัวดึงขึ้น/ลงและไม่มีสิ่งใดขับ) — ค่าที่อ่านไม่แน่นอน ใช้ INPUT_PULLUP หรือต่อตัวต้านทาน` });
  for (const [i, pin] of [...UNO_DIGITAL.entries(), [-1, 'SDA'], [-2, 'SCL']] as Array<[number, string]>) {
    const net = netOfPin(c, part.id, pin);
    if (net === undefined || !netLinked(c, doc, net)) continue;
    const v = voltageBetween(result, net, gnd).value;
    const lim = UNOQ_3V6_PINS.has(pin) ? 3.6 : 5.5;
    if (v !== null && v > lim + 0.05) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} มีแรงดัน ${v.toFixed(2)} V เกิน ${lim} V ที่ขานี้ทนได้ — ${lim === 3.6 ? 'A0–A5 และ D3 ของ UNO Q ไม่ทน 5 V' : 'ขาของ UNO Q ทนได้สูงสุด 5 V (เฉพาะขาเข้า)'} ใช้วงจรแบ่งแรงดันหรือตัวแปลงระดับ ${teach}` });
    else if (v !== null && v < -0.3) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} มีแรงดันติดลบ ${v.toFixed(2)} V — ตรวจขั้วไฟ/GND ${teach}` });
    if (i < 0) continue;
    const er = result.elements[`${part.id}#GP${i}`];
    if (!er) continue;
    const a = Math.abs(er.current);
    total += a;
    if (a >= 0.0199) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา ${pin} จ่าย/รับกระแสถึงพิกัด 20 mA ของ STM32U585 (เช่น ลัดลง GND หรือ LED ไม่มีตัวต้านทาน) ${teach}` });
    else if (a > 0.008) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${pin} ใช้กระแส ${(a * 1000).toFixed(1)} mA — ขา 3.3 V แรงดันตกเมื่อเกิน ≈ 8 mA ควรใช้ทรานซิสเตอร์ขับโหลด` });
  }
  if (total > 0.12) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสรวมของขา ${(total * 1000).toFixed(0)} mA เกิน 120 mA ที่ STM32U585 รับได้ ${teach}` });
  if (result.elements[`${part.id}#5V`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 5V ใช้กระแสเกินที่แหล่งจ่าย USB-C จ่ายได้ (${part.params.usbLimit} A) หรือลัดวงจร — แรงดันตก บอร์ดอาจรีเซ็ต ${teach}` });
  if (result.elements[`${part.id}#3V3`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 3V3 ใช้กระแสเกิน ≈ 0.5 A (ค่าประมาณ) หรือลัดวงจร ${teach}` });
  // โมดูล I²C ที่ต่อ A4/A5 ตามแบบ Uno R3 — บน UNO Q Wire ไม่ได้ใช้ A4/A5
  for (const [pin, line] of [['A4', 'SDA'], ['A5', 'SCL']] as const) {
    const net = netOfPin(c, part.id, pin);
    if (net === undefined) continue;
    const mod = c.nets[net]?.partPins.find((pp) => pp.partId !== part.id && pp.pin === line);
    if (mod) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา ${line} ของ ${doc.parts.find((q) => q.id === mod.partId)?.label ?? mod.partId} ต่อที่ ${pin} — บน UNO Q คำสั่ง Wire ใช้หัวต่อ SDA/SCL (ข้าง AREF) ไม่ใช่ ${pin} (A4/A5 = Wire2 ซึ่งต้องดึงขึ้นที่ 3.3 V เท่านั้น) ย้ายสายไปที่ขา ${line}` });
  }
}

/**
 * ตรวจการต่อไฟที่พบบ่อยในโครงงาน: อะแดปเตอร์จ่ายเกินพิกัด/กลับขั้ว/ต่อชนขา 5V ของบอร์ด, เซอร์โวที่ GND ไม่ร่วมกับบอร์ดที่ส่งสัญญาณ,
 * เซอร์โวหลายตัวใช้ไฟจากขา 5V ของบอร์ด
 */
function checkPowerWiring(doc: CircuitDoc, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const mcus = doc.parts.filter((p) => ['uno', 'nano', 'unoq', 'mega', 'promini', 'pico', 'picow', 'xiao', 'nanoconnect', 'esp32devkitc', 'rpi5'].includes(p.kind));
  /** เน็ต GND ทั้งหมดของบอร์ด (ชื่อขาขึ้นต้น GND — Pico/Pi มีหลายขาและชื่อไม่เหมือนกัน) */
  const mcuGnds = (id: string): Set<number> => { const p = doc.parts.find((x) => x.id === id)!; const out = new Set<number>(); for (const d of pinDefs(p)) if (/^GND/.test(d.name)) { const n = netOfPin(c, id, d.name); if (n !== undefined) out.add(n); } return out; };
  const mcuOfNet = (net: number | undefined) => (net === undefined ? undefined : mcus.find((m) => (c.nets[net]?.partPins ?? []).some((pp) => pp.partId === m.id && pp.pin !== 'GND.1' && !/^GND/.test(pp.pin))));
  for (const a of doc.parts) {
    if (a.kind !== 'dcadapter' || !a.params.plugged) continue;
    const pos = netOfPin(c, a.id, '+'), neg = netOfPin(c, a.id, '-');
    const el = result.elements[a.id];
    if (el?.mode === 'CC') diags.push({ severity: 'danger', partId: a.id, message: `${a.label}: ใช้กระแสถึงพิกัด ${a.params.currentLimit} A (หรือลัดวงจร) — แรงดันตกจาก ${a.params.voltage} V เซอร์โว/บอร์ดอาจรีเซ็ตหรือสั่น ลดจำนวนโหลดที่ทำงานพร้อมกันหรือใช้อะแดปเตอร์ที่จ่ายได้มากกว่า` });
    else if (el && Math.abs(el.current) > a.params.currentLimit * 0.8) diags.push({ severity: 'warn', partId: a.id, message: `${a.label}: ใช้กระแส ${fmtA(Math.abs(el.current))} เกิน 80% ของพิกัด ${a.params.currentLimit} A` });
    for (const m of mcus) {
      const mg = mcuGnds(m.id);
      for (const rail of ['5V', '3V3', 'VBUS', 'VSYS', '5V.1', '3V3.1']) {
        const rn = netOfPin(c, m.id, rail);
        if (rn === undefined) continue;
        if (neg !== undefined && rn === neg) diags.push({ severity: 'danger', partId: a.id, message: `${a.label}: ขั้วลบต่อกับขา ${rail} ของ ${m.label} — กลับขั้ว/ลัดวงจรไฟเลี้ยง ${'(แบบจำลองการสอน)'}` });
        if (pos !== undefined && rn === pos && rail.startsWith('5V')) diags.push({ severity: 'warn', partId: a.id, message: `${a.label}: ขั้วบวกต่อตรงเข้าขา 5V ของ ${m.label} — ถ้าเสียบ USB พร้อมกัน แหล่งจ่ายสองตัวชนกัน (ของจริงอาจไหลย้อนเข้าพอร์ต USB) ใช้ไฟอะแดปเตอร์กับเซอร์โวเท่านั้นและต่อเฉพาะ GND ร่วม` });
        if (pos !== undefined && rn === pos && rail.startsWith('3V3')) diags.push({ severity: 'danger', partId: a.id, message: `${a.label}: ขั้วบวก ${a.params.voltage} V ต่อเข้าขา ${rail} ของ ${m.label} — เกินแรงดันของราง 3.3 V` });
      }
      if (pos !== undefined && mg.has(pos)) diags.push({ severity: 'danger', partId: a.id, message: `${a.label}: ขั้วบวกต่อกับ GND ของ ${m.label} — กลับขั้ว (แบบจำลองการสอน)` });
    }
  }
  // เซอร์โว: สัญญาณจากบอร์ดแต่ GND ไม่ร่วม / หลายตัวใช้ไฟจากขา 5V ของบอร์ด
  const servoOnRail = new Map<string, string[]>();
  for (const s of doc.parts) {
    if (s.kind !== 'servo') continue;
    const sig = netOfPin(c, s.id, 'SIG'), g = netOfPin(c, s.id, 'GND'), v = netOfPin(c, s.id, 'V');
    // สัญญาณผ่านแผ่นกระจายไฟ: ใช้เน็ตเดียวกันอยู่แล้ว (ทองแดงในแผ่นคือ internalLinks)
    const m = mcuOfNet(sig);
    if (m && g !== undefined && netLinked(c, doc, g) && mcuGnds(m.id).size && !mcuGnds(m.id).has(g)) diags.push({ severity: 'danger', partId: s.id, message: `${s.label}: GND ของเซอร์โวไม่ได้ต่อร่วมกับ GND ของ ${m.label} — สัญญาณควบคุมไม่มีจุดอ้างอิง เซอร์โวจะไม่หมุนหรือสั่น ต่อ GND ของอะแดปเตอร์/แผ่นกระจายไฟเข้ากับ GND ของบอร์ด` });
    for (const mm of mcus) {
      const r5 = netOfPin(c, mm.id, '5V') ?? netOfPin(c, mm.id, '5V.1') ?? netOfPin(c, mm.id, 'VBUS');
      if (r5 !== undefined && v === r5) servoOnRail.set(mm.id, [...(servoOnRail.get(mm.id) ?? []), s.label]);
    }
  }
  for (const [id, list] of servoOnRail) if (list.length >= 2) {
    const m = doc.parts.find((p) => p.id === id)!;
    diags.push({ severity: 'warn', partId: id, message: `${m.label}: เซอร์โว ${list.length} ตัว (${list.join(', ')}) ใช้ไฟจากขา 5V ของบอร์ด — ขณะหมุนพร้อมกันกินกระแสหลายร้อย mA ถึงเกิน 1 A ไฟ USB ตกจนบอร์ดรีเซ็ต ควรใช้อะแดปเตอร์ 5 V แยก + GND ร่วม` });
  }
}

/** Raspberry Pi 5: ขาเกิน 3.3 V, กระแสขาเกิน, ขาเข้าลอย, ไฟ 3V3/5V เกิน */
function checkRpi(doc: CircuitDoc, part: Extract<Part, { kind: 'rpi5' }>, c: Connectivity, result: SimResult, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  const gnd = netOfPin(c, part.id, 'GND.1');
  const fl = result.floating?.[part.id] ?? [];
  if (fl.length) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขาเข้า ${fl.map((g) => `GPIO${g}`).join(', ')} ลอย (ไม่มีตัวดึงขึ้น/ลงและไม่มีสิ่งใดขับ) — ค่าที่อ่านได้ค้าง/สุ่ม ใช้ pull_up=True/False ของ gpiozero หรือใส่ตัวต้านทานดึงลง` });
  for (let g = 0; g < 28; g++) {
    const net = netOfPin(c, part.id, `GPIO${g}`);
    if (net === undefined || !netLinked(c, doc, net)) continue;
    const v = voltageBetween(result, net, gnd).value;
    if (v !== null && (v > 3.6 || v < -0.3)) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา GPIO${g} มีแรงดัน ${v.toFixed(2)} V นอกช่วง 0–3.3 V — GPIO ของ Raspberry Pi ไม่ทน 5 V ขาจริงจะเสียหาย ใช้ตัวแบ่งแรงดันหรือตัวแปลงระดับ ${teach}` });
    const er = result.elements[`${part.id}#GP${g}`];
    if (er && Math.abs(er.current) > 0.016) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ขา GPIO${g} จ่าย/รับกระแส ${(Math.abs(er.current) * 1000).toFixed(1)} mA เกิน ≈ 16 mA — แรงดันขาตก ใช้ตัวต้านทานค่าสูงขึ้นหรือทรานซิสเตอร์ขับโหลด ${teach}` });
  }
  if (result.elements[`${part.id}#3V3`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 3V3 ถูกใช้กระแสเกินหรือลัดวงจร ${teach}` });
  if (result.elements[`${part.id}#5V`]?.mode === 'CC') diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ขา 5V ถูกใช้กระแสเกิน 1.6 A หรือลัดวงจร ${teach}` });
}

function fmtA(a: number): string {
  return a >= 1 ? `${a.toFixed(3)} A` : `${(a * 1000).toFixed(2)} mA`;
}

function checkRatings(part: Part, r: PartReading, diags: Diagnostic[]) {
  const teach = '(แบบจำลองการสอน)';
  switch (part.kind) {
    case 'ntc': {
      const pr = part.params;
      const R = ntcResistance(pr);
      const p = Math.abs(r.power);
      const dT = p / pr.dissipation; // ความร้อนในตัว: หัวอุ่นกว่าอากาศรอบตัว
      r.extra = { temp: pr.temperature, resistance: R, dT, tBody: pr.temperature + dT };
      if (p > pr.maxPower) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลัง ${(p * 1000).toFixed(1)} mW เกินพิกัด ${(pr.maxPower * 1000).toFixed(0)} mW — ร้อนจัดจนค่าเพี้ยนหรือเสียหาย ใส่ตัวต้านทานอนุกรมค่าสูงขึ้น` });
      } else if (dT >= 0.5) {
        diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ความร้อนในตัว ${(p * 1000).toFixed(2)} mW ÷ ${(pr.dissipation * 1000).toFixed(1)} mW/°C ≈ ${dT.toFixed(1)} °C — ของจริงตัวเทอร์มิสเตอร์จะอุ่นกว่าอากาศรอบตัว อ่านอุณหภูมิได้สูงเกิน (แบบจำลองไม่ได้นำผลนี้กลับไปคำนวณ R) · ลดกระแสด้วยตัวต้านทานคงที่ค่าสูงขึ้น (เช่น 10 kΩ) หรือลดแรงดัน` });
      }
      break;
    }
    case 'ldr': {
      const R = ldrResistance(part.params);
      r.extra = { lux: part.params.lux, resistance: R };
      if (Math.abs(r.power) > part.params.maxPower) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลัง ${(Math.abs(r.power) * 1000).toFixed(0)} mW เกินพิกัด ${(part.params.maxPower * 1000).toFixed(0)} mW — เมื่อแสงจ้า LDR มีความต้านทานต่ำ ควรมีตัวต้านทานอนุกรมจำกัดกระแส ${teach}` });
      }
      break;
    }
    case 'potentiometer': {
      // พิกัดกำลังใช้กับทั้งเส้นความต้านทาน — ส่วนที่ใช้เพียงบางส่วนทนได้ตามสัดส่วนความยาว
      const { resistance: R, position: p, endResistance: re, powerRating: P } = part.params;
      const x = r.extra!;
      for (const [seg, pw, frac, pins] of [['a', x.pa, (R * p + re) / (R + 2 * re), '1–2'], ['b', x.pb, (R * (1 - p) + re) / (R + 2 * re), '2–3']] as const) {
        void seg;
        const lim = P * Math.max(frac, 0.002);
        if (Math.abs(pw) > lim) {
          r.overRated = true;
          diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ช่วงขา ${pins} รับกำลัง ${(Math.abs(pw) * 1000).toFixed(pw > 0.01 ? 0 : 2)} mW เกินที่ส่วนนี้ทนได้ (${(lim * 1000).toFixed(1)} mW = ${P} W × สัดส่วนความยาว ${(frac * 100).toFixed(1)}%) — มักเกิดเมื่อต่อขาแกนกลางลงไฟ/กราวด์ตรงแล้วหมุนจนสุด ควรมีตัวต้านทานอนุกรมกับขาแกนกลาง ${teach}` });
        }
      }
      if (Math.abs(x.iw) > 0.1) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสผ่านขาแกนกลาง ${fmtA(Math.abs(x.iw))} สูงมาก — หน้าสัมผัสของแกนกลางรับกระแสได้น้อย ใช้ VR เป็นตัวแบ่งแรงดัน ไม่ใช่ตัวจำกัดกระแสโหลดใหญ่` });
      break;
    }
    case 'resistor':
      if (Math.abs(r.power) > part.params.powerRating) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลัง ${(Math.abs(r.power) * 1000).toFixed(0)} mW เกินพิกัด ${part.params.powerRating} W — ตัวต้านทานจริงอาจร้อนจนเสียหาย ${teach}` });
      }
      break;
    case 'led': {
      r.brightness = ledBrightness(r.current, part.params.ratedCurrent);
      if (r.current > part.params.maxCurrent) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแส ${fmtA(r.current)} เกินพิกัดสูงสุด ${fmtA(part.params.maxCurrent)} — LED จริงอาจเสียหาย ควรเพิ่มตัวต้านทานจำกัดกระแส ${teach}` });
      }
      if (-r.voltage > part.params.maxReverseVoltage) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดันย้อน ${(-r.voltage).toFixed(2)} V เกินพิกัด ${part.params.maxReverseVoltage} V ${teach} — แบบจำลองนี้ไม่จำลองการพังทลาย` });
      } else if (r.voltage < -0.5) {
        diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ได้รับไบอัสกลับ (ขา A ต่ำกว่า K) — แทบไม่มีกระแสไหล` });
      }
      break;
    }
    case 'ammeter':
      if (Math.abs(r.current) > part.params.range) {
        r.overRated = true;
        diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสเกินย่านวัด ${fmtA(part.params.range)} ${teach}` });
      }
      break;
    case 'capacitor':
      if (Math.abs(r.voltage) > part.params.ratedVoltage) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: แรงดัน ${Math.abs(r.voltage).toFixed(2)} V เกินพิกัด ${part.params.ratedVoltage} V — ตัวเก็บประจุจริงอาจเสียหาย ${teach}` });
      }
      if (part.params.polarized && r.voltage < -0.5) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ตัวเก็บประจุอิเล็กโทรไลต์ได้รับแรงดันกลับขั้ว ${r.voltage.toFixed(2)} V — ของจริงอาจร้อน บวม หรือระเบิด ให้หมุนกลับขั้ว ${teach}` });
      }
      break;
    case 'inductor':
      if (Math.abs(r.current) > part.params.ratedCurrent) {
        r.overRated = true;
        diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแส ${fmtA(Math.abs(r.current))} เกินพิกัด ${fmtA(part.params.ratedCurrent)} ${teach}` });
      }
      if (Math.abs(r.voltage) > 100) {
        diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: แรงดันเหนี่ยวนำสูงมาก (${Math.abs(r.voltage).toFixed(0)} V) จากการตัดกระแสทันที — วงจรจริงต้องมีไดโอดป้องกัน (flyback) ค่าที่แสดงขึ้นกับแบบจำลองและอาจไม่ตรงกับของจริง` });
      }
      break;
    case 'diode': {
      const zener = part.params.model === 'Z5V1';
      if (Math.abs(r.current) > part.params.maxCurrent) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแส ${fmtA(Math.abs(r.current))} เกินพิกัด ${fmtA(part.params.maxCurrent)} — ไดโอดจริงอาจเสียหาย ควรมีตัวต้านทานจำกัดกระแส ${teach}` });
      } else if (Math.abs(r.power) > part.params.maxPower) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลัง ${(Math.abs(r.power) * 1000).toFixed(0)} mW เกินพิกัด ${part.params.maxPower} W ${teach}` });
      }
      if (r.voltage < -part.params.Bv * 0.98 && r.current < -part.params.Ibv * 0.01) {
        diags.push(zener
          ? { severity: 'info', partId: part.id, message: `${part.label}: ซีเนอร์ทำงานในย่านพังทลาย คุมแรงดันไว้ราว ${(-r.voltage).toFixed(2)} V (กระแสย้อน ${fmtA(-r.current)})` }
          : { severity: 'danger', partId: part.id, message: `${part.label}: แรงดันย้อน ${(-r.voltage).toFixed(1)} V ถึงแรงดันพังทลาย ${part.params.Bv} V — ไดโอดเรียงกระแสทั่วไปจะเสียหาย ${teach}` });
      }
      break;
    }
    case 'bjt': {
      const x = r.extra ?? {};
      const vce = part.params.polarity === 'npn' ? r.voltage : -r.voltage;
      if (Math.abs(r.current) > part.params.maxIc) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: Ic ${fmtA(Math.abs(r.current))} เกินพิกัด ${fmtA(part.params.maxIc)} — ตรวจตัวต้านทานที่ขา C หรือ B ${teach}` });
      }
      if (Math.abs(r.power) > part.params.maxPower) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${(Math.abs(r.power) * 1000).toFixed(0)} mW เกินพิกัด ${part.params.maxPower} W — ทรานซิสเตอร์จริงจะร้อนจัด ${teach}` });
      }
      if (vce > part.params.maxVce) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: Vce ${vce.toFixed(1)} V เกินพิกัด ${part.params.maxVce} V ${teach}` });
      if (Math.abs(x.ib ?? 0) > 0.05) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสเบส ${fmtA(Math.abs(x.ib))} สูงมาก — ขา B น่าจะต่อเข้าแหล่งจ่ายโดยไม่มีตัวต้านทานจำกัดกระแส ${teach}` });
      if (x.region === 3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ทำงานในย่านกลับทิศ (reverse active) — ขา C กับ E อาจสลับกัน ตรวจลำดับขา E–B–C` });
      break;
    }
    case 'mosfet': {
      const x = r.extra ?? {};
      const pol = part.params.polarity === 'n' ? 1 : -1;
      const vds = pol * r.voltage, vgs = pol * (x.vgs ?? 0);
      const id = Math.abs(r.current);
      if (id > part.params.maxId) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กระแสเดรน ${fmtA(id)} เกินพิกัด ${fmtA(part.params.maxId)} ${teach}` });
      }
      if (Math.abs(r.power) > part.params.maxPower) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: กำลังสูญเสีย ${(Math.abs(r.power) * 1000).toFixed(0)} mW เกินพิกัด ${part.params.maxPower} W${part.params.model === '2N7000' ? '' : ' (ไม่มีฮีตซิงก์)'} — ตัวถังจะร้อนจัด ${teach}` });
      }
      if (vds > part.params.maxVds) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: Vds ${vds.toFixed(1)} V เกินพิกัด ${part.params.maxVds} V ${teach}` });
      if (Math.abs(vgs) > part.params.maxVgs) {
        r.overRated = true;
        diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: |Vgs| ${Math.abs(vgs).toFixed(1)} V เกินพิกัด ±${part.params.maxVgs} V — ฉนวนเกตจริงจะทะลุเสียหาย ${teach}` });
      }
      // เปิดไม่สุด: มีกระแสโหลดแต่ยังอยู่ย่านอิ่มตัว (เกตขับไม่พอ) → Rds สูงและร้อน
      if (id > 0.005 && x.region === 2 && vds > 0.3) {
        diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: เปิดไม่สุด (ย่านอิ่มตัว) Vgs ${Math.abs(x.vgs ?? 0).toFixed(2)} V ใกล้ขีดเริ่ม ${part.params.vth} V — Vds ค้าง ${vds.toFixed(2)} V โหลดได้ไฟไม่เต็ม ควรขับเกตแรงขึ้น หรือใช้ MOSFET แบบ logic-level` });
      }
      if (x.region === 3) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสไหลจาก S ไป D (กลับทิศ) — ตรวจลำดับขา${part.params.model === '2N7000' ? ' S–G–D' : ' G–D–S'}` });
      break;
    }
    case 'opamp': {
      const x = r.extra ?? {};
      const vs = x.vsupply ?? 0;
      const minSupply = 2 * part.params.headroom + 0.5;
      if (vs < -0.5) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยงกลับขั้ว (V+ ต่ำกว่า V− ${(-vs).toFixed(1)} V) — ไอซีจริงจะเสียหาย ${teach}` });
      else if (vs > part.params.maxSupply) diags.push({ severity: 'danger', partId: part.id, message: `${part.label}: ไฟเลี้ยง ${vs.toFixed(1)} V เกินพิกัด ${part.params.maxSupply} V ${teach}` });
      else if (vs < minSupply) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: ไฟเลี้ยง V+ − V− = ${vs.toFixed(2)} V ไม่พอให้ทำงาน (ต้องมากกว่าราว ${minSupply.toFixed(1)} V) — ตรวจการต่อขา 7 (V+) และขา 4 (V−)` });
      else if (x.saturated) diags.push({ severity: 'info', partId: part.id, message: `${part.label}: ขาออกอิ่มตัว (ชนไฟเลี้ยง) ${r.voltage.toFixed(2)} V เทียบ V− — สัญญาณเข้าใหญ่เกิน อัตราขยายสูงเกิน หรือไม่มีการป้อนกลับลบ` });
      if (Math.abs(r.current) > 0.025) diags.push({ severity: 'warn', partId: part.id, message: `${part.label}: กระแสขาออก ${fmtA(Math.abs(r.current))} สูง — ไอซีจริงจำกัดกระแสราว 25 mA แบบจำลองนี้ไม่จำกัดกระแสขาออก ค่าที่ได้อาจสูงกว่าของจริง` });
      break;
    }
    default:
      break;
  }
}

/**
 * บัซเซอร์ดังหรือไม่ ที่ความถี่ใด และดังแค่ไหน (0..1, เชิงประมาณสำหรับเสียงในแอป)
 *  - active: วงจรในตัวกำเนิดเสียงที่ความถี่ของตัวเองเมื่อแรงดันพอ (≥ 3 V) — ถ้าไฟเลี้ยงถูกตัดต่อเป็นจังหวะ (PWM ช้า) ดังตามกระแสเฉลี่ย
 *  - passive: ดังที่ความถี่ของกระแสที่ป้อน (ต้องแกว่ง ≥ 1 mA) ความดังตามแอมพลิจูดและระยะห่างจากความถี่เรโซแนนซ์
 */
export function buzzerSound(part: Extract<Part, { kind: 'buzzer' }>, current: number, voltage: number, tn?: ToneReading): { on: boolean; freq: number | null; level: number } {
  const p = part.params;
  if (p.type === 'active') {
    const i = tn ? tn.idc : current;
    const vEq = tn ? Math.max(voltage, 0) : voltage;
    if (!(i > p.ratedCurrent * 0.3) || vEq < 0) return { on: false, freq: null, level: 0 };
    return { on: true, freq: p.frequency, level: Math.min(1, i / p.ratedCurrent) };
  }
  if (!tn || tn.freq === null || tn.iac < 1e-3 || tn.freq < 20 || tn.freq > 20000) return { on: false, freq: null, level: 0 };
  const x = Math.log2(tn.freq / p.frequency);
  const resonance = 1 / (1 + 4 * x * x); // ดังสุดที่เรโซแนนซ์ ลดลงเมื่อห่างออกไป (≈ −7 dB ที่ ±1 octave)
  return { on: true, freq: tn.freq, level: Math.min(1, (tn.iac / (p.ratedCurrent / 2)) * resonance) };
}


function fmtOhmShort(r: number): string { return r >= 1e6 ? `${+(r / 1e6).toFixed(2)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toFixed(2)} kΩ` : `${+r.toFixed(1)} Ω`; }
