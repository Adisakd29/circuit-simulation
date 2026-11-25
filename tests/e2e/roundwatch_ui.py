"""E2E แลป 47 นาฬิกาจอกลม (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (Pico + จอกลม GC9A01/ทัช + DS3231 + QMI8658 + มอเตอร์สั่น) → เปิดแลป 47 → ปุ่ม "ใส่โค้ดตัวอย่างลง Pico" → Run
→ scan พบ 0x15 0x57 0x68 0x6a · จอในฉากแสดงรูป bg.bin + เวลาตรงกับ DS3231 (อ่านจากพิกเซลของจอที่จำลอง)
→ ลากนิ้ว/เมาส์บนจอในฉากไปทางซ้าย = ปัดซ้าย → ชิปทัชได้ท่าทาง 3 → จอเปลี่ยนเป็นหน้า STEPS
→ ปุ่ม "ปัดขวา" ในแผงจอ → กลับหน้าปัด · ตั้ง QMI8658 เป็น "เดิน" → จำนวนก้าวเพิ่ม · มอเตอร์สั่น → แลป 47 ผ่านครบ 7 ข้อ มีรูปวงจร
→ เปลี่ยนรูปพื้นหลัง (แผง Pico → ไฟล์ในบอร์ด) เป็นรูปแถบสี → บอร์ดเริ่มใหม่ → จอในฉากแสดงรูปใหม่
→ วางบอร์ด ESP32-S3 จอกลมจากคลัง → ป้าย "เฉพาะโมเดล" + คำเตือน · ไม่มี JavaScript error
ใช้: python3 tests/e2e/roundwatch_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import WORLD_TO_SCREEN, close_drawers, props, goals, tap_factory, kv

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures', 'lesson47-roundwatch-start.json')
PNG = os.path.join(HERE, 'fixtures', 'stripes-bg.png')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

# จุดกลางจอกลมในโลก 3 มิติ และพิกเซลของแคนวาสจอในฉาก (ภาพที่ผู้ใช้เห็น)
SCREEN_WORLD = """(() => { const g = circuitLab.view.partObjs.get('LCD1'); let s = null; g.traverse(o => { if (o.userData.touchScreen) s = o; });
  const w = s.getWorldPosition(s.position.clone()); return [w.x, w.y, w.z]; })()"""
SCENE_PX = """([x, y]) => { const c = circuitLab.view.partObjs.get('LCD1').userData.lcdCanvas; const d = c.getContext('2d').getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; }"""
LCD_TEXT = "(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent : ''; })()"
WAIT_TEXT = "(re) => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return !!dt && new RegExp(re).test(dt.nextElementSibling.textContent); }"

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
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        tap, _ = tap_factory(page, mobile)
        # 1) เปิดแลป 47 → ใส่โค้ดตัวอย่าง
        goals(page, mobile, 'นาฬิกาจอกลม', 0, 1000)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed()
        page.click('#lesson-sample-code'); time.sleep(0.4)
        code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.code")
        check(f'{tag}: ปุ่ม "ใส่โค้ดตัวอย่างลง Pico" ใส่โค้ดแลป 47 (import gc9a01py, SPI1, I2C1)', 'import gc9a01py' in code and 'SPI(1' in code and 'I2C(1' in code, f'{len(code)}')
        if mobile: close_drawers(page)
        # 2) Run (โค้ดรันอัตโนมัติหลังบูต)
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.picoConsole && circuitLab.picoConsole.includes('I2C:')", timeout=120000, polling=400)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole")
        check(f"{tag}: scan พบ ['0x15', '0x57', '0x68', '0x6a'] (ทัช, EEPROM, DS3231, QMI8658)", "I2C: ['0x15', '0x57', '0x68', '0x6a']" in con, con[-120:])
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, 'LCD1')
        try: page.wait_for_function(WAIT_TEXT, arg=r'\d\d:\d\d:\d\d', timeout=60000, polling=400)
        except Exception: pass
        txt = page.evaluate(LCD_TEXT)
        if mobile: close_drawers(page)
        props(page, mobile, 'RTC1'); rtc = kv(page, 'เวลาในชิปขณะนี้')
        if mobile: close_drawers(page)
        m1, m2 = re.search(r'(\d\d):(\d\d):(\d\d)', txt or ''), re.search(r'(\d\d):(\d\d):(\d\d)', rtc or '')
        diff = abs((int(m1[1]) * 3600 + int(m1[2]) * 60 + int(m1[3])) - (int(m2[1]) * 3600 + int(m2[2]) * 60 + int(m2[3]))) if m1 and m2 else 99
        # จอในฉาก: จุดบนรูปพื้นหลังเริ่มต้น (ท้องฟ้าด้านบนเป็นสีม่วงน้ำเงิน) — ไม่ใช่สีดำ
        sky = page.evaluate(SCENE_PX, [120, 40])
        check(f'{tag}: จอในฉากแสดงรูป bg.bin + เวลาตรงกับ DS3231 (± 2 s) — อ่านจากพิกเซลของจอที่จำลอง', diff <= 2 and sky[2] > 60 and sky[2] > sky[1], f'{txt!r} vs {rtc!r} sky={sky}')
        # 3) ลากบนจอในฉากไปทางซ้าย
        w = page.evaluate(SCREEN_WORLD)
        page.evaluate(f"() => {{ const v = circuitLab.view; v.controls.target.set({w[0]}, {w[1]}, {w[2]}); v.persp.position.set({w[0]}, {w[1]} + 26, {w[2]} + 14); v.controls.update(); v.requestRender(); }}")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-round-1-face.png')
        c = page.evaluate(WORLD_TO_SCREEN, [w[0], w[1], w[2]])
        a = page.evaluate(WORLD_TO_SCREEN, [w[0] + 5, w[1], w[2]])
        b = page.evaluate(WORLD_TO_SCREEN, [w[0] - 5, w[1], w[2]])
        pts = [(a['x'] + (b['x'] - a['x']) * k / 6, a['y'] + (b['y'] - a['y']) * k / 6) for k in range(7)]
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': pts[0][0], 'y': pts[0][1], 'id': 0}]})
            for x, y in pts[1:]: time.sleep(0.05); cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
            time.sleep(0.05); cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            page.mouse.move(*pts[0]); page.mouse.down()
            for x, y in pts[1:]: time.sleep(0.05); page.mouse.move(x, y)
            time.sleep(0.05); page.mouse.up()
        props(page, mobile, 'LCD1')
        try: page.wait_for_function(WAIT_TEXT, arg='STEPS', timeout=30000, polling=300)
        except Exception: pass
        txt = page.evaluate(LCD_TEXT)
        glog = page.evaluate("(circuitLab.freshSim.analysis.i2c['LCD1#tp'] || {}).gestureLog || []")
        moved = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'LCD1').placement.anchor")
        check(f'{tag}: ลากบนจอในฉากไปทางซ้าย → ทัชได้ท่าทาง "ปัดซ้าย" (3) → จอเปลี่ยนเป็นหน้า STEPS (จอไม่ถูกย้าย)', 3 in glog and 'STEPS' in txt and moved == 'j24', f'{glog} {txt!r} {moved}')
        if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-round-2-steps.png')
        # 4) ปุ่ม "ปัดขวา →" ในแผงจอ → กลับหน้าปัด
        props(page, mobile, 'LCD1')
        page.locator('#f-swipe-right').scroll_into_view_if_needed()
        page.click('#f-swipe-right')
        try: page.wait_for_function(WAIT_TEXT, arg=r'\d\d:\d\d:\d\d', timeout=30000, polling=300)
        except Exception: pass
        txt = page.evaluate(LCD_TEXT)
        check(f'{tag}: ปุ่ม "ปัดขวา →" ในแผงจอ → กลับหน้าปัด (เวลา)', re.search(r'\d\d:\d\d:\d\d', txt or '') is not None, txt)
        if mobile: close_drawers(page)
        # 5) เดิน → ก้าว + สั่น → แลป 47
        props(page, mobile, 'IMU1')
        page.select_option('#f-motion', 'walk'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'LCD1')
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); const m = dt && /Steps (\\d+)/.exec(dt.nextElementSibling.textContent); return m && +m[1] >= 11; })()", timeout=120000, polling=400)
        except Exception: pass
        txt = page.evaluate(LCD_TEXT)
        if mobile: close_drawers(page)
        steps = int(re.search(r'Steps (\d+)', txt)[1]) if re.search(r'Steps (\d+)', txt or '') else -1
        check(f'{tag}: ตั้ง QMI8658 เป็น "เดิน" → จำนวนก้าวบนหน้าปัดเพิ่มถึง ≥ 11', steps >= 11, txt)
        g = goals(page, mobile, 'นาฬิกาจอกลม', 7, 90000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('GC9A01') && s.innerHTML.includes('QMI8658'); })()")
        check(f'{tag}: แลป 47 ผ่านครบ 7 ข้อ (wire bus image clock swipe steps vibrate) และมีรูปวงจร', len(g) == 7 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-round-3-lesson.png')
        if mobile: close_drawers(page)
        # 6) เปลี่ยนรูปพื้นหลัง (Pico → ไฟล์ในบอร์ด)
        props(page, mobile, 'PICO1')
        page.evaluate("document.getElementById('f-files').open = true"); time.sleep(0.2)
        page.set_input_files('#f-bg-file', PNG)
        try: page.wait_for_function("!!circuitLab.doc.parts.find(p => p.id === 'PICO1').params.bg", timeout=10000)
        except Exception: pass
        bgname = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.bgName || ''")
        if mobile: close_drawers(page)
        # บอร์ดเริ่มใหม่ → รันโค้ดอัตโนมัติ → วาดรูปใหม่: จุด (30, 150) = แถบแรกของรูปที่ตัดกลาง (เขียว), (100, 200) = แถบที่ 4 (เหลือง)
        # รอจนวาดถึงแถว 200 (วาดรูปจากบนลงล่างทีละ 20 แถว)
        try: page.wait_for_function(f"(() => {{ const p = ({SCENE_PX})([30, 150]), q = ({SCENE_PX})([100, 200]); return p[1] > 200 && p[0] < 60 && p[2] < 60 && q[0] > 200 && q[1] > 200 && q[2] < 60; }})()", timeout=90000, polling=500)
        except Exception: pass
        p1, p2 = page.evaluate(SCENE_PX, [30, 150]), page.evaluate(SCENE_PX, [100, 200])
        check(f'{tag}: เปลี่ยนรูปพื้นหลังเป็น {bgname} → บอร์ดเริ่มใหม่และจอในฉากแสดงรูปแถบสี', bgname == 'stripes-bg.png' and p1[1] > 200 and p1[0] < 60 and p2[0] > 200 and p2[1] > 200 and p2[2] < 60, f'{p1} {p2}')
        page.evaluate(f"() => {{ const v = circuitLab.view; v.controls.target.set({w[0]}, {w[1]}, {w[2]}); v.persp.position.set({w[0]}, {w[1]} + 26, {w[2]} + 14); v.controls.update(); v.requestRender(); }}")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-round-4-custombg.png')
        page.click('#btn-stop'); time.sleep(0.4)
        # 7) บอร์ด ESP32-S3 จอกลม (เฉพาะโมเดล)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.fill('#lib-search', 'esp32-s3'); time.sleep(0.3)
        lab = page.inner_text('.lib-item[data-kind="esp32s3lcd"] .nm')
        page.click('.lib-item[data-kind="esp32s3lcd"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        page.evaluate("() => { const v = circuitLab.view; v.controls.target.set(-45, 0, 62); v.persp.position.set(-45, 90, 130); v.controls.update(); v.requestRender(); }")
        time.sleep(1.2)
        s = page.evaluate(WORLD_TO_SCREEN, [-45, 0, 62]); tap(s['x'], s['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'esp32s3lcd')", timeout=5000)
        except Exception: pass
        sid = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'esp32s3lcd') || {}).id")
        warn = ''
        if sid:
            props(page, mobile, sid)
            warn = page.inner_text('#f-esp32s3-warn') if page.locator('#f-esp32s3-warn').count() else ''
            if mobile: close_drawers(page)
            page.evaluate(f"""() => {{ const v = circuitLab.view; const g = v.partObjs.get('{sid}'); const p = g.position; v.controls.target.set(p.x, 0, p.z); v.persp.position.set(p.x, 30, p.z + 26); v.controls.update(); v.requestRender(); }}""")
            time.sleep(1.0)
        check(f'{tag}: วางบอร์ด ESP32-S3 จอกลมจากคลัง (ป้าย "เฉพาะโมเดล") → แผงคุณสมบัติแจ้ง "ยังรันโค้ดไม่ได้"', sid and 'เฉพาะโมเดล' in lab and 'ยังรันโค้ดไม่ได้' in warn, f'{sid} {lab!r} {warn[:60]!r}')
        page.screenshot(path=f'{OUT}/{tag}-round-5-esp32s3.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
