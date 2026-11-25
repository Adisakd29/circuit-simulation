"""E2E: คอมพาราเตอร์ LM393 เทอร์โมสตัท ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 37 (วงแบ่ง NTC → IN+, ทริมพอต → IN−, LED + 470 Ω → OUTA) → Run → 25 °C LED ดับ แผงผล "ลอย" ช่อง B "ไม่ใช้"
→ ชิป 60 °C → ขาออกดึงลง LED ติดในฉาก → 25 °C ดับ → แลป 37 ข้อบังคับผ่าน
→ แถบเลื่อนพอต 30% (จุดตัดต่ำกว่าห้อง) → LED ติดที่ 25 °C → คืน 65.4% → ใส่ RH 100 kΩ → ร้อน/เย็น → hyst ผ่าน (6/6)
→ ขาออกป้อนกลับเข้า IN− → แจ้ง "คอมพาราเตอร์สลับสถานะไม่หยุด" → ป้ายขา "U1 · ขา 3 INA+" → วาง LM393 ใหม่จากคลัง
ใช้: python3 tests/e2e/comparator_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson37-comparator.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s) return null; if (!s.analysis.ok) return { err: (s.result && s.result.error && s.result.error.message) || 'fail' }; const x = s.analysis.parts.U1 && s.analysis.parts.U1.extra; if (!x) return null;
  const g = circuitLab.view.partObjs.get('LED1'); const sp = g && g.userData.glowSprite;
  return { on: x.onA, vp: x.vpA, vn: x.vnA, vo: x.voA, t: circuitLab.doc.parts.find(p => p.id === 'TH1').params.temperature, led: s.analysis.parts.LED1.current, glow: sp ? sp.material.opacity : -1 }; })()"""

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def toggle(page, mobile, sw):
    open_props(page, mobile, sw)
    page.click('#props .btn-row button'); time.sleep(0.3)
    if mobile: close_drawers(page)

def wait_st(page, cond, timeout=20000):
    try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && ({cond}); }})()", timeout=timeout, polling=100)
    except Exception: pass
    return page.evaluate(ST)

def tap_hole(page, mobile, hole):
    p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': hole})
    if mobile: page.touchscreen.tap(p['x'], p['y'])
    else: page.mouse.click(p['x'], p['y'])
    time.sleep(0.3)

def temp(page, mobile, t):
    open_props(page, mobile, 'TH1')
    page.click(f'#f-ntc-{t}'); time.sleep(0.3)
    if mobile: close_drawers(page)
    return wait_st(page, f's.t === {t}')

def pot(page, mobile, val):
    open_props(page, mobile, 'VR1')
    page.evaluate(f"(() => {{ const s = document.getElementById('f-pos'); s.value = '{val}'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }})()"); time.sleep(0.3)
    if mobile: close_drawers(page)

def apply(page, js, label):
    page.evaluate(f"""() => {{ const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); {js}; app.apply({{ ok: true, doc, warnings: [] }}, '{label}'); }}""")

