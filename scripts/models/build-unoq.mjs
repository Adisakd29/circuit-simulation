// สร้าง unoq.glb จากข้อมูล CAD ของผู้ผลิต (Arduino ABX00162, CC BY-SA 4.0):
//  - แผ่น PCB: เรขาคณิตจาก STEP (รูปร่าง ความหนา รูยึด) + เท็กซ์เจอร์จาก Gerber (ทองแดง/มาสก์/แพดทอง) + สกรีน
//  - ตำแหน่ง/ขนาดชิ้นส่วน: กล่องใน STEP (ชิ้นใหญ่) และแพดใน IPC-356 (ทุกชิ้น SMD/TH)
//  - หัวต่อ/พอร์ต/ชิป สร้างเป็นรูปทรงตามขนาดในเอกสาร (ไม่ใช่กล่องสีเทา) · ไม่มีโลโก้ผู้ผลิต
// กรอบพิกัด (mm): x = ระยะจากขอบ USB-C, z = ระยะจากขอบหัวต่อดิจิทัล, y ขึ้น (ผิวบน PCB = 0, ผิวล่าง = −1.0)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const THREE = await import(new URL('../../node_modules/three/build/three.module.js', import.meta.url).href);
const { mergeGeometries } = await import(new URL('../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', import.meta.url).href);
const { Document, NodeIO } = await import('@gltf-transform/core');
const occt = require('occt-import-js');

const D = process.env.CAD_DIR ?? 'scripts/models/.cad/unoq';
const OUT = process.argv[2] ?? `${D}/out/unoq.glb`;
const W = 53.34, L = 68.58, T = 1.0;
const parts = JSON.parse(fs.readFileSync(`${D}/parts.json`, 'utf8'));
const atlas = JSON.parse(fs.readFileSync(`${D}/out/atlas.json`, 'utf8'));
const P = Object.fromEntries(parts.map((p) => [p.ref, p]));
/** IPC (mm) → กรอบโมเดล */
const ipc = (ix, iy) => ({ x: L - iy, z: W - ix });

