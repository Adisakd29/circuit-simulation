"""E2E: บัซเซอร์ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
active + ไฟตรง 5 V → ดัง 2.4 kHz (เสียงในแอป + วงคลื่นในฉาก) → ปิด/เปิดเสียง → เปลี่ยนเป็น passive → เงียบ + คำแนะนำ
passive + เครื่องกำเนิดสี่เหลี่ยม 2 kHz → ดัง 2 kHz → เปลี่ยนเป็น 1 kHz → เสียงเปลี่ยนตาม → Stop → เงียบ
หมายเหตุ: ตรวจ "เสียงที่แอปสั่งเล่น" (รายการ oscillator ใน Web Audio) ไม่ได้ฟังเสียงจริงจากลำโพง
ใช้: python3 tests/e2e/buzzer_ui.py <out-dir> [url] [desktop,mobile]
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

PLAY = "JSON.stringify(circuitLab.audio.playing)"
WAVE = "(() => { let v = null; circuitLab.view.scene.traverse(o => { if (o.userData.soundWave && o.userData.partId === 'BZ1') v = o.visible; }); return v; })()"
EXTRA = "(circuitLab.freshSim && circuitLab.freshSim.analysis.parts['BZ1'] && circuitLab.freshSim.analysis.parts['BZ1'].extra)"

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()')
        page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        page.set_input_files('#file-input', os.path.join(FX, 'buzzer-active.json'))
        time.sleep(1.0)
        page.click('#btn-run')   # การโต้ตอบของผู้ใช้ → เปิด Web Audio
        page.wait_for_function("circuitLab.freshSim && circuitLab.freshSim.analysis.ok", timeout=10000)
        time.sleep(0.5)
        x = page.evaluate(EXTRA); pl = json.loads(page.evaluate(PLAY))
        actx = page.evaluate("circuitLab.audio.ctx ? circuitLab.audio.ctx.state : 'none'")
        check(f'{tag}: active 5 V ดัง 2.4 kHz และแอปสั่งเล่นเสียง 2400 Hz', x and x['sounding'] == 1 and len(pl) == 1 and abs(pl[0]['freq'] - 2400) < 1, f'{x} {pl} audio={actx}')
        check(f'{tag}: Web Audio ทำงานหลังผู้ใช้กด Run', actx == 'running', actx)
        check(f'{tag}: วงคลื่นเสียงเหนือบัซเซอร์ในฉาก 3 มิติแสดงขณะดัง', page.evaluate(WAVE) is True)
        page.screenshot(path=f'{OUT}/{tag}-bz-1-active.png')
        page.evaluate("circuitLab.select({t: 'part', id: 'BZ1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.click('#f-sound'); time.sleep(0.5)
        pl_off = json.loads(page.evaluate(PLAY))
        check(f'{tag}: ปิดเสียงในแอป → ไม่เล่นเสียง (บัซเซอร์ยังดังในแบบจำลอง)', pl_off == [] and page.evaluate(EXTRA)['sounding'] == 1, str(pl_off))
        page.click('#f-sound'); time.sleep(0.6)
        check(f'{tag}: เปิดเสียงอีกครั้ง → เล่นต่อ', len(json.loads(page.evaluate(PLAY))) == 1)
        page.click('#f-bz-passive'); time.sleep(0.6)
        x2 = page.evaluate(EXTRA)
        diags = page.evaluate("circuitLab.freshSim.analysis.diagnostics.map(d => d.message)")
        check(f'{tag}: เปลี่ยนเป็น passive ต่อไฟตรง → เงียบ และแนะนำให้ป้อนคลื่นสี่เหลี่ยม', x2['sounding'] == 0 and json.loads(page.evaluate(PLAY)) == [] and any('คลื่นสี่เหลี่ยม' in d for d in diags), ' | '.join(diags)[:160])
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        page.click('#btn-stop') if page.locator('#btn-stop').is_visible() else page.evaluate('circuitLab.stop()')
        time.sleep(0.3)
        # passive + เครื่องกำเนิดสัญญาณ
        page.set_input_files('#file-input', os.path.join(FX, 'buzzer-passive-fgen.json'))
        time.sleep(1.0)
        page.click('#btn-run')
        try:
            page.wait_for_function(f"(() => {{ const x = {EXTRA}; return x && x.sounding === 1; }})()", timeout=20000, polling=250)
        except Exception: pass
        time.sleep(0.5)
        pl2 = json.loads(page.evaluate(PLAY))
        check(f'{tag}: passive + สี่เหลี่ยม 2 kHz → แอปเล่นเสียง ≈ 2 kHz', len(pl2) == 1 and abs(pl2[0]['freq'] / 2000 - 1) < 0.02, str(pl2))
        page.screenshot(path=f'{OUT}/{tag}-bz-2-passive.png')
        page.evaluate("circuitLab.select({t: 'part', id: 'FG1'})"); time.sleep(0.4)
        if mobile: page.click('#btn-right'); time.sleep(0.3)
        page.fill('#f-frequency', '1k'); page.press('#f-frequency', 'Enter'); time.sleep(0.4)
        try:
            page.wait_for_function(f"(() => {{ const p = circuitLab.audio.playing; return p.length === 1 && Math.abs(p[0].freq - 1000) < 20; }})()", timeout=20000, polling=250)
        except Exception: pass
        pl3 = json.loads(page.evaluate(PLAY))
        check(f'{tag}: เปลี่ยนความถี่เครื่องกำเนิดเป็น 1 kHz → เสียงเปลี่ยนเป็น ≈ 1 kHz', len(pl3) == 1 and abs(pl3[0]['freq'] / 1000 - 1) < 0.02, str(pl3))
        if mobile: page.click('.panel.right .drawer-close'); time.sleep(0.3)
        page.evaluate('circuitLab.stop()'); time.sleep(0.4)
        check(f'{tag}: Stop → หยุดเสียงทั้งหมด และวงคลื่นหาย', json.loads(page.evaluate(PLAY)) == [] and page.evaluate(WAVE) is False)
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

for mode in (sys.argv[3].split(',') if len(sys.argv) > 3 else ['desktop', 'mobile']):
    run(mode == 'mobile')
print(f'== {sum(results)}/{len(results)} ผ่าน ==')
sys.exit(0 if all(results) else 1)
