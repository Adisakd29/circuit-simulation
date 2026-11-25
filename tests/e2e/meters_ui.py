"""E2E: มัลติมิเตอร์ดิจิทัล + แบบเข็ม ขนาดจริงผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 33 (แหล่งจ่าย 10 V → R1 100 kΩ + R2 100 kΩ, DMM ย่าน V⎓ คร่อม R2) → Run → DMM ≈ 4.975 V (จอในฉาก + แผงล่าง)
→ ต่อสายโพรบ VOM ด้วยเครื่องมือต่อสาย (แตะรูเสียบบนตัวมิเตอร์ → แตะรูบอร์ด) → เข็ม ≈ 40% ของสเกล 10 V (ผลการโหลด)
→ ชิปย่าน 0.25 V → เข็มตีเกินสเกล + เตือน → กลับ 10 V → แลป 33 ผ่าน dmmV/vomV/loading
→ DMM ย่าน Ω ขณะมีไฟ → เตือน → เสียบสายแดงขั้ว mA แตะคร่อมแหล่งจ่าย → ฟิวส์ขาด (ค้าง) → Stop/Run = ฟิวส์ใหม่
→ วางมัลติมิเตอร์ดิจิทัลตัวใหม่จากคลังอุปกรณ์ (เข้าช่องว่างบนโต๊ะเอง)
ใช้: python3 tests/e2e/meters_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson33-meters.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, inView: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 }; }"""
TABLE_SCREEN = """([x, z]) => { const v = circuitLab.view; const p = v.camera.position.clone().set(x, -2.4, z); p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
ST = """(() => { const s = circuitLab.freshSim; if (!s) return null; const a = s.analysis; const d = a.parts.DMM1 && a.parts.DMM1.extra, v = a.parts.VOM1 && a.parts.VOM1.extra;
  const g = circuitLab.view.partObjs.get('VOM1'), lcd = circuitLab.view.partObjs.get('DMM1')?.userData.dmmLcd;
  return { dmm: d ? d.value : null, ol: d ? d.ol : null, blownMa: d ? d.blownMa : null, frac: v ? v.frac : null, vom: v ? v.value : null,
    needle: g && g.userData.needleState ? g.userData.needleState.a : null, target: g ? g.userData.needleTarget : null, lcd: lcd ? lcd.shown : null,
    diags: a.diagnostics.map(x => x.message) }; })()"""
NEEDLE = "(f) => { const c = Math.max(-0.06, Math.min(1.08, f)); return (-45 + 90 * c) * Math.PI / 180; }"

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus_xyz(page, x, z, dist):
    page.evaluate(f"""() => {{ const v = circuitLab.view; v.controls.target.set({x}, 0, {z}); v.persp.position.set({x}, {dist}, {z} + {dist * 0.7});
      v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def focus(page, hole, dist=14):
    w = page.evaluate(f"(() => {{ const w = circuitLab.view.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}}); return [w.x, w.z]; }})()")
    focus_xyz(page, w[0], w[1], dist)

def close_drawers(page):
    page.evaluate("() => { for (const s of ['left', 'right']) { const p = document.querySelector('.panel.' + s); if (p && p.classList.contains('open')) p.querySelector('.drawer-close').click(); } }"); time.sleep(0.5)

def open_props(page, mobile, part):
    page.evaluate(f"circuitLab.select({{t: 'part', id: '{part}'}})"); time.sleep(0.3)
    if mobile and not page.evaluate("document.querySelector('.panel.right').classList.contains('open')"): page.click('#btn-right'); time.sleep(0.5)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)

        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.25)

        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y']); return s

        page.set_input_files('#file-input', FIX)
        time.sleep(1.0)
        warn = page.locator('#dialog[open]').count()
        check(f'{tag}: เปิดไฟล์แลป 33 (schema 30) ไม่มีคำเตือน', warn == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        # กล้องเริ่มต้น: เห็นขั้วต่อของเครื่องมือทุกชิ้น
        pins = [('PS1', 'pos'), ('PS1', 'neg')] + ([] if mobile else [('DMM1', 'V'), ('DMM1', 'COM'), ('VOM1', 'P'), ('VOM1', 'COM')])
        vis = {f'{p}.{pin}': page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': p, 'pin': pin})['inView'] for p, pin in pins}
        check(f'{tag}: มุมกล้องเริ่มต้นเห็นขั้วต่อของ{"แหล่งจ่าย (จอแนวตั้งเน้นบอร์ด)" if mobile else "แหล่งจ่ายและมิเตอร์ทุกขั้ว"}', all(vis.values()), str(vis))
        page.screenshot(path=f'{OUT}/{tag}-meters-0-open.png')
        page.click('#btn-run')
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.dmm !== null && Math.abs(s.dmm - 4.975) < 0.01 && s.lcd && s.lcd.startsWith('4.9'); }})()", timeout=30000, polling=100)
        except Exception: pass
        s = page.evaluate(ST)
        meter_txt = page.evaluate("document.getElementById('meter-DMM1')?.textContent ?? null")
        check(f'{tag}: DMM ย่าน V⎓ คร่อม R2 = 4.975 V (ขาเข้า 10 MΩ) จอในฉาก "{(s or {}).get("lcd")}" แผงล่าง "{meter_txt}"', s and abs(s['dmm'] - 4.975) < 0.01 and s['lcd'].startswith('4.9') and meter_txt and meter_txt.startswith('4.9'), str(s and s['dmm']))
        # ---- ต่อสายโพรบ VOM ด้วยเครื่องมือต่อสาย ----
        n0 = page.evaluate('circuitLab.doc.wires.length')
        if mobile: close_drawers(page)
        page.click('.tool[aria-label="ต่อสาย (W)"]'); time.sleep(0.2)
        vom = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'VOM1').placement")
        def show_vom():
            # จอแนวตั้ง: มุมกล้องเริ่มต้นไม่รวมมิเตอร์ข้างบอร์ด → เลื่อนกล้องไปที่มิเตอร์ก่อนแตะรูเสียบ
            if mobile: focus_xyz(page, vom['x'], vom['z'] + 22, 110)
            else: page.evaluate("circuitLab.view.resetView()"); time.sleep(0.3); cam_still(page)
        show_vom()
        tap_ref({'kind': 'pin', 'partId': 'VOM1', 'pin': 'P'})
        focus(page, 'e11', 12 if mobile else 16)
        tap_ref({'kind': 'hole', 'boardId': 'bb1', 'hole': 'e9'})
        show_vom()
        tap_ref({'kind': 'pin', 'partId': 'VOM1', 'pin': 'COM'})
        focus(page, 'e11', 12 if mobile else 16)
        tap_ref({'kind': 'hole', 'boardId': 'bb1', 'hole': 'e13'})
        wires = page.evaluate("circuitLab.doc.wires.filter(w => [w.a, w.b].some(t => t.kind === 'pin' && t.partId === 'VOM1')).map(w => [w.a, w.b])")
        check(f'{tag}: ต่อสายโพรบ VOM สองเส้นผ่าน UI (แตะรูเสียบบนมิเตอร์ → แตะรูบอร์ด)', page.evaluate('circuitLab.doc.wires.length') - n0 == 2 and len(wires) == 2, str(wires))
        page.click('.tool[aria-label^="เลือก"]')
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.frac !== null && Math.abs(s.frac - 0.3984) < 0.005 && Math.abs(s.needle - s.target) < 0.003; }})()", timeout=30000, polling=100)
        except Exception: pass
        s = page.evaluate(ST)
        tgt = page.evaluate(NEEDLE, 0.3984)
        check(f'{tag}: VOM ย่าน 10 V อ่าน ≈ 3.98 V (20 kΩ/V โหลดวงจร) เข็มในฉากหยุดที่ 39.8% ของสเกล', s and abs(s['vom'] - 3.984) < 0.01 and abs(s['needle'] - tgt) < 0.01, str(s and [s['vom'], s['needle'], tgt]))
        check(f'{tag}: DMM อ่านค่าที่ถูกโหลดด้วย VOM (3.98 V) เช่นกัน', s and abs(s['dmm'] - 3.984) < 0.01, str(s and s['dmm']))
        g = page.evaluate("document.querySelector('#meter-VOM1')?.dataset.frac ?? null")
        check(f'{tag}: แผงล่างแสดงหน้าปัดย่อของ VOM (frac {g})', g is not None and abs(float(g) - 0.3984) < 0.01)
        focus_xyz(page, vom['x'], vom['z'], 60)
        page.screenshot(path=f'{OUT}/{tag}-meters-1-vom.png')
        # ---- ย่านต่ำเกินไป ----
        open_props(page, mobile, 'VOM1')
        page.click('#f-vom-dcv0_25'); time.sleep(0.3)
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.frac > 1.5 && s.diags.some(m => m.includes('เกินสเกล')); }})()", timeout=20000, polling=100)
        except Exception: pass
        time.sleep(1.2)
        s = page.evaluate(ST)
        peg = page.evaluate(NEEDLE, 1.08)
        check(f'{tag}: ย่าน 0.25 V → เข็มตีเกินสเกล (ชนหมุด) + คำเตือน', s and s['frac'] > 1.5 and abs(s['needle'] - peg) < 0.02 and any('เกินสเกล' in m for m in s['diags']), str(s and [s['frac'], s['needle'], peg]))
        page.click('#f-vom-dcv10'); time.sleep(0.4)
        hint = page.inner_text('#vom-howto')
        check(f'{tag}: แผงคุณสมบัติบอกวิธีอ่านสเกลและความต้านทานขาเข้า 200 kΩ', 'สเกลดำ 0–10' in hint and '200 kΩ' in hint, hint[:120])
        if mobile: close_drawers(page); page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("มัลติมิเตอร์ดิจิทัลและแบบเข็ม")').count(): page.click('.lesson-card:has-text("มัลติมิเตอร์ดิจิทัลและแบบเข็ม")')
        try: page.wait_for_function("['dmmV', 'vomV', 'loading'].every(k => document.querySelector(`#lesson-goals .goal.pass[data-goal='${k}']`))", timeout=20000, polling=250)
        except Exception: pass
        passed = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
        goals = page.inner_text('#lesson-goals')
        check(f'{tag}: แลป 33 ผ่าน dmmV / vomV / loading (เห็นผลการโหลด)', all(k in passed for k in ['dmmV', 'vomV', 'loading']), str(passed) + ' ' + goals[:200].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-meters-2-lesson.png')
        if mobile: close_drawers(page)
        # ---- DMM ย่าน Ω ขณะมีไฟ ----
        open_props(page, mobile, 'DMM1')
        page.click('#f-dmm-ohm'); time.sleep(0.3)
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.diags.some(m => m.includes('วัดความต้านทานขณะวงจรมีไฟ')); }})()", timeout=20000, polling=100)
        except Exception: pass
        s = page.evaluate(ST)
        check(f'{tag}: DMM ย่าน Ω ขณะวงจรมีไฟ → เตือนให้ปิดไฟก่อน', s and any('วัดความต้านทานขณะวงจรมีไฟ' in m for m in s['diags']))
        page.click('#f-dmm-dcv'); time.sleep(0.3)
        if mobile: close_drawers(page)
        # ---- ฟิวส์: สายแดงขั้ว mA แตะคร่อมแหล่งจ่าย (จำกัดกระแส 1 A) ----
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.parts.find(p => p.id === 'PS1').params.currentLimit = 1;
          doc.wires.push({ ...JSON.parse(JSON.stringify(doc.wires[0])), id: 'wfuse', a: { kind: 'pin', partId: 'DMM1', pin: 'mA' }, b: { kind: 'hole', boardId: 'bb1', hole: 'e5' } });
          app.apply({ ok: true, doc, warnings: [] }, 'เสียบสายแดงขั้ว mA'); }""")
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.blownMa === 1; }})()", timeout=20000, polling=100)
        except Exception: pass
        s = page.evaluate(ST)
        check(f'{tag}: ขั้ว mA คร่อมแหล่งจ่าย → ฟิวส์ 440 mA ขาด + คำเตือนอันตราย', s and s['blownMa'] == 1 and any('ฟิวส์' in m for m in s['diags']), str(s and s['blownMa']))
        page.evaluate("""() => { const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); doc.wires = doc.wires.filter(w => w.id !== 'wfuse'); app.apply({ ok: true, doc, warnings: [] }, 'ถอดสาย'); }""")
        time.sleep(1.5)
        s = page.evaluate(ST)
        check(f'{tag}: ถอดสายแล้วฟิวส์ยังขาดอยู่ (ค้างจนเริ่มจำลองใหม่)', s and s['blownMa'] == 1)
        page.click('#btn-stop'); time.sleep(0.6)  # หยุด
        page.click('#btn-run')  # เริ่มใหม่ = ใส่ฟิวส์ใหม่
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.blownMa === 0 && Math.abs(s.dmm - 3.984) < 0.02; }})()", timeout=20000, polling=100)
        except Exception: pass
        s = page.evaluate(ST)
        check(f'{tag}: Stop → Run = ฟิวส์ใหม่ DMM อ่านได้ตามปกติ', s and s['blownMa'] == 0 and abs(s['dmm'] - 3.984) < 0.02, str(s and [s['blownMa'], s['dmm']]))
        # ---- วางมัลติมิเตอร์ดิจิทัลตัวใหม่จากคลังอุปกรณ์ ----
        page.evaluate("circuitLab.view.resetView()"); time.sleep(0.3); cam_still(page)
        n = page.evaluate('circuitLab.doc.parts.length')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("มัลติมิเตอร์ดิจิทัล")'); time.sleep(0.3)
        if mobile:  # รอลิ้นชักคลังอุปกรณ์ปิดสนิทก่อนแตะพื้นที่ทำงาน
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.6)
        p = page.evaluate(TABLE_SCREEN, [0, 0])  # แตะกลางบอร์ด → เลื่อนไปช่องว่างที่ใกล้ที่สุดเอง
        tap(p['x'], p['y'])
        time.sleep(0.4)
        new = page.evaluate("(() => { const d = circuitLab.doc; const p = d.parts.filter(p => p.kind === 'dmm').pop(); return { n: d.parts.length, id: p.id, pl: p.placement }; })()")
        clear = abs(new['pl']['x']) >= 16.2 + 91 / 2.54 / 2 or abs(new['pl']['z']) >= 10.8 + 183 / 2.54 / 2  # ไม่ทับเบรดบอร์ด
        check(f'{tag}: วางมัลติมิเตอร์ดิจิทัลจากคลัง (แตะกลางบอร์ด) → เลื่อนไปช่องว่างที่ใกล้ที่สุด ไม่ทับบอร์ด', new['n'] == n + 1 and new['id'] != 'DMM1' and clear, str(new))
        page.screenshot(path=f'{OUT}/{tag}-meters-3-placed.png')
        check(f'{tag}: ไม่มี error ในคอนโซล', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
