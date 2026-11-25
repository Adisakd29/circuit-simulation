"""E2E แลป 45 จอ OLED + บัส I²C บน Pico (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรเริ่มต้น (Pico + โค้ด) → วางจอ OLED จากคลังที่ j22 (ป้าย "จำลองครบ") → ต่อสาย 4 เส้นด้วยเครื่องมือต่อสาย (GND VCC SCL SDA)
→ Run → รันโค้ด → Serial Monitor: found ['0x3c'] · บันทึกบัส I²C มี ACK · จอในฉากและแผงผลแสดง "Circuit Lab" และตัวนับที่เปลี่ยน
→ แลป 45 ผ่าน 4 ข้อ มีรูปวงจร → แก้โค้ดเพิ่ม oled.invert(1) → ข้อเสริมผ่าน → ไม่มี JavaScript error
ใช้: python3 tests/e2e/oled_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, focus, close_drawers, props, tool, goals, tap_factory, screen_text, cam_still

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson45-oled-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

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
        page.set_input_files('#file-input', FIX); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        tap, tap_hole = tap_factory(page, mobile)
        # 1) วางจอจากคลัง
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.fill('#lib-search', 'oled'); time.sleep(0.3)
        sup = page.inner_text('.lib-item[data-kind="ssd1306"] .nm')
        page.click('.lib-item[data-kind="ssd1306"]'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        tap_hole('j22', 16)
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'ssd1306')", timeout=5000)
        except Exception: pass
        od = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'ssd1306') || {})")
        check(f'{tag}: วางจอ OLED จากคลังที่ j22 (ป้ายระดับการรองรับ "จำลองครบ")', od.get('placement', {}).get('anchor') == 'j22' and 'จำลองครบ' in sup, f"{od.get('placement')} {sup}")
        oid = od.get('id')
        # 2) ต่อสาย 4 เส้น: GND (GND.38 คอลัมน์ 3) → i22, 3V3 (คอลัมน์ 5 แถวบน) → i23, GP5 (คอลัมน์ 7) → i24, GP4 (คอลัมน์ 6) → i25
        page.evaluate("circuitLab.select(null)")
        tool(page, 'ต่อสาย (W)')
        for a, b in [('j3', 'i22'), ('a5', 'i23'), ('j7', 'i24'), ('i6', 'i25')]:
            tap_hole(a); tap_hole(b)
        tool(page, 'เลือก / ย้าย (V)')
        ws = page.evaluate("circuitLab.doc.wires.map(w => [w.a.hole, w.b.hole].join('-'))")
        check(f'{tag}: ต่อสาย GND/VCC/SCL/SDA ด้วยเครื่องมือต่อสาย 4 เส้น', ws == ['j3-i22', 'a5-i23', 'j7-i24', 'i6-i25'], str(ws))
        # 3) Run + รันโค้ด
        page.click('#btn-run')
        page.wait_for_function("!!document.getElementById('pc-code') && circuitLab.mcu && circuitLab.mcu.booted", timeout=60000)
        page.click('#pc-run')
        try: page.wait_for_function("(circuitLab.picoConsole || '').includes('found:')", timeout=60000, polling=300)
        except Exception: pass
        con = page.evaluate("circuitLab.picoConsole")
        try: page.wait_for_function("circuitLab.i2cLog.some(l => l.startsWith('W 0x3c ACK'))", timeout=30000, polling=300)
        except Exception: pass
        log = page.evaluate("circuitLab.i2cLog.slice(0, 6)")
        check(f"{tag}: i2c.scan() พบ ['0x3c'] และบันทึกบัสแสดงการเขียนที่ 0x3C ได้ ACK", "found: ['0x3c']" in con and any(l.startswith('W 0x3c ACK') for l in page.evaluate("circuitLab.i2cLog")), f'{con[-60:]!r} {log}')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        props(page, mobile, oid)
        try: page.wait_for_function("(() => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); return dt && /count \\d+/.test(dt.nextElementSibling.textContent); })()", timeout=30000, polling=300)
        except Exception: pass
        # รอจนเห็นตัวเลข: I²C 400 kHz ส่งทั้งจอ (1,024 ไบต์) ใช้ ≈ 23 ms ตามจริง — อ่านกลางการส่งอาจได้ภาพที่เขียนไม่ครบ
        t1 = screen_text(page)
        try: page.wait_for_function(f"(() => {{ const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความที่อ่านได้บนจอ')); const s = dt && dt.nextElementSibling.textContent; return s && /count \\d+/.test(s) && s !== {t1!r}; }})()", timeout=20000, polling=300)
        except Exception: pass
        t2 = screen_text(page)
        check(f'{tag}: แผงผลอ่านข้อความบนจอ "Circuit Lab · Pico + OLED · count N" และตัวนับเปลี่ยน', 'Circuit Lab' in t1 and 'Pico + OLED' in t1 and 'count' in t2 and t1 != t2, f'{t1!r} → {t2!r}')
        if mobile: close_drawers(page)
        page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'pin', partId: '{oid}', pin: 'SCL'}}); v.controls.target.set(w.x - 0.5, 1, w.z + 5); v.persp.position.set(w.x - 0.5, 20, w.z + 20); v.controls.update(); v.requestRender(); }}""")
        time.sleep(1.2)
        lit = page.evaluate(f"""(() => {{ let c = null; circuitLab.view.scene.traverse(o => {{ if (!c && o.userData.oledCanvas && o.userData.partId === '{oid}') c = o.userData.oledCanvas; }}); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, 128, 64).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 100) n++; return n; }})()""")
        check(f'{tag}: จอในฉาก 3 มิติวาดพิกเซลจากหน่วยความจำจอ (มีพิกเซลสว่าง)', lit > 200, str(lit))
        page.screenshot(path=f'{OUT}/{tag}-oled-1-screen.png')
        # 4) แลป 45
        g = goals(page, mobile, 'จอ OLED', 4, 40000)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('OLED') && s.innerHTML.includes('GP4'); })()")
        check(f'{tag}: แลป 45 ผ่าน wire/ack/text/update และมีรูปวงจร', set(['wire', 'ack', 'text', 'update']) <= set(g) and svg_ok, f'{g} {svg_ok}')
        if mobile: close_drawers(page)
        # 5) แก้โค้ด: กลับสีจอ
        if page.locator('#lg-show').is_visible(): page.click('#lg-show'); time.sleep(0.3)
        code = page.evaluate("document.getElementById('pc-code').value")
        page.fill('#pc-code', code.replace('oled = ssd1306.SSD1306_I2C(128, 64, i2c)   # 0x3C', 'oled = ssd1306.SSD1306_I2C(128, 64, i2c)   # 0x3C\noled.invert(1)'))
        page.dispatch_event('#pc-code', 'change'); time.sleep(0.2)
        page.click('#pc-run')
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        g = goals(page, mobile, 'จอ OLED', 5, 40000)
        if mobile: close_drawers(page)
        props(page, mobile, oid); time.sleep(1.0)
        txt_inv = screen_text(page)
        dbg = [txt_inv] + page.evaluate(f"(() => {{ const s = circuitLab.freshSim; const o = s && s.analysis.i2c ? s.analysis.i2c['{oid}'] : null; return [circuitLab.picoConsole.slice(-200), o && o.invert, o && o.on, circuitLab.picoError, circuitLab.doc.parts.find(p => p.kind === 'pico').params.code.includes('invert')]; }})()")
        check(f'{tag}: เพิ่ม oled.invert(1) → ข้อเสริมกลับสีจอผ่าน (ครบ 5 ข้อ)', 'invert' in g, f'{g} {dbg}')
        page.screenshot(path=f'{OUT}/{tag}-oled-2-invert.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
