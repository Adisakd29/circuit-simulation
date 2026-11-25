"""E2E Arduino Mega 2560 (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile
1) คลังอุปกรณ์ → Arduino Mega 2560 → แตะโต๊ะ → วางบนโต๊ะ · โมเดล 3 มิติมีขาโลหะ 85 ขา (ชื่อตรงกับขา) + LED L · ป้ายชื่อขามีขาเฉพาะ Mega
2) เปิดวงจร Mega + LED ที่ D13 + เครื่องวิเคราะห์ลอจิก (CH0 → D18 = TX1, CH1 → D46) → คอมไพล์ + อัปโหลด (บอร์ด mega: แฟลช / 253,952 ไบต์)
   → Run → LED บนเบรดบอร์ดติด/ดับ · Serial Monitor LED ON/OFF (ไม่มีข้อความของ Serial1) · แท็บเครื่องวิเคราะห์: CH1 PWM ≈ 490 Hz duty ≈ 25%,
   CH0 ถอด UART ได้ "MEGA S1" ที่ 9600 baud
3) แผงคุณสมบัติแสดงระดับการรองรับ "จำลองบางส่วน" + ตารางความสามารถของ Mega + สถานะ 4 ด้าน · ไม่มี JavaScript error
ใช้: python3 tests/e2e/mega_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import WORLD_TO_SCREEN, close_drawers, props

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
        errors, boards = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.on('request', lambda r: boards.append(r.post_data or '') if '/api/compile' in r.url else None)

        # 1) วางจากคลังอุปกรณ์
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'mega'); time.sleep(0.3)
        page.click('.lib-item:has-text("Arduino Mega 2560")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(-60, 0, 0); v.persp.position.set(-60, 120, 110); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }""")
        time.sleep(0.5)
        s = page.evaluate(WORLD_TO_SCREEN, [-95, 0, -10])
        if mobile: page.touchscreen.tap(s['x'], s['y'])
        else: page.mouse.click(s['x'], s['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'mega')", timeout=5000)
        except Exception: pass
        mg = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'mega'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id); const tips = []; g && g.traverse(o => { if (o.userData.leadTip) tips.push(o.userData.leadTip); });
          return { id: p.id, pl: p.placement.kind, tips: tips.length, d53: tips.includes('D53'), a15: tips.includes('A15'), gnd5: tips.includes('GND.5'), led: !!(g && g.userData.picoLed) }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → Arduino Mega 2560 → แตะโต๊ะ → วางบนโต๊ะ · โมเดลมีขา 85 ขา (D53, A15, GND.5) + LED L', mg and mg['pl'] == 'table' and mg['tips'] == 85 and mg['d53'] and mg['a15'] and mg['gnd5'] and mg['led'], str(mg))
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')
        time.sleep(0.8)
        labs = page.evaluate("circuitLab.view.visiblePinLabels().map(l => l.pin)")
        mega_only = [l for l in labs if re.fullmatch(r'D(2[2-9]|[3-5]\d)|A([6-9]|1[0-5])', l)]
        check(f'{tag}: ปุ่มชื่อขาทั้งหมด → ป้ายชื่อขาของ Mega (มีขาที่มีเฉพาะ Mega เช่น D22–D53 — ป้ายที่ซ้อนกันถูกเว้นเป็นช่วง)', len(mega_only) >= 3, str(labs[:16]))
        page.screenshot(path=f'{OUT}/{tag}-mega-1-placed.png')
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')

        # 2) วงจร Mega + LED + เครื่องวิเคราะห์ลอจิก
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'mega-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'MEGA1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        pr = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'MEGA1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, flash: p.flash }; })()")
        info = page.inner_text('#f-uno-prog') if page.locator('#f-uno-prog').count() else ''
        sent_mega = any('"board":"mega"' in b for b in boards)
        check(f'{tag}: คอมไพล์ + อัปโหลด → ส่งคอมไพล์เป็นบอร์ด mega · แฟลช / 253,952 ไบต์ · RAM / 8,192 ไบต์', pr['hex'] and pr['fresh'] and 2000 < pr['flash'] < 6000 and '253,952' in info and '8,192' in info and sent_mega, f'{pr} {info[:90]!r} {sent_mega}')
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        feat = page.inner_text('#f-board-features') if page.locator('#f-board-features').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: ระดับการรองรับ "จำลองบางส่วน" + ตารางความสามารถ Mega 2560 (Serial1–3 บางส่วน)', 'จำลองบางส่วน' in st and 'ATmega2560' in (st + feat), st[:80].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-mega-2-props.png')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.unoConsole || '').includes('LED OFF')", timeout=60000, polling=300)
        except Exception: pass
        on = off = False; mx = 0
        t0 = time.time()
        while time.time() - t0 < 3:
            i = page.evaluate(LED)
            if i is not None: mx = max(mx, i); on = on or i > 0.01; off = off or i < 1e-5
            time.sleep(0.1)
        con = page.evaluate("circuitLab.unoConsole || ''")
        check(f'{tag}: Run → LED ที่ D13 ติด (~12.5 mA) / ดับ · Serial Monitor LED ON/OFF ไม่มีข้อความของ Serial1', on and off and 0.011 < mx < 0.0135 and 'LED ON' in con and 'MEGA S1' not in con, f'{on} {off} {mx} {con[-40:]!r}')
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.click('#dock-tab-la'); time.sleep(0.6)
        try: page.wait_for_function("(document.getElementById('la-m-1') || {}).textContent && /f 49\\d/.test(document.getElementById('la-m-1').textContent)", timeout=30000, polling=300)
        except Exception: pass
        m1 = page.inner_text('#la-m-1') if page.locator('#la-m-1').count() else ''
        m = re.search(r'f ([\d.]+) Hz · duty ([\d.]+)%', m1)
        check(f'{tag}: เครื่องวิเคราะห์ CH1 (MEGA1 D46 · Timer5) f ≈ 490 Hz duty ≈ 25%', m and abs(float(m.group(1)) - 490.2) < 2 and abs(float(m.group(2)) - 25.1) < 1, repr(m1))
        page.select_option('#la-dec-0', 'uart'); time.sleep(0.5)
        try: page.wait_for_function("/MEGA S1/.test((document.getElementById('la-t-0') || {}).textContent || '')", timeout=25000, polling=300)
        except Exception: pass
        t0x = page.inner_text('#la-t-0') if page.locator('#la-t-0').count() else ''
        m0 = page.inner_text('#la-m-0') if page.locator('#la-m-0').count() else ''
        check(f'{tag}: CH0 (D18 = TX1) ถอด UART ได้ "MEGA S1" · 9600 baud', 'MEGA S1' in t0x and '9600 baud' in m0, f'{t0x[-40:]!r} {m0!r}')
        page.screenshot(path=f'{OUT}/{tag}-mega-3-running.png')
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
