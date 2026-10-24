# Circuit Lab 3D — ห้องปฏิบัติการวงจรเสมือน

เว็บแอปให้นักเรียน ปวช./ปวส. ต่อวงจรบนเบรดบอร์ด 3 มิติ (ครึ่งแผ่น 400 จุด หรือเต็มแผ่น 830 จุด — เลือกบอร์ดแล้วเปลี่ยนรุ่นในแผงคุณสมบัติ) จำลองวงจร DC และวงจร RC/RL/RLC ตามเวลา ใช้ไดโอด ซีเนอร์ ทรานซิสเตอร์ BJT ดาร์ลิงตัน TIP120 มอสเฟต (MOSFET) ออปแอมป์ คอมพาราเตอร์ LM393 ไอซีไทเมอร์ 555 ไอซีคงแรงดัน 78xx และ LM317 (ปรับแรงดันได้) ไอซีขยายเสียง LM386 กับลำโพง 8 Ω (มีเสียงออกลำโพงคอมพิวเตอร์) ไอซีเกตตรรกะ 74HC ไอซีนับ CD4017 เซนเซอร์อุณหภูมิ LM35 เทอร์มิสเตอร์ NTC โมดูลวัดระยะอัลตราโซนิก HC-SR04 ไอซีเลื่อนบิต 74HC595 ออปโตคัปเปลอร์ PC817 ไทริสเตอร์ SCR 2N5060 ไอซีขับมอเตอร์ L293D สเต็ปเปอร์มอเตอร์ 28BYJ-48 กับบอร์ดขับ ULN2003 หม้อแปลงลดแรงดัน โมดูลรีเลย์ เซอร์โวมอเตอร์ และมอเตอร์ DC ใช้เครื่องมือบนโต๊ะขนาดจริง — แหล่งจ่าย DC เครื่องกำเนิดสัญญาณ ออสซิลโลสโคป มัลติมิเตอร์ดิจิทัลและมัลติมิเตอร์แบบเข็ม (สายโพรบแดง/ดำ สวิตช์เลือกย่าน ฟิวส์ และผลการโหลดของมิเตอร์) — และกราฟโบด (AC sweep) เขียนโปรแกรม MicroPython บน Raspberry Pi Pico ที่จำลอง CPU จริง วัดค่า ดูกราฟ และทำแลป 39 แลปที่ตรวจผลจากวงจรที่ต่อจริง (ทุกแลปมีรูปวงจร)

## วิธีรัน

ต้องมี Node.js 20+ (ทดสอบกับ Node 22)

```bash
npm install
npm run dev            # โหมดพัฒนา http://localhost:5173
npm test               # เทสต์อัตโนมัติ (solver, connectivity, editor, บันทึกไฟล์, แลป, fuzz)
npm run build          # build ปกติ → dist/
npm run build:single   # HTML ไฟล์เดียว → dist-single/index.html (worker ฝังในไฟล์)
npm run build:artifact # ไฟล์เดียวสำหรับเผยแพร่เป็น claude.ai Artifact → artifact/index.html
```

ทดสอบผ่านเบราว์เซอร์จริง (เมาส์ + touch):

