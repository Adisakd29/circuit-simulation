"""E2E ชุดแรก Pico ครบกระบวนการ (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch):
เปิดวงจรเริ่มต้นแลป 42 (Pico + VR → GP26 + R1 → GP15 ยังไม่มี LED, โค้ดมีที่ผิด) → วาง LED จากคลังที่ c29 → ต่อสายด้วยเครื่องมือต่อสาย (e30 → GND)
→ Run (บูตบอร์ด) → "ตรวจโค้ด (Compile)" → แถบแดงชี้บรรทัด 6 + เลขบรรทัดแดง → แตะแถบ → เลือกบรรทัด 6 → แก้โค้ด → Compile ผ่าน
→ รันโค้ด → Serial Monitor พิมพ์ ADC ≈ 32768 (VR 50%) LED ≈ 2.4 mA → หมุน VR 80% → ADC/LED เปลี่ยนตาม
→ เปลี่ยนโค้ด ADC(15) → ข้อผิดพลาดขณะรันชี้บรรทัด 3 → แก้กลับ → วางโพรบด้วยเครื่องมือ → แลป 42 ครบ 5 ข้อ มีรูปวงจร
→ แผงระดับการรองรับ · ป้ายขา GP15 แสดง PWM7B → Save → New → Open → โค้ด/วงจรเดิม รันได้ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/adcpwm_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson42-adcpwm-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def toggle(page, mobile, sw):
    open_props(page, mobile, sw)
    page.click('#props .btn-row button'); time.sleep(0.3)
    if mobile: close_drawers(page)

GOOD = """from machine import ADC, Pin, PWM
import time
pot = ADC(26)
led = PWM(Pin(15))
led.freq(1000)
while True:
    v = pot.read_u16()
    led.duty_u16(v)
    print("ADC =", v, " V =", round(v * 3.3 / 65535, 2))
    time.sleep(0.2)
