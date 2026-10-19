#!/usr/bin/env python3
"""Erzeugt die App-Icons (PNG) für Android aus dem Motiv von site/icon.svg (offenes Buch, „a“ und „ɔ“).
Einmalig, Ergebnis liegt im Repository.

    uvx --from pillow python tools/make_icons.py PFAD/Andika-7.000/Andika-Bold.ttf
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BROWN, CREAM, SAND = (122, 59, 18), (253, 243, 225), (244, 229, 211)


def cubic(p0, p1, p2, p3, n=24):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / n for i in range(n + 1))]


def page(side):
    # wie im SVG: M8 18 c8-3 16-3 24 2 v30 c-8-5-16-5-24-2 z (rechts gespiegelt)
    s = -1 if side == "right" else 1
    x = lambda v: 32 + s * (v - 32)
    top = cubic((x(8), 18), (x(16), 15), (x(24), 15), (x(32), 20))
    bottom = cubic((x(32), 50), (x(24), 45), (x(16), 45), (x(8), 48))
    return top + bottom


def make(size, font_path):
    k = size / 64
    scale = 0.84  # Motiv etwas kleiner: bleibt auch in runden „maskable“-Masken ganz sichtbar
    off = 32 * (1 - scale)
    T = lambda pts: [((px * scale + off) * k, (py * scale + off) * k) for px, py in pts]
    img = Image.new("RGB", (size, size), BROWN)
    d = ImageDraw.Draw(img)
    d.polygon(T(page("left")), fill=CREAM)
    d.polygon(T(page("right")), fill=SAND)
    font = ImageFont.truetype(font_path, int(18 * scale * k))
    for ch, cx in (("a", 20), ("ɔ", 44)):
        (x, y), = T([(cx, 35)])
        d.text((x, y), ch, font=font, fill=BROWN, anchor="mm")
    out = ROOT / "site" / f"icon-{size}.png"
    img.save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    for s in (192, 512):
        make(s, sys.argv[1])
