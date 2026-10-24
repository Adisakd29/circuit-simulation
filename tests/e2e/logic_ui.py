"""E2E: ไอซีเกตตรรกะ 74HC ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 25 (74HC08, สวิตช์ A = ON, B = OFF, ดึงลง 10 kΩ, ขาออก 1Y → 470 Ω → LED) → Run (DC)
→ กดปุ่มสวิตช์ในแผงคุณสมบัติให้ครบ 00/01/10/11 → LED ตามตาราง AND → เปลี่ยนรุ่นเป็น 74HC32 ด้วยชิปในแผง → ครบตาราง OR
→ แลป 25 ผ่านครบ 5 ข้อ → ชี้/แตะรู e10 → ป้าย "U1 · ขา 14 VCC" → ถอดตัวต้านทานดึงลง RB → เตือนขาเข้า 1B ลอย
→ วางไอซี 74HC ใหม่คร่อมร่องจากคลังอุปกรณ์
ใช้: python3 tests/e2e/logic_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson25-logic.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
STATE = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts['U1']) return null; const x = s.analysis.parts['U1'].extra;
  const sw = id => circuitLab.doc.parts.find(p => p.id === id).params.closed ? 1 : 0;
  return { a: sw('SA'), b: sw('SB'), ba: x.b1A, bb: x.b1B, q: x.q1, vo: x.vo1, led: s.analysis.parts['LED1'].current, model: circuitLab.doc.parts.find(p => p.id === 'U1').params.model }; })()"""
TIP = "(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()"
FOCUS = """() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'e13'});
  v.controls.target.set(w.x + 3, 0, w.z + 1.5); v.persp.position.set(w.x + 3, 16, w.z + 13); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""
FN = {'74HC08': lambda a, b: a & b, '74HC32': lambda a, b: a | b}

def close_drawer(page, mobile, side):
    if not mobile: return
    time.sleep(0.4)
    loc = page.locator(f'.panel.{side} .drawer-close')
    bb = loc.bounding_box() if loc.is_visible() else None
    if bb and 0 <= bb['x'] < page.viewport_size['width'] and 0 <= bb['y'] < page.viewport_size['height']: loc.click(force=True); time.sleep(0.4)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile:
        # ลิ้นชักขวา: ดูจากคลาส open (ตำแหน่งกล่องระหว่างแอนิเมชันเลื่อนออกยังอยู่ในจอ ทำให้เข้าใจผิดว่าเปิดอยู่)
        if not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def settle(page, a, b, model):
    page.wait_for_function(f"(() => {{ const x = {STATE}; return x && x.a === {a} && x.b === {b} && x.model === '{model}' && x.ba === {a} && x.bb === {b}; }})()", timeout=10000, polling=150)
    time.sleep(0.4)
    return page.evaluate(STATE)


def cam_still(page):
    """รอให้กล้องหยุดเลื่อน (OrbitControls มี damping — บนเครื่องที่วาดช้ากล้องยังเลื่อนต่อหลังตั้งตำแหน่ง)"""
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        cdp = ctx.new_cdp_session(page) if mobile else None
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
        page.evaluate(FOCUS); time.sleep(0.3)
        page.click('#btn-run')
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=20000, polling=250)
        cur = {'SA': 1, 'SB': 0}
        bad = []
        for model in ['74HC08', '74HC32']:
            if model != '74HC08':
                open_props(page, mobile, 'U1')
                page.click(f'#f-lg-{model}'); time.sleep(0.3)
                txt = page.inner_text('#props')
                check(f'{tag}: กดชิป {model} → รุ่นเปลี่ยน และตารางความจริงเป็น OR', page.get_attribute(f'#f-lg-{model}', 'aria-pressed') == 'true' and 'ตารางความจริง OR' in txt, txt[:120].replace('\n', ' | '))
                close_drawer(page, mobile, 'right')
            rows = []
            for a, b in [(0, 0), (0, 1), (1, 0), (1, 1)]:
                for sid, want in (('SA', a), ('SB', b)):
                    if cur[sid] != want:
                        open_props(page, mobile, sid)
                        page.click('#props .btn-row button'); time.sleep(0.2)
                        close_drawer(page, mobile, 'right')
                        cur[sid] = want
                s = settle(page, a, b, model)
                y = FN[model](a, b)
                ok = s['q'] == y and ((s['vo'] > 4.5 and s['led'] > 4e-3) if y else (s['vo'] < 0.05 and s['led'] < 1e-6))
                rows.append(f"{a}{b}->{s['q']} ({s['vo']:.2f} V, {s['led'] * 1e3:.2f} mA)")
                if not ok: bad.append((model, a, b, s))
                if model == '74HC08' and (a, b) == (1, 1):
                    page.evaluate(FOCUS); time.sleep(0.4); page.screenshot(path=f'{OUT}/{tag}-logic-1-and11.png')
            check(f'{tag}: {model} ตารางความจริงครบ 4 แถว ขาออก/LED ตรงทฤษฎี', not [x for x in bad if x[0] == model], ' · '.join(rows))
        # แลป 25
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("เกตตรรกะ")').count(): page.click('.lesson-card:has-text("เกตตรรกะ")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=8000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 25 ผ่านครบ 5 ข้อ (power/inputs/output/truth/second)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-logic-2-lesson.png')
        close_drawer(page, mobile, 'left')
        # ป้ายชื่อขาที่รู e10 (ขา 14 VCC)
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'e10'});
          v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 12, w.z + 9); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.5)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'e10'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate(TIP)
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู e10 → ป้าย "U1 · ขา 14 VCC ..."', t is not None and t.startswith('U1 · ขา 14 VCC'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-logic-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # ถอด RB และเปิดสวิตช์ B → ขาเข้า 1B ลอย
        if cur['SB']:
            open_props(page, mobile, 'SB'); page.click('#props .btn-row button'); time.sleep(0.2); close_drawer(page, mobile, 'right')
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts = doc.parts.filter(p => p.id !== 'RB');
          app.apply({ ok: true, doc, warnings: [] }, 'ถอด RB'); }""")
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.partId === 'U1' && d.message.includes('1B') && d.message.includes('ลอย')); })()", timeout=8000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'U1').map(d => d.message).join(' | ')")
        check(f'{tag}: ถอดตัวต้านทานดึงลง + สวิตช์ B เปิด → เตือนขาเข้า 1B ลอย', '1B' in d and 'ลอย' in d, d[:160])
        page.screenshot(path=f'{OUT}/{tag}-logic-4-float.png')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ไอซีเกตตรรกะ")'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'hole', boardId: 'bb1', hole: 'f3'});
          v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 14, w.z + 10); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }"""); time.sleep(0.2); cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f2'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'logic').map(p => [p.id, p.placement.anchor, p.params.model])")
        check(f'{tag}: วางไอซี 74HC ใหม่ที่ f2 คร่อมร่องจากคลังอุปกรณ์', len(m) == 2 and any(a == 'f2' for _, a, _m in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-logic-5-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
