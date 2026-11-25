/**
 * แม่แบบ "โปรเจกต์จบ" — วงจรที่ประกอบจากอุปกรณ์ในคลัง + โค้ด + รายการอุปกรณ์ (BOM) + ตารางจุดต่อ + ผลการทดสอบอัตโนมัติ + สถานะการจำลอง
 * วงจรสร้างผ่านคำสั่งของ editor (ตรวจการวาง/การต่อเหมือนผู้ใช้ทำเอง) — ตารางจุดต่อสร้างจากสายในวงจรจริง (ไม่ได้เขียนแยก)
 * กติกา: สถานะ "พร้อม" ต้องมีวงจร + โค้ด + เทสต์ที่รันโค้ดบนตัวจำลองร่วมกับวงจร · แม่แบบที่ยังไม่ทำแสดงเป็น "วางแผน" พร้อมเหตุผล
 */
import { addWire, insertPart } from '../editor/ops';
import { catalogEntry, defaultPart, pinDefs } from '../model/catalog';
import { emptyCircuit, type CircuitDoc, type Part, type PartKind, type Placement, type TerminalRef } from '../model/types';
import { holeLabel } from '../model/breadboard';

export type ProjectStatus = 'ready' | 'planned';
export interface BomRow { item: string; qty: number; note: string }
export interface FinalProject {
  id: string;
  number: number;
  title: string;
  titleEn: string;
  status: ProjectStatus;
  /** ระดับการจำลองที่ประกาศ (แสดงให้ผู้ใช้เห็นก่อนเปิด) */
  simLevel: string;
  summary: string;
  bom: BomRow[];
  /** สิ่งที่ชุดทดสอบอัตโนมัติตรวจ (ต้องตรงกับไฟล์เทสต์ที่ระบุ) */
  tests: { file: string; checks: string[] }[];
  /** ข้อจำกัด/สิ่งที่ต้องตรวจเองเมื่อสร้างจริง */
  limits: string[];
  /** ขั้นตอนทดลองในแอป */
  steps: string[];
  code?: string;
  build?: () => CircuitDoc;
  /** เหตุผลที่ยังไม่พร้อม (status = planned) */
  plannedWhy?: string;
}

const H = (hole: string): TerminalRef => ({ kind: 'hole', boardId: 'bb1', hole });
const P = (partId: string, pin: string): TerminalRef => ({ kind: 'pin', partId, pin });
const onBoard = (anchor: string): Placement => ({ kind: 'board', boardId: 'bb1', anchor, rotation: 0 });
const onTable = (x: number, z: number): Placement => ({ kind: 'table', x, z, rotation: 0 });

/** ตัวช่วยประกอบวงจร (โยนข้อผิดพลาดเมื่อวาง/ต่อไม่ได้ — เทสต์จับได้ทันทีถ้าตำแหน่งชนกัน) */
class Assembler {
  doc: CircuitDoc = emptyCircuit();
  part(kind: PartKind, placement: Placement, id: string, label: string, params: Record<string, unknown> = {}): this {
    const base = defaultPart(kind, id, label, placement) as Part;
    const r = insertPart(this.doc, { ...base, params: { ...base.params, ...params } } as Part);
    if (!r.ok) throw new Error(`วาง ${label} ไม่ได้: ${r.errors.join('; ')}`);
    this.doc = r.doc;
    return this;
  }
  wire(a: TerminalRef, b: TerminalRef, color: string, id: string): this {
    const r = addWire(this.doc, a, b, color, id);
    if (!r.ok) throw new Error(`ต่อสาย ${id} ไม่ได้: ${r.errors.join('; ')}`);
    this.doc = r.doc;
    return this;
  }
}

/* ======================= 1. เครื่องจ่ายยาอัตโนมัติ ======================= */

export const DISPENSER_CODE = `// เครื่องจ่ายยาอัตโนมัติ 4 ช่อง — Arduino UNO Q (แลปจำลองแบบพฤติกรรม)
// ปุ่มอาร์เคด 1–4 = จ่ายยาช่อง 1–4 (จ่ายเมื่อเซนเซอร์ IR เห็นถ้วยรองเท่านั้น)
// ปุ่ม 16 mm: A2 = แสดงจำนวนที่จ่าย, A3 = ล้างจำนวน
// จอ LCD 16x2 I2C (0x27) ที่หัวต่อ SDA/SCL · บัซเซอร์ผ่านทรานซิสเตอร์ NPN ที่ D5
#include <Wire.h>
#include <Servo.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo gate[4];

const int SERVO_PIN[4] = {9, 10, 11, 6};
const int BTN_PIN[4]   = {2, 4, 7, 8};
const int IR_PIN       = 12;  // FC-51 OUT: LOW = มีวัตถุ (ถ้วย) อยู่หน้าเซนเซอร์
const int SHOW_PIN     = A2;  // ปุ่ม 16 mm #1
const int CLEAR_PIN    = A3;  // ปุ่ม 16 mm #2
const int BUZZER_PIN   = 5;
const int CLOSED_DEG   = 0;
const int OPEN_DEG     = 90;
const unsigned long OPEN_MS = 1000;

int dispensed[4] = {0, 0, 0, 0};
bool lastBtn[4] = {HIGH, HIGH, HIGH, HIGH};
bool lastShow = HIGH, lastClear = HIGH;

void beep(int ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

void showLine(const char *top, const char *bottom) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(top);
  lcd.setCursor(0, 1);
  lcd.print(bottom);
}

bool cupPresent() {
  return digitalRead(IR_PIN) == LOW;
}

void dispense(int slot) {
  char top[17];
  snprintf(top, sizeof(top), "Slot %d: OPEN", slot + 1);
  showLine(top, "Dispensing...");
  Serial.print("DISPENSE ");
  Serial.println(slot + 1);
  gate[slot].write(OPEN_DEG);
  beep(100);
  delay(OPEN_MS);
  gate[slot].write(CLOSED_DEG);
  dispensed[slot]++;
  char bottom[17];
  snprintf(bottom, sizeof(bottom), "Done  total %d", dispensed[slot]);
  snprintf(top, sizeof(top), "Slot %d: CLOSED", slot + 1);
  showLine(top, bottom);
}

void setup() {
  Serial.begin(115200);
  lcd.init();
  lcd.backlight();
  for (int i = 0; i < 4; i++) {
    pinMode(BTN_PIN[i], INPUT_PULLUP);
    gate[i].attach(SERVO_PIN[i]);
    gate[i].write(CLOSED_DEG);
  }
  pinMode(IR_PIN, INPUT);
  pinMode(SHOW_PIN, INPUT_PULLUP);
  pinMode(CLEAR_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  showLine("Medicine Box", "Ready");
  Serial.println("READY");
}

void loop() {
  for (int i = 0; i < 4; i++) {
    bool now = digitalRead(BTN_PIN[i]);
    if (lastBtn[i] == HIGH && now == LOW) {  // กดลง (ขอบขาลง)
      delay(20);                              // หน่วงกันหน้าสัมผัสเด้ง
      if (digitalRead(BTN_PIN[i]) == LOW) {
        if (cupPresent()) {
          dispense(i);
        } else {
          showLine("No cup!", "Place cup first");
          Serial.print("NO CUP ");
          Serial.println(i + 1);
          beep(60); delay(80); beep(60);
        }
      }
    }
    lastBtn[i] = now;
  }
  bool s = digitalRead(SHOW_PIN);
  if (lastShow == HIGH && s == LOW) {
    char line[17];
    snprintf(line, sizeof(line), "%d %d %d %d", dispensed[0], dispensed[1], dispensed[2], dispensed[3]);
    showLine("Count 1 2 3 4", line);
    Serial.print("COUNT ");
    Serial.println(line);
  }
  lastShow = s;
  bool c = digitalRead(CLEAR_PIN);
  if (lastClear == HIGH && c == LOW) {
    for (int i = 0; i < 4; i++) dispensed[i] = 0;
    showLine("Counts cleared", "Ready");
    Serial.println("CLEAR");
  }
  lastClear = c;
  delay(5);
}
`;