"""
LAST = """(() => { const m = [...(circuitLab.picoConsole || '').matchAll(/ADC = (\\d+) {2}V = ([\\d.]+)/g)]; return m.length ? Number(m[m.length - 1][1]) : null; })()"""
LED = "(() => { const s = circuitLab.freshSim; const l = circuitLab.doc.parts.find(p => p.kind === 'led'); return s && l && s.analysis.parts[l.id] ? s.analysis.parts[l.id].current : null; })()"

def tool(page, label):
    for k in range(4):
        try:
            page.click(f'.tool[aria-label="{label}"]', timeout=3000); return
        except Exception:
            time.sleep(0.4)
    page.click(f'.tool[aria-label="{label}"]')
ERR = "(() => { const e = circuitLab.picoError; return e ? [e.kind, e.line, e.message] : null; })()"

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def goals(page, mobile, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("หรี่ไฟ LED")').count(): page.click('.lesson-card:has-text("หรี่ไฟ LED")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

def set_code(page, code):
    page.fill('#pc-code', code); page.dispatch_event('#pc-code', 'change'); time.sleep(0.2)

def wait_adc(page, lo, hi, n0=0, timeout=60000):
    try: page.wait_for_function(f"(() => {{ const m = [...(circuitLab.picoConsole || '').slice({n0}).matchAll(/ADC = (\\d+) {{2}}V/g)]; const v = m.length ? Number(m[m.length - 1][1]) : -1; return v >= {lo} && v <= {hi}; }})()", timeout=timeout, polling=300)
    except Exception: pass
    return page.evaluate(LAST)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1, accept_downloads=True)
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
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.2)
        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y'])
        H = lambda hole: {'kind': 'hole', 'boardId': 'bb1', 'hole': hole}
        # 1) วางอุปกรณ์จากคลัง
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        sup = page.inner_text('.lib-item[data-kind="led"] .nm')
        page.click('.lib-item[data-kind="led"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'c29', 18)
        tap_ref(H('c29'))
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'led')", timeout=5000)
        except Exception: pass
        led = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'led') || {}).placement")
        check(f'{tag}: วาง LED จากคลังที่ c29 (ป้ายในคลัง "จำลองครบ")', led and led.get('anchor') == 'c29' and 'จำลองครบ' in sup, f'{led} {sup}')
        # 2) ต่อสายด้วยเครื่องมือ
        page.evaluate("circuitLab.select(null)")
        tool(page, 'ต่อสาย (W)')
        focus(page, 'e30', 14); tap_ref(H('e30'))
        focus(page, 'b3', 14); tap_ref(H('b3'))
        tool(page, 'เลือก / ย้าย (V)')
        nw = page.evaluate("circuitLab.doc.wires.length")
        nwire = page.evaluate("JSON.stringify(circuitLab.doc.wires[circuitLab.doc.wires.length - 1])")
        check(f'{tag}: ต่อสาย LED (e30) → GND (b3) ด้วยเครื่องมือต่อสาย', nw == 5 and '"e30"' in nwire and '"b3"' in nwire, f'{nw} {nwire}')
        lid = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'led').id")
        # 3) Run → Compile (โค้ดมีที่ผิด)
        page.click('#btn-run')
        page.wait_for_function("!!document.getElementById('pc-code') && circuitLab.mcu && circuitLab.mcu.booted", timeout=60000)
        page.click('#pc-compile')
        try: page.wait_for_function("circuitLab.picoError && circuitLab.picoError.kind === 'compile'", timeout=60000, polling=300)
        except Exception: pass
        e = page.evaluate(ERR)
        bar = page.inner_text('#pc-err') if page.locator('#pc-err').is_visible() else ''
        red = page.evaluate("(() => { const s = document.querySelector('#pc-gutter .err'); return s ? s.textContent.trim() : null; })()")
        mark = page.evaluate("!document.getElementById('pc-errline').hidden")
        check(f'{tag}: Compile โค้ดที่ลืม ":" → SyntaxError ชี้บรรทัด 6 (แถบแดง + เลขบรรทัดแดง + แถบไฮไลต์)', e == ['compile', 6, 'SyntaxError: invalid syntax'] and 'บรรทัด 6' in bar and red == '6' and mark, f'{e} {bar!r} {red} {mark}')
        page.click('#pc-err'); time.sleep(0.2)
        sel = page.evaluate("(() => { const t = document.getElementById('pc-code'); return t.value.slice(t.selectionStart, t.selectionEnd); })()")
        check(f'{tag}: แตะแถบข้อผิดพลาด → เลือกบรรทัด 6 ในตัวแก้ไข', sel == 'while True', repr(sel))
        page.screenshot(path=f'{OUT}/{tag}-adc-1-compile-error.png')
        set_code(page, GOOD)
        page.click('#pc-compile')
        try: page.wait_for_function("circuitLab.picoCompiled && circuitLab.picoCompiled.ok && !circuitLab.picoError", timeout=60000, polling=300)
        except Exception: pass
        ok = page.evaluate("!!(circuitLab.picoCompiled && circuitLab.picoCompiled.ok) && !circuitLab.picoError") and 'คอมไพล์ผ่าน: 11 บรรทัด' in page.evaluate("circuitLab.picoConsole") and not page.locator('#pc-err').is_visible()
        check(f'{tag}: แก้โค้ดแล้ว Compile ผ่าน (ข้อความจาก MicroPython บนบอร์ด, แถบแดงหาย)', ok, page.evaluate("circuitLab.picoConsole.slice(-90)"))
        # 4) รันโค้ด → เห็นผล
        page.click('#pc-run')
        a = wait_adc(page, 31000, 34500)
        try: page.wait_for_function(f"(() => {{ const i = {LED}; return i !== null && i > 2e-3 && i < 2.9e-3; }})()", timeout=30000, polling=300)
        except Exception: pass
        i50 = page.evaluate(LED)
        check(f'{tag}: รันโค้ด → Serial Monitor พิมพ์ ADC ≈ 32768 (VR 50%) และ LED หรี่ ≈ 2.4 mA (PWM)', a is not None and 31000 <= a <= 34500 and i50 and 2e-3 < i50 < 2.9e-3, f'{a} {i50} {page.evaluate("circuitLab.picoConsole.slice(-120)")!r}')
        # 5) เปลี่ยนวงจร → ผลเปลี่ยนตาม
        props(page, mobile, 'VR1')
        page.evaluate("(() => { const s = document.getElementById('f-pos'); s.value = String(s.max === '1000' ? 800 : 80); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.3)
        pos = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'VR1').params.position")
        if mobile: close_drawers(page)
        n0 = page.evaluate("circuitLab.picoConsole.length")
        a = wait_adc(page, int(pos * 65535) - 1500, int(pos * 65535) + 1500, n0)
        try: page.wait_for_function(f"(() => {{ const i = {LED}; return i !== null && i > {i50} * {pos} / 0.5 * 0.9; }})()", timeout=30000, polling=300)
        except Exception: pass
        i80 = page.evaluate(LED)
        check(f'{tag}: หมุน VR ในแผงคุณสมบัติ → ADC และความสว่าง LED เปลี่ยนตาม (กระแสแปรตามตำแหน่ง)', a is not None and abs(a / 65535 - pos) < 0.025 and i80 and abs(i80 / i50 - pos / 0.5) < 0.12, f'pos={pos} adc={a} i={i80} ratio={(i80 / i50) if (i80 and i50) else None}')
        # 6) เปลี่ยนโค้ด → ข้อผิดพลาดขณะรันชี้บรรทัด
        set_code(page, GOOD.replace('ADC(26)', 'ADC(15)'))
        page.click('#pc-run')
        try: page.wait_for_function("circuitLab.picoError && circuitLab.picoError.kind === 'runtime'", timeout=60000, polling=300)
        except Exception: pass
        e = page.evaluate(ERR)
        check(f'{tag}: ADC(15) → ข้อผิดพลาดขณะรันชี้บรรทัด 3 (ValueError จากเฟิร์มแวร์)', e == ['runtime', 3, "ValueError: Pin doesn't have ADC capabilities"] and 'บรรทัด 3' in page.inner_text('#pc-err'), str(e))
        set_code(page, GOOD); page.click('#pc-run')
        # 7) โพรบ + แลป
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)  # แผงโค้ดลอยทับกลางฉาก — ซ่อนก่อนแตะรู
        focus(page, 'g23', 14); tool(page, 'โพรบแดง (+)'); tap_ref(H('g23'))
        focus(page, 'b3', 14); tool(page, 'โพรบดำ (COM)'); tap_ref(H('b3'))
        pr = page.evaluate("JSON.stringify(circuitLab.doc.probes)")
        tool(page, 'เลือก / ย้าย (V)')
        props(page, mobile, 'VR1')
        page.evaluate("(() => { const s = document.getElementById('f-pos'); s.value = String(s.max === '1000' ? 200 : 20); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.3)
        if mobile: close_drawers(page)
        g = goals(page, mobile, 4)
        if mobile: close_drawers(page)
        props(page, mobile, 'VR1')
        page.evaluate("(() => { const s = document.getElementById('f-pos'); s.value = String(s.max === '1000' ? 800 : 80); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); })()"); time.sleep(0.3)
        if mobile: close_drawers(page)
        g = goals(page, mobile, 5, 60000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('VR1') && s.innerHTML.includes('GP26'); })()")
        check(f'{tag}: วางโพรบด้วยเครื่องมือ + หมุน VR 20% → 80% → แลป 42 ผ่านครบ 5 ข้อ มีรูปวงจร', len(g) == 5 and svg_ok, f'{g} {svg_ok} {pr}')
        page.screenshot(path=f'{OUT}/{tag}-adc-2-lesson.png')
        if mobile: close_drawers(page)
        # 8) ระดับการรองรับ + ป้ายขา
        props(page, mobile, 'PICO1')
        st = page.inner_text('#f-support')
        if mobile: close_drawers(page)
        check(f'{tag}: แผงคุณสมบัติ Pico แสดงระดับการรองรับและข้อจำกัด (I²C/SPI ยังไม่ต่อวงจร)', 'จำลองบางส่วน' in st and 'I²C' in st, st[:120].replace('\n', ' | '))
        page.click('#btn-stop'); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'PICO1', pin: 'GP15'}); v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 9, w.z + 9); v.controls.update(); v.requestRender(); }""")
        cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'PICO1', 'pin': 'GP15'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: ป้ายขา GP15 แสดงหมายเลขขาและหน้าที่พิเศษ (PWM7B · I2C1 SCL · SPI1 TX)', t is not None and 'ขา 20 GP15' in t and 'PWM7B' in t and 'SPI1 TX' in t, str(t))
        if not mobile: page.mouse.move(5, 450)
        # 9) Save → New → Open
        def menu_click(sel):
            if mobile: page.click('#btn-more'); time.sleep(0.2)
            page.click(sel)
        menu_click('#btn-save'); time.sleep(0.2)
        with page.expect_download() as dl:
            page.click('#save-download')
        path = f'{OUT}/{tag}-adc-saved.json'
        dl.value.save_as(path)
        page.click('dialog .btn:has-text("ปิด")')
        menu_click('#btn-new'); time.sleep(0.2)
        page.click('dialog .btn.primary'); time.sleep(0.3)
        empty = page.evaluate('circuitLab.doc.parts.length') == 0
        page.set_input_files('#file-input', path); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        same = page.evaluate(f"(() => {{ const d = circuitLab.doc; const pc = d.parts.find(p => p.kind === 'pico'); return d.parts.length === 4 && d.wires.length === 5 && pc.params.code.includes('led.duty_u16(v)') && !pc.params.code.includes('ADC(15)') && d.parts.some(p => p.id === '{lid}'); }})()")
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.mcu && circuitLab.mcu.booted", timeout=60000)
        except Exception: pass
        if page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.4)
        page.click('#pc-run')
        a = wait_adc(page, int(0.8 * 65535) - 1500, int(0.8 * 65535) + 1500)
        check(f'{tag}: Save → New → Open ได้วงจร/โค้ดเดิม และรันได้ผลเดิม (ADC ≈ 52428)', empty and same and a is not None and abs(a - 52428) < 1500, f'{empty} {same} {a}')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
