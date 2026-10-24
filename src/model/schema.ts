import { BOARD_MODELS, holeAt, holeInfo, type BoardModel } from './breadboard';
import { BODE_DEFAULTS, DMM_MODES, VOM_POSITIONS, opampParamsFor, pinDefs, rotateOffset } from './catalog';
import { relayoutBench } from './bench';
import { checkPlacement } from './geometry';
import {
  FILE_FORMAT, SCHEMA_VERSION, emptyWork,
  type CircuitDoc, type Part, type ProjectFile, type Rotation, type StudentWork, type TerminalRef, type Wire,
} from './types';

/**
 * ตรวจความถูกต้องของไฟล์ JSON ก่อนโหลด
 * - ตรวจ format / schemaVersion
 * - ตรวจชนิดข้อมูลและช่วงค่าพารามิเตอร์
 * - ตรวจการอ้างอิง (ปลายสาย/โพรบต้องชี้ไปยังรูหรือขั้วที่มีจริง) และ ID ไม่ซ้ำ
 * - ตรวจการวางซ้ำรู
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  file?: ProjectFile;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function num(errors: string[], where: string, v: unknown, min: number, max: number): number {
  if (!isNum(v)) { errors.push(`${where}: ต้องเป็นตัวเลข`); return min; }
  if (v < min || v > max) errors.push(`${where}: ค่า ${v} อยู่นอกช่วง ${min}–${max}`);
  return v;
}

export const PARAM_LIMITS = {
  voltage: [0, 30], currentLimit: [0.001, 3], internalResistance: [0.001, 10],
  resistance: [0.1, 1e7], powerRating: [0.01, 10], span: [1, 10],
  vth: [0.2, 6], kp: [1e-4, 100], lambda: [0, 0.5], maxId: [1e-3, 200], maxVds: [1, 1000], maxVgs: [1, 40],
  ctr: [0.05, 20], Is: [1e-40, 1e-6], n: [1, 5], Rs: [0, 1000], ratedCurrent: [1e-4, 100], maxCurrent: [1e-4, 1], maxReverseVoltage: [0.1, 100],
  onResistance: [1e-4, 100], shuntResistance: [1e-3, 1000], range: [1e-4, 10],
  capacitance: [1e-12, 1], ratedVoltage: [1, 1000], initialVoltage: [-100, 100],
  inductance: [1e-9, 100],
  frequency: [0.01, 1e6], vpp: [0, 40], offset: [-20, 20], outputImpedance: [1, 1e4],
  inputResistance: [1e3, 1e9],
  igt: [1e-7, 0.1], ih: [1e-5, 1], r25: [10, 1e7], beta: [500, 10000], dissipation: [1e-5, 1],
  Bv: [1, 2000], Ibv: [1e-12, 1], maxPower: [0.01, 100], bf: [1, 2000], br: [0.01, 100], maxIc: [1e-3, 100], maxVce: [1, 1000],
  position: [0, 1], gearRatio: [1, 1000], ke: [1e-5, 1], inertia: [1e-10, 1], noLoadCurrent: [0, 5], viscous: [0, 1], gearEff: [0.05, 1], loadTorque: [0, 10], pulseMin: [1e-4, 0.01], pulseMax: [2e-4, 0.02], speed: [1, 1e5], vMin: [0.5, 50], vMax: [1, 100], idleCurrent: [1e-5, 1], vRated: [1, 60], iRated: [0.01, 20], regulation: [0, 1], vout: [1, 40], dropout: [0.1, 5], quiescentCurrent: [1e-5, 0.05], maxInput: [1, 100], rOut: [0, 10], maxLoad: [0.01, 10], outHighDrop: [0, 5], outHighResistance: [0.1, 1000], outLowResistance: [0.1, 1000], dischargeResistance: [0.1, 1e4], minSupply: [0.5, 50], maxOutputCurrent: [1e-3, 10], coilInductance: [1e-4, 10], vPick: [0.5, 50], vDrop: [0.05, 40], contactRating: [0.01, 100], baseResistance: [10, 1e6], lux: [0, 200000], temperature: [-55, 150], r10: [100, 1e7], gamma: [0.1, 2], rdark: [1e3, 1e9], coilResistance: [1, 1e4], contactResistance: [1e-3, 10], maxVoltage: [1, 1000], endResistance: [0, 1000], gain: [10, 1e8], gbw: [1e3, 1e9], slewRate: [1e3, 1e10], outputResistance: [1, 1e4], headroom: [0, 5], maxSupply: [1, 100], quiescentResistance: [100, 1e9], timeDiv: [1e-7, 10], bodeStart: [0.1, 1e6], bodeStop: [1, 1e7], bodePpd: [2, 100], vdiv1: [1e-3, 50], vdiv2: [1e-3, 50], trigLevel: [-50, 50],
} as const;

function validTerminal(t: unknown, doc: { parts: Part[]; boardIds: Set<string>; boardModels?: Map<string, BoardModel> }, where: string, errors: string[]): t is TerminalRef {
  if (!isObj(t)) { errors.push(`${where}: ไม่ใช่จุดต่อ`); return false; }
  if (t.kind === 'hole') {
    if (!isStr(t.boardId) || !doc.boardIds.has(t.boardId)) { errors.push(`${where}: ไม่พบเบรดบอร์ด ${String(t.boardId)}`); return false; }
    if (!isStr(t.hole) || !holeInfo(t.hole, doc.boardModels?.get(t.boardId))) { errors.push(`${where}: ไม่มีรู ${String(t.hole)}${doc.boardModels?.get(t.boardId) === 'CL-400' && holeInfo(String(t.hole)) ? ' บนบอร์ด CL-400' : ''}`); return false; }
    return true;
  }
  if (t.kind === 'pin') {
    const part = doc.parts.find((p) => p.id === t.partId);
    if (!part) { errors.push(`${where}: ไม่พบอุปกรณ์ ${String(t.partId)}`); return false; }
    if (!pinDefs(part).some((p) => p.name === t.pin)) { errors.push(`${where}: ${part.label} ไม่มีขั้ว ${String(t.pin)}`); return false; }
    return true;
  }
  errors.push(`${where}: ชนิดจุดต่อไม่ถูกต้อง`);
  return false;
}

function validatePart(raw: unknown, i: number, errors: string[]): Part | null {
  const where = `อุปกรณ์ลำดับที่ ${i + 1}`;
  if (!isObj(raw)) { errors.push(`${where}: รูปแบบไม่ถูกต้อง`); return null; }
  if (!isStr(raw.id) || !raw.id) { errors.push(`${where}: ไม่มี id`); return null; }
  if (!isStr(raw.label)) errors.push(`${where}: ไม่มี label`);
  const pl = raw.placement;
  if (!isObj(pl)) { errors.push(`${where}: ไม่มี placement`); return null; }
  if (![0, 90, 180, 270].includes(pl.rotation as number)) errors.push(`${where}: rotation ต้องเป็น 0/90/180/270`);
  if (pl.kind === 'board') {
    if (!isStr(pl.anchor) || !holeInfo(pl.anchor)) errors.push(`${where}: รู anchor ไม่ถูกต้อง`);
  } else if (pl.kind === 'table') {
    num(errors, `${where}.x`, pl.x, -250, 250); num(errors, `${where}.z`, pl.z, -250, 250);
  } else errors.push(`${where}: ชนิด placement ไม่ถูกต้อง`);
  const p = raw.params;
  if (!isObj(p)) { errors.push(`${where}: ไม่มี params`); return null; }
  const L = PARAM_LIMITS;
  const chk = (k: keyof typeof L) => num(errors, `${where}.${k}`, p[k], L[k][0], L[k][1]);
  switch (raw.kind) {
    case 'dcsupply': chk('voltage'); chk('currentLimit'); chk('internalResistance'); if (typeof p.outputOn !== 'boolean') errors.push(`${where}.outputOn ต้องเป็น true/false`); break;
    case 'sonar': chk('temperature'); chk('vMin'); chk('vMax'); num(errors, `${where}.distance`, p.distance, 1, 1000);
      if (p.model !== 'HC-SR04') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'hbridge': chk('maxOutputCurrent'); chk('vMin'); chk('vMax');
      num(errors, `${where}.peakOutputCurrent`, p.peakOutputCurrent, 0.01, 10); num(errors, `${where}.vMotorMax`, p.vMotorMax, 1, 100);
      if (p.model !== 'L293D') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'lm35': chk('temperature'); chk('quiescentCurrent'); chk('rOut'); chk('vMin'); chk('vMax'); chk('maxOutputCurrent');
      if (p.model !== 'LM35DZ') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'stepper': num(errors, `${where}.coilResistance`, p.coilResistance, 1, 1000); num(errors, `${where}.stepsPerRev`, p.stepsPerRev, 8, 100000);
      num(errors, `${where}.pullIn`, p.pullIn, 1, 100000); num(errors, `${where}.pullOut`, p.pullOut, 1, 100000); num(errors, `${where}.minCoilCurrent`, p.minCoilCurrent, 1e-4, 10); num(errors, `${where}.vRated`, p.vRated, 1, 50);
      if (p.model !== '28BYJ-48') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'opto': chk('Is'); chk('n'); chk('Rs'); chk('ctr');
      num(errors, `${where}.maxForwardCurrent`, p.maxForwardCurrent, 1e-3, 1); num(errors, `${where}.maxReverseVoltage`, p.maxReverseVoltage, 1, 100);
      num(errors, `${where}.maxCollectorCurrent`, p.maxCollectorCurrent, 1e-3, 1); num(errors, `${where}.vceo`, p.vceo, 1, 1000);
      if (p.model !== 'PC817') errors.push(`${where}.model ไม่รู้จัก`);
      if (!['A', 'B', 'C', 'D'].includes(p.rank as string)) errors.push(`${where}.rank ต้องเป็น A–D`); break;
    case 'shiftreg': chk('kp'); chk('vth'); chk('lambda'); chk('vMin'); chk('vMax'); chk('maxOutputCurrent');
      num(errors, `${where}.maxSupplyCurrent`, p.maxSupplyCurrent, 0.001, 1);
      if (p.model !== '74HC595') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'counter': chk('kp'); chk('vth'); chk('lambda'); chk('vMin'); chk('vMax'); chk('maxOutputCurrent');
      if (p.model !== 'CD4017B') errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'logic': chk('outputResistance'); chk('vMin'); chk('vMax'); chk('maxOutputCurrent');
      if (!['74HC00', '74HC02', '74HC04', '74HC08', '74HC32', '74HC86'].includes(p.model as string)) errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'motor': chk('gearRatio'); chk('ke'); chk('resistance'); chk('inductance'); chk('inertia'); chk('noLoadCurrent'); chk('viscous'); chk('gearEff'); chk('loadTorque'); break;
    case 'servo': chk('pulseMin'); chk('pulseMax'); chk('speed'); chk('vMin'); chk('vMax'); chk('idleCurrent');
      if ((p.pulseMin as number) >= (p.pulseMax as number)) errors.push(`${where}: ความกว้างพัลส์ที่ 0° ต้องน้อยกว่าที่ 180°`); break;
    case 'transformer': chk('vRated'); chk('iRated'); chk('regulation'); chk('frequency');
      if (p.frequency !== 50 && p.frequency !== 60) errors.push(`${where}.frequency ต้องเป็น 50 หรือ 60 Hz`);
      if (typeof p.on !== 'boolean') errors.push(`${where}.on ต้องเป็น true/false`); break;
    case 'vreg': chk('vout'); chk('dropout'); chk('quiescentCurrent'); chk('rOut'); chk('maxInput'); chk('maxLoad');
      if (!['L7805', 'L7809', 'L7812'].includes(p.model as string)) errors.push(`${where}.model ต้องเป็น L7805/L7809/L7812`);
      if (typeof p.heatsink !== 'boolean') errors.push(`${where}.heatsink ต้องเป็น true/false`); break;
    case 'timer555': chk('outHighDrop'); chk('outHighResistance'); chk('outLowResistance'); chk('dischargeResistance'); chk('quiescentResistance'); chk('minSupply'); chk('maxSupply'); chk('maxOutputCurrent');
      if (p.model !== 'NE555') errors.push(`${where}.model ต้องเป็น NE555`);
      if ((p.minSupply as number) >= (p.maxSupply as number)) errors.push(`${where}: ไฟเลี้ยงต่ำสุดต้องน้อยกว่าสูงสุด`); break;
    case 'relay': chk('coilResistance'); chk('coilInductance'); chk('vPick'); chk('vDrop'); chk('contactResistance'); chk('contactRating'); chk('baseResistance');
      if ((p.vDrop as number) >= (p.vPick as number)) errors.push(`${where}: แรงดันปล่อยต้องน้อยกว่าแรงดันดึง`); break;
    case 'sevenseg': chk('Is'); chk('n'); chk('Rs'); chk('ratedCurrent'); chk('maxCurrent'); chk('maxReverseVoltage');
      if (!['cc', 'ca'].includes(p.common as string)) errors.push(`${where}.common ต้องเป็น cc/ca`); break;
    case 'lm386':
      if (p.model !== 'LM386N-1') errors.push(`${where}.model ไม่รู้จัก`);
      num(errors, `${where}.rf`, p.rf, 100, 1e7); num(errors, `${where}.ra`, p.ra, 1, 1e6); num(errors, `${where}.rb`, p.rb, 1, 1e6); num(errors, `${where}.rin`, p.rin, 1e3, 1e8);
      num(errors, `${where}.gbw`, p.gbw, 1e3, 1e9); num(errors, `${where}.headroom`, p.headroom, 0, 5); num(errors, `${where}.quiescentCurrent`, p.quiescentCurrent, 0, 0.1); num(errors, `${where}.vMin`, p.vMin, 0, 50); num(errors, `${where}.vMax`, p.vMax, 1, 50); break;
    case 'speaker': num(errors, `${where}.impedance`, p.impedance, 1, 100); num(errors, `${where}.maxPower`, p.maxPower, 0.01, 100); break;
    case 'darlington':
      if (p.model !== 'TIP120') errors.push(`${where}.model ไม่รู้จัก`);
      num(errors, `${where}.bf1`, p.bf1, 1, 1e4); num(errors, `${where}.bf2`, p.bf2, 1, 1e4); num(errors, `${where}.is1`, p.is1, 1e-20, 1e-6); num(errors, `${where}.is2`, p.is2, 1e-20, 1e-6);
      num(errors, `${where}.r1`, p.r1, 1, 1e7); num(errors, `${where}.r2`, p.r2, 1, 1e6); num(errors, `${where}.rc`, p.rc, 1e-4, 100); num(errors, `${where}.re`, p.re, 1e-4, 100); num(errors, `${where}.maxIc`, p.maxIc, 1e-3, 100); num(errors, `${where}.maxVce`, p.maxVce, 1, 2000);
      if (typeof p.heatsink !== 'boolean') errors.push(`${where}.heatsink ต้องเป็น true/false`); break;
    case 'comparator':
      if (p.model !== 'LM393') errors.push(`${where}.model ไม่รู้จัก`);
      num(errors, `${where}.ron`, p.ron, 0.1, 1e4); num(errors, `${where}.sinkMax`, p.sinkMax, 1e-4, 1); num(errors, `${where}.quiescentCurrent`, p.quiescentCurrent, 0, 0.1); num(errors, `${where}.vMin`, p.vMin, 0, 50); num(errors, `${where}.vMax`, p.vMax, 1, 100); break;
    case 'ntc': num(errors, `${where}.temperature`, p.temperature, -55, 150); chk('r25'); chk('beta'); chk('dissipation'); chk('maxPower'); chk('span'); if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`); break;
    case 'ldr': chk('lux'); chk('r10'); chk('gamma'); chk('rdark'); chk('maxPower'); chk('span'); if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`); break;
    case 'buzzer': chk('ratedVoltage'); chk('ratedCurrent'); chk('frequency'); chk('coilResistance');
      if (!['active', 'passive'].includes(p.type as string)) errors.push(`${where}.type ต้องเป็น active/passive`); break;
    case 'pushbutton': chk('contactResistance'); chk('maxCurrent'); chk('maxVoltage'); if (typeof p.pressed !== 'boolean') errors.push(`${where}.pressed ต้องเป็น true/false`); break;
    case 'potentiometer': chk('resistance'); chk('position'); chk('endResistance'); chk('powerRating'); break;
    case 'resistor': chk('resistance'); chk('powerRating'); chk('span'); if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`); break;
    case 'led': chk('Is'); chk('n'); chk('Rs'); chk('ratedCurrent'); chk('maxCurrent'); chk('maxReverseVoltage');
      if (!['red', 'green', 'yellow', 'blue', 'white'].includes(p.color as string)) errors.push(`${where}.color ไม่รู้จัก`); break;
    case 'switch': chk('onResistance'); if (typeof p.closed !== 'boolean') errors.push(`${where}.closed ต้องเป็น true/false`); break;
    case 'ammeter': chk('shuntResistance'); chk('range'); break;
    case 'dmm':
      if (!DMM_MODES.some((m) => m.id === p.mode)) errors.push(`${where}.mode ไม่รู้จัก`);
      num(errors, `${where}.inputResistance`, p.inputResistance, 1e3, 1e10); num(errors, `${where}.mvInputResistance`, p.mvInputResistance, 1e3, 1e10);
      num(errors, `${where}.shuntA`, p.shuntA, 1e-4, 10); num(errors, `${where}.shuntMa`, p.shuntMa, 1e-3, 1e3);
      num(errors, `${where}.fuseA`, p.fuseA, 1e-3, 100); num(errors, `${where}.fuseMa`, p.fuseMa, 1e-3, 100);
      num(errors, `${where}.ohmVoc`, p.ohmVoc, 0.1, 10); num(errors, `${where}.ohmRs`, p.ohmRs, 1, 1e7); break;
    case 'lm317':
      if (p.model !== 'LM317') errors.push(`${where}.model ไม่รู้จัก`);
      num(errors, `${where}.vref`, p.vref, 0.5, 5); num(errors, `${where}.iadj`, p.iadj, 0, 1e-3); num(errors, `${where}.minLoad`, p.minLoad, 0, 0.1);
      num(errors, `${where}.dropout`, p.dropout, 0.1, 10); num(errors, `${where}.maxDiff`, p.maxDiff, 1, 100); num(errors, `${where}.maxLoad`, p.maxLoad, 1e-3, 20);
      if (typeof p.heatsink !== 'boolean') errors.push(`${where}.heatsink ต้องเป็น true/false`); break;
    case 'scr':
      if (p.model !== '2N5060') errors.push(`${where}.model ไม่รู้จัก`);
      num(errors, `${where}.igt`, p.igt, 1e-7, 0.1); num(errors, `${where}.ih`, p.ih, 1e-5, 1); num(errors, `${where}.vdrm`, p.vdrm, 1, 2000); num(errors, `${where}.maxCurrent`, p.maxCurrent, 1e-3, 100); break;
    case 'vom':
      if (!VOM_POSITIONS.some((x) => x.id === p.sel)) errors.push(`${where}.sel ไม่รู้จัก`);
      num(errors, `${where}.sensitivityDC`, p.sensitivityDC, 100, 1e6); num(errors, `${where}.sensitivityAC`, p.sensitivityAC, 100, 1e6);
      num(errors, `${where}.battery`, p.battery, 0.5, 20); num(errors, `${where}.centerOhm`, p.centerOhm, 1, 1e5); num(errors, `${where}.fuse`, p.fuse, 1e-3, 100); break;
    case 'capacitor': chk('capacitance'); chk('ratedVoltage'); chk('initialVoltage'); chk('span');
      if (typeof p.polarized !== 'boolean') errors.push(`${where}.polarized ต้องเป็น true/false`);
      if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`); break;
    case 'diode': chk('Is'); chk('n'); chk('Rs'); chk('Bv'); chk('Ibv'); chk('maxCurrent'); chk('maxPower'); chk('span');
      if (!['1N4148', '1N4007', 'Z5V1'].includes(p.model as string)) errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'bjt': chk('Is'); chk('bf'); chk('br'); chk('maxIc'); chk('maxVce'); chk('maxPower');
      if (!['npn', 'pnp'].includes(p.polarity as string)) errors.push(`${where}.polarity ต้องเป็น npn/pnp`); break;
    case 'mosfet': {
      chk('vth'); chk('kp'); chk('lambda'); chk('maxId'); chk('maxVds'); chk('maxVgs'); chk('maxPower');
      if (!['2N7000', 'IRLZ44N', 'IRF9540N'].includes(p.model as string)) errors.push(`${where}.model ไม่รู้จัก`);
      if (!['n', 'p'].includes(p.polarity as string)) errors.push(`${where}.polarity ต้องเป็น n/p`);
      const bd = p.body as Record<string, unknown> | undefined;
      if (!isObj(bd)) errors.push(`${where}.body ต้องมีค่าไดโอดในตัว`);
      else { num(errors, `${where}.body.Is`, bd.Is, 1e-20, 1e-3); num(errors, `${where}.body.n`, bd.n, 1, 5); num(errors, `${where}.body.Rs`, bd.Rs, 0, 100); }
      break;
    }
    case 'opamp': chk('gain'); chk('outputResistance'); chk('headroom'); chk('maxSupply'); chk('inputResistance'); chk('quiescentResistance'); chk('gbw'); chk('slewRate');
      if (!['LM741', 'MCP6002'].includes(p.model as string)) errors.push(`${where}.model ไม่รู้จัก`); break;
    case 'fgen': chk('frequency'); chk('vpp'); chk('offset'); chk('outputImpedance');
      if (!['sine', 'square', 'triangle', 'dc'].includes(p.wave as string)) errors.push(`${where}.wave ไม่รู้จัก`);
      if (typeof p.outputOn !== 'boolean') errors.push(`${where}.outputOn ต้องเป็น true/false`); break;
    case 'pico':
      if (typeof p.code !== 'string' || p.code.length > 50000) errors.push(`${where}.code ต้องเป็นข้อความไม่เกิน 50,000 ตัวอักษร`);
      if (typeof p.autorun !== 'boolean') errors.push(`${where}.autorun ต้องเป็น true/false`); break;
    case 'scope': chk('inputResistance'); chk('timeDiv'); chk('vdiv1'); chk('vdiv2'); chk('trigLevel');
      if (typeof p.ch1On !== 'boolean' || typeof p.ch2On !== 'boolean') errors.push(`${where}: ch1On/ch2On ต้องเป็น true/false`);
      if (!['ch1', 'ch2'].includes(p.trigSource as string)) errors.push(`${where}.trigSource ต้องเป็น ch1/ch2`);
      if (!['rise', 'fall'].includes(p.trigSlope as string)) errors.push(`${where}.trigSlope ต้องเป็น rise/fall`);
      if ((p.ac1 !== undefined && typeof p.ac1 !== 'boolean') || (p.ac2 !== undefined && typeof p.ac2 !== 'boolean')) errors.push(`${where}: ac1/ac2 ต้องเป็น true/false`);
      chk('bodeStart'); chk('bodeStop'); chk('bodePpd');
      if (!(Number(p.bodeStop) > Number(p.bodeStart))) errors.push(`${where}: ความถี่สิ้นสุดของกราฟโบดต้องมากกว่าความถี่เริ่ม`);
      if (!['ch1', 'source'].includes(p.bodeRef as string)) errors.push(`${where}.bodeRef ต้องเป็น ch1/source`); break;
    case 'inductor': chk('inductance'); chk('span'); num(errors, `${where}.resistance`, p.resistance, 0, 1e4);
      chk('ratedCurrent');
      if (!Number.isInteger(p.span)) errors.push(`${where}.span ต้องเป็นจำนวนเต็ม`); break;
    default: errors.push(`${where}: ไม่รู้จักชนิดอุปกรณ์ "${String(raw.kind)}"`); return null;
  }
  return raw as unknown as Part;
}

export function validateCircuit(raw: unknown, errors: string[], warnings: string[]): CircuitDoc | null {
  if (!isObj(raw)) { errors.push('circuit: ไม่พบข้อมูลวงจร'); return null; }
  const boards = raw.breadboards;
  if (!Array.isArray(boards) || boards.length < 1) { errors.push('circuit.breadboards: ต้องมีเบรดบอร์ดอย่างน้อย 1'); return null; }
  const boardIds = new Set<string>();
  const boardModels = new Map<string, BoardModel>();
  boards.forEach((b, i) => {
    if (!isObj(b) || !isStr(b.id) || !BOARD_MODELS.includes(b.model as BoardModel)) { errors.push(`เบรดบอร์ดลำดับ ${i + 1}: รุ่นต้องเป็น ${BOARD_MODELS.join(' หรือ ')}`); return; }
    num(errors, `เบรดบอร์ดลำดับ ${i + 1}.x`, b.x, -60, 60); num(errors, `เบรดบอร์ดลำดับ ${i + 1}.z`, b.z, -40, 40);
    boardIds.add(b.id); boardModels.set(b.id, b.model as BoardModel);
  });
  if (!Array.isArray(raw.parts)) { errors.push('circuit.parts ต้องเป็น array'); return null; }
  if (!Array.isArray(raw.wires)) { errors.push('circuit.wires ต้องเป็น array'); return null; }
  const parts: Part[] = [];
  const ids = new Set<string>();
  raw.parts.forEach((rp, i) => {
    const p = validatePart(rp, i, errors);
    if (!p) return;
    if (ids.has(p.id)) errors.push(`id ซ้ำ: ${p.id}`);
    ids.add(p.id);
    if (p.placement.kind === 'board' && !boardIds.has(p.placement.boardId)) errors.push(`${p.label}: ไม่พบเบรดบอร์ด ${p.placement.boardId}`);
    parts.push(p);
  });
  const ctx = { parts, boardIds, boardModels };
  const wires: Wire[] = [];
  raw.wires.forEach((rw, i) => {
    const where = `สายลำดับ ${i + 1}`;
    if (!isObj(rw) || !isStr(rw.id)) { errors.push(`${where}: รูปแบบไม่ถูกต้อง`); return; }
    if (ids.has(rw.id)) errors.push(`id ซ้ำ: ${rw.id}`);
    ids.add(rw.id);
    const okA = validTerminal(rw.a, ctx, `${where} ปลาย a`, errors);
    const okB = validTerminal(rw.b, ctx, `${where} ปลาย b`, errors);
    if (!isStr(rw.color) || !/^#[0-9a-fA-F]{6}$/.test(rw.color)) errors.push(`${where}: สีต้องเป็นรูปแบบ #rrggbb`);
    num(errors, `${where}.arc`, rw.arc, 0, 20); num(errors, `${where}.bend`, rw.bend, -20, 20);
    if (okA && okB) wires.push(rw as unknown as Wire);
  });
  const probes = isObj(raw.probes) ? raw.probes : { red: null, black: null };
  const pr = { red: null as TerminalRef | null, black: null as TerminalRef | null };
  for (const k of ['red', 'black'] as const) {
    if (probes[k] == null) continue;
    if (validTerminal(probes[k], ctx, `โพรบ${k === 'red' ? 'แดง' : 'ดำ'}`, errors)) pr[k] = probes[k] as TerminalRef;
  }
  const doc: CircuitDoc = { breadboards: boards as CircuitDoc['breadboards'], parts, wires, probes: pr };
  if (errors.length === 0) {
    for (const p of parts) {
      const c = checkPlacement(doc, p);
      for (const e of c.errors) errors.push(`${p.label}: ${e}`);
      for (const w of c.warnings) warnings.push(`${p.label}: ${w}`);
    }
    const seen = new Map<string, string>();
    for (const w of wires) for (const t of [w.a, w.b]) if (t.kind === 'hole') {
      const k = `${t.boardId}/${t.hole}`;
      if (seen.has(k)) errors.push(`รู ${t.hole} มีปลายสายซ้อนกัน (${seen.get(k)}, ${w.id})`);
      seen.set(k, w.id);
    }
  }
  return doc;
}

function validateWork(raw: unknown, warnings: string[]): StudentWork {
  if (!isObj(raw)) return emptyWork();
  const w = emptyWork();
  w.lessonId = isStr(raw.lessonId) ? raw.lessonId : null;
  for (const k of ['records', 'answers', 'achieved'] as const) {
    if (isObj(raw[k])) (w as unknown as Record<string, unknown>)[k] = raw[k];
    else if (raw[k] !== undefined) warnings.push(`studentWork.${k} รูปแบบไม่ถูกต้อง — ข้ามไป`);
  }
  return w;
}

/**
 * อัปเกรดไฟล์รุ่นเก่า
 * 1 → 2 → 3 → 4: แต่ละรุ่นเพิ่มเฉพาะชนิดอุปกรณ์ใหม่ (capacitor/inductor, fgen/scope, diode/bjt/opamp) โครงสร้างเดิมเหมือนเดิม จึงอ่านได้ทันที
 * 4 → 5: เติมค่าตั้งกราฟโบดให้ออสซิลโลสโคป
 * 5 → 6: เพิ่ม Raspberry Pi Pico (ไม่ต้องแปลงข้อมูลเดิม)
 * 6 → 7: แก้ลำดับขาของออปแอมป์ DIP-8 และ Pico ให้เรียงทวนเข็มนาฬิกาเมื่อมองจากด้านบนเหมือนของจริง
 *         (รุ่นก่อนเรียงกลับด้านเหมือนภาพสะท้อน) — คงตำแหน่งตัวอุปกรณ์บนบอร์ดเดิมโดยย้าย anchor ไปแถวอีกฝั่ง
 *         ขาแต่ละขาจึงย้ายไปอยู่อีกฝั่งร่องกลาง ผู้ใช้ต้องตรวจสายที่ต่อกับอุปกรณ์เหล่านี้ (แจ้งเป็นคำเตือน)
 * 30 → 31: เพิ่มไทริสเตอร์ SCR 2N5060 (ไม่ต้องแปลงข้อมูลเดิม)
 * 31 → 32: เพิ่มไอซีคงแรงดันปรับค่าได้ LM317 (ไม่ต้องแปลงข้อมูลเดิม)
 * 32 → 33: เพิ่มเทอร์มิสเตอร์ NTC (ไม่ต้องแปลงข้อมูลเดิม)
 * 33 → 34: เพิ่มคอมพาราเตอร์ LM393 (ไม่ต้องแปลงข้อมูลเดิม)
 * 34 → 35: เพิ่มทรานซิสเตอร์ดาร์ลิงตัน TIP120 (ไม่ต้องแปลงข้อมูลเดิม)
 * 35 → 36: เบรดบอร์ดรุ่น MB-102 (830 จุด) — ไฟล์เดิมเป็น CL-400 ทั้งหมด ไม่ต้องแปลง
 * 36 → 37: เพิ่มไอซีขยายเสียง LM386 และลำโพง 8 Ω (ไม่ต้องแปลงข้อมูลเดิม)
 * 29 → 30: เครื่องมือบนโต๊ะเป็นขนาดจริง (แหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคป/แอมมิเตอร์ใหญ่ขึ้น 3–4 เท่า) และเพิ่มมัลติมิเตอร์ดิจิทัล/แบบเข็ม
 *         — ตำแหน่งเดิมของเครื่องมือจะทับบอร์ด จึงจัดเครื่องมือลงช่องมาตรฐาน (แถวหลังบอร์ด/ข้างบอร์ด) ให้ใหม่ สายยังต่อขั้วเดิม
 * 28 → 29: เพิ่มชุดสเต็ปเปอร์มอเตอร์ 28BYJ-48 + บอร์ดขับ ULN2003 (ไม่ต้องแปลงข้อมูลเดิม)
 * 27 → 28: เพิ่มออปโตคัปเปลอร์ PC817 (ไม่ต้องแปลงข้อมูลเดิม)
 * 26 → 27: เพิ่มไอซีเลื่อนบิต 74HC595 (ไม่ต้องแปลงข้อมูลเดิม)
 * 25 → 26: เพิ่มโมดูลวัดระยะ HC-SR04 (ไม่ต้องแปลงข้อมูลเดิม)
 * 24 → 25: เพิ่มไอซีขับมอเตอร์ L293D (ไม่ต้องแปลงข้อมูลเดิม)
 * 23 → 24: เพิ่มเซนเซอร์อุณหภูมิ LM35 (ไม่ต้องแปลงข้อมูลเดิม)
 * 22 → 23: เพิ่มไอซีนับ CD4017 (ไม่ต้องแปลงข้อมูลเดิม)
 * 21 → 22: เพิ่มไอซีเกตตรรกะ 74HC (ไม่ต้องแปลงข้อมูลเดิม)
 * 20 → 21: เพิ่มมอเตอร์ DC เกียร์ TT (ไม่ต้องแปลงข้อมูลเดิม)
 * 19 → 20: เพิ่มเซอร์โวมอเตอร์ SG90 (ไม่ต้องแปลงข้อมูลเดิม)
 * 18 → 19: เพิ่มหม้อแปลงลดแรงดัน (ไม่ต้องแปลงข้อมูลเดิม)
 * 17 → 18: เพิ่มไอซีคงแรงดัน 78xx (ไม่ต้องแปลงข้อมูลเดิม)
 * 16 → 17: เพิ่มไอซีไทเมอร์ NE555 (ไม่ต้องแปลงข้อมูลเดิม)
 * 15 → 16: เพิ่มโมดูลรีเลย์ (ไม่ต้องแปลงข้อมูลเดิม)
 * 14 → 15: เพิ่มตัวแสดงผล 7 ส่วน (ไม่ต้องแปลงข้อมูลเดิม)
 * 13 → 14: เพิ่มตัวต้านทานไวแสง (ไม่ต้องแปลงข้อมูลเดิม)
 * 12 → 13: เพิ่มบัซเซอร์ (ไม่ต้องแปลงข้อมูลเดิม)
 * 11 → 12: เพิ่มสวิตช์ปุ่มกด 4 ขา (ไม่ต้องแปลงข้อมูลเดิม)
 * 10 → 11: เพิ่มตัวต้านทานปรับค่าได้ (ไม่ต้องแปลงข้อมูลเดิม)
 * 9 → 10: ออปแอมป์มี GBW และ slew rate — ไฟล์เดิมได้ค่าตามรุ่น (LM741 1 MHz / 0.5 V/µs, MCP6002 1 MHz / 0.6 V/µs)
 * 8 → 9: เพิ่มมอสเฟต (ไม่ต้องแปลงข้อมูลเดิม)
 * 7 → 8: อุปกรณ์ชนิดเสียบบอร์ดวางบนโต๊ะได้ (placement.kind = 'table', x/z = ตำแหน่งขาอ้างอิง)
 *         และสายต่อเข้าขาอุปกรณ์ได้โดยตรงแม้อุปกรณ์จะเสียบอยู่บนบอร์ดแล้ว — ไฟล์เดิมอ่านได้ทันที ไม่ต้องแปลง
 */
