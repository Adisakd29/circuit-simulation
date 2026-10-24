"""E2E: แท็บ "แลป" และรูปวงจรของทุกแลป ผ่าน UI จริง (เดสก์ท็อป 1440×900 และจำลอง viewport มือถือ 390×844 + touch)
แท็บชื่อ "แลป" → เปิดแลปทีละแลป (39 แลป) หัวข้อขึ้นต้น "แลป N" และมีรูปวงจร (SVG) กว้างพอดีแผง ไม่ล้นจอ
→ แตะรูปเพื่อขยายเต็มจอแล้วปิด → ภาพตัวอย่างของบางแลป
ใช้: python3 tests/e2e/schematic_ui.py <out-dir> [url] [desktop,mobile]
"""
import os, sys, time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:4173/'
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)

def run(mobile):
    tag = 'mobile' if mobile else 'desktop'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        page.goto(URL)
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        page.evaluate('localStorage.clear()'); page.reload()
        page.wait_for_function('window.circuitLab !== undefined', timeout=30000)
        time.sleep(0.6)
        if mobile: page.click('#btn-left'); time.sleep(0.4)
        tab = page.inner_text('#tab-lessons').strip()
        check(f'{tag}: แท็บชื่อ "แลป"', tab == 'แลป', tab)
        page.click('#tab-lessons'); time.sleep(0.3)
        n = page.locator('.lesson-card').count()
        check(f'{tag}: มี 39 แลปในรายการ', n == 39, str(n))
        bad, heads = [], []
        vw = page.viewport_size['width']
        for i in range(n):
            page.locator('.lesson-card').nth(i).click(); time.sleep(0.15)
            info = page.evaluate("""() => { const h = document.querySelector('.lesson h2'); const f = document.getElementById('lesson-schematic'); const s = f && f.querySelector('svg');
              if (!s) return { head: h && h.textContent, ok: false }; const r = s.getBoundingClientRect(); const p = document.querySelector('#lessons-body').getBoundingClientRect();
              return { head: h.textContent, ok: true, w: r.width, h: r.height, n: s.querySelectorAll('line,polyline,polygon,path,circle,rect,text').length, inside: r.right <= p.right + 1 && r.left >= p.left - 1 }; }""")
            heads.append(info['head'])
            if not (info['ok'] and info['w'] > (300 if mobile else 220) and info['h'] > 80 and info['n'] > 15 and info['inside'] and info['head'].startswith(f'แลป {i + 1} ')): bad.append((i + 1, info))
            if i + 1 in (10, 22, 31): page.locator('#lesson-schematic').screenshot(path=f'{OUT}/{tag}-sch-{i + 1}.png')
            page.click('.lesson .back'); time.sleep(0.1)
        check(f'{tag}: ทุกแลปมีหัวข้อ "แลป N …" และรูปวงจรเต็มความกว้างแผง ไม่ล้น', not bad, str(bad[:3]))
        # ขยายรูป
        page.locator('.lesson-card').nth(19).click(); time.sleep(0.2)
        page.click('#lesson-schematic'); time.sleep(0.4)
        d = page.evaluate("""() => { const d = document.getElementById('dialog'); const s = d.querySelector('.schem.big svg'); const r = s && s.getBoundingClientRect(); return { open: d.open, w: r ? r.width : 0, vis: !!r && (window.innerWidth < 600 || r.right <= window.innerWidth + 1), title: d.querySelector('h2') ? d.querySelector('h2').textContent : '' }; }""")
        check(f'{tag}: แตะรูปวงจร → ขยายในหน้าต่าง (กว้างกว่าในแผง)', d['open'] and d['w'] >= (630 if mobile else 900) and d['vis'] and d['title'].startswith('รูปวงจร แลป 20'), str(d))
        page.screenshot(path=f'{OUT}/{tag}-sch-zoom.png')
        page.click('#schem-close'); time.sleep(0.3)
        check(f'{tag}: ปิดหน้าต่างขยายได้ และหน้าต่างอื่นกลับขนาดเดิม', not page.evaluate("document.getElementById('dialog').open") and not page.evaluate("document.getElementById('dialog').classList.contains('wide')"))
        check(f'{tag}: ไม่มีคำว่า "บททดลอง"/"บทที่" ในหน้า', page.evaluate("!/บททดลอง|บทที่ \\d/.test(document.body.innerText)"))
        check(f'{tag}: ไม่มี JavaScript error', not errors, '; '.join(errors[:3]))
        browser.close()

modes = (sys.argv[3] if len(sys.argv) > 3 else 'desktop,mobile').split(',')
for m in modes: run(m == 'mobile')
print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
