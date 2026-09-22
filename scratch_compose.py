"""캡처한 팝업을 데스크톱 배경+그림자에 합성 (README 스크린샷)."""
import os
from PIL import Image, ImageFilter, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "build", "shots", "raw")
OUT = os.path.join(HERE, "screenshots")
os.makedirs(OUT, exist_ok=True)

PAD = 48
C1, C2 = (210, 218, 232), (158, 174, 198)  # 배경 그라데이션


def backdrop(W, H):
    base = Image.new("RGB", (W, H))
    px = base.load()
    for y in range(H):
        for x in range(W):
            t = (x / W + y / H) / 2
            px[x, y] = tuple(int(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return base.convert("RGBA")


def compose(src, dst):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    W, H = w + PAD * 2, h + PAD * 2
    out = backdrop(W, H)
    # 드롭 섀도우 (알파 기반)
    mask = Image.new("L", (W, H), 0)
    mask.paste(im.split()[3], (PAD, PAD + 10))
    mask = mask.filter(ImageFilter.GaussianBlur(14))
    solid = Image.new("RGBA", (W, H), (10, 14, 22, 130))
    out = Image.composite(solid, out, mask)
    out.alpha_composite(im, (PAD, PAD))
    out.convert("RGB").save(dst, quality=92)
    print("composed", os.path.basename(dst), out.size)


names = {
    "01-settings": "settings",
    "01b-search": "search",
    "02-minimal": "theme-minimal",
    "03-terminal": "theme-terminal",
    "04-build": "theme-build",
    "05-sheet": "theme-sheet",
    "06-chat": "theme-chat",
    "07-business-sheet": "disguise-sheet",
}
for raw, name in names.items():
    compose(os.path.join(RAW, raw + ".png"), os.path.join(OUT, name + ".png"))

# 5개 테마 한 장 몽타주 (2행)
theme_files = ["theme-minimal", "theme-terminal", "theme-build", "theme-sheet", "theme-chat"]
imgs = [Image.open(os.path.join(OUT, f + ".png")).convert("RGB") for f in theme_files]
cw = max(i.width for i in imgs)
ch = max(i.height for i in imgs)
cols, gap = 3, 16
rows = 2
MW = cols * cw + (cols + 1) * gap
MH = rows * ch + (rows + 1) * gap
montage = Image.new("RGB", (MW, MH), (236, 240, 246))
for idx, im in enumerate(imgs):
    r, c = divmod(idx, cols)
    x = gap + c * (cw + gap) + (cw - im.width) // 2
    y = gap + r * (ch + gap) + (ch - im.height) // 2
    montage.paste(im, (x, y))
montage.save(os.path.join(OUT, "themes.png"), quality=92)
print("montage themes.png", montage.size)
print("files:", sorted(os.listdir(OUT)))
