"""E2E ส่งออกโครงงาน (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
เปิดวงจรแลป 43 (Uno + R + LED) → Run → ปุ่ม Export (มือถือ: ในเมนู) → หน้าต่างสรุปจำนวน → ดาวน์โหลดเอกสาร HTML:
มี BOM (Arduino Uno, ตัวต้านทาน 220 Ω, LED แดง), ตารางต่อขา D13, รายการสาย, ภาพมุมบนจากฉาก (PNG ไม่ว่าง), โค้ด sketch, รายการตรวจก่อนจ่ายไฟ, ข้อจำกัด
→ ดาวน์โหลด BOM CSV (UTF-8 BOM) และโค้ด .ino ตรงกับโค้ดในบอร์ด · มุมกล้องของผู้ใช้ไม่เปลี่ยนหลังส่งออก · ไม่มี JavaScript error
ใช้: python3 tests/e2e/export_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time, re, base64
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import close_drawers

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson43-uno-start.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

CAM = "(() => { const v = circuitLab.view; return [v.view, ...v.persp.position.toArray(), ...v.controls.target.toArray()].map(x => typeof x === 'number' ? x.toFixed(3) : x).join(); })()"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1, accept_downloads=True)
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
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(2.0)
        cam0 = page.evaluate(CAM)
        if mobile: page.click('#btn-more'); time.sleep(0.3)
        page.click('#btn-export'); time.sleep(1.0)
        info = page.inner_text('#export-dlg') if page.locator('#export-dlg').count() else ''
        check(f'{tag}: ปุ่ม Export เปิดหน้าต่างส่งออก สรุปจำนวนอุปกรณ์/ขา/สาย/โค้ด', 'อุปกรณ์' in info and 'สาย' in info and 'โค้ด 1 ไฟล์' in info, info[:120])
        page.screenshot(path=f'{OUT}/{tag}-export-1-dialog.png')
        with page.expect_download(timeout=20000) as dl:
            page.click('#export-html')
        p = dl.value.path(); html = open(p, encoding='utf-8').read()
        open(f'{OUT}/{tag}-project.html', 'w', encoding='utf-8').write(html)
        img = re.search(r'<img src="data:image/png;base64,([A-Za-z0-9+/=]+)"', html)
        png_ok = bool(img) and len(base64.b64decode(img[1])) > 20000
        need = ['รายการอุปกรณ์ (BOM)', 'Arduino Uno', '220 Ω', 'สีแดง', 'ตารางต่อขาของบอร์ด', 'D13', 'สายจัมเปอร์', 'Hardware Validation Checklist', 'ข้อจำกัดที่ยังไม่ได้ตรวจจากการจำลอง', 'Serial.begin', 'ไม่ได้รับรองความปลอดภัย', 'คำเตือนจากการจำลองล่าสุด']
        miss = [s for s in need if s not in html]
        check(f'{tag}: ดาวน์โหลดเอกสารโครงงาน HTML ครบทุกหัวข้อ + ภาพมุมบนจากฉาก (PNG) + โค้ดจริงของบอร์ด', not miss and png_ok and 'ยังไม่ได้กด Run ก่อนส่งออก</p>' not in html, f'miss={miss} png={png_ok} {len(html)}')
        cam1 = page.evaluate(CAM)
        check(f'{tag}: มุมกล้องของผู้ใช้เหมือนเดิมหลังถ่ายภาพสำหรับเอกสาร', cam0 == cam1, f'{cam0} / {cam1}')
        with page.expect_download(timeout=20000) as dl:
            page.click('#export-bom')
        csv = open(dl.value.path(), encoding='utf-8').read()
        check(f'{tag}: BOM CSV (UTF-8 + BOM สำหรับ Excel) มี Arduino Uno และ LED', csv.startswith('﻿') and 'Arduino Uno' in csv and 'LED' in csv, csv[:80])
        with page.expect_download(timeout=20000) as dl:
            page.click('#export-code-0')
        ino = open(dl.value.path(), encoding='utf-8').read()
        code = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'uno').params.code")
        check(f'{tag}: ดาวน์โหลดโค้ด .ino ตรงกับโค้ดในบอร์ด ({dl.value.suggested_filename})', ino == code and dl.value.suggested_filename.endswith('.ino'), dl.value.suggested_filename)
        page.keyboard.press('Escape'); time.sleep(0.3)
        pg = ctx.new_page(); pg.goto('file://' + os.path.abspath(f'{OUT}/{tag}-project.html')); time.sleep(0.8)
        pg.screenshot(path=f'{OUT}/{tag}-export-2-doc.png', full_page=False); pg.close()
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
