# สร้างโมเดลบอร์ดจากไฟล์ CAD ของผู้ผลิต

`./build-unoq.sh` → `src/assets/models/unoq.glb` (ต้องมี node 22+, python3 + Pillow + numpy + playwright/chromium; เครื่องมือ node ติดตั้งใน `scripts/models/node_modules` ไม่ปนกับแอป)

ขั้นตอน (ทุกขั้นอ่านจากไฟล์ของผู้ผลิต ไม่มีการกะตำแหน่งจากภาพ):

| ขั้น | สคริปต์ | ข้อมูลเข้า → ออก |
|---|---|---|
| 1 | `gerb.cjs` (pcb-stackup / gerber-to-svg, MIT) | ชั้น Gerber (`top/bot` ทองแดง, `smt/smb` มาสก์, `pmt/pmb` ครีมบัดกรี) → SVG |
| 2 | `raster.py` | SVG → ภาพขาวดำในกรอบบอร์ด 53.34 × 68.58 mm (2048 px) |
| 3 | `step-outline.cjs` (occt-import-js, LGPL-2.1 — ใช้ตอนสร้างเท่านั้น) | STEP → เส้นรอบรูปบอร์ด + รูยึด 4 รู |
| 4 | `parts.py` + `ipc356.py` | IPC-356 → ตำแหน่ง/ขนาด/มุมของชิ้นส่วนทุกชิ้น (จากแพดจริง) |
| 5 | `unoq_tex.py` + `pcbtex.py` | ทองแดง + มาสก์ + สกรีน → เท็กซ์เจอร์สี + roughness/metalness (ไม่มีโลโก้) |
| 6 | `unoq_atlas.py` | ผิวหน้าชิป (เลขรุ่นตามเอกสาร) |
| 7 | `build-unoq.mjs` (three.js + glTF-Transform + meshoptimizer, MIT) | PCB จาก STEP + ชิ้นส่วน → GLB → บีบอัด (quantize + EXT_meshopt_compression) |

กรอบพิกัดใน GLB (mm): x จากขอบ USB-C, z จากขอบหัวต่อดิจิทัล, y ขึ้น (ผิวบน PCB = 0) · แอปวางโมเดลที่ `UNOQ_PCB_TOP` = 6 mm (บอร์ดวางบนหัวต่อ JMISC/JMEDIA ใต้บอร์ด)

การตรวจ: `tests/board-cad.test.ts` เทียบตำแหน่งขา 32 ขาในแอปกับแพดในไฟล์ IPC-356 (`tests/fixtures/cad/unoq-header-pads.json`) และเน็ตของแต่ละขา · `tests/e2e/boardview_ui.py` ตรวจในเบราว์เซอร์ว่าจุดต่อสายตรงกับขาในโมเดลและสายตามขาเมื่อหมุน/ย้ายบอร์ด

ข้อจำกัด: STEP ของผู้ผลิตเป็นแบบ "simplified" (ชิ้นส่วนเป็นกล่อง) — รูปทรงหัวต่อ/พอร์ต/ชิปจึงสร้างตามขนาดในเอกสาร (ขนาดและตำแหน่งจริง รายละเอียดผิวเป็นแบบย่อ) · ชุด CAD ไม่มีชั้นสกรีน — สกรีนวาดตามภาพผลิตภัณฑ์ใน datasheet (ตำแหน่งโดยประมาณ)
