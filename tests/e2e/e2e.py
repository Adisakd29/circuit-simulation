"""
ทดสอบ end-to-end ผ่านเบราว์เซอร์จริง (Chromium headless + WebGL ซอฟต์แวร์)
ใช้ pointer event จริงผ่าน Playwright (ไม่เรียก API ภายในเพื่อสร้างวงจร)
ตัวช่วยเดียวที่อ่านจากแอปคือการแปลงตำแหน่งรู/ขั้ว → พิกัดหน้าจอ เพื่อรู้ว่าจะคลิกตรงไหน

วิธีรัน:  npm run build && npx vite preview --port 4173 &  แล้ว  python3 tests/e2e/e2e.py [out_dir]
"""
import json, math, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('CL3D_URL', 'http://localhost:4173/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-out'
os.makedirs(OUT, exist_ok=True)
results = []

def dismiss_dialog(page):
    """ไฟล์รุ่นเก่าที่มีเครื่องมือบนโต๊ะ: แอปจัดเครื่องมือขนาดจริงลงช่องใหม่และแจ้งคำเตือนเป็นกล่องข้อความ — ปิดก่อนทำต่อ"""
    for _ in range(30):  # กล่องข้อความขึ้นหลังอ่านไฟล์เสร็จ (เครื่องช้าอาจเกิน 1 วินาที)
        if page.locator('#dialog[open]').count():
            page.keyboard.press('Escape'); time.sleep(0.3); return
        time.sleep(0.1)

def drawer_settle(page, mobile):
    """มือถือ: เลือกอุปกรณ์จากคลังแล้วลิ้นชักซ้ายเลื่อนปิด — รอให้ปิดสนิทก่อนแตะรูบนบอร์ด (ไม่งั้นแตะโดนลิ้นชักที่ยังเลื่อนอยู่)"""
    if mobile:
        try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
        except Exception: pass
        time.sleep(0.4)
    # กล้องอาจยังเลื่อนอยู่ (เปิดไฟล์เก่าแล้วจัดเครื่องมือใหม่ → จัดมุมกล้อง) — รอให้นิ่งก่อนคำนวณตำแหน่งรูบนจอ
    page.evaluate("window.__camStill = null")
    try: page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=10000, polling=100)
    except Exception: pass

def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (f' — {detail}' if detail else ''))

SCREEN_OF = """(ref) => {
  const app = window.circuitLab; const v = app.view;
  const p = v.terminalWorld(ref); if (!p) return null;
  p.y += (ref.kind === 'pin') ? 0.6 : 0;
  p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}"""
TABLE_SCREEN = """([x, z]) => {
  const v = window.circuitLab.view; const THREE_V = v.camera.position.clone();
  const p = THREE_V.set(x, -2.4, z); p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}"""

WORLD_SCREEN = """([hole, y, dz]) => {
  const v = window.circuitLab.view;
  const p = v.terminalWorld({ kind: 'hole', boardId: 'bb1', hole }); p.y = y; p.z += dz;
  p.project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}"""

def H(h): return {'kind': 'hole', 'boardId': 'bb1', 'hole': h}