/** ขาที่ใช้ของบอร์ดในเครื่องจ่ายยา (ใช้ทั้งวงจรและเอกสาร) */
export const DISPENSER_PINS = { servo: ['D9', 'D10', 'D11', 'D6'], button: ['D2', 'D4', 'D7', 'D8'], ir: 'D12', show: 'A2', clear: 'A3', buzzer: 'D5' } as const;
const BTN_COLORS = ['red', 'green', 'blue', 'yellow'];

/**
 * เครื่องจ่ายยา: UNO Q (บนโต๊ะซ้าย) · เบรดบอร์ด CL-400 กลาง: R 1 kΩ (b7–b11) → Q1 2N3904 (E c10 B c11 C c12) → บัซเซอร์ (P c15, N c18),
 * FC-51 (j20–j22) · รางบน tp = 5V, tn = GND (จาก UNO Q) · รางล่างต่อกับรางบน
 * LCD 16×2 I²C ด้านหลังบอร์ด → SDA/SCL ของ UNO Q · ไฟเซอร์โว: อะแดปเตอร์ 5 V 3 A → บอร์ดกระจายไฟ → เซอร์โว 4 ตัว · GND ของแผ่นกระจายไฟต่อราง tn (GND ร่วม)
 * ปุ่มอาร์เคด 4 ตัว + ปุ่ม 16 mm 2 ตัวด้านหน้า: COM/ขั้ว 1 → ราง bn (GND), NO/ขั้ว 2 → ขาบอร์ด (INPUT_PULLUP)
 */
export function buildDispenser(): CircuitDoc {
  const a = new Assembler();
  a.part('unoq', onTable(-50, -2), 'UNOQ1', 'UNO Q', { code: DISPENSER_CODE, hexSrc: '' });
  // ไฟเลี้ยงลอจิกจาก UNO Q (5V จาก USB-C) และกราวด์
  a.wire(P('UNOQ1', '5V'), H('tp2'), '#e53935', 'w5v').wire(P('UNOQ1', 'GND.1'), H('tn3'), '#212121', 'wgnd')
    .wire(H('tp4'), H('bp4'), '#e53935', 'wrail5').wire(H('tn5'), H('bn5'), '#212121', 'wrailg');
  // บัซเซอร์ผ่าน NPN (ขาของ UNO Q จ่ายได้ไม่เกิน 20 mA ที่ 3.3 V — บัซเซอร์ 5 V ใช้ ≈ 30 mA)
  a.part('resistor', onBoard('b7'), 'RB1', 'R1', { resistance: 1000, span: 4 })
    .part('bjt', onBoard('c10'), 'Q1', 'Q1')
    .part('buzzer', onBoard('c15'), 'BZ1', 'BZ1')
    .wire(P('UNOQ1', 'D5'), H('e7'), '#8e24aa', 'wbz').wire(H('e10'), H('tn10'), '#212121', 'wqe')
    .wire(H('d12'), H('d18'), '#fb8c00', 'wqc').wire(H('e15'), H('tp15'), '#e53935', 'wbzp');
  // เซนเซอร์ IR ตรวจถ้วยรอง (OUT ต่ำเมื่อมีวัตถุ) — ไฟ 5 V, OUT เป็นคอลเลกเตอร์เปิดของ LM393 + ตัวต้านทานดึงขึ้นบนโมดูล (ขา D12 ของ UNO Q ทน 5 V)
  a.part('irobstacle', onBoard('j20'), 'IR1', 'IR1', { distance: 3, threshold: 10 })
    .wire(H('i21'), H('bn21'), '#212121', 'wirg').wire(H('i22'), H('bp22'), '#e53935', 'wirv').wire(H('h20'), P('UNOQ1', 'D12'), '#1e88e5', 'wiro');
  // จอ LCD 16×2 I²C — Wire ของ UNO Q อยู่ที่หัวต่อ SDA/SCL (ไม่ใช่ A4/A5)
  a.part('lcd1602', onTable(0, -30), 'LCD1', 'LCD1', { pullUps: true })
    .wire(P('LCD1', 'GND'), H('tn26'), '#212121', 'wlg').wire(P('LCD1', 'VCC'), H('tp27'), '#e53935', 'wlv')
    .wire(P('LCD1', 'SDA'), P('UNOQ1', 'SDA'), '#1e88e5', 'wsda').wire(P('LCD1', 'SCL'), P('UNOQ1', 'SCL'), '#fdd835', 'wscl');
  // ไฟเซอร์โว: อะแดปเตอร์ 5 V 3 A → บอร์ดกระจายไฟ · GND ร่วมกับบอร์ด
  a.part('dcadapter', onTable(45, 40), 'ADP1', 'ADP1').part('servohub', onTable(45, -2), 'HUB1', 'HUB1')
    .wire(P('ADP1', '+'), P('HUB1', 'V+'), '#e53935', 'wadp').wire(P('ADP1', '-'), P('HUB1', 'GND'), '#212121', 'wadg')
    .wire(P('HUB1', 'SG'), H('tn29'), '#212121', 'wcom');
  DISPENSER_PINS.servo.forEach((pin, k) => {
    const n = k + 1;
    a.wire(P('UNOQ1', pin), P('HUB1', `S${n}`), '#fb8c00', `wsv${n}`)
      .part('servo', onTable(82, -33 + k * 19), `SV${n}`, `SV${n}`)
      .wire(P(`SV${n}`, 'SIG'), P('HUB1', `CH${n}.S`), '#fb8c00', `ws${n}`).wire(P(`SV${n}`, 'V'), P('HUB1', `CH${n}.V`), '#e53935', `wv${n}`)
      .wire(P(`SV${n}`, 'GND'), P('HUB1', `CH${n}.G`), '#6d4c41', `wg${n}`);
  });
  // ปุ่มอาร์เคด 24 mm × 4 และปุ่ม 16 mm × 2 (INPUT_PULLUP: กด = LOW)
  DISPENSER_PINS.button.forEach((pin, k) => {
    const id = `BTN${k + 1}`;
    a.part('arcadebtn', onTable(-68 + k * 19, 38), id, id, { color: BTN_COLORS[k] })
      .wire(P(id, 'COM'), H(`bn${6 + k * 2}`), '#212121', `wbc${k + 1}`).wire(P(id, 'NO'), P('UNOQ1', pin), '#43a047', `wbn${k + 1}`);
  });
  ([[DISPENSER_PINS.show, 'PB1', 'white'], [DISPENSER_PINS.clear, 'PB2', 'black']] as const).forEach(([pin, id, color], k) => {
    a.part('pushbtn16', onTable(10 + k * 15, 40), id, id, { color })
      .wire(P(id, '1'), H(`bn${16 + k * 2}`), '#212121', `wpc${k + 1}`).wire(P(id, '2'), P('UNOQ1', pin), '#43a047', `wpn${k + 1}`);
  });
  return a.doc;
}

/* ======================= 2. ระบบรดน้ำต้นไม้อัตโนมัติ ======================= */

