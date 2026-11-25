"""E2E Arduino Pro Mini (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile
1) คลังอุปกรณ์ → Arduino Pro Mini 328 → แตะรู h3 → เสียบคร่อมร่องกลาง (TXO = h3, RAW = d3) · โมเดล 3 มิติมีขา 28 ขา (24 ขาลงรู + เข็ม A4–A7 บนบอร์ด) + LED L + ตัวแปลง USB-serial
   · เครื่องมือต่อสาย: แตะเข็ม A4 บนบอร์ด → แตะรางไฟ → ได้สายที่ต่อเข้าขา A4 โดยตรง (ไม่ใช่รู)
2) เปิดวงจร Pro Mini รุ่น 3.3 V + LED ที่ D13 + A7 ต่อ VCC + เครื่องวิเคราะห์ลอจิก (CH0 → TXO, CH1 → D9) → คอมไพล์ + อัปโหลด (บอร์ด promini3 = 8 MHz)
   → Run → LED ติด/ดับ (≈ 5 mA ที่ 3.3 V) · Serial Monitor "A7=1023" · CH1 PWM ≈ 245 Hz (8 MHz) duty ≈ 25% · CH0 ถอด UART "LED" ที่ 9600 baud
3) เปลี่ยนรุ่นเป็น 5 V → โปรแกรมเดิมถูกล้าง → อัปโหลดใหม่ (บอร์ด promini) → CH1 ≈ 490 Hz · LED ≈ 12 mA · แผงคุณสมบัติ "จำลองบางส่วน" · ไม่มี JavaScript error
ใช้: python3 tests/e2e/promini_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props, tool

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

def upload(page, mobile):
    props(page, mobile, 'PM1')
    page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
    try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
    except Exception: pass
    time.sleep(0.3)

def led_cycle(page):
    try: page.wait_for_function("(circuitLab.unoConsole || '').includes('LED OFF')", timeout=60000, polling=300)
    except Exception: pass
    on = off = False; mx = 0
    t0 = time.time()
    while time.time() - t0 < 3:
        i = page.evaluate(LED)
        if i is not None: mx = max(mx, i); on = on or i > 1e-3; off = off or i < 1e-5
        time.sleep(0.1)
    return on, off, mx

def la_freq(page, lo, hi):
    if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
    if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
    page.click('#dock-tab-la'); time.sleep(0.6)
    try: page.wait_for_function(f"(() => {{ const m = /f ([\\d.]+) Hz/.exec((document.getElementById('la-m-1') || {{}}).textContent || ''); return m && +m[1] > {lo} && +m[1] < {hi}; }})()", timeout=30000, polling=300)
    except Exception: pass
    m1 = page.inner_text('#la-m-1') if page.locator('#la-m-1').count() else ''
    return re.search(r'f ([\d.]+) Hz · duty ([\d.]+)%', m1), m1

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

        # 1) วางจากคลังอุปกรณ์
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'pro mini'); time.sleep(0.3)
        page.click('.lib-item:has-text("Arduino Pro Mini")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'h9', 30)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'h3'})
        tap(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'promini')", timeout=5000)
        except Exception: pass
        pm = page.evaluate("""(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'promini'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id); const tips = []; g && g.traverse(o => { if (o.userData.leadTip) tips.push(o.userData.leadTip); });
          return { id: p.id, pl: p.placement, volt: p.params.volt, tips: tips.length, a4: tips.includes('A4'), a7: tips.includes('A7'), raw: tips.includes('RAW'), led: !!(g && g.userData.picoLed) }; })()""")
        check(f'{tag}: คลังอุปกรณ์ → Arduino Pro Mini → แตะรู h3 → เสียบคร่อมร่องกลาง (anchor h3, รุ่นเริ่มต้น 5 V) · โมเดลมีขา 28 ขา (RAW, A4, A7) + LED L', pm and pm['pl'].get('anchor') == 'h3' and pm['volt'] == 5 and pm['tips'] == 28 and pm['a4'] and pm['a7'] and pm['raw'] and pm['led'], str(pm))
        pid = pm['id'] if pm else 'PMINI1'
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')
        time.sleep(0.8)
        labs = page.evaluate("circuitLab.view.visiblePinLabels().map(l => l.pin)")
        check(f'{tag}: ปุ่มชื่อขาทั้งหมด → ป้ายชื่อขาของ Pro Mini (RAW และขาแถว B · ป้ายที่ซ้อนกันถูกเว้น)', 'RAW' in labs and len(labs) >= 20 and ('VCC' in labs or 'A4' in labs), str(labs[:28]))
        page.screenshot(path=f'{OUT}/{tag}-promini-1-placed.png')
        if mobile: page.click('#btn-pinlabels')
        else: page.keyboard.press('l')
        time.sleep(0.3)
        # ต่อสายเข้าเข็ม A4 บนบอร์ด
        page.evaluate("circuitLab.select(null)")
        tool(page, 'ต่อสาย (W)')
        page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'pin', partId: '{pid}', pin: 'A4'}}); v.controls.target.set(w.x, w.y, w.z); v.persp.position.set(w.x + 2, w.y + 12, w.z + 9); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
        time.sleep(0.6)
        s = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': pid, 'pin': 'A4'})
        tap(s['x'], s['y'] + 2)
        focus(page, 'tp20', 14)
        s2 = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'tp20'})
        tap(s2['x'], s2['y'])
        tool(page, 'เลือก / ย้าย (V)')
        wires = page.evaluate("JSON.stringify(circuitLab.doc.wires)")
        check(f'{tag}: เครื่องมือต่อสาย: แตะเข็ม A4 บนบอร์ด → แตะราง tp20 → สายต่อเข้าขา A4 โดยตรง', f'"pin":"A4"' in wires and '"tp20"' in wires, wires[:200])
        page.screenshot(path=f'{OUT}/{tag}-promini-1b-wire-a4.png')

        # 2) วงจรรุ่น 3.3 V
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'promini-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        upload(page, mobile)
        pr = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'PM1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, flash: p.flash, volt: p.volt }; })()")
        info = page.inner_text('#f-uno-prog') if page.locator('#f-uno-prog').count() else ''
        sel = page.evaluate("(document.getElementById('f-pmini-volt') || {}).value")
        sent3 = any('"board":"promini3"' in b for b in boards)
        check(f'{tag}: รุ่น 3.3 V → คอมไพล์ + อัปโหลดเป็นบอร์ด promini3 (8 MHz) · แฟลช / 30,720 ไบต์', pr['hex'] and pr['fresh'] and pr['volt'] == 3.3 and sel == '3.3' and '30,720' in info and sent3, f'{pr} {sel} {info[:80]!r} {sent3}')
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        helptxt = page.inner_text('#f-pmini-help') if page.locator('#f-pmini-help').count() else ''
        check(f'{tag}: แผงคุณสมบัติ: "จำลองบางส่วน" + บอกข้อจำกัด (ตัวแปลง USB-serial, ไม่จำลอง RAW)', 'จำลองบางส่วน' in st and 'USB-serial' in helptxt and 'RAW' in helptxt, (st[:60] + ' | ' + helptxt[:80]).replace('\n', ' '))
        page.screenshot(path=f'{OUT}/{tag}-promini-2-props.png')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        on, off, mx = led_cycle(page)
        con = page.evaluate("circuitLab.unoConsole || ''")
        check(f'{tag}: Run (3.3 V) → LED ที่ D13 ติด/ดับ ≈ 5 mA · Serial Monitor "A7=1023" (A7 ต่อ VCC ผ่านเข็มบนบอร์ด)', on and off and 0.0035 < mx < 0.0065 and re.search(r'A7=10(1\d|2[0-3])', con), f'{on} {off} {mx} {con[-40:]!r}')
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        if page.locator('#dock-tab-uno').count(): page.click('#dock-tab-uno'); time.sleep(0.4)
        tabt = page.inner_text('#dock-tab-uno') if page.locator('#dock-tab-uno').count() else ''
        note = page.inner_text('#un-pmini-note') if page.locator('#un-pmini-note').count() else ''
        check(f'{tag}: แผงล่าง: แท็บ "Arduino Pro Mini (C++)" · หมายเหตุบอก 8 MHz และตัวแปลง USB-serial', 'Pro Mini' in tabt and '8 MHz' in note and 'USB-serial' in note, f'{tabt!r} {note[:60]!r}')
        m, m1 = la_freq(page, 235, 255)
        check(f'{tag}: เครื่องวิเคราะห์ CH1 (D9 · Timer1 ที่ 8 MHz) f ≈ 245 Hz duty ≈ 25%', m and abs(float(m.group(1)) - 245.1) < 4 and abs(float(m.group(2)) - 25.1) < 1.5, repr(m1))
        page.select_option('#la-dec-0', 'uart'); time.sleep(0.5)
        try: page.wait_for_function("/LED/.test((document.getElementById('la-t-0') || {}).textContent || '')", timeout=25000, polling=300)
        except Exception: pass
        t0x = page.inner_text('#la-t-0') if page.locator('#la-t-0').count() else ''
        m0 = page.inner_text('#la-m-0') if page.locator('#la-m-0').count() else ''
        check(f'{tag}: CH0 (TXO) ถอด UART ได้ "LED …" · 9600 baud (8 MHz)', 'LED' in t0x and '9600 baud' in m0, f'{t0x[-40:]!r} {m0!r}')
        page.screenshot(path=f'{OUT}/{tag}-promini-3-run33.png')
        page.click('#btn-stop'); time.sleep(0.3)

        # 3) เปลี่ยนเป็นรุ่น 5 V
        props(page, mobile, 'PM1')
        page.locator('#f-pmini-volt').scroll_into_view_if_needed()
        page.select_option('#f-pmini-volt', '5'); time.sleep(0.5)
        pr2 = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'PM1').params; return { hex: p.hex, volt: p.volt }; })()")
        check(f'{tag}: เปลี่ยนรุ่นเป็น 5 V → ล้างโปรแกรมเดิม (F_CPU ต่างกัน)', pr2['hex'] is None and pr2['volt'] == 5, str(pr2))
        n0 = len(boards)
        upload(page, mobile)
        sent5 = any('"board":"promini"' in b for b in boards[n0:])
        if mobile: close_drawers(page)
        page.click('#btn-run')
        on, off, mx = led_cycle(page)
        m, m1 = la_freq(page, 480, 500)
        check(f'{tag}: รุ่น 5 V → คอมไพล์เป็นบอร์ด promini (16 MHz) · LED ≈ 12 mA · CH1 ≈ 490 Hz', sent5 and on and off and 0.011 < mx < 0.0135 and m and abs(float(m.group(1)) - 490.2) < 4, f'{sent5} {on} {off} {mx} {m1!r}')
        page.screenshot(path=f'{OUT}/{tag}-promini-4-run5.png')
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
