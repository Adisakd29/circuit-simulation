"""E2E เมนูโปรเจกต์จบ (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch)
แท็บแลป → การ์ด "เครื่องจ่ายยาอัตโนมัติ" → หน้ารายละเอียด (ระดับการจำลอง, รูปวงจร, BOM, ตารางจุดต่อ, ข้อจำกัด) → เปิดแม่แบบ
→ Run (โปรแกรมคอมไพล์ไว้แล้วจากโค้ดของแม่แบบ — ไม่ต้องใช้บริการคอมไพล์) → Serial READY + จอ LCD "Medicine Box"
→ กดค้างปุ่ม BTN2 ในแผง → Serial "DISPENSE 2" + SV2 หมุนเกิน 80° ช่องอื่นนิ่ง → ปิดกลับ · ไม่มีคำเตือนอันตราย · ไม่มี JavaScript error
แม่แบบที่ยังไม่พร้อมแสดงสถานะ "วางแผน" พร้อมเหตุผล (ไม่มีปุ่มเปิดแม่แบบ)
ใช้: python3 tests/e2e/finalproj_ui.py <out-dir> [url] [desktop,mobile]
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
ANG = "(id) => { const s = circuitLab.freshSim; const r = s && s.analysis.parts[id]; return r && r.extra ? r.extra.angle : null; }"
WAIT_TEXT = "(re) => { const dt = [...document.querySelectorAll('#prop-readings dt')].find(t => t.textContent.includes('ข้อความบนจอ')); return !!dt && new RegExp(re).test(dt.nextElementSibling.textContent); }"

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

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
        if mobile: page.click('#btn-left'); time.sleep(0.4)
        page.click('#tab-lessons'); time.sleep(0.3)
        n_cards = page.locator('.proj-card').count()
        n_planned = page.locator('.proj-card.planned').count()
        check(f'{tag}: แท็บแลปมีหมวดโปรเจกต์จบ 6 แม่แบบ (พร้อม 3, วางแผน 3)', n_cards == 6 and n_planned == 3, f'{n_cards} {n_planned}')
        # แม่แบบที่ยังวางแผน
        page.click('#proj-greenhouse'); time.sleep(0.4)
        st = page.inner_text('#proj-status') if page.locator('#proj-status').count() else ''
        check(f'{tag}: แม่แบบที่ยังไม่พร้อม → สถานะ "วางแผน" ไม่มีปุ่มเปิดแม่แบบ', 'วางแผน' in st and page.locator('#proj-open').count() == 0, st)
        page.click('#proj-close'); time.sleep(0.3)
        # เครื่องจ่ายยา
        page.click('#proj-dispenser'); time.sleep(0.6)
        st = page.inner_text('#proj-status')
        bom = page.locator('#proj-bom tr').count()
        wires = page.locator('#proj-wires tr').count()
        svg = page.evaluate("(() => { const s = document.querySelector('#proj-schematic svg'); return !!s && s.innerHTML.includes('UNO Q') && s.innerHTML.includes('SV4'); })()")
        lim = page.inner_text('#proj-limits')
        check(f'{tag}: หน้ารายละเอียด: ระดับการจำลอง (behavioral) + รูปวงจร + BOM 12 รายการ + ตารางจุดต่อ + ข้อจำกัด', 'จำลองพฤติกรรม' in st and svg and bom == 13 and wires > 40 and 'STM32U585' in lim, f'bom={bom} wires={wires} svg={svg}')
        page.screenshot(path=f'{OUT}/{tag}-finalproj-1-detail.png')
        page.click('#proj-open'); time.sleep(1.2)
        parts = page.evaluate("circuitLab.doc.parts.length")
        hexok = page.evaluate("(() => { const q = circuitLab.doc.parts.find(p => p.id === 'UNOQ1'); return !!q && !!q.params.hex && q.params.hexSrc === q.params.code; })()")
        check(f'{tag}: เปิดแม่แบบ → วงจร 18 ชิ้น + โปรแกรมตรงกับโค้ด', parts == 18 and hexok, f'{parts} {hexok}')
        if mobile: close_drawers(page)
        page.evaluate("() => { const v = circuitLab.view; v.controls.target.set(10, 0, 5); v.persp.position.set(10, 150, 120); v.controls.update(); v.requestRender(); }")
        page.click('#btn-run')
        try: page.wait_for_function("circuitLab.unoConsole && circuitLab.unoConsole.includes('READY')", timeout=60000, polling=300)
        except Exception: pass
        props(page, mobile, 'LCD1')
        try: page.wait_for_function(WAIT_TEXT, arg='Medicine Box', timeout=30000, polling=300)
        except Exception: pass
        ok_lcd = page.evaluate(WAIT_TEXT, 'Medicine Box')
        check(f'{tag}: Run → Serial READY และจอ LCD แสดง "Medicine Box" (จากคำสั่ง I²C ของโค้ด)', 'READY' in page.evaluate('circuitLab.unoConsole') and ok_lcd, page.evaluate('circuitLab.unoConsole')[-60:])
        # เซอร์โวเริ่มที่ 90° แล้วหมุนปิดเองตามโค้ด (~0.25 s เวลาจำลอง ≈ หลายวินาทีบนเครื่องช้า) — รอให้ทุกช่องปิด (< 8°) ก่อนกด
        # ไม่งั้นค่าสูงสุดของช่องอื่นที่วัดหลังกดรวมช่วงที่ยังหมุนปิดอยู่ (เคยล้มบนเดสก์ท็อป: SV1 = 10–27°)
        try: page.wait_for_function("['SV1','SV2','SV3','SV4'].every(k => { const s = circuitLab.freshSim; const r = s && s.analysis.parts[k]; return r && r.extra && r.extra.angle < 8; })", timeout=30000, polling=200)
        except Exception: pass
        # กดค้าง BTN2
        props(page, mobile, 'BTN2')
        b = page.locator('#f-press'); b.scroll_into_view_if_needed(); bb = b.bounding_box()
        page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down()
        try: page.wait_for_function("circuitLab.unoConsole.includes('DISPENSE 2')", timeout=20000, polling=200)
        except Exception: pass
        page.mouse.up()
        mx = {k: 0.0 for k in ['SV1', 'SV2', 'SV3', 'SV4']}
        t0 = time.time()
        while time.time() - t0 < 8 and mx['SV2'] < 80:
            for k in mx:
                a = page.evaluate(ANG, k)
                if a is not None: mx[k] = max(mx[k], a)
            time.sleep(0.1)
        check(f'{tag}: กด BTN2 (มีถ้วย) → Serial "DISPENSE 2" + SV2 หมุนเกิน 80° ช่องอื่นนิ่ง', 'DISPENSE 2' in page.evaluate('circuitLab.unoConsole') and mx['SV2'] > 80 and max(mx['SV1'], mx['SV3'], mx['SV4']) < 8, str(mx))
        if mobile: close_drawers(page)
        time.sleep(0.6)
        page.screenshot(path=f'{OUT}/{tag}-finalproj-2-running.png')
        try: page.wait_for_function(f"({ANG})('SV2') < 8", timeout=20000, polling=200)
        except Exception: pass
        diag = page.evaluate(DIAG)
        check(f'{tag}: ปิดช่องกลับ (SV2 < 8°) · ไม่มีคำเตือนอันตราย', (page.evaluate(ANG, 'SV2') or 99) < 8 and 'danger:' not in diag, diag[:200])
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
