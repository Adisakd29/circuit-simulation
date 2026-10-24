"""E2E: ตัวต้านทานปรับค่าได้ (VR 3296W) ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 15 → Run → โพรบที่แกนกลาง ≈ 2.5 V → ปุ่ม ±10% / แถบเลื่อน → แรงดันตาม 5·(1 − p) →
Undo → แลป 15 ผ่าน wiring/probe/linear/sweep → วาง VR ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/pot_ui.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson15-pot.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
PROBE = "(circuitLab.freshSim && circuitLab.freshSim.analysis.probe.value)"
POS = "circuitLab.doc.parts.find(p => p.id === 'VR1').params.position"

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
        check(f'{tag}: เปิดไฟล์แลป 15 (schema 11) มี VR', page.evaluate("circuitLab.doc.parts.some(p => p.kind === 'potentiometer')"), page.inner_text('#status-msg'))
        page.click('#btn-run')
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=10000)
        time.sleep(0.3)
        v = page.evaluate(PROBE)
        check(f'{tag}: โพรบที่แกนกลาง (50%) ≈ 2.5 V', v is not None and abs(v - 2.5) < 0.01, str(v))
        page.evaluate("circuitLab.select({t: 'part', id: 'VR1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        txt = page.inner_text('#props')
        check(f'{tag}: แผงคุณสมบัติมีแถบเลื่อนตำแหน่งและปุ่ม ±', page.locator('#f-pos').count() == 1 and page.locator('#props button:has-text("+10%")').count() == 1, txt[:120].replace('\n', ' '))
        page.click('#props button:has-text("+10%")'); time.sleep(0.5)
        p1, v1 = page.evaluate(POS), page.evaluate(PROBE)
        check(f'{tag}: กด +10% → ตำแหน่ง 60% แรงดัน ≈ 5·(1 − 0.6) = 2.0 V', abs(p1 - 0.6) < 1e-9 and abs(v1 - 5 * (10000 * 0.4 + 3) / 10006) < 0.005, f'{p1} {v1}')
        # แถบเลื่อน: ตั้งค่าแล้ว dispatch change เหมือนผู้ใช้ปล่อยนิ้ว
        page.evaluate("(() => { const s = document.getElementById('f-pos'); s.value = '150'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.5)
        p2, v2 = page.evaluate(POS), page.evaluate(PROBE)
        check(f'{tag}: แถบเลื่อน 15% → แรงดัน ≈ 4.25 V (ช่วงสูง)', abs(p2 - 0.15) < 1e-9 and abs(v2 - 5 * (10000 * 0.85 + 3) / 10006) < 0.005, f'{p2} {v2}')
        page.screenshot(path=f'{OUT}/{tag}-pot-1-high.png')
        for _ in range(8): page.click('#props button:has-text("+10%")'); time.sleep(0.25)
        p3, v3 = page.evaluate(POS), page.evaluate(PROBE)
        check(f'{tag}: กด +10% ต่อจนสุด → หยุดที่ 95%/100% แรงดันต่ำ (< 30%)', p3 > 0.9 and p3 <= 1 and v3 < 1.5, f'{p3} {v3}')
        page.keyboard.press('Control+z'); time.sleep(0.4)
        check(f'{tag}: Undo ย้อนตำแหน่งทีละขั้น', page.evaluate(POS) < p3, str(page.evaluate(POS)))
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        # ฉากสามมิติ: สกรูของ VR1 หมุนตามตำแหน่ง
        ang = page.evaluate("(() => { let a = null; circuitLab.view.scene.traverse(o => { if (o.userData.potScrew && o.userData.partId === 'VR1') a = o.rotation.y; }); return a; })()")
        pos_now = page.evaluate(POS)
        check(f'{tag}: สกรูในฉาก 3 มิติหมุนตามตำแหน่ง (25 รอบตลอดช่วง)', ang is not None and abs(ang + pos_now * 25 * 2 * 3.141592653589793) < 1e-6, f'{ang} {pos_now}')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("ปรับค่าได้")').count(): page.click('.lesson-card:has-text("ปรับค่าได้")')
        time.sleep(1.0)
        goals = page.inner_text('#lesson-goals')
        n_pass = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 15 ผ่าน wiring/probe/linear/sweep (≥ 4 ข้อ)', page.locator('#lesson-goals .goal').count() == 5 and n_pass >= 4, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-pot-2-lesson.png')
        if mobile:
            if page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close')
            time.sleep(0.3); page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ปรับค่าได้")'); time.sleep(0.3)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h20'})
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'potentiometer').map(p => [p.id, p.placement.anchor, p.params.resistance, p.params.position])")
        check(f'{tag}: วาง VR ใหม่ที่ h20 จากคลังอุปกรณ์ (10 kΩ, 50%)', len(m) == 2 and any(a == 'h20' and r == 10000 and q == 0.5 for _, a, r, q in m), str(m))
        page.screenshot(path=f'{OUT}/{tag}-pot-3-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

run(False)
run(True)
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
