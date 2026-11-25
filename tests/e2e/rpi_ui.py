"""E2E แลป 54 Raspberry Pi 5 + gpiozero (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (Pi 5 บนโต๊ะ · LED แดง GPIO17 · LED เขียว GPIO18 · ปุ่ม GPIO27) → โมเดล 3D มีหัวต่อ 40 ขา
→ แลป 54 "ใส่โค้ดตัวอย่างลง Raspberry Pi" → Run → โหลด Python (Pyodide จาก /pyodide/ ของเว็บเอง) → เทอร์มินัล "พร้อม"
→ กดปุ่มค้างในฉาก → LED แดงติด + "กดปุ่มครั้งที่ 1" → ปล่อย → ดับ · กดค้างในแผงอีกครั้ง → LED เขียวหรี่ด้วย PWM (duty 50%)
→ แลป 54 ผ่าน 4 ข้อ มีรูปวงจร → หยุด → KeyboardInterrupt ขากลับเป็นขาเข้า LED ดับ → รันโค้ดที่ผิด → แถบข้อผิดพลาดบอกบรรทัด
ไม่มี JavaScript error · เบราว์เซอร์ที่ปิด JSPI → แจ้งข้อความชัดเจน
ใช้: python3 tests/e2e/rpi_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props, goals

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson54-rpi-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

LED = "(id) => Math.abs(((circuitLab.freshSim || {}).analysis || { parts: {} }).parts[id]?.current ?? 0)"
PLUNGER = """(id) => { const v = circuitLab.view; const g = v.partObjs.get(id); let m = null; g.traverse((o) => { if (o.userData.pushPlunger) m = o; });
  const w = m.getWorldPosition(v.camera.position.clone()); w.y += 0.15; v.camera.updateMatrixWorld(); const p = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""

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
        def con(): return page.evaluate('circuitLab.rpiConsole')
        def wait_con(s, timeout=20000):
            try: page.wait_for_function(f"circuitLab.rpiConsole.includes({s!r})", timeout=timeout, polling=200)
            except Exception: pass
            return s in con()
        def wait_led(id, on, timeout=20000):
            try: page.wait_for_function(f"(({LED})('{id}') {'>' if on else '<'} {2e-3 if on else 1e-4})", timeout=timeout, polling=200)
            except Exception: pass
            return page.evaluate(LED, id)
        def press_start(x, y):
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
            else: page.mouse.move(x, y); page.mouse.down()
        def press_end():
            if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else: page.mouse.up()

        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        pins = page.evaluate("(() => { const g = circuitLab.view.partObjs.get('RPI1'); let n = 0; g.traverse((o) => { if (o.userData.isPin) n++; }); return n; })()")
        check(f'{tag}: โมเดล Raspberry Pi 5 ในฉากมีหัวต่อ GPIO 40 ขาที่ต่อสายได้', pins == 40, str(pins))
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('RPI1'); const p = g.position; v.controls.target.set(p.x, 2, p.z); v.persp.position.set(p.x + 6, 38, p.z + 34); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-rpi-1-board.png')
        goals(page, mobile, 'Raspberry Pi 5', 0, 1000)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed()
        label = page.inner_text('#lesson-sample-code')
        page.click('#lesson-sample-code'); time.sleep(0.4)
        code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'RPI1').params.code")
        check(f'{tag}: ปุ่ม "{label.strip()}" ใส่โค้ดแลป 54 (gpiozero Button/PWMLED) ลงบอร์ด Pi', 'Raspberry Pi' in label and 'Button(27)' in code and 'PWMLED(18)' in code, code[:40])
        if mobile: close_drawers(page)
        t0 = time.time()
        page.click('#btn-run')
        ready = wait_con('พร้อม — กดปุ่มที่ GPIO27', 150000)
        st = page.evaluate("JSON.stringify(circuitLab.rpiStatus && circuitLab.rpiStatus.py)")
        check(f'{tag}: Run → โหลด Python (Pyodide จากเว็บเดียวกัน) แล้ว main.py พิมพ์ "พร้อม" ในเทอร์มินัล', ready, f'{time.time() - t0:.1f} s {st} {con()[-120:]!r}')
        # แท็บ Raspberry Pi ในแผงล่าง
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#dock-tab-rpi').count(): page.click('#dock-tab-rpi'); time.sleep(0.4)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        try: page.wait_for_function("document.getElementById('rp-console') && document.getElementById('rp-console').textContent.includes('พร้อม')", timeout=8000)
        except Exception: pass
        term = page.evaluate("(document.getElementById('rp-console') || {}).textContent || ''")
        status = page.evaluate("(document.getElementById('rp-status') || {}).textContent || ''")
        check(f'{tag}: แท็บ "Raspberry Pi 5 (Python)" มีตัวแก้ไข main.py เทอร์มินัล และสถานะ "กำลังทำงาน" · ระบุว่าจำลองระดับไลบรารี', 'พร้อม' in term and 'กำลังทำงาน' in status and 'ไม่ใช่ CPU/Linux' in page.inner_text('#rp-note'), f'{status!r}')
        page.screenshot(path=f'{OUT}/{tag}-rpi-2-terminal.png')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        # กดปุ่มค้างในฉาก
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('SW1'); const p = g.position; v.controls.target.set(p.x, 0, p.z); v.persp.position.set(p.x, 26, p.z + 12); v.controls.update(); v.requestRender(); }""")
        time.sleep(0.8)
        s = page.evaluate(PLUNGER, 'SW1')
        press_start(s['x'], s['y'])
        c1 = wait_con('กดปุ่มครั้งที่ 1', 15000); i_on = wait_led('LED1', True, 8000)
        press_end(); time.sleep(0.3)
        i_off = wait_led('LED1', False, 8000)
        check(f'{tag}: กดปุ่ม SW1 ค้างในฉาก → callback when_pressed: LED แดงติด + "กดปุ่มครั้งที่ 1" · ปล่อย → ดับ', c1 and i_on > 2e-3 and i_off < 1e-4, f'on={i_on:.4f} off={i_off:.5f} {con()[-80:]!r}')
        props(page, mobile, 'SW1')
        b = page.locator('#f-press'); b.scroll_into_view_if_needed(); bb = b.bounding_box()
        page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down()
        c2 = wait_con('กดปุ่มครั้งที่ 2', 15000); wait_led('LED1', True, 8000)
        page.mouse.up(); time.sleep(0.4); wait_led('LED1', False, 8000)
        if mobile: close_drawers(page)
        try: page.wait_for_function("(() => { const s = circuitLab.rpiStatus; return s && s.edges[18] >= 4 && Math.abs(s.duty[18] - 0.5) < 0.12; })()", timeout=10000, polling=200)
        except Exception: pass
        d = page.evaluate("circuitLab.rpiStatus ? circuitLab.rpiStatus.duty[18] : -1")
        i2 = page.evaluate(LED, 'LED2')
        check(f'{tag}: กดครั้งที่ 2 → PWMLED(18) value 0.5: duty ของ GPIO18 ≈ 50% และ LED เขียวมีกระแสเฉลี่ย (หรี่)', c2 and abs(d - 0.5) < 0.12 and 5e-4 < i2 < 3e-3, f'duty={d:.3f} i={i2:.4f}')
        g = goals(page, mobile, 'Raspberry Pi 5', 4, 30000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('Raspberry Pi 5') && s.innerHTML.includes('GPIO27'); })()")
        check(f'{tag}: แลป 54 ผ่านครบ 4 ข้อ (wire run follow pwm) และมีรูปวงจร', len(g) == 4 and svg_ok, f'{g} {svg_ok}')
        page.locator('#lesson-goals').scroll_into_view_if_needed(); time.sleep(0.3)
        page.screenshot(path=f'{OUT}/{tag}-rpi-3-lesson.png')
        if mobile: close_drawers(page)
        # หยุด → KeyboardInterrupt
        props(page, mobile, 'RPI1')
        page.locator('#f-rpi-stop').scroll_into_view_if_needed(); page.click('#f-rpi-stop')
        k = wait_con('KeyboardInterrupt', 15000)
        try: page.wait_for_function("circuitLab.rpiStatus && !circuitLab.rpiStatus.running", timeout=8000)
        except Exception: pass
        i2s = wait_led('LED2', False, 8000)
        pin18 = page.evaluate("circuitLab.rpiStatus ? circuitLab.rpiStatus.pins[18] : ''")
        check(f'{tag}: กด "หยุด (Ctrl-C)" → KeyboardInterrupt · gpiozero ปิดอุปกรณ์ GPIO18 กลับเป็นขาเข้า LED เขียวดับ', k and i2s < 1e-4 and pin18.startswith('in'), f'{pin18} {i2s:.5f}')
        # โค้ดผิด → แถบข้อผิดพลาด
        fld = page.locator('#f-rpi-code'); fld.scroll_into_view_if_needed()
        fld.fill('from gpiozero import LED\nled = LED(17)\nled.blink(on_tme=0.2)\n'); fld.evaluate('e => { e.dispatchEvent(new Event("change")); e.blur(); }'); time.sleep(0.5)
        page.locator('#f-rpi-run').scroll_into_view_if_needed(); page.click('#f-rpi-run')
        e = wait_con("unexpected keyword argument 'on_tme'", 15000)
        try: page.wait_for_selector('#f-rpi-err', timeout=8000)
        except Exception: pass
        err = page.evaluate("(document.getElementById('f-rpi-err') || {}).textContent || ''")
        dbg = page.evaluate("JSON.stringify([circuitLab.doc.parts.find(p => p.id === 'RPI1').params.code.slice(-30), circuitLab.rpiConsole.slice(-200), circuitLab.rpiError])")
        check(f'{tag}: โค้ดผิด (คีย์เวิร์ดสะกดผิด) → TypeError ในเทอร์มินัล + แถบข้อผิดพลาด "บรรทัด 3"', e and 'บรรทัด 3' in err and 'TypeError' in err, f'{err[:120]!r} {dbg}')
        if mobile: close_drawers(page)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

def no_jspi():
    """เบราว์เซอร์ที่ไม่มี JSPI (ปิดด้วยแฟล็ก V8): ต้องแจ้งชัดเจน ไม่ค้างเงียบ"""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--js-flags=--no-experimental-wasm-jspi', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.goto(URL); page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        # Chromium 157+ เปิด JSPI ถาวร แฟล็ก V8 ปิดไม่ได้แล้ว → สร้างสภาพ "ไม่มี JSPI" ไม่ได้ในเบราว์เซอร์นี้: ข้าม (ไม่นับว่าผ่าน)
        if page.evaluate("typeof WebAssembly.Suspending === 'function'"):
            print(f'SKIP desktop (ไม่มี JSPI): Chromium {browser.version} ปิด JSPI ด้วยแฟล็กไม่ได้ — ทดสอบกรณีนี้ไม่ได้ในเบราว์เซอร์นี้', flush=True)
            browser.close(); return
        page.evaluate('localStorage.clear()'); page.reload(); page.wait_for_function('window.circuitLab !== undefined', timeout=30000); time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.rpiConsole.includes('JSPI')", timeout=20000)
        except Exception: pass
        c = page.evaluate('circuitLab.rpiConsole')
        st = page.evaluate("JSON.stringify(circuitLab.rpiStatus && circuitLab.rpiStatus.py)")
        check('desktop (ไม่มี JSPI): แจ้งในเทอร์มินัลว่าเบราว์เซอร์ไม่รองรับ JSPI และรุ่นที่ใช้ได้ ไม่รันโค้ดแบบผิด ๆ', 'JSPI' in c and 'Chrome/Edge 137' in c and '"failed"' in st, f'{c[:120]!r} {st}')
        browser.close()

for m in MODES:
    run(m == 'mobile')
if 'desktop' in MODES: no_jspi()
print(f'{sum(results)}/{len(results)} passed')
