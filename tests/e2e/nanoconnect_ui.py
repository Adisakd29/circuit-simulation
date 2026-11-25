"""E2E Arduino Nano RP2040 Connect (ไม่จำลอง NINA-W102) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
1) คลังอุปกรณ์ → "Arduino Nano RP2040 Connect (ไม่มีไร้สาย)" → แตะรู h3 → เสียบคร่อมร่องกลาง · โมเดลผูก LED บนบอร์ด (D13)
2) เปิดวงจร + LED ภายนอก D2 → แผงคุณสมบัติ "จำลองบางส่วน" + บอกข้อจำกัด NINA-W102 · Run → banner ของเฟิร์มแวร์ · LED1 และ LED บนบอร์ดกะพริบ · IMU วางนิ่ง ≈ 1 g ที่แกน z
3) เปลี่ยนการเคลื่อนไหวเป็น "เขย่า" ระหว่างจำลอง → ค่าความเร่งที่โค้ดพิมพ์แกว่ง · ค่าในแผงคุณสมบัติแสดง IMU · ไม่มี JavaScript error
ใช้: python3 tests/e2e/nanoconnect_ui.py <out-dir> [url] [desktop,mobile]
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
        page.fill('#lib-search', 'nano rp2040'); time.sleep(0.3)
        page.click('.lib-item[data-kind="nanoconnect"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h3', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'nanoconnect')", timeout=5000)
        except Exception: pass
        m = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'nanoconnect'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id);
          return { pl: p.placement, led: !!(g && g.userData.picoLed) }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → Nano RP2040 Connect → แตะรู h3 → เสียบคร่อมร่องกลาง · โมเดลผูก LED บนบอร์ด', m and m['pl'].get('anchor') == 'h3' and m['led'], str(m))
        page.screenshot(path=f'{OUT}/{tag}-nc-1-placed.png')

        # 2) วงจร LED ภายนอก + IMU
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'nanoconnect-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'NRP1')
        note = page.inner_text('#f-nc-mode') if page.locator('#f-nc-mode').count() else ''
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกว่าไม่จำลอง NINA-W102 (Wi-Fi/LED RGB/A4–A7) + ตัวเลือกการเคลื่อนไหว', 'จำลองบางส่วน' in st and 'NINA-W102' in note and 'LED RGB' in note and 'A4–A7' in note and page.locator('#f-nc-motion').count() == 1, (st[:40] + ' | ' + note[:80]).replace('\n', ' '))
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('accel g:')", timeout=60000, polling=300)
        except Exception: pass
        on = off = False; lon = loff = False; t0 = time.time()
        while time.time() - t0 < 5 and not (on and off and lon and loff):
            i = page.evaluate(LED)
            if i is not None: on = on or i > 1e-3; off = off or i < 1e-6
            e = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'nanoconnect'); return circuitLab.view.partObjs.get(p.id).userData.picoLed.emissiveIntensity; })()")
            lon = lon or e > 1.5; loff = loff or e < 0.2
            time.sleep(0.1)
        con = page.evaluate("circuitLab.picoConsole || ''")
        tab = page.inner_text('#dock-tab-pico') if page.locator('#dock-tab-pico').count() else ''
        az = [float(x) for x in re.findall(r'accel g: \S+ \S+ (\S+)', con)]
        check(f'{tag}: Run → banner ของเฟิร์มแวร์ · LED ภายนอก D2 และ LED บนบอร์ดกะพริบ · IMU วางนิ่ง z ≈ 1 g · แท็บ "Nano RP2040 Connect (MicroPython)"',
              'Arduino Nano RP2040 Connect (Circuit Lab 3D emulator, no NINA-W102)' in con and on and off and lon and loff and az and abs(az[-1] - 1) < 0.05 and 'Nano RP2040 Connect' in tab, f'{on} {off} {lon} {loff} {az[-3:]} {tab!r}')
        page.screenshot(path=f'{OUT}/{tag}-nc-2-run.png')

        # 3) เขย่าบอร์ดระหว่างจำลอง
        props(page, mobile, 'NRP1')
        page.select_option('#f-nc-motion', 'shake'); time.sleep(0.3)
        n0 = len(re.findall(r'accel g:', page.evaluate("circuitLab.picoConsole || ''")))
        try: page.wait_for_function(f"((circuitLab.picoConsole || '').match(/accel g:/g) || []).length >= {n0 + 6}", timeout=30000, polling=300)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole || ''")
        ax = [abs(float(x)) for x in re.findall(r'accel g: (\S+)', con)[n0:]]
        rd = page.inner_text('#prop-readings') if page.locator('#prop-readings').count() else ''
        check(f'{tag}: เลือก "เขย่า" ระหว่างจำลอง → ความเร่งแกน x ที่โค้ดอ่านได้แกว่งเกิน 0.5 g · แผงแสดง IMU LSM6DSOX', ax and max(ax) > 0.5 and 'LSM6DSOX' in rd, f'{[round(x, 2) for x in ax[:8]]} {rd[:120]!r}')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
