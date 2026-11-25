"""E2E: ออปโตคัปเปลอร์ PC817 + Pico ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 31 (GP15 → 330 Ω → ขา 1, ขา 2 → GND ของ Pico · แหล่งจ่าย 12 V แยก → 2.2 kΩ → LED → ขา 4, ขา 3 → −) → Run
→ GP15 กะพริบ: ขาออกอิ่มตัวและ LED ฝั่ง 12 V ติดในฉาก / ดับ → แผงผล "แยกกัน (ฉนวน)" → ชิปกลุ่ม CTR A
→ เปลี่ยน 330 Ω เป็น 10 kΩ → ย่านขยาย IC ≈ CTR × IF → แลป 31 ผ่านครบ 5 ข้อ → ชี้/แตะขา 1 → ป้าย "U1 · ขา 1 แอโนด"
→ ต่อกราวด์สองฝั่งเข้าหากัน → แผงผล "ไม่แยก" → วาง PC817 ใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/opto_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson31-opto.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.U1) return null; const x = s.analysis.parts.U1.extra; const g = circuitLab.view.partObjs.get('LED1'); const sp = g && g.userData.glowSprite;
  return { iF: x.iF, iC: x.iC, vce: x.vce, sat: x.sat, shared: x.shared, ctr: x.ctr, ctrMeas: x.ctrMeas, led: s.analysis.parts.LED1.current, glow: sp ? sp.material.opacity : -1 }; })()"""

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

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
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.sat === 1 && s.glow > 0.3; }})()", timeout=60000, polling=50)
        except Exception: pass
        on = page.evaluate(ST)
        check(f'{tag}: GP15 = 1 → ขาออกอิ่มตัว (VCE < 0.2 V) LED ฝั่ง 12 V ติดในฉาก ≈ 4.5 mA', on and on['sat'] == 1 and on['vce'] < 0.2 and on['glow'] > 0.3 and 4e-3 < on['led'] < 5e-3, str(on))
        focus(page, 'c26', 16)
        page.screenshot(path=f'{OUT}/{tag}-opto-1-on.png')
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.iF < 1e-6 && s.glow < 0.1; }})()", timeout=20000, polling=50)
        except Exception: pass
        off = page.evaluate(ST)
        check(f'{tag}: GP15 = 0 → IF = 0 ขาออกไม่นำ LED ฝั่ง 12 V ดับ', off and off['iF'] < 1e-6 and off['led'] < 1e-6 and off['glow'] < 0.1, str(off))
        open_props(page, mobile, 'U1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดง IF/IC/สถานะ และ "แยกกัน (ฉนวน)"', 'ขาเข้า: IF' in txt and 'สถานะขาออก' in txt and 'แยกกัน (ฉนวน)' in txt, txt[txt.find('ขาเข้า: IF'):][:160].replace('\n', ' | '))
        page.click('#f-rank-A'); time.sleep(0.4)
        pr = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'U1').params")
        check(f'{tag}: กดชิปกลุ่ม A → PC817A CTR 113%', pr['rank'] == 'A' and abs(pr['ctr'] - 1.13) < 0.01, str(pr['rank']) + ' ' + str(pr['ctr']))
        close_drawer(page, mobile, 'right')
        # 330 Ω → 10 kΩ: IF ≈ 0.22 mA ขาออกเข้าย่านขยาย
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts.find(p => p.id === 'R1').params.resistance = 10000; app.apply({ ok: true, doc, warnings: [] }, 'เปลี่ยน R1'); }""")
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.iF > 1.8e-4 && s.sat === 0 && Math.abs(s.ctrMeas - s.ctr) < 0.05 * s.ctr; }})()", timeout=30000, polling=50)
        except Exception: pass
        lin = page.evaluate(ST)
        check(f'{tag}: R1 10 kΩ → IF ≈ 0.2 mA ย่านขยาย IC = CTR × IF (±5%)', lin and lin['sat'] == 0 and 1.5e-4 < lin['iF'] < 3e-4 and abs(lin['ctrMeas'] - lin['ctr']) < 0.05 * lin['ctr'], str(lin))
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.right'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
            page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("PC817")').count(): page.click('.lesson-card:has-text("PC817")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length === 5", timeout=20000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 31 ผ่านครบ 5 ข้อ (input/output/isolated/switching/ctr)', page.locator('#lesson-goals .goal').count() == 5 and page.locator('#lesson-goals .goal.pass').count() == 5, goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-opto-2-lesson.png')
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.left'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'g24', 7)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'A'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา 1 → ป้าย "U1 · ขา 1 แอโนด ..."', t is not None and t.startswith('U1 · ขา 1 แอโนด'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-opto-3-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # ต่อกราวด์สองฝั่งเข้าหากัน (ราง T− กับ GND ของ Pico)
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); const pico = doc.parts.find(p => p.id === 'PICO1'); const ph = window.__cl.pinHolesFor(pico).find(x => x.pin === 'GND.38');
          doc.wires.push({ ...JSON.parse(JSON.stringify(doc.wires[0])), id: 'wshare', a: { kind: 'hole', boardId: 'bb1', hole: 'tn2' }, b: { kind: 'hole', boardId: 'bb1', hole: 'a' + ph.hole.slice(1) }, color: '#212121' }); app.apply({ ok: true, doc, warnings: [] }, 'ต่อกราวด์ร่วม'); }""")
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.shared === 1; }})()", timeout=15000, polling=200)
        except Exception: pass
        open_props(page, mobile, 'U1')
        txt = page.inner_text('.panel.right')
        check(f'{tag}: ต่อกราวด์ร่วม → แผงผล "ไม่แยก (มีจุดต่อร่วมกัน)"', 'ไม่แยก (มีจุดต่อร่วมกัน)' in txt, txt[txt.find('สองฝั่งแยกกัน'):][:60].replace('\n', ' | '))
        close_drawer(page, mobile, 'right')
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile:
            page.evaluate("() => { const p = document.querySelector('.panel.right'); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); }"); time.sleep(0.5)
            page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ออปโต")'); time.sleep(0.3)
        focus(page, 'f22', 12)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f21'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'opto').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วาง PC817 ใหม่ที่ f21 จากคลังอุปกรณ์', len(m) == 2 and any(a == 'f21' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-opto-4-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
