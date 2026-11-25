"""ภาพตรวจรับโมเดลเครื่องมือบนโต๊ะ (แหล่งจ่าย, เครื่องกำเนิดสัญญาณ, ออสซิลโลสโคป, แอมมิเตอร์) + ตรวจว่าจุดต่อสายยังอยู่ที่หัวขั้วต่อ
ใช้: python3 tests/visual/inst_shots.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
T = lambda kind, pid, x, z, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'table', 'x': x, 'z': z, 'rotation': rot}, 'params': params}
H = lambda h: {'kind': 'hole', 'boardId': 'bb1', 'hole': h}
P = lambda p, pin: {'kind': 'pin', 'partId': p, 'pin': pin}
W = lambda a, b, i, c: {'id': i, 'a': a, 'b': b, 'color': c, 'arc': 2, 'bend': 0}
parts = [
    T('dcsupply', 'PS1', -24, -4, {'voltage': 9, 'currentLimit': 0.5, 'internalResistance': 0.01, 'outputOn': True}),
    T('fgen', 'FG1', -24, 7, {'wave': 'square', 'frequency': 1000, 'vpp': 2, 'offset': 0, 'outputImpedance': 50, 'outputOn': True}),
    T('scope', 'SC1', 1, 17, {'inputResistance': 1e6, 'timeDiv': 0.0005, 'vdiv1': 1, 'vdiv2': 1, 'ch1On': True, 'ch2On': True, 'trigLevel': 0, 'trigSource': 'ch1', 'trigSlope': 'rise', 'bodeStart': 10, 'bodeStop': 100000, 'bodePpd': 10, 'bodeRef': 'ch1'}),
    T('ammeter', 'AM1', 22, -3, {'shuntResistance': 0.1, 'range': 0.2}),
]
wires = [W(P('PS1', 'pos'), H('tp3'), 'w1', '#e53935'), W(P('PS1', 'neg'), H('tn3'), 'w2', '#222222'),
         W(P('FG1', 'OUT'), P('SC1', 'CH1'), 'w3', '#fbc02d'), W(P('FG1', 'COM'), P('SC1', 'GND'), 'w4', '#222222'),
         W(P('AM1', 'A'), H('tp29'), 'w5', '#e53935'), W(P('AM1', 'COM'), H('a29'), 'w6', '#1e88e5')]
doc = {'format': 'circuitlab3d', 'schemaVersion': 8, 'app': 'visual', 'savedAt': '', 'title': 'inst',
       'studentWork': {'lessonId': None, 'records': {}, 'answers': {}, 'achieved': {}},
       'circuit': {'breadboards': [{'id': 'bb1', 'model': 'CL-400', 'x': 0, 'z': 0}], 'parts': parts, 'wires': wires, 'probes': {'red': None, 'black': None}}}
path = os.path.join(OUT, 'inst-doc.json'); json.dump(doc, open(path, 'w'))
VIEWS = [
    ('0-overview', (-4, 34, 44), (-4, -2, 6)),
    ('1-supply', (-22, 9, 7.5), (-24, 1.0, -3.5)),
    ('2-fgen', (-20.5, 4.5, 21), (-24, 0.0, 7.5)),
    ('3-scope', (3, 5, 34), (1, 0.2, 19)),
    ('4-ammeter', (22, 4.5, 3.5), (22, -0.8, -2.5)),
    ('5-supply-top', (-22.5, 7, 3), (-21.5, 1.5, -2.4)),
]
SET_CAM = """([p, t]) => { const v = circuitLab.view; v.controls.minDistance = 1; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }"""
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL); page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()')
    page.set_input_files('#file-input', path); time.sleep(1.0)
    page.evaluate('circuitLab.run()'); time.sleep(3.0)
    page.add_style_tag(content='.logger, .sim-banner, #hint { display: none !important; }')  # ซ่อนแผงกราฟในพื้นที่ทำงาน (ถ่ายเฉพาะฉาก 3 มิติ)  # ให้จอแสดงค่า/รูปคลื่นจริง
    stage = page.locator('#stage canvas').first
    for name, pos, tgt in VIEWS:
        page.evaluate(SET_CAM, [list(pos), list(tgt)]); time.sleep(0.6)
        r = page.evaluate("(() => { const b = document.getElementById('stage').getBoundingClientRect(); return {x: b.left, y: b.top, width: b.width, height: b.height}; })()")
        page.screenshot(path=os.path.join(OUT, f'{name}.png'), clip=r)
        if page.evaluate("document.documentElement.dataset.view3d") != 'ok': print('view3d', name, page.evaluate("document.documentElement.dataset.view3d"))
    # จุดต่อสายต้องอยู่ที่หัวขั้วต่อ (mesh ที่ติด isPin ของขั้วนั้น)
    chk = page.evaluate("""() => { const v = circuitLab.view, out = []; v.scene.updateMatrixWorld(true);
      for (const p of circuitLab.doc.parts) for (const d of window.__cl ? window.__cl.pinDefs(p) : []) {
        const t = v.terminalWorld({ kind: 'pin', partId: p.id, pin: d.name }); let best = Infinity;
        v.scene.traverse(o => { if (o.userData.isPin && o.userData.partId === p.id && o.userData.pin === d.name && o.isMesh && o.material.visible !== false) {
          o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); best = Math.min(best, bb.distanceToPoint(t)); } });
        out.push({ part: p.id, pin: d.name, dist: best }); } return out; }""")
    res = {'errors': errors, 'maxPinDist': max((c['dist'] for c in chk), default=None), 'pins': chk, 'status': page.inner_text('#sim-status')}
    json.dump(res, open(os.path.join(OUT, 'inst-check.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in res.items() if k != 'pins'}, ensure_ascii=False))
    b.close()