/* ---------- กลุ่มเรขาคณิตตามวัสดุ ---------- */
const groups = new Map();
const add = (mat, g) => { if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(g.index ? g.toNonIndexed() : g); };
const box = (mat, x0, x1, y0, y1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); add(mat, g); return g; };
/** กล่องหมุนรอบแกน y (องศา) ที่จุดศูนย์กลาง */
const rbox = (mat, cx, cz, lx, lz, y0, y1, deg) => { const g = new THREE.BoxGeometry(lx, y1 - y0, lz); g.rotateY(-deg * Math.PI / 180); g.translate(cx, (y0 + y1) / 2, cz); add(mat, g); };
/** หน้าบนของชิปที่ใช้แอตลาส (สี่เหลี่ยม uv) — rot = หมุนข้อความ 90° */
function decal(mat, x0, x1, z0, z1, y, region, rot = 0) {
  const [u0, v0, u1, v1] = atlas[region];
  const pos = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
  let uv = rot ? [u0, v1, u0, v0, u1, v0, u0, v1, u1, v0, u1, v1] : [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
  const g = new THREE.BufferGeometry();
  // หันหน้าขึ้น: ลำดับจุดทวนเข็มเมื่อมองจากบน (x ขวา, z ลง) → (x0,z0) (x1,z1) (x1,z0)
  const p2 = [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0];
  const uvA = rot ? [u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0] : [u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  g.computeVertexNormals();
  void pos; void uv;
  add(mat, g);
}
/** ชิปจากกล่อง STEP: ตัวถังด้านข้าง + หน้าบนแอตลาส */
function chip(region, x0, x1, z0, z1, y0, y1, rot = 0, side = 'chipSide') {
  const top = y1 > 0;
  box(side, x0, x1, Math.min(y0, y1), Math.max(y0, y1) - (top ? 0.002 : -0.002), z0, z1);
  if (top) decal('atlas', x0, x1, z0, z1, y1, region, rot);
  else { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(Math.PI / 2); g.translate((x0 + x1) / 2, y0 - 0.001, (z0 + z1) / 2); const [u0, v0, u1, v1] = atlas[region]; const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * (rot ? uv.getY(i) : uv.getX(i)), v0 + (v1 - v0) * (rot ? uv.getX(i) : 1 - uv.getY(i))); add('atlas', g); }
}

/* ---------- 1) แผ่น PCB จาก STEP ---------- */
const occ = await occt();
const step = occ.ReadStepFile(new Uint8Array(fs.readFileSync(`${D}/UNO Q simplified.stp`)), { linearDeflection: 0.01, angularDeflection: 0.08 });
const m0 = step.meshes[0];
let SX0 = 1e9, SY0 = 1e9, SZ1 = -1e9;
{ const p = m0.attributes.position.array; for (let k = 0; k < p.length; k += 3) { SX0 = Math.min(SX0, p[k]); SY0 = Math.min(SY0, p[k + 1]); SZ1 = Math.max(SZ1, p[k + 2]); } }
const sv = (x, y, z) => [x - SX0, z - SZ1, W - (y - SY0)];
{
  const p = m0.attributes.position.array, idx = m0.index.array;
  const top = [], bot = [], side = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((j) => sv(p[idx[t + j] * 3], p[idx[t + j] * 3 + 1], p[idx[t + j] * 3 + 2]));
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3(...v[1]).sub(new THREE.Vector3(...v[0])), new THREE.Vector3(...v[2]).sub(new THREE.Vector3(...v[0]))).normalize();
    (n.y > 0.9 ? top : n.y < -0.9 ? bot : side).push(v);
  }
  const mk = (tris, uvf) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
    if (uvf) g.setAttribute('uv', new THREE.Float32BufferAttribute(tris.flatMap((t) => t.flatMap(uvf)), 2));
    g.computeVertexNormals();
    return g;
  };
  // หน้าบน: คอลัมน์ภาพ = ipcX = W − z, แถว = x (ภาพบนสุด = ขอบ USB) · หน้าล่าง: ภาพกลับซ้ายขวา คอลัมน์ = z
  add('pcbTop', mk(top, ([x, , z]) => [(W - z) / W, x / L]));
  add('pcbBot', mk(bot, ([x, , z]) => [z / W, x / L]));
  // ขอบ FR4 (สามเหลี่ยมด้านข้างเรียงจุดให้หันออก — คำนวณ normal แบบแบน)
  add('pcbEdge', mk(side, null));
}
console.log('pcb tris', groups.get('pcbTop')[0].attributes.position.count / 3, groups.get('pcbEdge')[0].attributes.position.count / 3);

/* กล่องใน STEP (กรอบโมเดล) */
const sbox = (i) => { const p = step.meshes[i].attributes.position.array; const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let k = 0; k < p.length; k += 3) { const v = sv(p[k], p[k + 1], p[k + 2]); for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], v[a]); b[a + 3] = Math.max(b[a + 3], v[a]); } } return { x0: b[0], x1: b[3], y0: b[1], y1: b[4], z0: b[2], z1: b[5] }; };

