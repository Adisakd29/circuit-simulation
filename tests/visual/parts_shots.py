"""ภาพตรวจรับโมเดลอุปกรณ์บนบอร์ด (TO-92, ไดโอด DO-35/DO-41, ตัวเก็บประจุ, ตัวเหนี่ยวนำ, สวิตช์เลื่อน)
และตรวจเชิงตัวเลขว่าปลายขา (mesh ที่ติด userData.leadTip) ตรงรู/ตำแหน่งขาของอุปกรณ์
ใช้: python3 tests/visual/parts_shots.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
B = lambda kind, pid, anchor, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'board', 'boardId': 'bb1', 'anchor': anchor, 'rotation': rot}, 'params': params}
T = lambda kind, pid, x, z, params, rot=0: {'id': pid, 'label': pid, 'kind': kind, 'placement': {'kind': 'table', 'x': x, 'z': z, 'rotation': rot}, 'params': params}
D = lambda m, **k: {**{'1N4148': {'model': '1N4148', 'Is': 2.52e-9, 'n': 1.752, 'Rs': 0.568, 'Bv': 100, 'Ibv': 1e-4, 'maxCurrent': 0.3, 'maxPower': 0.5, 'span': 4},
                      '1N4007': {'model': '1N4007', 'Is': 7.03e-9, 'n': 1.808, 'Rs': 0.034, 'Bv': 1000, 'Ibv': 5e-6, 'maxCurrent': 1, 'maxPower': 3, 'span': 4},
                      'Z5V1': {'model': 'Z5V1', 'Is': 1e-14, 'n': 1, 'Rs': 2, 'Bv': 5.0, 'Ibv': 0.049, 'maxCurrent': 0.178, 'maxPower': 1, 'span': 4}}[m], **k}
NPN = {'model': '2N3904', 'polarity': 'npn', 'Is': 6.734e-15, 'bf': 200, 'br': 0.737, 'maxIc': 0.2, 'maxVce': 40, 'maxPower': 0.625}
CE = lambda c, v=16, pol=True, span=2: {'capacitance': c, 'ratedVoltage': v, 'polarized': pol, 'initialVoltage': 0, 'span': span}
parts = [
    B('bjt', 'Q1', 'e3', NPN),
    B('diode', 'D1', 'b8', D('1N4148')),
    B('diode', 'D2', 'd8', D('1N4007')),
    B('diode', 'D3', 'a14', D('Z5V1')),
    B('capacitor', 'C1', 'c19', CE(100e-6)),
    B('capacitor', 'C2', 'c24', CE(1000e-6, 25, True, 2)),
    B('capacitor', 'C3', 'h4', CE(100e-9, 50, False, 2)),
    B('inductor', 'L1', 'h9', {'inductance': 0.01, 'resistance': 1, 'ratedCurrent': 0.5, 'span': 3}),
    B('switch', 'S1', 'h16', {'closed': False, 'onResistance': 0.05}),
    B('switch', 'S2', 'h22', {'closed': True, 'onResistance': 0.05}),
    B('capacitor', 'C4', 'h27', CE(10e-6, 50, False, 2)),
    T('bjt', 'Q2', -4, 14, NPN, 90),
    T('capacitor', 'C5', 4, 14, CE(220e-6)),
    T('diode', 'D4', 10, 14, D('1N4007')),
]
doc = {'format': 'circuitlab3d', 'schemaVersion': 8, 'app': 'visual', 'savedAt': '', 'title': 'parts',
       'studentWork': {'lessonId': None, 'records': {}, 'answers': {}, 'achieved': {}},
       'circuit': {'breadboards': [{'id': 'bb1', 'model': 'CL-400', 'x': 0, 'z': 0}], 'parts': parts, 'wires': [], 'probes': {'red': None, 'black': None}}}
path = os.path.join(OUT, 'parts-doc.json')
json.dump(doc, open(path, 'w'))
hx = lambda col: col - 15.5  # คอลัมน์ → x
VIEWS = [
    ('0-overview', (0, 22, 20), (0, 0, 1)),
    ('1-bjt', (-11.5, 6.0, 2.2), (-11.5, 0.9, -1.5)),
    ('2-diodes', (-5.5, 5.0, 3.5), (-5.5, 0.3, -3.5)),
    ('3-zener-side', (0.5, 1.0, -1.2), (0.5, 0.35, -5.5)),
    ('4-electrolytic', (7.0, 9.0, 8.0), (7.0, 2.0, -3.5)),
    ('5-ceramic-inductor', (-8.0, 7.5, 15.0), (-8.0, 1.5, 3.5)),
    ('6-switches', (4.5, 9.0, 16.0), (4.5, 1.0, 3.5)),
    ('7-mlcc-side', (12.5, 1.6, 9.0), (12.5, 1.0, 3.5)),
    ('8-table', (3, 13, 30), (3, -1.5, 14.5)),
]
SET_CAM = """([p, t]) => { const v = circuitLab.view; v.controls.minDistance = 1; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }"""
CHECK = """() => {
  const app = circuitLab, v = app.view, out = [];
  v.scene.updateMatrixWorld(true);
  for (const part of app.doc.parts) {
    const tips = {};
    v.scene.traverse(o => { if (o.userData.leadTip && o.userData.partId === part.id) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); tips[o.userData.leadTip] = b; } });
    for (const d of window.__cl.pinDefs(part)) {
      let ex;
      if (part.placement.kind === 'board') { const ph = window.__cl.pinHolesFor(part).find(p => p.pin === d.name); ex = v.terminalWorld({ kind: 'hole', boardId: ph.boardId, hole: ph.hole }); }
      else ex = v.terminalWorld({ kind: 'pin', partId: part.id, pin: d.name });
      const b = tips[d.name];
      if (!b) { out.push({ part: part.id, pin: d.name, missing: true }); continue; }
      const tip = { x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2 };
      out.push({ part: part.id, pin: d.name, err: Math.hypot(tip.x - ex.x, tip.z - ex.z), yMin: b.min.y, board: part.placement.kind === 'board' });
    }
  }
  return out;
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
    time.sleep(1.2)
    st = page.inner_text('#status-msg')
    stage = page.locator('#stage canvas').first
    for name, pos, tgt in VIEWS:
        page.evaluate(SET_CAM, [list(pos), list(tgt)]); time.sleep(0.5)
        stage.screenshot(path=os.path.join(OUT, f'{name}.png'))
    res = {'status': st, 'parts': page.evaluate('circuitLab.doc.parts.length'), 'errors': errors}
    if page.evaluate("typeof window.__cl === 'object'"):
        chk = page.evaluate(CHECK)
        res['tips'] = chk
        res['maxErr'] = max((c.get('err', 99) for c in chk), default=None)
        res['missing'] = [c for c in chk if c.get('missing')]
        res['minBoardTipY'] = min((c['yMin'] for c in chk if c.get('board')), default=None)
        res['minTableTipY'] = min((c['yMin'] for c in chk if not c.get('board') and 'yMin' in c), default=None)
    json.dump(res, open(os.path.join(OUT, 'parts-check.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in res.items() if k != 'tips'}, ensure_ascii=False))
    b.close()
