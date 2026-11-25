"""E2E แลป 50 กุญแจรหัสผ่าน (ปุ่ม 4×4) และแลป 51 ตัวนับ (rotary encoder + จอยสติ๊ก) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
แลป 50: เปิดวงจรเริ่มต้น → โค้ดตัวอย่าง → Run → กดปุ่ม 2 ในฉาก (เมาส์ / นิ้วแตะค้าง) → 5 8 0 จากแผงคุณสมบัติ → # (แป้นพิมพ์บนเดสก์ท็อป)
  → Serial OPEN + LED เขียวติด + จอ "2580" ระหว่างพิมพ์ → * 1 1 1 1 # → WRONG + LED แดง → ผ่าน 4 ข้อ มีรูปวงจร
แลป 51: เปิดวงจรเริ่มต้น → โค้ดตัวอย่าง → Run → หมุนตามเข็ม 5 คลิก → จอ 5 · ทวนเข็ม 2 → 3 · ลูกบิดในฉากหมุนตาม
  → ดันก้านขึ้นสุด → ค่าเพิ่มทีละ 10 → กลาง → กดลูกบิดค้าง → 0 · ลากก้านในวงกลม → x ขวาสุด → ผ่าน 5 ข้อ มีรูปวงจร · ไม่มี JavaScript error
ใช้: python3 tests/e2e/input_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props, goals, kv

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SEG = "(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ตัวเลขบนจอ')); return dt ? dt.nextElementSibling.textContent : ''; })()"
TXT = "(() => { const s = circuitLab.freshSim && circuitLab.freshSim.analysis.seg && circuitLab.freshSim.analysis.seg.DS1; if (!s || !s.on) return ''; const M = {63:'0',6:'1',91:'2',79:'3',102:'4',109:'5',125:'6',7:'7',127:'8',111:'9',64:'-',0:' '}; return s.ram.slice(0, 4).map(b => M[b & 127] ?? '?').join(''); })()"
KEY_POS = """(k) => { const v = circuitLab.view; const g = v.partObjs.get('KP1'); let m = null; g.traverse((o) => { if (o.isMesh && o.userData.keypadKey === k && !o.userData.decal) m = o; });
  const w = m.getWorldPosition(v.camera.position.clone()); v.camera.updateMatrixWorld(); const p = w.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""

def boot(page, fixture, card):
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

        def hold_xy(x, y, ms=350):
            if mobile:
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 0}]}); time.sleep(ms / 1000)
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            else:
                page.mouse.move(x, y); page.mouse.down(); time.sleep(ms / 1000); page.mouse.up()
            time.sleep(0.35)

        def hold(sel, ms=350):
            el = page.locator(sel); el.scroll_into_view_if_needed(); b = el.bounding_box()
            # ปุ่มในแผง: ใช้ตัวชี้แบบเมาส์ (แผงถูกวาดใหม่ระหว่างกด — ปล่อยจับที่ window)
            page.mouse.move(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); page.mouse.down(); time.sleep(ms / 1000); page.mouse.up(); time.sleep(0.35)

        def sample_code(card, needle):
            goals(page, mobile, card, 0, 1000)
            page.locator('#lesson-sample-code').scroll_into_view_if_needed()
            page.click('#lesson-sample-code'); time.sleep(0.4)
            code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.code")
            if mobile: close_drawers(page)
            page.click('#btn-run')
            return needle in code

        def wait_txt(rx, timeout=20000):
            try: page.wait_for_function(f"(() => /{rx}/.test({TXT}))()", timeout=timeout, polling=200)
            except Exception: pass
            return page.evaluate(TXT)

        # ================= แลป 50 =================
        boot(page, 'lesson50-keypad-start.json', 'กุญแจรหัสผ่าน')
        ok = sample_code('กุญแจรหัสผ่าน', 'KEYS = ("123A"')
        t0 = wait_txt('^----$', 90000)
        check(f'{tag}: แลป 50 โค้ดตัวอย่าง (สแกนปุ่ม 4×4) รันแล้วจอแสดง "----"', ok and t0 == '----', repr(t0))
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        # กดปุ่ม 2 ในฉาก
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('KP1'); const p = g.position; v.controls.target.set(p.x, 0, p.z - 7); v.persp.position.set(p.x, 38, p.z + 14); v.controls.update(); v.requestRender(); }""")
        time.sleep(0.8)
        s = page.evaluate(KEY_POS, '2'); hold_xy(s['x'], s['y'], 400)
        t1 = wait_txt('^2---$', 8000)
        con = page.evaluate('circuitLab.picoConsole')
        check(f'{tag}: แตะค้างที่ปุ่ม 2 ในฉาก → โค้ดสแกนพบ (key: 2) จอแสดง "2---" · ปล่อยแล้วปุ่มคืน', 'key: 2' in con and t1 == '2---' and page.evaluate("circuitLab.doc.parts.find(p => p.id === 'KP1').params.pressed") == '', f'{t1!r} {con[-60:]!r}')
        page.screenshot(path=f'{OUT}/{tag}-input-1-keypad.png')
        props(page, mobile, 'KP1')
        for k in '580': hold(f'#f-key-{k}')
        t2 = wait_txt('^2580$', 8000)
        if mobile: hold('#f-key-hash')
        else:
            page.keyboard.down('#'); time.sleep(0.35); page.keyboard.up('#'); time.sleep(0.4)
        try: page.wait_for_function("circuitLab.picoConsole.includes('OPEN')", timeout=8000, polling=200)
        except Exception: pass
        time.sleep(0.5)
        ig = page.evaluate("Math.abs(circuitLab.freshSim.analysis.parts.LEDG.current)")
        check(f'{tag}: ปุ่ม 5 8 0 จากแผง → จอ "2580" · # ({"แผง" if mobile else "แป้นพิมพ์"}) → OPEN และ LED เขียวติด', t2 == '2580' and 'OPEN' in page.evaluate('circuitLab.picoConsole') and ig > 2e-3, f'{t2!r} iG={ig:.4f}')
        for k in ['star', '1', '1', '1', '1', 'hash']: hold(f'#f-key-{k}')
        try: page.wait_for_function("circuitLab.picoConsole.includes('WRONG')", timeout=8000, polling=200)
        except Exception: pass
        time.sleep(0.5)
        ir = page.evaluate("Math.abs(circuitLab.freshSim.analysis.parts.LEDR.current)")
        ig = page.evaluate("Math.abs(circuitLab.freshSim.analysis.parts.LEDG.current)")
        check(f'{tag}: * 1 1 1 1 # → WRONG, LED แดงติด LED เขียวดับ', 'WRONG' in page.evaluate('circuitLab.picoConsole') and ir > 2e-3 and ig < 5e-4, f'iR={ir:.4f} iG={ig:.4f}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'กุญแจรหัสผ่าน', 4, 30000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('TM1637') && s.innerHTML.includes('ปุ่ม 4×4'); })()")
        check(f'{tag}: แลป 50 ผ่านครบ 4 ข้อ (wire scan open wrong) และมีรูปวงจร', len(g) == 4 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-input-2-lab50.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.5)

        # ================= แลป 51 =================
        boot(page, 'lesson51-encoder-start.json', 'ตัวนับด้วย rotary encoder')
        ok = sample_code('ตัวนับด้วย rotary encoder', 'clk.irq(')
        t0 = wait_txt('^   0$', 90000)
        check(f'{tag}: แลป 51 โค้ดตัวอย่าง (อินเทอร์รัปต์ CLK + ADC) รันแล้วจอแสดง "0"', ok and t0 == '   0', repr(t0))
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, 'ENC1')
        page.locator('#f-enc-cw5').scroll_into_view_if_needed(); page.click('#f-enc-cw5')
        t1 = wait_txt('^   5$', 8000)
        props(page, mobile, 'ENC1')
        page.locator('#f-enc-ccw').scroll_into_view_if_needed(); page.click('#f-enc-ccw'); time.sleep(0.3)
        props(page, mobile, 'ENC1')
        page.locator('#f-enc-ccw').scroll_into_view_if_needed(); page.click('#f-enc-ccw')
        t2 = wait_txt('^   3$', 8000)
        rot = page.evaluate("circuitLab.view.partObjs.get('ENC1').userData.knob.rotation.z")
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('นับคลิกสุทธิ')); return !!dt && dt.nextElementSibling.textContent.startsWith('3'); })()", timeout=5000, polling=200)
        except Exception: pass
        cnt = kv(page, 'นับคลิกสุทธิ')
        check(f'{tag}: หมุนตามเข็ม 5 → จอ 5 · ทวนเข็ม 2 → จอ 3 · แผงนับได้ 3 · ลูกบิดในฉากหมุน 3 × 18°', t1 == '   5' and t2 == '   3' and (cnt or '').startswith('3') and abs(rot + 3 * 3.14159 / 10) < 0.01, f'{t1!r} {t2!r} {cnt!r} rot={rot:.3f}')
        if mobile: close_drawers(page)
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('ENC1'); const p = g.position; v.controls.target.set(p.x - 2, 5, p.z); v.persp.position.set(p.x - 2, 12, p.z + 30); v.controls.update(); v.requestRender(); }""")
        time.sleep(0.8)
        page.screenshot(path=f'{OUT}/{tag}-input-3-encoder.png')
        props(page, mobile, 'JS1')
        page.locator('#f-js-up').scroll_into_view_if_needed(); page.click('#f-js-up')
        t3 = wait_txt('^  (2|3|4|5|6|7|8|9)\\d$', 8000)
        props(page, mobile, 'JS1')
        page.locator('#f-js-center').scroll_into_view_if_needed(); page.click('#f-js-center'); time.sleep(0.5)
        check(f'{tag}: ดันก้านจอยสติ๊กขึ้นสุด → ตัวเลขเพิ่มทีละ 10 (≥ 23)', re.match(r'^\s*\d+$', t3 or '') and int(t3) >= 23 and int(t3) % 10 == 3, repr(t3))
        props(page, mobile, 'ENC1')
        hold('#f-press', 600)
        t4 = wait_txt('^   0$', 8000)
        check(f'{tag}: กดลูกบิดค้าง → จอ 0', t4 == '   0', repr(t4))
        # ลากก้านในวงกลม → ขวาสุด
        props(page, mobile, 'JS1')
        pad = page.locator('#f-jspad'); pad.scroll_into_view_if_needed(); b = pad.bounding_box()
        cx, cy = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        page.mouse.move(cx, cy); page.mouse.down()
        for i in range(1, 9): page.mouse.move(cx + b['width'] * 0.5 * i / 8, cy, steps=1); time.sleep(0.05)
        page.mouse.up(); time.sleep(0.6)
        jx = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'JS1').params.x")
        props(page, mobile, 'JS1'); time.sleep(0.5)
        vx = kv(page, 'แรงดัน VRx')
        m = re.match(r'\s*([\d.]+)', vx or '')
        check(f'{tag}: ลากก้านในวงกลมไปขวาสุด → x ≈ 100% และ VRx ≈ 3.3 V', jx >= 0.95 and m and float(m[1]) > 3.1, f'x={jx} {vx!r}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'ตัวนับด้วย rotary encoder', 5, 30000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('KY-040') && s.innerHTML.includes('KY-023'); })()")
        check(f'{tag}: แลป 51 ผ่านครบ 5 ข้อ (wire cw ccw stick reset) และมีรูปวงจร', len(g) == 5 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-input-4-lab51.png')
        if mobile: close_drawers(page)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(8, 0, 6); v.persp.position.set(8, 45, 62); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-input-5-overview.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
