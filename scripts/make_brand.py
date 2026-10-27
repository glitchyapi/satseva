#!/usr/bin/env python3
"""Rasterise the original SatSeva mark into every Android density plus web assets.

Everything is generated from brand/logo.svg so the launcher icon, the splash,
the monochrome themed icon and the in-app wordmark can never drift apart.
"""
from pathlib import Path
import io
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGO = (ROOT / 'brand/logo.svg').read_text()
RES = ROOT / 'app/src/main/res'
WEB = ROOT / 'web/assets'
WEB.mkdir(parents=True, exist_ok=True)


def render(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert('RGBA')


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, 'PNG', optimize=True)


# ---- legacy launcher icons (pre-Android 8) -------------------------------
LEGACY_BG = '#FDF3E3'
for bucket, px in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    tile = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    # rounded square plate, matching the adaptive background colour
    plate = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(plate)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=LEGACY_BG)
    mark = render(LOGO, int(px * 0.78))
    plate.alpha_composite(mark, (int(px * 0.11), int(px * 0.11)))
    save(plate, RES / f'mipmap-{bucket}/ic_launcher.png')
    # circular variant for launchers that request round icons
    circle = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    dc = ImageDraw.Draw(circle)
    dc.ellipse([0, 0, px - 1, px - 1], fill=LEGACY_BG)
    circle.alpha_composite(mark, (int(px * 0.11), int(px * 0.11)))
    save(circle, RES / f'mipmap-{bucket}/ic_launcher_round.png')

# ---- adaptive foreground: artwork inside the 66dp safe zone of 108dp -----
for bucket, px in [('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)]:
    layer = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    mark = render(LOGO, int(px * 0.60))
    layer.alpha_composite(mark, (int(px * 0.20), int(px * 0.20)))
    save(layer, RES / f'drawable-{bucket}/ic_launcher_foreground.png')
    # Android 13+ themed icons: a flat alpha-only silhouette
    alpha = layer.getchannel('A')
    mono = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    mono.putalpha(alpha)
    save(mono, RES / f'drawable-{bucket}/ic_launcher_monochrome.png')

# ---- web + notification assets -------------------------------------------
save(render(LOGO, 512), WEB / 'logo.png')
save(render(LOGO, 192), ROOT / 'brand/logo-192.png')
(WEB / 'logo.svg').write_text(LOGO)
save(render(LOGO, 512), ROOT / 'site/logo.png')

# status-bar icons must be pure alpha, Android tints them itself
stat = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
mark = render(LOGO, 84)
stat.alpha_composite(mark, (6, 6))
flat = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
flat.putalpha(stat.getchannel('A'))
save(flat.resize((24, 24), Image.LANCZOS), RES / 'drawable-mdpi/ic_stat.png')
save(flat.resize((36, 36), Image.LANCZOS), RES / 'drawable-hdpi/ic_stat.png')
save(flat.resize((48, 48), Image.LANCZOS), RES / 'drawable-xhdpi/ic_stat.png')
save(flat.resize((72, 72), Image.LANCZOS), RES / 'drawable-xxhdpi/ic_stat.png')
save(flat.resize((96, 96), Image.LANCZOS), RES / 'drawable-xxxhdpi/ic_stat.png')
print('brand assets generated')