/* ---------- 2) หัวต่อตัวเมีย 2.54 mm (ดิจิทัล 10 + 8, ไฟ 8 + แอนะล็อก 6) จากตำแหน่งแพดจริง ---------- */
const HDR_H = 8.5;
const hdrPads = (ref) => P[ref].pads.map(([ix, iy, , , pin]) => ({ ...ipc(ix, iy), pin }));
function femaleHeader(pins) {
  const xs = pins.map((p) => p.x).sort((a, b) => a - b), z = pins[0].z;
  const x0 = xs[0] - 1.27, x1 = xs[xs.length - 1] + 1.27;
  // ตัวเรือนพลาสติกมีรูสี่เหลี่ยม 1.0 mm ทะลุลง (extrude ขึ้นแกน y)
  const sh = new THREE.Shape([new THREE.Vector2(x0, -(z - 1.27)), new THREE.Vector2(x1, -(z - 1.27)), new THREE.Vector2(x1, -(z + 1.27)), new THREE.Vector2(x0, -(z + 1.27))].reverse());
  for (const x of xs) {
    const hp = new THREE.Path([new THREE.Vector2(x - 0.5, -(z - 0.5)), new THREE.Vector2(x + 0.5, -(z - 0.5)), new THREE.Vector2(x + 0.5, -(z + 0.5)), new THREE.Vector2(x - 0.5, -(z + 0.5))]);
    sh.holes.push(hp);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: HDR_H - 0.9, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.deleteAttribute('uv');
  add('hdr', g);
  // ช่องปากกรวย (ลึก 0.9 mm จาก 2.0 → 1.0 mm) ที่ปากรูแต่ละรู + แผ่นบนระหว่างรู
  for (const x of xs) {
    const a = 1.0, b = 0.5, yT = HDR_H, yB = HDR_H - 0.9;
    const q = (p1, p2, p3, p4) => { const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute([...p1, ...p2, ...p3, ...p1, ...p3, ...p4], 3)); gg.computeVertexNormals(); add('hdr', gg); };
    const P4 = (h, s) => [[x - s, h, z - s], [x + s, h, z - s], [x + s, h, z + s], [x - s, h, z + s]];
    const t = P4(yT, a), bb = P4(yB, b);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; q(t[i], t[j], bb[j], bb[i]); }
    // หน้าสัมผัสทองในรู (มองเห็นจากด้านบน)
    box('gold', x - 0.42, x + 0.42, yB - 2.2, yB - 2.0, z - 0.42, z + 0.42);
    // ขาโผล่ใต้บอร์ด + จุดบัดกรี
    box('tin', x - 0.32, x + 0.32, -T - 2.6, -T, z - 0.32, z + 0.32);
    const sj = new THREE.CylinderGeometry(0.55, 0.95, 0.5, 14); sj.translate(x, -T - 0.25, z); add('tin', sj);
  }
  // แผ่นบน (ระหว่างปากกรวย) — ปิดผิวบนของตัวเรือนด้วยกรอบ
  const top = new THREE.Shape([new THREE.Vector2(x0, -(z - 1.27)), new THREE.Vector2(x1, -(z - 1.27)), new THREE.Vector2(x1, -(z + 1.27)), new THREE.Vector2(x0, -(z + 1.27))].reverse());
  for (const x of xs) top.holes.push(new THREE.Path([new THREE.Vector2(x - 1.0, -(z - 1.0)), new THREE.Vector2(x + 1.0, -(z - 1.0)), new THREE.Vector2(x + 1.0, -(z + 1.0)), new THREE.Vector2(x - 1.0, -(z + 1.0))]));
  const tg = new THREE.ShapeGeometry(top); tg.rotateX(-Math.PI / 2); tg.translate(0, HDR_H, 0); tg.deleteAttribute('uv'); add('hdr', tg);
  // ผนังส่วนบน 0.9 mm (ขอบนอก)
  box('hdr', x0, x1, HDR_H - 0.9, HDR_H, z - 1.27, z - 1.17); box('hdr', x0, x1, HDR_H - 0.9, HDR_H, z + 1.17, z + 1.27);
  box('hdr', x0, x0 + 0.1, HDR_H - 0.9, HDR_H, z - 1.27, z + 1.27); box('hdr', x1 - 0.1, x1, HDR_H - 0.9, HDR_H, z - 1.27, z + 1.27);
  for (let i = 0; i < xs.length - 1; i++) { const m = (xs[i] + xs[i + 1]) / 2; box('hdr', m - 0.27, m + 0.27, HDR_H - 0.9, HDR_H, z - 1.27, z + 1.27); }
}
const dig = hdrPads('JDIGIT'), ana = hdrPads('JANALO');
const pinN = (p) => Number(p.pin);
femaleHeader(dig.filter((p) => pinN(p) <= 8)); femaleHeader(dig.filter((p) => pinN(p) > 8));
femaleHeader(ana.filter((p) => pinN(p) <= 8)); femaleHeader(ana.filter((p) => pinN(p) > 8));

