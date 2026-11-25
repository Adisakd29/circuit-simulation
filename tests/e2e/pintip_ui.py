"""E2E: ชื่อขาเมื่อชี้ (เมาส์) / แตะ (สัมผัส) ที่ขาอุปกรณ์
เดสก์ท็อป 1440×900: ชี้รูที่มีขามอสเฟตเสียบ, ชี้ขั้วแหล่งจ่าย, ชี้ขาตัวต้านทานบนโต๊ะ, ชี้พื้นว่าง → ป้ายหาย, ระหว่างใช้เครื่องมือต่อสายก็แสดง
มือถือ 390×844 (touch ผ่าน CDP): แตะรูที่มีขา → ป้ายแสดงชั่วครู่แล้วหายเอง
ใช้: python3 tests/e2e/pintip_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson13-mosfet.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
H = lambda h: {'kind': 'hole', 'boardId': 'bb1', 'hole': h}

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
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        if not mobile:
            s = page.evaluate(SCREEN_OF, H('f21'))
            page.mouse.move(s['x'], s['y']); time.sleep(0.3)
            t = page.evaluate(TIP)
            check(f'{tag}: ชี้รู f21 (ขา G ของ 2N7000 เสียบอยู่) → "Q1 · G เกต"', t == 'Q1 · G เกต', str(t))
            page.screenshot(path=f'{OUT}/{tag}-tip-1-gate.png')
            s = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'PS1', 'pin': 'pos'})
            page.mouse.move(s['x'], s['y']); time.sleep(0.3)
            t = page.evaluate(TIP)
            check(f'{tag}: ชี้ขั้ว + ของแหล่งจ่าย → แสดงชื่อขั้ว', t is not None and t.startswith('PS1 ·'), str(t))
            page.screenshot(path=f'{OUT}/{tag}-tip-2-supply.png')
            s = page.evaluate(SCREEN_OF, H('a2'))
            page.mouse.move(s['x'], s['y']); time.sleep(0.3)
            check(f'{tag}: ชี้รูว่าง → ไม่แสดงป้าย', page.evaluate(TIP) is None, str(page.evaluate(TIP)))
            page.click('.tool[aria-label="ต่อสาย (W)"]'); time.sleep(0.2)
            s = page.evaluate(SCREEN_OF, H('f22'))
            page.mouse.move(s['x'], s['y']); time.sleep(0.3)
            t = page.evaluate(TIP)
            check(f'{tag}: เครื่องมือต่อสาย ชี้รู f22 → "Q1 · D เดรน"', t == 'Q1 · D เดรน', str(t))
            page.mouse.down(); time.sleep(0.1)
            check(f'{tag}: กดเมาส์ → ป้ายหาย (ไม่บังการต่อสาย)', page.evaluate(TIP) is None)
            page.mouse.up(); page.keyboard.press('Escape')
        else:
            s = page.evaluate(SCREEN_OF, H('f21'))
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': s['x'], 'y': s['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
            t = page.evaluate(TIP)
            check(f'{tag}: แตะรู f21 → ป้าย "Q1 · G เกต"', t == 'Q1 · G เกต', str(t))
            page.screenshot(path=f'{OUT}/{tag}-tip-1-gate.png')
            time.sleep(2.6)
            check(f'{tag}: ป้ายหายเองหลัง ≈ 2.5 วินาที', page.evaluate(TIP) is None)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