export const WATERING_CODE = `// ระบบรดน้ำต้นไม้อัตโนมัติ — Arduino UNO Q (แลปจำลองแบบพฤติกรรม)
// เซนเซอร์ความชื้นดินแบบ capacitive (ไฟ 3.3 V) → A0 · โมดูลรีเลย์ 5 V ที่ D7 (HIGH = ปั๊มทำงาน)
// ปุ่ม 16 mm ที่ D2: รดน้ำเอง 3 วินาที / ล้างสถานะ "ตรวจน้ำ" · จอ LCD 16x2 I2C (0x27) ที่หัวต่อ SDA/SCL
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const int SOIL_PIN   = A0;
const int RELAY_PIN  = 7;
const int MANUAL_PIN = 2;
// ค่าปรับเทียบ (analogRead 10 บิต อ้างอิง 3.3 V) — ต้องวัดจากเซนเซอร์จริง: ค่าในดินแห้ง/อากาศ และในน้ำ
const int RAW_DRY = 775;   // ≈ 2.50 V
const int RAW_WET = 388;   // ≈ 1.25 V
const int ON_BELOW  = 30;  // % ความชื้นต่ำกว่านี้ = เริ่มรดน้ำ
const int OFF_ABOVE = 60;  // % ถึงค่านี้ = หยุด (ช่วงห่างกันกันรีเลย์ติด-ดับถี่)
const unsigned long MAX_RUN_MS = 15000;  // ปั๊มทำงานนานเกินนี้ = น้ำหมด/สายหลุด → หยุดและแจ้ง
const unsigned long MANUAL_MS  = 3000;

enum Mode { IDLE, AUTO, MANUAL, FAULT };
Mode mode = IDLE;
unsigned long started = 0, lastShow = 0, lastLog = 0;
bool lastBtn = HIGH;

int moisturePct() {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(SOIL_PIN);
  int raw = sum / 8;
  long pct = (long)(RAW_DRY - raw) * 100 / (RAW_DRY - RAW_WET);
  return constrain(pct, 0, 100);
}

void pump(bool on) {
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
}

void enter(Mode m, const char *why) {
  mode = m;
  started = millis();
  pump(m == AUTO || m == MANUAL);
  Serial.print(m == AUTO || m == MANUAL ? "PUMP ON " : "PUMP OFF ");
  Serial.println(why);
}

void show(int pct) {
  char top[17], bottom[17];
  snprintf(top, sizeof(top), "Soil %3d%%  %s", pct, (mode == AUTO || mode == MANUAL) ? "PUMP" : "    ");
  const char *s = mode == AUTO ? "Watering (auto)" : mode == MANUAL ? "Watering (btn)" : mode == FAULT ? "CHECK WATER!" : "Idle";
  snprintf(bottom, sizeof(bottom), "%-16s", s);
  lcd.setCursor(0, 0); lcd.print(top);
  lcd.setCursor(0, 1); lcd.print(bottom);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pump(false);
  pinMode(MANUAL_PIN, INPUT_PULLUP);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  Serial.println("READY");
}

void loop() {
  int pct = moisturePct();
  unsigned long now = millis();
  bool b = digitalRead(MANUAL_PIN);
  bool pressed = (lastBtn == HIGH && b == LOW);
  lastBtn = b;

  switch (mode) {
    case IDLE:
      if (pressed) enter(MANUAL, "manual");
      else if (pct < ON_BELOW) enter(AUTO, "dry");
      break;
    case AUTO:
      if (pct >= OFF_ABOVE) enter(IDLE, "wet");
      else if (now - started > MAX_RUN_MS) enter(FAULT, "timeout");
      break;
    case MANUAL:
      if (now - started >= MANUAL_MS) enter(IDLE, "manual done");
      break;
    case FAULT:
      if (pressed) enter(IDLE, "reset");
      break;
  }
  if (now - lastShow >= 250) { lastShow = now; show(pct); }
  if (now - lastLog >= 1000) { lastLog = now; Serial.print("SOIL "); Serial.println(pct); }
  delay(20);
}
`;

/** ขาที่ใช้ของบอร์ดในระบบรดน้ำ */
export const WATERING_PINS = { soil: 'A0', relay: 'D7', manual: 'D2' } as const;

/**
 * ระบบรดน้ำ: UNO Q (โต๊ะซ้าย) · เบรดบอร์ดใช้เฉพาะรางไฟ: tp = 5V, tn = GND (จาก UNO Q), bp = 3V3, bn = GND
 * เซนเซอร์ความชื้นดิน (ไฟ 3.3 V — AOUT ≤ 3 V ไม่เกินขา A0 ที่ทนได้ 3.6 V) → A0 · โมดูลรีเลย์ 5 V: S ← D7
 * ปั๊ม: อะแดปเตอร์ 5 V + → COM รีเลย์ → NO → ปั๊ม + · ปั๊ม − → อะแดปเตอร์ − (วงจรปั๊มแยกจากบอร์ดด้วยหน้าสัมผัสรีเลย์) · สายยางปั๊มลงกระถางของเซนเซอร์
 * จอ LCD 16×2 I²C → SDA/SCL · ปุ่ม 16 mm: ขั้ว 1 → GND, ขั้ว 2 → D2 (INPUT_PULLUP)
 */
export function buildWatering(): CircuitDoc {
  const a = new Assembler();
  a.part('unoq', onTable(-50, -2), 'UNOQ1', 'UNO Q', { code: WATERING_CODE, hexSrc: '' });
  a.wire(P('UNOQ1', '5V'), H('tp2'), '#e53935', 'w5v').wire(P('UNOQ1', 'GND.1'), H('tn3'), '#212121', 'wgnd')
    .wire(P('UNOQ1', '3V3'), H('bp2'), '#ff7043', 'w3v3').wire(H('tn5'), H('bn5'), '#212121', 'wrailg');
  // เซนเซอร์ความชื้นดิน (ปักในกระถาง)
  a.part('soilsensor', onTable(-28, 58), 'SOIL1', 'SOIL1', { moisture: 25 })
    .wire(P('SOIL1', 'VCC'), H('bp8'), '#ff7043', 'wsv').wire(P('SOIL1', 'GND'), H('bn9'), '#212121', 'wsg')
    .wire(P('SOIL1', 'AOUT'), P('UNOQ1', WATERING_PINS.soil), '#fdd835', 'wsa');
  // โมดูลรีเลย์ 5 V (ขดลวด ≈ 70 mA จากขา 5V ของ UNO Q · ขาเข้า S ขับทรานซิสเตอร์บนโมดูล ใช้ลอจิก 3.3 V ได้)
  a.part('relay', onTable(28, 32), 'RLY1', 'RLY1')
    .wire(P('RLY1', 'V'), H('tp14'), '#e53935', 'wrv').wire(P('RLY1', 'G'), H('tn15'), '#212121', 'wrg')
    .wire(P('RLY1', 'S'), P('UNOQ1', WATERING_PINS.relay), '#8e24aa', 'wrs');
  // ปั๊ม: อะแดปเตอร์ 5 V 3 A → COM–NO ของรีเลย์ → ปั๊ม · สายยางลงกระถาง SOIL1
  a.part('dcadapter', onTable(55, 50), 'ADP1', 'ADP1').part('pump', onTable(98, 8), 'PMP1', 'PMP1', { target: 'SOIL1' })
    .wire(P('ADP1', '+'), P('RLY1', 'COM'), '#e53935', 'wadp').wire(P('RLY1', 'NO'), P('PMP1', 'P'), '#e53935', 'wpp')
    .wire(P('PMP1', 'N'), P('ADP1', '-'), '#212121', 'wpn');
  // จอ LCD 16×2 I²C
  a.part('lcd1602', onTable(0, -30), 'LCD1', 'LCD1', { pullUps: true })
    .wire(P('LCD1', 'GND'), H('tn26'), '#212121', 'wlg').wire(P('LCD1', 'VCC'), H('tp27'), '#e53935', 'wlv')
    .wire(P('LCD1', 'SDA'), P('UNOQ1', 'SDA'), '#1e88e5', 'wsda').wire(P('LCD1', 'SCL'), P('UNOQ1', 'SCL'), '#fdd835', 'wscl');
  // ปุ่มรดน้ำเอง
  a.part('pushbtn16', onTable(10, 42), 'PB1', 'PB1', { color: 'blue' })
    .wire(P('PB1', '1'), H('bn20'), '#212121', 'wpc').wire(P('PB1', '2'), P('UNOQ1', WATERING_PINS.manual), '#43a047', 'wpb');
  return a.doc;
}