```bash
npm run build && npx vite preview --port 4173 &
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e/e2e.py e2e-out
python3 tests/e2e/freeplace.py free-out   # ลากวาง/วางบนโต๊ะ 7 ขนาดจอ + โหมดล้มเหลว (ไม่มี WebGL, context หาย ฯลฯ)
python3 tests/e2e/mosfet_ui.py mos-out     # มอสเฟตผ่าน UI: แลป 13, เปลี่ยนรุ่น, ปลดสวิตช์, วางจากคลังอุปกรณ์
python3 tests/e2e/opamp_ui.py op-out       # slew rate/แบนด์วิดท์ของออปแอมป์ผ่าน UI: สโคปวัดความชัน, แก้ค่า SR, กราฟโบด, แลป 14
python3 tests/e2e/pot_ui.py pot-out       # VR (ทริมพอต 3296W) ผ่าน UI: ปรับตำแหน่ง, โพรบ, แลป 15
python3 tests/e2e/button_ui.py btn-out     # ปุ่มกด 6×6 mm ผ่าน UI: กดค้างในฉาก/แผง (เมาส์และ touch), ไม่ลง Undo, วางจากคลัง
python3 tests/e2e/buzzer_ui.py bz-out       # บัซเซอร์ active/passive: เสียงในแอป (Web Audio), วงคลื่น, เครื่องกำเนิดสัญญาณ
python3 tests/e2e/ldr_ui.py ldr-out      # LDR: ปรับระดับแสง, ไฟอัตโนมัติ, แลป 17
python3 tests/e2e/sevenseg_ui.py ss-out      # 7 ส่วน: แสดงเลข, ส่วนสว่างในฉาก, ชนิดขาร่วม, แลป 18
python3 tests/e2e/pintip_ui.py tip-out       # ชื่อขาเมื่อชี้ (เมาส์) / แตะ (สัมผัส)
python3 tests/e2e/relay_ui.py relay-out      # โมดูลรีเลย์ + Pico: ดึง/ปล่อย, โหลดผ่าน COM–NO, 3V3 ไม่พอ, แลป 19
python3 tests/e2e/timer555_ui.py t555-out    # NE555 astable: LED กะพริบ, ความถี่เทียบทฤษฎี, แก้ C, แลป 20
python3 tests/e2e/vreg_ui.py vreg-out       # 7805: คงแรงดัน, line regulation, dropout, แผ่นระบายความร้อน, แลป 21
python3 tests/e2e/psu_ui.py psu-out         # หม้อแปลง + บริดจ์ + C + 7805, สโคป AC วัด ripple, แลป 22
python3 tests/e2e/servo_ui.py servo-out     # เซอร์โว SG90 + Pico PWM: มุม 0/90/180°, แขนในฉากหมุนตาม, แลป 23
python3 tests/e2e/motor_ui.py motor-out     # มอเตอร์ DC + IRLZ44N + Pico PWM: ความเร็วตาม duty, ไดโอดกันย้อน, แลป 24
python3 tests/e2e/logic_ui.py logic-out     # 74HC08/74HC32: ตารางความจริงจากสวิตช์ + LED, ขาเข้าลอย, แลป 25
python3 tests/e2e/dock_ui.py dock-out       # แท็บเล็ตจอสัมผัส: ย่อ/ซ่อนแผงเวลาจำลองระหว่างจำลอง, จังหวะไฟกะพริบ 555 สม่ำเสมอ
python3 tests/e2e/counter_ui.py cnt-out      # ไฟวิ่ง 555 + CD4017: นับ 0–9, LED ทีละดวง, RESET → Q4, แลป 26
python3 tests/e2e/lm35_ui.py lm35-out      # LM35 + Pico ADC: ค่าที่พิมพ์ตามอุณหภูมิ, LED เตือน, 3V3 ไม่พอ, แลป 27
python3 tests/e2e/hbridge_ui.py hb-out        # L293D + Pico: เดินหน้า/ถอยหลัง/PWM, VCC1 จาก 3V3 ไม่ทำงาน, แลป 28
python3 tests/e2e/sonar_ui.py sonar-out      # HC-SR04 + Pico: ระยะที่พิมพ์ตามค่าตั้ง, ไม่มีวัตถุ, Echo ต่อตรง = อันตราย, แลป 29
python3 tests/e2e/shiftreg_ui.py sr-out      # 74HC595 + Pico: ไฟวิ่ง 8 ดวง, ค่า 170 ในฉาก, OE สูง = ดับ, แลป 30
python3 tests/e2e/opto_ui.py opto-out        # PC817 + Pico: สวิตช์วงจร 12 V แยกกราวด์, ย่านขยาย/CTR, กราวด์ร่วม = ไม่แยก, แลป 31
python3 tests/e2e/stepper_ui.py step-out     # 28BYJ-48 + ULN2003 + Pico: 90° แล้วกลับ 45°, LED A–D, แกนหมุนในฉาก, 3V3 ไม่พอ, แลป 32
python3 tests/e2e/schematic_ui.py sch-out      # แท็บ "แลป" + รูปวงจรครบ 39 แลป, แตะเพื่อขยาย, ไม่มีคำว่า "บททดลอง" เหลือ
python3 tests/e2e/meters_ui.py meters-out    # มัลติมิเตอร์ดิจิทัล + แบบเข็ม: ต่อสายโพรบ, ผลการโหลด 20 kΩ/V, เข็มตีเกินสเกล, ฟิวส์ขาด, แลป 33
python3 tests/e2e/scr_ui.py scr-out          # SCR 2N5060: กดเกตติด, ปล่อยแล้วติดค้าง, ลัด A–K ดับ, โหลดเบา (IA < IH) ดับเอง, แลป 34
python3 tests/e2e/lm317_ui.py lm317-out      # LM317: แรงดันตามสูตร, เลื่อนพอตได้ 5 V / 9 V, dropout, R1 ใหญ่เกินไม่มีโหลด → ขาออกสูงเกิน, แลป 35
python3 tests/e2e/ntc_ui.py ntc-out          # NTC 10 kΩ B3950: วางโพรบ, ชิปอุณหภูมิ 0/60/100 °C ตามสูตรค่า B, ความร้อนในตัว, แลป 36
python3 tests/e2e/comparator_ui.py cmp-out    # LM393 เทอร์โมสตัท: ร้อน → LED ติด, ตั้งจุดตัดด้วยพอต, hysteresis, ป้อนกลับลบ → แจ้งสั่น, แลป 37
python3 tests/e2e/darlington_ui.py tip-out    # TIP120 ขับมอเตอร์: IB 0.45 mA → 0.16 A อิ่มตัว, RB 100 kΩ ไม่นำ, แผ่นระบายความร้อน, แลป 38
python3 tests/e2e/board_ui.py board-out      # เบรดบอร์ด MB-102 830 จุด: เปลี่ยนรุ่นจากแผง, มิเตอร์ถูกย้ายไม่ทับ, วาง a50, เปลี่ยนกลับไม่ได้เมื่อมีอุปกรณ์นอกคอลัมน์ 30, Undo
python3 tests/e2e/lm386_ui.py lm386-out      # LM386 ขับลำโพง: อัตราขยาย 20 → ใส่ C ขา 1–8 → 200, ลำโพงดัง 1 kHz, เพิ่มสัญญาณจนตัดยอด + เตือนกำลังเกิน, แลป 39
python3 tests/visual/bench_shots.py bench-out  # ภาพเครื่องมือขนาดจริงบนโต๊ะ (ไฟล์ schema 29 → จัดเครื่องมือลงช่องใหม่)
```

