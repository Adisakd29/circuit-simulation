"""E2E Raspberry Pi Pico W (ไม่มีไร้สาย) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
1) คลังอุปกรณ์ → "Raspberry Pi Pico W (ไม่มีไร้สาย)" → แตะรู h3 → เสียบคร่อมร่องกลาง · โมเดลมีฝาโลหะโมดูลไร้สาย ไม่ผูก LED บนบอร์ด
2) เปิดวงจร Pico W + LED ภายนอก GP16 → Run → banner "Raspberry Pi Pico W (… no wireless)" · LED1 กะพริบ · แท็บ "Pico W (MicroPython)" · แผงคุณสมบัติบอกข้อจำกัดไร้สาย/LED
3) แก้โค้ดเป็น Pin("LED") → Run → แถบสถานะเตือนว่า LED ต่อกับ CYW43 + Serial Monitor แสดง ValueError · ไม่มี JavaScript error
ใช้: python3 tests/e2e/picow_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

LED = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.LED1 ? s.analysis.parts.LED1.current : null; })()"

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.25)

        # 1) วางจากคลัง
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'pico w'); time.sleep(0.3)
        page.click('.lib-item[data-kind="picow"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h3', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'picow')", timeout=5000)
        except Exception: pass
        m = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'picow'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id);
          return { pl: p.placement, led: !!(g && g.userData.picoLed) }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → Pico W → แตะรู h3 → เสียบคร่อมร่องกลาง · LED บนบอร์ดไม่ผูกกับขา (ต่อกับ CYW43)', m and m['pl'].get('anchor') == 'h3' and not m['led'], str(m))
        page.screenshot(path=f'{OUT}/{tag}-picow-1-placed.png')

        # 2) วงจร LED ภายนอก
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'picow-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'PICO1')
        note = page.inner_text('#f-picow-mode') if page.locator('#f-picow-mode').count() else ''
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกว่าไม่จำลอง CYW43 / Pin("LED")', 'จำลองบางส่วน' in st and 'CYW43' in note and 'Pin("LED")' in note, (st[:40] + ' | ' + note[:80]).replace('\n', ' '))
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('GP16 = 0')", timeout=60000, polling=300)
        except Exception: pass
        on = off = False; t0 = time.time()
        while time.time() - t0 < 4 and not (on and off):
            i = page.evaluate(LED)
            if i is not None: on = on or i > 1e-3; off = off or i < 1e-6
            time.sleep(0.1)
        con = page.evaluate("circuitLab.picoConsole || ''")
        tab = page.inner_text('#dock-tab-pico') if page.locator('#dock-tab-pico').count() else ''
        check(f'{tag}: Run → banner ของเฟิร์มแวร์ Pico W · LED ภายนอก GP16 กะพริบ · แท็บ "Pico W (MicroPython)"', 'Raspberry Pi Pico W (Circuit Lab 3D emulator, no wireless)' in con and on and off and 'Pico W' in tab, f'{on} {off} {tab!r} {con[:90]!r}')
        page.screenshot(path=f'{OUT}/{tag}-picow-2-run.png')
        page.click('#btn-stop'); time.sleep(0.3)

        # 3) Pin("LED")
        props(page, mobile, 'PICO1')
        page.evaluate("""() => { const t = document.getElementById('f-code'); t.value = 'from machine import Pin\\nled = Pin("LED", Pin.OUT)\\nled.on()\\n'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); }""")
        time.sleep(0.4)
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(0.4)
        stat = page.evaluate("(document.getElementById('status-msg') || {}).textContent || ''")
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('ValueError')", timeout=60000, polling=300)
        except Exception: pass
        con2 = page.evaluate("circuitLab.picoConsole || ''")
        check(f'{tag}: โค้ด Pin("LED") → แถบสถานะเตือน CYW43 · Serial Monitor แสดง ValueError: unknown named pin "LED"', 'CYW43' in stat and 'unknown named pin "LED"' in con2, f'{stat[-80:]!r} {con2[-80:]!r}')
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