/* ======================= 5. ระบบควบคุมมอเตอร์ ======================= */

export const MOTOR_CODE = `// ระบบควบคุมมอเตอร์ — Arduino UNO Q (แลปจำลองแบบพฤติกรรม)
// มอเตอร์ DC เกียร์ TT ผ่าน L293D: 1,2EN = D9 (PWM ความเร็ว), 1A = D7, 2A = D8 (ทิศทาง)
// ลูกบิด VR (ไฟ 3.3 V) ที่ A0 = ความเร็ว 0–100 % · ปุ่ม D2 = กลับทิศ (หยุด 0.3 วินาทีก่อนกลับ)
// สเต็ปเปอร์ 28BYJ-48 + ULN2003: IN1–IN4 = D10 D11 D12 D13 · ปุ่ม D4 = หมุน 90° (1024 ครึ่งสเต็ป)
// จอ LCD 16x2 I2C (0x27) ที่หัวต่อ SDA/SCL
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const int EN_PIN = 9, IN1_PIN = 7, IN2_PIN = 8;
const int POT_PIN = A0;
const int DIR_BTN = 2, STEP_BTN = 4;
const int COIL[4] = {10, 11, 12, 13};
// ลำดับครึ่งสเต็ป (half-step) ของ 28BYJ-48: IN1..IN4
const byte HALF[8] = {0b0001, 0b0011, 0b0010, 0b0110, 0b0100, 0b1100, 0b1000, 0b1001};
const unsigned long STEP_US = 2000;   // 500 ครึ่งสเต็ป/วินาที (ต่ำกว่าความเร็วสูงสุดที่มอเตอร์ตามทัน)
const int STEPS_90 = 1024;           // 4096 ครึ่งสเต็ป/รอบ (เฟือง 1:64)

bool forward = true;
int speedPct = 0;
long stepsLeft = 0, stepPos = 0;
int phase = 0;
unsigned long lastStep = 0, lastShow = 0;
bool lastDir = HIGH, lastStepBtn = HIGH;

void driveDc() {
  int raw = analogRead(POT_PIN);
  speedPct = map(raw, 0, 1023, 0, 100);
  if (speedPct < 5) speedPct = 0;  // ช่วงตายใกล้ 0: มอเตอร์ไม่มีแรงพอเริ่มหมุนอยู่แล้ว
  digitalWrite(IN1_PIN, forward ? HIGH : LOW);
  digitalWrite(IN2_PIN, forward ? LOW : HIGH);
  analogWrite(EN_PIN, map(speedPct, 0, 100, 0, 255));
}

void coils(byte bits) {
  for (int i = 0; i < 4; i++) digitalWrite(COIL[i], (bits >> i) & 1);
}

void show() {
  char top[17], bottom[17];
  snprintf(top, sizeof(top), "DC %3d%% %s", speedPct, forward ? "FWD" : "REV");
  snprintf(bottom, sizeof(bottom), "Step %3ld deg %s", (stepPos * 360L / 4096L) % 360, stepsLeft ? "*" : " ");
  lcd.setCursor(0, 0); lcd.print(top); lcd.print("    ");
  lcd.setCursor(0, 1); lcd.print(bottom);
}

void setup() {
  Serial.begin(115200);
  pinMode(EN_PIN, OUTPUT); pinMode(IN1_PIN, OUTPUT); pinMode(IN2_PIN, OUTPUT);
  for (int i = 0; i < 4; i++) pinMode(COIL[i], OUTPUT);
  pinMode(DIR_BTN, INPUT_PULLUP); pinMode(STEP_BTN, INPUT_PULLUP);
  lcd.init();
  lcd.backlight();
  lcd.clear();
  Serial.println("READY");
}

void loop() {
  bool d = digitalRead(DIR_BTN);
  if (lastDir == HIGH && d == LOW) {
    analogWrite(EN_PIN, 0);  // หยุดก่อนกลับทิศ ลดกระแสกระชาก
    delay(300);
    forward = !forward;
    Serial.println(forward ? "DIR FWD" : "DIR REV");
  }
  lastDir = d;
  bool s = digitalRead(STEP_BTN);
  if (lastStepBtn == HIGH && s == LOW && stepsLeft == 0) {
    stepsLeft = STEPS_90;
    Serial.println("STEP 90");
  }
  lastStepBtn = s;
  driveDc();
  unsigned long now = micros();
  if (stepsLeft > 0 && now - lastStep >= STEP_US) {
    lastStep = now;
    phase = (phase + 1) & 7;
    coils(HALF[phase]);
    stepPos++;
    if (--stepsLeft == 0) { coils(0); Serial.print("STEP DONE "); Serial.println((stepPos * 360L / 4096L) % 360); }
  }
  if (millis() - lastShow >= 250) {
    lastShow = millis();
    show();
    Serial.print("SPEED "); Serial.println(speedPct);
  }
}
`;

/** ขาที่ใช้ของบอร์ดในระบบควบคุมมอเตอร์ */
export const MOTOR_PINS = { en: 'D9', in1: 'D7', in2: 'D8', pot: 'A0', dir: 'D2', step: 'D4', coils: ['D10', 'D11', 'D12', 'D13'] } as const;

/**
 * ควบคุมมอเตอร์: UNO Q (โต๊ะซ้าย) · เบรดบอร์ด: L293D คร่อมร่องกลางที่ f10 (ขา 1 = f10, ขา 16 = e10)
 * รางล่าง bp/bn = อะแดปเตอร์ 5 V (ไฟมอเตอร์ VCC2 + ลอจิก VCC1 + บอร์ดสเต็ปเปอร์) · รางบน tp = 3V3, tn = GND จาก UNO Q · tn ต่อ bn (GND ร่วม)
 * L293D: 1,2EN ← D9, 1A ← D7, 2A ← D8, 1Y/2Y → มอเตอร์ TT, 3,4EN ลงกราวด์ (ช่อง 3–4 ไม่ใช้)
 * VR 10 kΩ (c22–c24): ขา 1 → GND, ขา 3 → 3V3 (หมุนเพิ่ม = เร็วขึ้น), แกนกลาง → A0 · ปุ่ม 16 mm × 2: กลับทิศ (D2), สเต็ปเปอร์ 90° (D4)
 * สเต็ปเปอร์ 28BYJ-48 + ULN2003: IN1–IN4 ← D10–D13, ไฟจากอะแดปเตอร์ · จอ LCD I²C ไฟ 5V จากขา 5V ของ UNO Q
 */
