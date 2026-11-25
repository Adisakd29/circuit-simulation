/**
 * แบบจำลองเบรดบอร์ด — นิยามการเชื่อมต่อภายในอย่างชัดเจน
 *   CL-400: ขนาดครึ่ง 400 จุด 30 คอลัมน์ (82 × 50 mm)
 *   MB-102: ขนาดเต็ม 830 จุด 63 คอลัมน์ ราง 4 เส้น × 50 รู (165 × 55 mm)
 * ชื่อรูของ MB-102 ครอบคลุม CL-400 ทั้งหมด (คอลัมน์ 1–30 และรูรางไฟ 2–30 ตำแหน่งเดียวกัน) → เปลี่ยนรุ่นบอร์ดแล้ววงจรเดิมยังถูกต้อง
 * ตารางรู/กลุ่มสร้างครั้งเดียวสำหรับรุ่นใหญ่สุด แล้วตรวจว่ารูอยู่บนบอร์ดรุ่นนั้นด้วย holeOnBoard()
 *
 * พิกัดกริด (หน่วย = ระยะห่างรู 2.54 mm):
 *   x = คอลัมน์ 1..30 (ซ้าย→ขวา)
 *   y = แถว:
 *     0  T+  รางไฟบน ขั้วบวก (เส้นแดง)
 *     1  T−  รางไฟบน ขั้วลบ (เส้นน้ำเงิน)
 *     3..7   แถว a b c d e   (ครึ่งบน)
 *     8..9   ร่องกลาง (ไม่มีรู)
 *     10..14 แถว f g h i j   (ครึ่งล่าง)
 *     16 B−  รางไฟล่าง ขั้วลบ
 *     17 B+  รางไฟล่าง ขั้วบวก
 *
 * การเชื่อมต่อภายใน:
 *   - รู a–e ในคอลัมน์เดียวกัน เชื่อมกัน (แถบ 5 รู)
 *   - รู f–j ในคอลัมน์เดียวกัน เชื่อมกัน
 *   - a–e กับ f–j คนละฝั่งร่องกลาง "ไม่เชื่อมกัน"
 *   - รางไฟแต่ละเส้นมี 25 รู (กลุ่มละ 5) ในรุ่น CL-400 รางไฟ "ต่อเนื่องตลอดความยาว"
 *     (โครงสร้าง railSegments รองรับรุ่นที่รางไฟแบ่งครึ่งในอนาคต)
 *   - รางไฟบนกับรางไฟล่าง "ไม่เชื่อมกัน" ต้องต่อสายเอง
 */

export type BoardModel = 'CL-400' | 'MB-102';
export interface BoardSpec { model: BoardModel; name: string; cols: number; railLast: number; tie: number; size: { w: number; h: number }; mm: { w: number; h: number; t: number } }
/** CL-400: คงขนาดเดิม (82.3 × 49.8 mm) เพื่อไม่ให้ไฟล์เดิมเปลี่ยนตำแหน่ง · MB-102: 165.1 × 54.6 mm ตามขนาดทั่วไปของบอร์ด 830 จุด */
export const BOARD_SPECS: Record<BoardModel, BoardSpec> = {
  'CL-400': { model: 'CL-400', name: 'CL-400 (ครึ่งแผ่น 400 จุด)', cols: 30, railLast: 30, tie: 400, size: { w: 30 + 2.4, h: 18 + 1.6 }, mm: { w: 82.3, h: 49.8, t: 6.1 } },
  'MB-102': { model: 'MB-102', name: 'MB-102 (เต็มแผ่น 830 จุด)', cols: 63, railLast: 60, tie: 830, size: { w: 165.1 / 2.54, h: 54.6 / 2.54 }, mm: { w: 165.1, h: 54.6, t: 8.5 } },
};
export const BOARD_MODELS: BoardModel[] = ['CL-400', 'MB-102'];
export const boardSpec = (model: BoardModel | undefined): BoardSpec => BOARD_SPECS[model ?? 'CL-400'] ?? BOARD_SPECS['CL-400'];
/** จำนวนคอลัมน์ของ CL-400 (รุ่นเริ่มต้น) */
export const COLS = 30;
/** คอลัมน์สูงสุดของทุกรุ่น — ตารางรูสร้างถึงคอลัมน์นี้ */
const MAX_COLS = 63;
export const ROW_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
const ROW_Y: Record<string, number> = { a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14 };

export interface RailDef {
  /** prefix ของชื่อรู เช่น tp → tp5 */
  prefix: 'tp' | 'tn' | 'bn' | 'bp';
  label: string;
  polarity: '+' | '-';
  y: number;
  /** ช่วงคอลัมน์ที่เชื่อมกัน (รวมปลาย) — CL-400 มีช่วงเดียวคือทั้งเส้น */
  segments: Array<[number, number]>;
}

