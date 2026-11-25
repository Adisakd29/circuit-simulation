"""E2E เครื่องวัดกำลังไฟฟ้า (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
1) วงจร DC (5 V → 1 kΩ): แผงผลการวัดแสดง "กำลังไฟฟ้า: แหล่งจ่ายรวม 25 mW · อุปกรณ์ใช้รวม 25 mW"
2) วงจร RC ตามเวลา (5 V → 1 kΩ → 1000 µF, τ = 1 s): แท็บ "กำลังไฟฟ้า" — แหล่ง PS1 · อุปกรณ์ R1, C1 · กำลังจ่ายลดลงตามเวลา (≈ 25 mW·e^(−t/τ))
   พลังงานสะสมตรงสูตร CV²(1 − e^(−t/τ)) ±3% · กราฟมีเส้น · ผลต่าง (จ่าย − R ใช้) = กำลังที่ C สะสม
3) แลป 57 (Uno + LCD แบบขนาน, ต้องมีบริการคอมไพล์): แหล่ง "UNO1 ขา 5V" ≈ 9 mA (2% ของ 500 mA) · อุปกรณ์ LCD1 R1 VR1 · จ่าย = ใช้ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/powermon_ui.py <out-dir> [url] [desktop,mobile]
"""
import math, os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def fresh(page, fixture):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
    page.set_input_files('#file-input', os.path.join(FIXD, fixture)); time.sleep(1.0)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

def open_power(page):
    if page.locator('#lg-show').count() and page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
    if page.locator('#lg-toggle').count() and page.get_attribute('#lg-toggle', 'aria-expanded') == 'false': page.click('#lg-toggle'); time.sleep(0.4)
    page.click('#dock-tab-power'); time.sleep(0.6)

def rows(page, table):
    return page.evaluate(f"[...document.querySelectorAll('#{table} tbody tr')].map(tr => [tr.dataset.key || '', ...[...tr.cells].map(c => c.textContent.trim())])")

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        # 1) DC
        fresh(page, 'power-dc.json')
        page.click('#btn-run'); time.sleep(1.2)
        if mobile: page.click('#btn-right'); time.sleep(0.5)
        txt = page.inner_text('#res-power') if page.locator('#res-power').count() else ''
        check(f'{tag}: วงจร DC 5 V → 1 kΩ: ผลการวัดแสดงกำลังไฟฟ้า แหล่งจ่ายรวม 25 mW = อุปกรณ์ใช้รวม 25 mW', 'แหล่งจ่ายรวม 25 mW' in txt and 'อุปกรณ์ใช้รวม 25 mW' in txt and 'PS1' in txt, txt)
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)

        # 2) RC
        fresh(page, 'power-rc.json')
        page.click('#btn-run'); time.sleep(1.0)
        open_power(page)
        try: page.wait_for_function("circuitLab.powerLog.T > 1.5", timeout=40000, polling=300)
        except Exception: pass
        st = page.evaluate("(() => { const l = circuitLab.powerLog; return { T: l.T, dt: l.last.dt, e: l.eIn, pin: l.last.pIn, pr: (l.last.loads.find(r => r.partId === 'R1') || {}).p, pc: (l.last.loads.find(r => r.partId === 'C1') || {}).p, eR: l.rows.get('R1'), n: l.hist.length, src: l.last.sources.map(s => s.label) }; })()")
        T = st['T']; tau = 1.0
        eTh = 1e-3 * 25 * (1 - math.exp(-T / tau))
        dt = st['dt'] or 1e-9
        pAvg = 0.025 * tau * (math.exp(-(T - dt) / tau) - math.exp(-T / tau)) / dt  # ค่าเฉลี่ยในช่วงล่าสุด
        check(f'{tag}: RC (τ = 1 s): พลังงานที่แหล่งจ่ายออก = CV²(1 − e^(−t/τ)) ±3% · กำลังเฉลี่ยช่วงล่าสุดตรงสูตร ±5%', T > 1.5 and abs(st['e'] / eTh - 1) < 0.03 and abs(st['pin'] / pAvg - 1) < 0.05, f"T={T:.2f} E={st['e']:.5f} theory={eTh:.5f} P={st['pin']:.6f} avg-theory={pAvg:.6f}")
        src = rows(page, 'pw-src'); load = rows(page, 'pw-load')
        check(f'{tag}: แท็บ "กำลังไฟฟ้า": แหล่ง PS1 (แหล่งจ่าย DC) · อุปกรณ์ R1 และ C1 (C กำลังสะสมพลังงาน) · ผลต่าง ≈ 0', any('PS1' in r[1] for r in src) and {'R1', 'C1'} <= {r[0] for r in load} and abs(st['pin'] - st['pr'] - st['pc']) < 1e-6, f'{src} {load}')
        n_lit = page.evaluate("(() => { const c = document.getElementById('pw-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 120) n++; return n; })()")
        check(f'{tag}: กราฟกำลังจ่ายรวมตามเวลามีเส้น (ประวัติ {st["n"]} จุด)', st['n'] >= 10 and n_lit > 50, f'lit={n_lit}')
        page.screenshot(path=f'{OUT}/{tag}-pw-rc.png')
        page.click('#btn-stop'); time.sleep(0.3)

        # 3) แลป 57
        fresh(page, 'lesson57-lcdpar-start.json')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("แบบขนาน")').count(): page.click('.lesson-card:has-text("แบบขนาน")'); time.sleep(0.3)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed(); page.click('#lesson-sample-code'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'UNO1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.0)
        open_power(page)
        try: page.wait_for_function("circuitLab.powerLog.T > 1", timeout=40000, polling=300)
        except Exception: pass
        time.sleep(0.6)
        src = rows(page, 'pw-src'); load = rows(page, 'pw-load')
        last = page.evaluate("(() => { const l = circuitLab.powerLog.last; return { pin: l.pIn, pout: l.pOut, i5: (l.sources.find(s => s.key === 'UNO1#5V') || {}).i }; })()")
        s5 = next((r for r in src if r[0] == 'UNO1#5V'), None)
        check(f'{tag}: แลป 57: แหล่ง "UNO1 ขา 5V" ≈ 9 mA (2% ของ 500 mA) · อุปกรณ์ LCD1, R1, VR1 · จ่าย = ใช้ ±1%', s5 and 'UNO1 ขา 5V' in s5[1] and abs(last['i5'] - 0.009) < 0.0015 and '% ของ 500 mA' in s5[5] and {'LCD1', 'R1', 'VR1'} <= {r[0] for r in load} and abs(last['pin'] - last['pout']) / last['pin'] < 0.01, f'{src} {[r[:3] for r in load]}')
        page.screenshot(path=f'{OUT}/{tag}-pw-uno.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
