"""วัดเวลาวาดต่อเฟรม (บังคับให้วาดเสร็จด้วย readPixels) ที่มุมกล้องภาพรวม และนับ draw call / สามเหลี่ยม
ใช้: python3 tests/visual/perf.py <url> <doc.json> [รอบ]"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
URL, DOC = sys.argv[1], sys.argv[2]
ROUNDS = int(sys.argv[3]) if len(sys.argv) > 3 else 3
MEAS = """async () => { const v = circuitLab.view; const r = v.renderer; const gl = r.getContext(); const px = new Uint8Array(4);
  r.render(v.scene, v.camera); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const N = 8; const t = performance.now(); for (let i=0;i<N;i++){ r.render(v.scene, v.camera); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}
  const ms = (performance.now()-t)/N; r.render(v.scene, v.camera);
  return { ms, calls: r.info.render.calls, triangles: r.info.render.triangles, canvas: [r.domElement.width, r.domElement.height], dpr: r.getPixelRatio(),
           gpu: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() }; }"""
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    p = b.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
    p.goto(URL); p.wait_for_function('window.circuitLab !== undefined', timeout=20000)
    p.set_input_files('#file-input', DOC); time.sleep(1.2)
    cams = {'overview': [(-1, 30, 34), (-1, -1, 0)], 'close': [(-12, 7, 9), (-6, 0.5, 0)]}
    res = {}
    for name, (pos, tgt) in cams.items():
        p.evaluate("([p, t]) => { const v = circuitLab.view; v.controls.minDistance = 2; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); }", [list(pos), list(tgt)])
        res[name] = [p.evaluate(MEAS) for _ in range(ROUNDS)]
    runs = res['overview']
    eco = {}
    if p.evaluate("typeof circuitLab.view.setQuality === 'function'"):
        p.evaluate("circuitLab.view.setQuality('eco')")
        for name, (pos, tgt) in cams.items():
            p.evaluate("([p, t]) => { const v = circuitLab.view; v.controls.target.set(...t); v.persp.position.set(...p); v.controls.update(); }", [list(pos), list(tgt)])
            eco[name] = sorted(round(p.evaluate(MEAS)['ms']) for _ in range(ROUNDS))
        p.evaluate("circuitLab.view.setQuality('high')")
    t0 = time.time(); p.evaluate("() => circuitLab.view.setDoc(circuitLab.doc)"); 
    out = {'msOverview': sorted(round(r['ms']) for r in res['overview']), 'msClose': sorted(round(r['ms']) for r in res['close']), 'callsClose': res['close'][0]['calls'], 'eco': eco, 'calls': runs[0]['calls'], 'triangles': runs[0]['triangles'], 'canvas': runs[0]['canvas'], 'dpr': runs[0]['dpr'], 'gpu': runs[0]['gpu']}
    # เวลาสร้างโมเดล Pico ใหม่ (ครั้งแรกรวมการสร้าง texture)
    out['buildPicoMs'] = p.evaluate("() => { const t = performance.now(); const d = circuitLab.doc; const pico = d.parts.find(p => p.kind === 'pico'); circuitLab.view.setDoc({...d, parts: d.parts.filter(p => p !== pico)}); circuitLab.view.setDoc(d); return performance.now() - t; }")
    print(json.dumps(out))
    b.close()
