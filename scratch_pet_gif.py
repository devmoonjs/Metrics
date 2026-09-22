"""scratch_pet_demo.js 가 녹화한 프레임을 친구 상호작용 데모 GIF 로 합성한다."""
import glob
import os
from collections import Counter

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "build", "shots", "pet")
OUT = os.path.join(HERE, "screenshots")
os.makedirs(OUT, exist_ok=True)

BG = (228, 234, 243)      # 단색 배경 (GIF 팔레트 밴딩 방지)
SCALE = 0.52              # 최종 축소 비율
STRIDE = 2                # 녹화는 40fps 정도라 절반만 써서 20fps 로 맞춘다
MS = 50                   # 프레임 간격 (STRIDE 반영 후 실시간)
TAIL_MS = 1600            # 마지막 프레임 유지 시간
COLORS = 256
ACCENTS = 48              # 그중 강조색(공·시세 색상)에 예약할 수

files = sorted(glob.glob(os.path.join(SRC, "[0-9]*.png")))[::STRIDE]
if not files:
    raise SystemExit(f"프레임이 없습니다: {SRC}\n먼저 `npx electron scratch_pet_demo.js` 를 실행하세요.")

shots = [Image.open(f).convert("RGBA") for f in files]
W, H = shots[0].size

frames = []
for im in shots:
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    canvas.alpha_composite(im)
    frames.append(canvas.convert("RGB").resize(
        (int(W * SCALE), int(H * SCALE)), Image.LANCZOS))

# 연속된 동일 프레임은 한 장으로 합치고 지속시간만 늘린다
merged, durations = [], []
for f in frames:
    if merged and f.tobytes() == merged[-1].tobytes():
        durations[-1] += MS
        continue
    merged.append(f)
    durations.append(MS)
durations[-1] = TAIL_MS

# 공용 팔레트로 양자화. 배경이 화면 대부분이라 그냥 뽑으면 공의 주황이나
# 시세 빨강처럼 면적이 작은 색이 통째로 빠진다. 강조색 자리를 따로 예약한다.
n = len(merged)
picks = [merged[i] for i in (0, n // 3, n // 2, 2 * n // 3, n - 1)]
strip = Image.new("RGB", (picks[0].width * len(picks), picks[0].height))
for k, f in enumerate(picks):
    strip.paste(f, (k * picks[0].width, 0))

base = strip.quantize(colors=COLORS - ACCENTS, method=Image.MEDIANCUT).getpalette()
entries = [tuple(base[k * 3:k * 3 + 3]) for k in range(COLORS - ACCENTS)]

counter = Counter()
for im in shots:
    for cnt, rgb in im.convert("RGB").getcolors(maxcolors=1 << 20) or []:
        if max(rgb) - min(rgb) > 45:          # 무채색 제외
            counter[rgb] += cnt
entries += [rgb for rgb, _ in counter.most_common(ACCENTS)]
entries = entries[:COLORS]

palette = Image.new("P", (1, 1))
flat = [v for rgb in entries for v in rgb]
palette.putpalette(flat + [0] * (768 - len(flat)))

merged = [f.quantize(palette=palette, dither=Image.NONE) for f in merged]

dst = os.path.join(OUT, "friends.gif")
merged[0].save(dst, save_all=True, append_images=merged[1:], duration=durations,
               loop=0, optimize=False, disposal=1)
print(f"friends.gif {merged[0].size} · {len(frames)}프레임 -> {len(merged)}장 · "
      f"{sum(durations) / 1000:.1f}초 · {os.path.getsize(dst) / 1024 / 1024:.2f}MB")
