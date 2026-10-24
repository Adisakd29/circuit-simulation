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

export const SCHEMATICS: Record<string, Schematic> = {
  breadboard, ohm, 'series-parallel': seriesParallel, divider, led, rc, scope, rectifier, transistor, opamp, bode, pico, mosfet, slew, pot,
  buzzer, ldr, sevenseg, relay, timer555, vreg, psu, servo, motor, logic, counter, lm35, hbridge, sonar, shiftreg, opto, stepper, meters, scr, lm317, ntc, comparator, darlington, lm386,
};
