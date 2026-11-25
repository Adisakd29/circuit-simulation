"""E2E Arduino Uno + บริการคอมไพล์ (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีเซิร์ฟเวอร์ /api/compile (vite preview proxy → server/server.mjs)
เปิดวงจรเริ่มต้น (Uno + R + LED, โค้ดพิมพ์ digitalWrit ผิด, ยังไม่มีโปรแกรม) → แผงคุณสมบัติ "คอมไพล์ + อัปโหลด" → ข้อผิดพลาดชี้บรรทัด 10 พร้อมคำแนะนำของคอมไพเลอร์
→ แก้โค้ด → อัปโหลด (ขนาดแฟลช) → Run → LED บนเบรดบอร์ดสลับติด/ดับ + Serial Monitor LED ON/OFF → ปุ่ม RESET
→ แก้โค้ดในแท็บ Arduino Uno (ลืม ; บรรทัด 12) Ctrl+Enter → คอมไพเลอร์ชี้บรรทัด 13 · แก้ delay(100) Ctrl+Enter → กะพริบเร็วขึ้น → แลป 43 ผ่าน 3 ข้อหลัก มีรูปวงจร
→ ระดับการรองรับ → Save → New → Open → รันโปรแกรมเดิมได้โดยไม่คอมไพล์ใหม่ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/uno_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson43-uno-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

LED = "(() => { const s = circuitLab.freshSim; return s && s.analysis.parts.LED1 ? s.analysis.parts.LED1.current : null; })()"
UNO = "circuitLab.doc.parts.find(p => p.id === 'UNO1').params"

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def goals(page, mobile, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("Arduino Uno")').count(): page.click('.lesson-card:has-text("Arduino Uno")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

def wait_compiled(page):
    page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200); time.sleep(0.3)

def blink_seen(page, secs=6):
    """สุ่มอ่านกระแส LED ระหว่างจำลอง — คืน (เห็นติด, เห็นดับ, กระแสสูงสุด)"""
    on = off = False; mx = 0
    t0 = time.time()
    while time.time() - t0 < secs:
        i = page.evaluate(LED)
        if i is not None:
            mx = max(mx, i); on = on or i > 0.01; off = off or i < 1e-5
        time.sleep(0.1)
    return on, off, mx

def set_dock_code(page, code):
    page.fill('#un-code', code); page.dispatch_event('#un-code', 'input'); time.sleep(0.2)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1, accept_downloads=True)
        page = ctx.new_page()
        errors, compiles = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.on('request', lambda r: compiles.append(r.url) if '/api/compile' in r.url else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        # 1) คอมไพล์โค้ดที่ผิด
        props(page, mobile, 'UNO1')
        page.click('#f-uno-upload'); wait_compiled(page)
        e = page.evaluate("circuitLab.unoError")
        diags = page.evaluate("circuitLab.unoDiags.map(d => [d.line, d.severity, d.message])")
        etext = page.inner_text('#f-uno-err') if page.locator('#f-uno-err').count() else ''
        hint = any(d[1] == 'note' and 'digitalWrite' in d[2] for d in diags)
        check(f'{tag}: คอมไพล์ digitalWrit → ไม่ผ่าน ชี้บรรทัด 10 + คำแนะนำ digitalWrite · ไม่อัปโหลด', e and e['line'] == 10 and 'digitalWrit' in e['message'] and 'บรรทัด 10' in etext and hint and page.evaluate(f"{UNO}.hex") is None, f'{e} {diags[:2]} {etext!r}')
        page.screenshot(path=f'{OUT}/{tag}-uno-1-error.png')
        # 2) แก้แล้วอัปโหลด
        page.evaluate("(() => { const t = document.getElementById('f-uno-code'); t.value = t.value.replace('digitalWrit(', 'digitalWrite('); t.dispatchEvent(new Event('input')); t.dispatchEvent(new Event('change')); })()"); time.sleep(0.3)
        page.click('#f-uno-upload'); wait_compiled(page)
        pr = page.evaluate(f"(() => {{ const p = {UNO}; return {{ hex: !!p.hex, fresh: p.hexSrc === p.code, flash: p.flash }}; }})()")
        info = page.inner_text('#f-uno-prog')
        check(f'{tag}: แก้แล้ว "คอมไพล์ + อัปโหลด" → มีโปรแกรมบนบอร์ด (แฟลช ~2 KB) แถบแดงหาย', pr['hex'] and pr['fresh'] and 1500 < pr['flash'] < 3000 and 'แฟลช' in info and not page.locator('#f-uno-err').count(), f'{pr} {info[:60]!r}')
        if mobile: close_drawers(page)
        # 3) Run → LED กะพริบ + Serial
        page.click('#btn-run')
        try: page.wait_for_function("'LED OFF' && (circuitLab.unoConsole || '').includes('LED OFF')", timeout=60000, polling=300)
        except Exception: pass
        on, off, mx = blink_seen(page, 3)
        con = page.evaluate("circuitLab.unoConsole")
        dock = page.locator('#un-code').count() > 0
        check(f'{tag}: Run → LED บนเบรดบอร์ดติด (~12.5 mA) / ดับ สลับกัน · Serial Monitor แสดง LED ON/OFF · แท็บ Arduino Uno เปิด', on and off and 0.011 < mx < 0.0135 and 'LED ON' in con and 'LED OFF' in con and dock, f'{on} {off} {mx} {con[-40:]!r} dock={dock}')
        page.screenshot(path=f'{OUT}/{tag}-uno-2-running.png')
        # 4) RESET
        n0 = page.evaluate("(circuitLab.unoConsole.match(/LED ON/g) || []).length")
        page.click('#un-reset')
        try: page.wait_for_function(f"(circuitLab.unoConsole.match(/LED ON/g) || []).length > {n0}", timeout=15000, polling=100)
        except Exception: pass
        n1 = page.evaluate("(circuitLab.unoConsole.match(/LED ON/g) || []).length")
        check(f'{tag}: ปุ่ม RESET → โปรแกรมเริ่มใหม่ (พิมพ์ LED ON)', n1 > n0, f'{n0} → {n1}')
        # 5) แก้ในแท็บ: ลืม ; → Ctrl+Enter
        good = page.evaluate(f"{UNO}.code")
        set_dock_code(page, good.replace('delay(500);\n  digitalWrite(LED, LOW);', 'delay(500)\n  digitalWrite(LED, LOW);'))
        page.focus('#un-code'); page.keyboard.press('Control+Enter'); wait_compiled(page)
        e = page.evaluate("circuitLab.unoError")
        bar = page.inner_text('#un-err') if page.locator('#un-err').is_visible() else ''
        red = page.evaluate("(() => { const s = document.querySelector('#un-gutter .err'); return s ? s.textContent.trim() : null; })()")
        check(f'{tag}: แท็บ Arduino Uno: ลืม ; ท้ายบรรทัด 12 แล้ว Ctrl+Enter → คอมไพเลอร์ชี้บรรทัด 13 (คำถัดไป, แถบแดง + เลขบรรทัดแดง) โปรแกรมเดิมยังทำงาน', e and e['line'] == 13 and "expected ';' before 'digitalWrite'" in e['message'] and 'บรรทัด 13' in bar and red == '13' and 'LED' in page.evaluate("circuitLab.unoConsole.slice(-20)"), f'{e} {bar!r} {red}')
        page.screenshot(path=f'{OUT}/{tag}-uno-3-dock-error.png')
        # 6) delay(100) → เร็วขึ้น
        set_dock_code(page, good.replace('delay(500)', 'delay(100)'))
        page.focus('#un-code'); page.keyboard.press('Control+Enter'); wait_compiled(page)
        c0 = len(page.evaluate("circuitLab.unoConsole")); t0 = page.evaluate("circuitLab.freshSim ? circuitLab.freshSim.t : 0")
        time.sleep(4)
        seg = page.evaluate(f"circuitLab.unoConsole.slice({c0})"); t1 = page.evaluate("circuitLab.freshSim ? circuitLab.freshSim.t : 0")
        n = seg.count('LED ON'); rate = n / max(1e-3, (t1 - t0))
        check(f'{tag}: delay(100) + Ctrl+Enter → อัปโหลดใหม่ กะพริบ ≈ 5 ครั้ง/วินาที (เวลาจำลอง)', page.evaluate("!circuitLab.unoError") and 3.5 < rate < 6, f'{n} ครั้งใน {t1 - t0:.2f} s → {rate:.2f}/s')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        # 7) แลป 43
        g = goals(page, mobile, 3, 40000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('Arduino Uno') && s.innerHTML.includes('D13'); })()")
        check(f'{tag}: แลป 43 ผ่าน led/upload/blink และมีรูปวงจร', set(['led', 'upload', 'blink']) <= set(g) and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-uno-4-lesson.png')
        if mobile: close_drawers(page)
        # 8) ระดับการรองรับ
        props(page, mobile, 'UNO1')
        st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
        check(f'{tag}: แผงคุณสมบัติ Uno แสดงระดับการรองรับ (จำลองบางส่วน · I²C ยังไม่ต่อวงจร)', 'จำลองบางส่วน' in st and 'I²C' in st, st[:100].replace('\n', ' | '))
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.4)
        # 9) Save → New → Open → รันได้โดยไม่คอมไพล์
        def menu_click(sel):
            if mobile: page.click('#btn-more'); time.sleep(0.2)
            page.click(sel)
        menu_click('#btn-save'); time.sleep(0.2)
        with page.expect_download() as dl:
            page.click('#save-download')
        path = f'{OUT}/{tag}-uno-saved.json'
        dl.value.save_as(path)
        page.click('dialog .btn:has-text("ปิด")')
        menu_click('#btn-new'); time.sleep(0.2)
        page.click('dialog .btn.primary'); time.sleep(0.3)
        empty = page.evaluate('circuitLab.doc.parts.length') == 0
        page.set_input_files('#file-input', path); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        same = page.evaluate(f"(() => {{ const p = {UNO}; return !!p.hex && p.code.includes('delay(100)') && p.hexSrc === p.code; }})()")
        nreq = len(compiles)
        page.click('#btn-run')
        try: page.wait_for_function("(circuitLab.unoConsole || '').includes('LED OFF')", timeout=60000, polling=300)
        except Exception: pass
        on, off, mx = blink_seen(page, 3)
        check(f'{tag}: Save → New → Open ได้โค้ด + โปรแกรมเดิม · Run แล้วกะพริบทันทีโดยไม่เรียกบริการคอมไพล์', empty and same and on and off and len(compiles) == nreq, f'{empty} {same} {on} {off} req {nreq}→{len(compiles)}')
        page.click('#btn-stop')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
