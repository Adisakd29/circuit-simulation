"""E2E แลป 49 เครื่องวัดกำลังไฟฟ้า (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (Pico + INA219 อนุกรมกับ R 150 Ω + LED จาก VBUS + จอ TM1637 ที่ GP14/GP15) → แลป 49 → "ใส่โค้ดตัวอย่างลง Pico" → Run
→ scan พบ 0x40 · Serial แสดง V/I/P · แผงผล TM1637 "ตัวเลขบนจอ" = กระแสจริงจากแผงผล INA219 (ปัดเศษ) · จอในฉากมีส่วนสีแดงติด
→ เปลี่ยน R1 เป็น 330 Ω → ตัวเลขบนจอเปลี่ยนตาม → แลป 49 ผ่านครบ 5 ข้อ มีรูปวงจร · ไม่มี JavaScript error
ใช้: python3 tests/e2e/power_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers, props, goals, kv

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson49-power-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

# สัดส่วนพิกเซลสีแดงสว่าง (ส่วนที่ติด) บนแคนวาสจอ 7 ส่วนในฉาก
CANVAS = """(() => { const c = circuitLab.view.partObjs.get('DS1').userData.segCanvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let red = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 150 && d[i + 1] < 90) red++; } return red / (d.length / 4); })()"""
WAIT_SEG = "(re) => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ตัวเลขบนจอ')); return !!dt && new RegExp(re).test(dt.nextElementSibling.textContent); }"

def ma(s):
    m = re.search(r'([\d.]+)\s*(m|µ)?A', s or '')
    if not m: return None
    v = float(m[1])
    return v if m[2] == 'm' else v / 1000 if m[2] == 'µ' else v * 1000

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
        page.set_input_files('#file-input', FIX); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        goals(page, mobile, 'เครื่องวัดกำลังไฟฟ้า', 0, 1000)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed()
        page.click('#lesson-sample-code'); time.sleep(0.4)
        code = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').params.code")
        check(f'{tag}: ปุ่มโค้ดตัวอย่างใส่โค้ดแลป 49 (INA219 + TM1637)', 'TM1637' in code and 'wr(0x05, 4096)' in code, f'{len(code)}')
        if mobile: close_drawers(page)
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.picoConsole && /I=\\d+\\.\\d mA/.test(circuitLab.picoConsole)", timeout=90000, polling=400)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole")
        m = re.findall(r'V=([\d.]+) V  I=([\d.]+) mA  P=(\d+) mW', con)
        check(f"{tag}: scan พบ ['0x40'] · Serial แสดง V ≈ 5.0 V, I ≈ 20 mA, P ≈ 100 mW", "I2C: ['0x40']" in con and m and abs(float(m[-1][0]) - 5.0) < 0.05 and 18 < float(m[-1][1]) < 22 and 85 < int(m[-1][2]) < 115, f'{con[-120:]!r}')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, 'INA1')
        time.sleep(1.0)
        i_true = ma(kv(page, 'กระแสผ่าน shunt'))
        regs = kv(page, 'ค่าในรีจิสเตอร์')
        if mobile: close_drawers(page)
        props(page, mobile, 'DS1')
        try: page.wait_for_function(WAIT_SEG, arg='"\\s*\\d+"', timeout=30000, polling=300)
        except Exception: pass
        seg = kv(page, 'ตัวเลขบนจอ')
        sm = re.search(r'"\s*(\d+)"', seg or '')
        check(f'{tag}: จอ TM1637 แสดงกระแส (mA) ตรงกับกระแสจริงในวงจร · รีจิสเตอร์ calibration 4096', i_true and sm and abs(int(sm[1]) - i_true) <= 1 and 'calibration 4096' in (regs or ''), f'{seg!r} {i_true} {regs!r}')
        if mobile: close_drawers(page)
        page.evaluate("""() => { const v = circuitLab.view; const g = v.partObjs.get('DS1'); const tex = g.userData.segTex; let m = null; g.traverse((o) => { if (o.material && o.material.map === tex) m = o; });
          const p = m.getWorldPosition(v.controls.target.clone()); v.controls.target.copy(p); v.persp.position.set(p.x, p.y + 12, p.z + 55); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        red = page.evaluate(CANVAS)
        check(f'{tag}: จอ 7 ส่วนในฉากมีส่วนสีแดงที่ติด (วาดจากหน่วยความจำ TM1637 ที่จำลอง)', red > 0.03, f'{red:.3f}')
        page.screenshot(path=f'{OUT}/{tag}-power-1-display.png')
        # เปลี่ยน R1 = 330 Ω
        props(page, mobile, 'R1')
        fld = page.locator('#f-resistance'); fld.scroll_into_view_if_needed(); fld.fill('330'); fld.press('Enter'); time.sleep(0.5)
        if mobile: close_drawers(page)
        props(page, mobile, 'DS1')
        try: page.wait_for_function(WAIT_SEG, arg='"\\s*[5-9]"|"\\s*1[0-1]"', timeout=30000, polling=300)
        except Exception: pass
        seg2 = kv(page, 'ตัวเลขบนจอ')
        if mobile: close_drawers(page)
        props(page, mobile, 'INA1'); time.sleep(0.6)
        i2 = ma(kv(page, 'กระแสผ่าน shunt'))
        sm2 = re.search(r'"\s*(\d+)"', seg2 or '')
        check(f'{tag}: R1 = 330 Ω → จอแสดงกระแสใหม่ (≈ 9 mA) ตรงกับกระแสจริง', sm2 and i2 and abs(int(sm2[1]) - i2) <= 1 and 7 < i2 < 11, f'{seg2!r} {i2}')
        if mobile: close_drawers(page)
        g = goals(page, mobile, 'เครื่องวัดกำลังไฟฟ้า', 5, 60000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('INA219') && s.innerHTML.includes('TM1637'); })()")
        check(f'{tag}: แลป 49 ผ่านครบ 5 ข้อ (wire bus display current change) และมีรูปวงจร', len(g) == 5 and svg_ok, f'{g} {svg_ok}')
        page.screenshot(path=f'{OUT}/{tag}-power-2-lesson.png')
        if mobile: close_drawers(page)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(8, 0, 4); v.persp.position.set(8, 45, 60); v.controls.update(); v.requestRender(); }""")
        time.sleep(1.0)
        page.screenshot(path=f'{OUT}/{tag}-power-3-overview.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
