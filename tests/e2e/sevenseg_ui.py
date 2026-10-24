"""E2E: ตัวแสดงผล 7 ส่วนผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจร "เลข 1" (แคโทดร่วม + 330 Ω ที่ B, C) → Run → แผงขวาแสดง “1”, ส่วน B/C สว่างในฉาก → เปลี่ยนเป็นแอโนดร่วม → ดับ + คำแนะนำ
→ Undo → แลป 18 ผ่าน common/resistor/digit → วางตัวแสดงผลใหม่จากคลังอุปกรณ์คร่อมร่อง
ใช้: python3 tests/e2e/sevenseg_ui.py <out-dir> [url] [desktop,mobile]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'sevenseg-one.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
GLOW = "(() => { let m = null; circuitLab.view.scene.traverse(o => { if (o.userData.segMats && o.userData.partId === 'DS1' && !m) m = o.userData.segMats; }); return m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.emissiveIntensity.toFixed(2)])) : null; })()"
EXTRA = "(circuitLab.freshSim && circuitLab.freshSim.analysis.parts['DS1'].extra)"

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
        time.sleep(0.4)
        x = page.evaluate(EXTRA)
        check(f'{tag}: แสดงเลข 1 (ส่วน B, C ติด ≈ 8.7 mA)', x and chr(int(x['digit'])) == '1' and 8e-3 < x['i_b'] < 10e-3, json.dumps({k: x[k] for k in ('digit', 'i_b', 'i_c', 'i_a')}) if x else '')
        gl = page.evaluate(GLOW)
        check(f'{tag}: ในฉาก 3 มิติ ส่วน B และ C สว่าง ส่วนอื่นดับ', gl and gl['b'] > 1 and gl['c'] > 1 and all(gl[k] == 0 for k in ('a', 'd', 'e', 'f', 'g', 'dp')), str(gl))
        page.evaluate("circuitLab.select({t: 'part', id: 'DS1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        res = page.inner_text('#props') + page.inner_text('body')
        check(f'{tag}: แผงแสดงผลอ่านได้ “1”', '“1”' in res)
        page.screenshot(path=f'{OUT}/{tag}-ss-1-one.png')
        page.click('#f-ss-ca'); time.sleep(0.6)
        x2 = page.evaluate(EXTRA)
        diags = page.evaluate("circuitLab.freshSim.analysis.diagnostics.map(d => d.message)")
        check(f'{tag}: เปลี่ยนเป็นแอโนดร่วมบนวงจรเดิม → ไม่ติด และแนะนำการต่อขาร่วม', x2['i_b'] < 1e-6 and any('แอโนดร่วม' in d for d in diags), ' | '.join(diags)[:160])
        page.keyboard.press('Control+z'); time.sleep(0.6)
        check(f'{tag}: Undo กลับเป็นแคโทดร่วม เลข 1 ติดอีกครั้ง', chr(int(page.evaluate(EXTRA)['digit'])) == '1')
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("7 ส่วน")').count(): page.click('.lesson-card:has-text("7 ส่วน")')
        time.sleep(1.0)
        n_pass = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 18 ผ่าน common/resistor/digit (≥ 3)', page.locator('#lesson-goals .goal').count() == 4 and n_pass >= 3, page.inner_text('#lesson-goals')[:240].replace('\n', ' | '))
        if mobile:
            if page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close')
            time.sleep(0.3); page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("7 ส่วน")'); time.sleep(0.3)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        holes = page.evaluate("(() => { const p = circuitLab.doc.parts.filter(p => p.kind === 'sevenseg').find(p => p.placement.anchor === 'h3'); return p ? window.__cl.pinHolesFor(p).map(x => x.hole) : null; })()")
        check(f'{tag}: วางตัวแสดงผลใหม่ที่ h3 คร่อมร่อง (ขา 1–5 h3–h7, ขา 6–10 d7–d3)', holes == ['h3', 'h4', 'h5', 'h6', 'h7', 'd7', 'd6', 'd5', 'd4', 'd3'], str(holes))
        page.screenshot(path=f'{OUT}/{tag}-ss-2-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
