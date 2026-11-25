"""E2E: สมาร์ตฟาร์ม — เซนเซอร์ความชื้นในดิน + ปั๊มน้ำผ่านรีเลย์ + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดแลป 40 (ดิน 25%) → Run → โค้ด Pico เปิดรีเลย์ ปั๊ม ≈ 90 L/h ≈ 0.18 A · สายน้ำไหลจากปลายสายยางลงกระถาง · แผงผล/console
→ ความชื้นเกิน 60% ปั๊มหยุดเอง ดินสีเข้มขึ้น → วัด AOUT ด้วยโพรบ → ตั้งดินแห้ง 10% → รดซ้ำและหยุดอีกรอบ → แลป 40 ครบ 8 ข้อ มีรูปวงจร
→ ถอดสายยางจากกระถาง/ต่อกลับ → ป้ายขา "MS1 · สายเหลือง AOUT" → วางปั๊มใหม่จากคลัง · ไม่มี JavaScript error
ใช้: python3 tests/e2e/smartfarm_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson40-smartfarm.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.MS1 || !s.analysis.parts.P1) return null; const m = s.analysis.parts.MS1.extra, p = s.analysis.parts.P1, k = s.analysis.parts.K1;
  const g = circuitLab.view.partObjs.get('P1'), h = g && g.userData.hoseObj, st = h && h.userData.pumpStream;
  const sm = circuitLab.view.partObjs.get('MS1').userData.soilMat;
  return { m: m.moisture, vout: m.vout, inflow: m.inflow, flow: p.extra.flow, ip: Math.abs(p.current || 0), relay: k ? k.extra.energized : null, stream: !!(st && st.visible), lum: sm ? sm.color.r + sm.color.g + sm.color.b : null,
    diags: s.analysis.diagnostics.filter(d => d.partId === 'MS1' || d.partId === 'P1').map(d => d.severity + ':' + d.message.slice(0, 50)) }; })()"""
HOSE = """(() => { const v = circuitLab.view; const g = v.partObjs.get('P1'), t = v.partObjs.get('MS1'); const st = g.userData.hoseObj.userData.pumpStream;
  st.updateMatrixWorld(true); const a = st.getWorldPosition(new st.position.constructor()); const c = t.localToWorld(new st.position.constructor(0, 0, -12 / 2.54));
  return Math.hypot(a.x - c.x, a.z - c.z); })()"""

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

def wait_st(page, cond, timeout=90000):
    try: page.wait_for_function(f"(() => {{ const s = {ST}; return !!s && ({cond}); }})()", timeout=timeout, polling=300)
    except Exception: pass
    return page.evaluate(ST)

def apply(page, js, label):
    page.evaluate(f"""() => {{ const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); {js}; app.apply({{ ok: true, doc, warnings: [] }}, '{label}'); }}""")

def props(page, mobile, pid):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{pid}'}})"); time.sleep(0.3)
    if mobile: page.click('#btn-right'); time.sleep(0.5)

