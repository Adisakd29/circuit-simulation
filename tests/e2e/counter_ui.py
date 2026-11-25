"""E2E: ไอซีนับ CD4017 ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
เปิดวงจรแลป 26 (555 astable → CLK ของ CD4017, LED 10 ดวงที่ Q0–Q9) → Run (ตามเวลา)
→ นับเพิ่มทีละ 1 วน 0–9, LED ที่ติด (ผลจำลองและแสงในฉาก) ตรงกับขาที่นับทีละดวง → แผงผลแสดง "นับได้" → แลป 26 ผ่านครบ 5 ข้อ
→ ชี้/แตะรู e14 → ป้าย "U2 · ขา 14 CLK" → ย้ายสาย RESET ไป Q4 → นับแค่ 0–3 + ข้อไม่บังคับผ่าน
→ ถอดสาย CLK INH → เตือนขาลอย → วางไอซีนับใหม่จากคลังอุปกรณ์
ใช้: python3 tests/e2e/counter_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson26-chaser.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
# LED ที่ต่อกับ Q k: id L{k}
SAMPLE = """(async () => { const out = []; const t0 = performance.now();
  while (performance.now() - t0 < %d) { await new Promise(r => setTimeout(r, 60)); const s = circuitLab.freshSim; if (!s || !s.analysis.parts.U2) continue;
    const x = s.analysis.parts.U2.extra; const lit = []; const glow = [];
    for (let k = 0; k < 10; k++) { const p = s.analysis.parts['L' + k]; if (p && p.current > 1e-3) lit.push(k);
      const g = circuitLab.view.partObjs.get('L' + k); const sp = g && g.userData.glowSprite; if (sp && sp.material.opacity > 0.3) glow.push(k); }
    const last = out[out.length - 1];
    if (!last || last.n !== x.count || last.lit.join() !== lit.join() || last.glow.join() !== glow.join()) out.push({ t: s.t, n: x.count, lit, glow }); }
  return out; })()"""

def cam_still(page):
    page.evaluate("window.__camStill = null")
    page.wait_for_function("""(() => { const p = circuitLab.view.camera.position; const k = p.toArray().map(v => v.toFixed(2)).join();
      const w = window.__camStill || (window.__camStill = { k: '', n: 0 }); w.n = w.k === k ? w.n + 1 : 0; w.k = k; return w.n >= 3; })()""", timeout=30000, polling=100)

def focus(page, hole, dist=14):
    page.evaluate(f"""() => {{ const v = circuitLab.view; const w = v.terminalWorld({{kind: 'hole', boardId: 'bb1', hole: '{hole}'}});
      v.controls.target.set(w.x, 0, w.z); v.persp.position.set(w.x, {dist}, w.z + {dist * 0.7}); v.controls.enableDamping = false; v.controls.update(); v.controls.enableDamping = true; v.requestRender(); }}""")
    time.sleep(0.2); cam_still(page)

def rewire(page, frm, to):
    page.evaluate(f"""() => {{ const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc));
      const w = doc.wires.find(w => [w.a, w.b].some(t => t.kind === 'hole' && t.hole === '{frm[0]}') && [w.a, w.b].some(t => t.kind === 'hole' && t.hole === '{frm[1]}'));
      if ({'null' if to is None else 'false'}) doc.wires = doc.wires.filter(x => x !== w);
      else {{ const e = [w.a, w.b].find(t => t.hole === '{frm[1]}'); e.hole = '{to or ''}'; }}
      app.apply({{ ok: true, doc, warnings: [] }}, 'แก้สาย'); }}""")

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
        page.click('#btn-run')
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.mode === 'tran' && circuitLab.freshSim.analysis.parts.U2", timeout=30000, polling=250)
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        focus(page, 'h20', 24)
        tr = page.evaluate(SAMPLE % 9000)
        seq_ok = all(tr[k]['n'] == (tr[k - 1]['n'] + 1) % 10 for k in range(1, len(tr)) if tr[k]['n'] != tr[k - 1]['n'])
        ns = set(x['n'] for x in tr)
        check(f'{tag}: นับเพิ่มทีละ 1 วน 0→9→0 (เห็นครบ 10 ค่า)', seq_ok and len(ns) == 10, ' '.join(str(x['n']) for x in tr[:24]))
        match = [x for x in tr if x['lit'] == [x['n']]]  # (บันทึกเมื่อค่านับ/LED/แสงเปลี่ยน)
        check(f'{tag}: LED ที่ติดในผลจำลองตรงกับขาที่นับทีละดวง', len(match) >= 0.9 * len(tr), f'{len(match)}/{len(tr)}')
        # แสงในฉากเล่นตามเวลาจำลองโดยหน่วง 0.1 s (ตัวเล่น LED) จึงเทียบกับลำดับ ไม่ใช่ค่านับ ณ ขณะเดียวกัน:
        # ติดทีละดวง และดวงที่ติดเลื่อนทีละ 1 ตามลำดับ Q0 → Q9
        gs = [x['glow'][0] for x in tr if len(x['glow']) == 1]
        seq = [g for k, g in enumerate(gs) if k == 0 or g != gs[k - 1]]
        # ลำดับการติดของแสงในฉากตรวจไม่ได้บนเครื่องทดสอบนี้ (วาดด้วย GPU ซอฟต์แวร์ ที่ 1440×900 บางช่วงไม่ได้วาดเกิน 1 s) —
        # ตรวจลำดับและจังหวะของตัวเล่น LED แยกใน tests/led-playback.test.ts และ dock_ui.py; ที่นี่ตรวจว่าติดทีละดวงและไล่ครบหลายดวง
        # เฟรมที่คร่อมจังหวะเปลี่ยนดวงแสดงสองดวงสว่างครึ่งหนึ่ง (เฉลี่ยในช่วงเฟรม ≤ 1/30 s) — เครื่องทดสอบเฟรมช้าจึงเห็นบ่อย ให้ไม่เกิน 25%
        multi = [x for x in tr if len(x['glow']) > 1]
        check(f'{tag}: แสง LED ในฉาก 3 มิติติดทีละดวง และติดครบอย่างน้อย 6 ดวงต่างกัน', len(set(seq)) >= 6 and len(multi) <= 0.25 * len(tr), f'ติดพร้อมกัน {len(multi)}/{len(tr)} · {" ".join(map(str, seq[:24]))}')
        page.screenshot(path=f'{OUT}/{tag}-cnt-1-run.png')
        page.evaluate("circuitLab.select({t: 'part', id: 'U2'})"); time.sleep(0.5)
        if mobile: page.click('#btn-right'); time.sleep(0.4)
        txt = page.inner_text('.panel.right')
        check(f'{tag}: แผงผลแสดง "นับได้" และลำดับ Q0–Q9', 'นับได้' in txt and 'ลำดับ Q0–Q9' in txt and 'CARRY OUT' in txt, txt[txt.find('นับได้'):][:80].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-cnt-2-panel.png')
        if mobile and page.locator('.panel.right .drawer-close').is_visible(): page.click('.panel.right .drawer-close', force=True); time.sleep(0.4)
        # แลป 26
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lessons'); time.sleep(0.2)
        if page.locator('.lesson-card:has-text("ไฟวิ่ง")').count(): page.click('.lesson-card:has-text("ไฟวิ่ง")')
        try: page.wait_for_function("document.querySelectorAll('#lesson-goals .goal.pass').length >= 5", timeout=15000, polling=250)
        except Exception: pass
        goals = page.inner_text('#lesson-goals')
        req = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal')].filter(g => !g.textContent.includes('ไม่บังคับ')).map(g => g.classList.contains('pass'))")
        check(f'{tag}: แลป 26 ผ่านครบ 5 ข้อที่บังคับ (power/inputs/clock/leds/sequence)', len(req) == 5 and all(req), goals[:300].replace('\n', ' | '))
        page.screenshot(path=f'{OUT}/{tag}-cnt-3-lesson.png')
        if mobile and page.locator('.panel.left .drawer-close').is_visible(): page.click('.panel.left .drawer-close', force=True); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        # ป้ายชื่อขาที่รู e14
        focus(page, 'e14', 12)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'e14'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}รู e14 → ป้าย "U2 · ขา 14 CLK ..."', t is not None and t.startswith('U2 · ขา 14 CLK'), str(t))
        page.screenshot(path=f'{OUT}/{tag}-cnt-4-tip.png')
        if not mobile: page.mouse.move(5, 450)
        # RESET → Q4 (c18)
        rewire(page, ('b13', 'tn14'), 'c18')
        time.sleep(1.0)
        tr2 = page.evaluate(SAMPLE % 5000)
        ns2 = sorted(set(x['n'] for x in tr2[1:]))
        check(f'{tag}: ย้าย RESET ไป Q4 → นับแค่ 0–3 แล้ววน', ns2 == [0, 1, 2, 3], str(ns2))
        try: page.wait_for_function("(circuitLab.work.achieved.counter || {}).short === true", timeout=6000, polling=250)
        except Exception: pass
        check(f'{tag}: ข้อไม่บังคับ "ต่อ RESET เข้าขาออก Q" ผ่าน', page.evaluate("(circuitLab.work.achieved.counter || {}).short === true"))
        # ถอดสาย CLK INH
        rewire(page, ('c15', 'tn15'), None)
        try: page.wait_for_function("(() => { const s = circuitLab.freshSim; return s && s.analysis.diagnostics.some(d => d.partId === 'U2' && d.message.includes('CLOCK INHIBIT') && d.message.includes('ลอย')); })()", timeout=8000, polling=200)
        except Exception: pass
        d = page.evaluate("(circuitLab.freshSim ? circuitLab.freshSim.analysis.diagnostics : []).filter(d => d.partId === 'U2').map(d => d.message).join(' | ')")
        check(f'{tag}: ถอดสาย CLK INH → เตือนขา 13 ลอย', 'CLOCK INHIBIT' in d and 'ลอย' in d, d[:160])
        page.click('#btn-stop'); time.sleep(0.4)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ไอซีนับ")'); time.sleep(0.3)
        focus(page, 'f24', 14)
        p = page.evaluate(SCREEN_OF, {'kind': 'hole', 'boardId': 'bb1', 'hole': 'f21'})
        (page.touchscreen.tap if mobile else page.mouse.click)(p['x'], p['y']); time.sleep(0.5)
        m = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'counter').map(p => [p.id, p.placement.anchor])")
        check(f'{tag}: วางไอซีนับใหม่ที่ f21 คร่อมร่องจากคลังอุปกรณ์', len(m) == 2 and any(a == 'f21' for _, a in m), str(m) + ' ' + page.inner_text('#status-msg'))
        page.screenshot(path=f'{OUT}/{tag}-cnt-5-placed.png')
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