function migrate(raw: Record<string, unknown>, warnings: string[] = []): Record<string, unknown> {
  const v = Number(raw.schemaVersion);
  const circuit = raw.circuit;
  if (!isObj(circuit) || !Array.isArray(circuit.parts)) return { ...raw, schemaVersion: SCHEMA_VERSION };
  let parts = circuit.parts as unknown[];
  // 4 → 5: ออสซิลโลสโคปมีค่าตั้งกราฟโบด
  if (v < 5) parts = parts.map((p) => (isObj(p) && p.kind === 'scope' && isObj(p.params) ? { ...p, params: { ...BODE_DEFAULTS, ...p.params } } : p));
  // 6 → 7: ลำดับขา DIP-8 / Pico
  if (v < 7) {
    const moved: string[] = [];
    parts = parts.map((p) => {
      if (!isObj(p) || (p.kind !== 'opamp' && p.kind !== 'pico') || !isObj(p.placement) || p.placement.kind !== 'board') return p;
      const pl = p.placement as Record<string, unknown>;
      const a = holeInfo(String(pl.anchor));
      if (!a) return p;
      const span = p.kind === 'pico' ? 7 : 3;
      const [dx, dy] = rotateOffset(0, span, (pl.rotation ?? 0) as Rotation);
      const hole = holeAt(a.x + dx, a.y + dy);
      if (!hole) return p;
      moved.push(String(p.label ?? p.id));
      return { ...p, placement: { ...pl, anchor: hole } };
    });
    if (moved.length) warnings.push(`ไฟล์รุ่นก่อน 7: ลำดับขาของ ${moved.join(', ')} ถูกแก้ให้ตรงกับอุปกรณ์จริง (เดิมเรียงกลับด้าน) ตัวอุปกรณ์อยู่ตำแหน่งเดิม แต่ขา 1 ย้ายไปอยู่อีกฝั่งร่องกลาง — ตรวจสายที่ต่อกับอุปกรณ์เหล่านี้`);
  }
  // 9 → 10: GBW / slew rate ของออปแอมป์
  if (v < 10) parts = parts.map((p) => {
    if (!isObj(p) || p.kind !== 'opamp' || !isObj(p.params)) return p;
    const d = opampParamsFor(p.params.model === 'MCP6002' ? 'MCP6002' : 'LM741');
    return { ...p, params: { gbw: d.gbw, slewRate: d.slewRate, ...p.params } };
  });
  let out: Record<string, unknown> = { ...circuit, parts };
  // 29 → 30: เครื่องมือขนาดจริง — จัดลงช่องใหม่ (ข้อมูลเสีย → ปล่อยให้ validateCircuit รายงาน)
  if (v < 30) {
    try {
      const doc = out as unknown as CircuitDoc;
      if (Array.isArray(doc.breadboards) && doc.parts.some((p) => isObj(p) && isObj(p.placement) && p.placement.kind === 'table' && ['dcsupply', 'fgen', 'scope', 'ammeter'].includes(p.kind))) {
        out = relayoutBench(doc) as unknown as Record<string, unknown>;
        warnings.push('ไฟล์รุ่นก่อน 30: เครื่องมือบนโต๊ะเป็นขนาดจริงแล้ว จึงย้ายแหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคป/แอมมิเตอร์ไปวางแถวหลังและข้างบอร์ด — สายยังต่อขั้วเดิมทุกเส้น');
      }
    } catch { /* ข้อมูลไม่ครบ: ไม่จัดใหม่ */ }
  }
  return { ...raw, circuit: out, schemaVersion: SCHEMA_VERSION };
}

