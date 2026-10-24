"""E2E: ปุ่มกด 6 × 6 mm ผ่าน UI จริง (เดสก์ท็อปด้วยเมาส์ 1440×900 และจำลอง viewport มือถือ 390×844 ด้วย touch ผ่าน CDP)
กดค้างที่ก้านปุ่มในฉาก 3 มิติ → LED ติด, ยกนิ้ว/ปล่อยเมาส์ → LED ดับ, ไม่ลงประวัติ Undo, ไม่ย้ายอุปกรณ์/กล้อง;
ปุ่ม "กดค้าง" ในแผงคุณสมบัติ; วางปุ่มใหม่จากคลังอุปกรณ์คร่อมร่องกลาง
ใช้: python3 tests/e2e/button_ui.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'pushbutton-led.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

PLUNGER = """(() => { const v = circuitLab.view; let p = null;
  v.scene.traverse(o => { if (o.userData.pushPlunger && o.userData.partId === 'SW1' && o.material && o.material.visible !== false) { const w = new o.position.constructor(); o.getWorldPosition(w); w.y += 0.05; p = w; } });
  const s = p.clone().project(v.camera); const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (s.x + 1) / 2 * r.width, y: r.top + (1 - s.y) / 2 * r.height }; })()"""
SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
LED = "(circuitLab.freshSim && circuitLab.freshSim.analysis.parts['LED1'].current)"
PRESSED = "circuitLab.doc.parts.find(p => p.id === 'SW1').params.pressed"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if mobile else None
        def down(x, y):
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
            else: page.mouse.move(x, y); page.mouse.down()
        def up():
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else: page.mouse.up()
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
        page.click('#btn-run')
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=10000)
        time.sleep(0.3)
        check(f'{tag}: ปุ่มปล่อย → LED ดับ', abs(page.evaluate(LED)) < 1e-6, str(page.evaluate(LED)))
        cam0 = page.evaluate("circuitLab.view.persp.position.toArray()")
        place0 = page.evaluate("JSON.stringify(circuitLab.doc.parts.find(p => p.id === 'SW1').placement)")
        undo0 = page.evaluate("circuitLab.history ? circuitLab.history.past?.length ?? null : null")
        p = page.evaluate(PLUNGER)
        down(p['x'], p['y']); time.sleep(0.6)
        led_on = page.evaluate(LED); pr = page.evaluate(PRESSED)
        check(f'{tag}: กดค้างที่ก้านปุ่ม (ฉาก 3 มิติ) → pressed และ LED ติด', pr is True and led_on > 5e-3, f'{pr} {led_on}')
        page.screenshot(path=f'{OUT}/{tag}-btn-1-pressed.png')
        # ลากนิ้วเล็กน้อยระหว่างกดค้าง: ต้องไม่ย้ายอุปกรณ์/ไม่หมุนกล้อง
        if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': p['x'] + 25, 'y': p['y'] + 10, 'id': 0}]})
        else: page.mouse.move(p['x'] + 25, p['y'] + 10, steps=4)
        time.sleep(0.3)
        up(); time.sleep(0.6)
        check(f'{tag}: ยกนิ้ว/ปล่อยเมาส์ → ปุ่มปล่อย LED ดับ', page.evaluate(PRESSED) is False and abs(page.evaluate(LED)) < 1e-6, str(page.evaluate(LED)))
        check(f'{tag}: ระหว่างกดลากเล็กน้อย อุปกรณ์ไม่ย้าย กล้องไม่หมุน', page.evaluate("JSON.stringify(circuitLab.doc.parts.find(p => p.id === 'SW1').placement)") == place0 and page.evaluate("circuitLab.view.persp.position.toArray()") == cam0)
        check(f'{tag}: การกดไม่ลงประวัติ Undo', page.evaluate("circuitLab.history ? circuitLab.history.past?.length ?? null : null") == undo0, f"{undo0}")
        # ปุ่มกดค้างในแผงคุณสมบัติ
        page.evaluate("circuitLab.select({t: 'part', id: 'SW1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        b = page.locator('#f-press').bounding_box()
        down(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); time.sleep(0.6)
        on2 = page.evaluate(LED)
        up(); time.sleep(0.6)
        check(f'{tag}: ปุ่ม "กดค้าง" ในแผงคุณสมบัติ: กด → ติด, ปล่อย → ดับ', on2 > 5e-3 and abs(page.evaluate(LED)) < 1e-6 and page.evaluate(PRESSED) is False, f'{on2} {page.evaluate(LED)}')
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        # วางปุ่มใหม่จากคลังอุปกรณ์ที่ f20 (คร่อมร่อง)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ปุ่มกด")'); time.sleep(0.3)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f20'})
        if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': s['x'], 'y': s['y'], 'id': 0}]}); time.sleep(0.05); cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else: page.mouse.click(s['x'], s['y'])
        time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'pushbutton').map(p => [p.id, p.placement.anchor])")
        holes = page.evaluate("(() => { const p = circuitLab.doc.parts.filter(p => p.kind === 'pushbutton').find(p => p.placement.anchor === 'f20'); return p ? window.__cl.pinHolesFor(p).map(x => x.hole) : null; })()")
        check(f'{tag}: วางปุ่มใหม่ที่ f20 คร่อมร่อง (ขา f20 e20 f22 e22)', holes == ['f20', 'e20', 'f22', 'e22'], f'{m} {holes}')
        page.screenshot(path=f'{OUT}/{tag}-btn-2-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