/* ---------- 3) หัวต่อตัวผู้ JCTL 2×5 (SMD) และ JSPI 2×3 (TH) ---------- */
function maleHeader(pins, base0, base1, tip, th) {
  const xs = pins.map((p) => p.x), zs = pins.map((p) => p.z);
  box('hdr', Math.min(...xs) - 1.27, Math.max(...xs) + 1.27, base0, base1, Math.min(...zs) - 1.27, Math.max(...zs) + 1.27);
  for (const p of pins) {
    box('gold', p.x - 0.32, p.x + 0.32, base1, tip - 0.25, p.z - 0.32, p.z + 0.32);
    const c = new THREE.CylinderGeometry(0.15, 0.45, 0.25, 4, 1); c.rotateY(Math.PI / 4); c.translate(p.x, tip - 0.125, p.z); add('gold', c);
    if (th) { box('tin', p.x - 0.32, p.x + 0.32, -T - 2.5, -T, p.z - 0.32, p.z + 0.32); const sj = new THREE.CylinderGeometry(0.55, 0.95, 0.5, 14); sj.translate(p.x, -T - 0.25, p.z); add('tin', sj); }
  }
}
{
  // JCTL: แพด SMD สองแถว (ห่าง 4.36) ขาอยู่กลางระหว่างคู่แพด พิทช์ 2.54 — กล่อง STEP #115 (สูง 1 → 10 mm)
  const b = sbox(115);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, pins = [];
  for (let i = 0; i < 5; i++) for (let r = 0; r < 2; r++) pins.push({ x: cx + (i - 2) * 2.54, z: cz + (r - 0.5) * 2.54 });
  maleHeader(pins, b.y0, b.y0 + 2.5, b.y1, false);
  // ขา SMD งอออกด้านข้างลงแพด
  for (const [ix, iy] of P.JCTL1.pads) { const q = ipc(ix, iy); box('gold', q.x - 0.3, q.x + 0.3, 0, 0.2, q.z - 0.9, q.z + 0.9); }
  const s = sbox(114), pj = hdrPads('JSPI1');
  maleHeader(pj, 0, 2.5, s.y1, true);
}

