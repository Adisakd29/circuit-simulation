"""E2E: ไอซีคงแรงดัน 78xx ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 21 (9 V → L7805 + C 0.33/0.1 µF → 100 Ω + LED) → Run → ขาออก 5 V → ป้ายชื่อขาที่รู f10 (IN)
→ แหล่งจ่าย 12 V (ยังคง 5 V) → 6 V (dropout + คำเตือน) → แลป 21 ผ่าน 5 ข้อหลัก → ติดแผ่นระบายความร้อน → รุ่น L7809 ที่ 12 V
→ วาง 7805 ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/vreg_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson21-7805.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
X = "(() => { const s = circuitLab.freshSim; if (!s) return null; const u = s.analysis.parts['U1']; return u && u.extra ? Object.assign({ led: s.analysis.parts['LED1'].current, diag: s.analysis.diagnostics.map(d => d.message).join(' | ') }, u.extra) : null; })()"
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f12'});
  v.controls.target.set(w.x + 2, 0, w.z); v.persp.position.set(w.x + 2, 16, w.z + 15); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""

def wait_x(page, cond, timeout=15000):
    page.wait_for_function(f"(() => {{ const x = {X}; return !!x && ({cond}); }})()", timeout=timeout, polling=250)
    return page.evaluate(X)

def close_drawer(page, mobile, side):
    if not mobile: return
    time.sleep(0.4)  # รอแอนิเมชันเลื่อนเข้า
    loc = page.locator(f'.panel.{side} .drawer-close')
    bb = loc.bounding_box() if loc.is_visible() else None
    if bb and 0 <= bb['x'] < page.viewport_size['width'] and 0 <= bb['y'] < page.viewport_size['height']: loc.click(force=True); time.sleep(0.4)

def set_num(page, mobile, part, field, value):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.4)
    if mobile and not page.locator(f'#{field}').is_visible(): page.click('#btn-right'); time.sleep(0.4)
    page.fill(f'#{field}', value); page.press(f'#{field}', 'Enter'); time.sleep(0.3)
    close_drawer(page, mobile, 'right')


def cam_still(page):
    """รอให้กล้องหยุดเลื่อน (OrbitControls มี damping — บนเครื่องที่วาดช้ากล้องยังเลื่อนต่อหลังตั้งตำแหน่ง)"""
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if mobile else None
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        page.evaluate(FOCUS); time.sleep(0.3)
        page.click('#btn-run')
        x = wait_x(page, 'Math.abs(x.vout - 5) < 0.05')
        check(f'{tag}: VIN 9 V → ขาออก 5 V คงแรงดัน, LED ติด, กระแสนิ่ง 3–8 mA', x['regulating'] == 1 and x['led'] > 5e-3 and 3e-3 < x['iq'] < 8e-3, f"vout={x['vout']:.4f} iout={x['iout']:.4f} iq={x['iq']:.4f}")
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate(FOCUS); time.sleep(0.4)
        page.screenshot(path=f'{OUT}/{tag}-vreg-1-run.png')
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f10'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู f10 → ป้าย "U1 · ขา 1 IN ..."', t is not None and t.startswith('U1 · ขา 1 IN'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-vreg-2-tip.png')
        if not mobile: page.mouse.move(5, 450)
        set_num(page, mobile, 'PS1', 'f-voltage', '12')
        x = wait_x(page, 'x.vin > 11.9')
        check(f'{tag}: แหล่งจ่าย 12 V → ขาออกยัง 5 V (line regulation)', abs(x['vout'] - 5) < 0.05 and x['regulating'] == 1, f"vin={x['vin']:.2f} vout={x['vout']:.4f}")
        set_num(page, mobile, 'PS1', 'f-voltage', '6')
        x = wait_x(page, 'x.vin < 6.1 && x.vout < 4.5')
        check(f'{tag}: แหล่งจ่าย 6 V → dropout: ขาออก ≈ 4 V + คำเตือน', 3.8 < x['vout'] < 4.1 and 'dropout' in x['diag'], f"vout={x['vout']:.3f} {x['diag'][:120]}")
        set_num(page, mobile, 'PS1', 'f-voltage', '9')
        wait_x(page, 'x.regulating === 1')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("7805")').count(): page.click('.lesson-card:has-text("7805")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 5", timeout=10000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        n_ok = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 21 ผ่าน 5 ข้อหลัก (wiring/caps/regulate/line/dropout)', page.locator('#lesson-goals .goal').count() == 6 and n_ok >= 5, f'{n_ok} — ' + goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-vreg-3-lesson.png')
        close_drawer(page, mobile, 'left')
        # แผ่นระบายความร้อน + รุ่น L7809 ที่ 12 V
        page.evaluate("circuitLab.select({t: 'part', id: 'U1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.4)
        page.check('#f-heatsink'); time.sleep(0.4)
        hs = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U1').params.heatsink")
        x = wait_x(page, 'x.rth === 16')
        check(f'{tag}: ติดแผ่นระบายความร้อน → Rth 16 °C/W', hs is True and x['rth'] == 16, f"tj={x['tj']:.1f}")
        page.click('#f-vr-L7809'); time.sleep(0.4)
        close_drawer(page, mobile, 'right')
        set_num(page, mobile, 'PS1', 'f-voltage', '12')
        x = wait_x(page, 'x.vin > 11.9 && x.vout > 8')
        check(f'{tag}: รุ่น L7809 ที่ 12 V → ขาออก 9 V', abs(x['vout'] - 9) < 0.06, f"vout={x['vout']:.4f}")
        page.evaluate(FOCUS); time.sleep(0.4)
        page.screenshot(path=f'{OUT}/{tag}-vreg-4-heatsink.png')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("คงแรงดัน")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f25'});
          v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 14, w.z + 10); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f25'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'vreg').map(p => [p.id, p.placement.anchor, p.params.model, p.placement.rotation])")
        check(f'{tag}: วาง 7805 ใหม่ที่ f25 จากคลังอุปกรณ์', len(m) == 2 and any(x[1] == 'f25' and x[2] == 'L7805' for x in m), str(m) + ' ' + page.inner_text('#status-msg'))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
