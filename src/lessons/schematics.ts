/**
 * รูปวงจรของแลปทั้ง 31 แลป (วาดด้วยสัญลักษณ์ใน schematic.ts)
 * ค่าอุปกรณ์และหมายเลขขาตรงกับขั้นตอนในแลป — ถ้าแก้ขั้นตอนในแลป ต้องแก้รูปตรงนี้ด้วย
 */
import {
  DASH, DOT, FLAG, GND, P2, T, VCC, W, gatePins, darlPins, icPin, nmosPins, npnPins, opampPins, optoPins, xfmrPins,
  type IcPin, type Item, type Pt, type Schematic,
} from './schematic';

/** กล่องไอซี + คืนตำแหน่งปลายขาตามชื่อ */
function box(at: Pt, w: number, h: number, title: string, pins: IcPin[], sub?: string) {
  const it: Item = { t: 'ic', at, w, h, title, sub, pins };
  const pin = (name: string): Pt => { const p = pins.find((q) => q.name === name); if (!p) throw new Error(`ไม่มีขา ${name} ใน ${title}`); return icPin({ at, w, h }, p.side, p.at); };
  return { it, pin };
}

/* ---------- 1–5 วงจร DC พื้นฐาน ---------- */

const breadboard: Schematic = {
  w: 420, h: 230,
  items: [
    P2('BAT', [60, 60], [60, 180], 'แหล่งจ่าย', '5 V', 'l'),
    W([60, 60], [330, 60]), W([60, 180], [330, 180]),
    T(200, 52, 'ราง T+ (ต่อถึงกันตลอดแนว)', { a: 'middle', muted: true }), T(200, 198, 'ราง T− (ต่อถึงกันตลอดแนว)', { a: 'middle', muted: true }),
    P2('V', [330, 60], [330, 180], 'โพรบ', '≈ 5 V'),
    DOT(150, 60), W([150, 60], [150, 100]), DOT(150, 100), T(160, 104, 'คอลัมน์ X แถว a–e', { muted: true }),
    T(160, 128, '┄ ร่องกลาง: ไม่เชื่อมกัน ┄', { muted: true }),
    { t: 'txt', at: [150, 152], s: '○', a: 'middle' }, T(160, 156, 'คอลัมน์ X แถว f–j (≈ 0 V)', { muted: true }),
  ],
};

const ohm: Schematic = {
  w: 400, h: 230,
  items: [
    P2('BAT', [60, 60], [60, 190], 'V1', '0–12 V', 'l'),
    W([60, 60], [100, 60]), P2('A', [100, 60], [170, 60], 'แอมมิเตอร์'), W([170, 60], [260, 60]),
    P2('R', [260, 60], [260, 190], 'R1', '1 kΩ'),
    W([260, 190], [60, 190]),
    DOT(260, 60), DOT(260, 190), W([260, 60], [340, 60]), W([260, 190], [340, 190]),
    P2('V', [340, 60], [340, 190], 'โพรบ', 'VR'),
  ],
};

const seriesParallel: Schematic = {
  w: 620, h: 240,
  items: [
    T(30, 26, 'ก) อนุกรม', { bold: true }),
    P2('BAT', [50, 60], [50, 200], 'V1', undefined, 'l'),
    W([50, 60], [80, 60]), P2('A', [80, 60], [150, 60]), W([150, 60], [220, 60]),
    P2('R', [220, 60], [220, 130], 'R1'), P2('R', [220, 130], [220, 200], 'R2'),
    W([220, 200], [50, 200]),
    T(330, 26, 'ข) ขนาน', { bold: true }),
    P2('BAT', [350, 60], [350, 200], 'V1', undefined, 'l'),
    W([350, 60], [380, 60]), P2('A', [380, 60], [450, 60]), W([450, 60], [580, 60]),
    P2('R', [500, 60], [500, 200], 'R1'), P2('R', [580, 60], [580, 200], 'R2'),
    W([580, 200], [350, 200]), DOT(500, 60), DOT(500, 200),
  ],
};

const divider: Schematic = {
  w: 380, h: 250,
  items: [
    P2('BAT', [60, 50], [60, 210], 'แหล่งจ่าย', '5 V', 'l'),
    W([60, 50], [200, 50]), P2('R', [200, 50], [200, 130], 'R1'), P2('R', [200, 130], [200, 210], 'R2'),
    W([200, 210], [60, 210]),
    DOT(200, 130), W([200, 130], [300, 130]), P2('V', [300, 130], [300, 210], 'โพรบ', 'Vout'), W([300, 210], [200, 210]), DOT(200, 210),
    T(214, 124, 'X', { bold: true }),
    T(30, 240, 'Vout = V × R2 / (R1 + R2)', { muted: true }),
  ],
};

const led: Schematic = {
  w: 420, h: 240,
  items: [
    P2('BAT', [50, 60], [50, 200], 'แหล่งจ่าย', '5 V', 'l'),
    W([50, 60], [90, 60]), P2('A', [90, 60], [160, 60]), W([160, 60], [200, 60]),
    P2('R', [200, 60], [300, 60], 'R', '150–680 Ω'), W([300, 60], [350, 60]),
    P2('LED', [350, 60], [350, 200], 'LED1'),
    W([350, 200], [50, 200]),
    T(30, 230, 'I = (5 V − VF) / R  → เลือก R ให้ I อยู่ 5–20 mA', { muted: true }),
  ],
};

/* ---------- 6–8 RC สโคป เรียงกระแส ---------- */

const rc: Schematic = {
  w: 440, h: 250,
  items: [
    P2('BAT', [50, 60], [50, 200], 'แหล่งจ่าย', '5 V', 'l'),
    W([50, 60], [120, 60]), P2('R', [120, 60], [240, 60], 'R', '10 kΩ'), W([240, 60], [300, 60]),
    P2('Cp', [300, 60], [300, 200], 'C', '100 µF'),
    W([300, 200], [50, 200]),
    DOT(300, 60), DOT(300, 200), W([300, 60], [380, 60]), W([300, 200], [380, 200]), P2('V', [380, 60], [380, 200], 'โพรบ', 'VC'),
    T(30, 236, 'τ = R·C = 1 s · คายประจุ: ย้ายปลาย R จากขั้ว + ไปขั้ว −', { muted: true }),
  ],
};

function lowpass(note: string, rLab = 'R', cLab = 'C'): Schematic {
  return {
    w: 440, h: 250,
    items: [
      P2('AC', [60, 60], [60, 200], 'เครื่องกำเนิด', 'ไซน์ 2 Vpp', 'l'),
      W([60, 60], [140, 60]), P2('R', [140, 60], [250, 60], rLab, '1 kΩ'), W([250, 60], [320, 60]),
      P2('C', [320, 60], [320, 200], cLab, '100 nF'),
      W([320, 200], [60, 200]), GND(190, 200),
      DOT(100, 60), W([100, 60], [100, 30]), FLAG(100, 30, 'CH1'),
      DOT(320, 60), W([320, 60], [370, 60]), FLAG(370, 60, 'CH2'),
      T(205, 232, note, { a: 'middle', muted: true }),
    ],
  };
}
const scope = lowpass('fc = 1 / (2π·R·C) ≈ 1.59 kHz · GND สโคปที่ COM');
const bode = { ...lowpass('ขั้น 5: สลับ R กับ C เป็นวงจรกรองความถี่สูง (CH2 ที่จุดกลาง)'), note: 'กราฟโบด: CH2/CH1 จาก 10 Hz ถึง 100 kHz' };

const rectifier: Schematic = {
  w: 460, h: 250,
  items: [
    P2('AC', [60, 60], [60, 200], 'เครื่องกำเนิด', '10 Vpp 100 Hz', 'l'),
    W([60, 60], [140, 60]), P2('D', [140, 60], [220, 60], 'D1', '1N4007'), W([220, 60], [290, 60]),
    P2('R', [290, 60], [290, 200], 'R', '1 kΩ'),
    W([290, 200], [60, 200]), GND(175, 200),
    DOT(290, 60), DOT(290, 200), W([290, 60], [380, 60]), W([290, 200], [380, 200]),
    P2('Cp', [380, 60], [380, 200], 'C 100 µF', '(ขั้น 5)'),
    DOT(100, 60), W([100, 60], [100, 30]), FLAG(100, 30, 'CH1'),
    DOT(250, 60), W([250, 60], [250, 30]), FLAG(250, 30, 'CH2'),
  ],
};

/* ---------- 9–11 ทรานซิสเตอร์ ออปแอมป์ ---------- */

function lowSide(kind: 'npn' | 'nmos'): Schematic {
  const at: Pt = [250, 260];
  const p = kind === 'npn' ? npnPins(at) : nmosPins(at);
  const ctl = kind === 'npn' ? (p as ReturnType<typeof npnPins>).B : (p as ReturnType<typeof nmosPins>).G;
  const top = kind === 'npn' ? (p as ReturnType<typeof npnPins>).C : (p as ReturnType<typeof nmosPins>).D;
  const bot = kind === 'npn' ? (p as ReturnType<typeof npnPins>).E : (p as ReturnType<typeof nmosPins>).S;
  const items: Item[] = [
    VCC(260, 50, '+5 V'),
    P2('R', [260, 50], [260, 110], 'R', '220 Ω'), P2('LED', [260, 110], [260, 160], 'LED'),
    P2('A', [260, 160], top, kind === 'npn' ? 'Ic' : 'Id'),
    kind === 'npn' ? { t: 'npn', at, label: 'Q1', value: '2N3904' } : { t: 'nmos', at, label: 'Q1', value: '2N7000' },
    GND(bot[0], bot[1]),
    VCC(80, 170, '+5 V'), P2('SW', [80, 170], [80, ctl[1]], 'SW', undefined, 'l'),
  ];
  if (kind === 'npn') items.push(W([80, ctl[1]], [110, ctl[1]]), P2('R', [110, ctl[1]], ctl, 'RB', '10 kΩ'));
  else items.push(W([80, ctl[1]], ctl), DOT(160, ctl[1]), P2('R', [160, ctl[1]], [160, 340], 'RG', '100 kΩ'), GND(160, 340));
  return { w: 400, h: kind === 'npn' ? 330 : 370, items };
}
const transistor = lowSide('npn');
const mosfet = { ...lowSide('nmos'), note: 'IRLZ44N ใช้แทนได้ (ลำดับขา G–D–S ต่างจาก 2N7000 S–G–D)' };

const opamp: Schematic = (() => {
  const o: Pt = [300, 160];
  const p = opampPins(o);
  return {
    w: 460, h: 290,
    items: [
      { t: 'opamp', at: o, supply: true }, T(o[0] + 30, o[1] + 34, 'U1 LM741', { bold: true }),
      T(p.minus[0] + 4, p.minus[1] - 4, '2', { muted: true }), T(p.plus[0] + 4, p.plus[1] + 12, '3', { muted: true }), T(p.out[0] - 8, p.out[1] - 4, '6', { muted: true }),
      VCC(p.vp[0], p.vp[1], '+12 V (ขา 7)'), W(p.vn, [p.vn[0], p.vn[1] + 10]), T(p.vn[0], p.vn[1] + 26, '−12 V (ขา 4)', { a: 'middle', bold: true }),
      P2('AC', [100, 150], [100, 250], 'เครื่องกำเนิด', 'ไซน์ 1 Vpp 1 kHz', 'l'), GND(100, 250),
      W([100, 150], [150, 150]), P2('R', [150, 150], [240, 150], 'Rin', '1 kΩ', 'b'), W([240, 150], p.minus),
      DOT(250, 150), W([250, 150], [250, 70]), P2('R', [250, 70], [360, 70], 'Rf', '10 kΩ'), W([360, 70], [360, 160]),
      W(p.plus, [230, 170], [230, 210]), GND(230, 210),
      DOT(360, 160), W(p.out, [400, 160]), FLAG(400, 160, 'CH2'),
      DOT(120, 150), W([120, 150], [120, 120]), FLAG(120, 120, 'CH1'),
      T(240, 290, 'Av = −Rf / Rin = −10 · จุดกลางแหล่งจ่ายคู่ = กราวด์', { a: 'middle', muted: true }),
    ],
  };
})();

