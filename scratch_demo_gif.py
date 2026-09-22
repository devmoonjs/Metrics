"""scratch_demo.js 가 녹화한 프레임을 커서와 함께 합성해 데모 GIF 생성."""
import glob
import json
import os
from collections import Counter

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "build", "shots", "demo")
OUT = os.path.join(HERE, "screenshots")
os.makedirs(OUT, exist_ok=True)

PAD = 28
BG = (228, 234, 243)      # 단색 배경 (GIF 팔레트 밴딩 방지)
DPR = 2                   # capturePage 는 논리 px 의 2배로 저장된다
SCALE = 0.52              # 최종 축소 비율
MS = 70                   # 프레임 간격
COLORS = 256
ACCENTS = 48              # 그중 강조색(시세 색상)에 예약할 수              # GIF 팔레트 색 수
TAIL_MS = 2200            # 마지막 프레임 유지 시간

meta = {m["i"]: m for m in json.load(open(os.path.join(SRC, "meta.json")))}
files = sorted(glob.glob(os.path.join(SRC, "[0-9]*.png")))
shots = [(int(os.path.basename(f)[:4]), Image.open(f).convert("RGBA")) for f in files]

CW = max(im.width for _, im in shots) + PAD * 2
CH = max(im.height for _, im in shots) + PAD * 2

CURSOR = [(0, 0), (0, 21), (5, 16), (9, 25), (13, 23), (9, 15), (16, 15)]


def draw_cursor(d, x, y, pressed):
    pts = [(x + px * 1.5, y + py * 1.5) for px, py in CURSOR]
    d.polygon(pts, fill=(255, 255, 255), outline=(24, 30, 44))
    d.line(pts + [pts[0]], fill=(24, 30, 44), width=2)
    if pressed:
        r = 17
        d.ellipse([x - r, y - r, x + r, y + r], outline=(64, 120, 255), width=4)


frames = []
for i, im in shots:
    m = meta[i]
    canvas = Image.new("RGBA", (CW, CH), BG + (255,))
    x = (CW - im.width) // 2
    y = (CH - im.height) // 2                  # 세로 중앙 (데스크톱에 떠 있는 느낌)

    mask = Image.new("L", (CW, CH), 0)
    mask.paste(im.split()[3], (x, y + 8))
    mask = mask.filter(ImageFilter.GaussianBlur(11))
    canvas = Image.composite(Image.new("RGBA", (CW, CH), (12, 18, 30, 110)), canvas, mask)
    canvas.alpha_composite(im, (x, y))

    draw_cursor(ImageDraw.Draw(canvas), x + m["x"] * DPR, y + m["y"] * DPR, m["click"])

    frames.append(canvas.convert("RGB").resize(
        (int(CW * SCALE), int(CH * SCALE)), Image.LANCZOS))

# 연속된 동일 프레임은 한 장으로 합치고 지속시간만 늘린다
merged, durations = [], []
for f in frames:
    if merged and f.tobytes() == merged[-1].tobytes():
        durations[-1] += MS
        continue
    merged.append(f)
    durations.append(MS)
durations[-1] = TAIL_MS

# 공용 팔레트로 양자화 (프레임마다 팔레트가 달라지면 용량이 커진다).
# 주의: 전체 프레임에서 그냥 팔레트를 뽑으면 넓은 배경색이 자리를 다 차지해,
# 화면의 몇 %밖에 안 되는 시세 색상(상승 빨강/하락 파랑)이 통째로 빠진다.
# 그래서 배경 위주의 일반 팔레트에 원본 캡처의 채도 높은 색을 따로 채워 넣는다.
n = len(merged)
picks = [merged[i] for i in (0, n // 3, n // 2, 2 * n // 3, n - 1)]
strip = Image.new("RGB", (picks[0].width * len(picks), picks[0].height))
for k, f in enumerate(picks):
    strip.paste(f, (k * picks[0].width, 0))

base = strip.quantize(colors=COLORS - ACCENTS, method=Image.MEDIANCUT).getpalette()
entries = [tuple(base[k * 3:k * 3 + 3]) for k in range(COLORS - ACCENTS)]

# 원본(배경 없는 순수 UI) 프레임에서 채도 높은 색을 빈도순으로 확보
counter = Counter()
for _, im in shots:
    for c in im.convert("RGB").getcolors(maxcolors=1 << 20) or []:
        cnt, rgb = c
        if max(rgb) - min(rgb) > 45:
            counter[rgb] += cnt
entries += [rgb for rgb, _ in counter.most_common(ACCENTS)]
entries = entries[:COLORS]

palette = Image.new("P", (1, 1))
flat = [v for rgb in entries for v in rgb]
palette.putpalette(flat + [0] * (768 - len(flat)))

merged = [f.quantize(palette=palette, dither=Image.NONE) for f in merged]

dst = os.path.join(OUT, "demo.gif")
merged[0].save(dst, save_all=True, append_images=merged[1:], duration=durations,
               loop=0, optimize=False, disposal=1)
print(f"demo.gif {merged[0].size} · {len(frames)}프레임 -> {len(merged)}장 · "
      f"{sum(durations) / 1000:.1f}초 · {os.path.getsize(dst) / 1024 / 1024:.2f}MB")
