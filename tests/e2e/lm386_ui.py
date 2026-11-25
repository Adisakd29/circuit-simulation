"""E2E: ไอซีขยายเสียง LM386 + ลำโพง 8 Ω ผ่าน UI จริง (เดสก์ท็อป 1440×900 และ viewport มือถือ 390×844 + touch)
เปิดแลป 39 (9 V, เครื่องกำเนิด 1 kHz 20 mVpp → ขา 3, C 220 µF → ลำโพง, สโคป CH1 ขาเข้า CH2 ลำโพง) → Run
→ สโคปวัดอัตราขยาย ≈ 20 · ลำโพงดัง 1 kHz (ส่งเสียงไปที่ระบบเสียง) · แผงผล LM386/ลำโพง → แลป 39 ข้อแรก 5 ข้อ
→ ใส่ C 10 µF ขา 1–8 → ≈ 200 เท่า → สัญญาณเข้า 60 mVpp (ช่อง Vpp ของเครื่องกำเนิด) → ตัดยอด + คำเตือนกำลังลำโพง → 7/7 มีรูปวงจร
→ ป้ายขา "U1 · ขา 1 GAIN" → วางลำโพงใหม่จากคลังบนโต๊ะ · ไม่มี JavaScript error
ใช้: python3 tests/e2e/lm386_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
MODES = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'lesson39-lm386.json')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

SCREEN_OF = """(ref) => { const v = circuitLab.view; const w = v.terminalWorld(ref); v.camera.updateMatrixWorld(); const p = w.clone().project(v.camera);
  const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; }"""
M = "(() => { const a = circuitLab; const s = a.scopePart(); if (!s) return null; const f = a.scope.frame(s.params); return f.measure; })()"
ST = """(() => { const s = circuitLab.freshSim; if (!s || !s.analysis.parts.LS1) return null; const x = s.analysis.parts.LS1.extra || {}, u = (s.analysis.parts.U1 || {}).extra || {};
  return { sounding: x.sounding, freq: x.freq, level: x.level, pac: x.pac, g200: u.gain200, tones: (circuitLab.audio.wanted || []).map(t => Math.round(t.freq)),
    diags: s.analysis.diagnostics.filter(d => d.partId === 'LS1' || d.partId === 'U1').map(d => d.severity + ':' + d.message.slice(0, 40)) }; })()"""

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

def gain(page, lo, hi, timeout=40000):
    try: page.wait_for_function(f"(() => {{ const m = {M}; return m && m[0] && m[1] && m[0].vpp > 1e-3 && m[1].vpp / m[0].vpp > {lo} && m[1].vpp / m[0].vpp < {hi}; }})()", timeout=timeout, polling=250)
    except Exception: pass
    m = page.evaluate(M)
    return (m[1]['vpp'] / m[0]['vpp'], m[0]['vpp'], m[1]['vpp']) if m and m[0] and m[1] and m[0]['vpp'] > 1e-3 else (None, None, None)

def apply(page, js, label):
    page.evaluate(f"""() => {{ const app = circuitLab; const doc = JSON.parse(JSON.stringify(app.doc)); {js}; app.apply({{ ok: true, doc, warnings: [] }}, '{label}'); }}""")

def goals(page, mobile, n):
    if mobile: page.click('#btn-left'); time.sleep(0.3)
    page.click('#tab-lessons'); time.sleep(0.2)
    if page.locator('.lesson-card:has-text("LM386")').count(): page.click('.lesson-card:has-text("LM386")')
    try: page.wait_for_function(f"document.querySelectorAll('#lesson-goals .goal.pass').length >= {n}", timeout=30000, polling=250)
    except Exception: pass
    g = page.evaluate("[...document.querySelectorAll('#lesson-goals .goal.pass')].map(e => e.dataset.goal)")
    return g

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
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
        check(f'{tag}: เปิดไฟล์แลป 39 (schema 37) ไม่มีคำเตือน', page.locator('#dialog[open]').count() == 0, page.inner_text('#status-msg'))
        if page.locator('#lg-toggle').is_visible(): page.click('#lg-toggle'); time.sleep(0.3)
        page.click('#btn-run')
        g, a, b = gain(page, 18.5, 21.5, 60000)
        check(f'{tag}: Run → สโคปวัดอัตราขยาย ≈ 20 เท่า (CH1 ≈ 20 mVpp → CH2 ≈ 0.4 Vpp)', g is not None and 18.5 < g < 21.5 and 0.018 < a < 0.022, f'{g} {a} {b}')
        try: page.wait_for_function(f"(() => {{ const s = {ST}; return s && s.sounding === 1 && Math.abs(s.freq - 1000) < 5 && s.pac < 3.5e-3 && s.diags.length === 0 && s.tones.length > 0; }})()", timeout=90000, polling=300)
        except Exception: pass
        s = page.evaluate(ST)
        check(f'{tag}: ลำโพงดัง 1 kHz ≈ 2.5 mW และส่งเสียง 1000 Hz ไปที่ระบบเสียง ไม่มีคำเตือนที่ LM386/ลำโพง', s and s['sounding'] == 1 and abs(s['freq'] - 1000) < 5 and 1000 in [round(t, -1) for t in s['tones']] and 1.5e-3 < s['pac'] < 3.5e-3 and s['diags'] == [], str(s))
        page.evaluate("circuitLab.select({t: 'part', id: 'LS1'})"); time.sleep(0.3)
        if mobile: page.click('#btn-right'); time.sleep(0.5)
        try: page.wait_for_function("document.getElementById('props').innerText.includes('กำลังเสียง')", timeout=15000, polling=250)
        except Exception: pass
        txt = page.inner_text('#props')
        if mobile: close_drawers(page)
        check(f'{tag}: แผงผลของลำโพงแสดงความถี่ ≈ 1 kHz (±1%) และกำลังเสียง', re.search(r'(99\d Hz|1\.0[01] kHz) · ความดัง', txt) is not None and 'กำลังเสียง' in txt, txt[txt.find('กำลังเสียง') - 60:][:140].replace('\n', ' | '))
        g1 = goals(page, mobile, 5)
        check(f'{tag}: แลป 39 ผ่าน power/input/output/scope/gain20', all(k in g1 for k in ['power', 'input', 'output', 'scope', 'gain20']), str(g1))
        if mobile: close_drawers(page)
        apply(page, "doc.parts.push({ id: 'CG', label: 'CG', kind: 'capacitor', placement: { kind: 'board', boardId: 'bb1', anchor: 'h16', rotation: 0 }, params: { capacitance: 10e-6, ratedVoltage: 16, polarized: true, initialVoltage: 0, span: 3 } }); doc.wires.push({ id: 'wg1', a: { kind: 'hole', boardId: 'bb1', hole: 'g16' }, b: { kind: 'hole', boardId: 'bb1', hole: 'g20' }, color: '#43a047', arc: 2, bend: 0 }, { id: 'wg2', a: { kind: 'hole', boardId: 'bb1', hole: 'i19' }, b: { kind: 'hole', boardId: 'bb1', hole: 'd20' }, color: '#43a047', arc: 2, bend: 0 })", 'ใส่ C ขา 1–8')
        g, a, b = gain(page, 180, 215)
        check(f'{tag}: ใส่ C 10 µF ขา 1–8 → อัตราขยาย ≈ 200 เท่า (CH2 ≈ 3.9 Vpp)', g is not None and 185 < g < 212, f'{g} {a} {b}')
        focus(page, 'f20', 16)
        page.screenshot(path=f'{OUT}/{tag}-lm386-1-gain200.png')
        page.evaluate("circuitLab.select({t: 'part', id: 'FG1'})"); time.sleep(0.3)
        if mobile: page.click('#btn-right'); time.sleep(0.5)
        fld = page.locator('#f-vpp')
        if fld.count(): fld.fill('0.06'); fld.press('Enter'); time.sleep(0.4)
        else: apply(page, "doc.parts.find(p => p.id === 'FG1').params.vpp = 0.06", 'vpp')
        if mobile: close_drawers(page)
        try: page.wait_for_function(f"(() => {{ const m = {M}; return m && m[1] && m[1].vpp > 7.2; }})()", timeout=40000, polling=250)
        except Exception: pass
        m = page.evaluate(M); s = page.evaluate(ST)
        check(f'{tag}: สัญญาณเข้า 60 mVpp → ขาออกถูกตัดยอด ≈ 7.5 Vpp (ไม่ใช่ 12 V) มีคำเตือนกำลังลำโพงเกิน 0.5 W', m and m[1] and 7.2 < m[1]['vpp'] < 7.9 and any(d.startswith('danger') for d in s['diags']), f"{m and m[1] and m[1]['vpp']} {s['diags']}")
        g2 = goals(page, mobile, 7)
        check(f'{tag}: แลป 39 ผ่านครบ 7 ข้อ (รวม gain200, clip)', len(g2) == 7, str(g2))
        svg_ok = page.evaluate("(() => { const s = document.querySelector('#lesson-schematic svg'); return !!s && s.innerHTML.includes('LM386') && s.innerHTML.includes('220 µF'); })()")
        check(f'{tag}: แลป 39 มีรูปวงจร (LM386, C1 220 µF, ลำโพง)', svg_ok)
        page.screenshot(path=f'{OUT}/{tag}-lm386-2-lesson.png')
        if mobile: close_drawers(page)
        page.click('#btn-stop'); time.sleep(0.4)
        page.evaluate("circuitLab.select(null)"); time.sleep(0.2)
        if page.locator('#lg-hide').is_visible(): page.click('#lg-hide'); time.sleep(0.3)
        focus(page, 'f20', 7)
        p = page.evaluate(SCREEN_OF, {'kind': 'pin', 'partId': 'U1', 'pin': 'G1'})
        if mobile:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': p['x'], 'y': p['y'], 'id': 0}]}); time.sleep(0.05)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.4)
        else:
            page.mouse.move(p['x'], p['y']); time.sleep(0.4)
        t = page.evaluate("(() => { const e = document.getElementById('pin-tip'); return e && !e.hidden ? e.textContent : null; })()")
        check(f'{tag}: {"แตะ" if mobile else "ชี้"}ขา 1 → ป้าย "U1 · ขา 1 GAIN"', t is not None and t.startswith('U1 · ขา 1 GAIN'), str(t))
        if not mobile: page.mouse.move(5, 450)
        if mobile: page.click('#btn-left'); time.sleep(0.3)
        page.click('#tab-lib'); time.sleep(0.2)
        page.click('.lib-item:has-text("ลำโพง 8 Ω")'); time.sleep(0.3)
        if mobile:
            try: page.wait_for_function("!document.querySelector('.panel.left').classList.contains('open')", timeout=5000)
            except Exception: close_drawers(page)
            time.sleep(0.4)
        page.evaluate("""() => { const v = circuitLab.view; v.controls.target.set(40, 0, 40); v.persp.position.set(40, 60, 90); v.controls.update(); v.requestRender(); }""")
        cam_still(page)
        q = page.evaluate("""(() => { const v = circuitLab.view; const p = new v.camera.position.constructor(40, -2.4, 40); v.camera.updateMatrixWorld(); p.project(v.camera); const r = v.renderer.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; })()""")
        if mobile: page.touchscreen.tap(q['x'], q['y'])
        else: page.mouse.click(q['x'], q['y'])
        try: page.wait_for_function("circuitLab.doc.parts.filter(p => p.kind === 'speaker').length === 2", timeout=5000)
        except Exception: pass
        n = page.evaluate("circuitLab.doc.parts.filter(p => p.kind === 'speaker').map(p => p.placement.kind)")
        check(f'{tag}: วางลำโพงใหม่จากคลังบนโต๊ะ', len(n) == 2 and n[1] == 'table', f"{n} {page.inner_text('#status-msg')}")
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for m in MODES:
    run(m == 'mobile')
print(f'{sum(results)}/{len(results)} passed')
