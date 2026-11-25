"""E2E โปรเจกต์จบ 2 (ระบบรดน้ำต้นไม้) และ 5 (ระบบควบคุมมอเตอร์) — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
แท็บแลป → การ์ดแม่แบบ → หน้ารายละเอียด (ระดับการจำลอง, รูปวงจร, BOM, ตารางจุดต่อ, ข้อจำกัด) → เปิดแม่แบบ → Run (โปรแกรมคอมไพล์ไว้แล้ว)
2: จอ LCD "Watering (auto)" + ปั๊มมีกระแส → ความชื้นถึง 60% แล้ว "Idle" ปั๊มหยุด
5: จอ "DC  74% FWD" + มอเตอร์หมุนเดินหน้า → กดค้างปุ่ม PB1 ในแผง → REV มอเตอร์หมุนกลับ · ไม่มีคำเตือนอันตราย · ไม่มี JavaScript error
ใช้: python3 tests/e2e/finalproj2_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

DIAG = "(() => { const s = circuitLab.freshSim; return s ? s.analysis.diagnostics.map(d => d.severity + ':' + d.message).join(' | ') : ''; })()"
PART = "(a) => { const s = circuitLab.freshSim; const r = s && s.analysis.parts[a[0]]; if (!r) return null; return a[1] === 'current' ? r.current : (r.extra ? r.extra[a[1]] : null); }"
LCD = "(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความบนจอ')); return dt ? dt.nextElementSibling.textContent : ''; })()"

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def wait_lcd(page, mobile, text, timeout):
    props(page, mobile, 'LCD1')
    t0 = time.time(); last = ''
    while time.time() - t0 < timeout:
        last = page.evaluate(LCD)
        if text in last: return True, last
        time.sleep(0.3)
    return False, last

def open_template(page, mobile, tag, pid, sch_word, n_parts, lim_word):
    if mobile: page.click('#btn-left'); time.sleep(0.4)
    page.click('#tab-lessons'); time.sleep(0.3)
    page.click(f'#proj-{pid}'); time.sleep(0.6)
    st = page.inner_text('#proj-status')
    bom = page.locator('#proj-bom tr').count()
    wires = page.locator('#proj-wires tr').count()
    svg = page.evaluate(f"(() => {{ const s = document.querySelector('#proj-schematic svg'); return !!s && s.innerHTML.includes('UNO Q') && s.innerHTML.includes('{sch_word}'); }})()")
    lim = page.inner_text('#proj-limits')
    check(f'{tag}: แม่แบบ {pid}: ระดับการจำลอง (behavioral) + รูปวงจร + BOM + ตารางจุดต่อ + ข้อจำกัด', 'จำลองพฤติกรรม' in st and svg and bom > 6 and wires > 15 and lim_word in lim, f'bom={bom} wires={wires} svg={svg}')
    page.screenshot(path=f'{OUT}/{tag}-{pid}-1-detail.png')
    page.click('#proj-open'); time.sleep(1.2)
    parts = page.evaluate("circuitLab.doc.parts.length")
    hexok = page.evaluate("(() => { const q = circuitLab.doc.parts.find(p => p.id === 'UNOQ1'); return !!q && !!q.params.hex && q.params.hexSrc === q.params.code; })()")
    check(f'{tag}: เปิดแม่แบบ {pid} → วงจร {n_parts} ชิ้น + โปรแกรมตรงกับโค้ด', parts == n_parts and hexok, f'{parts} {hexok}')
    if mobile: close_drawers(page)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

        # ---------- 2) ระบบรดน้ำ ----------
        open_template(page, mobile, tag, 'watering', 'SOIL1', 7, 'ปรับเทียบ')
        page.click('#btn-run')
        ok, txt = wait_lcd(page, mobile, 'Watering (auto)', 90)
        ip = abs(page.evaluate(PART, ['PMP1', 'current']) or 0)
        check(f'{tag}: Run → จอ "Watering (auto)" + ปั๊มมีกระแส', ok and ip > 0.1, f'{txt!r} pump={ip:.3f}')
        if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-watering-2-run.png')
        ok, txt = wait_lcd(page, mobile, 'Idle', 120)
        m = page.evaluate(PART, ['SOIL1', 'moisture']) or 0
        ip = abs(page.evaluate(PART, ['PMP1', 'current']) or 0)
        diag = page.evaluate(DIAG)
        check(f'{tag}: ความชื้นถึง 60% → จอ "Idle" ปั๊มหยุด · ไม่มีคำเตือนอันตราย', ok and m >= 55 and ip < 1e-3 and 'danger:' not in diag, f'{txt!r} soil={m:.1f} pump={ip:.4f} {diag[:120]}')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.5)

        # ---------- 5) ระบบควบคุมมอเตอร์ ----------
        open_template(page, mobile, tag, 'motor', 'L293D', 9, 'L293D')
        page.click('#btn-run')
        ok, txt = wait_lcd(page, mobile, 'DC  74% FWD', 90)
        rpm = 0; t0 = time.time()
        while time.time() - t0 < 60 and rpm < 50:
            rpm = page.evaluate(PART, ['M1', 'rpm']) or 0; time.sleep(0.3)
        check(f'{tag}: Run → จอ "DC  74% FWD" + มอเตอร์หมุนเดินหน้า', ok and rpm > 50, f'{txt!r} rpm={rpm:.1f}')
        # ตัวแก้โค้ดต้องแสดงโค้ดของแม่แบบที่เพิ่งเปิด (บอร์ด id เดียวกับแม่แบบก่อนหน้า) และไม่ขึ้น "โค้ดแก้แล้ว"
        ed = page.evaluate("(() => { const c = document.getElementById('un-code'); const st = document.getElementById('un-status'); return { code: c ? c.value.slice(0, 60) : '', st: st ? st.textContent : '' }; })()")
        check(f'{tag}: ตัวแก้โค้ดแสดงโค้ดของแม่แบบ 5 (ไม่ค้างโค้ดแม่แบบ 2) · สถานะไม่ขึ้น "โค้ดแก้แล้ว"', 'ระบบควบคุมมอเตอร์' in ed['code'] and 'โค้ดแก้แล้ว' not in ed['st'], str(ed))
        if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-motor-2-run.png')
        props(page, mobile, 'PB1')
        b = page.locator('#f-press')
        b.scroll_into_view_if_needed(); bb = b.bounding_box()
        page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down()
        try: page.wait_for_function("(circuitLab.unoConsole || '').includes('DIR REV')", timeout=60000, polling=200)
        except Exception: pass
        page.mouse.up()
        rpm = 0; t0 = time.time()
        while time.time() - t0 < 60 and rpm > -50:
            rpm = page.evaluate(PART, ['M1', 'rpm']) or 0; time.sleep(0.3)
        ok, txt = wait_lcd(page, mobile, 'REV', 30)
        diag = page.evaluate(DIAG)
        check(f'{tag}: กดปุ่ม PB1 ในแผง → Serial "DIR REV" + จอ REV + มอเตอร์หมุนกลับ · ไม่มีคำเตือนอันตราย', 'DIR REV' in page.evaluate("circuitLab.unoConsole || ''") and ok and rpm < -50 and 'danger:' not in diag, f'{txt!r} rpm={rpm:.1f}')
        if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-motor-3-rev.png')
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
