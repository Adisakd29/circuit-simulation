"""E2E: MOSFET ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 13 → Run → อ่านค่าแผงขวา → ปิดสวิตช์ → เปลี่ยนรุ่น → ตรวจบทเรียน → วางมอสเฟตตัวใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/mosfet_ui.py <out-dir> [url]
"""
import json, os, sys, time
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
SIM = lambda pid: f"circuitLab.freshSim && circuitLab.freshSim.analysis.parts['{pid}']"

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
        check(f'{tag}: เปิดไฟล์แลป 13 (schema 9) ได้', page.evaluate("circuitLab.doc.parts.some(p => p.kind === 'mosfet')"), page.inner_text('#status-msg'))
        page.click('#btn-run')
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=10000)
        time.sleep(0.4)
        q = page.evaluate(SIM('Q1')); led = page.evaluate(SIM('LED1'))
        check(f'{tag}: สวิตช์ ON → 2N7000 เปิดเต็ม (ย่านเชิงเส้น) LED ติด', q and q['extra']['region'] == 1 and led['current'] > 1e-3,
              f"Vgs={q['extra']['vgs']:.3f} Vds={q['voltage']:.4f} Id={q['current']*1000:.2f} mA")
        page.evaluate("circuitLab.select({t: 'part', id: 'Q1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        txt = page.inner_text('#props')
        check(f'{tag}: แผงขวาแสดง Vgs/Vds/Id และ "เปิดเต็ม"', all(k in txt for k in ['Vgs', 'Vds', 'Id', 'เปิดเต็ม']), txt[:160].replace('\n', ' '))
        page.screenshot(path=f'{OUT}/{tag}-mos-1-on.png')
        page.click('#f-mos-IRLZ44N'); time.sleep(0.6)
        q2 = page.evaluate(SIM('Q1'))
        diags = page.evaluate("circuitLab.freshSim.analysis.diagnostics.map(d => d.message)")
        # IRLZ44N ลำดับขา G-D-S ต่างจาก 2N7000 (S-G-D) → วงจรเดิมต่อผิดขา: แอปต้องไม่ล่มและอธิบายได้
        check(f'{tag}: เปลี่ยนรุ่นเป็น IRLZ44N บนสายเดิม (ลำดับขาต่างกัน) → จำลองต่อได้ ไม่มี error', q2 is not None and page.evaluate('circuitLab.freshSim.analysis.ok'), ' | '.join(diags)[:200])
        page.keyboard.press('Control+z'); time.sleep(0.6)
        check(f'{tag}: Undo กลับเป็น 2N7000', page.evaluate("circuitLab.doc.parts.find(p => p.id === 'Q1').params.model") == '2N7000')
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        # ปลดสวิตช์ → pull-down ดึงเกตลง
        page.evaluate("circuitLab.select({t: 'part', id: 'S1'})"); time.sleep(0.3)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.click('#props .btn-row button:has-text("แตะเพื่อเปิด")'); time.sleep(0.6)
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        q3 = page.evaluate(SIM('Q1'))
        check(f'{tag}: ปลดสวิตช์ → คัตออฟ Id < 1 µA', q3 and abs(q3['current']) < 1e-6 and q3['extra']['region'] == 0, json.dumps(q3)[:160])
        page.screenshot(path=f'{OUT}/{tag}-mos-2-off.png')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        # ไฟล์งานบันทึกบทเรียนไว้แล้ว (lessonId = mosfet) → แท็บบทเรียนเปิดแลป 13 ทันที; ถ้ายังเป็นรายการ ให้เลือกการ์ด
        if page.locator('.lesson-card:has-text("มอสเฟต")').count(): page.click('.lesson-card:has-text("มอสเฟต")')
        time.sleep(1.0)
        goals = page.inner_text('#lesson-goals')
        n_pass = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: เปิดแลป 13 และตรวจผ่าน wiring/pull-down/คัตออฟ (≥ 3 ข้อ)', page.locator('#lesson-goals .goal').count() == 5 and n_pass >= 3, goals[:240].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-mos-3-lesson.png')
        if mobile: page.click('.panel.left .drawer-close') if page.locator('.panel.left .drawer-close').is_visible() else None; time.sleep(0.3)
        # วางมอสเฟตตัวใหม่จากคลังอุปกรณ์
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib') if page.locator('#tab-lib').count() else None
        time.sleep(0.2)
        page.click('.lib-item:has-text("มอสเฟต")'); time.sleep(0.3)
        s = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h2'})
        (page.touchscreen.tap if mobile else page.mouse.click)(s['x'], s['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'mosfet').map(p => [p.id, p.placement.anchor, p.params.model])")
        check(f'{tag}: วางมอสเฟตใหม่ที่ h2 ผ่านคลังอุปกรณ์ (2N7000 ค่าเริ่มต้น)', len(m) == 2 and any(a == 'h2' and md == '2N7000' for _, a, md in m), str(m))
        page.screenshot(path=f'{OUT}/{tag}-mos-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

run(False)
run(True)
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
