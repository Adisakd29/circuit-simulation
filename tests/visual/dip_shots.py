"""ภาพตรวจรับโมเดล IC DIP-8 (LM741): มุมบน มุมข้าง มุมเอียง + หมุน/ย้าย และตรวจตำแหน่งปลายขาเทียบรูเชิงตัวเลข
ใช้: python3 tests/visual/dip_shots.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
H = lambda h: {'kind': 'hole', 'boardId': 'bb1', 'hole': h}
Pn = lambda p, pin: {'kind': 'pin', 'partId': p, 'pin': pin}
W = lambda a, b, i, c='#e53935': {'id': i, 'a': a, 'b': b, 'color': c, 'arc': 2, 'bend': 0}
OA = {'model': 'LM741', 'gain': 200000, 'outputResistance': 75, 'headroom': 1.5, 'maxSupply': 36, 'inputResistance': 2e6, 'quiescentResistance': 18000}
doc = {'format': 'circuitlab3d', 'schemaVersion': 8, 'app': 'visual', 'savedAt': '', 'title': 'dip',
       'studentWork': {'lessonId': None, 'records': {}, 'answers': {}, 'achieved': {}},
       'circuit': {'breadboards': [{'id': 'bb1', 'model': 'CL-400', 'x': 0, 'z': 0}],
                   'parts': [{'id': 'U1', 'label': 'U1', 'kind': 'opamp', 'placement': {'kind': 'board', 'boardId': 'bb1', 'anchor': 'f10', 'rotation': 0}, 'params': OA},
                             {'id': 'U2', 'label': 'U2', 'kind': 'opamp', 'placement': {'kind': 'table', 'x': 4, 'z': 14, 'rotation': 90}, 'params': OA}],
                   'wires': [W(H('a11'), Pn('U2', 'OUT'), 'w3', '#1e88e5'), W(H('j13'), H('bn14'), 'w4', '#222222')],
                   'probes': {'red': None, 'black': None}}}
path = os.path.join(OUT, 'dip-doc.json')
json.dump(doc, open(path, 'w'))

# จุดศูนย์กลาง U1 (anchor f10 → ขาอยู่คอลัมน์ 10–13 แถว f/e): x ≈ −4.0, z ≈ 0
VIEWS = [
    ('1-top', (-4.0, 12, 0.01), (-4.0, 0, 0)),
    ('2-side-front', (-4.0, 0.9, 9), (-4.0, 0.4, 0)),
    ('3-side-end', (-13, 1.0, 0), (-4.0, 0.4, 0)),
    ('4-oblique', (-9, 6, 8), (-4.0, 0.5, 0)),
    ('5-oblique-close', (-6.5, 3.2, 4.2), (-4.0, 0.5, 0)),
]
SET_CAM = """([p, t]) => { const v = circuitLab.view; v.controls.minDistance = 1; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }"""
# ตรวจเชิงตัวเลข: ปลายขาแต่ละขา (mesh ที่ติด userData.leadTip) อยู่ตรงรูที่ขานั้นเสียบหรือไม่
CHECK = """(id) => {
  const app = circuitLab, v = app.view; const part = app.doc.parts.find(p => p.id === id);
  const out = [];
  v.scene.updateMatrixWorld(true);
  v.scene.traverse(o => { if (o.userData.leadTip && o.userData.partId === id && o.visible !== false) {
    const b = new o.geometry.boundingBox.constructor(); o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    out.push({ pin: o.userData.leadTip, x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2, yMin: b.min.y, yMax: b.max.y }); } });
  const exp = {};
  if (part.placement.kind === 'board') { for (const ph of window.__cl.pinHolesFor(part)) { const w = v.terminalWorld({ kind: 'hole', boardId: ph.boardId, hole: ph.hole }); exp[ph.pin] = { x: w.x, z: w.z, hole: ph.hole }; } }
  else for (const d of window.__cl.pinDefs(part)) { const w = v.terminalWorld({ kind: 'pin', partId: id, pin: d.name }); exp[d.name] = { x: w.x, z: w.z }; }
  return out.map(t => ({ ...t, ex: exp[t.pin], err: exp[t.pin] ? Math.hypot(t.x - exp[t.pin].x, t.z - exp[t.pin].z) : null }));
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()')
    page.set_input_files('#file-input', path)
    time.sleep(1.0)
    stage = page.locator('#stage canvas').first
    for name, pos, tgt in VIEWS:
        page.evaluate(SET_CAM, [list(pos), list(tgt)]); time.sleep(0.5)
        stage.screenshot(path=os.path.join(OUT, f'{name}.png'))
    # อุปกรณ์บนโต๊ะ (หมุน 90°) ต่อสายเข้าขา OUT
    page.evaluate(SET_CAM, [[9, 5, 21], [5.5, -1.5, 14.5]]); time.sleep(0.5)
    stage.screenshot(path=os.path.join(OUT, '6-table-rot90.png'))
    # ผ่าน UI จริง: ลาก U1 ด้วยเมาส์ไปที่ใหม่บนบอร์ด, และกดปุ่ม "หมุน 90°" ให้ U2 บนโต๊ะ
    PROJ = """([x, y, z]) => { const v = circuitLab.view; const p = v.camera.position.clone().set(x, y, z); p.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
    page.evaluate("circuitLab.view.resetView()"); time.sleep(0.4)
    c = page.evaluate(PROJ, [-4.0, 1.3, 0]); t = page.evaluate(PROJ, [-4.0 + 6, 1.3, 0])
    m = page.mouse; m.move(c['x'], c['y']); m.down()
    for i in range(1, 16): m.move(c['x'] + (t['x'] - c['x']) * i / 15, c['y'] + (t['y'] - c['y']) * i / 15); time.sleep(0.03)
    time.sleep(0.3); m.up(); time.sleep(0.6)
    res_ui = {'U1_after_ui_drag': page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U1').placement")}
    res_ui['U1_tips_after_drag'] = max(x['err'] for x in page.evaluate(CHECK, 'U1'))
    page.evaluate("circuitLab.select({t:'part', id:'U2'})"); time.sleep(0.2)
    page.click('#btn-rot90'); time.sleep(0.6)
    res_ui['U2_after_rot_button'] = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U2').placement")
    res_ui['U2_tips_after_rot'] = max(x['err'] for x in page.evaluate(CHECK, 'U2'))
    page.evaluate(SET_CAM, [[9, 5, 21], [5.5, -1.5, 14.5]]); time.sleep(0.5)
    stage.screenshot(path=os.path.join(OUT, '6b-table-rot180-after-button.png'))
    print(json.dumps(res_ui, ensure_ascii=False))
    # ย้าย + หมุน 180° ผ่านคำสั่งแก้ไขจริงของแอป (เหมือนผู้ใช้ลาก/กดหมุน)
    ok = page.evaluate("""() => { const a = circuitLab; a.select({t:'part', id:'U1'}); const p = a.doc.parts.find(p => p.id === 'U1');
       const r = a.apply(window.__cl.movePart(a.doc, 'U1', { ...p.placement, anchor: 'e23', rotation: 180 }), 'ย้าย+หมุน U1'); return r; }""") 
    page.evaluate(SET_CAM, [[11, 5, 7], [6, 0.5, 0]]); time.sleep(0.5)
    stage.screenshot(path=os.path.join(OUT, '7-moved-rot180.png'))
    page.evaluate("circuitLab.select({t:'part', id:'U1'})"); time.sleep(0.3)
    page.evaluate(SET_CAM, [[6, 9, 6], [6, 0.5, -0.5]]); time.sleep(0.5)
    stage.screenshot(path=os.path.join(OUT, '8-selected-label.png'))
    res = {}
    res['U1_rot180'] = page.evaluate(CHECK, 'U1')
    res['U2_table_rot90'] = page.evaluate(CHECK, 'U2')
    res['moved'] = ok
    res.update(res_ui)
    res['errors'] = errors
    json.dump(res, open(os.path.join(OUT, 'dip-check.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(res, ensure_ascii=False)[:1500])
    b.close()