export function validateProjectFile(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['ไฟล์ไม่ใช่ JSON object'], warnings };
  if (input.format !== FILE_FORMAT) return { ok: false, errors: [`ไม่ใช่ไฟล์ Circuit Lab 3D (format ต้องเป็น "${FILE_FORMAT}")`], warnings };
  if (!isNum(input.schemaVersion)) return { ok: false, errors: ['ไม่มี schemaVersion'], warnings };
  if (input.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`ไฟล์สร้างจากรุ่นใหม่กว่า (schema ${input.schemaVersion}) แอปนี้รองรับถึง ${SCHEMA_VERSION}`], warnings };
  }
  const data = migrate(input, warnings);
  const circuit = validateCircuit(data.circuit, errors, warnings);
  const studentWork = validateWork(data.studentWork, warnings);
  if (errors.length || !circuit) return { ok: false, errors, warnings };
  return {
    ok: true, errors, warnings,
    file: {
      format: FILE_FORMAT, schemaVersion: SCHEMA_VERSION, app: String(data.app ?? ''),
      savedAt: String(data.savedAt ?? ''), title: isStr(data.title) ? data.title : 'ไม่มีชื่อ', circuit, studentWork,
    },
  };
}

export function makeProjectFile(title: string, circuit: CircuitDoc, studentWork: StudentWork): ProjectFile {
  return {
    format: FILE_FORMAT, schemaVersion: SCHEMA_VERSION, app: 'Circuit Lab 3D 0.1',
    savedAt: new Date().toISOString(), title, circuit, studentWork,
  };
}
