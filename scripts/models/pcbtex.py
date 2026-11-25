"""ประกอบเท็กซ์เจอร์ PCB จากชั้น Gerber จริง (ทองแดง + โซลเดอร์มาสก์) + สกรีนตัวอักษร (ตำแหน่งตามภาพผลิตภัณฑ์/เอกสารขา) — ไม่มีโลโก้ผู้ผลิต
ออก: <name>-base.jpg (สี), <name>-orm.png (R = AO 1, G = ความหยาบ, B = โลหะ) ในกรอบเดียวกับภาพ Gerber (แถวบน = ipcY สูงสุด)"""
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 53.34, 68.58
def load(path, size):
    return np.asarray(Image.open(path).convert('L').resize(size, Image.LANCZOS), dtype=np.float32) / 255.0
def compose(cu, mask_open, paste, outline_tri, holes, silk_img, size, colors, mirror=False):
    w, h = size; s = w / W
    # พื้นที่แผ่นบอร์ดจากเส้นรอบรูป STEP
    board = Image.new('L', size, 0); d = ImageDraw.Draw(board)
    for t in outline_tri:
        pts = [((x if not mirror else W - x) * s, (H - y) * s) for x, y in t]
        d.polygon(pts, fill=255)
    for cx, cy, r in holes:
        x = (cx if not mirror else W - cx) * s; y = (H - cy) * s
        d.ellipse([x - r * s, y - r * s, x + r * s, y + r * s], fill=0)
    B = np.asarray(board.filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255
    mask_c, cu_c, gold_c, fr4_c, silk_c = [np.array(c, dtype=np.float32) for c in colors]
    # ทองแดงใต้มาสก์ = สีมาสก์อ่อนขึ้น; ช่องเปิดมาสก์ที่มีทองแดง = ทอง (ENIG); ช่องเปิดไม่มีทองแดง = FR4
    cu_b = np.asarray(Image.fromarray((cu * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255
    col = mask_c * (1 - cu_b[..., None]) + cu_c * cu_b[..., None]
    op = mask_open[..., None]; gold = op * cu[..., None]
    col = col * (1 - op) + (gold_c * cu[..., None] + fr4_c * (1 - cu[..., None])) * op
    # สกรีน
    sk = np.asarray(silk_img.resize(size, Image.LANCZOS), dtype=np.float32)[..., None] / 255 * (1 - op * 0.9)
    col = col * (1 - sk) + silk_c * sk
    # ขอบนอกบอร์ด = ดำ (โปร่งใสด้วยเรขาคณิตอยู่แล้ว)
    col = col * B[..., None] + np.array([10, 12, 14], np.float32) * (1 - B[..., None])
    # ORM: มาสก์ความหยาบ 0.42, ทอง 0.22 โลหะ 1, สกรีน 0.7
    rough = 0.42 * (1 - op[..., 0]) + 0.22 * gold[..., 0] + 0.6 * op[..., 0] * (1 - cu)
    rough = rough * (1 - sk[..., 0]) + 0.75 * sk[..., 0]
    metal = gold[..., 0] * (1 - sk[..., 0])
    orm = np.stack([np.ones_like(rough), rough, metal], -1)
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), Image.fromarray(np.clip(orm * 255, 0, 255).astype(np.uint8))

def silk_layer(items, size_photo, font_path, px_per_mm, mirror_glyphs=False):
    """วาดสกรีนในกรอบภาพผลิตภัณฑ์ (x จากขอบ USB, y จากขอบหัวต่อดิจิทัล) แล้วหมุนเป็นกรอบเท็กซ์เจอร์"""
    im = Image.new('L', size_photo, 0); d = ImageDraw.Draw(im)
    for it in items:
        if it[0] == 'text':
            _, x, y, txt, hmm, rot, anchor = it
            f = ImageFont.truetype(font_path, max(6, int(hmm * px_per_mm * 1.35)))
            if rot == 0 and not mirror_glyphs: d.text((x * px_per_mm, y * px_per_mm), txt, fill=255, font=f, anchor=anchor)
            else:
                tw = Image.new('L', (int(len(txt) * hmm * px_per_mm * 1.3) + 20, int(hmm * px_per_mm * 2.2)), 0)
                ImageDraw.Draw(tw).text((tw.width / 2, tw.height / 2), txt, fill=255, font=f, anchor='mm')
                tw = tw.rotate(rot, expand=True)
                if mirror_glyphs: tw = tw.transpose(Image.FLIP_LEFT_RIGHT if rot else Image.FLIP_TOP_BOTTOM)
                im.paste(255, (int(x * px_per_mm - tw.width / 2), int(y * px_per_mm - tw.height / 2)), tw)
        elif it[0] == 'rect':
            _, x0, y0, x1, y1, lw = it
            d.rectangle([x0 * px_per_mm, y0 * px_per_mm, x1 * px_per_mm, y1 * px_per_mm], outline=255, width=max(1, int(lw * px_per_mm)))
        elif it[0] == 'line':
            _, x0, y0, x1, y1, lw = it
            d.line([x0 * px_per_mm, y0 * px_per_mm, x1 * px_per_mm, y1 * px_per_mm], fill=255, width=max(1, int(lw * px_per_mm)))
        elif it[0] == 'fill':
            _, x0, y0, x1, y1 = it
            d.rectangle([x0 * px_per_mm, y0 * px_per_mm, x1 * px_per_mm, y1 * px_per_mm], fill=255)
        elif it[0] == 'knock':
            _, x, y, txt, hmm = it
            f = ImageFont.truetype(font_path, max(6, int(hmm * px_per_mm * 1.35)))
            d.text((x * px_per_mm, y * px_per_mm), txt, fill=0, font=f, anchor='mm')
        elif it[0] == 'tri':
            _, x, y, sz = it
            d.polygon([(x * px_per_mm, (y - sz) * px_per_mm), ((x - sz) * px_per_mm, (y + sz) * px_per_mm), ((x + sz) * px_per_mm, (y + sz) * px_per_mm)], outline=255)
    return im
