"""E2E: LDR ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 17 (47 kΩ + LDR + ไฟอัตโนมัติ) → Run → ปุ่มระดับแสง/แถบเลื่อน → LED ติดเมื่อมืด ดับเมื่อสว่าง
→ กรวยแสงในฉากตามระดับแสง → แลป 17 ผ่าน → วาง LDR ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/ldr_ui.py <out-dir> [url] [desktop,mobile]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson17-ldr.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
LED = "(circuitLab.freshSim && circuitLab.freshSim.analysis.parts['LED1'].current)"
PROBE = "(circuitLab.freshSim && circuitLab.freshSim.analysis.probe.value)"
CONE = "(() => { let n = 0; circuitLab.view.scene.traverse(o => { if (o.userData.lightCone && o.userData.partId === 'LDR1') n++; }); return n; })()"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
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
        check(f'{tag}: 300 lx (ห้องเรียน) → LED ดับ, X ต่ำ', page.evaluate(LED) < 1e-4 and page.evaluate(PROBE) < 0.4, f'{page.evaluate(LED)} {page.evaluate(PROBE)}')
        check(f'{tag}: มีกรวยแสงที่ 300 lx', page.evaluate(CONE) == 1)
        page.evaluate("circuitLab.select({t: 'part', id: 'LDR1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.click('#f-lux-10'); time.sleep(0.6)
        check(f'{tag}: ปุ่ม "ห้องมืด 10 lx" → LED ติด', page.evaluate(LED) > 5e-3, str(page.evaluate(LED)))
        page.screenshot(path=f'{OUT}/{tag}-ldr-1-dark.png')
        page.click('#f-lux-300'); time.sleep(0.6)
        check(f'{tag}: ปุ่ม "ห้องเรียน 300 lx" → LED ดับ', page.evaluate(LED) < 1e-4, str(page.evaluate(LED)))
        page.evaluate("(() => { const s = document.getElementById('f-lux'); s.value = '0'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.6)
        lux0 = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'LDR1').params.lux")
        check(f'{tag}: แถบเลื่อนไปซ้ายสุด → มืดสนิท 0 lx, LED ติด, ไม่มีกรวยแสง', lux0 == 0 and page.evaluate(LED) > 5e-3 and page.evaluate(CONE) == 0, f'{lux0} {page.evaluate(LED)}')
        page.keyboard.press('Control+z'); time.sleep(0.5)
        check(f'{tag}: Undo กลับเป็น 300 lx', page.evaluate("circuitLab.doc.parts.find(p => p.id === 'LDR1').params.lux") == 300)
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("ไวแสง")').count(): page.click('.lesson-card:has-text("ไวแสง")')
        time.sleep(1.0)
        goals = page.inner_text('#lesson-goals')
        n_pass = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 17 ผ่านครบ 3 ข้อ (divider/response/night)', page.locator('#lesson-goals .goal').count() == 3 and n_pass == 3, goals[:240].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-ldr-2-lesson.png')
        if mobile:
            if page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close')
            time.sleep(0.3); page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ไวแสง")'); time.sleep(0.3)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'c14'})
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'ldr').map(p => [p.id, p.placement.anchor, p.params.lux])")
        check(f'{tag}: วาง LDR ใหม่ที่ c14 จากคลังอุปกรณ์ (300 lx)', len(m) == 2 and any(a == 'c14' and l == 300 for _, a, l in m), str(m))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