/* ---------- 4) USB-C (กล่อง STEP #124) : เปลือกโลหะทรงแคปซูล + ลิ้นพลาสติกพร้อมหน้าสัมผัส ---------- */
{
  const b = sbox(124); const cz = (b.z0 + b.z1) / 2, h = 3.16, w = 8.94, r = h / 2, yc = h / 2;
  const stadium = (ww, hh) => { const s = new THREE.Shape(); const rr = hh / 2; s.moveTo(-ww / 2 + rr, -rr); s.lineTo(ww / 2 - rr, -rr); s.absarc(ww / 2 - rr, 0, rr, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-ww / 2 + rr, rr); s.absarc(-ww / 2 + rr, 0, rr, Math.PI / 2, Math.PI * 1.5, false); return s; };
  const shell = stadium(w, h); const inner = stadium(w - 0.5, h - 0.5); shell.holes.push(new THREE.Path(inner.getPoints(24).reverse()));
  const g = new THREE.ExtrudeGeometry(shell, { depth: b.x1 - b.x0, bevelEnabled: false, curveSegments: 24 });
  g.rotateY(Math.PI / 2); g.translate(b.x0, yc, cz); g.deleteAttribute('uv'); add('steel', g);
  // ฝาหลังและลิ้นด้านใน
  const back = new THREE.ShapeGeometry(stadium(w - 0.5, h - 0.5), 24); back.rotateY(Math.PI / 2); back.translate(b.x1 - 0.3, yc, cz); back.deleteAttribute('uv'); add('blackPlastic', back);
  const cav = new THREE.ShapeGeometry(stadium(w - 0.5, h - 0.5), 24); cav.rotateY(-Math.PI / 2); cav.translate(b.x1 - 0.31, yc, cz); cav.deleteAttribute('uv'); add('blackPlastic', cav);
  box('blackPlastic', b.x0 + 0.6, b.x1 - 0.3, yc - 0.35, yc + 0.35, cz - 3.3, cz + 3.3);
  for (let i = 0; i < 12; i++) { const z = cz - 2.75 + i * 0.5; box('gold', b.x0 + 0.8, b.x1 - 1.2, yc + 0.35, yc + 0.37, z - 0.12, z + 0.12); box('gold', b.x0 + 0.8, b.x1 - 1.2, yc - 0.37, yc - 0.35, z - 0.12, z + 0.12); }
  // ขายึดลงรู (TH) และแถบด้านข้าง
  for (const [ix, iy, , , pin] of P.JUSB1.pads) { if (!/^(SH|S|M|G|1[3-9]|2\d|3\d)$/.test(pin) && P.JUSB1.pads.length) { /* แพด SMD ของสัญญาณ */ } }
  for (const s of [-1, 1]) box('steel', b.x0 + 1.5, b.x0 + 4.5, 0, yc, cz + s * (w / 2 - 0.1), cz + s * (w / 2 + 0.25));
}

/* ---------- 5) ปุ่ม POWER (กล่อง STEP #7) ---------- */
{
  const b = sbox(7); const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  box('whitePlastic', cx - 2.6, cx + 2.6, 0.05, 1.35, cz - 2.6, cz + 2.6);
  box('steel', cx - 2.7, cx + 2.7, 1.35, 1.5, cz - 2.7, cz + 2.7);
  const cap = new THREE.CylinderGeometry(1.55, 1.65, b.y1 - 1.5, 28); cap.translate(cx, (1.5 + b.y1) / 2, cz); add('whitePlastic', cap);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('steel', cx + sx * 2.6 - (sx > 0 ? 0 : 0.6), cx + sx * 2.6 + (sx > 0 ? 0.6 : 0), 0, 0.25, cz + sz * 1.8 - 0.4, cz + sz * 1.8 + 0.4);
}

/* ---------- 6) QWIIC (JST SH 4 ขาแนวนอน, กล่อง STEP #5) ปากหันออกขอบบอร์ด ---------- */
{
  const b = sbox(5); const cz = (b.z0 + b.z1) / 2;
  box('qwiic', b.x0, b.x1, 0.1, b.y1, b.z0 + 0.6, b.z1 - 0.6);
  box('blackPlastic', b.x1 - 0.02, b.x1 + 0.005, 0.7, b.y1 - 0.5, cz - 2.0, cz + 2.0);
  for (let i = 0; i < 4; i++) box('gold', b.x0 - 0.6, b.x0 + 0.4, 0, 0.18, cz - 1.5 + i - 0.15, cz - 1.5 + i + 0.15);
  for (const s of [-1, 1]) box('tin', b.x0 + 1.0, b.x1 - 1.2, 0, 0.8, cz + s * (2.4 + 0.05) - 0.3, cz + s * (2.4 + 0.05) + 0.3);
}

