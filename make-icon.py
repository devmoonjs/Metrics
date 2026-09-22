"""로고 원본에서 검정 배경/워터마크를 제거하고 아이콘(.png/.ico/.icns)을 생성한다.

사용법:  python3 make-icon.py [원본이미지]
원본을 생략하면 build/icon_src.png 를 쓴다.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT, "icon_src.png")
os.makedirs(OUT, exist_ok=True)

if not os.path.exists(SRC):
    sys.exit(f"원본 이미지를 찾을 수 없습니다: {SRC}\n"
             f"사용법: python3 {os.path.basename(__file__)} [원본이미지]")

# 분석으로 확정한 라운드 사각 bbox (rim 외곽, 정사각)
X0, Y0, SIDE = 81, 77, 246
crop = Image.open(SRC).convert("RGBA").crop((X0, Y0, X0 + SIDE, Y0 + SIDE))

# 라운드 사각 알파 마스크 (코너의 검정 배경 제거). 안티에일리어싱 위해 4배 렌더 후 축소
scale = 4
big = SIDE * scale
radius = int(SIDE * 0.205) * scale
mask_big = Image.new("L", (big, big), 0)
ImageDraw.Draw(mask_big).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
mask = mask_big.resize((SIDE, SIDE), Image.LANCZOS)
crop.putalpha(mask)

# 투명 패딩 추가 (아이콘 여백)
pad = int(SIDE * 0.07)
side2 = SIDE + pad * 2
canvas = Image.new("RGBA", (side2, side2), (0, 0, 0, 0))
canvas.paste(crop, (pad, pad), crop)

# 출력물
base = canvas.resize((1024, 1024), Image.LANCZOS)
base.save(os.path.join(OUT, "icon.png"))
base.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon_512.png"))
base.save(os.path.join(OUT, "icon.ico"),
          sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# 미리보기 (검정 배경 위 + 흰 배경 위 합성 비교)
prev = Image.new("RGBA", (300 * 2, 300), (0, 0, 0, 0))
ic = base.resize((260, 260), Image.LANCZOS)
left = Image.new("RGBA", (300, 300), (15, 17, 22, 255)); left.paste(ic, (20, 20), ic)
right = Image.new("RGBA", (300, 300), (240, 240, 240, 255)); right.paste(ic, (20, 20), ic)
prev.paste(left, (0, 0)); prev.paste(right, (300, 0))
prev.convert("RGB").save(os.path.join(HERE, "scratch_preview.png"))
print("done:", sorted(os.listdir(OUT)))
