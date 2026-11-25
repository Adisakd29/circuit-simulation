"""ภาพตรวจรับเครื่องมือขนาดจริง (แหล่งจ่าย/เครื่องกำเนิดสัญญาณ/สโคป) + มัลติมิเตอร์ดิจิทัลและแบบเข็มพร้อมสายโพรบ
ไฟล์ทดสอบเขียนเป็น schema 29 ตำแหน่งแบบเก่า → แอปต้องจัดเครื่องมือลงช่องใหม่ตอนเปิด (migration 29 → 30)
ใช้: python3 tests/visual/bench_shots.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
B = lambda kind, pid, anchor, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'board', 'boardId': 'bb1', 'anchor': anchor, 'rotation': rot}, 'params': params}
T = lambda kind, pid, x, z, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'table', 'x': x, 'z': z, 'rotation': rot}, 'params': params}
R = lambda r: {'resistance': r, 'powerRating': 0.25, 'span': 4}
H = lambda h: {'kind': 'hole', 'boardId': 'bb1', 'hole': h}
P = lambda p, pin: {'kind': 'pin', 'partId': p, 'pin': pin}
W = lambda i, a, b, c='#e53935': {'id': i, 'a': a, 'b': b, 'color': c, 'arc': 2, 'bend': 0}
SC = {'inputResistance': 1e6, 'timeDiv': 0.0002, 'vdiv1': 1, 'vdiv2': 1, 'ch1On': True, 'ch2On': True, 'trigSource': 'ch1', 'trigLevel': 0, 'trigSlope': 'rise', 'bodeStart': 10, 'bodeStop': 100000, 'bodePpd': 20, 'bodeRef': 'ch1'}
DMM = {'mode': 'dcv', 'inputResistance': 1e7, 'mvInputResistance': 1e6, 'shuntA': 0.01, 'shuntMa': 1, 'fuseA': 11, 'fuseMa': 0.44, 'ohmVoc': 1.2, 'ohmRs': 1000}
VOM = {'sel': 'dcv10', 'sensitivityDC': 20000, 'sensitivityAC': 9000, 'battery': 3, 'centerOhm': 20, 'fuse': 0.5}
doc = {'format': 'circuitlab3d', 'schemaVersion': 29, 'app': 'test', 'savedAt': '', 'title': 'bench', 'studentWork': {'lessonId': None, 'records': {}, 'answers': {}, 'achieved': {}},
  'circuit': {'breadboards': [{'id': 'bb1', 'model': 'CL-400', 'x': 0, 'z': 0}], 'probes': {'red': None, 'black': None},
    'parts': [T('dcsupply', 'PS1', -25, 0, {'voltage': 9, 'currentLimit': 0.5, 'internalResistance': 0.01, 'outputOn': True}),
              T('fgen', 'FG1', -25, -6, {'wave': 'sine', 'frequency': 1000, 'vpp': 2, 'offset': 0, 'outputImpedance': 50, 'outputOn': True}),
              T('scope', 'OSC1', -25, 14, SC),
              T('dmm', 'DMM1', 30, 0, DMM), T('vom', 'VOM1', 30, 10, VOM),
              B('resistor', 'R1', 'a5', R(1000)), B('resistor', 'R2', 'b9', R(1000)), B('resistor', 'R3', 'j20', R(10000))],
    'wires': [W('w1', P('PS1', 'pos'), H('c5')), W('w2', P('PS1', 'neg'), H('c13'), '#212121'),
              W('w3', P('DMM1', 'V'), H('d9')), W('w4', P('DMM1', 'COM'), H('d13'), '#212121'),
              W('w5', P('VOM1', 'P'), H('e9')), W('w6', P('VOM1', 'COM'), H('e13'), '#212121'),
              W('w7', P('FG1', 'OUT'), H('h20')), W('w8', P('FG1', 'COM'), H('h24'), '#212121'),
              W('w9', P('OSC1', 'CH1'), H('i20'), '#f2c94c'), W('w10', P('OSC1', 'GND'), H('i24'), '#212121'), W('w11', P('OSC1', 'CH2'), H('g24'), '#31b5d6')]}}
path = os.path.join(OUT, 'bench-doc.json')
json.dump(doc, open(path, 'w'))
SET_CAM = """([id, p, t]) => { const v = circuitLab.view; let o = [0, 0, 0];
  if (id) { const q = circuitLab.doc.parts.find(x => x.id === id).placement; o = [q.x, 0, q.z]; }
  p = p.map((x, i) => x + o[i]); t = t.map((x, i) => x + o[i]); v.controls.minDistance = 1; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }"""
VIEWS = [
    ('1-bench-wide', None, (0, 230, 260), (-10, 0, -60)),
    ('2-supply', 'PS1', (14, 40, 120), (0, 26, 50)),
    ('3-fgen', 'FG1', (-6, 75, 115), (0, 18, 55)),
    ('4-scope', 'OSC1', (10, 40, 120), (0, 30, 20)),
    ('5-dmm', 'DMM1', (0, 95, 52), (0, 0, -4)),
    ('6-vom', 'VOM1', (0, 88, 50), (0, 0, -2)),
    ('7-probes', None, (-2, 22, 34), (2, 0, 2)),
    ('8-leads-side', None, (8, 34, 78), (40, 6, 24)),
]

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()')
    page.set_input_files('#file-input', path)
    time.sleep(1.5)
    dlg = page.inner_text('#dialog') if page.locator('#dialog[open]').count() else ''
    print('status', page.inner_text('#status-msg'), dlg[:400])
    if page.locator('#dialog[open]').count():
        page.keyboard.press('Escape'); time.sleep(0.3)
    page.add_style_tag(content='#logger{display:none!important}')
    stage = page.locator('#stage')
    stage.screenshot(path=os.path.join(OUT, '0-default-view.png'), timeout=180000)
    page.click('#btn-run', timeout=5000); time.sleep(5.0)
    stage.screenshot(path=os.path.join(OUT, '0b-default-running.png'), timeout=180000)
    for name, pid, pos, tgt in VIEWS:
        page.evaluate(SET_CAM, [pid, list(pos), list(tgt)]); time.sleep(0.8)
        stage.screenshot(path=os.path.join(OUT, f'{name}.png'), timeout=180000)
    res = {'status': page.inner_text('#status-msg'), 'errors': errors,
           'placements': page.evaluate('circuitLab.doc.parts.filter(p => p.placement.kind === "table").map(p => [p.id, p.placement.x, p.placement.z])'),
           'readings': page.evaluate('Object.fromEntries(Object.entries(circuitLab.sim?.analysis?.parts ?? {}).filter(([k]) => /DMM|VOM/.test(k)).map(([k, v]) => [k, v.extra]))')}
    print(json.dumps(res, ensure_ascii=False, indent=1))
    b.close()