/* ---------- 7) ชิปหลัก (กล่อง STEP) พร้อมผิวหน้าเลขรุ่น ---------- */
{
  const c = (i, region, rot = 0, side) => { const b = sbox(i); chip(region, b.x0, b.x1, b.z0, b.z1, b.y0, b.y1, rot, side); return b; };
  c(121, 'soc', 1); c(120, 'dram', 1); c(127, 'pmic', 0); c(8, 'anx', 0); c(1, 'mcu', 1); c(2, 'emmc', 0);
  // ตัวเหนี่ยวนำ L2803 (ผิวโลหะเทา) — กล่อง STEP #9
  const l = sbox(9); box('inductor', l.x0, l.x1, l.y0, l.y1, l.z0, l.z1);
  // โมดูล Wi-Fi/Bluetooth: แผ่นเขียว (#123) + ฝาครอบโลหะ (#122)
  const pcb = sbox(123), sh = sbox(122);
  box('wifiEdge', pcb.x0, pcb.x1, pcb.y0, pcb.y1 - 0.003, pcb.z0, pcb.z1); decal('atlas', pcb.x0, pcb.x1, pcb.z0, pcb.z1, pcb.y1, 'wifi_pcb', 0);
  // ฝาครอบโลหะเล็กกว่าแผ่นเขียว 0.35 mm รอบด้าน และเว้นมุมด้านขอบ USB/ขอบหัวต่อดิจิทัล (มุมซ้ายบนในภาพผลิตภัณฑ์) ให้เห็นแผ่นเขียวและอุปกรณ์บนโมดูล
  const i = 0.35, nx = 5.2, nz = 3.6;
  const sx0 = sh.x0 + i, sx1 = sh.x1 - i, sz0 = sh.z0 + i, sz1 = sh.z1 - i;
  box('shieldSide', sx0 + nx, sx1, sh.y0, sh.y1 - 0.003, sz0, sz0 + nz); decal('atlas', sx0 + nx, sx1, sz0, sz0 + nz, sh.y1, 'shield');
  box('shieldSide', sx0, sx1, sh.y0, sh.y1 - 0.003, sz0 + nz, sz1); decal('atlas', sx0, sx1, sz0 + nz, sz1, sh.y1, 'shield');
  // หัวต่อความเร็วสูงด้านล่าง JMISC / JMEDIA (2 × 30 พิทช์ 1.27)
  for (const i of [3, 4]) { const b = sbox(i); box('hdrDark', b.x0, b.x1, b.y0 + 0.002, b.y1, b.z0, b.z1); const g = new THREE.PlaneGeometry(b.z1 - b.z0, b.x1 - b.x0); g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 2); g.translate((b.x0 + b.x1) / 2, b.y0 - 0.001, (b.z0 + b.z1) / 2); const [u0, v0, u1, v1] = atlas.hdc; const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), v0 + (v1 - v0) * (1 - uv.getY(k))); add('atlas', g); }
}

/* ---------- 8) LED: เมทริกซ์ 13 × 8 (0603 หมุน 45°), RGB 4 ดวง, LED ไฟเข้า ---------- */
const MATRIX = parts.filter((p) => /^D27\d\d\d$/.test(p.ref) && !/^D27(201|301|302|401|402)$/.test(p.ref));
for (const p of MATRIX) {
  const q = ipc(p.cx, p.cy); const ang = -p.ang + 90;
  rbox('ledBody', q.x, q.z, 1.6, 0.8, 0, 0.35, ang);
  rbox('ledLens', q.x, q.z, 1.0, 0.62, 0.35, 0.55, ang);
}
for (const r of ['D27301', 'D27302', 'D27401', 'D27402']) { const p = P[r], q = ipc(p.cx, p.cy); box('ledBody', q.x - 0.5, q.x + 0.5, 0, 0.3, q.z - 0.5, q.z + 0.5); box('ledLens', q.x - 0.4, q.x + 0.4, 0.3, 0.55, q.z - 0.4, q.z + 0.4); }
{ const p = P.D27201, q = ipc(p.cx, p.cy); rbox('ledBody', q.x, q.z, 1.6, 0.8, 0, 0.3, -p.ang + 90); rbox('ledGreen', q.x, q.z, 1.1, 0.6, 0.3, 0.55, -p.ang + 90); }

