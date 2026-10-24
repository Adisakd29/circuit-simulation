"""ภาพตรวจรับโมเดล 3 มิติ: เปิดวงจรตัวอย่างเดียวกัน ตั้งกล้องตำแหน่งเดียวกัน แล้วถ่ายภาพ (ใช้ทั้งก่อนและหลังแก้)
ใช้: python3 tests/visual/shots.py <out-dir> [url]
"""
import json, math, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
H = lambda h: {'kind': 'hole', 'boardId': 'bb1', 'hole': h}
Pn = lambda p, pin: {'kind': 'pin', 'partId': p, 'pin': pin}
W = lambda a, b, i, c='#e53935': {'id': i, 'a': a, 'b': b, 'color': c, 'arc': 2, 'bend': 0}
Bp = lambda kind, pid, anchor, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'board', 'boardId': 'bb1', 'anchor': anchor, 'rotation': rot}, 'params': params}
led_red = {'color': 'red', 'Is': 0.02 / (math.exp(1.9 / (2 * 0.025852)) - 1), 'n': 2, 'Rs': 5, 'ratedCurrent': 0.02, 'maxCurrent': 0.03, 'maxReverseVoltage': 5}
blink = "from machine import Pin\nimport time\nled = Pin(15, Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n"
doc = {'format': 'circuitlab3d', 'schemaVersion': 7, 'app': 'visual', 'savedAt': '', 'title': 'visual',
       'studentWork': {'lessonId': None, 'records': {}, 'answers': {}, 'achieved': {}},
       'circuit': {'breadboards': [{'id': 'bb1', 'model': 'CL-400', 'x': 0, 'z': 0}],
                   'parts': [Bp('pico', 'PICO1', 'h5', {'code': blink, 'autorun': True}),
                             Bp('resistor', 'R1', 'j24', {'resistance': 220, 'powerRating': 0.25, 'span': 4}),
                             Bp('led', 'LED1', 'i28', led_red),
                             Bp('switch', 'S1', 'i23', {'closed': False, 'onResistance': 0.05})],
                   'wires': [W(H('h29'), H('bn29'), 'w1', '#222222'), W(H('j22'), H('bn22'), 'w2', '#222222'), W(H('j25'), H('bn26'), 'w3', '#1e88e5'),
                             W(H('a5'), H('tp5'), 'w4', '#e53935')],
                   'probes': {'red': None, 'black': None}}}
# LEGACY=1: วงจรเดียวกันในรูปแบบไฟล์รุ่น 6 (ตำแหน่งตัวบอร์ดเดียวกัน) สำหรับถ่ายภาพ "ก่อนแก้" ด้วยแอปรุ่นเก่า
if os.environ.get('LEGACY'):
    doc['schemaVersion'] = 6
    M = dict(zip('abcdefghij', 'jihgfedcba')); RR = {'tp': 'bp', 'bp': 'tp', 'tn': 'bn', 'bn': 'tn'}
    mh = lambda h: (RR[h[:2]] + h[2:]) if h[:2] in RR else M[h[0]] + h[1:]
    for p in doc['circuit']['parts']: p['placement']['anchor'] = mh(p['placement']['anchor'])
    for w in doc['circuit']['wires']:
        for e in ('a', 'b'):
            if w[e]['kind'] == 'hole': w[e]['hole'] = mh(w[e]['hole'])
path = os.path.join(OUT, 'visual-doc.json')
json.dump(doc, open(path, 'w'))

# มุมกล้อง: [ชื่อ, ตำแหน่งกล้อง, จุดมอง]  (หน่วย = ระยะรู 2.54 mm; Pico อยู่กลางที่ x ≈ −1, z ≈ 0)
VIEWS = [
    ('1-overview', (-1, 30, 34), (-1, -1, 0)),
    ('2-top', (-1, 26, 0.01), (-1, 0, 0)),
    ('3-oblique-close', (-12, 7, 9), (-6, 0.5, 0)),
    ('4-usb-end', (-17, 4, 2), (-11, 0.8, 0)),
    ('5-side-insertion', (-4, 1.8, 10), (-4, 0.3, 0)),
    ('6-parts-close', (15, 5.5, 12), (11.5, 0.5, 4)),
    ('7-jumper-close', (-3, 6, 16), (3, 0.5, 6)),
]

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
    page.evaluate('localStorage.clear()')
    page.set_input_files('#file-input', path)
    time.sleep(1.0)
    # ซ่อนแผงซ้าย/ขวาไม่ได้บน desktop — ถ่ายเฉพาะพื้นที่ 3 มิติ
    stage = page.locator('#stage canvas').first
    t0 = time.time()
    for name, pos, tgt in VIEWS:
        page.evaluate("""([p, t]) => { const v = circuitLab.view; v.controls.minDistance = 2; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }""", [list(pos), list(tgt)])
        time.sleep(0.6)
        stage.screenshot(path=os.path.join(OUT, f'{name}.png'))
    # โหมดภาพประหยัด (ไม่มีแสงสะท้อนโลหะ/เงาจากแสงหลัก) มุมเดียวกับภาพที่ 3
    if page.evaluate("typeof circuitLab.view.setQuality === 'function'"):
        page.evaluate("circuitLab.view.setQuality('eco')")
        name, pos, tgt = VIEWS[2]
        page.evaluate("""([p, t]) => { const v = circuitLab.view; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }""", [list(pos), list(tgt)])
        time.sleep(0.8)
        stage.screenshot(path=os.path.join(OUT, '9-eco-oblique-close.png'))
        page.evaluate("circuitLab.view.setQuality('high')")
    # เลือกบอร์ด → ป้ายชื่อขาข้างบอร์ด (ตัวช่วยฝึกต่อวงจร)
    page.evaluate("circuitLab.select({t: 'part', id: 'PICO1'})")
    page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(-1, 0, 0); v.persp.position.set(-1, 27, 7); v.controls.update(); v.requestRender(); }""")
    time.sleep(0.6)
    stage.screenshot(path=os.path.join(OUT, '8-selected-pin-labels.png'))
    page.evaluate("circuitLab.select(null)")
    # เวลาวาดเฉลี่ยต่อเฟรม (ซอฟต์แวร์ WebGL) และจำนวน draw call / สามเหลี่ยม
    stats = page.evaluate("""async () => {
      const v = circuitLab.view; const r = v.renderer;
      // บังคับให้ GPU วาดเสร็จทุกเฟรม (readPixels) เพื่อวัดเวลาจริง ไม่ใช่แค่เวลาส่งคำสั่ง
      const gl = r.getContext(); const px = new Uint8Array(4);
      r.render(v.scene, v.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const N = 30; const t = performance.now();
      for (let i = 0; i < N; i++) { r.render(v.scene, v.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      const ms = (performance.now() - t) / N;
      r.info.autoReset = true; r.render(v.scene, v.camera);
      let pico = { meshes: 0, tris: 0 };
      const g = v.partObjs.get('PICO1');
      g && g.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { pico.meshes++; const geo = o.geometry; const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; pico.tris += n * (o.isInstancedMesh ? o.count : 1); } });
      return { msPerFrame: ms, canvas: [r.domElement.width, r.domElement.height], pixelRatio: r.getPixelRatio(), calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures, geometries: r.info.memory.geometries, pico };
    }""")
    json.dump(stats, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1)
    print(json.dumps(stats), 'errors:', errors[:3])
    b.close()
