"""E2E แลป 52 ปุ่มกดดึงขึ้น/ดึงลง และแลป 53 ระบบกันขโมย (PIR + FC-51 + DHT11) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
แลป 52: เปิดวงจรเริ่มต้น → โค้ดตัวอย่าง → Run → กด SW1 ค้างที่ก้านปุ่มในฉาก (เมาส์ / นิ้ว) → Serial "SW1 = 1" + LED1 ติดระหว่างกด → ปล่อย → ดับ
  → กด SW2 ค้างในแผง → "SW2 = 0" → ผ่าน 3 ข้อ มีรูปวงจร → ลบตัวต้านทานดึงลง → กด/ปล่อย SW1 → คำเตือนขาลอย GP14 + LED1 ค้าง
แลป 53: เปิดวงจรเริ่มต้น → โค้ดตัวอย่าง → Run → Serial "T=28 C H=60 %" (DHT11) → PIR "มีคนเดินผ่าน 1 วินาที" → LED แดงติด แล้วดับเองหลังเวลาหน่วง
  → FC-51 วัตถุ 3 cm → LED เหลือง + LED บนโมดูลในฉาก → ไม่มีวัตถุ → ดับ → ผ่าน 5 ข้อ มีรูปวงจร · ไม่มี JavaScript error
ใช้: python3 tests/e2e/sensor_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props, goals

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

LED = "(id) => Math.abs(((circuitLab.freshSim || {}).analysis || { parts: {} }).parts[id]?.current ?? 0)"
DIAG = "(() => { const s = circuitLab.freshSim; return s ? s.analysis.diagnostics.map(d => d.severity + ':' + d.message).join(' | ') : ''; })()"
PLUNGER = """(id) => { const v = circuitLab.view; const g = v.partObjs.get(id); let m = null; g.traverse((o) => { if (o.userData.pushPlunger) m = o; });
  const w = m.getWorldPosition(v.camera.position.clone()); w.y += 0.15; v.camera.updateMatrixWorld(); const p = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""

def boot(page, fixture):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    page.set_input_files('#file-input', os.path.join(FIX, fixture)); time.sleep(1.2)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if mobile else None
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        def con(): return page.evaluate('circuitLab.picoConsole')
        def wait_con(s, timeout=20000):
            try: page.wait_for_function(f"circuitLab.picoConsole.includes({s!r})", timeout=timeout, polling=200)
            except Exception: pass
            return s in con()
        def wait_led(id, on, timeout=20000):
            try: page.wait_for_function(f"(({LED})('{id}') {'>' if on else '<'} {2e-3 if on else 1e-4})", timeout=timeout, polling=200)
            except Exception: pass
            return page.evaluate(LED, id)
        def sample_code(card, needle):
            goals(page, mobile, card, 0, 1000)
            page.locator('#lesson-sample-code').scroll_into_view_if_needed()
            page.click('#lesson-sample-code'); time.sleep(0.4)
            code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.code")
            if mobile: close_drawers(page)
            page.click('#btn-run')
            return needle in code
        def press_start(x, y):
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
            else: page.mouse.move(x, y); page.mouse.down()
        def press_end():
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else: page.mouse.up()

        # ================= แลป 52 =================
        boot(page, 'lesson52-pulldown-start.json')
        ok = sample_code('ตัวต้านทานดึงขึ้นและดึงลง', 'Pin.PULL_UP')
        c0 = wait_con('SW1 = 0  SW2 = 1', 90000)
        check(f'{tag}: แลป 52 โค้ดตัวอย่างรัน อ่านได้ SW1 = 0 (ดึงลง) SW2 = 1 (ดึงขึ้น) ตอนปล่อย', ok and c0, con()[-80:])
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('SW1'); const p = g.position; v.controls.target.set(p.x, 0, p.z); v.persp.position.set(p.x, 26, p.z + 12); v.controls.update(); v.requestRender(); }""")
        time.sleep(0.8)
        s = page.evaluate(PLUNGER, 'SW1')
        press_start(s['x'], s['y'])
        on = wait_con('SW1 = 1', 10000)
        i_on = wait_led('LED1', True, 8000)
        page.screenshot(path=f'{OUT}/{tag}-sensor-1-button.png')
        press_end()
        i_off = wait_led('LED1', False, 20000)  # การจำลองในเบราว์เซอร์ไม่มี GPU เดินช้ากว่าเวลาจริง — เผื่อเวลารอ (รอบ 87)
        dbg = page.evaluate("JSON.stringify([circuitLab.doc.parts.find(p => p.id === 'SW1').params.pressed, circuitLab.picoConsole.slice(-160)])")
        check(f'{tag}: กดค้างที่ก้าน SW1 ในฉาก → Serial "SW1 = 1" และ LED1 ติด · ปล่อย → LED1 ดับ', on and i_on > 2e-3 and i_off < 1e-4, f'on={i_on:.4f} off={i_off:.5f} {dbg}')
        props(page, mobile, 'SW2')
        b = page.locator('#f-press'); b.scroll_into_view_if_needed(); bb = b.bounding_box()
        page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down()
        on2 = wait_con('SW2 = 0', 10000); i2 = wait_led('LED2', True, 8000)
        page.mouse.up(); time.sleep(0.4)
        i2off = wait_led('LED2', False, 20000)
        check(f'{tag}: กดค้าง SW2 ในแผง → "SW2 = 0" และ LED2 ติด · ปล่อยแล้วดับ', on2 and i2 > 2e-3 and i2off < 1e-4, f'{i2:.4f} {i2off:.5f}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'ตัวต้านทานดึงขึ้นและดึงลง', 3, 30000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('SW1') && s.innerHTML.includes('10 kΩ'); })()")
        check(f'{tag}: แลป 52 ผ่านครบ 3 ข้อ (wire pulldown pullup) และมีรูปวงจร', len(g) == 3 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-sensor-2-lab52.png')
        if mobile: close_drawers(page)
        # ลบตัวต้านทานดึงลง → ขาลอย
        page.evaluate("circuitLab.select({t: 'part', id: 'RPD'})"); time.sleep(0.3)
        page.keyboard.press('Delete'); time.sleep(0.8)
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('SW1'); const p = g.position; v.controls.target.set(p.x, 0, p.z); v.persp.position.set(p.x, 26, p.z + 12); v.controls.update(); v.requestRender(); }""")
        time.sleep(0.8)
        s = page.evaluate(PLUNGER, 'SW1'); press_start(s['x'], s['y']); time.sleep(0.8); press_end()
        try: page.wait_for_function(f"{DIAG}.includes('GP14') && {DIAG}.includes('ลอย')", timeout=10000, polling=300)
        except Exception: pass
        diag = page.evaluate(DIAG)
        stuck = page.evaluate(LED, 'LED1')
        check(f'{tag}: ลบตัวต้านทานดึงลงแล้วกด/ปล่อย SW1 → คำเตือน "ขาเข้า GP14 ลอย" และ LED1 ค้าง', 'GP14' in diag and 'ลอย' in diag and stuck > 2e-3, f'{stuck:.4f} {diag[:140]!r}')
        page.click('#btn-stop'); time.sleep(0.5)

        # ================= แลป 53 =================
        boot(page, 'lesson53-alarm-start.json')
        ok = sample_code('ระบบกันขโมย', 'dht.DHT11')
        th = wait_con('T=28 C  H=60 %', 120000)
        check(f'{tag}: แลป 53 โค้ดตัวอย่างรัน · DHT11 ส่ง T=28 C H=60 %', ok and th, con()[-80:])
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, 'PIR1')
        page.locator('#f-walk').scroll_into_view_if_needed(); page.click('#f-walk')
        ia = wait_led('LEDA', True, 15000)
        mot = wait_con('MOTION!', 5000)
        time.sleep(2.0)
        still = page.evaluate(LED, 'LEDA')
        motion_now = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PIR1').params.motion")
        check(f'{tag}: "มีคนเดินผ่าน 1 วินาที" → MOTION! + LED แดงติด · คนเดินพ้นแล้ว LED ยังติดค้าง (เวลาหน่วง)', mot and ia > 2e-3 and still > 2e-3 and motion_now is False, f'{ia:.4f} {still:.4f} motion={motion_now}')
        off = wait_led('LEDA', False, 60000)
        check(f'{tag}: LED แดงดับเองหลังครบเวลาหน่วง 5 s', off < 1e-4, f'{off:.5f}')
        if mobile: close_drawers(page)
        props(page, mobile, 'IR1')
        page.locator('#f-obs-3').scroll_into_view_if_needed(); page.click('#f-obs-3')
        idd = wait_led('LEDD', True, 15000)
        if mobile: close_drawers(page)
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('IR1'); const p = g.position; v.controls.target.set(p.x - 4, 4, p.z + 6); v.persp.position.set(p.x + 6, 30, p.z + 62); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        glow = page.evaluate("circuitLab.view.partObjs.get('IR1').userData.obsLed.emissiveIntensity")
        page.screenshot(path=f'{OUT}/{tag}-sensor-3-alarm.png')
        props(page, mobile, 'IR1')
        page.locator('#f-obs-none').scroll_into_view_if_needed(); page.click('#f-obs-none')
        idoff = wait_led('LEDD', False, 15000)
        check(f'{tag}: FC-51 วัตถุ 3 cm → LED เหลืองติด + LED บนโมดูลในฉากเรือง · ไม่มีวัตถุ → ดับ', idd > 2e-3 and glow > 0 and idoff < 1e-4, f'{idd:.4f} glow={glow} {idoff:.5f}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'ระบบกันขโมย', 5, 30000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('HC-SR501') && s.innerHTML.includes('DHT11'); })()")
        check(f'{tag}: แลป 53 ผ่านครบ 5 ข้อ (wire motion hold obstacle climate) และมีรูปวงจร', len(g) == 5 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-sensor-4-lab53.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