/* ---------- 9) ชิ้นส่วน SMD อื่นทั้งหมดจากแพด IPC (R/C/L/D/F/RT/ESD 2 ขา, ไอซี/ทรานซิสเตอร์/คริสตัลหลายขา) ---------- */
const BIG = new Set(['SOC1', 'DRAM1', 'PMIC1', 'MCU1', 'EMMC1', 'U2901', 'U3001', 'L2803', 'JMEDIA', 'JMISC1', 'JDIGIT', 'JANALO', 'JUSB1', 'JBTN1', 'JCTL1', 'JSPI1', 'QWIIC1', 'ANT1', ...MATRIX.map((p) => p.ref), 'D27201', 'D27301', 'D27302', 'D27401', 'D27402']);
let nPass = 0, nIc = 0;
for (const p of parts) {
  if (BIG.has(p.ref) || p.side === 'TH') continue;
  const q = ipc(p.cx, p.cy); const s = p.side === 'T' ? 1 : -1; const yb = p.side === 'T' ? 0 : -T;
  const kind = p.ref.replace(/\d+$/, '');
  if (p.n === 2) {
    // ขนาดตัวถังตามระยะห่างแพด: 0201 / 0402 / 0603 / 0805 / 1206
    const pc = p.pitch; const [l, w, h] = pc < 0.6 ? [0.6, 0.3, 0.3] : pc < 1.2 ? [1.0, 0.5, 0.35] : pc < 1.8 ? [1.6, 0.8, 0.45] : pc < 2.6 ? [2.0, 1.25, 0.55] : [3.2, 1.6, 0.6];
    const ang = -p.ang + 90;
    const body = kind === 'C' ? 'capBody' : kind === 'R' || kind === 'RT' ? 'resBody' : kind === 'L' || kind === 'FB' ? 'resBody' : kind === 'F' ? 'whitePlastic' : 'diodeBody';
    const y0 = s > 0 ? yb : yb - h, y1 = s > 0 ? yb + h : yb;
    rbox(body, q.x, q.z, l * 0.72, w, y0, y1, ang);
    // ปลายบัดกรีสองข้าง
    const rad = (ang * Math.PI) / 180, ex = Math.cos(rad) * l * 0.43, ez = -Math.sin(rad) * l * 0.43;
    rbox('tin', q.x + ex, q.z + ez, l * 0.16, w * 1.02, y0, y1, ang); rbox('tin', q.x - ex, q.z - ez, l * 0.16, w * 1.02, y0, y1, ang);
    nPass++;
  } else {
    const h = kind === 'Y' ? 0.8 : kind === 'Q' ? 0.5 : 0.75;
    const lx = p.W * 0.98, lz = p.L * 0.98; // L ตามแกน ipcX = แกน z ของโมเดล
    const y0 = s > 0 ? yb : yb - h, y1 = s > 0 ? yb + h : yb;
    box(kind === 'Y' ? 'steel' : 'chipSide', q.x - lx / 2, q.x + lx / 2, y0, y1, q.z - lz / 2, q.z + lz / 2);
    nIc++;
  }
}
console.log('passives', nPass, 'ics', nIc, 'matrix', MATRIX.length);

