"""E2E Seeed Studio XIAO RP2040 — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
1) คลังอุปกรณ์ → "Seeed Studio XIAO RP2040" → แตะรู h3 → เสียบคร่อมร่องกลาง (D0 ที่ h3, 5V ที่ d3) · โมเดลมี LED RGB และ NeoPixel ผูกกับสถานะบอร์ด
2) เปิดวงจร XIAO + LED ภายนอก D0 → แผงคุณสมบัติ "จำลองบางส่วน" + บอกข้อจำกัด PIO/REPL · Run → banner ของเฟิร์มแวร์ XIAO · LED1 กะพริบ · แท็บ "XIAO RP2040 (MicroPython)"
3) NeoPixel บนบอร์ดเปลี่ยนสีตามโค้ด (ชิปสถานะในแท็บ + วัสดุเรืองแสงของโมเดล) · LED_B (ติดเมื่อ LOW) สลับ · ค่าในแผงคุณสมบัติแสดง D0 (GPIO26) และ NeoPixel · ไม่มี JavaScript error
ใช้: python3 tests/e2e/xiao_ui.py <out-dir> [url] [desktop,mobile]
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
        page.fill('#lib-search', 'xiao'); time.sleep(0.3)
        page.click('.lib-item[data-kind="xiao"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h3', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'xiao')", timeout=5000)
        except Exception: pass
        m = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'xiao'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id);
          return { pl: p.placement, neo: !!(g && g.userData.xiaoNeo), rgb: !!(g && g.userData.xiaoRgb) }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → XIAO RP2040 → แตะรู h3 → เสียบคร่อมร่องกลาง · โมเดลมี LED RGB + NeoPixel', m and m['pl'].get('anchor') == 'h3' and m['neo'] and m['rgb'], str(m))
        page.screenshot(path=f'{OUT}/{tag}-xiao-1-placed.png')

        # 2) วงจร LED ภายนอก + NeoPixel
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'xiao-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'XIAO1')
        note = page.inner_text('#f-xiao-mode') if page.locator('#f-xiao-mode').count() else ''
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกว่าไม่รองรับ PIO และ D6/D7 ใช้เป็น REPL', 'จำลองบางส่วน' in st and 'PIO' in note and 'D6/D7' in note and 'NeoPixel' in note, (st[:40] + ' | ' + note[:80]).replace('\n', ' '))
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('NeoPixel = (0, 255, 0)')", timeout=60000, polling=300)
        except Exception: pass
        on = off = False; t0 = time.time()
        while time.time() - t0 < 4 and not (on and off):
            i = page.evaluate(LED)
            if i is not None: on = on or i > 1e-3; off = off or i < 1e-6
            time.sleep(0.1)
        con = page.evaluate("circuitLab.picoConsole || ''")
        tab = page.inner_text('#dock-tab-pico') if page.locator('#dock-tab-pico').count() else ''
        check(f'{tag}: Run → banner ของเฟิร์มแวร์ XIAO · LED ภายนอก D0 กะพริบ · แท็บ "XIAO RP2040 (MicroPython)"', 'Seeed Studio XIAO RP2040 (Circuit Lab 3D emulator)' in con and on and off and 'XIAO RP2040' in tab, f'{on} {off} {tab!r} {con[:90]!r}')

        # 3) NeoPixel + LED RGB บนบอร์ด
        seen = set(); glow = 0.0; blue = set(); t0 = time.time()
        while time.time() - t0 < 6 and len(seen) < 3:
            s = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'xiao'); const g = circuitLab.view.partObjs.get(p.id);
              const e = g.userData.xiaoNeo.emissive, b = g.userData.xiaoRgb.emissive; const chip = document.getElementById('pc-neo');
              return { e: [e.r, e.g, e.b], b: b.b, chip: chip ? chip.textContent : '' }; })()""")
            if 'R255 G0 B0' in s['chip']: seen.add('r')
            if 'R0 G255 B0' in s['chip']: seen.add('g')
            if 'R0 G0 B255' in s['chip']: seen.add('b')
            glow = max(glow, max(s['e'])); blue.add(round(s['b']))
            time.sleep(0.15)
        check(f'{tag}: NeoPixel บนบอร์ดเปลี่ยนสี แดง/เขียว/น้ำเงิน ตามโค้ด (ชิปสถานะ + โมเดลเรืองแสง) · LED_B สลับติด/ดับ', len(seen) == 3 and glow > 0.9 and blue == {0, 1}, f'{seen} glow={glow:.2f} blue={blue}')
        page.screenshot(path=f'{OUT}/{tag}-xiao-2-run.png')
        props(page, mobile, 'XIAO1')
        try: page.wait_for_function("(document.getElementById('prop-readings') || {}).textContent?.includes('NeoPixel')", timeout=8000, polling=300)
        except Exception: pass
        rd = page.inner_text('#prop-readings') if page.locator('#prop-readings').count() else ''
        check(f'{tag}: แผงคุณสมบัติระหว่างจำลองแสดง D0 (GPIO26), LED RGB และ NeoPixel', 'D0 (GPIO26)' in rd and 'NeoPixel' in rd and 'LED RGB' in rd, rd[:160].replace('\n', ' '))
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
