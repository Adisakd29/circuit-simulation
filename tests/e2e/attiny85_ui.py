"""E2E ATtiny85 (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile
1) คลังอุปกรณ์ → ATtiny85 → แตะรู f10 → เสียบคร่อมร่องกลาง (ขา 1 = f10, ขา 8 = e10) · โมเดล DIP-8 ขา 8 ขา
2) เปิดวงจร ATtiny85 + แหล่งจ่าย 5 V + LED ที่ PB0 + LED ที่ PB1 (หรี่ตาม VR ที่ A1) + เครื่องวิเคราะห์ลอจิก → คอมไพล์ + อัปโหลด (บอร์ด attiny85, แฟลช / 8,192 ไบต์)
   → Run → LED1 กะพริบ · สถานะชิป "ทำงาน" VCC 5.00 V · CH1 (PB1) PWM ≈ 488 Hz
3) ปิดเอาต์พุตแหล่งจ่าย → สถานะชิป "ไม่ทำงาน" + LED ดับ · เปิดใหม่ → ทำงานต่อ · โค้ดที่ใช้ Serial → ข้อความ "ATtiny85 ไม่มี UART" ชี้บรรทัด · ไม่มี JavaScript error
ใช้: python3 tests/e2e/attiny85_ui.py <out-dir> [url] [desktop,mobile]
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
STATUS = "(() => { const d = document.getElementById('tiny-status'); return d ? d.textContent : ''; })()"

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
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.25)

        # 1) วางจากคลัง
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'attiny'); time.sleep(0.3)
        page.click('.lib-item:has-text("ATtiny85")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'f11', 18)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f10'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'attiny85')", timeout=5000)
        except Exception: pass
        t = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'attiny85'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id); const tips = []; g && g.traverse(o => { if (o.userData.leadTip) tips.push(o.userData.leadTip); });
          return { pl: p.placement, tips: tips.sort().join(',') }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → ATtiny85 → แตะรู f10 → เสียบคร่อมร่องกลาง (anchor f10) · โมเดล DIP-8 ขา 8 ขา', t and t['pl'].get('anchor') == 'f10' and t['tips'] == 'GND,PB0,PB1,PB2,PB3,PB4,PB5,VCC', str(t))
        page.screenshot(path=f'{OUT}/{tag}-tiny-1-placed.png')

        # 2) วงจรพร้อมแหล่งจ่าย
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'attiny85-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        props(page, mobile, 'TINY1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        pr = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'TINY1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, flash: p.flash }; })()")
        info = page.inner_text('#f-uno-prog') if page.locator('#f-uno-prog').count() else ''
        sent = any('"board":"attiny85"' in b for b in boards)
        check(f'{tag}: คอมไพล์ + อัปโหลดเป็นบอร์ด attiny85 · แฟลช / 8,192 ไบต์ · RAM / 512 ไบต์', pr['hex'] and pr['fresh'] and '8,192' in info and '/ 512' in info and sent, f'{pr} {info[:80]!r} {sent}')
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        pw_txt = page.inner_text('#f-tiny-power') if page.locator('#f-tiny-power').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกให้ต่อไฟขา 8/4 เอง', 'จำลองบางส่วน' in st and 'ขา 8' in pw_txt, (st[:50] + ' | ' + pw_txt[:60]).replace('\n', ' '))
        page.screenshot(path=f'{OUT}/{tag}-tiny-2-props.png')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        on = off = False; t0 = time.time()
        while time.time() - t0 < 6 and not (on and off):
            i = page.evaluate(LED)
            if i is not None: on = on or i > 1e-3; off = off or i < 1e-6
            time.sleep(0.1)
        props(page, mobile, 'TINY1')
        try: page.wait_for_function(f"{STATUS}.includes('ทำงาน') && /5\\.0\\d V/.test({STATUS})", timeout=10000, polling=300)
        except Exception: pass
        s1 = page.evaluate(STATUS)
        check(f'{tag}: Run → LED1 ที่ PB0 กะพริบ · สถานะชิป "ทำงาน" VCC ≈ 5.00 V', on and off and 'ทำงาน' in s1 and 'ไม่ทำงาน' not in s1 and re.search(r'5\.0\d V', s1), f'{on} {off} {s1[:90]!r}')
        if mobile: close_drawers(page)
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.click('#dock-tab-la'); time.sleep(0.6)
        try: page.wait_for_function("(() => { const m = /f ([\\d.]+) Hz/.exec((document.getElementById('la-m-1') || {}).textContent || ''); return m && +m[1] > 470 && +m[1] < 505; })()", timeout=30000, polling=300)
        except Exception: pass
        m1 = page.inner_text('#la-m-1') if page.locator('#la-m-1').count() else ''
        m = re.search(r'f ([\d.]+) Hz', m1)
        check(f'{tag}: เครื่องวิเคราะห์ CH1 (PB1 · Timer0 ที่ 8 MHz) PWM ≈ 488 Hz', m and abs(float(m.group(1)) - 488.3) < 5, repr(m1))
        page.screenshot(path=f'{OUT}/{tag}-tiny-3-running.png')

        # 3) ปิด/เปิดแหล่งจ่าย
        props(page, mobile, 'PS1')
        page.locator('#f-on').scroll_into_view_if_needed(); page.click('#f-on'); time.sleep(0.4)
        props(page, mobile, 'TINY1')
        try: page.wait_for_function(f"{STATUS}.includes('ไม่ทำงาน')", timeout=15000, polling=300)
        except Exception: pass
        time.sleep(0.5)
        s2 = page.evaluate(STATUS); i2 = page.evaluate(LED)
        check(f'{tag}: ปิดเอาต์พุตแหล่งจ่าย → สถานะชิป "ไม่ทำงาน — VCC ต่ำกว่า 2.7 V" · LED1 ดับ', 'ไม่ทำงาน' in s2 and (i2 is None or i2 < 1e-6), f'{s2[:80]!r} {i2}')
        props(page, mobile, 'PS1')
        page.locator('#f-on').scroll_into_view_if_needed(); page.click('#f-on'); time.sleep(0.4)
        props(page, mobile, 'TINY1')
        try: page.wait_for_function(f"!{STATUS}.includes('ไม่ทำงาน') && {STATUS}.includes('ทำงาน')", timeout=15000, polling=300)
        except Exception: pass
        s3 = page.evaluate(STATUS)
        check(f'{tag}: เปิดแหล่งจ่ายใหม่ → CPU กลับมาทำงาน', 'ทำงาน' in s3 and 'ไม่ทำงาน' not in s3, s3[:80])
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        # Serial ใช้ไม่ได้
        props(page, mobile, 'TINY1')
        page.evaluate("""() => { const t = document.getElementById('f-uno-code'); t.value = 'void setup() {\\n  Serial.begin(9600);\\n}\\nvoid loop() {}\\n'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); }""")
        time.sleep(0.3)
        page.locator('#f-uno-compile').scroll_into_view_if_needed(); page.click('#f-uno-compile')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=60000, polling=200)
        except Exception: pass
        time.sleep(0.4)
        err = page.inner_text('#f-uno-err') if page.locator('#f-uno-err').count() else ''
        check(f'{tag}: โค้ดที่เรียก Serial → "ATtiny85 ไม่มี UART" ชี้บรรทัด 2', 'ไม่มี UART' in err and 'บรรทัด 2' in err, err[:100])
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