def goals(page, mobile, n, timeout=30000):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("สมาร์ตฟาร์ม")').count(): page.click('.lesson-card:has-text("สมาร์ตฟาร์ม")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=timeout, polling=250)
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
        check(f'{tag}: เปิดไฟล์แลป 40 (schema 38) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0 and page.evaluate("circuitLab.doc.parts.length") == 4, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        goals(page, mobile, 0, 1000)  # เปิดแลป 40 ก่อน Run (ระบบจดเป้าหมายเฉพาะแลปที่เปิดอยู่)
        if mobile: close_drawers(page)
        lum0 = page.evaluate("(() => { const c = circuitLab.view.partObjs.get('MS1').userData.soilMat.color; return c.r + c.g + c.b; })()")
        page.click('#btn-run')
        s = wait_st(page, 's.relay && s.flow > 80 && s.m > 26')
        check(f'{tag}: Run → Pico เปิดรีเลย์ ปั๊มไหล ≈ 90 L/h กระแส 0.15–0.21 A ไม่มีคำเตือนที่ปั๊ม/เซนเซอร์', s and s['relay'] and 80 < s['flow'] < 100 and 0.15 < s['ip'] < 0.21 and s['diags'] == [], str(s))
        d = page.evaluate(HOSE)
        check(f'{tag}: สายน้ำไหลจากปลายสายยาง (เหนือกระถาง ห่างศูนย์กลาง < 14 หน่วย)', s and s['stream'] and d < 14, f"{s and s['stream']} {d:.1f}")
        props(page, mobile, 'MS1')
        try: page.wait_for_function("document.getElementById('props').innerText.includes('น้ำเข้ากระถาง')", timeout=15000, polling=250)
        except Exception: pass
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        k = txt.find('ความชื้นดินขณะนี้')
        check(f'{tag}: แผงผลเซนเซอร์แสดงความชื้นขณะนี้และน้ำเข้ากระถาง ≈ 90 L/h', k >= 0 and re.search(r'น้ำเข้ากระถาง\s+(8\d|9\d) L/h', txt) is not None, txt[k:k + 160].replace('\n', ' | '))
        con = page.evaluate("circuitLab.picoConsole || ''")
        check(f'{tag}: console ของ Pico พิมพ์ค่าความชื้น', re.search(r'moisture \d+ %', con) is not None, con[-80:].replace('\n', ' | '))
        s = wait_st(page, '!s.relay && s.flow < 0.5 && s.m > 60 && !s.stream', 150000)
        check(f'{tag}: ความชื้นเกิน 60% → ปั๊มหยุดเอง สายน้ำหาย ดินสีเข้มขึ้น', s and not s['relay'] and s['flow'] < 0.5 and 60 < s['m'] < 66 and not s['stream'] and s['lum'] < lum0 - 0.1, f"{s} lum0={lum0:.2f}")
        focus(page, 'f20', 30)
        page.screenshot(path=f'{OUT}/{tag}-farm-1-watered.png')
        apply(page, "doc.probes = { red: { kind: 'pin', partId: 'MS1', pin: 'AOUT' }, black: { kind: 'pin', partId: 'MS1', pin: 'GND' } }", 'วัด AOUT')
        g1 = goals(page, mobile, 7)
        check(f'{tag}: แลป 40 ผ่าน 7 ข้อ (sensor/signal/measure/relay/pump/water/stop)', all(x in g1 for x in ['sensor', 'signal', 'measure', 'relay', 'pump', 'water', 'stop']), str(g1))
        if mobile: close_drawers(page)
        props(page, mobile, 'MS1')
        page.click('#f-moist-10'); time.sleep(0.3)
        if mobile: close_drawers(page)
        s = wait_st(page, 's.relay && s.flow > 80')
        s2 = wait_st(page, '!s.relay && s.flow < 0.5 && s.m > 60', 150000)
        g2 = goals(page, mobile, 8)
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('ปั๊มน้ำ') && s.innerHTML.includes('เซนเซอร์ความชื้นในดิน'); })()")
        check(f'{tag}: ตั้งดินแห้ง 10% → รดซ้ำแล้วหยุดอีกรอบ → แลป 40 ครบ 8 ข้อ มีรูปวงจร', s and s['relay'] and s2 and not s2['relay'] and len(g2) == 8 and svg_ok, f"{g2} {svg_ok} {s2 and s2['m']}")
        page.screenshot(path=f'{OUT}/{tag}-farm-2-lesson.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.4)
        props(page, mobile, 'P1')
        page.click('#f-pump-target-none'); time.sleep(0.4)
        d1 = page.evaluate(HOSE)
        props(page, mobile, 'P1') if not mobile else None
        page.click('#f-pump-target-MS1'); time.sleep(0.4)
        d2 = page.evaluate(HOSE)
        if mobile: close_drawers(page)
        check(f'{tag}: ถอดสายยางจากกระถาง → ปลายสายวนลงถัง · เลือกกระถางกลับ → ปลายสายกลับเหนือกระถาง', d1 > 30 and d2 < 14 and page.evaluate("circuitLab.doc.parts.find(p => p.id === 'P1').params.target") == 'MS1', f'{d1:.1f} {d2:.1f}')
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        page.evaluate("""() => { const v = circuitLab.view; const w = v.terminalWorld({kind: 'pin', partId: 'MS1', pin: 'AOUT'}); v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, 14, w.z + 10); v.controls.update(); v.requestRender(); }""")
        cam_still(page)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'MS1', 'pin': 'AOUT'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ปลายสายเหลือง → ป้าย "MS1 · สายเหลือง AOUT"', t is not None and t.startswith('MS1 · สายเหลือง AOUT'), str(t))
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ปั๊มน้ำจุ่ม")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(0, 0, 80); v.persp.position.set(0, 90, 150); v.controls.update(); v.requestRender(); }""")
        cam_still(page)
        q = page.evaluate("""(() => { const v = circuitLab.view; const p = new v.camera.position.constructor(0, -2.4, 80); v.camera.updateMatrixWorld(); p.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; })()""")
        if mobile: page.touchscreen.tap(q['x'], q['y'])
        else: page.mouse.click(q['x'], q['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'pump').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'pump').map(p => p.placement.kind + ':' + p.params.target)")
        check(f'{tag}: วางปั๊มใหม่จากคลังบนโต๊ะ (ยังไม่ต่อสายยาง)', n == ['table:MS1', 'table:'], f"{n} {page.inner_text('#status-msg')}")
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
