"""E2E: slew rate / แบนด์วิดท์ของออปแอมป์ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 14 (LM741 ตามแรงดัน สี่เหลี่ยม 10 Vpp) → Run → สโคปวัดความชันขาขึ้น ≈ 0.5 V/µs →
แก้ค่า slew rate ในแผงคุณสมบัติ → ความชันเปลี่ยนตาม → Undo → กราฟโบดลดลงที่ 1 MHz → แลป 14 ตรวจผ่าน
ใช้: python3 tests/e2e/opamp_ui.py <out-dir> [url]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson14-slew.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

M2 = "(() => { const a = circuitLab; const s = a.scopePart(); return a.scope.frame(s.params).measure[1]; })()"

def wait_slew(page, lo, hi, timeout=60000):
    """รอจนความชันขาขึ้นของ CH2 อยู่ในช่วง (สโคปเก็บข้อมูล 3 จอ ต้องรอให้ข้อมูลเก่าหลุดไป)"""
    try:
        page.wait_for_function(f"(() => {{ const m = {M2}; return m && m.slew !== null && m.slew > {lo} && m.slew < {hi}; }})()", timeout=timeout, polling=250)
    except Exception:
        pass
    return page.evaluate(M2)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        u = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'opamp').params")
        check(f'{tag}: เปิดไฟล์แลป 14 (schema 10) ออปแอมป์มี GBW 1 MHz / SR 0.5 V/µs', u.get('gbw') == 1e6 and u.get('slewRate') == 5e5, json.dumps(u))
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.sim && window.circuitLab.sim.mode === 'tran'", timeout=10000)
        m = wait_slew(page, 4.5e5, 5.5e5)
        meas = page.inner_text('#sc-meas') if page.locator('#sc-meas').is_visible() else ''
        check(f'{tag}: สโคปวัดความชันขาขึ้น CH2 ≈ 0.5 V/µs (±10%)', m and m.get('slew') and abs(m['slew'] / 5e5 - 1) < 0.1,
              f"slew={m and m.get('slew')} rise={m and m.get('rise')} simT={page.evaluate('circuitLab.freshSim && circuitLab.freshSim.t')} paused={page.evaluate('circuitLab.simc.paused')} | {meas[:160]}".replace('\n', ' | '))
        if not mobile: check(f'{tag}: แถบค่าวัดใต้จอสโคปแสดง "ขาขึ้น 10–90%" และ V/µs', 'ขาขึ้น 10–90%' in meas and 'V/µs' in meas, meas.replace('\n', ' | ')[:200])
        page.screenshot(path=f'{OUT}/{tag}-op-1-slew.png')
        # แก้ค่า slew rate ในแผงคุณสมบัติ
        page.evaluate("circuitLab.select({t: 'part', id: 'U1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.evaluate("document.querySelector('#props details') && (document.querySelector('#props details').open = true)"); time.sleep(0.2)
        check(f'{tag}: แผงคุณสมบัติมีช่อง GBW และ Slew rate', page.locator('#f-gbw').count() == 1 and page.locator('#f-slewRate').count() == 1)
        page.fill('#f-slewRate', '1M'); page.press('#f-slewRate', 'Enter'); time.sleep(0.5)
        sr = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U1').params.slewRate")
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        m2 = wait_slew(page, 0.9e6, 1.1e6)
        check(f'{tag}: ตั้ง slew rate 1 V/µs → ความชันขาออกเปลี่ยนเป็น ≈ 1 V/µs', sr == 1e6 and m2 and m2.get('slew') and abs(m2['slew'] / 1e6 - 1) < 0.1, f"param={sr} slew={m2 and m2.get('slew')}")
        page.keyboard.press('Control+z'); time.sleep(0.4)
        sr2 = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U1').params.slewRate")
        check(f'{tag}: Undo กลับเป็น 0.5 V/µs', sr2 == 5e5, str(sr2))
        m3 = wait_slew(page, 4.5e5, 5.5e5)
        try: page.wait_for_function(f"(() => {{ const m = {M2}; return m && m.vpp > 9.9; }})()", timeout=30000)
        except Exception: pass
        time.sleep(0.5)
        page.screenshot(path=f'{OUT}/{tag}-op-1b-slew-settled.png')
        m3 = page.evaluate(M2)
        check(f'{tag}: หลังนิ่ง (ขาออก ±5 V): เวลาขาขึ้น 10–90% ≈ 16 µs', m3 and m3.get('rise') and abs(m3['rise'] / 16e-6 - 1) < 0.1, f"rise={m3 and m3.get('rise')} vpp={m3 and m3.get('vpp')}")
        # กราฟโบด: ตามแรงดัน อัตราขยาย 1 ลดลงใกล้ 1 MHz
        page.click('#dock-tab-bode'); time.sleep(0.3)
        try:
            page.wait_for_function("window.circuitLab.bode && window.circuitLab.bode.doc === window.circuitLab.doc && window.circuitLab.bode.data", timeout=15000)
            d = page.evaluate("(() => { const d = circuitLab.bode.data; return { ok: d.ok, m0: d.mag[0], m1: d.mag[d.mag.length - 1], f1: d.freqs[d.freqs.length - 1] }; })()")
        except Exception as ex:
            d = {'err': str(ex)[:100]}
        check(f'{tag}: กราฟโบดตามแรงดัน: 0 dB ที่ 100 Hz และ ≈ −3 dB ที่ 1 MHz (ขั้วของ GBW)', d.get('ok') and abs(d['m0']) < 0.01 and -3.5 < d['m1'] < -2.5, json.dumps(d))
        page.screenshot(path=f'{OUT}/{tag}-op-2-bode.png')
        page.click('#dock-tab-scope') if page.locator('#dock-tab-scope').count() else None
        time.sleep(0.3)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("slew rate")').count(): page.click('.lesson-card:has-text("slew rate")')
        time.sleep(1.0)
        goals = page.inner_text('#lesson-goals')
        n_pass = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 14 ตรวจผ่าน ≥ 4 ข้อ (power/circuit/scope/slew)', page.locator('#lesson-goals .goal').count() == 6 and n_pass >= 4, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-op-3-lesson.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
