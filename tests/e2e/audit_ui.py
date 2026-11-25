"""E2E รอบ Audit (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile (vite preview proxy → server/server.mjs)
1) แผงคุณสมบัติของ Uno / Pico / Raspberry Pi 5 มีตาราง "ความสามารถของบอร์ด" (Supported/Partial/Unsupported + หมายเหตุ + ตัวประมวลผลโค้ด)
2) Uno: คอมไพล์ sketch EEPROM จริง → อัปโหลด → Run → "boot 1" → RESET → "boot 2" (ค่าอยู่ใน EEPROM ที่จำลอง)
3) Uno: sketch watchdog 250 ms (เลี้ยงไว้ 1 s) → บอร์ดรีเซ็ตเอง ข้อความ start ขึ้นสองครั้ง
4) Uno: sketch ที่มี ISR(PCINT2_vect) คอมไพล์ผ่าน (เดิมไม่ผ่านเพราะสร้าง prototype ผิด) · ไม่มี JavaScript error
ใช้: python3 tests/e2e/audit_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
INO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures', 'uno')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

FEAT = """(() => { const d = document.getElementById('f-board-features'); if (!d) return null; d.open = true;
  return { summary: d.querySelector('summary').textContent, rows: [...d.querySelectorAll('tr[data-feat]')].map(r => [r.dataset.feat, r.lastChild.textContent]), engine: d.querySelector('.support-lim').textContent }; })()"""

def load(page, fixture):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    page.set_input_files('#file-input', os.path.join(FIXD, fixture)); time.sleep(1.0)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        # 1) ตารางความสามารถของบอร์ด
        for fx, pid, expect in [('lesson52-pulldown-start.json', 'PICO1', {'watchdog': 'Supported', 'spi': 'Partial'}), ('lesson54-rpi-start.json', 'RPI1', {'adc': 'ไม่มีในบอร์ด', 'i2c': 'Unsupported'}), ('lesson43-uno-start.json', 'UNO1', {'interrupt': 'Supported', 'spi': 'Partial', 'watchdog': 'Supported', 'storage': 'Supported'})]:
            load(page, fx)
            props(page, mobile, pid)
            f = page.evaluate(FEAT)
            rows = dict((k, v.split(' ', 1)[1]) for k, v in f['rows']) if f else {}
            ok = f and len(f['rows']) == 15 and all(rows.get(k) == v for k, v in expect.items())
            check(f'{tag}: แผงคุณสมบัติ {pid} มีตาราง "ความสามารถของบอร์ด" 15 หัวข้อ ระดับตรงกับผล Audit', ok, f"{f['summary'] if f else None} {[(k, rows.get(k)) for k in expect]}")
            if pid == 'RPI1': check(f'{tag}: RPI1 ระบุตัวประมวลผลว่า "ไม่จำลอง ... Linux"', f and 'ไม่จำลอง' in f['engine'] and 'Linux' in f['engine'], f['engine'][:80] if f else '')
            if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-audit-0-features.png') if not mobile else None
        props(page, mobile, 'UNO1')
        page.evaluate("document.getElementById('f-board-features').open = true")
        page.locator('#f-board-features').scroll_into_view_if_needed(); time.sleep(0.3)
        page.screenshot(path=f'{OUT}/{tag}-audit-1-features.png')

        def upload(name):
            code = open(os.path.join(INO, f'{name}.ino'), encoding='utf-8').read()
            props(page, mobile, 'UNO1')
            fld = page.locator('#f-uno-code'); fld.scroll_into_view_if_needed()
            fld.fill(code); fld.evaluate('e => { e.dispatchEvent(new Event("change")); e.blur(); }'); time.sleep(0.4)
            page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
            page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200); time.sleep(0.3)
            p = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'UNO1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, err: circuitLab.unoError }; })()")
            if mobile: close_drawers(page)
            return p
        def wait_con(js, timeout=30000):
            try: page.wait_for_function(js, timeout=timeout, polling=200); return True
            except Exception: return False

        # 2) EEPROM ข้าม RESET
        p = upload('eeprom')
        page.click('#btn-run')
        b1 = wait_con("/boot \\d+/.test(circuitLab.unoConsole || '')")
        n1 = page.evaluate("Number(/boot (\\d+)/.exec(circuitLab.unoConsole)[1])") if b1 else -1
        if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        if page.locator('#dock-tab-uno').count(): page.click('#dock-tab-uno'); time.sleep(0.3)
        if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
        page.click('#un-reset')
        b2 = wait_con(f"(circuitLab.unoConsole.match(/boot {n1 + 1}\\b/) || []).length > 0", 15000)
        check(f'{tag}: Uno คอมไพล์ sketch EEPROM จริง → Run "boot {n1}" → RESET → "boot {n1 + 1}" (ค่าเก็บใน EEPROM ที่จำลอง)', p['hex'] and p['fresh'] and b1 and n1 >= 1 and b2, f"{p} {page.evaluate('circuitLab.unoConsole')[-60:]!r}")
        page.screenshot(path=f'{OUT}/{tag}-audit-2-eeprom.png')
        # บันทึกไฟล์ → EEPROM ล่าสุดอยู่ในไฟล์งาน (ไบต์ 0 = จำนวนครั้งที่บูต)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        if mobile: page.click('#btn-more'); time.sleep(0.3)
        page.click('#btn-save'); time.sleep(0.5)
        saved = page.evaluate("(() => { const j = JSON.parse(document.getElementById('save-json').value); const u = j.circuit.parts.find(p => p.kind === 'uno'); if (!u.params.eeprom) return null; return atob(u.params.eeprom).charCodeAt(0); })()")
        page.keyboard.press('Escape'); time.sleep(0.3)
        check(f'{tag}: Save → ไฟล์งานมี EEPROM ของ Uno (ไบต์ 0 = {n1 + 1} ตรงกับจำนวนครั้งที่บูต)', saved == n1 + 1, str(saved))
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.click('#btn-stop'); time.sleep(0.5)

        # 3) watchdog
        p = upload('watchdog')
        page.click('#btn-run')
        w = wait_con("(circuitLab.unoConsole.match(/start t=0/g) || []).length >= 2", 40000)
        check(f'{tag}: Uno sketch watchdog 250 ms (เลี้ยง 1 s แล้วหยุด) → บอร์ดรีเซ็ตเอง ข้อความ "start" ขึ้นซ้ำ', p['hex'] and w, f"{page.evaluate('circuitLab.unoConsole')[-80:]!r}")
        page.click('#btn-stop'); time.sleep(0.5)

        # 4) ISR(...) คอมไพล์ผ่าน
        p = upload('interrupt')
        check(f'{tag}: sketch ที่มี ISR(PCINT2_vect) + attachInterrupt คอมไพล์ผ่าน (เดิม prototype ผิด "I SR(...)")', p['hex'] and p['fresh'] and not p['err'], str(p))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