def run(mobile=False):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(
            viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
            has_touch=mobile, is_mobile=mobile, device_scale_factor=1, accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.8)

        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.15)

        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref)
            tap(s['x'], s['y'])

        def menu_click(sel):
            if mobile: page.click('#btn-more'); time.sleep(0.2)
            page.click(sel)

        def open_left():
            if mobile: page.click('#btn-left'); time.sleep(0.3)

        def lib(name):
            open_left()
            page.click(f'.lib-item:has-text("{name}")')
            time.sleep(0.2); drawer_settle(page, mobile)

        page.screenshot(path=f'{OUT}/{tag}-0-empty.png')
        # ---- vertical slice: วางแหล่งจ่าย ----
        if mobile:
            menu_click('#btn-top'); time.sleep(0.4)
        lib('แหล่งจ่ายไฟ DC')
        s = page.evaluate(TABLE_SCREEN, [0, -17] if mobile else [-24, -2])  # จอแนวตั้ง: กล้องจัดบอร์ดไว้กลางจอ วางเหนือบอร์ด
        tap(s['x'], s['y'])
        n = page.evaluate('circuitLab.doc.parts.length')
        check(f'{tag}: วางแหล่งจ่ายบนโต๊ะ', n == 1, page.inner_text('#status-msg'))
        ps = page.evaluate('circuitLab.doc.parts[0].id')
        # ---- วางตัวต้านทาน ----
        lib('ตัวต้านทาน')
        tap_ref(H('a10'))
        parts = page.evaluate('circuitLab.doc.parts.map(p => [p.kind, p.placement.anchor || null])')
        check(f'{tag}: วางตัวต้านทานที่รู a10', ['resistor', 'a10'] in [list(p) for p in parts], str(parts))
        rid = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'resistor').id")
        # ---- ต่อสาย: แตะสองขา ----
        page.click('.tool[aria-label="ต่อสาย (W)"]')
        tap_ref({'kind': 'pin', 'partId': ps, 'pin': 'pos'})
        tap_ref(H('a10'))  # แตะรูที่มีขาตัวต้านทาน → แอปเลือกรูว่างในกลุ่มเดียวกันให้
        tap_ref({'kind': 'pin', 'partId': ps, 'pin': 'neg'})
        tap_ref(H('c14'))
        wires = page.evaluate('circuitLab.doc.wires.map(w => [w.a, w.b])')
        check(f'{tag}: สร้างสาย 2 เส้นด้วยการแตะสองจุด', len(wires) == 2, json.dumps(wires, ensure_ascii=False))
        # ---- Run + วัด ----
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.freshSim !== null", timeout=5000)
        I = page.evaluate(f"circuitLab.freshSim.analysis.parts['{rid}'].current")
        check(f'{tag}: Run → กระแส R ≈ 5 mA', abs(I - 0.005) / 0.005 < 0.005, f'{I*1000:.4f} mA')
        page.click('.tool[aria-label="โพรบแดง (+)"]')
        tap_ref(H('e10'))
        page.click('.tool[aria-label="โพรบดำ (COM)"]')
        tap_ref(H('e14'))
        time.sleep(0.4)
        lcd = page.inner_text('.meter .lcd')
        check(f'{tag}: โวลต์มิเตอร์แสดง ≈ 5 V', lcd.replace('V', '').strip().startswith('5.00') or lcd.strip().startswith('4.99'), lcd)
        page.screenshot(path=f'{OUT}/{tag}-1-running.png')

        # ---- แยกท่าทาง: ลากที่ว่างต้องหมุน/เลื่อนกล้อง ไม่ย้ายอุปกรณ์ ----
        page.click('.tool[aria-label="เลือก / ย้าย (V)"]')
        before_doc = page.evaluate('JSON.stringify(circuitLab.doc)')
        cam0 = page.evaluate('circuitLab.view.camera.position.toArray()')
        e = page.evaluate(TABLE_SCREEN, [12, -30])  # พื้นโต๊ะว่างด้านขวาหลังบอร์ด (หน้าจอแสดงขั้วแหล่งจ่ายแถวหลังด้วย)
        if mobile:
            cdp = ctx.new_cdp_session(page)
            def touch(t, pts):
                cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y} for x, y in pts]})
            touch('touchStart', [(e['x'], e['y'])])
            for i in range(1, 8): touch('touchMove', [(e['x'] + i * 12, e['y'] + i * 6)]); time.sleep(0.02)
            touch('touchEnd', [])
        else:
            page.mouse.move(e['x'], e['y']); page.mouse.down()
            for i in range(1, 8): page.mouse.move(e['x'] + i * 15, e['y'] + i * 4)
            page.mouse.up()
        time.sleep(0.5)
        cam1 = page.evaluate('circuitLab.view.camera.position.toArray()')
        check(f'{tag}: ลากที่ว่าง → กล้องเคลื่อน และวงจรไม่เปลี่ยน', cam0 != cam1 and before_doc == page.evaluate('JSON.stringify(circuitLab.doc)'))

        # ---- ลากอุปกรณ์เพื่อย้าย ----
        # กล้องมีความหน่วง (damping) ยังเลื่อนต่ออีกหลายเฟรมหลังปล่อยเมาส์ — รอให้นิ่งก่อนคำนวณตำแหน่งบนจอ
        # (เครื่องที่วาดช้า เฟรมน้อย จึงนิ่งช้ากว่า 0.5 s ได้ — เคยทำให้ข้อนี้ตกเป็นครั้งคราว)
        # ความหน่วงลดลง 12% ต่อเฟรม — เฟรมช้า (เครื่องทดสอบไม่มี GPU และมีงานอื่น) กว่าจะนิ่งระดับ 0.0001 อาจนานหลายสิบวินาที
        # ใช้เกณฑ์ 0.01 หน่วย (0.025 mm) ซึ่งเล็กกว่าขนาดตัวต้านทานบนจอมาก
        # กลับมุมกล้องเริ่มต้น: มุมที่หมุนแล้วสายจากแหล่งจ่ายแถวหลังอาจพาดทับตัวต้านทานบนจอจนจับตัวถังไม่ได้
        page.evaluate("circuitLab.view.resetView()")
        page.evaluate("window.__camStill = null")
        page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
          const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)
        # จุดบนตัวถังตัวต้านทาน (เหนือแถว a) ที่ไม่มีสายพาดทับบนจอ — สายจากแหล่งจ่ายแถวหลังพาดผ่านบอร์ดเมื่อมองจากบางมุม
        # จุดปล่อย = จุดเดียวกันบนตัวถังเลื่อนไป 6 คอลัมน์ (ฉายจากพิกัดโลก ไม่ประมาณบนจอ)
        ab = page.evaluate(f"""(() => {{ const v = circuitLab.view, r = v.renderer.domElement.getBoundingClientRect();
          const scr = (hole, dx, dz) => {{ const p = v.terminalWorld({{ kind: 'hole', boardId: 'bb1', hole }}); p.x += dx; p.y = 0.75; p.z += dz; p.project(v.camera);
            return {{ x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }}; }};
          for (const dx of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 0.25, -0.25, 0.75, -0.75]) for (const dz of [-1, -0.8, -1.2, -0.9, -1.1]) {{
            const a = scr('b12', dx, dz);
            // ต้องโดนตัวต้านทานทั้งจุดนั้นและรอบ ๆ 4 px (ไม่อยู่ชิดขอบสาย — กล้องที่ยังหน่วงเล็กน้อยจะทำให้จุดชิดขอบกลายเป็นโดนสาย)
            const hit = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].every(([ox, oy]) => {{ const k = v.pick(a.x + ox, a.y + oy); return k && k.type === 'part' && k.partId === '{rid}'; }});
            if (hit) return [a, scr('b18', dx, dz)]; }}
          return [scr('b12', 0, -1), scr('b18', 0, -1)]; }})()""")
        a, b = ab[0], ab[1]
        if mobile:
            tap(a['x'], a['y'])  # touch: แตะเลือกก่อน
            sel = page.evaluate('JSON.stringify(circuitLab.selection)')
            touch('touchStart', [(a['x'], a['y'])])
            for i in range(1, 11): touch('touchMove', [(a['x'] + (b['x'] - a['x']) * i / 10, a['y'] + (b['y'] - a['y']) * i / 10)]); time.sleep(0.03)
            touch('touchEnd', [])
        else:
            page.mouse.move(a['x'], a['y']); page.mouse.down()
            for i in range(1, 11): page.mouse.move(a['x'] + (b['x'] - a['x']) * i / 10, a['y'] + (b['y'] - a['y']) * i / 10)
            page.mouse.up()
        time.sleep(0.4)
        anchor = page.evaluate(f"circuitLab.doc.parts.find(p => p.id === '{rid}').placement.anchor")
        check(f'{tag}: ลากตัวต้านทานไปตำแหน่งใหม่', anchor != 'a10', f'{anchor} status={page.inner_text("#status-msg")}')
        time.sleep(0.3)
        I2 = page.evaluate(f"circuitLab.freshSim && circuitLab.freshSim.analysis.parts['{rid}'].current")
        check(f'{tag}: ย้ายออกจากคอลัมน์เดิม → วงจรเปิด กระแสเป็น 0', I2 is not None and abs(I2) < 1e-9, str(I2))
        # ---- Undo ----
        if mobile: page.click('#btn-undo')
        else: page.keyboard.press('Control+z')
        time.sleep(0.4)
        I3 = page.evaluate(f"circuitLab.freshSim && circuitLab.freshSim.analysis.parts['{rid}'].current")
        check(f'{tag}: Undo → กลับตำแหน่งเดิม กระแสกลับมา 5 mA', I3 and abs(I3 - 0.005) / 0.005 < 0.005, str(I3))
        page.click('#btn-redo'); time.sleep(0.3)
        page.click('#btn-undo'); time.sleep(0.3)

        # ---- Save → New → Open ----
        menu_click('#btn-save'); time.sleep(0.2)
        with page.expect_download() as dl:
            page.click('#save-download')
        path = f'{OUT}/{tag}-saved.json'
        dl.value.save_as(path)
        saved = json.load(open(path))
        page.click('dialog .btn:has-text("ปิด")')
        check(f'{tag}: ไฟล์มี schemaVersion', saved.get("schemaVersion") == 37 and saved.get('format') == 'circuitlab3d')
        menu_click('#btn-new'); time.sleep(0.2)
        page.click('dialog .btn.primary'); time.sleep(0.3)
        check(f'{tag}: New ล้างวงจร', page.evaluate('circuitLab.doc.parts.length') == 0)
        page.set_input_files('#file-input', path)
        dismiss_dialog(page)
        time.sleep(0.6)
        doc = page.evaluate('circuitLab.doc')
        check(f'{tag}: Open ไฟล์ → อุปกรณ์/สาย/โพรบครบ', len(doc['parts']) == 2 and len(doc['wires']) == 2 and doc['probes']['red'] is not None)
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.freshSim !== null", timeout=5000)
        I4 = page.evaluate(f"circuitLab.freshSim.analysis.parts['{rid}'].current")
        check(f'{tag}: เปิดกลับมาแล้วจำลองได้ค่าเดิม', abs(I4 - I) < 1e-12, f'{I4}')
        # ---- autosave ----
        time.sleep(1.0)
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)
        check(f'{tag}: บันทึกอัตโนมัติ → reload แล้วงานยังอยู่', page.evaluate('circuitLab.doc.wires.length') == 2, page.inner_text('#save-status'))

        # ---- ลัดวงจร ----
        page.click('#btn-run'); time.sleep(0.3)
        page.click('.tool[aria-label="ต่อสาย (W)"]')
        tap_ref({'kind': 'pin', 'partId': ps, 'pin': 'pos'})
        tap_ref({'kind': 'pin', 'partId': ps, 'pin': 'neg'})
        time.sleep(0.5)
        r = page.evaluate(f"circuitLab.freshSim.analysis.parts['{ps}']")
        check(f'{tag}: ลัดวงจร → CC จำกัดที่ 100 mA (ไม่เป็นอนันต์)', r['mode'] == 'CC' and abs(r['current'] - 0.1) < 1e-9, json.dumps(r))
        page.screenshot(path=f'{OUT}/{tag}-2-short.png')
        page.keyboard.press('Escape')

        # ---- แลป ----
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        page.click('.lesson-card:has-text("กฎของโอห์ม")'); time.sleep(0.3)
        check(f'{tag}: เปิดแลปได้ และมีตารางบันทึก', page.locator('.rec input').count() >= 8)
        page.screenshot(path=f'{OUT}/{tag}-3-lesson.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()


def run_transient(mobile=False):
    """วงจร RC: วางตัวเก็บประจุผ่าน UI, Run → จำลองตามเวลา, กราฟ, หยุดเวลา, เริ่มใหม่, วัด τ"""
    tag = ('mobile' if mobile else 'desktop') + '-rc'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)
        # เริ่มจากไฟล์ที่มีแหล่งจ่าย + R 1 kΩ (a5–a9) + สายเข้ารู c5 (ส่วนวาง/ต่อสายทดสอบแล้วในชุดหลัก)
        base = {"format": "circuitlab3d", "schemaVersion": 2, "app": "e2e", "savedAt": "", "title": "RC",
                "studentWork": {"lessonId": None, "records": {}, "answers": {}, "achieved": {}},
                "circuit": {"breadboards": [{"id": "bb1", "model": "CL-400", "x": 0, "z": 0}],
                    "parts": [{"id": "PS1", "label": "PS1", "kind": "dcsupply", "placement": {"kind": "table", "x": -24, "z": -2, "rotation": 0}, "params": {"voltage": 5, "currentLimit": 0.1, "internalResistance": 0.01, "outputOn": True}},
                              {"id": "R1", "label": "R1", "kind": "resistor", "placement": {"kind": "board", "boardId": "bb1", "anchor": "a5", "rotation": 0}, "params": {"resistance": 1000, "powerRating": 0.25, "span": 4}}],
                    "wires": [{"id": "w1", "a": {"kind": "pin", "partId": "PS1", "pin": "pos"}, "b": H('c5'), "color": "#e53935", "arc": 2, "bend": 0}],
                    "probes": {"red": None, "black": None}}}
        path = f'{OUT}/{tag}-base.json'
        json.dump(base, open(path, 'w'))
        page.set_input_files('#file-input', path)
        dismiss_dialog(page)
        time.sleep(0.6)

        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.15)
        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y'])

        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('.lib-item:has-text("ตัวเก็บประจุ")'); time.sleep(0.2); drawer_settle(page, mobile)
        tap_ref(H('b9'))
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'capacitor')", timeout=5000)
        except Exception: pass
        cap = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'capacitor') || {}).placement")
        check(f'{tag}: วางตัวเก็บประจุที่ b9 ผ่าน UI', cap and cap.get('anchor') == 'b9', str(cap))
        page.evaluate("void 0")
        # ตั้งความจุ 100 µF ผ่านแผงคุณสมบัติ
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.fill('#f-capacitance', '100u'); page.press('#f-capacitance', 'Enter'); time.sleep(0.2)
        c = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'capacitor').params.capacitance")
        check(f'{tag}: ตั้งค่า C = 100u', abs(c - 100e-6) < 1e-12, str(c))
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.4)
        page.screenshot(path=f'{OUT}/{tag}-before-wire.png')
        page.click('.tool[aria-label="ต่อสาย (W)"]', timeout=5000)
        ps = 'PS1'
        tap_ref(H('c11')); tap_ref({'kind': 'pin', 'partId': ps, 'pin': 'neg'})
        page.click('.tool[aria-label="โพรบแดง (+)"]'); tap_ref(H('d9'))
        page.click('.tool[aria-label="โพรบดำ (COM)"]'); tap_ref(H('d11'))
        check(f'{tag}: ต่อสายครบและวางโพรบ', page.evaluate('circuitLab.doc.wires.length') == 2 and page.evaluate('!!circuitLab.doc.probes.black'))
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.sim && window.circuitLab.sim.mode === 'tran'", timeout=5000)
        check(f'{tag}: วงจรมี C → จำลองตามเวลา และแผงเวลาแสดง', page.is_visible('#logger') and page.is_visible('#lg-canvas'))
        page.select_option('#lg-speed', '0.1'); time.sleep(0.3)
        page.click('#lg-restart'); time.sleep(0.3)
        page.wait_for_function('window.circuitLab.sim.t > 0.15', timeout=20000)
        # อ่านเวลาและแรงดันจากผลชุดเดียวกัน (กันผลใหม่มาคั่นระหว่างการอ่านสองครั้ง)
        t, v = page.evaluate('[circuitLab.sim.t, circuitLab.sim.analysis.probe.value]')
        check(f'{tag}: เวลาเดินและแรงดันเพิ่มขึ้นตามเวลา', t > 0.05 and v is not None and 0 < v < 5.01, f't={t:.3f}s v={v}')
        expected = 5 * (1 - math.exp(-t / (1000.01 * 100e-6)))
        check(f'{tag}: แรงดัน ณ เวลา t ตรงสูตร RC (±1%)', abs(v - expected) < 0.05, f'{v:.4f} vs {expected:.4f}')
        tau = page.evaluate("(() => { const L = circuitLab.logger; const d = L.data[0]; return L.crossing(0, 0.632 * 5); })()")
        check(f'{tag}: วัด τ จากกราฟ ≈ 100 ms (±3%)', tau is not None and abs(tau - 0.1) < 0.003, str(tau))
        page.click('#lg-pause'); time.sleep(0.3)
        t1 = page.evaluate('circuitLab.sim.t'); time.sleep(0.6); t2 = page.evaluate('circuitLab.sim.t')
        check(f'{tag}: หยุดเวลาแล้วเวลาไม่เดิน', abs(t2 - t1) < 1e-9, f'{t1} {t2}')
        page.click('#lg-pause'); time.sleep(0.3)
        page.click('#lg-restart'); time.sleep(0.15)
        t3 = page.evaluate('circuitLab.sim.t')
        check(f'{tag}: เริ่มใหม่ → เวลากลับใกล้ 0', t3 < 0.03, str(t3))
        page.screenshot(path=f'{OUT}/{tag}.png')
        page.click('#btn-stop'); time.sleep(0.2)
        check(f'{tag}: Stop ซ่อนแผงเวลา', not page.is_visible('#logger'))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