export function buildMotor(): CircuitDoc {
  const a = new Assembler();
  a.part('unoq', onTable(-50, -2), 'UNOQ1', 'UNO Q', { code: MOTOR_CODE, hexSrc: '' });
  a.wire(P('UNOQ1', '3V3'), H('tp2'), '#ff7043', 'w3v3').wire(P('UNOQ1', 'GND.1'), H('tn3'), '#212121', 'wgnd')
    .wire(H('tn5'), H('bn5'), '#212121', 'wrailg');
  // อะแดปเตอร์ 5 V → รางล่าง
  a.part('dcadapter', onTable(55, 50), 'ADP1', 'ADP1')
    .wire(P('ADP1', '+'), H('bp29'), '#e53935', 'wadp').wire(P('ADP1', '-'), H('bn28'), '#212121', 'wadg');
  // L293D
  a.part('hbridge', onBoard('f10'), 'U1', 'U1')
    .wire(H('j17'), H('bp17'), '#e53935', 'wvcc2').wire(H('j13'), H('bn12'), '#212121', 'wg1').wire(H('a14'), H('tn14'), '#212121', 'wg2')
    .wire(H('a10'), H('bp8'), '#e53935', 'wvcc1').wire(H('a17'), H('tn17'), '#212121', 'wen34')
    .wire(P('UNOQ1', MOTOR_PINS.en), H('h10'), '#fb8c00', 'wen').wire(P('UNOQ1', MOTOR_PINS.in1), H('h11'), '#8e24aa', 'win1').wire(P('UNOQ1', MOTOR_PINS.in2), H('h16'), '#1e88e5', 'win2');
  a.part('motor', onTable(20, 42), 'M1', 'M1')
    .wire(H('i12'), P('M1', 'A'), '#e53935', 'wma').wire(H('i15'), P('M1', 'B'), '#212121', 'wmb');
  // VR ความเร็ว
  a.part('potentiometer', onBoard('c22'), 'VR1', 'VR1', { resistance: 10000, position: 0.75 })
    .wire(H('a22'), H('tn22'), '#212121', 'wvr1').wire(H('a24'), H('tp24'), '#ff7043', 'wvr3').wire(H('b23'), P('UNOQ1', MOTOR_PINS.pot), '#fdd835', 'wvrw');
  // สเต็ปเปอร์ + บอร์ด ULN2003
  a.part('stepper', onTable(78, -6), 'ST1', 'ST1');
  MOTOR_PINS.coils.forEach((pin, k) => a.wire(P('UNOQ1', pin), P('ST1', `IN${k + 1}`), ['#1e88e5', '#43a047', '#fdd835', '#fb8c00'][k], `wst${k + 1}`));
  a.wire(P('ST1', 'V'), H('bp27'), '#e53935', 'wstv').wire(P('ST1', 'G'), H('bn26'), '#212121', 'wstg');
  // ปุ่ม
  ([[MOTOR_PINS.dir, 'PB1', 'white'], [MOTOR_PINS.step, 'PB2', 'black']] as const).forEach(([pin, id, color], k) => {
    a.part('pushbtn16', onTable(-28 + k * 15, 42), id, id, { color })
      .wire(P(id, '1'), H(`tn${8 + k * 2}`), '#212121', `wpc${k + 1}`).wire(P(id, '2'), P('UNOQ1', pin), '#43a047', `wpn${k + 1}`);
  });
  // จอ LCD 16×2 I²C
  a.part('lcd1602', onTable(0, -30), 'LCD1', 'LCD1', { pullUps: true })
    .wire(P('LCD1', 'GND'), H('tn26'), '#212121', 'wlg').wire(P('LCD1', 'VCC'), P('UNOQ1', '5V'), '#e53935', 'wlv')
    .wire(P('LCD1', 'SDA'), P('UNOQ1', 'SDA'), '#1e88e5', 'wsda').wire(P('LCD1', 'SCL'), P('UNOQ1', 'SCL'), '#fdd835', 'wscl');
  return a.doc;
}

/** ตารางจุดต่อ: สร้างจากสายในวงจร (ชื่ออุปกรณ์ + ขา / รูบนเบรดบอร์ด) */
export function wiringList(doc: CircuitDoc): Array<{ id: string; from: string; to: string; color: string }> {
  const name = (t: TerminalRef): string => {
    if (t.kind === 'hole') return `เบรดบอร์ด ${holeLabel(t.hole)}`;
    const p = doc.parts.find((x) => x.id === t.partId);
    if (!p) return t.partId;
    const d = pinDefs(p).find((x) => x.name === t.pin);
    return `${p.label} ${t.pin}${d && d.label && d.label !== t.pin ? ` (${d.label.split(' — ')[0].slice(0, 40)})` : ''}`;
  };
  return doc.wires.map((w) => ({ id: w.id, from: name(w.a), to: name(w.b), color: w.color }));
}

/** รายการอุปกรณ์จากวงจร (นับตามชนิด) — ใช้ตรวจว่า BOM ของแม่แบบตรงกับวงจรจริง */
export function bomFromDoc(doc: CircuitDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of doc.parts) { const n = catalogEntry(p.kind)?.name ?? p.kind; out[n] = (out[n] ?? 0) + 1; }
  return out;
}