const slew: Schematic = (() => {
  const a: Pt = [210, 150], b: Pt = [520, 150];
  const pa = opampPins(a, true), pb = opampPins(b, true);
  return {
    w: 660, h: 345,
    items: [
      T(30, 26, 'ก) ตามแรงดัน (×1)', { bold: true }),
      { t: 'opamp', at: a, label: 'LM741', plusTop: true },
      P2('AC', [90, 140], [90, 250], 'FG', 'สี่เหลี่ยม 10 Vpp', 'l'), GND(90, 250),
      W([90, 140], pa.plus), DOT(120, 140), W([120, 140], [120, 110]), FLAG(120, 110, 'CH1'),
      W(pa.minus, [160, 160], [160, 210], [270, 210], [270, 150]), W(pa.out, [290, 150]), DOT(270, 150), FLAG(290, 150, 'CH2'),
      T(340, 26, 'ข) ไม่กลับเฟส ×11', { bold: true }),
      { t: 'opamp', at: b, label: 'LM741', plusTop: true },
      P2('AC', [400, 140], [400, 250], 'FG', 'ไซน์ 0.2 Vpp', 'l'), GND(400, 250),
      W([400, 140], pb.plus),
      W(pb.minus, [465, 160], [465, 210]), DOT(465, 210),
      P2('R', [465, 210], [585, 210], 'Rf', '10 kΩ', 'b'), W([585, 210], [585, 150]),
      P2('R', [465, 210], [465, 290], 'Rg', '1 kΩ', 'l'), GND(465, 290),
      W(pb.out, [610, 150]), DOT(585, 150), FLAG(610, 150, 'CH2', 'r'),
      T(330, 335, 'ทั้งสองส่วนใช้ไฟเลี้ยง ±12 V (ขา 7 / ขา 4) เหมือนแลป 10', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 12 Pico ---------- */

const PICO = 'Raspberry Pi Pico';
const pico: Schematic = (() => {
  const p = box([40, 40], 120, 170, PICO, [{ side: 'r', at: 40, name: 'GP15', num: 20 }, { side: 'r', at: 100, name: 'GP14', num: 19 }, { side: 'r', at: 150, name: 'GND', num: 18 }]);
  return {
    w: 420, h: 260,
    items: [
      p.it,
      P2('R', p.pin('GP15'), [300, 80], 'R', '220 Ω'), W([300, 80], [340, 80]), P2('LED', [340, 80], [340, 190], 'LED'), GND(340, 190),
      W(p.pin('GP14'), [240, 140]), P2('PB', [240, 140], [240, 220], 'ปุ่มกด', undefined, 'r'), GND(240, 220),
      W(p.pin('GND'), [200, 190]), GND(200, 190),
      T(30, 250, 'GP14 ใช้ Pin.PULL_UP ภายใน: กด = 0', { muted: true }),
    ],
  };
})();


/* ---------- 15–17 VR บัซเซอร์ LDR ---------- */

const pot: Schematic = {
  w: 460, h: 250,
  items: [
    P2('BAT', [50, 50], [50, 210], 'แหล่งจ่าย', '5 V', 'l'),
    W([50, 50], [200, 50]), { t: 'pot', a: [200, 50], b: [200, 210], label: 'VR 10 kΩ', value: 'ขา 1 บน, 3 ล่าง' },
    W([200, 210], [50, 210]),
    W([230, 130], [300, 130]), T(236, 124, 'ขา 2', { muted: true }), DOT(300, 130),
    P2('V', [300, 130], [300, 210], 'โพรบ'), W([300, 210], [200, 210]), DOT(300, 210),
    W([300, 130], [390, 130]), P2('R', [390, 130], [390, 210], 'RL 1 kΩ', '(ขั้น 4)'), W([390, 210], [300, 210]),
  ],
};

const buzzer: Schematic = {
  w: 640, h: 230,
  items: [
    T(30, 26, 'ก) active: ไฟตรงก็ดัง', { bold: true }),
    P2('BAT', [60, 60], [60, 190], 'V1', '5 V', 'l'), W([60, 60], [180, 60]), P2('BZ', [180, 60], [180, 190], 'BZ1', 'active'), W([180, 190], [60, 190]),
    T(370, 26, 'ข) passive: ต้องป้อนสัญญาณสลับ', { bold: true }),
    P2('AC', [420, 60], [420, 190], 'FG สี่เหลี่ยม', '3 Vpp + 1.5 V', 'l'), W([420, 60], [540, 60]), P2('BZ', [540, 60], [540, 190], 'BZ2', 'passive'), W([540, 190], [420, 190]),
    T(320, 222, '+ ของบัซเซอร์ = ขาซ้าย (ขายาว)', { a: 'middle', muted: true }),
  ],
};

const ldr: Schematic = (() => {
  const q: Pt = [330, 220];
  const p = npnPins(q);
  return {
    w: 460, h: 290,
    items: [
      VCC(200, 40, '+5 V'), P2('R', [200, 40], [200, 140], 'R', '47 kΩ', 'l'), DOT(200, 140), P2('LDR', [200, 140], [200, 250], 'LDR', 'GL5528', 'l'), GND(200, 250),
      T(186, 136, 'X', { bold: true, a: 'end' }),
      W([200, 140], [260, 140], [260, 220], p.B),
      { t: 'npn', at: q, label: 'Q1', value: '2N3904' }, GND(p.E[0], p.E[1]),
      VCC(p.C[0], 40, '+5 V'), P2('R', [p.C[0], 40], [p.C[0], 120], 'R', '220 Ω'), P2('LED', [p.C[0], 120], p.C, 'LED'),
      DOT(240, 140), W([240, 140], [240, 110]), FLAG(240, 110, 'โพรบ VX'),
      T(30, 282, 'มืด → R ของ LDR สูง → VX สูง → ทรานซิสเตอร์นำ → LED ติด', { muted: true }),
    ],
  };
})();

/* ---------- 18–19 7 ส่วน รีเลย์ ---------- */

const sevenseg: Schematic = (() => {
  const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const pp = box([40, 30], 110, 260, PICO, [...segs.map((_, k) => ({ side: 'r' as const, at: 25 + k * 30, name: `GP${k + 2}`, num: [4, 5, 6, 7, 9, 10, 11][k] })), { side: 'r', at: 240, name: 'GND', num: 38 }]);
  const ss = box([330, 30], 100, 260, '7 ส่วน', [...segs.map((s, k) => ({ side: 'l' as const, at: 25 + k * 30, name: s, num: [7, 6, 4, 2, 1, 9, 10][k] })), { side: 'l', at: 240, name: 'COM', num: '3/8' }], 'แคโทดร่วม');
  return {
    w: 470, h: 320,
    items: [
      pp.it, ss.it,
      ...segs.map((s, k) => P2('R', pp.pin(`GP${k + 2}`), ss.pin(s), k === 0 ? 'R1–R7' : undefined, k === 0 ? '220 Ω' : undefined)),
      W(pp.pin('GND'), ss.pin('COM')), GND(240, 270),
      T(240, 312, 'หมายเลขขา 7 ส่วน ตามรุ่น 5161AS', { a: 'middle', muted: true }),
    ],
  };
})();

const relay: Schematic = (() => {
  const pc = box([40, 50], 110, 150, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP15', num: 20 }, { side: 'r', at: 110, name: 'GND', num: 38 }]);
  const rl = box([250, 50], 110, 150, 'โมดูลรีเลย์', [
    { side: 'l', at: 30, name: '+' }, { side: 'l', at: 70, name: 'S' }, { side: 'l', at: 110, name: '−' },
    { side: 'r', at: 30, name: 'COM' }, { side: 'r', at: 70, name: 'NO' }, { side: 'r', at: 110, name: 'NC' },
  ], '5 V 1 ช่อง');
  return {
    w: 620, h: 250,
    items: [
      pc.it, rl.it,
      W(pc.pin('VBUS'), rl.pin('+')), W(pc.pin('GP15'), rl.pin('S')), W(pc.pin('GND'), rl.pin('−')),
      W(rl.pin('NO'), [400, 120]), P2('LED', [460, 120], [400, 120], 'LED', undefined, 'b'), P2('R', [540, 120], [460, 120], 'R', '330 Ω', 'b'), W([540, 120], [570, 120]),
      P2('BAT', [570, 120], [570, 40], 'แหล่งจ่ายโหลด', '5 V', 'r'), W([570, 40], [395, 40], [395, 80], rl.pin('COM')),
      T(310, 236, 'ฝั่งโหลด: + → R → LED → NO … COM → −  (ย้ายไป NC เพื่อทำงานสลับกัน)', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 20–22 555, 7805, แหล่งจ่าย ---------- */

function timer555At(x: number, y: number, rb = '10 kΩ', c = '47 µF') {
  const u = box([x + 90, y + 50], 100, 130, 'NE555', [
    { side: 'l', at: 30, name: 'DIS', num: 7 }, { side: 'l', at: 60, name: 'THR', num: 6 }, { side: 'l', at: 90, name: 'TRIG', num: 2 },
    { side: 't', at: 25, name: 'VCC', num: 8 }, { side: 't', at: 75, name: 'RST', num: 4 }, { side: 'b', at: 50, name: 'GND', num: 1 }, { side: 'r', at: 65, name: 'OUT', num: 3 },
  ]);
  const xr = x + 20, rail = y;
  const dis = u.pin('DIS'), thr = u.pin('THR'), trg = u.pin('TRIG');
  const n6: Pt = [xr, trg[1] + 20];
  const items: Item[] = [
    u.it,
    W([xr, rail], [u.pin('RST')[0], rail]), W(u.pin('VCC'), [u.pin('VCC')[0], rail]), W(u.pin('RST'), [u.pin('RST')[0], rail]), DOT(u.pin('VCC')[0], rail),
    P2('R', [xr, rail], [xr, dis[1]], 'RA', '1 kΩ', 'l'), DOT(xr, dis[1]), W([xr, dis[1]], dis),
    P2('R', [xr, dis[1]], n6, 'RB', rb, 'l'), DOT(xr, n6[1]),
    W(n6, [xr + 40, n6[1]], [xr + 40, thr[1]], thr), DOT(xr + 40, trg[1]), W([xr + 40, trg[1]], trg),
    P2('Cp', n6, [xr, n6[1] + 70], 'C', c, 'l'), GND(xr, n6[1] + 70),
    GND(u.pin('GND')[0], u.pin('GND')[1]),
  ];
  return { items, out: u.pin('OUT'), rail, rstX: u.pin('RST')[0] };
}

const timer555: Schematic = (() => {
  const t = timer555At(40, 40);
  const o = t.out;
  return {
    w: 520, h: 330,
    items: [
      VCC(60, 40, '+5 V'), ...t.items,
      P2('R', o, [390, o[1]], 'R', '330 Ω', 'b'), W([390, o[1]], [430, o[1]]), P2('LED', [430, o[1]], [430, o[1] + 100], 'LED'), GND(430, o[1] + 100),
      DOT(270, o[1]), W([270, o[1]], [270, o[1] - 40]), FLAG(270, o[1] - 40, 'CH1'),
      T(30, 322, 'f = 1.44 / ((RA + 2RB)·C) ≈ 1.46 Hz · CH2 ที่ขา 6 (แรงดัน C)', { muted: true }),
    ],
  };
})();

function reg7805(at: Pt) {
  return box(at, 100, 50, 'L7805', [{ side: 'l', at: 25, name: 'IN', num: 1 }, { side: 'r', at: 25, name: 'OUT', num: 3 }, { side: 'b', at: 50, name: 'GND', num: 2 }]);
}

const vreg: Schematic = (() => {
  const u = reg7805([170, 50]);
  const yi = u.pin('IN')[1];
  return {
    w: 520, h: 260,
    items: [
      u.it,
      P2('BAT', [50, yi], [50, 210], 'VIN', '9 V (6–12 V)', 'l'), W([50, yi], u.pin('IN')),
      DOT(110, yi), P2('C', [110, yi], [110, 210], 'C1', '0.33 µF'),
      W(u.pin('OUT'), [460, yi]), DOT(320, yi), P2('C', [320, yi], [320, 210], 'C2', '0.1 µF'),
      DOT(390, yi), P2('R', [390, yi], [390, 210], 'RL', '100 Ω'),
      P2('R', [460, yi], [460, 140], 'R', '330 Ω'), P2('LED', [460, 140], [460, 210], 'LED'),
      W([50, 210], [460, 210]), W(u.pin('GND'), [220, 210]), DOT(220, 210), DOT(110, 210), DOT(320, 210), DOT(390, 210), GND(250, 210),
      DOT(350, yi), W([350, yi], [350, 40]), FLAG(350, 40, 'VOUT (โพรบ)'),
    ],
  };
})();

const psu: Schematic = (() => {
  const xc: Pt = [90, 150];
  const x = xfmrPins(xc);
  const Tn: Pt = [250, 90], Bn: Pt = [250, 210], Ln: Pt = [190, 150], Rn: Pt = [310, 150];
  const u = reg7805([430, 65]);
  const yi = u.pin('IN')[1];
  return {
    w: 660, h: 300,
    items: [
      { t: 'xfmr', at: xc, label: 'หม้อแปลง', value: '12-0-12 V' }, T(x.p1[0] - 4, x.p1[1] + 34, '230 V AC', { a: 'end', muted: true }),
      T(x.s1[0] + 4, x.s1[1] - 6, 'A', { muted: true }), T(x.ct[0] + 4, x.ct[1] - 6, 'CT', { muted: true }), T(x.s2[0] - 6, x.s2[1] + 16, 'B (ไม่ใช้)', { a: 'end', muted: true }),
      // บริดจ์ 4 ไดโอด: ไฟสลับเข้าซ้าย/ขวา, + บน, − ล่าง
      P2('D', Ln, Tn), P2('D', Rn, Tn), P2('D', Bn, Ln), P2('D', Bn, Rn), T(250, 154, 'D1–D4', { a: 'middle', muted: true }), T(250, 166, '1N4007', { a: 'middle', muted: true }),
      W(x.s1, [160, x.s1[1]], [160, Ln[1]], Ln),
      W(x.ct, [145, x.ct[1]], [145, 270], [335, 270], [335, Rn[1]], Rn),
      u.it, W(Tn, [250, yi], u.pin('IN')), DOT(380, yi), P2('Cp', [380, yi], [380, 240], 'C', '1000 µF', 'r'),
      W(Bn, [250, 240], [600, 240]), DOT(380, 240), W(u.pin('GND'), [480, 240]), DOT(480, 240), GND(520, 240),
      W(u.pin('OUT'), [600, yi]), P2('R', [600, yi], [600, 240], 'RL', '100 Ω'),
      DOT(350, yi), W([350, yi], [350, 40]), FLAG(350, 40, 'CH1 (AC 0.2 V/div)'),
      T(330, 292, 'ripple 100 Hz (เต็มคลื่น) · ครึ่งคลื่น: เหลือไดโอดตัวเดียว + ต่อ CT ลงกราวด์ → 50 Hz', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 23–24 เซอร์โว มอเตอร์ ---------- */

const servo: Schematic = (() => {
  const pc = box([40, 40], 110, 150, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP15', num: 20 }, { side: 'r', at: 110, name: 'GND', num: 38 }]);
  const sv = box([270, 40], 110, 150, 'SG90', [{ side: 'l', at: 30, name: 'แดง +5 V' }, { side: 'l', at: 70, name: 'ส้ม สัญญาณ' }, { side: 'l', at: 110, name: 'น้ำตาล GND' }], 'เซอร์โว');
  return {
    w: 430, h: 240,
    items: [pc.it, sv.it, W(pc.pin('VBUS'), sv.pin('แดง +5 V')), W(pc.pin('GP15'), sv.pin('ส้ม สัญญาณ')), W(pc.pin('GND'), sv.pin('น้ำตาล GND')),
      T(30, 228, 'PWM 50 Hz: พัลส์ 0.5 ms = 0°, 1.5 ms = 90°, 2.5 ms = 180°', { muted: true })],
  };
})();

const motor: Schematic = (() => {
  const q: Pt = [290, 210];
  const p = nmosPins(q);
  const pc = box([40, 140], 110, 120, PICO, [{ side: 'r', at: 70, name: 'GP15', num: 20 }, { side: 'r', at: 100, name: 'GND', num: 38 }]);
  return {
    w: 500, h: 320,
    items: [
      W([p.D[0], 50], [440, 50]), P2('M', [p.D[0], 50], [p.D[0], 140], 'M1', 'มอเตอร์ TT', 'l'), W([p.D[0], 140], p.D),
      DOT(p.D[0], 50), DOT(p.D[0], 140), W([p.D[0], 140], [370, 140]), P2('D', [370, 140], [370, 50], 'D1', '1N4007'), DOT(370, 50),
      { t: 'nmos', at: q, label: 'Q1', value: 'IRLZ44N' },
      pc.it, W(pc.pin('GP15'), p.G), DOT(220, 210), P2('R', [220, 210], [220, 280], 'R', '10 kΩ', 'l'),
      W(pc.pin('GND'), [190, pc.pin('GND')[1]], [190, 280]),
      W([190, 280], [440, 280]), W(p.S, [p.D[0], 280]), DOT(p.D[0], 280), DOT(220, 280), GND(250, 280),
      P2('BAT', [440, 50], [440, 280], 'แหล่งจ่าย', '6 V', 'r'),
      T(30, 312, 'ไดโอดคร่อมมอเตอร์ (แคโทดที่ +) กันแรงดันกระชากตอนมอสเฟตหยุดนำ', { muted: true }),
    ],
  };
})();

/* ---------- 25–26 ดิจิทัล ---------- */

const logic: Schematic = (() => {
  const g: Pt = [360, 150];
  const p = gatePins(g);
  return {
    w: 540, h: 300,
    items: [
      { t: 'gate', at: g, op: 'and' }, T(g[0], g[1] + 40, '1/4 74HC08 (AND)', { a: 'middle', bold: true }),
      T(p.A[0] + 4, p.A[1] - 4, '1', { muted: true }), T(p.B[0] + 4, p.B[1] + 12, '2', { muted: true }), T(p.Y[0] - 8, p.Y[1] - 4, '3', { muted: true }),
      VCC(140, 40, '+5 V'), P2('SW', [140, 40], [140, 100], 'SW A', undefined, 'l'), DOT(140, 100), P2('R', [140, 100], [140, 250], 'R', '10 kΩ', 'l'), GND(140, 250),
      W([140, 100], [300, 100], [300, p.A[1]], p.A),
      VCC(230, 130, '+5 V'), P2('SW', [230, 130], [230, 190], 'SW B', undefined, 'l'), DOT(230, 190), P2('R', [230, 190], [230, 260], 'R', '10 kΩ', 'l'), GND(230, 260),
      W([230, 190], [290, 190], [290, p.B[1]], p.B),
      P2('R', p.Y, [470, p.Y[1]], 'R', '470 Ω'), W([470, p.Y[1]], [490, p.Y[1]]), P2('LED', [490, p.Y[1]], [490, 250], 'LED'), GND(490, 250),
      T(30, 290, 'ไอซี: ขา 14 VCC → +5 V, ขา 7 GND → กราวด์ · เปลี่ยนเป็น 74HC32 (OR) ได้ ขาเดิม', { muted: true }),
    ],
  };
})();

const counter: Schematic = (() => {
  const t = timer555At(20, 30, '10 kΩ', '10 µF');
  const c = box([360, 60], 110, 200, 'CD4017', [
    { side: 'l', at: 40, name: 'CLK', num: 14 }, { side: 'l', at: 100, name: 'INH', num: 13 }, { side: 'l', at: 140, name: 'RST', num: 15 },
    { side: 't', at: 55, name: 'VDD', num: 16 }, { side: 'b', at: 55, name: 'VSS', num: 8 },
    { side: 'r', at: 30, name: 'Q0', num: 3 }, { side: 'r', at: 60, name: 'Q1', num: 2 }, { side: 'r', at: 90, name: 'Q2', num: 4 }, { side: 'r', at: 120, name: 'Q3', num: 7 },
  ]);
  const clk = c.pin('CLK');
  const qs = ['Q0', 'Q1', 'Q2', 'Q3'].map((q) => c.pin(q));
  return {
    w: 640, h: 350,
    items: [
      VCC(40, 30, '+9 V'), ...t.items, c.it,
      W([t.rstX, t.rail], [c.pin('VDD')[0], t.rail], c.pin('VDD')), DOT(t.rstX, t.rail),
      W(t.out, [320, t.out[1]], [320, clk[1]], clk),
      W(c.pin('INH'), [340, c.pin('INH')[1]], [340, c.pin('RST')[1]], c.pin('RST')), DOT(340, c.pin('RST')[1]), W([340, c.pin('RST')[1]], [340, 300]), GND(340, 300),
      GND(c.pin('VSS')[0], c.pin('VSS')[1]),
      ...qs.flatMap((q): Item[] => [P2('LED', q, [540, q[1]]), W([540, q[1]], [590, q[1]])]), T(500, 60, 'LED1–4', { a: 'middle', bold: true }),
      W([590, qs[0][1]], [590, 230]), DOT(590, qs[1][1]), DOT(590, qs[2][1]), DOT(590, qs[3][1]),
      P2('R', [590, 230], [590, 300], 'R', '1 kΩ', 'l'), GND(590, 300),
      T(30, 340, 'Q4–Q9 (ขา 10, 1, 5, 6, 9, 11) ต่อ LED เพิ่มแบบเดียวกัน · ลองย้าย RST ไปที่ Q4', { muted: true }),
    ],
  };
})();

/* ---------- 27–31 Pico + โมดูล/ไอซี ---------- */

const lm35: Schematic = (() => {
  const pc = box([40, 40], 120, 180, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP26', num: 31 }, { side: 'r', at: 120, name: 'GP15', num: 20 }, { side: 'r', at: 160, name: 'GND', num: 38 }]);
  const ts = box([320, 50], 130, 80, 'LM35', [{ side: 'l', at: 20, name: '+VS' }, { side: 'l', at: 60, name: 'VOUT' }, { side: 'b', at: 65, name: 'GND' }], '10 mV/°C');
  return {
    w: 500, h: 280,
    items: [
      pc.it, ts.it,
      W(pc.pin('VBUS'), ts.pin('+VS')), W(pc.pin('GP26'), [240, 110], [240, 110], ts.pin('VOUT')),
      GND(ts.pin('GND')[0], ts.pin('GND')[1]),
      P2('R', pc.pin('GP15'), [290, 160], 'R', '330 Ω'), W([290, 160], [300, 160]), P2('LED', [300, 160], [300, 250], 'LED เตือน'), GND(300, 250),
      W(pc.pin('GND'), [200, 200]), GND(200, 200),
      DOT(260, 110), W([260, 110], [260, 80]), FLAG(260, 80, 'โพรบ'),
    ],
  };
})();

const hbridge: Schematic = (() => {
  const pc = box([30, 60], 110, 210, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP16', num: 21 }, { side: 'r', at: 110, name: 'GP14', num: 19 }, { side: 'r', at: 150, name: 'GP15', num: 20 }, { side: 'r', at: 190, name: 'GND', num: 38 }]);
  const u = box([300, 40], 130, 230, 'L293D', [
    { side: 'l', at: 90, name: '1,2EN', num: 1 }, { side: 'l', at: 130, name: '1A', num: 2 }, { side: 'l', at: 170, name: '2A', num: 7 },
    { side: 't', at: 35, name: 'VCC1', num: 16 }, { side: 't', at: 95, name: 'VCC2', num: 8 }, { side: 'b', at: 65, name: 'GND', num: '4,5' },
    { side: 'r', at: 80, name: '1Y', num: 3 }, { side: 'r', at: 160, name: '2Y', num: 6 },
  ]);
  const y1 = u.pin('1Y'), y2 = u.pin('2Y');
  return {
    w: 620, h: 340,
    items: [
      pc.it, u.it,
      W(pc.pin('GP16'), u.pin('1,2EN')), W(pc.pin('GP14'), u.pin('1A')), W(pc.pin('GP15'), u.pin('2A')),
      W(pc.pin('VBUS'), [190, 90], [190, 10], [u.pin('VCC1')[0], 10], u.pin('VCC1')), T(200, 24, '+5 V', { bold: true }),
      VCC(u.pin('VCC2')[0], u.pin('VCC2')[1], '+6 V'),
      W(pc.pin('GND'), [200, 250]), GND(200, 250), GND(u.pin('GND')[0], u.pin('GND')[1]),
      W(y1, [490, y1[1]]), P2('M', [490, y1[1]], [490, y2[1]], 'M1', 'มอเตอร์ TT', 'r'), W([490, y2[1]], y2),
      P2('BAT', [580, 70], [580, 200], 'แหล่งจ่าย', '6 V', 'r'), VCC(580, 70, '+6 V'), GND(580, 200),
      T(30, 330, 'กราวด์ทุกจุดต่อร่วมกัน · 1A=1, 2A=0 เดินหน้า / 1A=0, 2A=1 ถอยหลัง / PWM ที่ EN ปรับความเร็ว', { muted: true }),
    ],
  };
})();

const sonar: Schematic = (() => {
  const pc = box([40, 40], 110, 190, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP14', num: 19 }, { side: 'r', at: 110, name: 'GP15', num: 20 }, { side: 'r', at: 170, name: 'GND', num: 38 }]);
  const us = box([380, 40], 100, 190, 'HC-SR04', [{ side: 'l', at: 30, name: 'Vcc' }, { side: 'l', at: 70, name: 'Trig' }, { side: 'l', at: 110, name: 'Echo' }, { side: 'l', at: 170, name: 'Gnd' }]);
  const echo = us.pin('Echo'), gp15 = pc.pin('GP15'), gnd = pc.pin('GND');
  return {
    w: 520, h: 290,
    items: [
      pc.it, us.it,
      W(pc.pin('VBUS'), us.pin('Vcc')), W(pc.pin('GP14'), us.pin('Trig')),
      P2('R', echo, [270, echo[1]], 'R1', '1 kΩ'), W([270, echo[1]], gp15), DOT(270, echo[1]),
      P2('R', [270, echo[1]], [270, gnd[1]], 'R2', '2 kΩ', 'l'), DOT(270, gnd[1]),
      W(gnd, us.pin('Gnd')), GND(210, gnd[1]),
      T(30, 280, 'ตัวแบ่งแรงดัน: Echo 5 V × 2k/(1k+2k) ≈ 3.3 V เข้า GP15', { muted: true }),
    ],
  };
})();

const shiftreg: Schematic = (() => {
  const pc = box([30, 50], 100, 170, PICO, [{ side: 'r', at: 20, name: '3V3', num: 36 }, { side: 'r', at: 60, name: 'GP2', num: 4 }, { side: 'r', at: 90, name: 'GP3', num: 5 }, { side: 'r', at: 120, name: 'GP4', num: 6 }, { side: 'r', at: 150, name: 'GND', num: 38 }]);
  const outs = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'], nums = [15, 1, 2, 3, 4, 5, 6, 7];
  const u = box([290, 50], 110, 260, '74HC595', [
    { side: 'l', at: 60, name: 'SER', num: 14 }, { side: 'l', at: 90, name: 'SRCLK', num: 11 }, { side: 'l', at: 120, name: 'RCLK', num: 12 },
    { side: 'l', at: 170, name: 'SRCLR', num: 10 }, { side: 'l', at: 210, name: 'OE', num: 13 },
    { side: 't', at: 55, name: 'VCC', num: 16 }, { side: 'b', at: 55, name: 'GND', num: 8 },
    ...outs.map((q, k) => ({ side: 'r' as const, at: 20 + k * 30, name: q, num: nums[k] })),
  ]);
  return {
    w: 640, h: 400,
    items: [
      pc.it, u.it,
      W(pc.pin('GP2'), u.pin('SER')), W(pc.pin('GP3'), u.pin('SRCLK')), W(pc.pin('GP4'), u.pin('RCLK')),
      W(pc.pin('3V3'), [200, 70], [200, 20], [u.pin('VCC')[0], 20], u.pin('VCC')), DOT(240, 20),
      W(u.pin('SRCLR'), [240, u.pin('SRCLR')[1]], [240, 20]),
      W(u.pin('OE'), [250, u.pin('OE')[1]]), GND(250, u.pin('OE')[1]),
      GND(u.pin('GND')[0], u.pin('GND')[1]), W(pc.pin('GND'), [170, 200]), GND(170, 200),
      ...outs.flatMap((q, k): Item[] => { const p = u.pin(q); return [P2('LED', p, [490, p[1]], k === 0 ? 'LED1–8' : undefined), P2('R', [490, p[1]], [580, p[1]], k === 0 ? '330 Ω' : undefined), W([580, p[1]], [600, p[1]])]; }),
      W([600, u.pin('QA')[1]], [600, 330]), ...outs.slice(0, 7).map((q) => DOT(600, u.pin(q)[1])), GND(600, 330),
      T(30, 392, 'ส่ง 8 บิตทาง SER (MSB ก่อน) แต่ละบิตให้ SRCLK ขึ้น แล้วให้ RCLK ขึ้นหนึ่งครั้ง · QH′ (ขา 9) ต่อพ่วงตัวถัดไป', { muted: true }),
    ],
  };
})();

const opto: Schematic = (() => {
  const o: Pt = [330, 120];
  const p = optoPins(o);
  const pc = box([30, 60], 100, 120, PICO, [{ side: 'r', at: 40, name: 'GP15', num: 20 }, { side: 'r', at: 80, name: 'GND', num: 18 }]);
  return {
    w: 620, h: 280,
    items: [
      pc.it, { t: 'opto', at: o, label: 'U1', value: 'PC817C' },
      P2('R', pc.pin('GP15'), p.A, 'R1', '330 Ω (ขั้น 6: 10 kΩ)'),
      W(pc.pin('GND'), p.K), GND(200, p.K[1]),
      W(p.C, [420, p.C[1]]), P2('LED', [420, 40], [420, p.C[1]], 'LED', undefined, 'l'), W([420, 40], [460, 40]), P2('R', [460, 40], [560, 40], 'R2', '2.2 kΩ'),
      P2('BAT', [560, 40], [560, 200], 'แหล่งจ่าย', '12 V', 'r'), W(p.E, [420, p.E[1]], [420, 200], [560, 200]),
      DASH([330, 160], [330, 250]), T(330, 266, 'ฉนวน: สองฝั่งไม่มีจุดต่อร่วม (กราวด์ 12 V ≠ GND ของ Pico)', { a: 'middle', muted: true }),
    ],
  };
})();

const stepper: Schematic = (() => {
  const pc = box([30, 50], 100, 200, PICO, [{ side: 'r', at: 30, name: 'VBUS', num: 40 }, { side: 'r', at: 70, name: 'GP10', num: 14 }, { side: 'r', at: 100, name: 'GP11', num: 15 }, { side: 'r', at: 130, name: 'GP12', num: 16 }, { side: 'r', at: 160, name: 'GP13', num: 17 }, { side: 'r', at: 190, name: 'GND', num: 18 }]);
  const u = box([260, 80], 110, 170, 'ULN2003', [
    { side: 'l', at: 40, name: 'IN1', num: 1 }, { side: 'l', at: 70, name: 'IN2', num: 2 }, { side: 'l', at: 100, name: 'IN3', num: 3 }, { side: 'l', at: 130, name: 'IN4', num: 4 },
    { side: 'b', at: 55, name: 'GND', num: 8 }, { side: 't', at: 90, name: 'COM', num: 9 },
    { side: 'r', at: 40, name: 'OUT1', num: 16 }, { side: 'r', at: 70, name: 'OUT2', num: 15 }, { side: 'r', at: 100, name: 'OUT3', num: 14 }, { side: 'r', at: 130, name: 'OUT4', num: 13 },
  ]);
  const cols = ['น้ำเงิน', 'ชมพู', 'เหลือง', 'ส้ม'];
  const xr = 600;
  return {
    w: 700, h: 340,
    items: [
      pc.it, u.it,
      W(pc.pin('GP10'), [210, 120], u.pin('IN1')), W(pc.pin('GP11'), [220, 150], [220, 150], u.pin('IN2')), W(pc.pin('GP12'), [230, 180], u.pin('IN3')), W(pc.pin('GP13'), [240, 210], u.pin('IN4')),
      W(pc.pin('VBUS'), [180, 80], [180, 30], [xr, 30]), DOT(u.pin('COM')[0], 30), W(u.pin('COM'), [u.pin('COM')[0], 30]),
      W(pc.pin('GND'), [170, 240], [170, 300], [u.pin('GND')[0], 300], u.pin('GND')), GND(240, 300),
      ...[1, 2, 3, 4].flatMap((k): Item[] => {
        const o = u.pin(`OUT${k}`), xc = 420 + k * 35;
        return [W(o, [xc, o[1]]), P2('L', [xc, o[1]], [xc, 30 + 0], undefined, undefined), T(xc + 4, o[1] + 14, cols[k - 1], { muted: true, size: 9 })];
      }),
      DOT(455, 30), DOT(490, 30), DOT(525, 30), DOT(560, 30), T(xr + 4, 26, 'สายแดง (ร่วม +5 V)', { muted: true }),
      T(510, 280, '28BYJ-48: 4 ขด × 50 Ω', { a: 'middle', bold: true }), DASH([440, 50], [580, 50], [580, 270], [440, 270], [440, 50]),
      T(30, 332, 'บอร์ดขับมี LED A–D + 1 kΩ คร่อมแต่ละขด และไดโอดกันย้อนในไอซี (ขา 9 COM ต่อ +5 V)', { muted: true }),
    ],
  };
})();

const meters: Schematic = {
  w: 700, h: 260,
  items: [
    T(20, 26, 'ก) วัด R (ปิดไฟ)', { bold: true }),
    P2('R', [60, 70], [60, 200], 'R1', '100 kΩ', 'l'),
    W([60, 70], [140, 70]), W([60, 200], [140, 200]),
    P2('OHM', [140, 70], [140, 200], 'DMM', 'ย่าน Ω'),
    T(250, 26, 'ข) วัด V (ต่อขนาน)', { bold: true }),
    P2('BAT', [260, 70], [260, 200], 'V1', '10 V', 'l'),
    W([260, 70], [350, 70]), P2('R', [350, 70], [350, 135], 'R1', '100 kΩ'), P2('R', [350, 135], [350, 200], 'R2', '100 kΩ'),
    W([350, 200], [260, 200]),
    DOT(350, 135), DOT(350, 200), W([350, 135], [430, 135]), W([350, 200], [430, 200]),
    P2('V', [430, 135], [430, 200], 'DMM 10 MΩ', 'VOM 200 kΩ'),
    T(500, 26, 'ค) วัด I (ต่ออนุกรม)', { bold: true }),
    P2('BAT', [510, 70], [510, 200], 'V1', '10 V', 'l'),
    W([510, 70], [540, 70]), P2('A', [540, 70], [610, 70], 'DMM', 'mA'), W([610, 70], [650, 70]),
    P2('R', [650, 70], [650, 135], 'R1'), P2('R', [650, 135], [650, 200], 'R2'),
    W([650, 200], [510, 200]),
  ],
};

const scr: Schematic = {
  w: 470, h: 300,
  items: [
    P2('BAT', [60, 60], [60, 270], 'V1', '12 V', 'l'),
    W([60, 60], [320, 60]),
    P2('R', [320, 60], [320, 110], 'RL', '1 kΩ'), P2('LED', [320, 110], [320, 160], 'LED1'),
    P2('SCR', [320, 160], [320, 230], 'SCR1', '2N5060'), W([320, 230], [320, 270]),
    W([320, 160], [400, 160]), P2('SW', [400, 160], [400, 270], 'S2', 'ดับ'),
    DOT(320, 160), DOT(220, 60), DOT(220, 210), DOT(220, 270), DOT(320, 270),
    P2('SW', [220, 60], [220, 130], 'S1', 'ติด', 'l'), P2('R', [220, 130], [220, 210], 'RG', '10 kΩ', 'l'),
    W([300, 210], [220, 210]), P2('R', [220, 210], [220, 270], 'RGK', '1 kΩ', 'l'),
    W([60, 270], [400, 270]),
  ],
};

/* ---------- 35 LM317 ---------- */

const lm317: Schematic = (() => {
  const u = box([170, 50], 100, 50, 'LM317', [{ side: 'l', at: 25, name: 'IN', num: 3 }, { side: 'r', at: 25, name: 'OUT', num: 2 }, { side: 'b', at: 50, name: 'ADJ', num: 1 }]);
  const yi = u.pin('IN')[1], adj = u.pin('ADJ');
  return {
    w: 560, h: 300,
    items: [
      u.it,
      P2('BAT', [50, yi], [50, 270], 'V1', '15 V', 'l'), W([50, yi], u.pin('IN')),
      DOT(110, yi), P2('C', [110, yi], [110, 270], 'C1', '0.1 µF แนะนำ'),
      W(u.pin('OUT'), [490, yi]), DOT(330, yi), P2('R', [330, yi], [330, 170], 'R1', '240 Ω'),
      W(adj, [adj[0], 170], [330, 170]), DOT(adj[0], 170),
      { t: 'pot', a: [adj[0], 170], b: [adj[0], 270], label: 'R2 = VR1', value: '2 kΩ' }, W([adj[0] + 30, 220], [adj[0] + 30, 270]), DOT(adj[0] + 30, 270),
      DOT(410, yi), P2('C', [410, yi], [410, 270], 'C2', '1 µF แนะนำ'),
      P2('R', [490, yi], [490, 270], 'RL', '1 kΩ'),
      W([50, 270], [490, 270]), DOT(110, 270), DOT(adj[0], 270), DOT(410, 270), GND(300, 270),
      DOT(450, yi), W([450, yi], [450, 30]), FLAG(450, 30, 'VOUT'),
      T(280, 296, 'VOUT = 1.25 V × (1 + R2/R1) + 50 µA × R2', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 36 NTC ---------- */

const ntc: Schematic = {
  w: 460, h: 260,
  items: [
    P2('BAT', [60, 40], [60, 230], 'V1', '5 V', 'l'),
    W([60, 40], [200, 40]), P2('R', [200, 40], [200, 130], 'R1', '10 kΩ'),
    DOT(200, 130), P2('NTC', [200, 130], [200, 230], 'TH1', 'NTC 10 kΩ'),
    W([60, 230], [340, 230]), DOT(200, 230),
    W([200, 130], [340, 130]), P2('V', [340, 130], [340, 230], 'VOUT', 'โพรบ'), DOT(340, 230), GND(270, 230),
    T(230, 254, 'VOUT = 5 V × RNTC / (R1 + RNTC)', { a: 'middle', muted: true }),
  ],
};

/* ---------- 37 LM393 เทอร์โมสตัท ---------- */

const comparator: Schematic = (() => {
  const o: Pt = [370, 170];
  const p = opampPins(o, true);
  return {
    w: 580, h: 350,
    items: [
      P2('BAT', [60, 40], [60, 300], 'V1', '5 V', 'l'),
      W([60, 40], [500, 40]), W([60, 300], [500, 300]), GND(300, 300),
      P2('R', [150, 40], [150, 130], 'R1', '10 kΩ'), DOT(150, 40), DOT(150, 130), P2('NTC', [150, 130], [150, 300], 'TH1', 'NTC 10 kΩ'), DOT(150, 300),
      W([150, 130], [290, 130], [290, 160], p.plus), DOT(290, 130),
      { t: 'pot', a: [220, 40], b: [220, 300], label: 'VR1', value: '10 kΩ' }, DOT(220, 40), DOT(220, 300), W([250, 170], [270, 170], [270, 180], p.minus),
      { t: 'opamp', at: o, plusTop: true }, T(o[0] - 30, o[1] + 50, 'U1A LM393', { bold: true }),
      T(p.plus[0] + 2, p.plus[1] - 4, '3', { muted: true }), T(p.minus[0] + 2, p.minus[1] + 14, '2', { muted: true }), T(p.out[0] - 8, p.out[1] - 4, '1', { muted: true }),
      T(o[0] - 30, o[1] + 66, 'ขา 8 → +5 V · ขา 4 → GND', { muted: true }),
      P2('R', [480, 40], [480, 100], 'R2', '470 Ω'), DOT(480, 40), P2('LED', [480, 100], [480, 170], 'LED1', 'ร้อน'), W(p.out, [480, 170]), DOT(440, 170),
      W([290, 130], [290, 90]), P2('R', [290, 90], [440, 90], 'RH 100 kΩ', 'ไม่บังคับ — hysteresis'), W([440, 90], [440, 170]),
      T(290, 344, 'ร้อนขึ้น → VT (ขา 3) ต่ำกว่า VREF (ขา 2) → ขาออกดึงลง → LED ติด', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 38 TIP120 ขับมอเตอร์ ---------- */

const darlington: Schematic = (() => {
  const q: Pt = [300, 200];
  const p = darlPins(q);
  return {
    w: 540, h: 350,
    items: [
      P2('BAT', [60, 50], [60, 290], 'V1', '6 V', 'l'),
      W([60, 50], [440, 50]), W([60, 290], [p.E[0], 290]), GND(250, 290),
      P2('SW', [130, 50], [130, 120], 'S1', 'เปิด/ปิด', 'l'), DOT(130, 50), W([130, 120], [130, 200]), P2('R', [130, 200], p.B, 'RB', '10 kΩ'),
      { t: 'darl', at: q, label: 'Q1 TIP120', value: 'ดาร์ลิงตัน hFE ≥ 1000' }, W(p.E, [p.E[0], 290]), DOT(p.E[0], 290),
      P2('M', [p.C[0], 70], [p.C[0], 140], 'M1', 'มอเตอร์ TT'), W([p.C[0], 50], [p.C[0], 70]), DOT(p.C[0], 50), W([p.C[0], 140], p.C), DOT(p.C[0], 150),
      W([p.C[0], 150], [440, 150]), P2('D', [440, 150], [440, 50], 'D1', '1N4007'),
      T(260, 326, 'ภายใน TIP120: R1 ≈ 8 kΩ (B–เบส Q2), R2 ≈ 120 Ω (เบส Q2–E)', { a: 'middle', muted: true }),
      T(260, 342, 'ต้องมีกระแสเบสพอให้ VBE ≈ 1.2–1.5 V จึงนำ', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 39 LM386 ---------- */

const lm386: Schematic = (() => {
  const o: Pt = [300, 160];
  const p = opampPins(o, true);
  return {
    w: 600, h: 320,
    items: [
      P2('AC', [70, 150], [70, 270], 'เครื่องกำเนิด', 'ไซน์ 1 kHz 20 mVpp', 'l'), W([70, 150], [p.plus[0] - 40, 150], p.plus), GND(70, 270),
      DOT(120, 150), W([120, 150], [120, 100]), FLAG(120, 100, 'CH1'),
      W(p.minus, [230, 170], [230, 270]), GND(230, 270),
      { t: 'opamp', at: o, plusTop: true }, T(o[0] - 30, o[1] + 50, 'U1 LM386', { bold: true }), T(o[0] - 30, o[1] + 66, 'ขา 6 → +9 V · ขา 4 → GND', { muted: true }),
      T(p.plus[0] + 2, p.plus[1] - 4, '3', { muted: true }), T(p.minus[0] + 2, p.minus[1] + 14, '2', { muted: true }), T(p.out[0] - 8, p.out[1] - 4, '5', { muted: true }),
      P2('C', [280, 80], [320, 80], 'C2', '10 µF (gain 200)'), W([280, 80], [280, 110], [290, 110], [290, 140]), W([320, 80], [320, 110], [310, 110], [310, 150]), T(282, 132, '1', { muted: true }), T(314, 140, '8', { muted: true }),
      W(p.out, [380, p.out[1]]), P2('Cp', [380, p.out[1]], [450, p.out[1]], 'C1', '220 µF'), W([450, p.out[1]], [520, p.out[1]]),
      P2('SPK', [520, p.out[1]], [520, 270], 'LS1', '8 Ω'), GND(520, 270),
      DOT(490, p.out[1]), W([490, p.out[1]], [490, 100]), FLAG(490, 100, 'CH2'),
      T(300, 312, 'ขา 1–8 เปิด: อัตราขยาย 20 · ใส่ C2 10 µF: 200 · ขาออก DC ≈ VS/2 → ต้องมี C1', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 40 สมาร์ตฟาร์ม ---------- */

const smartfarm: Schematic = (() => {
  const pc = box([30, 40], 120, 300, PICO, [{ side: 'r', at: 30, name: '3V3', num: 36 }, { side: 'r', at: 70, name: 'GP26', num: 31 }, { side: 'r', at: 150, name: 'VBUS', num: 40 }, { side: 'r', at: 200, name: 'GP15', num: 20 }, { side: 'r', at: 270, name: 'GND', num: 38 }]);
  const ms = box([330, 40], 150, 80, 'เซนเซอร์ความชื้นในดิน', [{ side: 'l', at: 30, name: 'VCC' }, { side: 'l', at: 70, name: 'AOUT' }, { side: 'b', at: 110, name: 'GND' }], 'capacitive v1.2');
  const rl = box([330, 170], 110, 130, 'โมดูลรีเลย์', [{ side: 'l', at: 20, name: '+' }, { side: 'l', at: 70, name: 'S' }, { side: 'l', at: 110, name: '−' }, { side: 'r', at: 20, name: 'COM' }, { side: 'r', at: 70, name: 'NO' }], '5 V 1 ช่อง');
  return {
    w: 680, h: 380,
    items: [
      pc.it, ms.it, rl.it,
      W(pc.pin('3V3'), ms.pin('VCC')), W(pc.pin('GP26'), ms.pin('AOUT')), GND(ms.pin('GND')[0], ms.pin('GND')[1]),
      DOT(250, 110), W([250, 110], [250, 90]), FLAG(250, 90, 'โพรบ'),
      W(pc.pin('VBUS'), rl.pin('+')), W(pc.pin('GP15'), rl.pin('S')), W(rl.pin('−'), [310, 280], [310, 330]), GND(310, 330),
      W(pc.pin('GND'), [200, 310]), GND(200, 310),
      W(rl.pin('COM'), [500, 190]), FLAG(500, 190, 'VBUS 5 V'),
      W(rl.pin('NO'), [580, 240]), P2('M', [580, 240], [580, 320], 'P1 ปั๊มน้ำ', '3–6 V'), GND(580, 320),
      T(560, 90, 'สายยางปั๊ม → กระถางของเซนเซอร์', { a: 'middle', muted: true }),
      T(340, 372, 'ความชื้น (%) = (2.5 − V) / 1.25 × 100 · ปั๊มเปิดเมื่อ < 30% ปิดเมื่อ > 60%', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 41 DHT22 ---------- */

const dht22: Schematic = (() => {
  const pc = box([40, 40], 120, 200, PICO, [{ side: 'r', at: 30, name: '3V3', num: 36 }, { side: 'r', at: 90, name: 'GP15', num: 20 }, { side: 'r', at: 140, name: 'GP14', num: 19 }, { side: 'r', at: 180, name: 'GND', num: 38 }]);
  const u = box([380, 50], 130, 110, 'DHT22', [{ side: 'l', at: 20, name: 'VDD', num: 1 }, { side: 'l', at: 80, name: 'DATA', num: 2 }, { side: 'b', at: 95, name: 'GND', num: 4 }], 'AM2302');
  return {
    w: 580, h: 300,
    items: [
      pc.it, u.it,
      W(pc.pin('3V3'), u.pin('VDD')), DOT(300, 70), W(pc.pin('GP15'), u.pin('DATA')), DOT(300, 130),
      P2('R', [300, 70], [300, 130], 'R1', '10 kΩ', 'l'),
      GND(u.pin('GND')[0], u.pin('GND')[1]),
      P2('R', pc.pin('GP14'), [260, 180], 'R2', '330 Ω'), W([260, 180], [270, 180]), P2('LED', [270, 180], [270, 260], 'LED เตือน'), GND(270, 260),
      W(pc.pin('GND'), [200, 220]), GND(200, 220),
      T(445, 250, 'ขา 3 NC ไม่ต่อ', { a: 'middle', muted: true }),
      T(290, 292, 'R1 ดึงบัส DATA ขึ้น (open-drain) · อ่านห่างกัน ≥ 2 s', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 42 ADC → PWM ---------- */

const adcpwm: Schematic = (() => {
  const pc = box([40, 40], 120, 200, PICO, [{ side: 'r', at: 30, name: '3V3', num: 36 }, { side: 'r', at: 90, name: 'GP26', num: 31 }, { side: 'r', at: 140, name: 'GP15', num: 20 }, { side: 'r', at: 180, name: 'GND', num: 38 }]);
  return {
    w: 560, h: 300,
    items: [
      pc.it,
      W(pc.pin('3V3'), [300, 70]), { t: 'pot', a: [300, 70], b: [380, 70], label: 'VR1 10 kΩ', value: 'ขา 3 ซ้าย · ขา 1 ขวา' }, W([380, 70], [440, 70], [440, 90]), GND(440, 90),
      W(pc.pin('GP26'), [340, 130], [340, 100]), T(346, 122, 'ขา 2', { muted: true }),
      DOT(250, 130), W([250, 130], [250, 105]), FLAG(250, 105, 'โพรบ'),
      P2('R', pc.pin('GP15'), [260, 180], 'R1', '220 Ω'), W([260, 180], [270, 180]), P2('LED', [270, 180], [270, 260], 'LED1'), GND(270, 260),
      W(pc.pin('GND'), [200, 220]), GND(200, 220),
      T(300, 292, 'แกนกลาง VR → ADC0 (0–3.3 V) · PWM duty = read_u16() → ความสว่างเฉลี่ย', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 43 Arduino Uno ---------- */

const uno: Schematic = (() => {
  const u = box([40, 40], 130, 180, 'Arduino Uno R3', [{ side: 'r', at: 40, name: 'D13', num: 'SCK' }, { side: 'r', at: 90, name: '~D9', num: 'PWM' }, { side: 'r', at: 150, name: 'GND' }], 'ATmega328P · 5 V');
  return {
    w: 520, h: 280,
    items: [
      u.it,
      P2('R', u.pin('D13'), [300, 80], 'R1', '220 Ω'), W([300, 80], [330, 80]), P2('LED', [330, 80], [330, 190], 'LED1'), W([330, 190], [330, 210]), GND(330, 210),
      W(u.pin('GND'), [220, 190]), GND(220, 190),
      T(250, 130, '(ไม่บังคับ) ย้ายปลาย R1 ไป ~D9 แล้วใช้ analogWrite', { muted: true }),
      T(270, 262, 'sketch.ino → avr-gcc → .hex → ATmega328P · Serial 9600 → Serial Monitor', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 44 LED RGB ---------- */

const rgb: Schematic = (() => {
  const u = box([30, 40], 130, 200, 'Arduino Uno R3', [{ side: 'r', at: 30, name: '~D9', num: 'PWM' }, { side: 'r', at: 80, name: '~D10', num: 'PWM' }, { side: 'r', at: 130, name: '~D11', num: 'PWM' }, { side: 'r', at: 180, name: 'GND' }], 'ATmega328P · 5 V');
  const ys = [70, 120, 170], xs = [330, 380, 430], lab = ['R', 'G', 'B'], col = ['แดง', 'เขียว', 'น้ำเงิน'], pins = ['~D9', '~D10', '~D11'];
  const it: Item[] = [u.it];
  for (let k = 0; k < 3; k++) {
    it.push(P2('R', u.pin(pins[k]), [270, ys[k]], `R${lab[k]}`, '220 Ω'), W([270, ys[k]], [xs[k], ys[k]]), P2('LED', [xs[k], ys[k]], [xs[k], 235], `${lab[k]}`), T(xs[k] + 8, 205, col[k], { muted: true }));
  }
  it.push(W([330, 235], [430, 235]), W([380, 235], [380, 250]), T(440, 239, 'COM (ขายาว)', { muted: true }), GND(380, 250), W(u.pin('GND'), [200, 220]), GND(200, 220),
    T(250, 296, 'LED RGB แคโทดร่วม: ขาเรียง R · COM · G · B · analogWrite(ขา, 0–255) ผสมสี', { a: 'middle', muted: true }));
  return { w: 540, h: 310, items: it };
})();

/* ---------- 45–46 I²C: จอ OLED และ Smart Watch ---------- */

const oled: Schematic = (() => {
  const pp = box([40, 40], 120, 200, PICO, [{ side: 'r', at: 30, name: 'GP4', num: '6 · SDA' }, { side: 'r', at: 70, name: 'GP5', num: '7 · SCL' }, { side: 'r', at: 140, name: '3V3', num: 36 }, { side: 'r', at: 180, name: 'GND', num: 38 }], 'I2C0');
  const od = box([360, 40], 120, 200, 'OLED 128×64', [{ side: 'l', at: 30, name: 'SDA' }, { side: 'l', at: 70, name: 'SCL' }, { side: 'l', at: 140, name: 'VCC' }, { side: 'l', at: 180, name: 'GND' }], 'SSD1306 · 0x3C');
  return {
    w: 540, h: 290,
    items: [
      pp.it, od.it,
      W(pp.pin('GP4'), od.pin('SDA')), W(pp.pin('GP5'), od.pin('SCL')), W(pp.pin('3V3'), od.pin('VCC')), W(pp.pin('GND'), od.pin('GND')), DOT(260, 220), W([260, 220], [260, 240]), GND(260, 240),
      T(260, 62, 'SDA (ข้อมูล)', { a: 'middle', muted: true }), T(260, 102, 'SCL (สัญญาณนาฬิกา)', { a: 'middle', muted: true }),
      T(260, 274, 'ตัวต้านทานดึงขึ้น 4.7 kΩ อยู่บนโมดูล · i2c.scan() → [60] (0x3C)', { a: 'middle', muted: true }),
    ],
  };
})();

const watch: Schematic = (() => {
  const pp = box([30, 40], 120, 300, PICO, [
    { side: 'r', at: 20, name: 'GP4', num: '6 · SDA' }, { side: 'r', at: 50, name: 'GP5', num: '7 · SCL' }, { side: 'r', at: 150, name: 'GP15', num: 20 },
    { side: 'r', at: 220, name: 'GP16', num: 21 }, { side: 'r', at: 265, name: '3V3', num: 36 }, { side: 'r', at: 290, name: 'GND', num: 38 }], 'I2C0');
  const sda = pp.pin('GP4'), scl = pp.pin('GP5');
  const devs: Array<[number, string, string]> = [[420, 'OLED', 'SSD1306 · 0x3C'], [545, 'DS3231', 'RTC · 0x68'], [670, 'MPU6050', 'AD0 → 3V3 · 0x69']];
  const it: Item[] = [pp.it, W(sda, [740, sda[1]]), W(scl, [740, scl[1]]), T(230, sda[1] - 6, 'SDA', { muted: true }), T(230, scl[1] - 6, 'SCL', { muted: true })];
  for (const [x, name, sub] of devs) {
    const b = box([x, 130], 100, 60, name, [{ side: 't', at: 30, name: 'SDA' }, { side: 't', at: 70, name: 'SCL' }], sub);
    const a = b.pin('SDA'), c = b.pin('SCL');
    it.push(b.it, DOT(a[0], sda[1]), W([a[0], sda[1]], a), DOT(c[0], scl[1]), W([c[0], scl[1]], c));
  }
  it.push(T(580, 215, 'VCC ของทุกโมดูล → 3V3 · GND → GND', { a: 'middle', muted: true }));
  // ปุ่ม GP15 → GND (pull-up ภายใน)
  const b15 = pp.pin('GP15');
  it.push(P2('PB', b15, [250, b15[1]], 'SW1', 'สลับหน้า'), W([250, b15[1]], [250, b15[1] + 20]), GND(250, b15[1] + 20));
  // GP16 → 1 kΩ → 2N3904 → มอเตอร์สั่น + ไดโอดกันย้อน → 3V3
  const g16 = pp.pin('GP16'), q: Pt = [330, g16[1]];
  const np = npnPins(q);
  it.push(P2('R', g16, np.B, 'RB', '1 kΩ'), { t: 'npn', at: q, label: 'Q1', value: '2N3904' }, GND(np.E[0], np.E[1]),
    P2('M', np.C, [np.C[0], np.C[1] - 70], 'M1', 'สั่น 3 V'), DOT(np.C[0], np.C[1] - 10), W([np.C[0], np.C[1] - 10], [np.C[0] + 60, np.C[1] - 10]),
    P2('D', [np.C[0] + 60, np.C[1] - 10], [np.C[0] + 60, np.C[1] - 70], 'D1', '1N4148'), W([np.C[0], np.C[1] - 70], [np.C[0] + 60, np.C[1] - 70]), DOT(np.C[0], np.C[1] - 70),
    VCC(np.C[0], np.C[1] - 70, '3V3'));
  it.push(W(pp.pin('3V3'), [190, pp.pin('3V3')[1]]), FLAG(190, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [180, pp.pin('GND')[1]], [180, pp.pin('GND')[1] + 10]), GND(180, pp.pin('GND')[1] + 10));
  it.push(T(400, 382, 'นับก้าวจากขนาดความเร่ง (ยอด > 1.2 g = 1 ก้าว) · เวลาเป็น BCD ใน 0x00–0x02 ของ DS3231', { a: 'middle', muted: true }));
  return { w: 800, h: 400, items: it };
})();

const roundwatch: Schematic = (() => {
  // Pico: ขาด้านขวาเรียงตามแนวสายไปยังจอ (สายแนวนอนตรง)
  const pp = box([30, 140], 120, 410, PICO, [
    { side: 'r', at: 30, name: 'GP6', num: '9 · SDA' }, { side: 'r', at: 60, name: 'GP7', num: '10 · SCL' },
    { side: 'r', at: 100, name: 'GP8', num: 11 }, { side: 'r', at: 130, name: 'GP9', num: 12 }, { side: 'r', at: 160, name: 'GP10', num: '14 · SCK' }, { side: 'r', at: 190, name: 'GP11', num: '15 · TX' },
    { side: 'r', at: 220, name: 'GP13', num: 17 }, { side: 'r', at: 250, name: 'GP14', num: 19 }, { side: 'r', at: 280, name: 'GP16', num: 21 }, { side: 'r', at: 310, name: 'GP17', num: 22 },
    { side: 'r', at: 340, name: 'GP18', num: 24 }, { side: 'r', at: 370, name: '3V3', num: 36 }, { side: 'r', at: 390, name: 'GND', num: 38 }], 'SPI1 + I2C1');
  const lcd = box([580, 150], 150, 320, 'จอกลม GC9A01', [
    { side: 'l', at: 20, name: 'TP_SDA' }, { side: 'l', at: 50, name: 'TP_SCL' }, { side: 'l', at: 90, name: 'LCD_DC' }, { side: 'l', at: 120, name: 'LCD_CS' }, { side: 'l', at: 150, name: 'SCLK' },
    { side: 'l', at: 180, name: 'MOSI' }, { side: 'l', at: 210, name: 'LCD_RST' }, { side: 'l', at: 240, name: 'LCD_BL' }, { side: 'l', at: 270, name: 'TP_RST' }, { side: 'l', at: 300, name: 'TP_INT' }], '+ ทัช CST816S 0x15');
  const it: Item[] = [pp.it, lcd.it];
  const pairs: Array<[string, string]> = [['GP6', 'TP_SDA'], ['GP7', 'TP_SCL'], ['GP8', 'LCD_DC'], ['GP9', 'LCD_CS'], ['GP10', 'SCLK'], ['GP11', 'MOSI'], ['GP13', 'LCD_RST'], ['GP14', 'LCD_BL'], ['GP16', 'TP_RST'], ['GP17', 'TP_INT']];
  for (const [a, b] of pairs) it.push(W(pp.pin(a), lcd.pin(b)));
  it.push(T(470, 164, 'SDA', { muted: true }), T(470, 194, 'SCL', { muted: true }));
  // DS3231 และ QMI8658 บนบัส I²C เดียวกับทัช
  const sda = pp.pin('GP6'), scl = pp.pin('GP7');
  for (const [x, name, sub] of [[250, 'DS3231', 'RTC · 0x68'], [400, 'QMI8658', 'IMU · 0x6A']] as Array<[number, string, string]>) {
    const bx = box([x, 40], 100, 60, name, [{ side: 'b', at: 30, name: 'SDA' }, { side: 'b', at: 70, name: 'SCL' }], sub);
    const a = bx.pin('SDA'), c = bx.pin('SCL');
    it.push(bx.it, W(a, [a[0], sda[1]]), DOT(a[0], sda[1]), W(c, [c[0], scl[1]]), DOT(c[0], scl[1]));
  }
  it.push(T(400, 25, 'VCC ของทุกโมดูล → 3V3 · GND → GND', { a: 'middle', muted: true }));
  // มอเตอร์สั่น: GP18 → 1 kΩ → 2N3904 (อยู่ขวาของจอ)
  const g18 = pp.pin('GP18'), q: Pt = [790, g18[1]];
  const np = npnPins(q);
  it.push(W(g18, [700, g18[1]]), P2('R', [700, g18[1]], np.B, 'RB', '1 kΩ'), { t: 'npn', at: q, label: 'Q1', value: '2N3904' }, GND(np.E[0], np.E[1]),
    P2('M', np.C, [np.C[0], np.C[1] - 70], 'M1', 'สั่น 3 V'), DOT(np.C[0], np.C[1] - 10), W([np.C[0], np.C[1] - 10], [np.C[0] + 60, np.C[1] - 10]),
    P2('D', [np.C[0] + 60, np.C[1] - 10], [np.C[0] + 60, np.C[1] - 70], 'D1', '1N4148'), W([np.C[0], np.C[1] - 70], [np.C[0] + 60, np.C[1] - 70]), DOT(np.C[0], np.C[1] - 70),
    VCC(np.C[0], np.C[1] - 70, '3V3'));
  it.push(W(pp.pin('3V3'), [210, pp.pin('3V3')[1]]), FLAG(210, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [190, pp.pin('GND')[1]], [190, pp.pin('GND')[1] + 10]), GND(190, pp.pin('GND')[1] + 10));
  it.push(T(450, 590, 'SPI1: GP10 = SCK, GP11 = MOSI (MISO ไม่ต่อ) · ภาพ 240×240 RGB565 จาก bg.bin · ทัชส่งพัลส์ต่ำที่ TP_INT เมื่อจำท่าทางได้', { a: 'middle', muted: true }));
  return { w: 900, h: 610, items: it };
})();

const weather: Schematic = (() => {
  const pp = box([30, 160], 120, 200, PICO, [
    { side: 'r', at: 30, name: 'GP4', num: '6 · SDA' }, { side: 'r', at: 60, name: 'GP5', num: '7 · SCL' },
    { side: 'r', at: 110, name: 'VBUS', num: 40 }, { side: 'r', at: 150, name: '3V3', num: 36 }, { side: 'r', at: 180, name: 'GND', num: 38 }], 'I2C0');
  const lcd = box([600, 170], 140, 160, 'LCD 16×2', [
    { side: 'l', at: 20, name: 'SDA' }, { side: 'l', at: 50, name: 'SCL' }, { side: 'l', at: 100, name: 'VCC' }, { side: 'l', at: 140, name: 'GND' }], 'PCF8574 · 0x27');
  const it: Item[] = [pp.it, lcd.it];
  const sda = pp.pin('GP4'), scl = pp.pin('GP5');
  it.push(W(sda, lcd.pin('SDA')), W(scl, lcd.pin('SCL')), W(pp.pin('VBUS'), lcd.pin('VCC')), T(470, pp.pin('VBUS')[1] - 6, 'VBUS 5 V', { muted: true }));
  it.push(W(pp.pin('GND'), [200, pp.pin('GND')[1]]), DOT(200, pp.pin('GND')[1]), W([200, pp.pin('GND')[1]], [200, lcd.pin('GND')[1]], lcd.pin('GND')), W([200, pp.pin('GND')[1]], [200, 380]), GND(200, 380));
  it.push(W(pp.pin('3V3'), [240, pp.pin('3V3')[1]]), FLAG(240, pp.pin('3V3')[1], '3V3'));
  for (const [x, name, sub] of [[260, 'BMP280', '0x76 · 3.3 V'], [420, 'BH1750', '0x23 · 3.3 V']] as Array<[number, string, string]>) {
    const bx = box([x, 50], 100, 60, name, [{ side: 'b', at: 30, name: 'SDA' }, { side: 'b', at: 70, name: 'SCL' }], sub);
    const a = bx.pin('SDA'), c = bx.pin('SCL');
    it.push(bx.it, W(a, [a[0], sda[1]]), DOT(a[0], sda[1]), W(c, [c[0], scl[1]]), DOT(c[0], scl[1]));
  }
  it.push(T(400, 30, 'VCC ของ BMP280 และ BH1750 → 3V3 (มีตัวดึงขึ้น SDA/SCL ไป 3.3 V บนโมดูล) · GND → GND', { a: 'middle', muted: true }));
  it.push(T(670, 355, 'ถอดตัวดึงขึ้น 4.7 kΩ บนบอร์ด I²C ของจอ (ต่อไป 5 V)', { a: 'middle', muted: true }));
  return { w: 800, h: 410, items: it };
})();

const powermeter: Schematic = (() => {
  const pp = box([30, 150], 120, 230, PICO, [
    { side: 'r', at: 30, name: 'GP4', num: '6 · SDA' }, { side: 'r', at: 60, name: 'GP5', num: '7 · SCL' },
    { side: 'r', at: 100, name: 'GP14', num: 19 }, { side: 'r', at: 130, name: 'GP15', num: 20 },
    { side: 'r', at: 170, name: 'VBUS', num: 40 }, { side: 'r', at: 200, name: '3V3', num: 36 }, { side: 'r', at: 220, name: 'GND', num: 38 }], 'I2C0');
  const ina = box([300, 40], 150, 90, 'INA219', [{ side: 'b', at: 30, name: 'SDA' }, { side: 'b', at: 60, name: 'SCL' }, { side: 'r', at: 30, name: 'VIN+' }, { side: 'r', at: 65, name: 'VIN−' }], '0x40 · shunt 0.1 Ω');
  const tm = box([620, 225], 140, 90, 'TM1637', [{ side: 'l', at: 25, name: 'CLK' }, { side: 'l', at: 55, name: 'DIO' }], '4 หลัก 7 ส่วน');
  const it: Item[] = [pp.it, ina.it, tm.it];
  const sda = pp.pin('GP4'), scl = pp.pin('GP5');
  const a = ina.pin('SDA'), c = ina.pin('SCL');
  it.push(W(sda, [a[0], sda[1]], a), W(scl, [c[0], scl[1]], c));
  it.push(W(pp.pin('GP14'), tm.pin('CLK')), W(pp.pin('GP15'), tm.pin('DIO')));
  // ทางโหลด: VBUS → VIN+ → shunt → VIN− → R1 → LED1 → GND
  const vb = pp.pin('VBUS'), vp = ina.pin('VIN+'), vm = ina.pin('VIN−');
  it.push(W(vb, [530, vb[1]]), DOT(530, vb[1]), T(500, vb[1] - 6, 'VBUS 5 V', { muted: true }), W([530, vb[1]], [530, 110]), W([530, 110], [560, 110]), W([560, 110], [560, vp[1]], vp));
  it.push(W(vm, [480, vm[1]]), W([480, vm[1]], [480, 130]), W([480, 130], [490, 130]));
  it.push(P2('R', [490, 130], [490, 175], 'R1', '150 Ω'));
  it.push(W(pp.pin('GND'), [210, pp.pin('GND')[1]]), DOT(210, pp.pin('GND')[1]), W([210, pp.pin('GND')[1]], [210, 420]), GND(210, 420));
  it.push(W(pp.pin('3V3'), [250, pp.pin('3V3')[1]]), FLAG(250, pp.pin('3V3')[1], '3V3'));
  it.push(W([490, 175], [450, 175]), P2('LED', [450, 175], [450, 225], 'LED1'), GND(450, 225));
  it.push(T(400, 25, 'VCC ของ INA219 และ TM1637 → 3V3 · GND ทุกตัวร่วมกัน', { a: 'middle', muted: true }));
  it.push(T(400, 440, 'กระแส = V(shunt) / 0.1 Ω · calibration 4096 → รีจิสเตอร์กระแส 0.1 mA ต่อบิต, กำลัง 2 mW ต่อบิต', { a: 'middle', muted: true }));
  return { w: 800, h: 460, items: it };
})();

const keypad: Schematic = (() => {
  const pins = ['GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', '3V3', 'GND'];
  const nums = [9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 36, 38];
  const pp = box([30, 40], 120, 450, PICO, pins.map((name, i) => ({ side: 'r' as const, at: 25 + i * 30 + (i >= 8 ? 20 : 0) + (i >= 12 ? 20 : 0), name, num: nums[i] })));
  const kp = box([420, 40], 150, 260, 'ปุ่ม 4×4', ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].map((name, i) => ({ side: 'l' as const, at: 25 + i * 30, name })), 'เมทริกซ์ 16 ปุ่ม');
  const tm = box([420, 300], 150, 70, 'TM1637', [{ side: 'l', at: 25, name: 'CLK' }, { side: 'l', at: 55, name: 'DIO' }], '4 หลัก');
  const it: Item[] = [pp.it, kp.it, tm.it];
  ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'].forEach((l, i) => it.push(W(pp.pin(pins[i]), kp.pin(l))));
  it.push(W(pp.pin('GP14'), [300, pp.pin('GP14')[1]], [300, tm.pin('CLK')[1]], tm.pin('CLK')), W(pp.pin('GP15'), [320, pp.pin('GP15')[1]], [320, tm.pin('DIO')[1]], tm.pin('DIO')));
  for (const [gp, x, lab] of [['GP16', 700, 'LED เขียว'], ['GP17', 560, 'LED แดง']] as const) {
    const a = pp.pin(gp);
    it.push(W(a, [x, a[1]]), P2('R', [x, a[1]], [x, a[1] + 50], gp === 'GP16' ? 'R1' : 'R2', '330 Ω'), P2('LED', [x, a[1] + 50], [x, a[1] + 100], lab), GND(x, a[1] + 100));
  }
  it.push(W(pp.pin('3V3'), [200, pp.pin('3V3')[1]]), FLAG(200, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [180, pp.pin('GND')[1]], [180, pp.pin('GND')[1] + 15]), GND(180, pp.pin('GND')[1] + 15));
  it.push(T(420, 565, 'TM1637: VCC → 3V3 · GND → GND · แถว (GP6–9) = เอาต์พุต ดึงลงทีละแถว · คอลัมน์ (GP10–13) = ขาเข้า PULL_UP', { a: 'middle', muted: true }));
  return { w: 800, h: 580, items: it };
})();

const encoder: Schematic = (() => {
  const pp = box([30, 40], 120, 330, PICO, [
    { side: 'r', at: 25, name: 'GP22', num: 29 }, { side: 'r', at: 55, name: 'GP21', num: 27 }, { side: 'r', at: 85, name: 'GP20', num: 26 },
    { side: 'r', at: 135, name: 'GP26/ADC0', num: 31 }, { side: 'r', at: 165, name: 'GP27/ADC1', num: 32 }, { side: 'r', at: 195, name: 'GP19', num: 25 },
    { side: 'r', at: 245, name: 'GP14', num: 19 }, { side: 'r', at: 275, name: 'GP15', num: 20 }, { side: 'r', at: 300, name: '3V3', num: 36 }, { side: 'r', at: 320, name: 'GND', num: 38 }]);
  const enc = box([480, 50], 140, 100, 'KY-040', [{ side: 'l', at: 15, name: 'CLK' }, { side: 'l', at: 45, name: 'DT' }, { side: 'l', at: 75, name: 'SW' }], 'rotary encoder');
  const js = box([480, 160], 140, 100, 'KY-023', [{ side: 'l', at: 15, name: 'VRx' }, { side: 'l', at: 45, name: 'VRy' }, { side: 'l', at: 75, name: 'SW' }], 'จอยสติ๊ก');
  const tm = box([480, 270], 140, 70, 'TM1637', [{ side: 'l', at: 15, name: 'CLK' }, { side: 'l', at: 45, name: 'DIO' }], '4 หลัก');
  const it: Item[] = [pp.it, enc.it, js.it, tm.it];
  const link = (a: Pt, b: Pt, x: number) => it.push(W(a, [x, a[1]], [x, b[1]], b));
  link(pp.pin('GP22'), enc.pin('CLK'), 300); link(pp.pin('GP21'), enc.pin('DT'), 320); link(pp.pin('GP20'), enc.pin('SW'), 340);
  link(pp.pin('GP26/ADC0'), js.pin('VRx'), 360); link(pp.pin('GP27/ADC1'), js.pin('VRy'), 380); link(pp.pin('GP19'), js.pin('SW'), 400);
  link(pp.pin('GP14'), tm.pin('CLK'), 420); link(pp.pin('GP15'), tm.pin('DIO'), 440);
  it.push(W(pp.pin('3V3'), [200, pp.pin('3V3')[1]]), FLAG(200, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [180, pp.pin('GND')[1]], [180, pp.pin('GND')[1] + 15]), GND(180, pp.pin('GND')[1] + 15));
  it.push(T(550, 30, 'ไฟเลี้ยงทุกโมดูล (+, +5V, VCC) → 3V3 · GND → GND', { a: 'middle', muted: true }));
  it.push(T(450, 420, 'CLK/DT มีตัวดึงขึ้น 10 kΩ บนโมดูล · SW ทั้งสองใช้ PULL_UP ในขา · VRx/VRy เข้าขา ADC', { a: 'middle', muted: true }));
  return { w: 800, h: 440, items: it };
})();

const pulldown: Schematic = (() => {
  const pp = box([30, 60], 120, 230, PICO, [
    { side: 'r', at: 30, name: 'GP14', num: 19 }, { side: 'r', at: 90, name: 'GP15', num: 20 },
    { side: 'r', at: 140, name: 'GP16', num: 21 }, { side: 'r', at: 170, name: 'GP17', num: 22 }, { side: 'r', at: 200, name: '3V3', num: 36 }, { side: 'r', at: 220, name: 'GND', num: 38 }]);
  const it: Item[] = [pp.it];
  // SW1: 3V3 → ปุ่ม → GP14, R 10 kΩ ลง GND
  const g14 = pp.pin('GP14');
  it.push(W(g14, [330, g14[1]]), DOT(330, g14[1]), P2('PB', [330, g14[1]], [330, g14[1] - 60], 'SW1', 'ดึงลง'), VCC(330, g14[1] - 60, '3V3'));
  it.push(W([330, g14[1]], [420, g14[1]]), P2('R', [420, g14[1]], [420, g14[1] + 60], 'R1', '10 kΩ'), GND(420, g14[1] + 60));
  // SW2: GP15 → ปุ่ม → GND
  const g15 = pp.pin('GP15');
  it.push(W(g15, [260, g15[1]]), P2('PB', [260, g15[1]], [330, g15[1]], 'SW2', 'ดึงขึ้นภายใน'), W([330, g15[1]], [330, g15[1] + 20]), GND(330, g15[1] + 20));
  for (const [gp, x, lab, rl] of [['GP16', 680, 'LED1 แดง', 'R2'], ['GP17', 520, 'LED2 เขียว', 'R3']] as const) {
    const a = pp.pin(gp);
    it.push(W(a, [x, a[1]]), P2('R', [x, a[1]], [x, a[1] + 50], rl, '330 Ω'), P2('LED', [x, a[1] + 50], [x, a[1] + 100], lab), GND(x, a[1] + 100));
  }
  it.push(W(pp.pin('3V3'), [200, pp.pin('3V3')[1]]), FLAG(200, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [180, pp.pin('GND')[1]], [180, pp.pin('GND')[1] + 15]), GND(180, pp.pin('GND')[1] + 15));
  it.push(T(400, 380, 'SW1 ปล่อย = 0 / กด = 1 · SW2 ปล่อย = 1 / กด = 0', { a: 'middle', muted: true }));
  return { w: 760, h: 400, items: it };
})();

const alarm: Schematic = (() => {
  const pp = box([30, 40], 120, 300, PICO, [
    { side: 'r', at: 15, name: 'GP14', num: 19 }, { side: 'r', at: 80, name: 'GP15', num: 20 }, { side: 'r', at: 145, name: 'GP13', num: 17 },
    { side: 'r', at: 210, name: 'GP16', num: 21 }, { side: 'r', at: 235, name: 'GP17', num: 22 },
    { side: 'r', at: 260, name: 'VBUS', num: 40 }, { side: 'r', at: 280, name: '3V3', num: 36 }, { side: 'r', at: 295, name: 'GND', num: 38 }]);
  const pir = box([520, 30], 140, 50, 'HC-SR501', [{ side: 'l', at: 25, name: 'OUT' }], 'PIR · VCC 5 V');
  const ir = box([520, 95], 140, 50, 'FC-51', [{ side: 'l', at: 25, name: 'OUT' }], 'IR · VCC 3V3');
  const dh = box([520, 160], 140, 50, 'DHT11', [{ side: 'l', at: 25, name: 'DATA' }], 'VDD 3V3');
  const it: Item[] = [pp.it, pir.it, ir.it, dh.it];
  const link = (a: Pt, b: Pt, x: number) => it.push(W(a, [x, a[1]], [x, b[1]], b));
  link(pp.pin('GP14'), pir.pin('OUT'), 300); link(pp.pin('GP15'), ir.pin('OUT'), 330);
  const d = pp.pin('GP13'), dd = dh.pin('DATA');
  link(d, dd, 360);
  it.push(DOT(440, dd[1]), P2('R', [440, dd[1]], [440, dd[1] + 45], 'R1', '10 kΩ'), W([440, dd[1] + 45], [470, dd[1] + 45]), FLAG(470, dd[1] + 45, '3V3'));
  for (const [gp, x, lab, rl] of [['GP16', 680, 'LED แดง (แจ้งเตือน)', 'R2'], ['GP17', 540, 'LED เหลือง (วัตถุ)', 'R3']] as const) {
    const a = pp.pin(gp);
    it.push(W(a, [x, a[1]]), P2('R', [x, a[1]], [x, a[1] + 50], rl, '330 Ω'), P2('LED', [x, a[1] + 50], [x, a[1] + 100], lab), GND(x, a[1] + 100));
  }
  it.push(W(pp.pin('VBUS'), [220, pp.pin('VBUS')[1]]), FLAG(220, pp.pin('VBUS')[1], '5V'));
  it.push(W(pp.pin('3V3'), [200, pp.pin('3V3')[1]]), FLAG(200, pp.pin('3V3')[1], '3V3'), W(pp.pin('GND'), [180, pp.pin('GND')[1]], [180, pp.pin('GND')[1] + 15]), GND(180, pp.pin('GND')[1] + 15));
  it.push(T(420, 420, 'PIR: VCC → 5V (VBUS) · FC-51/DHT11: VCC → 3V3 · GND ทุกตัวร่วมกัน · FC-51 พบวัตถุ = 0', { a: 'middle', muted: true }));
  return { w: 800, h: 440, items: it };
})();

/* ---------- 54 Raspberry Pi 5 + gpiozero ---------- */

const rpi5: Schematic = (() => {
  const pp = box([30, 50], 130, 250, 'Raspberry Pi 5', [
    { side: 'r', at: 30, name: 'GPIO27', num: 13 }, { side: 'r', at: 110, name: 'GPIO17', num: 11 }, { side: 'r', at: 160, name: 'GPIO18', num: 12 },
    { side: 'r', at: 230, name: 'GND', num: 14 }], 'J8 · ลอจิก 3.3 V');
  const it: Item[] = [pp.it];
  // ปุ่ม: GPIO27 → SW1 → GND (pull-up ภายในของ Button)
  const g27 = pp.pin('GPIO27');
  it.push(W(g27, [300, g27[1]]), P2('PB', [300, g27[1]], [380, g27[1]], 'SW1', 'Button(27)'), W([380, g27[1]], [420, g27[1]], [420, g27[1] + 20]), GND(420, g27[1] + 20));
  for (const [gp, x, lab, rl, note] of [['GPIO17', 540, 'LED1 แดง', 'R1', 'LED(17)'], ['GPIO18', 400, 'LED2 เขียว', 'R2', 'PWMLED(18)']] as const) {
    const a = pp.pin(gp);
    it.push(W(a, [x, a[1]]), P2('R', [x, a[1]], [x, a[1] + 50], rl, '330 Ω'), P2('LED', [x, a[1] + 50], [x, a[1] + 100], lab), GND(x, a[1] + 100), T(x + 10, a[1] - 8, note, { muted: true }));
  }
  it.push(W(pp.pin('GND'), [200, pp.pin('GND')[1]], [200, pp.pin('GND')[1] + 15]), GND(200, pp.pin('GND')[1] + 15));
  it.push(T(330, 345, 'เลขในวงเล็บของโค้ด = เลข GPIO (BCM) · ตัวเลขข้างขา = เลขขาบนหัวต่อ 40 ขา', { a: 'middle', muted: true }));
  return { w: 660, h: 360, items: it };
})();

/* ---------- 55 Arduino Nano ---------- */

const nano: Schematic = (() => {
  const u = box([40, 40], 130, 210, 'Arduino Nano', [{ side: 'r', at: 30, name: '5V', num: 27 }, { side: 'r', at: 90, name: 'A7', num: 26 }, { side: 'r', at: 140, name: '~D9', num: 12 }, { side: 'r', at: 190, name: 'GND', num: 29 }], 'ATmega328P · 5 V');
  return {
    w: 560, h: 310,
    items: [
      u.it,
      W(u.pin('5V'), [300, 70]), { t: 'pot', a: [300, 70], b: [380, 70], label: 'VR1 10 kΩ', value: 'ขา 3 ซ้าย · ขา 1 ขวา' }, W([380, 70], [440, 70], [440, 90]), GND(440, 90),
      W(u.pin('A7'), [340, 130], [340, 100]), T(346, 122, 'ขา 2', { muted: true }),
      P2('R', u.pin('~D9'), [270, 180], 'R1', '220 Ω'), W([270, 180], [290, 180]), P2('LED', [290, 180], [290, 260], 'LED1'), GND(290, 260),
      W(u.pin('GND'), [220, 230]), GND(220, 230),
      T(280, 300, 'A7 = แอนะล็อกอย่างเดียว (analogRead 0–1023) · analogWrite(9, A7 / 4) · เลขข้างขา = เลขขาของ Nano', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 56 เครื่องวิเคราะห์ลอจิก ---------- */

const logicLa: Schematic = (() => {
  const u = box([40, 40], 130, 190, 'Arduino Uno R3', [{ side: 'r', at: 40, name: '~D9', num: 'PWM' }, { side: 'r', at: 100, name: 'D1', num: 'TX' }, { side: 'r', at: 160, name: 'GND' }], 'ATmega328P · 5 V');
  const la = box([380, 40], 130, 190, 'เครื่องวิเคราะห์ลอจิก', [{ side: 'l', at: 40, name: 'CH0' }, { side: 'l', at: 100, name: 'CH1' }, { side: 'l', at: 160, name: 'GND' }], '8 ช่อง');
  return {
    w: 560, h: 290,
    items: [
      u.it, la.it,
      W(u.pin('~D9'), la.pin('CH0')), W(u.pin('D1'), la.pin('CH1')), W(u.pin('GND'), la.pin('GND')),
      DOT(270, 200), W([270, 200], [270, 230]), GND(270, 230),
      T(280, 278, 'CH0: PWM 490 Hz (analogWrite) · CH1: เฟรม UART 9600 baud (Serial.print) · GND ร่วมกัน', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 57 จอ LCD 16×2 แบบขนาน ---------- */

const lcdPar: Schematic = (() => {
  const u = box([40, 40], 130, 270, 'Arduino Uno R3', [
    { side: 'r', at: 30, name: '5V' }, { side: 'r', at: 70, name: 'D12' }, { side: 'r', at: 100, name: '~D11' }, { side: 'r', at: 130, name: '~D5' },
    { side: 'r', at: 160, name: 'D4' }, { side: 'r', at: 190, name: '~D3' }, { side: 'r', at: 220, name: 'D2' }, { side: 'r', at: 250, name: 'GND' },
  ], 'ATmega328P · 5 V');
  const l = box([420, 40], 180, 240, 'LCD 16×2 (HD44780)', [
    { side: 'l', at: 70, name: 'RS', num: 4 }, { side: 'l', at: 100, name: 'E', num: 6 }, { side: 'l', at: 130, name: 'D4', num: 11 }, { side: 'l', at: 160, name: 'D5', num: 12 },
    { side: 'l', at: 190, name: 'D6', num: 13 }, { side: 'l', at: 220, name: 'D7', num: 14 },
    { side: 'b', at: 15, name: 'VSS', num: 1 }, { side: 'b', at: 40, name: 'VDD', num: 2 }, { side: 'b', at: 65, name: 'V0', num: 3 }, { side: 'b', at: 90, name: 'RW', num: 5 },
    { side: 'b', at: 130, name: 'A', num: 15 }, { side: 'b', at: 165, name: 'K', num: 16 },
  ], 'แบบขนาน · D0–D3 ไม่ต่อ');
  return {
    w: 660, h: 500,
    items: [
      u.it, l.it,
      W(u.pin('D12'), l.pin('RS')), W(u.pin('~D11'), l.pin('E')), W(u.pin('~D5'), l.pin('D4')), W(u.pin('D4'), l.pin('D5')), W(u.pin('~D3'), l.pin('D6')), W(u.pin('D2'), l.pin('D7')),
      W(u.pin('5V'), [230, 70]), FLAG(230, 70, '5V'),
      W(u.pin('GND'), [220, 290], [220, 310]), GND(220, 310),
      W(l.pin('VSS'), [435, 320]), GND(435, 320),
      W(l.pin('VDD'), [460, 370], [420, 370]), FLAG(420, 370, '5V', 'l'),
      W(l.pin('RW'), [510, 320]), GND(510, 320),
      P2('R', l.pin('A'), [550, 360], 'R1', '220 Ω'), W([550, 360], [550, 380]), FLAG(550, 380, '5V', 'l'),
      W(l.pin('K'), [585, 410]), GND(585, 410),
      W([280, 400], [300, 400]), FLAG(280, 400, '5V', 'l'), { t: 'pot', a: [300, 400], b: [380, 400], label: 'VR1 10 kΩ', value: 'ปรับ V0' }, W([380, 400], [400, 400], [400, 420]), GND(400, 420),
      W(l.pin('V0'), [485, 450], [340, 450], [340, 430]),
      T(330, 488, 'LiquidCrystal lcd(12, 11, 5, 4, 3, 2) — โหมด 4 บิต · RW ต่อ GND · หมุน VR ให้ V0 ≈ 0.3–1 V · เลขข้างขา = เลขขาของจอ', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- 58 ถอดรหัส I²C ---------- */

const i2cLa: Schematic = (() => {
  const u = box([40, 40], 130, 210, 'Arduino Uno R3', [{ side: 'r', at: 30, name: '5V' }, { side: 'r', at: 80, name: 'A4', num: 'SDA' }, { side: 'r', at: 130, name: 'A5', num: 'SCL' }, { side: 'r', at: 180, name: 'GND' }], 'ATmega328P · 5 V');
  const s = box([400, 40], 200, 120, 'BH1750 (GY-302)', [{ side: 'l', at: 20, name: 'VCC' }, { side: 'l', at: 40, name: 'SDA' }, { side: 'l', at: 60, name: 'SCL' }, { side: 'l', at: 80, name: 'ADDR' }, { side: 'l', at: 100, name: 'GND' }], 'ที่อยู่ 0x23 (ADDR ไม่ต่อ)');
  const la = box([400, 200], 200, 90, 'เครื่องวิเคราะห์ลอจิก', [{ side: 'l', at: 20, name: 'CH0' }, { side: 'l', at: 45, name: 'CH1' }, { side: 'l', at: 70, name: 'GND' }], '8 ช่อง');
  return {
    w: 640, h: 340,
    items: [
      u.it, s.it, la.it,
      W(u.pin('5V'), [300, 70], [300, 60], s.pin('VCC')),
      W(u.pin('A4'), [320, 120], [320, 80], s.pin('SDA')), DOT(320, 120), W([320, 120], [320, 220], la.pin('CH0')),
      W(u.pin('A5'), [340, 170], [340, 100], s.pin('SCL')), DOT(340, 170), W([340, 170], [340, 245], la.pin('CH1')),
      W(u.pin('GND'), [240, 220], [240, 300]), GND(240, 300),
      W(s.pin('GND'), [360, 140], [360, 160]), GND(360, 160),
      W(la.pin('GND'), [360, 270], [360, 290]), GND(360, 290),
      T(320, 330, 'SDA = A4 · SCL = A5 (ตัวต้านทานดึงขึ้นอยู่บนโมดูล) · CH0 = I²C SDA, CH1 = I²C SCL · GND ร่วมกัน', { a: 'middle', muted: true }),
    ],
  };
})();

/* ---------- โปรเจกต์จบ 1: เครื่องจ่ายยา (UNO Q) ---------- */

const projDispenser: Schematic = (() => {
  const q = box([330, 60], 140, 420, 'Arduino UNO Q', [
    { side: 'l', at: 40, name: 'D2' }, { side: 'l', at: 95, name: 'D4' }, { side: 'l', at: 150, name: 'D7' }, { side: 'l', at: 205, name: 'D8' },
    { side: 'l', at: 260, name: 'A2' }, { side: 'l', at: 315, name: 'A3' }, { side: 'l', at: 370, name: 'D12' },
    { side: 'r', at: 40, name: 'D9' }, { side: 'r', at: 95, name: 'D10' }, { side: 'r', at: 150, name: 'D11' }, { side: 'r', at: 205, name: 'D6' },
    { side: 'r', at: 300, name: 'D5' }, { side: 'r', at: 360, name: 'SDA' }, { side: 'r', at: 390, name: 'SCL' },
    { side: 't', at: 40, name: '5V' }, { side: 'b', at: 70, name: 'GND' },
  ], 'ลอจิก 3.3 V');
  const hub = box([600, 60], 120, 230, 'แผ่นกระจายไฟ', [
    { side: 'l', at: 40, name: 'S1' }, { side: 'l', at: 95, name: 'S2' }, { side: 'l', at: 150, name: 'S3' }, { side: 'l', at: 205, name: 'S4' },
    { side: 'r', at: 40, name: 'CH1' }, { side: 'r', at: 95, name: 'CH2' }, { side: 'r', at: 150, name: 'CH3' }, { side: 'r', at: 205, name: 'CH4' },
    { side: 't', at: 60, name: 'V+' }, { side: 'b', at: 90, name: 'GND' },
  ], '470 µF');
  const lcd = box([600, 400], 140, 80, 'LCD I²C', [{ side: 'l', at: 20, name: 'SDA' }, { side: 'l', at: 50, name: 'SCL' }, { side: 'r', at: 20, name: 'VCC' }, { side: 'b', at: 60, name: 'GND' }], '16×2 · 0x27');
  const ir = box([60, 400], 100, 60, 'FC-51', [{ side: 'r', at: 30, name: 'OUT' }, { side: 't', at: 50, name: 'VCC' }, { side: 'b', at: 50, name: 'GND' }], 'IR');
  const items: Item[] = [q.it, hub.it, lcd.it, ir.it];
  // ปุ่ม: อาร์เคด 1–4 และปุ่ม 16 mm 2 ตัว (INPUT_PULLUP — กดแล้วขาเป็น LOW)
  ([['D2', 'BTN1'], ['D4', 'BTN2'], ['D7', 'BTN3'], ['D8', 'BTN4'], ['A2', 'PB1'], ['A3', 'PB2']] as const).forEach(([pin, lab]) => {
    const [x, y] = q.pin(pin);
    items.push(P2('PB', [x, y], [x - 80, y], lab, undefined, 't'), W([x - 80, y], [200, y], [200, y + 14]), GND(200, y + 14));
  });
  items.push(W(ir.pin('OUT'), q.pin('D12')), VCC(...ir.pin('VCC'), '5V'), GND(...ir.pin('GND')));
  // เซอร์โว: สัญญาณผ่านแผ่นกระจายไฟ
  ([['D9', 'S1', 'CH1', 'SV1'], ['D10', 'S2', 'CH2', 'SV2'], ['D11', 'S3', 'CH3', 'SV3'], ['D6', 'S4', 'CH4', 'SV4']] as const).forEach(([pin, s, ch, sv]) => {
    items.push(W(q.pin(pin), hub.pin(s)));
    const [x, y] = hub.pin(ch);
    items.push(P2('M', [x, y], [x + 90, y], sv, undefined, 't'));
  });
  items.push(VCC(...hub.pin('V+'), 'อะแดปเตอร์ 5 V 3 A'), GND(...hub.pin('GND')));
  // บัซเซอร์ผ่าน NPN
  const d5 = q.pin('D5'), npn = npnPins([880, d5[1]]);
  items.push(P2('R', d5, [640, d5[1]], 'R1', '1 kΩ', 't'), W([640, d5[1]], npn.B), { t: 'npn', at: [880, d5[1]], label: 'Q1', value: '2N3904' },
    GND(...npn.E), P2('BZ', npn.C, [npn.C[0], npn.C[1] - 50], 'BZ1', 'active 5 V'), VCC(npn.C[0], npn.C[1] - 50, '5V'));
  items.push(W(q.pin('SDA'), lcd.pin('SDA')), W(q.pin('SCL'), lcd.pin('SCL')), W(lcd.pin('VCC'), [820, lcd.pin('VCC')[1]]), VCC(820, lcd.pin('VCC')[1], '5V'), GND(...lcd.pin('GND')));
  items.push(VCC(...q.pin('5V'), '5V (USB-C)'), GND(...q.pin('GND')));
  return {
    w: 960, h: 560, items,
    note: 'BTN1–BTN4 = ปุ่มอาร์เคด 24 mm (ใช้ COM + NO), PB1–PB2 = ปุ่ม 16 mm, SV1–SV4 = เซอร์โว SG90 · GND ทุกสัญลักษณ์ต่อถึงกัน (GND ร่วม: บอร์ด UNO Q, อะแดปเตอร์, แผ่นกระจายไฟ) · 5V ของ LCD/IR/บัซเซอร์มาจากขา 5V ของ UNO Q · ไฟเซอร์โวมาจากอะแดปเตอร์ผ่านแผ่นกระจายไฟเท่านั้น · เซอร์โวต่อ 3 สาย (S/V/G) ที่ช่อง CH1–CH4 · SDA/SCL คือหัวต่อข้าง AREF ของ UNO Q (ไม่ใช่ A4/A5)',
  };
})();

const projWatering: Schematic = (() => {
  const q = box([300, 60], 140, 300, 'Arduino UNO Q', [
    { side: 'l', at: 60, name: 'A0' }, { side: 'l', at: 200, name: 'D2' },
    { side: 'r', at: 60, name: 'D7' }, { side: 'r', at: 230, name: 'SDA' }, { side: 'r', at: 260, name: 'SCL' },
    { side: 't', at: 40, name: '5V' }, { side: 't', at: 100, name: '3V3' }, { side: 'b', at: 70, name: 'GND' },
  ], 'ลอจิก 3.3 V');
  const soil = box([30, 80], 160, 90, 'ความชื้นดิน', [{ side: 'r', at: 40, name: 'AOUT' }, { side: 't', at: 75, name: 'VCC' }, { side: 'b', at: 75, name: 'GND' }], 'SOIL1');
  const rl = box([560, 60], 110, 140, 'โมดูลรีเลย์', [
    { side: 'l', at: 30, name: '+' }, { side: 'l', at: 60, name: 'S' }, { side: 'l', at: 110, name: '−' },
    { side: 'r', at: 30, name: 'COM' }, { side: 'r', at: 90, name: 'NO' },
  ], '5 V 1 ช่อง');
  const lcd = box([560, 270], 140, 80, 'LCD I²C', [{ side: 'l', at: 20, name: 'SDA' }, { side: 'l', at: 50, name: 'SCL' }, { side: 'r', at: 20, name: 'VCC' }, { side: 'b', at: 60, name: 'GND' }], '16×2 · 0x27');
  const items: Item[] = [q.it, soil.it, rl.it, lcd.it];
  items.push(W(soil.pin('AOUT'), [230, soil.pin('AOUT')[1]], [230, q.pin('A0')[1]], q.pin('A0')), VCC(...soil.pin('VCC'), '3V3'), GND(...soil.pin('GND')));
  const [dx, dy] = q.pin('D2');
  items.push(P2('PB', [dx, dy], [dx - 90, dy], 'PB1', 'รดน้ำเอง', 't'), W([dx - 90, dy], [170, dy], [170, dy + 14]), GND(170, dy + 14));
  items.push(W(q.pin('D7'), [520, q.pin('D7')[1]], [520, rl.pin('S')[1]], rl.pin('S')), VCC(...rl.pin('+'), '5V'), GND(...rl.pin('−')));
  // ฝั่งปั๊ม: อะแดปเตอร์ + → COM … NO → ปั๊ม → อะแดปเตอร์ −
  const com = rl.pin('COM'), no = rl.pin('NO');
  items.push(W(com, [820, com[1]]), P2('BAT', [820, com[1]], [820, 250], 'ADP1', '5 V 3 A', 'r'),
    W(no, [740, no[1]]), P2('M', [740, no[1]], [740, 250], 'PMP1', 'ปั๊ม', 'l'), W([740, 250], [820, 250]));
  items.push(W(q.pin('SDA'), [520, q.pin('SDA')[1]], [520, lcd.pin('SDA')[1]], lcd.pin('SDA')), W(q.pin('SCL'), [530, q.pin('SCL')[1]], [530, lcd.pin('SCL')[1]], lcd.pin('SCL')),
    VCC(...lcd.pin('VCC'), '5V'), GND(...lcd.pin('GND')));
  items.push(VCC(...q.pin('5V'), '5V (USB-C)'), VCC(...q.pin('3V3'), '3V3'), GND(...q.pin('GND')));
  return {
    w: 900, h: 420, items,
    note: 'GND ของ UNO Q, เซนเซอร์, รีเลย์, LCD และปุ่มต่อถึงกัน · วงจรปั๊ม (ADP1 → COM–NO → PMP1) แยกจากบอร์ดด้วยหน้าสัมผัสรีเลย์ · เซนเซอร์ใช้ไฟ 3V3 ให้ AOUT ไม่เกินขา A0 (ทน 3.6 V) · 5V ของรีเลย์และ LCD มาจากขา 5V ของ UNO Q · SDA/SCL คือหัวต่อข้าง AREF (ไม่ใช่ A4/A5) · ปั๊มสูบน้ำลงกระถางที่ปักเซนเซอร์',
  };
})();

const projMotor: Schematic = (() => {
  const q = box([280, 60], 140, 360, 'Arduino UNO Q', [
    { side: 'l', at: 40, name: 'A0' }, { side: 'l', at: 150, name: 'D2' }, { side: 'l', at: 210, name: 'D4' },
    { side: 'r', at: 40, name: 'D9' }, { side: 'r', at: 80, name: 'D7' }, { side: 'r', at: 120, name: 'D8' },
    { side: 'r', at: 190, name: 'D10' }, { side: 'r', at: 220, name: 'D11' }, { side: 'r', at: 250, name: 'D12' }, { side: 'r', at: 280, name: 'D13' },
    { side: 'r', at: 320, name: 'SDA' }, { side: 'r', at: 345, name: 'SCL' },
    { side: 't', at: 40, name: '5V' }, { side: 't', at: 100, name: '3V3' }, { side: 'b', at: 70, name: 'GND' },
  ], 'ลอจิก 3.3 V');
  const u = box([560, 50], 120, 150, 'L293D', [
    { side: 'l', at: 30, name: '1,2EN', num: 1 }, { side: 'l', at: 70, name: '1A', num: 2 }, { side: 'l', at: 110, name: '2A', num: 7 },
    { side: 't', at: 30, name: 'VCC1', num: 16 }, { side: 't', at: 90, name: 'VCC2', num: 8 }, { side: 'b', at: 60, name: 'GND', num: '4,5,12,13' },
    { side: 'r', at: 40, name: '1Y', num: 3 }, { side: 'r', at: 110, name: '2Y', num: 6 },
  ], '3,4EN → GND');
  const st = box([560, 280], 120, 130, 'ULN2003', [
    { side: 'l', at: 20, name: 'IN1' }, { side: 'l', at: 50, name: 'IN2' }, { side: 'l', at: 80, name: 'IN3' }, { side: 'l', at: 110, name: 'IN4' },
    { side: 't', at: 90, name: '+' }, { side: 'b', at: 60, name: '−' }, { side: 'r', at: 65, name: 'มอเตอร์' },
  ], '+ 28BYJ-48');
  const lcd = box([560, 460], 140, 70, 'LCD I²C', [{ side: 'l', at: 15, name: 'SDA' }, { side: 'l', at: 40, name: 'SCL' }, { side: 'r', at: 20, name: 'VCC' }, { side: 'b', at: 60, name: 'GND' }], '16×2 · 0x27');
  const items: Item[] = [q.it, u.it, st.it, lcd.it];
  // VR ที่ A0 (ไฟ 3V3)
  const a0 = q.pin('A0');
  items.push({ t: 'pot', a: [120, a0[1] - 50], b: [120, a0[1] + 50], label: 'VR1', value: '10 kΩ' }, W([150, a0[1]], a0), VCC(120, a0[1] - 50, '3V3'), GND(120, a0[1] + 50));
  ([['D2', 'PB1', 'กลับทิศ'], ['D4', 'PB2', 'สเต็ป 90°']] as const).forEach(([pin, lab, v]) => {
    const [x, y] = q.pin(pin);
    items.push(P2('PB', [x, y], [x - 90, y], lab, v, 't'), W([x - 90, y], [150, y], [150, y + 14]), GND(150, y + 14));
  });
  items.push(W(q.pin('D9'), u.pin('1,2EN')), W(q.pin('D7'), [480, q.pin('D7')[1]], [480, u.pin('1A')[1]], u.pin('1A')), W(q.pin('D8'), [470, q.pin('D8')[1]], [470, u.pin('2A')[1]], u.pin('2A')));
  items.push(VCC(...u.pin('VCC1'), '5V ADP'), VCC(...u.pin('VCC2'), '5V ADP'), GND(...u.pin('GND')));
  const y1 = u.pin('1Y'), y2 = u.pin('2Y');
  items.push(W(y1, [760, y1[1]]), P2('M', [760, y1[1]], [760, y2[1]], 'M1', 'TT', 'r'), W([760, y2[1]], y2));
  (['D10', 'D11', 'D12', 'D13'] as const).forEach((pin, k) => { const [x, y] = q.pin(pin); const t = st.pin(`IN${k + 1}`); items.push(W([x, y], [500 - k * 10, y], [500 - k * 10, t[1]], t)); });
  items.push(VCC(...st.pin('+'), '5V ADP'), GND(...st.pin('−')), T(st.pin('มอเตอร์')[0] + 6, st.pin('มอเตอร์')[1] + 4, 'ST1', { bold: true }));
  items.push(W(q.pin('SDA'), [520, q.pin('SDA')[1]], [520, lcd.pin('SDA')[1]], lcd.pin('SDA')), W(q.pin('SCL'), [530, q.pin('SCL')[1]], [530, lcd.pin('SCL')[1]], lcd.pin('SCL')),
    VCC(...lcd.pin('VCC'), '5V'), GND(...lcd.pin('GND')));
  items.push(VCC(...q.pin('5V'), '5V (USB-C)'), VCC(...q.pin('3V3'), '3V3'), GND(...q.pin('GND')));
  items.push(P2('BAT', [840, 380], [840, 470], 'ADP1', '5 V 3 A', 'l'), VCC(840, 380, '5V ADP'), GND(840, 470));
  return {
    w: 900, h: 580, items,
    note: '"5V ADP" = ไฟจากอะแดปเตอร์ (รางล่างของเบรดบอร์ด) เลี้ยง L293D (VCC1/VCC2) และบอร์ด ULN2003 · GND ทุกสัญลักษณ์ต่อถึงกัน (GND ร่วม: UNO Q, อะแดปเตอร์) · 3,4EN ของ L293D ต่อ GND (ช่อง 3–4 ไม่ใช้) · LCD ใช้ 5V จากขา 5V ของ UNO Q · SDA/SCL คือหัวต่อข้าง AREF',
  };
})();

export const SCHEMATICS: Record<string, Schematic> = {
  breadboard, ohm, 'series-parallel': seriesParallel, divider, led, rc, scope, rectifier, transistor, opamp, bode, pico, mosfet, slew, pot,
  buzzer, ldr, sevenseg, relay, timer555, vreg, psu, servo, motor, logic, counter, lm35, hbridge, sonar, shiftreg, opto, stepper, meters, scr, lm317, ntc, comparator, darlington, lm386, smartfarm, dht22, adcpwm, uno, rgb, oled, watch, roundwatch, weather, powermeter, keypad, encoder, pulldown, alarm, rpi5, nano, analyzer: logicLa, lcdpar: lcdPar, i2cla: i2cLa,
  'proj-dispenser': projDispenser,
  'proj-watering': projWatering,
  'proj-motor': projMotor,
};
