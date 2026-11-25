"""ชั้น Gerber (SVG จาก gerber-to-svg) → ภาพขาวดำในกรอบบอร์ดเดียวกัน: x 0..W, y 0..H (mm) · แถวบนสุดของภาพ = y = H"""
import re, sys, os
from playwright.sync_api import sync_playwright
def frame(svg, W, H, mirror=False):
    m = re.search(r'<g transform="translate\(0,[-\d.]+\) scale\(1,-1\)"', svg)
    body = svg[m.start():svg.rindex('</svg>')]
    body = body.replace(m.group(0), '<g transform="translate(0,%d) scale(1,-1)"' % (H * 1000), 1)
    defs = re.search(r'<defs>.*?</defs>', svg, re.S)
    inner = (defs.group(0) if defs else '') + body
    if mirror: inner = f'<g transform="translate({W*1000},0) scale(-1,1)">{inner}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W*1000} {H*1000}" width="100%" height="100%" stroke-linecap="round" stroke-linejoin="round" stroke-width="0" fill-rule="evenodd" style="color:#fff;background:#000">{inner}</svg>'
def raster(jobs, W, H, px_h):
    px_w = round(px_h * W / H)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': px_w, 'height': px_h})
        for src, out, mirror in jobs:
            pg.set_content(f'<body style="margin:0;background:#000">{frame(open(src).read(), W, H, mirror)}</body>')
            pg.screenshot(path=out)
        b.close()
    return px_w, px_h
if __name__ == '__main__':
    d = sys.argv[1]; o = sys.argv[2]; W, H, ph = float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
    jobs = [(os.path.join(d, f'{n}.art.svg'), os.path.join(o, f'{n}.png'), False) for n in sys.argv[6].split(',')]
    print(raster(jobs, W, H, ph))