export const FINAL_PROJECTS: FinalProject[] = [
  {
    id: 'dispenser', number: 1, title: 'เครื่องจ่ายยาอัตโนมัติ 4 ช่อง', titleEn: 'Automatic medicine dispenser (4 slots)', status: 'ready',
    simLevel: 'จำลองพฤติกรรม (behavioral) ระดับ Arduino API — UNO Q ไม่ได้จำลองชิปจริง · วงจรไฟฟ้า เซอร์โว จอ LCD ปุ่ม เซนเซอร์ และบัซเซอร์ทำงานจากโค้ดที่คอมไพล์และรันบนตัวจำลอง',
    summary: 'กดปุ่มอาร์เคดช่อง 1–4 → ถ้าเซนเซอร์ IR เห็นถ้วยรอง เซอร์โวช่องนั้นเปิด 90° นาน 1 วินาทีแล้วปิด จอแสดงสถานะ บัซเซอร์ดัง · ไม่มีถ้วย → จอเตือน "Place cup first" และไม่เปิดช่อง · ปุ่ม 16 mm แสดง/ล้างจำนวนที่จ่าย',
    bom: [
      { item: 'Arduino UNO Q (ABX00162 2 GB หรือ ABX00173 4 GB)', qty: 1, note: 'ลอจิก 3.3 V · ไฟจาก USB-C 5 V' },
      { item: 'เซอร์โว SG90', qty: 4, note: 'ไฟเลี้ยง 4.8–6 V · ต่อผ่านบอร์ดกระจายไฟ' },
      { item: 'จอ LCD 16×2 + บอร์ด I²C (PCF8574) ที่อยู่ 0x27', qty: 1, note: 'ไฟ 5 V · ต่อ SDA/SCL ของ UNO Q (ขาทน 5 V)' },
      { item: 'โมดูลตรวจจับวัตถุอินฟราเรด FC-51', qty: 1, note: 'ไฟ 5 V · OUT → D12' },
      { item: 'บัซเซอร์ active 5 V', qty: 1, note: 'ขับด้วยทรานซิสเตอร์' },
      { item: 'ทรานซิสเตอร์ 2N3904 (NPN)', qty: 1, note: 'ขับบัซเซอร์จาก D5' },
      { item: 'ตัวต้านทาน 1 kΩ', qty: 1, note: 'ที่ขาเบส' },
      { item: 'ปุ่มอาร์เคด 24 mm (ไมโครสวิตช์ COM/NO/NC)', qty: 4, note: 'ใช้ COM + NO' },
      { item: 'ปุ่มกด 16 mm ติดแผง (กดติดปล่อยดับ)', qty: 2, note: 'แสดง/ล้างจำนวน' },
      { item: 'อะแดปเตอร์ 5 V 3 A + แจ็ก DC 5.5 × 2.1 mm (ขั้วสกรู)', qty: 1, note: 'จ่ายไฟเซอร์โวเท่านั้น' },
      { item: 'บอร์ดกระจายไฟเซอร์โว 4 ช่อง (มีตัวเก็บประจุ 470 µF)', qty: 1, note: 'GND ต่อร่วมกับ GND ของบอร์ด' },
      { item: 'เบรดบอร์ด 400 จุด + สายจัมเปอร์', qty: 1, note: 'สายแดง = 5V, ดำ = GND, ส้ม = สัญญาณเซอร์โว' },
    ],
    tests: [{ file: 'tests/finalproj.test.ts', checks: [
      'คอมไพล์โค้ดจริง (บอร์ด unoq) แล้วรันบนตัวจำลองร่วมกับวงจรทั้งชุด',
      'จอ LCD แสดง "Medicine Box / Ready" จากคำสั่ง I²C ของโค้ด',
      'กดปุ่ม 1–4 ขณะมีถ้วย → เซอร์โวช่องนั้นหมุนไป 90° แล้วกลับ 0° ช่องอื่นไม่ขยับ · จอและ Serial แสดงผลตรงกัน',
      'ไม่มีถ้วย → ไม่มีเซอร์โวขยับ จอแสดง "No cup!"',
      'บัซเซอร์มีกระแสขณะจ่าย · กระแสเซอร์โวไหลจากอะแดปเตอร์ (ไม่ใช่ขา 5V ของบอร์ด)',
      'ไม่มีคำเตือนอันตราย (danger) จากตัวตรวจวงจร',
    ] }, { file: 'tests/e2e/finalproj_ui.py', checks: ['เปิดเมนูโปรเจกต์จบ → โหลดแม่แบบ → คอมไพล์ + อัปโหลด → กดปุ่มในแผง → จอและเซอร์โวตอบสนอง'] }],
    limits: [
      'UNO Q จำลองแบบพฤติกรรม: โค้ดรันบนตัวจำลอง ATmega328P ด้วยไฟฟ้าขาของ UNO Q — เวลาคำสั่งและหน่วยความจำไม่ใช่ของ STM32U585 · บนบอร์ดจริงต้องคอมไพล์ใหม่ด้วย Arduino App Lab/IDE (Zephyr core) และทดสอบทีละส่วน',
      'กระแสเซอร์โวเป็นค่าประมาณ (เริ่มหมุน ≈ 0.5 A 20 ms, หมุนต่อ ≈ 0.2 A, นิ่ง ≈ 6 mA) — เซอร์โวจริงที่ติดขัด/รับภาระกินกระแสได้สูงกว่า (ถึง ≈ 0.7 A ต่อตัว)',
      'ไม่จำลองกลไกช่องยา น้ำหนักยา การติดขัด และการเด้งของหน้าสัมผัสปุ่ม',
      'ไลบรารี LiquidCrystal_I2C ในบริการคอมไพล์เป็นตัวเขียนใหม่ (MIT) ที่มี API เดียวกับไลบรารียอดนิยม — บนเครื่องจริงติดตั้งจาก Library Manager',
      'ระยะตรวจจับของ FC-51 ปรับด้วยตัวต้านทานปรับค่าบนโมดูล — ในแอปตั้งค่าที่แผงคุณสมบัติ',
    ],
    steps: [
      'กด "เปิดแม่แบบ" — วงจรทั้งชุดถูกวางบนโต๊ะ (แทนวงจรเดิม — กด Undo เพื่อกลับ)',
      'เลือก UNO Q → แท็บ Arduino UNO Q → "คอมไพล์ + อัปโหลด" (ต้องมีบริการคอมไพล์)',
      'กด "เริ่มจำลอง" — จอแสดง Medicine Box / Ready',
      'ตั้งระยะวัตถุของ IR1 ≤ 10 cm (มีถ้วย) แล้วแตะค้างที่ปุ่มอาร์เคด — เซอร์โวช่องนั้นเปิดแล้วปิด',
      'ตั้งระยะ IR1 = 50 cm (ไม่มีถ้วย) แล้วกดปุ่ม — จอเตือน No cup!',
      'ดูกระแสอะแดปเตอร์ในแท็บกำลังไฟฟ้าขณะเซอร์โวหมุน',
    ],
    code: DISPENSER_CODE,
    build: buildDispenser,
  },
  {
    id: 'watering', number: 2, title: 'ระบบรดน้ำต้นไม้อัตโนมัติ', titleEn: 'Automatic plant watering', status: 'ready',
    simLevel: 'จำลองพฤติกรรม (behavioral) ระดับ Arduino API — UNO Q ไม่ได้จำลองชิปจริง · วงจรไฟฟ้า เซนเซอร์ความชื้นดิน รีเลย์ ปั๊ม (อัตราไหลเพิ่มความชื้นในกระถาง) จอ LCD และปุ่ม จำลองร่วมกับโค้ดที่คอมไพล์จริง',
    summary: 'อ่านความชื้นดินจากเซนเซอร์แบบ capacitive (A0) → ต่ำกว่า 30% เปิดปั๊มผ่านรีเลย์จนถึง 60% แล้วหยุด (ช่วงห่างกันรีเลย์ติด-ดับถี่) · ปั๊มทำงานเกิน 15 วินาทีโดยความชื้นไม่ถึง = น้ำหมด/สายหลุด → หยุดปั๊มและขึ้น "CHECK WATER!" จนกดปุ่ม · ปุ่ม 16 mm = รดน้ำเอง 3 วินาที · จอ LCD แสดงความชื้นและสถานะ',
    bom: [
      { item: 'Arduino UNO Q (ABX00162 2 GB หรือ ABX00173 4 GB)', qty: 1, note: 'ลอจิก 3.3 V · ไฟจาก USB-C 5 V' },
      { item: 'เซนเซอร์ความชื้นดินแบบ capacitive v1.2', qty: 1, note: 'ไฟ 3.3 V จากขา 3V3 (ขาออก ≤ 3 V ไม่เกินขา A0 ที่ทนได้ 3.6 V) · ต้องปรับเทียบค่าดินแห้ง/เปียกเอง' },
      { item: 'โมดูลรีเลย์ 5 V 1 ช่อง (ขาเข้า HIGH = ทำงาน)', qty: 1, note: 'ขดลวด ≈ 70 mA จากขา 5V · หน้าสัมผัส COM/NO ต่อไฟปั๊ม' },
      { item: 'ปั๊มน้ำจุ่ม 3–6 V + สายยาง', qty: 1, note: '≈ 0.18 A ที่ 5 V · สายยางลงกระถาง' },
      { item: 'อะแดปเตอร์ 5 V 3 A + แจ็ก DC 5.5 × 2.1 mm (ขั้วสกรู)', qty: 1, note: 'จ่ายไฟปั๊มเท่านั้น (แยกจากบอร์ดด้วยหน้าสัมผัสรีเลย์)' },
      { item: 'จอ LCD 16×2 + บอร์ด I²C (PCF8574) ที่อยู่ 0x27', qty: 1, note: 'ไฟ 5 V · SDA/SCL ของ UNO Q' },
      { item: 'ปุ่มกด 16 mm ติดแผง (กดติดปล่อยดับ)', qty: 1, note: 'รดน้ำเอง / ล้างสถานะ CHECK WATER' },
      { item: 'เบรดบอร์ด 400 จุด + สายจัมเปอร์', qty: 1, note: 'ใช้รางไฟ: 5V, 3V3, GND' },
    ],
    tests: [{ file: 'tests/finalproj2.test.ts', checks: [
      'คอมไพล์โค้ดจริง (บอร์ด unoq) แล้วรันบนตัวจำลองร่วมกับวงจรทั้งชุด · โปรแกรมในแอปตรงกับที่คอมไพล์ในเทสต์',
      'ดินแห้ง 25% → รีเลย์ดึง ปั๊มมีกระแส (จากอะแดปเตอร์) ความชื้นเพิ่มจนถึง 60% แล้วปั๊มหยุดเอง · จอแสดงความชื้นและสถานะตามโค้ด',
      'ดินแห้งลงอีกครั้ง → ระบบเปิดปั๊มซ้ำเอง',
      'ถอดปลั๊กอะแดปเตอร์ (จำลองน้ำไม่ไหล) → 15 วินาทีแล้วหยุดปั๊ม จอ "CHECK WATER!" · เสียบกลับ + กดปุ่ม → รดน้ำต่อ',
      'ปุ่ม 16 mm → ปั๊มทำงาน 3 วินาที',
      'ไม่มีคำเตือนอันตราย (danger) จากตัวตรวจวงจร',
    ] }, { file: 'tests/e2e/finalproj2_ui.py', checks: ['เปิดเมนูโปรเจกต์จบ → แม่แบบ 2 → เปิด → เริ่มจำลอง (โปรแกรมคอมไพล์ไว้แล้ว) → จอขึ้นความชื้น ปั๊มทำงานแล้วหยุดเอง (เดสก์ท็อปและมือถือ)'] }],
    limits: [
      'UNO Q จำลองแบบพฤติกรรม: โค้ดรันบนตัวจำลอง ATmega328P ด้วยไฟฟ้าขาของ UNO Q — ต้องคอมไพล์ใหม่ด้วย Arduino App Lab/IDE (Zephyr core) และทดสอบบนบอร์ดจริง',
      'ค่าปรับเทียบเซนเซอร์ (RAW_DRY/RAW_WET) ในโค้ดมาจากค่าตัวอย่างของผู้ผลิต — เซนเซอร์จริงแต่ละตัวและดินแต่ละชนิดต่างกัน ต้องวัดเองก่อนใช้',
      'ความเร็วดินแห้ง (0.5 %/วินาที) และปริมาณดินในกระถางเป็นการเร่งเวลาเพื่อทดลอง — ดินจริงแห้งในหลายชั่วโมงถึงหลายวัน ควรปรับ ON_BELOW/OFF_ABOVE/MAX_RUN_MS ตามกระถางจริง',
      'โมดูลรีเลย์ในแอปทำงานเมื่อขาเข้า HIGH — โมดูลหลายรุ่นในตลาดทำงานเมื่อ LOW ตรวจรุ่นที่ซื้อแล้วแก้ pump() ให้ตรง',
      'ไม่จำลองระดับน้ำในถัง (การตรวจ "น้ำหมด" ใช้เวลาเปิดปั๊มเกินกำหนดแทน), การรั่ว, ความชื้นที่กระจายไม่ทั่วกระถาง และการเด้งของหน้าสัมผัสปุ่ม',
      'ไลบรารี LiquidCrystal_I2C ในบริการคอมไพล์เป็นตัวเขียนใหม่ (MIT) ที่มี API เดียวกับไลบรารียอดนิยม — บนเครื่องจริงติดตั้งไลบรารีที่มีชื่อเดียวกันใน Library Manager',
    ],
    steps: [
      'กด "เปิดแม่แบบ" — วงจรทั้งชุดถูกวางบนโต๊ะ (แทนวงจรเดิม — กด Undo เพื่อกลับ)',
      'กด "เริ่มจำลอง" — โปรแกรมคอมไพล์ไว้แล้ว (แก้โค้ดแล้วกด "คอมไพล์ + อัปโหลด" ในแท็บ Arduino UNO Q ถ้ามีบริการคอมไพล์)',
      'ดินเริ่มที่ 25% → ปั๊มทำงาน จอขึ้น "Watering (auto)" จนถึง 60% แล้วหยุด',
      'เลือก SOIL1 แล้วเพิ่มอัตราดินแห้ง (เช่น 3 %/s) — ดูว่าระบบรดน้ำซ้ำเอง',
      'เลือก ADP1 แล้วถอดปลั๊กระหว่างดินแห้ง — 15 วินาทีต่อมาจอขึ้น "CHECK WATER!" · เสียบปลั๊กแล้วกดปุ่ม PB1 เพื่อกลับมาทำงาน',
      'ดูกระแสปั๊มและอะแดปเตอร์ในแท็บกำลังไฟฟ้า',
    ],
    code: WATERING_CODE,
    build: buildWatering,
  },
  { id: 'greenhouse', number: 3, title: 'โรงเรือนอัจฉริยะ (Smart Greenhouse IoT)', titleEn: 'Smart greenhouse IoT', status: 'planned', simLevel: '—', summary: 'วัดอุณหภูมิ/ความชื้น/แสง ควบคุมพัดลม ปั๊ม ไฟ และส่งข้อมูลขึ้นเครือข่าย', bom: [], tests: [], limits: [], steps: [],
    plannedWhy: 'การเชื่อมต่อเครือข่าย (Wi-Fi/Bridge ไปยัง Linux ของ UNO Q) ยังไม่มีตัวจำลอง — จะทำเฉพาะส่วนเซนเซอร์/ขับโหลดและระบุชัดว่าส่วน IoT ไม่ได้จำลอง' },
  { id: 'sorting', number: 4, title: 'ระบบคัดแยกวัตถุ', titleEn: 'Object sorting', status: 'planned', simLevel: '—', summary: 'ตรวจวัตถุด้วย IR/อัลตราโซนิก แล้วใช้เซอร์โวผลักแยกตามเงื่อนไข', bom: [], tests: [], limits: [], steps: [],
    plannedWhy: 'ยังไม่มีเซนเซอร์สีในคลัง — แม่แบบแรกจะคัดแยกตามระยะ/การมีวัตถุ' },
  {
    id: 'motor', number: 5, title: 'ระบบควบคุมมอเตอร์', titleEn: 'Motor control', status: 'ready',
    simLevel: 'จำลองพฤติกรรม (behavioral) ระดับ Arduino API — UNO Q ไม่ได้จำลองชิปจริง · L293D มอเตอร์ DC (แรงเคลื่อนไฟฟ้าย้อน ความเฉื่อย PWM) สเต็ปเปอร์ + ULN2003 VR ปุ่ม และจอ LCD จำลองร่วมกับโค้ดที่คอมไพล์จริง',
    summary: 'หมุน VR เพื่อปรับความเร็วมอเตอร์ DC (PWM ที่ขา 1,2EN ของ L293D) · ปุ่มกลับทิศ (หยุด 0.3 วินาทีก่อนกลับ ลดกระแสกระชาก) · ปุ่มสั่งสเต็ปเปอร์ 28BYJ-48 หมุน 90° แบบครึ่งสเต็ป (ไม่บล็อกการทำงานส่วนอื่น) · จอ LCD แสดงความเร็ว ทิศ และมุมสเต็ปเปอร์',
    bom: [
      { item: 'Arduino UNO Q (ABX00162 2 GB หรือ ABX00173 4 GB)', qty: 1, note: 'ลอจิก 3.3 V · ไฟจาก USB-C 5 V' },
      { item: 'ไอซีขับมอเตอร์ L293D (DIP-16)', qty: 1, note: 'ขาเข้ารับลอจิก 3.3 V ได้ (VIH ≥ 2.3 V) · VCC1 = VCC2 = 5 V' },
      { item: 'มอเตอร์ DC เกียร์ TT (3–6 V)', qty: 1, note: 'ต่อ 1Y/2Y ของ L293D' },
      { item: 'สเต็ปเปอร์มอเตอร์ 28BYJ-48 + บอร์ดขับ ULN2003', qty: 1, note: 'ไฟ 5 V จากอะแดปเตอร์ · IN1–IN4 ← D10–D13' },
      { item: 'ตัวต้านทานปรับค่าได้ 10 kΩ', qty: 1, note: 'ไฟ 3.3 V (ขา A0 ทนได้ 3.6 V)' },
      { item: 'ปุ่มกด 16 mm ติดแผง (กดติดปล่อยดับ)', qty: 2, note: 'กลับทิศ / สเต็ปเปอร์ 90°' },
      { item: 'อะแดปเตอร์ 5 V 3 A + แจ็ก DC 5.5 × 2.1 mm (ขั้วสกรู)', qty: 1, note: 'ไฟมอเตอร์ทั้งสองตัว · GND ร่วมกับบอร์ด' },
      { item: 'จอ LCD 16×2 + บอร์ด I²C (PCF8574) ที่อยู่ 0x27', qty: 1, note: 'ไฟ 5 V จากขา 5V ของ UNO Q' },
      { item: 'เบรดบอร์ด 400 จุด + สายจัมเปอร์', qty: 1, note: 'รางบน 3V3/GND จากบอร์ด · รางล่าง 5 V/GND จากอะแดปเตอร์' },
    ],
    tests: [{ file: 'tests/finalproj2.test.ts', checks: [
      'คอมไพล์โค้ดจริง (บอร์ด unoq) แล้วรันบนตัวจำลองร่วมกับวงจรทั้งชุด · โปรแกรมในแอปตรงกับที่คอมไพล์ในเทสต์',
      'VR 75% → PWM ≈ 74% มอเตอร์หมุนเดินหน้า · จอแสดง "DC  74% FWD"',
      'กดปุ่มกลับทิศ → มอเตอร์หยุดแล้วหมุนกลับ จอแสดง REV',
      'VR 0% → มอเตอร์หยุด · กดปุ่มสเต็ปเปอร์ → หมุน 90° (1024 ครึ่งสเต็ป) แล้วปล่อยขดลวด จอแสดง 90 deg',
      'กระแสมอเตอร์ไหลจากอะแดปเตอร์ (ไม่ใช่ขา 5V ของบอร์ด) · ไม่มีคำเตือนอันตราย (danger)',
    ] }, { file: 'tests/e2e/finalproj2_ui.py', checks: ['เปิดเมนูโปรเจกต์จบ → แม่แบบ 5 → เปิด → เริ่มจำลอง → จอแสดงความเร็ว มอเตอร์หมุน · กดปุ่มกลับทิศในแผง (เดสก์ท็อปและมือถือ)'] }],
    limits: [
      'UNO Q จำลองแบบพฤติกรรม: โค้ดรันบนตัวจำลอง ATmega328P — ความถี่ PWM เป็นของ AVR (≈ 490 Hz ที่ D9) ไม่ใช่ของ STM32 · ต้องคอมไพล์ใหม่ด้วย Arduino App Lab/IDE และทดสอบบนบอร์ดจริง',
      'L293D ใช้ทรานซิสเตอร์แบบดาร์ลิงตัน แรงดันตกรวมสูงสุด ≈ 2.6 V ที่ 0.6 A (VOH = VCC2 − 1.4 V, VOL ≈ 1.2 V ตามดาต้าชีต) — ในแอปที่ไฟ 5 V + PWM 74% แรงดันเฉลี่ยคร่อมมอเตอร์ ≈ 2.5 V (≈ 80 rpm ที่เพลาเกียร์ ไม่มีโหลด) ถ้าต้องการแรงขึ้นใช้ไฟมอเตอร์ 6–9 V ที่ VCC2 (ไม่เกินพิกัดมอเตอร์) หรือไอซีขับแบบ MOSFET เช่น TB6612FNG',
      'ระหว่างอัปเดตจอ I²C (ทุก 250 ms) ลูปไม่ได้เดินสเต็ป — สเต็ปเปอร์ 90° ใช้ ≈ 2.5 วินาที แทน 2.05 วินาทีตามที่ตั้ง (บอร์ดจริงเป็นแบบเดียวกัน ถ้าต้องการจังหวะสม่ำเสมอให้ใช้ timer interrupt หรือเลิกอัปเดตจอระหว่างหมุน)',
      'สเต็ปเปอร์ในแอปใช้ 4096 ครึ่งสเต็ปต่อรอบ (เฟือง 1:64 ตามเอกสารทั่วไป) — หลายแหล่งวัดเฟืองจริงได้ ≈ 1:63.68 มุมจริงจึงคลาดเล็กน้อย',
      'ไม่จำลองโหลดทางกลของมอเตอร์ DC (ล้อ/สายพาน) — ตั้งแรงบิดโหลดที่แผงคุณสมบัติของ M1 ได้ · ไม่จำลองการเด้งของหน้าสัมผัสปุ่มและสัญญาณรบกวนจากมอเตอร์',
      'โค้ดกลับทิศใช้ delay(300) ซึ่งหยุดการทำงานส่วนอื่นชั่วคราว (สเต็ปเปอร์หยุดเดินระหว่างนั้น)',
      'ไลบรารี LiquidCrystal_I2C ในบริการคอมไพล์เป็นตัวเขียนใหม่ (MIT) ที่มี API เดียวกับไลบรารียอดนิยม',
      '**จำลองช้ากว่าเวลาจริง** ขณะ PWM ขับมอเตอร์: ทุกขอบ PWM (≈ 980 ครั้ง/วินาที) ตัวแก้สมการต้องคำนวณกระแสขดลวดมอเตอร์ทีละก้าว — หลังปรับตัวแก้สมการ (รอบ 86) วัดได้ ≈ 15 เท่าบน Node และ ≈ 20–90 เท่า (เฉลี่ย ≈ 60) ในเบราว์เซอร์ทดสอบที่ไม่มี GPU (มอเตอร์ถึงความเร็ว ≈ 15 วินาทีหลังกดเริ่ม) · บนเครื่องจริงยังไม่ได้วัด · ความเร็ว 100% (ไม่มี PWM) เร็วกว่ามาก',
    ],
    steps: [
      'กด "เปิดแม่แบบ" — วงจรทั้งชุดถูกวางบนโต๊ะ (แทนวงจรเดิม — กด Undo เพื่อกลับ)',
      'กด "เริ่มจำลอง" — มอเตอร์ค่อย ๆ เร่งความเร็ว (การจำลองช้ากว่าเวลาจริง ดูตัวเลขในแถบสถานะ) แล้วหมุนเดินหน้าตาม VR1 (เริ่ม 75%) จอแสดงความเร็วและทิศ',
      'หมุน VR1 ในแผงคุณสมบัติ — ความเร็วและกระแสมอเตอร์เปลี่ยนตาม',
      'กดปุ่ม PB1 — มอเตอร์หยุดแล้วหมุนกลับ จอขึ้น REV',
      'กดปุ่ม PB2 — สเต็ปเปอร์ ST1 หมุน 90° (≈ 2.5 วินาที) จอแสดงมุม',
      'ดูกระแสอะแดปเตอร์ และแรงดันขาออก 1Y/2Y ของ L293D ด้วยมัลติมิเตอร์',
    ],
    code: MOTOR_CODE,
    build: buildMotor,
  },
  { id: 'iot-alert', number: 6, title: 'ระบบตรวจวัดและแจ้งเตือน IoT', titleEn: 'IoT monitoring and alerts', status: 'planned', simLevel: '—', summary: 'วัดค่า แสดงผล และแจ้งเตือนเมื่อเกินเกณฑ์ (บัซเซอร์/LED/ข้อความ)', bom: [], tests: [], limits: [], steps: [],
    plannedWhy: 'ส่วนแจ้งเตือนผ่านเครือข่ายไม่มีตัวจำลอง — จะทำเฉพาะการแจ้งเตือนในวงจรและ Serial' },
];
