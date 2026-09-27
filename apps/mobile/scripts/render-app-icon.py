"""Renders the FieldOps launcher icon (legacy PNG mipmaps) and the in-app brand mark from the
same geometry as the adaptive vector icon (res/drawable/ic_launcher_*.xml). Run it again after
changing the icon, from apps/mobile (needs Python 3 with Pillow and NumPy):

    python scripts/render-app-icon.py android/app/src/main/res src/assets icon-preview.png

Geometry is in the adaptive icon's 108 x 108 viewport; legacy icons show its central 80 x 80.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

RES = sys.argv[1]      # android/app/src/main/res
ASSETS = sys.argv[2]   # src/assets
PREVIEW = sys.argv[3]  # scratch preview path

TOP = (0x3D, 0x6C, 0xFF)
BOTTOM = (0x1F, 0x3C, 0xC2)
PIN = (255, 255, 255)
CHECK = (0x2F, 0x5B, 0xEA)

HEAD_C = (54.0, 46.0)
HEAD_R = 22.0
TIP = (54.0, 80.0)
CHECK_POINTS = [(43.5, 46.5), (51.0, 54.0), (64.5, 39.5)]
CHECK_W = 6.0
GROUND = (54.0, 83.5, 11.0, 2.6)  # cx, cy, rx, ry


def pin_polygon():
    cx, cy = HEAD_C
    d = TIP[1] - cy
    theta = math.acos(HEAD_R / d)
    # Angle (screen coords, y down) of the tangent points measured from +x axis.
    left = math.pi / 2 + theta
    right = math.pi / 2 - theta
    pts = [TIP]
    # Arc from the left tangent point over the top to the right tangent point.
    steps = 200
    start, end = left, right + 2 * math.pi
    for i in range(steps + 1):
        a = start + (end - start) * i / steps
        pts.append((cx + HEAD_R * math.cos(a), cy + HEAD_R * math.sin(a)))
    return pts


def gradient(size):
    t = np.linspace(0, 1, size).reshape(size, 1)
    top = np.array(TOP, dtype=float)
    bottom = np.array(BOTTOM, dtype=float)
    rows = top * (1 - t) + bottom * t
    arr = np.repeat(rows[:, np.newaxis, :], size, axis=1).astype(np.uint8)
    return Image.fromarray(arr, 'RGB')


def render(px, shape, visible=80.0):
    """Renders the icon at px x px. shape: 'square' (rounded), 'circle' or 'full'."""
    ss = 8
    size = px * ss
    offset = (108.0 - visible) / 2
    scale = size / visible

    def tr(p):
        return ((p[0] - offset) * scale, (p[1] - offset) * scale)

    img = gradient(size)
    draw = ImageDraw.Draw(img, 'RGBA')
    gx, gy, rx, ry = GROUND
    a, b = tr((gx - rx, gy - ry)), tr((gx + rx, gy + ry))
    draw.ellipse([a, b], fill=(255, 255, 255, 80))
    draw.polygon([tr(p) for p in pin_polygon()], fill=PIN)
    w = CHECK_W * scale
    pts = [tr(p) for p in CHECK_POINTS]
    draw.line(pts, fill=CHECK, width=int(round(w)), joint='curve')
    for p in pts:
        draw.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=CHECK)

    mask = Image.new('L', (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    if shape == 'circle':
        mdraw.ellipse([0, 0, size - 1, size - 1], fill=255)
    elif shape == 'square':
        mdraw.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    else:
        mdraw.rectangle([0, 0, size, size], fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img.convert('RGBA'), (0, 0), mask)
    return out.resize((px, px), Image.LANCZOS)


DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for name, px in DENSITIES.items():
    folder = os.path.join(RES, f'mipmap-{name}')
    render(px, 'square').save(os.path.join(folder, 'ic_launcher.png'), optimize=True)
    render(px, 'circle').save(os.path.join(folder, 'ic_launcher_round.png'), optimize=True)

os.makedirs(ASSETS, exist_ok=True)
for suffix, px in (('', 56), ('@2x', 112), ('@3x', 168)):
    render(px, 'square').save(os.path.join(ASSETS, f'brand-mark{suffix}.png'), optimize=True)

# Preview: legacy square, round, and the adaptive full-bleed canvas at 512 px.
sheet = Image.new('RGBA', (512 * 3 + 64, 512 + 32), (240, 242, 246, 255))
sheet.paste(render(512, 'square'), (16, 16), render(512, 'square'))
sheet.paste(render(512, 'circle'), (512 + 32, 16), render(512, 'circle'))
full = render(512, 'full', visible=108.0)
sheet.paste(full, (1024 + 48, 16))
sheet.save(PREVIEW)
print('ok')

# Pin path for the vector drawable (same geometry).
cx, cy = HEAD_C
theta = math.acos(HEAD_R / (TIP[1] - cy))
lx, ly = cx - HEAD_R * math.sin(theta), cy + HEAD_R * math.cos(theta)
rx_, ry_ = cx + HEAD_R * math.sin(theta), ly
print(f'M{TIP[0]:.2f},{TIP[1]:.2f} L{lx:.2f},{ly:.2f} A{HEAD_R:.0f},{HEAD_R:.0f} 0 1,1 {rx_:.2f},{ry_:.2f} Z')
