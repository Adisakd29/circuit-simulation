import json, sys, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pcbtex import compose, silk_layer, W, H
from PIL import Image
D = os.environ.get('CAD_DIR', 'scripts/models/.cad/unoq')
o = json.load(open(f'{D}/outline.json'))
HOLES = [(2.54, 54.61, 1.6), (50.8, 53.34, 1.6), (7.62, 2.54, 1.6), (35.56, 2.54, 1.6)]
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
PXMM = 40
photo = (int(H * PXMM), int(W * PXMM))  # กรอบภาพผลิตภัณฑ์: กว้าง = ด้านยาว 68.58
# ---------- สกรีนด้านบน (ตำแหน่งตามภาพผลิตภัณฑ์ใน datasheet ABX00162) ----------
DIG = [('0', 63.5), ('1', 60.96), ('2', 58.42), ('~3', 55.88), ('4', 53.34), ('~5', 50.8), ('~6', 48.26), ('7', 45.72), ('8', 41.656), ('~9', 39.116), ('~10', 36.576), ('~11', 34.036), ('12', 31.496), ('13', 28.956), ('GND', 26.416), ('AREF', 23.876), ('SDA', 21.336), ('SCL', 18.796)]
ANA = [('BOOT', 27.94), ('IOREF', 30.48), ('RESET', 33.02), ('3.3V', 35.56), ('5V', 38.1), ('GND', 40.64), ('GND', 43.18), ('VIN', 45.72), ('A0', 50.8), ('A1', 53.34), ('A2', 55.88), ('A3', 58.42), ('A4', 60.96), ('A5', 63.5)]
items = []
for t, x in DIG: items.append(('text', x, 5.0, t, 0.62 if len(t) > 3 else 0.72, 90, 'mm'))
items += [('text', 5.8, 8.15, 'POWER', 0.95, 0, 'mm'), ('text', 2.2, 23.2, 'ON', 0.95, 0, 'mm'),
          ('text', 15.6, 13.4, 'JCTL', 1.0, 0, 'mm'), ('text', 64.9, 21.7, 'JSPI', 1.0, 0, 'mm'), ('text', 65.4, 35.6, 'QWIIC', 0.95, 0, 'mm'),
          ('text', 61.9, 6.4, 'STM', 1.0, 90, 'mm'), ('text', 61.9, 10.3, 'QRB', 1.0, 90, 'mm'),
          ('text', 63.0, 5.46, '4', 0.9, 0, 'mm'), ('text', 63.0, 7.37, '3', 0.9, 0, 'mm'), ('text', 63.0, 9.27, '2', 0.9, 0, 'mm'), ('text', 63.0, 11.18, '1', 0.9, 0, 'mm'),
          ('fill', 19.4, 30.0, 25.4, 32.6), ('knock', 22.4, 31.3, 'UNO', 1.5), ('rect', 25.4, 30.0, 28.7, 32.6, 0.15), ('text', 27.05, 31.3, 'Q', 1.5, 0, 'mm')]
silk_top = silk_layer(items, photo, FONT, PXMM).rotate(-90, expand=True)
# ---------- สกรีนด้านล่าง (มองจากด้านล่าง = กลับซ้ายขวา) ----------
bitems = [*[('text', x, 5.35, t, 0.75, 90, 'mm') for t, x in DIG], *[('text', x, W - 5.35, t, 0.75, 90, 'mm') for t, x in ANA], ('text', 11.7, 30.6, 'JMEDIA', 1.0, 0, 'mm'), ('text', 58.6, 30.6, 'JMISC', 1.0, 0, 'mm')]
silk_bot = silk_layer(bitems, photo, FONT, PXMM, mirror_glyphs=True).rotate(-90, expand=True)
def ras(n, size): return np.asarray(Image.open(f'{D}/ras/{n}.png').convert('L').resize(size, Image.LANCZOS), dtype=np.float32) / 255
cols = [(4, 20, 36), (12, 33, 52), (196, 160, 92), (70, 68, 52), (236, 238, 238)]
for side, size, cu, mk, pa, silk in [('top', (1593, 2048), 'top', 'smt', 'pmt', silk_top), ('bot', (1062, 1365), 'bot', 'smb', 'pmb', silk_bot)]:
    c, m = ras(cu, size), ras(mk, size)
    if side == 'bot':
        # มองจากด้านล่าง: กลับซ้ายขวา (ชั้นล่างของ Gerber มองจากด้านบนทะลุบอร์ด)
        c, m = c[:, ::-1], m[:, ::-1]
        silk = silk.transpose(Image.FLIP_LEFT_RIGHT)
    base, orm = compose(c, m, None, o['tri'], HOLES, silk, size, cols, mirror=(side == 'bot'))
    base.save(f'{D}/out/unoq-{side}.jpg', quality=84, optimize=True, progressive=False); orm.resize((size[0] // 2, size[1] // 2)).save(f'{D}/out/unoq-{side}-orm.jpg', quality=86, optimize=True)
    base.resize((600, int(600 * size[1] / size[0]))).save(f'{D}/out/unoq-{side}-prev.png')
print('ok')