def run_scope(mobile=False):
    """เครื่องกำเนิดสัญญาณ + ออสซิลโลสโคป: วางและต่อผ่าน UI, Run, อ่านค่าบนสโคป, Auto, Stop"""
    tag = ('mobile' if mobile else 'desktop') + '-scope'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)

        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.15)
        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y'])
        def lib(name):
            if mobile: page.click('#btn-left'); time.sleep(0.3)
            page.click(f'.lib-item:has-text("{name}")'); time.sleep(0.2); drawer_settle(page, mobile)

        if mobile:
            page.click('#btn-more'); time.sleep(0.2); page.click('#btn-top'); time.sleep(0.4)
        lib('เครื่องกำเนิดสัญญาณ')
        s = page.evaluate(TABLE_SCREEN, [-7, -17] if mobile else [-24, -5]); tap(s['x'], s['y'])
        lib('ออสซิลโลสโคป')
        s = page.evaluate(TABLE_SCREEN, [7, -17] if mobile else [-24, 9]); tap(s['x'], s['y'])
        kinds = page.evaluate('circuitLab.doc.parts.map(p => p.kind)')
        check(f'{tag}: วางเครื่องกำเนิดสัญญาณและออสซิลโลสโคปบนโต๊ะผ่าน UI', 'fgen' in kinds and 'scope' in kinds, str(kinds))
        fg = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'fgen').id")
        sc = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'scope').id")
        page.click('.tool[aria-label="ต่อสาย (W)"]')
        tap_ref({'kind': 'pin', 'partId': fg, 'pin': 'OUT'}); tap_ref({'kind': 'pin', 'partId': sc, 'pin': 'CH1'})
        tap_ref({'kind': 'pin', 'partId': fg, 'pin': 'COM'}); tap_ref({'kind': 'pin', 'partId': sc, 'pin': 'GND'})
        check(f'{tag}: ต่อสาย OUT→CH1 และ COM→GND', page.evaluate('circuitLab.doc.wires.length') == 2, page.inner_text('#status-msg'))
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.sim && window.circuitLab.sim.mode === 'tran'", timeout=5000)
        check(f'{tag}: แท็บออสซิลโลสโคปแสดง', page.is_visible('#sc-canvas'))
        # รอให้มีข้อมูลอย่างน้อยราว 3 คาบ (บนเครื่องที่วาด 3 มิติช้า เวลาจำลองเดินช้ากว่าที่ตั้ง)
        try:
            page.wait_for_function("(() => { const a = window.circuitLab; const m = a.scope.frame(a.scopePart().params).measure[0]; return m && m.freq; })()", timeout=30000)
            page.wait_for_function("document.getElementById('sc-status').textContent === \"Trig'd\"", timeout=10000)
        except Exception:
            pass
        meas = page.inner_text('#sc-meas')
        f = page.evaluate("(() => { const a = circuitLab; const s = a.scopePart(); return a.scope.frame(s.params).measure[0]; })()")
        check(f'{tag}: สโคปวัดไซน์ 1 kHz 2 Vpp (f ±1%, Vpp ±1%)', f and f['freq'] and abs(f['freq'] - 1000) < 10 and abs(f['vpp'] - 2) < 0.02, meas.replace('\n', ' | '))
        st_txt = page.inner_text('#sc-status')
        check(f'{tag}: trigger ได้', st_txt == "Trig'd", st_txt)
        page.select_option('#sc-tdiv', '0.0005'); time.sleep(0.4)
        td = page.evaluate(f"circuitLab.doc.parts.find(p => p.id === '{sc}').params.timeDiv")
        sp = page.evaluate('circuitLab.simc.speed')
        check(f'{tag}: เปลี่ยน time/div แล้วบันทึกในเครื่อง และความเร็วปรับตาม', td == 0.0005 and abs(sp - 0.01) < 1e-9, f'{td} {sp}')
        page.click('#sc-auto'); time.sleep(0.4)
        td2 = page.evaluate(f"circuitLab.doc.parts.find(p => p.id === '{sc}').params.timeDiv")
        check(f'{tag}: Auto เลือก time/div ให้เห็นราว 3 คาบ', td2 == 0.0005, str(td2))
        page.click('#sc-run'); time.sleep(0.2)
        n1 = page.evaluate('circuitLab.scope.t.length'); time.sleep(0.8); n2 = page.evaluate('circuitLab.scope.t.length')
        check(f'{tag}: Stop ค้างภาพ (ไม่รับข้อมูลใหม่)', n1 == n2, f'{n1} {n2}')
        page.click('#sc-run'); time.sleep(0.2)
        page.screenshot(path=f'{OUT}/{tag}.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

def run_semis(mobile=False):
    """ทรานซิสเตอร์ + ออปแอมป์: วางผ่าน UI, Run, อ่านย่านทำงานในแผงขวา, เปลี่ยน NPN→PNP, วาง DIP-8 คร่อมร่อง, เปิดแลป 9–10"""
    tag = ('mobile' if mobile else 'desktop') + '-semis'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)
        W = lambda a, b, i: {"id": i, "a": a, "b": b, "color": "#e53935", "arc": 2, "bend": 0}
        base = {"format": "circuitlab3d", "schemaVersion": 4, "app": "e2e", "savedAt": "", "title": "BJT",
                "studentWork": {"lessonId": None, "records": {}, "answers": {}, "achieved": {}},
                "circuit": {"breadboards": [{"id": "bb1", "model": "CL-400", "x": 0, "z": 0}],
                    "parts": [{"id": "PS1", "label": "PS1", "kind": "dcsupply", "placement": {"kind": "table", "x": -24, "z": -2, "rotation": 0}, "params": {"voltage": 5, "currentLimit": 0.1, "internalResistance": 0.01, "outputOn": True}},
                              {"id": "Rb", "label": "Rb", "kind": "resistor", "placement": {"kind": "board", "boardId": "bb1", "anchor": "h7", "rotation": 0}, "params": {"resistance": 10000, "powerRating": 0.25, "span": 6}},
                              {"id": "Rc", "label": "Rc", "kind": "resistor", "placement": {"kind": "board", "boardId": "bb1", "anchor": "i25", "rotation": 0}, "params": {"resistance": 220, "powerRating": 0.25, "span": 4}},
                              {"id": "LED1", "label": "LED1", "kind": "led", "placement": {"kind": "board", "boardId": "bb1", "anchor": "c25", "rotation": 0}, "params": {"color": "red", "Is": 0.02 / (math.exp(1.9 / (2 * 0.025852)) - 1), "n": 2, "Rs": 5, "ratedCurrent": 0.02, "maxCurrent": 0.03, "maxReverseVoltage": 5}}],
                    "wires": [W({"kind": "pin", "partId": "PS1", "pin": "pos"}, H('tp2'), 'w1'), W({"kind": "pin", "partId": "PS1", "pin": "neg"}, H('tn2'), 'w2'),
                              W(H('tp8'), H('j7'), 'w3'), W(H('j13'), H('a21'), 'w4'), W(H('a20'), H('tn20'), 'w5'),
                              W(H('tp29'), H('j29'), 'w6'), W(H('j25'), H('d25'), 'w7'), W(H('d26'), H('b22'), 'w8')],
                    "probes": {"red": None, "black": None}}}
        path = f'{OUT}/{tag}-base.json'
        json.dump(base, open(path, 'w'))
        page.set_input_files('#file-input', path)
        dismiss_dialog(page)
        time.sleep(0.6)
        check(f'{tag}: เปิดไฟล์ฐาน (schema 4)', page.evaluate('circuitLab.doc.parts.length') == 4, page.inner_text('#status-msg'))

        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.15)
        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y'])
        def lib(name):
            if mobile: page.click('#btn-left'); time.sleep(0.3)
            page.click(f'.lib-item:has-text("{name}")'); time.sleep(0.2); drawer_settle(page, mobile)

        lib('ทรานซิสเตอร์')
        tap_ref(H('e20'))
        try: page.wait_for_function("circuitLab.doc.parts.some(p => p.kind === 'bjt')", timeout=5000)
        except Exception: pass
        q = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'bjt') || null)")
        check(f'{tag}: วางทรานซิสเตอร์ที่ e20 ผ่าน UI (E–B–C = e20–e22)', q and q['placement'].get('anchor') == 'e20', str(q and q['placement']))
        qid = q['id'] if q else 'Q1'
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.freshSim && window.circuitLab.freshSim.analysis.ok", timeout=5000)
        time.sleep(0.4)
        r = page.evaluate(f"circuitLab.freshSim.analysis.parts['{qid}']")
        led = page.evaluate("circuitLab.freshSim.analysis.parts['LED1']")
        check(f'{tag}: NPN อิ่มตัว Vce < 0.3 V และ LED ติด', r and r['extra']['region'] == 2 and r['voltage'] < 0.3 and led['brightness'] > 0.3, json.dumps(r))
        page.evaluate(f"circuitLab.select({{t: 'part', id: '{qid}'}})") if page.evaluate("typeof circuitLab.select === 'function'") else None
        time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        txt = page.inner_text('#props') if page.locator('#props').count() else page.inner_text('body')
        check(f'{tag}: แผงขวาแสดงย่านทำงาน "อิ่มตัว"', 'อิ่มตัว' in txt, txt[:200].replace('\n', ' '))
        page.click('#f-pol-pnp'); time.sleep(0.6)
        r2 = page.evaluate(f"circuitLab.freshSim.analysis.parts['{qid}']")
        check(f'{tag}: เปลี่ยนเป็น PNP (ต่อแบบ NPN) → ไม่นำกระแส LED ดับ', abs(r2['current']) < 1e-6, json.dumps(r2))
        page.keyboard.press('Control+z'); time.sleep(0.6)
        r3 = page.evaluate(f"circuitLab.freshSim.analysis.parts['{qid}']")
        check(f'{tag}: Undo กลับเป็น NPN กระแสกลับมา', r3 and r3['current'] > 1e-3, json.dumps(r3))
        page.screenshot(path=f'{OUT}/{tag}-1-bjt.png')
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.4)

        lib('ออปแอมป์')
        tap_ref(H('f10'))
        u = page.evaluate("(circuitLab.doc.parts.find(p => p.kind === 'opamp') || null)")
        check(f'{tag}: วาง DIP-8 คร่อมร่องที่ f10 ผ่าน UI (ขา 1 แถว f, ขา 8 แถว e)', u and u['placement'].get('anchor') == 'f10', str(u and u['placement']))
        time.sleep(0.5)
        diags = page.evaluate("circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics.map(d => d.message) : []")
        check(f'{tag}: ขาว่าง NC ไม่ถูกแจ้งว่าปลายเปิด และแจ้งไฟเลี้ยงไม่พอ/ขาเข้าลอย', not any('NC' in d for d in diags) and any('ลอย' in d or 'ไฟเลี้ยง' in d for d in diags), ' | '.join(diags)[:300])
        page.screenshot(path=f'{OUT}/{tag}-2-opamp.png')
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        page.click('.lesson-card:has-text("ขยายกลับเฟส")'); time.sleep(0.3)
        check(f'{tag}: เปิดแลป 10 ได้ และมีเป้าหมายตรวจผล', page.locator('#lesson-goals .goal').count() >= 5)
        page.screenshot(path=f'{OUT}/{tag}-3-lesson.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

def run_bode(mobile=False):
    """กราฟโบด: เปิดวงจรกรอง RC, Run, แท็บกราฟโบด, อ่าน −3 dB, เปลี่ยนช่วง, เคอร์เซอร์, แลป 11"""
    tag = ('mobile' if mobile else 'desktop') + '-bode'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)
        W = lambda a, b, i: {"id": i, "a": a, "b": b, "color": "#e53935", "arc": 2, "bend": 0}
        Pn = lambda part, pin: {"kind": "pin", "partId": part, "pin": pin}
        # ไฟล์รุ่น 4 (ไม่มีค่าตั้งกราฟโบด) — ทดสอบการอัปเกรดไฟล์ไปด้วย
        base = {"format": "circuitlab3d", "schemaVersion": 4, "app": "e2e", "savedAt": "", "title": "Bode",
                "studentWork": {"lessonId": None, "records": {}, "answers": {}, "achieved": {}},
                "circuit": {"breadboards": [{"id": "bb1", "model": "CL-400", "x": 0, "z": 0}],
                    "parts": [{"id": "FG1", "label": "FG1", "kind": "fgen", "placement": {"kind": "table", "x": -25, "z": -6, "rotation": 0}, "params": {"wave": "sine", "frequency": 1000, "vpp": 2, "offset": 0, "outputImpedance": 50, "outputOn": True}},
                              {"id": "OSC1", "label": "OSC1", "kind": "scope", "placement": {"kind": "table", "x": -25, "z": 8, "rotation": 0}, "params": {"inputResistance": 1e6, "timeDiv": 0.0002, "vdiv1": 0.5, "vdiv2": 0.5, "ch1On": True, "ch2On": True, "trigSource": "ch1", "trigLevel": 0, "trigSlope": "rise"}},
                              {"id": "R1", "label": "R1", "kind": "resistor", "placement": {"kind": "board", "boardId": "bb1", "anchor": "a5", "rotation": 0}, "params": {"resistance": 1000, "powerRating": 0.25, "span": 4}},
                              {"id": "C1", "label": "C1", "kind": "capacitor", "placement": {"kind": "board", "boardId": "bb1", "anchor": "b9", "rotation": 0}, "params": {"capacitance": 1e-7, "ratedVoltage": 50, "polarized": False, "initialVoltage": 0, "span": 2}}],
                    "wires": [W(Pn('FG1', 'OUT'), H('c5'), 'w1'), W(H('c11'), Pn('FG1', 'COM'), 'w2'), W(H('d5'), Pn('OSC1', 'CH1'), 'w3'),
                              W(H('d9'), Pn('OSC1', 'CH2'), 'w4'), W(H('e11'), Pn('OSC1', 'GND'), 'w5')],
                    "probes": {"red": None, "black": None}}}
        path = f'{OUT}/{tag}-base.json'
        json.dump(base, open(path, 'w'))
        page.set_input_files('#file-input', path)
        dismiss_dialog(page)
        time.sleep(0.6)
        bp = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'scope').params")
        check(f'{tag}: เปิดไฟล์รุ่น 4 → เติมค่าตั้งกราฟโบด', bp.get('bodeStart') == 10 and bp.get('bodeStop') == 100000, json.dumps(bp))
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.sim && window.circuitLab.sim.mode === 'tran'", timeout=5000)
        time.sleep(0.3)
        page.click('#dock-tab-bode'); time.sleep(0.3)
        page.wait_for_function("window.circuitLab.bode && window.circuitLab.bode.doc === window.circuitLab.doc", timeout=10000)
        check(f'{tag}: แท็บกราฟโบดแสดง', page.is_visible('#bd-canvas'))
        cut = page.inner_text('#bd-cut')
        fh = page.evaluate("(() => { const d = circuitLab.bode.data; const F = d.freqs, M = d.mag; const pk = Math.max(...M); for (let i = 1; i < F.length; i++) if (M[i] < pk - 3.0103) { const t = (pk - 3.0103 - M[i-1]) / (M[i] - M[i-1]); return 10 ** (Math.log10(F[i-1]) + t * (Math.log10(F[i]) - Math.log10(F[i-1]))); } return null; })()")
        check(f'{tag}: ความถี่ −3 dB ≈ 1.592 kHz (±0.5%)', fh and abs(fh / 1591.55 - 1) < 0.005, f'{cut} ({fh})')
        page.select_option('#bd-stop', '1000000'); time.sleep(0.3)
        page.wait_for_function("window.circuitLab.bode && window.circuitLab.bode.doc === window.circuitLab.doc", timeout=10000)
        n = page.evaluate('circuitLab.bode.data.freqs.length'); f1 = page.evaluate('circuitLab.bode.data.freqs.slice(-1)[0]')
        check(f'{tag}: เปลี่ยนช่วงถึง 1 MHz → คำนวณใหม่ (101 จุด)', n == 101 and abs(f1 - 1e6) < 1, f'{n} {f1}')
        box = page.evaluate("(() => { const r = document.getElementById('bd-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()")
        tap(page, mobile, box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.3)
        time.sleep(0.3)
        cur = page.inner_text('#bd-cursor') if page.locator('#bd-cursor').count() else ''
        check(f'{tag}: แตะกราฟ → อ่านค่าเคอร์เซอร์ (≈ 1 kHz กลางกราฟ 10 Hz–1 MHz)', 'kHz' in cur and 'dB' in cur, cur)
        page.screenshot(path=f'{OUT}/{tag}-1-bode.png')
        page.keyboard.press('Control+z'); time.sleep(0.4)
        st = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'scope').params.bodeStop")
        check(f'{tag}: Undo ค่าตั้งกราฟโบด', st == 100000, str(st))
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        page.click('.lesson-card:has-text("กราฟโบด")'); time.sleep(1.0)
        passed = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 11 ตรวจผ่านข้อบังคับ 4 ข้อจากกราฟโบด', passed >= 4, page.inner_text('#lesson-goals')[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-2-lesson.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

