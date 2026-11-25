"""E2E บอร์ดเฉพาะโมเดล (ไม่มีการจำลอง CPU): STM32F103C8T6 Blue Pill · Teensy 4.1 · Raspberry Pi Pico 2 — เดสก์ท็อป 1440×900 และมือถือ 390×844 + touch
1) คลังอุปกรณ์: ชื่อมี "(เฉพาะโมเดล)" → แตะรู → เสียบคร่อมร่องกลาง · โมเดล 3 มิติมีขาครบตามจำนวน (40 / 48 / 40) ชื่อขาตรงกับข้อมูลขา
2) แผงคุณสมบัติของแต่ละบอร์ด: ป้าย "เฉพาะโมเดล" · กล่องเตือน "ยังรันโค้ดไม่ได้" + เหตุผล · ความสามารถ Supported 0 · Partial 0
3) Run วงจรที่ต่อ LED + R เข้า PC13 ของ Blue Pill: LED ไม่ติด (ไม่มีไฟ) · คำแจ้ง "เป็นโมเดลเท่านั้น" · ไม่มีแท็บคอนโซลบอร์ด (ไม่มีการจำลองแทนด้วยบอร์ดอื่น) · ไม่มี JavaScript error
ใช้: python3 tests/e2e/modelonly_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i2c_common import SCREEN_OF, close_drawers, focus, props

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIXD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

BOARDS = [  # kind, คำค้น, รูที่แตะ, จำนวนขา, คำที่ต้องมีในกล่องเตือน
    ('bluepill', 'blue pill', 'i3', 40, 'STM32F103'),
    ('teensy41', 'teensy', 'i3', 48, 'i.MX RT1062'),
    ('pico2', 'rp2350', 'h3', 40, 'RP2040'),
]

def fresh(page):
    page.goto(URL)
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    page.evaluate('localStorage.clear()'); page.reload()
    page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
    time.sleep(0.6)
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
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.25)

        # 1) วางจากคลังทีละบอร์ด
        for kind, q, hole, npins, _ in BOARDS:
            fresh(page)
            if mobile: page.click('#btn-left'); time.sleep(0.3)
            page.fill('#lib-search', q); time.sleep(0.3)
            name = page.inner_text(f'.lib-item[data-kind="{kind}"] .nm') if page.locator(f'.lib-item[data-kind="{kind}"]').count() else ''
            page.click(f'.lib-item[data-kind="{kind}"]'); time.sleep(0.3)
            if mobile:
                try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
                except Exception: close_drawers(page)
                time.sleep(0.4)
            focus(page, hole, 22)
            p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': hole})
            tap(p['x'], p['y'])
            try: page.wait_for_function(f"circuitLab.doc.parts.some(p => p.kind === '{kind}')", timeout=5000)
            except Exception: pass
            m = page.evaluate("""(kind) => { const p = circuitLab.doc.parts.find(p => p.kind === kind); if (!p) return null; const g = circuitLab.view.partObjs.get(p.id);
              const names = new Set(); g.traverse((o) => { const n = o.userData.leadTip || (o.userData.isPin ? o.userData.pin : null); if (typeof n === 'string') names.add(n); });
              return { anchor: p.placement.anchor, pins: names.size, led: !!g.userData.picoLed }; }""", kind)
            # Pico 2 ใช้โมเดลแผ่นวงจร Pico: บนเบรดบอร์ดเลือกขาผ่านรู (ไม่มีวัตถุขาแยก) — ตรวจว่าไม่ผูก LED กับการจำลองแทน
            ok_pins = (m and m['pins'] == 0 and not m['led']) if kind == 'pico2' else (m and m['pins'] == npins)
            check(f'{tag}: คลัง → {kind} ("{name.strip()[:40]}") → แตะรู {hole} → เสียบได้ · ' + ('โมเดล Pico (LED ไม่ผูกกับการจำลอง)' if kind == 'pico2' else f'โมเดลมีขา {npins} ขา'), 'เฉพาะโมเดล' in name and m and m['anchor'] == hole and ok_pins, str(m))
            page.screenshot(path=f'{OUT}/{tag}-modelonly-1-{kind}.png')

        # 2) แผงคุณสมบัติ
        fresh(page)
        page.set_input_files('#file-input', os.path.join(FIXD, 'modelonly-start.json')); time.sleep(1.2)
        if page.locator('#dialog[open]').count(): page.keyboard.press('Escape')
        for pid, (kind, _, _, _, word) in zip(['U1', 'U2', 'U3'], BOARDS):
            props(page, mobile, pid)
            st = page.inner_text('#f-support') if page.locator('#f-support').count() else ''
            warn = page.inner_text('#f-modelonly-warn') if page.locator('#f-modelonly-warn').count() else ''
            feat = page.inner_text('#f-board-features summary') if page.locator('#f-board-features').count() else ''
            check(f'{tag}: แผงคุณสมบัติ {pid} ({kind}): "เฉพาะโมเดล" + "ยังรันโค้ดไม่ได้" + เหตุผล ({word}) · Supported 0 · Partial 0',
                  'เฉพาะโมเดล' in st and 'ยังรันโค้ดไม่ได้' in warn and word in warn and 'Supported 0' in feat and 'Partial 0' in feat,
                  (st[:30] + ' | ' + warn[:60] + ' | ' + feat).replace('\n', ' '))
            if mobile: close_drawers(page)
        page.screenshot(path=f'{OUT}/{tag}-modelonly-2-props.png')

        # 3) Run: LED ที่ต่อกับ PC13 ไม่ติด + คำแจ้ง
        if mobile: close_drawers(page)
        page.click('#btn-run'); time.sleep(2.5)
        r = page.evaluate("""(() => { const s = circuitLab.freshSim; if (!s) return null;
          return { led: s.analysis.parts.LED1 ? s.analysis.parts.LED1.current : null, msg: s.analysis.diagnostics.filter((d) => d.partId === 'U1').map((d) => d.message).join(' ') }; })()""")
        tab = page.locator('#dock-tab-pico').count()
        check(f'{tag}: Run → LED ที่ PC13 ไม่ติด · แจ้ง "เป็นโมเดลเท่านั้น" · ไม่มีแท็บคอนโซลบอร์ด (ไม่จำลองแทนด้วยบอร์ดอื่น)',
              r and r['led'] is not None and r['led'] < 1e-9 and 'เป็นโมเดลเท่านั้น' in r['msg'] and tab == 0, f'{r} tab={tab}')
        page.screenshot(path=f'{OUT}/{tag}-modelonly-3-run.png')
        page.click('#btn-stop'); time.sleep(0.3)
        check(f'{tag}: ไม่มี JavaScript error', not errors, str(errors[:3]))
        browser.close()

for m in MODES: run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
