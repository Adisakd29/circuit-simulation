"""E2E แลป 46 Smart Watch บน Pico (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (OLED + DS3231 + GY-521 + ปุ่ม + มอเตอร์สั่น — ยังไม่ต่อ AD0) → Run → รันโค้ด
→ scan พบ 0x3c 0x57 0x68 (ไม่มี 0x69) · โปรแกรมหยุดด้วยข้อผิดพลาดชี้บรรทัดปลุก MPU6050 · แผงผลเตือนที่อยู่ซ้ำ
→ ต่อสาย AD0 → 3V3 ด้วยเครื่องมือต่อสาย → รันใหม่ → scan พบ 0x69 · จอแสดงเวลาตรงกับ DS3231
→ ตั้ง MPU6050 เป็น "เดิน" → จำนวนก้าวบนจอเพิ่มตามก้าวจริง · ครบ 10 ก้าว มอเตอร์สั่น (กระแส > 25 mA)
→ กดปุ่มค้างในแผงคุณสมบัติ → จอแสดงอุณหภูมิ → แลป 46 ผ่านครบ 5 ข้อ มีรูปวงจร
→ วาง ESP32-S2-DevKitM-1 จากคลังบนโต๊ะ → ป้าย "เฉพาะโมเดล" + คำเตือนในแผงคุณสมบัติ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/watch_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import WORLD_TO_SCREEN, close_drawers, props, tool, goals, tap_factory, screen_text, kv

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson46-watch-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

ERR = "(() => { const e = circuitLab.picoError; return e ? [e.kind, e.line, e.message] : null; })()"
DIAG = "(() => { const s = circuitLab.freshSim; return s ? s.analysis.diagnostics.map(d => d.message).join(' | ') : ''; })()"

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
        tap, tap_hole = tap_factory(page, mobile)
        # เปิดแลป 46 ก่อน (เป้าหมายถูกบันทึกระหว่างทดลองเมื่อเปิดแลปอยู่)
        goals(page, mobile, 'Smart Watch', 0, 1000)
        if mobile: close_drawers(page)
        # 1) รันโดยยังไม่ต่อ AD0
        page.click('#btn-run')
        page.wait_for_function("!!document.getElementById('pc-code') && circuitLab.mcu && circuitLab.mcu.booted", timeout=60000)
        code = page.evaluate("document.getElementById('pc-code').value").split('\n')
        wake = next(i + 1 for i, l in enumerate(code) if 'writeto_mem(MPU, 0x6B' in l)
        page.click('#pc-run')
        try: page.wait_for_function("circuitLab.picoError && circuitLab.picoError.kind === 'runtime'", timeout=90000, polling=300)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole"); e = page.evaluate(ERR)
        diag = page.evaluate(DIAG)
        check(f"{tag}: ไม่ต่อ AD0 → scan พบ ['0x3c', '0x57', '0x68'] · โปรแกรมหยุดที่บรรทัดปลุก MPU6050 ({wake}) · เตือนที่อยู่ซ้ำ",
              "I2C: ['0x3c', '0x57', '0x68']" in con and e and e[1] == wake and 'OSError' in e[2] and 'ซ้ำกับอุปกรณ์อื่น' in diag, f'{con[-70:]!r} {e} {diag[:120]!r}')
        page.screenshot(path=f'{OUT}/{tag}-watch-1-conflict.png')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        # 2) ต่อสาย AD0 (คอลัมน์ 44 แถว f) → ราง + ล่าง (bp44)
        page.evaluate("circuitLab.select(null)")
        tool(page, 'ต่อสาย (W)')
        tap_hole('f44', 18); tap_hole('bp44', 18)
        tool(page, 'เลือก / ย้าย (V)')
        last = page.evaluate("(() => { const w = circuitLab.doc.wires[circuitLab.doc.wires.length - 1]; return [w.a.hole, w.b.hole]; })()")
        check(f'{tag}: ต่อสาย AD0 (คอลัมน์ 44 แถว f–i) → ราง 3V3 (bp44) ด้วยเครื่องมือต่อสาย', last[0] in ('f44', 'g44', 'h44', 'i44') and last[1] == 'bp44', str(last))
        # 3) รันใหม่ → พบ 0x69 · เวลา
        if page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        n0 = len(page.evaluate("circuitLab.picoConsole"))
        page.click('#pc-run')
        try: page.wait_for_function(f"circuitLab.picoConsole.slice({n0}).includes('0x69')", timeout=90000, polling=300)
        except Exception: pass
        con = page.evaluate(f"circuitLab.picoConsole.slice({n0})")
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, 'OLED1')
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return dt && /\\d\\d:\\d\\d:\\d\\d/.test(dt.nextElementSibling.textContent); })()", timeout=40000, polling=300)
        except Exception: pass
        txt = screen_text(page)
        if mobile: close_drawers(page)
        props(page, mobile, 'RTC1'); rtc = kv(page, 'เวลาในชิปขณะนี้')
        if mobile: close_drawers(page)
        m1, m2 = re.search(r'(\d\d):(\d\d):(\d\d)', txt or ''), re.search(r'(\d\d):(\d\d):(\d\d)', rtc or '')
        diff = abs((int(m1[1]) * 3600 + int(m1[2]) * 60 + int(m1[3])) - (int(m2[1]) * 3600 + int(m2[2]) * 60 + int(m2[3]))) if m1 and m2 else 99
        check(f"{tag}: ต่อ AD0 แล้ว scan พบ ['0x3c', '0x57', '0x68', '0x69'] · จอแสดงเวลาตรงกับ DS3231 (± 2 s)", "['0x3c', '0x57', '0x68', '0x69']" in con and diff <= 2, f'{txt!r} vs {rtc!r} con={con[-160:]!r} err={page.evaluate(ERR)} log={page.evaluate("circuitLab.i2cLog.slice(-4)")}')
        # 4) เดิน → นับก้าว + สั่น
        props(page, mobile, 'IMU1')
        page.select_option('#f-motion', 'walk'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'OLED1')
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); const m = dt && /Steps (\\d+)/.exec(dt.nextElementSibling.textContent); return m && +m[1] >= 11; })()", timeout=90000, polling=300)
        except Exception: pass
        txt = screen_text(page)
        if mobile: close_drawers(page)
        steps = int(re.search(r'Steps (\d+)', txt)[1]) if re.search(r'Steps (\d+)', txt or '') else -1
        vib = page.evaluate("circuitLab.lessonPeak || 0")
        check(f'{tag}: ตั้ง MPU6050 เป็น "เดิน" → จำนวนก้าวบนจอเพิ่มถึง ≥ 11', steps >= 11, txt)
        page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'pin', partId: 'OLED1', pin: 'SCL'}}); v.controls.target.set(w.x - 0.5, 1, w.z + 5); v.persp.position.set(w.x - 0.5, 20, w.z + 20); v.controls.update(); v.requestRender(); }}""")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-watch-2-steps.png')
        # 5) กดปุ่มค้าง (แผงคุณสมบัติ) → หน้าอุณหภูมิ
        props(page, mobile, 'SW1')
        page.locator('#f-press').scroll_into_view_if_needed(); time.sleep(0.3)
        bb = page.locator('#f-press').bounding_box()
        x, y = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]})
        else: page.mouse.move(x, y); page.mouse.down()
        time.sleep(0.8)
        if mobile: cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else: page.mouse.up()
        time.sleep(0.3)
        if mobile: close_drawers(page)
        props(page, mobile, 'OLED1')
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return dt && dt.nextElementSibling.textContent.includes('Temp'); })()", timeout=20000, polling=200)
        except Exception: pass
        txt = screen_text(page)
        if mobile: close_drawers(page)
        check(f'{tag}: กดปุ่มค้างในแผงคุณสมบัติ → จอเปลี่ยนเป็นหน้าอุณหภูมิ "Temp 25 C"', 'Temp 25 C' in txt, txt)
        page.screenshot(path=f'{OUT}/{tag}-watch-3-temp.png')
        # 6) แลป 46
        g = goals(page, mobile, 'Smart Watch', 5, 60000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('MPU6050') && s.innerHTML.includes('DS3231'); })()")
        check(f'{tag}: แลป 46 ผ่านครบ 5 ข้อ (bus clock steps temp vibrate) และมีรูปวงจร', len(g) == 5 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-watch-4-lesson.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.4)
        # 7) ESP32-S2 เฉพาะโมเดล
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.fill('#lib-search', 'esp32-s2'); time.sleep(0.3)
        lab = page.inner_text('.lib-item[data-kind="esp32s2"] .nm')
        page.click('.lib-item[data-kind="esp32s2"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        # ให้จุดวางบนโต๊ะ (x −45, z 62 — ว่างหน้าบอร์ดด้านซ้าย) อยู่กลางจอ
        page.evaluate("() => { const v = circuitLab.view; v.controls.target.set(-45, 0, 62); v.persp.position.set(-45, 90, 130); v.controls.update(); v.requestRender(); }")
        time.sleep(1.2)
        s = page.evaluate(WORLD_TO_SCREEN, [-45, 0, 62]); tap(s['x'], s['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'esp32s2')", timeout=5000)
        except Exception: pass
        sid = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'esp32s2') || {}).id")
        warn = ''
        if sid:
            props(page, mobile, sid)
            warn = page.inner_text('#f-esp32s2-warn') if page.locator('#f-esp32s2-warn').count() else ''
            if mobile: close_drawers(page)
        check(f'{tag}: วาง ESP32-S2-DevKitM-1 จากคลัง (ป้าย "เฉพาะโมเดล") → แผงคุณสมบัติแจ้ง "ยังรันโค้ดไม่ได้"', sid and 'เฉพาะโมเดล' in lab and 'ยังรันโค้ดไม่ได้' in warn, f'{sid} {lab!r} {warn[:60]!r}')
        page.screenshot(path=f'{OUT}/{tag}-watch-5-esp32s2.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
