"""ภาพตรวจรับหม้อแปลง EI 12-0-12 V + วงจรแหล่งจ่ายแลป 22 (บริดจ์, C กรอง, 7805, สโคป AC)
และตรวจเชิงตัวเลขว่าปลายขา (mesh ที่ติด userData.leadTip) ตรงรู/ตำแหน่งขาของอุปกรณ์
ใช้: python3 tests/visual/psu_shots.py <out-dir> [url]
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
L = lambda lux, span=2: {'lux': lux, 'r10': 15000, 'gamma': 0.6, 'rdark': 1e6, 'maxPower': 0.1, 'span': span}
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e', 'fixtures', 'lesson22-psu.json')
doc = json.load(open(FIX))
doc['circuit']['parts'].append(T('transformer', 'T2', 40, 22, {'vRated': 12, 'iRated': 1, 'regulation': 0.16, 'frequency': 50, 'on': True}, 90))
path = os.path.join(OUT, 'psu-doc.json')
json.dump(doc, open(path, 'w'))
VIEWS = [
    ('0-overview', 'D1', (-12, 62, 48), (-12, 0, 0)),
    ('1-transformer-front', 'T1', (6, 16, 34), (0, 7, 2)),
    ('2-transformer-back', 'T1', (-34, 30, -46), (-4, 5, -4)),
    ('3-terminals', 'T1', (8, 14, 22), (0, 3, 12)),
    ('4-bridge', 'D1', (2, 22, 22), (2, 0, 1)),
    ('5-rot90', 'T2', (40, 34, 30), (0, 6, 0)),
]
SET_CAM = """([id, p, t]) => { const v = circuitLab.view; let o = [0, 0, 0];
  if (id) { let best = null; v.scene.traverse(m => { if (m.userData.leadTip && m.userData.partId === id) { const q = m.getWorldPosition(m.position.clone()); best = best || [0, 0, 0, 0]; best[0] += q.x; best[2] += q.z; best[3]++; } }); o = [best[0] / best[3], 0, best[2] / best[3]]; }
  p = p.map((x, i) => x + o[i]); t = t.map((x, i) => x + o[i]); v.controls.minDistance = 1; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); v.requestRender(); }"""
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
    print('status', page.inner_text('#status-msg'), page.inner_text('#dialog') if page.locator('#dialog[open]').count() else '')
    page.click('#btn-run', timeout=5000); time.sleep(9.0)
    page.locator('#logger').screenshot(path=os.path.join(OUT, 'scope-ripple.png'))
    page.add_style_tag(content='#logger{display:none!important}')
    st = page.inner_text('#status-msg')
    stage = page.locator('#stage')
    for name, pid, pos, tgt in VIEWS:
        page.evaluate(SET_CAM, [pid, list(pos), list(tgt)]); time.sleep(0.5)
        stage.screenshot(path=os.path.join(OUT, f'{name}.png'))
    res = {'status': st, 'parts': page.evaluate('circuitLab.doc.parts.length'), 'errors': errors}
    if page.evaluate("typeof window.__cl === 'object'"):
        chk = page.evaluate(CHECK)
        res['tips'] = chk
        res['maxErr'] = max((c.get('err', 99) for c in chk), default=None)
        res['missing'] = [c for c in chk if c.get('missing')]
        res['minBoardTipY'] = min((c['yMin'] for c in chk if c.get('board')), default=None)
        res['minTableTipY'] = min((c['yMin'] for c in chk if not c.get('board') and 'yMin' in c), default=None)
    json.dump(res, open(os.path.join(OUT, 'psu-check.json'), 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in res.items() if k != 'tips'}, ensure_ascii=False))
    b.close()