export const RAILS: RailDef[] = [
  { prefix: 'tp', label: 'T+', polarity: '+', y: 0, segments: [[1, 63]] },
  { prefix: 'tn', label: 'T−', polarity: '-', y: 1, segments: [[1, 63]] },
  { prefix: 'bn', label: 'B−', polarity: '-', y: 16, segments: [[1, 63]] },
  { prefix: 'bp', label: 'B+', polarity: '+', y: 17, segments: [[1, 63]] },
];

export const GRID_ROWS = 18; // y = 0..17

/** คอลัมน์ที่รางไฟมีรู: กลุ่มละ 5 รู 2–6, 8–12, … — CL-400 ถึง 30 (25 รู), MB-102 ถึง 60 (50 รู) */
export function railHasColumn(x: number, model: BoardModel = 'CL-400'): boolean {
  return x >= 2 && x <= boardSpec(model).railLast && (x - 2) % 6 !== 5;
}

export interface HoleInfo {
  name: string;
  x: number;
  y: number;
  /** กลุ่มที่เชื่อมกันภายใน */
  group: string;
}

const holeCache = new Map<string, HoleInfo>();
const gridCache = new Map<string, string>();
const groupMembers = new Map<string, string[]>();

function add(info: HoleInfo) {
  holeCache.set(info.name, info);
  gridCache.set(`${info.x},${info.y}`, info.name);
  const g = groupMembers.get(info.group) ?? [];
  g.push(info.name);
  groupMembers.set(info.group, g);
}

(function build() {
  for (let x = 1; x <= MAX_COLS; x++) {
    for (const r of ROW_LETTERS) {
      const top = ROW_Y[r] < 8;
      add({ name: `${r}${x}`, x, y: ROW_Y[r], group: `col${x}-${top ? 'top' : 'bot'}` });
    }
  }
  for (const rail of RAILS) {
    for (let x = 1; x <= MAX_COLS; x++) {
      if (!railHasColumn(x, 'MB-102')) continue;
      const segIdx = rail.segments.findIndex(([s, e]) => x >= s && x <= e);
      add({ name: `${rail.prefix}${x}`, x, y: rail.y, group: `rail-${rail.prefix}-${segIdx}` });
    }
  }
})();

/** รูนี้มีอยู่บนบอร์ดรุ่นนั้นหรือไม่ */
export function holeOnBoard(name: string, model: BoardModel = 'CL-400'): boolean {
  const h = holeCache.get(name);
  if (!h) return false;
  const sp = boardSpec(model);
  return h.y === 0 || h.y === 1 || h.y === 16 || h.y === 17 ? h.x <= sp.railLast : h.x <= sp.cols;
}

/** ข้อมูลรู (ถ้าระบุรุ่น: เฉพาะรูที่มีบนบอร์ดรุ่นนั้น) */
export function holeInfo(name: string, model?: BoardModel): HoleInfo | undefined {
  if (model && !holeOnBoard(name, model)) return undefined;
  return holeCache.get(name);
}

export function holeAt(x: number, y: number, model?: BoardModel): string | undefined {
  const n = gridCache.get(`${x},${y}`);
  return n && (!model || holeOnBoard(n, model)) ? n : undefined;
}

export function allHoles(model: BoardModel = 'CL-400'): HoleInfo[] {
  return [...holeCache.values()].filter((h) => holeOnBoard(h.name, model));
}

export function groupHoles(group: string, model?: BoardModel): string[] {
  const g = groupMembers.get(group) ?? [];
  return model ? g.filter((n) => holeOnBoard(n, model)) : g;
}

export function allGroups(model?: BoardModel): string[] {
  const all = [...groupMembers.keys()];
  return model ? all.filter((g) => groupHoles(g, model).length > 0) : all;
}

/** ชื่อกลุ่มที่อ่านง่ายสำหรับนักเรียน */
export function groupLabel(group: string): string {
  let m = /^col(\d+)-(top|bot)$/.exec(group);
  if (m) return `คอลัมน์ ${m[1]} แถว ${m[2] === 'top' ? 'a–e' : 'f–j'}`;
  m = /^rail-(tp|tn|bn|bp)-(\d+)$/.exec(group);
  if (m) {
    const rail = RAILS.find((r) => r.prefix === m![1])!;
    return `รางไฟ ${rail.label}${rail.segments.length > 1 ? ` ช่วง ${Number(m[2]) + 1}` : ''}`;
  }
  return group;
}

/** ชื่อรูที่อ่านง่าย เช่น "a12" → "a12", "tp5" → "T+ 5" */
export function holeLabel(name: string): string {
  const m = /^(tp|tn|bn|bp)(\d+)$/.exec(name);
  if (m) return `${RAILS.find((r) => r.prefix === m[1])!.label} ช่อง ${m[2]}`;
  return name;
}

/** ขนาดบอร์ด CL-400 ในหน่วยรู — รุ่นอื่นใช้ boardSpec(model).size */
export const BOARD_SIZE = BOARD_SPECS['CL-400'].size;