/* ---------- เขียน GLB ---------- */
const MATS = {
  pcbTop: { tex: 'unoq-top.jpg', orm: 'unoq-top-orm.jpg' }, pcbBot: { tex: 'unoq-bot.jpg', orm: 'unoq-bot-orm.jpg' },
  pcbEdge: { c: [44, 52, 46], r: 0.8 }, hdr: { c: [38, 38, 38], r: 0.7 }, hdrDark: { c: [28, 28, 30], r: 0.6 },
  gold: { c: [214, 176, 96], r: 0.28, m: 1 }, tin: { c: [205, 206, 210], r: 0.3, m: 1 }, steel: { c: [196, 198, 202], r: 0.32, m: 0.95 },
  blackPlastic: { c: [16, 16, 17], r: 0.6 }, whitePlastic: { c: [236, 236, 232], r: 0.45 }, qwiic: { c: [242, 236, 222], r: 0.5 },
  chipSide: { c: [56, 58, 59], r: 0.72 }, atlas: { tex: 'unoq-atlas.jpg', r: 0.74 }, inductor: { c: [122, 124, 126], r: 0.45, m: 0.6 },
  wifiEdge: { c: [44, 104, 40], r: 0.6 }, shieldSide: { c: [200, 202, 206], r: 0.3, m: 0.9 },
  ledBody: { c: [238, 236, 228], r: 0.4 }, ledLens: { c: [250, 236, 176], r: 0.15 }, ledGreen: { c: [190, 236, 190], r: 0.15 },
  capBody: { c: [196, 164, 118], r: 0.55 }, resBody: { c: [30, 30, 32], r: 0.5 }, diodeBody: { c: [40, 40, 42], r: 0.5 },
};
const doc = new Document(); const buf = doc.createBuffer();
const scene = doc.createScene('UNO Q'); const root = doc.createNode('unoq'); scene.addChild(root);
const texCache = {};
const tex = (f) => (texCache[f] ??= doc.createTexture(f).setImage(fs.readFileSync(`${D}/out/${f}`)).setMimeType(f.endsWith('.png') ? 'image/png' : 'image/jpeg'));
let tris = 0;
for (const [name, list] of groups) {
  const spec = MATS[name]; if (!spec) throw new Error('no material ' + name);
  const textured = !!spec.tex;
  const geos = list.map((g) => { const c = g.clone(); if (!textured) c.deleteAttribute('uv'); else if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2)); if (!c.attributes.normal) c.computeVertexNormals(); for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k); return c; });
  const mg = mergeGeometries(geos, false); if (!mg) throw new Error('merge failed ' + name);
  tris += mg.attributes.position.count / 3;
  const mat = doc.createMaterial(name).setRoughnessFactor(spec.r ?? 0.5).setMetallicFactor(spec.m ?? 0);
  if (spec.c) mat.setBaseColorFactor([...spec.c.map((v) => Math.pow(v / 255, 2.2)), 1]);
  if (spec.tex) mat.setBaseColorTexture(tex(spec.tex));
  if (spec.orm) { mat.setMetallicRoughnessTexture(tex(spec.orm)).setRoughnessFactor(1).setMetallicFactor(1); }
  if (name === 'pcbTop' || name === 'pcbBot' || name === 'atlas') mat.setDoubleSided(false);
  const prim = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mg.attributes.position.array)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mg.attributes.normal.array)).setBuffer(buf));
  if (textured) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(mg.attributes.uv.array)).setBuffer(buf));
  root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
root.setExtras({ source: 'Arduino UNO Q (ABX00162) CAD files — docs.arduino.cc — CC BY-SA 4.0; model derived by Circuit Lab 3D (no logos)', units: 'mm', frame: 'x from USB-C edge, z from digital-header edge, y up (PCB top = 0)' });
doc.getRoot().getAsset().copyright = 'Derived from Arduino UNO Q CAD files (CC BY-SA 4.0)';
const bytes = await new NodeIO().writeBinary(doc);
fs.writeFileSync(OUT, bytes);
console.log('glb', OUT, bytes.length, 'bytes', 'tris', tris, 'meshes', groups.size);

/* ---------- บีบอัด: รวมจุดซ้ำ + quantize + meshopt (ถอดรหัสในเบราว์เซอร์ด้วย MeshoptDecoder ของ three.js) ---------- */
{
  const { weld, quantize, meshopt, dedup, prune } = await import('@gltf-transform/functions');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const d2 = await io.readBinary(bytes);
  await d2.transform(dedup(), weld(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
  const out = await io.writeBinary(d2);
  fs.writeFileSync(OUT.replace(/\.glb$/, '.opt.glb'), out);
  console.log('optimized', out.length, 'bytes');
}