def goals(page, mobile, n):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("LM393")').count(): page.click('.lesson-card:has-text("LM393")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=20000, polling=250)
    except Exception: pass
    return page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")

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
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        check(f'{tag}: เปิดไฟล์แลป 37 (schema 34) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        s = wait_st(page, 's.on === 0')
        open_props(page, mobile, 'U1'); time.sleep(0.4)
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        check(f'{tag}: Run ที่ 25 °C → VT > VREF ขาออกลอย LED ดับ · แผงผล "ลอย" ช่อง B "ไม่ใช้"', s and s['on'] == 0 and s['vp'] > s['vn'] and s['led'] < 1e-4 and 'ลอย (IN+ > IN−)' in txt and 'ไม่ใช้' in txt, f"{s} {txt[txt.find('ไฟเลี้ยง'):][:160]!r}")
        s = temp(page, mobile, 60)
        s = wait_st(page, 's.on === 1 && s.glow > 0.3')
        check(f'{tag}: ชิป 60 °C → VT < VREF ขาออกดึงลง (< 0.5 V) LED ≈ 6 mA ติดในฉาก', s and s['on'] == 1 and s['vo'] < 0.5 and 5e-3 < s['led'] < 7e-3 and s['glow'] > 0.3, str(s))
        focus(page, 'g18', 16)
        page.screenshot(path=f'{OUT}/{tag}-cmp-1-hot.png')
        s = temp(page, mobile, 25)
        s = wait_st(page, 's.on === 0')
        check(f'{tag}: กลับ 25 °C → LED ดับ', s and s['on'] == 0 and s['led'] < 1e-4, str(s))
        g = goals(page, mobile, 5)
        check(f'{tag}: แลป 37 ข้อบังคับผ่านครบ (power/inputs/output/setpoint/alarm)', all(k in g for k in ['power', 'inputs', 'output', 'setpoint', 'alarm']), str(g))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('LM393') && s.innerHTML.includes('RH'); })()")
        check(f'{tag}: แลป 37 มีรูปวงจร (LM393, NTC, RH)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-cmp-2-lesson.png')
        if mobile: close_drawers(page)
        pot(page, mobile, 300)
        s = wait_st(page, 's.on === 1')
        check(f'{tag}: เลื่อนพอตเป็น 30% (VREF ≈ 3.5 V จุดตัดต่ำกว่าห้อง) → LED ติดที่ 25 °C', s and s['on'] == 1 and s['t'] == 25 and s['vn'] > 3, str(s))
        pot(page, mobile, 654)
        wait_st(page, 's.on === 0')
        apply(page, "doc.parts.push({ id: 'RH', label: 'RH', kind: 'resistor', placement: { kind: 'board', boardId: 'bb1', anchor: 'g20', rotation: 0 }, params: { resistance: 100000, powerRating: 0.25, span: 2 } })", 'ใส่ RH')
        temp(page, mobile, 60); s1 = wait_st(page, 's.on === 1')
        temp(page, mobile, 25); s2 = wait_st(page, 's.on === 0')
        g = goals(page, mobile, 6)
        check(f'{tag}: ใส่ RH 100 kΩ แล้วร้อน/เย็น → แลป 37 ผ่านครบ 6 ข้อ (รวม hyst)', len(g) == 6 and s1 and s1['on'] == 1 and s2 and s2['on'] == 0, f'{g} {s1} {s2}')
        if mobile: close_drawers(page)
        apply(page, "doc.wires = doc.wires.filter(w => w.id !== 'w8'); doc.wires.push({ id: 'fb', a: { kind: 'hole', boardId: 'bb1', hole: 'i20' }, b: { kind: 'hole', boardId: 'bb1', hole: 'g21' }, color: '#1e88e5', arc: 2, bend: 0 })", 'ป้อนกลับลบ')
        s = wait_st(page, 's.err !== undefined')
        body = page.evaluate("document.body.innerText")
        check(f'{tag}: ขาออกป้อนกลับเข้า IN− → แจ้ง "คอมพาราเตอร์สลับสถานะไม่หยุด" บนหน้าจอ', s and 'คอมพาราเตอร์สลับสถานะไม่หยุด' in str(s.get('err')) and 'คอมพาราเตอร์สลับสถานะไม่หยุด' in body, str(s))
        apply(page, "doc.wires = doc.wires.filter(w => w.id !== 'fb')", 'เอาออก')
        page.click('#btn-stop'); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'f22', 7)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'INA+'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา 3 → ป้าย "U1 · ขา 3 INA+"', t is not None and t.startswith('U1 · ขา 3 INA+'), str(t))
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("คอมพาราเตอร์ LM393")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        focus(page, 'f5', 18)
        tap_hole(page, mobile, 'f5')
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'comparator').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'comparator').map(p => p.placement.anchor)")
        check(f'{tag}: วาง LM393 ตัวใหม่จากคลังที่ f5 (คร่อมร่องกลาง)', len(n) == 2 and 'f5' in n, str(n))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