## Stack

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | TypeScript (strict) | ตรวจชนิดข้อมูลวงจร/ไฟล์ได้ตั้งแต่ตอนคอมไพล์ |
| Build | Vite 8 | dev server เร็ว, รองรับ Web Worker แบบ inline, สร้างไฟล์เดียวได้ |
| 3D | three.js 0.186 | ใช้แพร่หลาย เบา รองรับ WebGL บนแท็บเล็ตทั่วไป |
| UI | DOM + CSS ล้วน | แผงไม่ซับซ้อน ไม่ต้องพึ่ง framework ลดขนาด bundle |
| Solver | เขียนเอง (Nodal + Newton, transient แบบ trapezoidal/BE, AC สัญญาณเล็ก, ไดโอด/BJT/op-amp) ใน Web Worker | คุมพฤติกรรมจำกัดกระแส ข้อผิดพลาด และเวลาจำลองได้เอง |
| ไมโครคอนโทรลเลอร์ | rp2040js 1.4.1 + MicroPython v1.24.1 (build จากซอร์ส, ดู firmware/README.md) | ประมวลผลคำสั่ง ARM จริงในเบราว์เซอร์ ไม่ต้องมีเซิร์ฟเวอร์ |
| ทดสอบ | Vitest + Playwright (Python) | unit/fuzz เร็ว, e2e ใช้ pointer event จริง |

## โครงสร้างโค้ด

```
src/
  model/         ข้อมูลวงจรและรูปแบบไฟล์ (types, เบรดบอร์ด CL-400 / MB-102, คลังอุปกรณ์, ตรวจการวาง, schema, bench = ช่องวางเครื่องมือขนาดจริง)
  editor/        คำสั่งแก้ไขแบบ pure function + Undo/Redo (snapshot)
  connectivity/  คำนวณเน็ตจาก ขา + สาย + การเชื่อมภายในบอร์ด (union-find)
  sim/           netlist, solver (DC), transient, ac (AC sweep), engine, Web Worker, ตัวควบคุมเวลา
  instruments/   โพรบสองจุด แอมมิเตอร์ มัลติมิเตอร์ดิจิทัล/แบบเข็ม (meters.ts) กราฟบันทึกค่า ออสซิลโลสโคป กราฟโบด ความสว่าง LED การแจ้งเกินพิกัด
  mcu/           ตัวจำลอง Pico (rp2040js + bootrom), การจำลองร่วม CPU ↔ วงจร, เฟิร์มแวร์ที่ฝัง
  lessons/       lessons.ts = โจทย์ (เนื้อหา), checks.ts = ตัวตรวจ (เฉลย)
  storage/       Export/Import JSON + บันทึกอัตโนมัติ
  render/        three.js: โมเดลอุปกรณ์, เครื่องมือขนาดจริง (bench.ts), ฉาก, สายโพรบ, picking (คืนค่าเชิงตรรกะ ไม่ตัดสินการเชื่อมต่อ)
  ui/            แผงต่าง ๆ, เครื่องมือ, การโต้ตอบเมาส์/touch
tests/           unit + fuzz (Vitest), e2e/ (Playwright), visual/ (ภาพตรวจรับโมเดล 3 มิติ + วัดเวลาวาด)
firmware/        เฟิร์มแวร์ MicroPython ที่ใช้ วิธี build ซ้ำ และสัญญาอนุญาต
docs/visual/     ภาพเปรียบเทียบก่อน/หลังปรับโมเดล และผลวัดประสิทธิภาพ
docs/REPORT.md   รายงานระยะที่ 1, ระยะที่ 2 (ส่วนที่ 1–4), ระยะที่ 3 (Pico) และแผนระยะถัดไป
```

รายละเอียดแบบจำลอง ผลทดสอบ ข้อจำกัด และแผนระยะถัดไปอยู่ใน [docs/REPORT.md](docs/REPORT.md)
