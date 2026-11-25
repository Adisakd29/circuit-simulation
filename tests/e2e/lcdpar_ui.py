"""E2E จอ LCD 16×2 แบบขนาน (เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch) — ต้องมีบริการคอมไพล์ /api/compile (มีไลบรารี LiquidCrystal)
1) คลังอุปกรณ์ → "จอ LCD 16×2 แบบขนาน" → แตะรู j8 → เสียบแถวเดียว 16 ขา (anchor j8) · โมเดลมีขา VSS … K
2) แลป 57: Uno + จอ + VR + 220 Ω ต่อไว้แล้ว (VR ตั้ง 60% = V0 สูง) → ใส่โค้ดตัวอย่าง → คอมไพล์ + อัปโหลด (LiquidCrystal) → Run
   แผงคุณสมบัติของจอแสดง「Hello, World!」และเวลาที่บรรทัดล่าง · ความคมชัดต่ำ → พิกเซลตัวอักษรบนจอ 3 มิติจาง
3) หมุน VR เป็น 10% → ความคมชัด ≥ 50% · พิกเซลตัวอักษรสว่างชัดขึ้น · ตรวจผลแลปผ่านทั้ง 6 ข้อ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/lcdpar_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props, goals

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
    if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')

# จำนวนพิกเซลสีตัวอักษร (พื้นน้ำเงิน ตัวอักษรขาว) บนแคนวาสของจอในฉาก — วัดว่าภาพบนจอมาจากข้อมูลที่จำลองและความคมชัด
LIT = """(() => { const g = circuitLab.view.partObjs.get('LCD1'); const c = g && g.userData.lcdCanvas; if (!c) return -1;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 190 && d[i + 2] > 230) n++; return n; })()"""

def set_pos(page, mobile, v):
    props(page, mobile, 'VR1')
    page.evaluate(f"(() => {{ const s = document.getElementById('f-pos'); s.value = String({int(v * 1000)}); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }})()"); time.sleep(0.3)
    if mobile: close_drawers(page)

def lcd_rows(page, mobile):
    props(page, mobile, 'LCD1'); time.sleep(0.6)
    txt = page.inner_text('.panel.right')
    if mobile: close_drawers(page)
    return txt

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

        # 1) วางจากคลังอุปกรณ์
        fresh(page)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.fill('#lib-search', 'liquidcrystal'); time.sleep(0.3)
        page.click('.lib-item:has-text("แบบขนาน")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'j15', 30)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'j8'})
        if mobile: page.touchscreen.tap(p['x'], p['y'])
        else: page.mouse.click(p['x'], p['y'])
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'lcd1602p')", timeout=5000)
        except Exception: pass
        info = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.kind === 'lcd1602p'); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id); const tips = []; g && g.traverse(o => { if (o.userData.leadTip) tips.push(o.userData.leadTip); }); return { pl: p.placement, tips, canvas: !!(g && g.userData.lcdCanvas) }; })()")
        names = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E'] + [f'D{k}' for k in range(8)] + ['A', 'K']
        check(f'{tag}: คลังอุปกรณ์ → จอ LCD แบบขนาน → แตะรู j8 → เสียบหัวเข็ม 16 ขา (VSS … K) · มีจอแสดงผล', info and info['pl'].get('anchor') == 'j8' and sorted(info['tips']) == sorted(names) and info['canvas'], str(info)[:200])
        page.screenshot(path=f'{OUT}/{tag}-lcdp-0-placed.png')

        # 2) แลป 57
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'lesson57-lcdpar-start.json')); time.sleep(1.0)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("แบบขนาน")').count(): page.click('.lesson-card:has-text("แบบขนาน")'); time.sleep(0.3)
        page.locator('#lesson-sample-code').scroll_into_view_if_needed(); page.click('#lesson-sample-code'); time.sleep(0.4)
        if mobile: close_drawers(page)
        props(page, mobile, 'UNO1')
        page.locator('#f-uno-upload').scroll_into_view_if_needed(); page.click('#f-uno-upload')
        try: page.wait_for_function("!circuitLab.unoCompiling", timeout=90000, polling=200)
        except Exception: pass
        time.sleep(0.3)
        up = page.evaluate("(() => { const p = circuitLab.doc.parts.find(p => p.id === 'UNO1').params; return { hex: !!p.hex, fresh: p.hexSrc === p.code, lc: p.code.includes('LiquidCrystal'), err: circuitLab.unoError }; })()")
        check(f'{tag}: ใส่โค้ดตัวอย่างแลป 57 → คอมไพล์ + อัปโหลด (ไลบรารี LiquidCrystal)', up['hex'] and up['fresh'] and up['lc'] and not up['err'], str(up))
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(1.0)
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim?.analysis?.plcd?.LCD1; return s && s.chars > 20; })()", timeout=40000, polling=300)
        except Exception: pass
        time.sleep(0.8)
        txt = lcd_rows(page, mobile)
        m = re.search(r'ความคมชัด (\d+)%', txt)
        faint = page.evaluate(LIT)
        ok = re.search(r'「Hello, World!\s*」', txt) and re.search(r'「t = \d+ s\s*」', txt) and m and int(m.group(1)) < 25
        check(f'{tag}: Run → แผงคุณสมบัติจอ: 「Hello, World!」 + 「t = n s」 · VR 60% → ความคมชัดต่ำ (< 25%)', ok, f"{m and m.group(0)} {re.findall('「[^」]*」', txt)}")
        page.screenshot(path=f'{OUT}/{tag}-lcdp-1-faint.png')

        # 3) หมุน VR
        set_pos(page, mobile, 0.1)
        try: page.wait_for_function(f"(() => {{ const n = {LIT}; return n > {max(faint, 0)} + 2000; }})()", timeout=20000, polling=300)
        except Exception: pass
        time.sleep(0.6)
        clear = page.evaluate(LIT)
        txt = lcd_rows(page, mobile)
        m = re.search(r'ความคมชัด (\d+)%', txt)
        check(f'{tag}: หมุน VR 10% → V0 ต่ำ ความคมชัด ≥ 50% · พิกเซลตัวอักษรบนจอ 3 มิติชัดขึ้น', m and int(m.group(1)) >= 50 and clear > faint + 2000, f'{m and m.group(0)} lit {faint} → {clear}')
        if mobile:
            focus(page, 'j15', 22)
        page.screenshot(path=f'{OUT}/{tag}-lcdp-2-clear.png')
        g = goals(page, mobile, 'แบบขนาน', 6)
        check(f'{tag}: ตรวจผลแลป 57 ผ่าน power, wire, upload, text, contrast, backlight', {'power', 'wire', 'upload', 'text', 'contrast', 'backlight'} <= set(g), str(g))
        page.screenshot(path=f'{OUT}/{tag}-lcdp-3-goals.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
