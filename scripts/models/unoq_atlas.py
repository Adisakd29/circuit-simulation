"""แอตลาสผิวหน้าชิป/โมดูล (ข้อความเลขรุ่นตามเอกสาร — ไม่มีโลโก้ผู้ผลิต) → atlas.png + atlas.json (uv สี่เหลี่ยม u0 v0 u1 v1, v ลงล่าง)"""
import os
import json
from PIL import Image, ImageDraw, ImageFont
F = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
S = 1024
im = Image.new('RGB', (S, S), (40, 40, 40)); d = ImageDraw.Draw(im)
regions = {}
def chip(name, x, y, w, h, base, lines, size=0.12, ink=(150, 152, 152), dot=True):
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=base)
    # ลายผิวแบบด้าน (noise เบา ๆ)
    import random
    rnd = random.Random(name)
    for _ in range(w * h // 40):
        px, py = x + rnd.randrange(w), y + rnd.randrange(h); c = tuple(min(255, max(0, v + rnd.randint(-5, 5))) for v in base); d.point((px, py), fill=c)
    f = ImageFont.truetype(F, int(h * size))
    ty = y + h * 0.5 - len(lines) * h * size * 0.65
    for ln in lines:
        d.text((x + w * 0.5, ty), ln, fill=ink, font=f, anchor='mt'); ty += h * size * 1.3
    if dot: d.ellipse([x + w * 0.06, y + h * 0.06, x + w * 0.06 + h * 0.06, y + h * 0.12], fill=tuple(max(0, v - 18) for v in base))
    regions[name] = [x / S, y / S, (x + w) / S, (y + h) / S]
chip('soc', 0, 0, 340, 330, (78, 82, 83), ['QRB2210', '000', 'HU211HMQ'], 0.095)
chip('dram', 340, 0, 400, 290, (74, 77, 78), ['LPDDR4X'], 0.1)
chip('pmic', 740, 0, 284, 210, (70, 73, 74), ['PM4125', '361'], 0.13)
chip('mcu', 740, 210, 284, 284, (52, 54, 55), ['STM32U585', 'AII6', ''], 0.12)
chip('emmc', 0, 330, 300, 340, (60, 62, 63), ['eMMC'], 0.1)
chip('anx', 300, 290, 200, 200, (58, 60, 61), ['ANX7625'], 0.14)
chip('ic', 500, 290, 120, 120, (42, 43, 44), [], 0.1)
chip('ind', 620, 290, 120, 120, (118, 120, 122), [], 0.1, dot=False)
# โมดูล Wi-Fi: แผ่นเขียว + ฝาครอบโลหะ (มุมบากด้านซ้ายบนตามภาพผลิตภัณฑ์)
x, y, w, h = 300, 500, 380, 500
d.rectangle([x, y, x + w, y + h], fill=(52, 120, 46))
ff = ImageFont.truetype(FB, 15)
d.text((x + 8, y + 104), 'WCBN.5.529A', fill=(230, 240, 230), font=ff)
for (a, b2, c, e) in [(12, 14, 70, 34), (12, 62, 70, 82)]: d.rectangle([x + a, y + b2, x + c, y + e], fill=(225, 225, 222))
d.rectangle([x + 88, y + 40, x + 104, y + 58], outline=(230, 240, 230)); d.text((x + 90, y + 42), '28', fill=(230, 240, 230), font=ImageFont.truetype(FB, 12))
for k in range(5): d.rectangle([x + 112 + (k % 2) * 14, y + 20 + k * 14, x + 120 + (k % 2) * 14, y + 28 + k * 14], fill=(210, 210, 205))
regions['wifi_pcb'] = [x / S, y / S, (x + w) / S, (y + h) / S]
x, y, w, h = 0, 680, 300, 340
for yy in range(h):
    g = 205 + int(10 * ((yy / h) - 0.5)); d.line([(x, y + yy), (x + w, y + yy)], fill=(g, g + 1, g + 3))
regions['shield'] = [x / S, y / S, (x + w) / S, (y + h) / S]
# ตัวเรือนหัวต่อ JMISC/JMEDIA (ช่องเสียบ 2 × 30 พิทช์ 1.27)
x, y, w, h = 690, 500, 330, 60
d.rectangle([x, y, x + w, y + h], fill=(34, 34, 36))
for i in range(30):
    for r in range(2):
        cx = x + 6 + i * (w - 12) / 29.0; cy = y + 18 + r * 24
        d.rectangle([cx - 3, cy - 6, cx + 3, cy + 6], fill=(8, 8, 9))
regions['hdc'] = [x / S, y / S, (x + w) / S, (y + h) / S]
im.save(os.environ.get('CAD_DIR', 'scripts/models/.cad/unoq') + '/out/unoq-atlas.jpg', quality=90)
json.dump(regions, open(os.environ.get('CAD_DIR', 'scripts/models/.cad/unoq') + '/out/atlas.json', 'w'))
print(regions.keys())
