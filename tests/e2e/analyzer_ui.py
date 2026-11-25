"""E2E เครื่องวิเคราะห์ลอจิก (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile
1) คลังอุปกรณ์มี "เครื่องวิเคราะห์ลอจิก 8 ช่อง" วางบนโต๊ะได้ · โมเดล 3 มิติมีขา CH0–CH7 + GND
2) แลป 56: Uno + เครื่องวิเคราะห์ (CH0 → D9, CH1 → D1/TX, GND) → ใส่โค้ดตัวอย่าง → คอมไพล์ + อัปโหลด → Run → แท็บ "เครื่องวิเคราะห์ลอจิก"
   CH0 วัดได้ f ≈ 490 Hz duty ≈ 25% · ตั้ง CH1 เป็น UART (อัตโนมัติ) → ถอดได้ "HELLO n" และ 9600 baud · ทริกเกอร์ CH1 ขอบลง → Trig'd
3) ตรวจผลแลป 56 ผ่าน wire, upload, pwm, uart · Stop ค้างภาพ
4) แลป 58: Uno + BH1750 → ตั้ง CH0 = I²C SDA, CH1 = I²C SCL → ถอดได้ธุรกรรมของ 0x23 ตรงกับค่า raw ใน Serial, SCL 100 kHz, ตรวจผลผ่าน 4 ข้อ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/analyzer_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import WORLD_TO_SCREEN, close_drawers, props, goals

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def st_ok(page):
    return page.inner_text('#la-status') == "Trig'd"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        # 1) วางจากคลัง
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'logic analyzer'); time.sleep(0.3)
        page.click('.lib-item:has-text("เครื่องวิเคราะห์ลอจิก")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(0, 0, 32); v.persp.position.set(0, 60, 75); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }""")
        time.sleep(0.5)
        s = page.evaluate(WORLD_TO_SCREEN, [0, 0, 34])
        if mobile: page.touchscreen.tap(s['x'], s['y'])
        else: page.mouse.click(s['x'], s['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'logicanalyzer')", timeout=5000)
        except Exception: pass
        la = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'logicanalyzer'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id); const tips = []; g && g.traverse(o => { if (o.userData.leadTip) tips.push(o.userData.leadTip); }); return { pl: p.placement, tips }; })()")
        check(f'{tag}: คลังอุปกรณ์ → เครื่องวิเคราะห์ลอจิก → วางบนโต๊ะ · โมเดลมีขา CH0–CH7 + GND', la and la['pl']['kind'] == 'table' and sorted(la['tips']) == sorted([f'CH{k}' for k in range(8)] + ['GND']), str(la))
        page.screenshot(path=f'{OUT}/{tag}-la-0-placed.png')

        # 2) แลป 56
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'lesson56-analyzer-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("เครื่องวิเคราะห์ลอจิก")').count(): page.click('.lesson-card:has-text("เครื่องวิเคราะห์ลอจิก")'); time.sleep(0.3)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed(); page.click('#lesson-sample-code'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'UNO1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        up = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'UNO1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, la: p.code.includes('HELLO') }; })()")
        check(f'{tag}: ใส่โค้ดตัวอย่างแลป 56 → คอมไพล์ + อัปโหลดลง Uno', up['hex'] and up['fresh'] and up['la'], str(up))
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.0)
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.click('#dock-tab-la'); time.sleep(0.6)
        try: page.wait_for_function("(document.getElementById('la-m-0') || {}).textContent && /f 49\\d/.test(document.getElementById('la-m-0').textContent)", timeout=30000, polling=300)
        except Exception: pass
        m0 = page.inner_text('#la-m-0') if page.locator('#la-m-0').count() else ''
        names = page.evaluate("[...document.querySelectorAll('.la-ch .la-name')].map(e => e.textContent)")
        m = re.search(r'f ([\d.]+) Hz · duty ([\d.]+)%', m0)
        check(f'{tag}: แท็บเครื่องวิเคราะห์: CH0 (UNO1 D9) วัดได้ f ≈ 490.2 Hz duty ≈ 25.1%', m and abs(float(m.group(1)) - 490.2) < 1 and abs(float(m.group(2)) - 25.1) < 0.6 and names[:2] == ['UNO1 D9', 'UNO1 D1'], f'{m0!r} {names}')
        page.select_option('#la-dec-1', 'uart'); time.sleep(0.5)
        try: page.wait_for_function("/HELLO \\d+/.test((document.getElementById('la-t-1') || {}).textContent || '')", timeout=20000, polling=300)
        except Exception: pass
        t1 = page.inner_text('#la-t-1') if page.locator('#la-t-1').count() else ''
        m1 = page.inner_text('#la-m-1') if page.locator('#la-m-1').count() else ''
        con = page.evaluate("circuitLab.unoConsole || ''")
        lines = [l for l in t1.split('\n') if re.fullmatch(r'HELLO \d+', l)]
        check(f'{tag}: ตัวถอดรหัส UART ที่ CH1 (บอดเรตอัตโนมัติ 9600) → ข้อความ "HELLO n" ตรงกับ Serial Monitor', lines and all(l in con for l in lines) and '9600 baud' in m1, f'{t1[-60:]!r} {m1!r}')
        page.select_option('#la-tdiv', '0.0002'); time.sleep(0.3)
        page.select_option('#la-trig', '1'); time.sleep(0.2)
        page.select_option('#la-edge', 'fall'); time.sleep(1.2)
        st = page.inner_text('#la-status')
        fr = page.evaluate("(() => { const v = circuitLab.laView(); const c = v.ch.find(c => c.k === 1); return c ? c.frames.map(f => f.ch) : []; })()")
        check(f"{tag}: 200 µs/div ทริกเกอร์ CH1 ขอบลง → Trig'd ที่ต้นข้อความ: จอแสดงเฟรม 'H' 'E'", st == "Trig'd" and fr[:2] == ['H', 'E'], f'{st} {fr}')
        page.screenshot(path=f'{OUT}/{tag}-la-1-uart.png')
        page.click('#la-run'); time.sleep(0.6)
        a = page.evaluate("circuitLab.laBuffer('LA1').t1"); time.sleep(0.8); b = page.evaluate("circuitLab.laBuffer('LA1').t1")
        check(f'{tag}: Stop → ค้างภาพ (บัฟเฟอร์ไม่รับข้อมูลใหม่) · สถานะ STOP', a == b and page.inner_text('#la-status') == 'STOP', f'{a} {b}')
        page.click('#la-run'); time.sleep(0.4)
        page.select_option('#la-tdiv', '0.001'); time.sleep(0.2)
        page.select_option('#la-trig', '0'); time.sleep(0.2)
        page.select_option('#la-edge', 'rise'); time.sleep(1.0)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        g = goals(page, mobile, 'เครื่องวิเคราะห์ลอจิก', 4)
        check(f'{tag}: ตรวจผลแลป 56 ผ่าน wire, upload, pwm, uart', {'wire', 'upload', 'pwm', 'uart'} <= set(g), str(g))
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        # แลป 58
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'lesson58-i2cla-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("ถอดรหัสบัส I²C")').count(): page.click('.lesson-card:has-text("ถอดรหัสบัส I²C")'); time.sleep(0.3)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed(); page.click('#lesson-sample-code'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'UNO1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        up = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'UNO1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, w: p.code.includes('Wire.requestFrom') }; })()")
        check(f'{tag}: ใส่โค้ดตัวอย่างแลป 58 (Wire + BH1750) → คอมไพล์ + อัปโหลด', up['hex'] and up['fresh'] and up['w'], str(up))
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.0)
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.click('#dock-tab-la'); time.sleep(0.6)
        src = page.evaluate("[circuitLab.laBuffer('LA1').ch[0].src, circuitLab.laBuffer('LA1').ch[1].src]")
        page.select_option('#la-dec-0', 'i2c-sda'); time.sleep(0.5)
        page.select_option('#la-dec-1', 'i2c-scl'); time.sleep(0.5)
        try: page.wait_for_function("/0x23 R ACK 0x02 ACK 0x58 NACK P/.test((document.getElementById('la-t-0') || {}).textContent || '')", timeout=30000, polling=300)
        except Exception: pass
        t0 = page.inner_text('#la-t-0') if page.locator('#la-t-0').count() else ''
        m0 = page.inner_text('#la-m-0') if page.locator('#la-m-0').count() else ''
        con = page.evaluate("circuitLab.unoConsole || ''")
        check(f'{tag}: CH0 = I²C SDA, CH1 = I²C SCL → ถอดได้ "S 0x23 W ACK 0x20 ACK P" และ "S 0x23 R ACK 0x02 ACK 0x58 NACK P" (= raw 0x258 ใน Serial) · SCL 100 kHz · ที่มา i2c', 'S 0x23 W ACK 0x20 ACK P' in t0 and 'S 0x23 R ACK 0x02 ACK 0x58 NACK P' in t0 and 'raw=0x258' in con and re.search(r'SCL = CH1 · (99\.\d+|100\.\d+) kHz', m0) and src == ['i2c', 'i2c'], f'{t0[-80:]!r} {m0!r} {src}')
        page.select_option('#la-tdiv', '0.0001'); time.sleep(0.3)
        page.select_option('#la-trig', '0'); time.sleep(0.2)
        page.select_option('#la-edge', 'fall'); time.sleep(1.2)
        boxes = page.evaluate("(() => { const v = circuitLab.laView(); const c = v.ch.find(c => c.k === 0); return c ? c.i2c.filter(f => f.t1 >= v.t0 && f.t0 <= v.t1).map(f => f.kind + (f.kind === 'addr' || f.kind === 'data' ? ':' + f.value.toString(16) : '')) : []; })()")
        check(f"{tag}: 100 µs/div ทริกเกอร์ CH0 ขอบลง → จอแสดง START และกล่องที่อยู่ 0x23", st_ok(page) and 'start' in boxes and 'addr:23' in boxes, f'{boxes}')
        page.screenshot(path=f'{OUT}/{tag}-la-2-i2c.png')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        g = goals(page, mobile, 'ถอดรหัสบัส I²C', 4)
        check(f'{tag}: ตรวจผลแลป 58 ผ่าน wire, upload, decode, scl', {'wire', 'upload', 'decode', 'scl'} <= set(g), str(g))
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