def tap(page, mobile, x, y):
    if mobile: page.touchscreen.tap(x, y)
    else: page.mouse.click(x, y)

def run_pico(mobile=False):
    """Raspberry Pi Pico: บูต MicroPython, ไฟกะพริบอัตโนมัติ, REPL, แก้โค้ดอ่านปุ่ม, สลับสวิตช์, หยุดโปรแกรม, แลป 12"""
    tag = ('mobile' if mobile else 'desktop') + '-pico'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=20000)
        time.sleep(0.5)
        W = lambda a, b, i: {"id": i, "a": a, "b": b, "color": "#e53935", "arc": 2, "bend": 0}
        Bp = lambda kind, pid, anchor, params: {"id": pid, "label": pid, "kind": kind, "placement": {"kind": "board", "boardId": "bb1", "anchor": anchor, "rotation": 0}, "params": params}
        blink = "from machine import Pin\nimport time\n\nled = Pin(15, Pin.OUT)\n\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n"
        base = {"format": "circuitlab3d", "schemaVersion": 7, "app": "e2e", "savedAt": "", "title": "Pico",
                "studentWork": {"lessonId": None, "records": {}, "answers": {}, "achieved": {}},
                "circuit": {"breadboards": [{"id": "bb1", "model": "CL-400", "x": 0, "z": 0}],
                    "parts": [Bp('pico', 'PICO1', 'h5', {"code": blink, "autorun": True}),
                              Bp('resistor', 'R1', 'j24', {"resistance": 220, "powerRating": 0.25, "span": 4}),
                              Bp('led', 'LED1', 'i28', {"color": "red", "Is": 0.02 / (math.exp(1.9 / (2 * 0.025852)) - 1), "n": 2, "Rs": 5, "ratedCurrent": 0.02, "maxCurrent": 0.03, "maxReverseVoltage": 5}),
                              Bp('switch', 'S1', 'i23', {"closed": False, "onResistance": 0.05})],
                    "wires": [W(H('h29'), H('bn29'), 'w1'), W(H('j22'), H('bn22'), 'w2'), W(H('j25'), H('bn26'), 'w3')],
                    "probes": {"red": None, "black": None}}}
        path = f'{OUT}/{tag}-base.json'
        json.dump(base, open(path, 'w'))
        page.set_input_files('#file-input', path)
        dismiss_dialog(page)
        time.sleep(0.8)
        check(f'{tag}: เปิดไฟล์ที่มี Pico (schema 7)', page.evaluate("circuitLab.doc.parts.some(p => p.kind === 'pico')"), page.inner_text('#status-msg'))
        def tap(x, y):
            if mobile: page.touchscreen.tap(x, y)
            else: page.mouse.click(x, y)
            time.sleep(0.15)
        def tap_ref(ref):
            s = page.evaluate(SCREEN_OF, ref); tap(s['x'], s['y'])
        NET = "([p, pin]) => circuitLab.conn().netOf.get(p + ':' + pin)"
        HNET = "(h) => circuitLab.conn().netOf.get('bb1/' + h)"
        # ตำแหน่งขาในโมเดลตรงกับรูที่ใช้คำนวณ: ขา 1 (GP0) h5, ขา 20 (GP15) h24, ขา 21 (GP16) c24, ขา 40 (VBUS) c5
        okmap = all(page.evaluate(NET, ['PICO1', pin]) == page.evaluate(HNET, hole) for pin, hole in [('GP0', 'h5'), ('GP15', 'h24'), ('GP16', 'c24'), ('VBUS', 'c5'), ('3V3', 'c9'), ('GP26', 'c14')])
        check(f'{tag}: ขา Pico อยู่ในรูตามบอร์ดจริง (ขา 1 ล่างซ้าย เรียงทวนเข็มนาฬิกา)', okmap)
        # เลือกบอร์ดด้วยการแตะตัวบอร์ด → ป้ายชื่อขาแสดง
        c = page.evaluate(WORLD_SCREEN, ['e14', 1.6, 0.6])
        tap(c['x'], c['y'])
        sel = page.evaluate('circuitLab.selection')
        check(f'{tag}: แตะบอร์ดแล้วเลือก Pico ได้', sel and sel.get('id') == 'PICO1', str(sel))
        if not mobile:
            # ลากย้าย 2 คอลัมน์ แล้วตรวจว่าขายังผูกกับรูตามตำแหน่งใหม่ จากนั้น Undo
            a = page.evaluate(WORLD_SCREEN, ['e14', 1.6, 0.6]); bpt = page.evaluate(WORLD_SCREEN, ['e16', 1.6, 0.6])
            page.mouse.move(a['x'], a['y']); page.mouse.down()
            for i in range(1, 11): page.mouse.move(a['x'] + (bpt['x'] - a['x']) * i / 10, a['y'] + (bpt['y'] - a['y']) * i / 10)
            page.mouse.up(); time.sleep(0.4)
            anc = page.evaluate("circuitLab.doc.parts.find(p => p.id === 'PICO1').placement.anchor")
            moved = anc == 'h7' and page.evaluate(NET, ['PICO1', 'GP0']) == page.evaluate(HNET, 'h7')
            check(f'{tag}: ลากย้าย Pico → ขา GP0 ไปอยู่รู h7 ตามตัวบอร์ด', moved, str(anc))
            page.keyboard.press('Control+z'); time.sleep(0.3)
        # ต่อสายเข้าขาหลายประเภทผ่าน UI (ไฟเลี้ยง 3V3, GND, ADC)
        page.keyboard.press('Escape')
        page.click('.tool[aria-label="ต่อสาย (W)"]')
        n0 = page.evaluate('circuitLab.doc.wires.length')
        tap_ref(H('a9')); tap_ref(H('tp9'))
        tap_ref(H('a7')); tap_ref(H('tn8'))
        tap_ref(H('b14')); tap_ref(H('a20'))
        wired = page.evaluate('circuitLab.doc.wires.length') - n0
        nets_ok = page.evaluate(NET, ['PICO1', '3V3']) == page.evaluate(HNET, 'tp9') and page.evaluate(NET, ['PICO1', 'GND']) == page.evaluate(HNET, 'tn8') and page.evaluate(NET, ['PICO1', 'GP26']) == page.evaluate(HNET, 'a20')
        check(f'{tag}: ต่อสายเข้ากลุ่มรูของขา 3V3 / GND / GP26 ผ่าน UI และเน็ตตรงกัน', wired == 3 and nets_ok, f'{wired} wires')
        page.click('.tool[aria-label="เลือก / ย้าย (V)"]')
        page.click('#btn-run')
        page.wait_for_function("window.circuitLab.mcu && window.circuitLab.mcu.booted", timeout=30000)
        check(f'{tag}: บูต MicroPython ในตัวจำลอง', 'MicroPython v1.24.1' in page.evaluate('circuitLab.picoConsole'), page.evaluate('circuitLab.picoConsole')[:120])
        check(f'{tag}: แท็บ Pico แสดง (ตัวแก้โค้ด + console)', page.is_visible('#pc-code') and page.is_visible('#pc-console'))
        I = lambda: page.evaluate("(() => { const s = circuitLab.freshSim; return s && s.analysis.ok ? s.analysis.parts['LED1'].current : null; })()")
        try:
            page.wait_for_function("circuitLab.mcu && circuitLab.mcu.running", timeout=30000)
            # เก็บค่าที่เห็นสะสม (เครื่องทดสอบที่ช้า เวลาจำลองเดินช้ากว่าเวลาจริง)
            page.evaluate("window.__ledSeen = { on: 0, off: false }; setInterval(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.ok) return; const i = s.analysis.parts['LED1'].current; if (i > 1e-3) window.__ledSeen.on = Math.max(window.__ledSeen.on, i); if (Math.abs(i) < 1e-6 && window.__ledSeen.on) window.__ledSeen.off = true; }, 20)")
            page.wait_for_function("window.__ledSeen.on > 0 && window.__ledSeen.off", timeout=40000)
            on_i = page.evaluate("window.__ledSeen.on")
            blink_ok = True
        except Exception:
            on_i = I(); blink_ok = False
        check(f'{tag}: โค้ดไฟกะพริบรันอัตโนมัติ LED ติด (≈ 4–5 mA) และดับสลับกัน', blink_ok and on_i and 3e-3 < on_i < 6e-3, str(on_i))
        page.screenshot(path=f'{OUT}/{tag}-1-blink.png')
        page.click('#pc-stop')
        page.wait_for_function("circuitLab.picoConsole.includes('KeyboardInterrupt')", timeout=20000)
        check(f'{tag}: ปุ่มหยุด → KeyboardInterrupt', True)
        page.wait_for_function("circuitLab.mcu && !circuitLab.mcu.running", timeout=20000)
        page.fill('#pc-input', 'print(2**10)'); page.press('#pc-input', 'Enter')
        page.wait_for_function("circuitLab.picoConsole.includes('1024')", timeout=20000)
        check(f'{tag}: พิมพ์คำสั่งใน REPL → ได้ผล 1024', True)
        btn = "from machine import Pin\nimport time\nled = Pin(15, Pin.OUT)\nbtn = Pin(14, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(not btn.value())\n    time.sleep_ms(10)\n"
        page.fill('#pc-code', btn)
        page.click('#pc-run')
        time.sleep(1.0)
        code_saved = page.evaluate("circuitLab.doc.parts.find(p => p.kind === 'pico').params.code")
        check(f'{tag}: รันโค้ดใหม่แล้วบันทึกโค้ดลงไฟล์งาน', code_saved == btn)
        page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.ok && Math.abs(s.analysis.parts['LED1'].current) < 1e-6; })()", timeout=20000)
        page.evaluate("circuitLab.select({t: 'part', id: 'S1'})"); time.sleep(0.3)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.click('#props .btn-row button:has-text("แตะเพื่อปิด")'); time.sleep(0.3)
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        try:
            page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.ok && s.analysis.parts['LED1'].current > 1e-3; })()", timeout=20000)
            pressed = True
        except Exception:
            pressed = False
        check(f'{tag}: กดสวิตช์ (GP14 ลงกราวด์) → โปรแกรมอ่านขาเข้าแล้ว LED ติด', pressed, str(I()))
        page.screenshot(path=f'{OUT}/{tag}-2-button.png')
        page.fill('#pc-input', '1/0'); page.press('#pc-input', 'Enter')
        time.sleep(0.3)
        page.click('#pc-stop')
        page.wait_for_function("circuitLab.mcu && !circuitLab.mcu.running", timeout=20000)
        page.fill('#pc-input', '1/0'); page.press('#pc-input', 'Enter')
        page.wait_for_function("circuitLab.picoConsole.includes('ZeroDivisionError')", timeout=20000)
        check(f'{tag}: ข้อผิดพลาดของโปรแกรมแสดง Traceback จริง', True)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        page.click('.lesson-card:has-text("ไมโครคอนโทรลเลอร์")'); time.sleep(1.0)
        passed = page.locator('#lesson-goals .goal.pass').count()
        check(f'{tag}: แลป 12 ตรวจผ่าน (wiring, button และ LED ติดอยู่)', passed >= 3, page.inner_text('#lesson-goals')[:300].replace('\n', ' | '))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

run(False)
run(True)
run_transient(False)
run_transient(True)
run_scope(False)
run_scope(True)
run_semis(False)
run_semis(True)
run_bode(False)
run_bode(True)
run_pico(False)
run_pico(True)
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} ผ่าน')
json.dump([{'name': n, 'pass': p, 'detail': d} for n, p, d in results], open(f'{OUT}/results.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(1 if fails else 0)
