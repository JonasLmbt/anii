#!/usr/bin/env python3
"""Erzeugt die App-Icons (PNG) für Android. Einmalig, Ergebnis liegt im Repository.

    uvx --from pillow python tools/make_icons.py PFAD/Andika-7.000/Andika-Bold.ttf
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BROWN, CREAM, OCHRE = (122, 59, 18), (253, 243, 225), (232, 163, 61)


def make(size, font_path):
    img = Image.new("RGB", (size, size), BROWN)  # vollflächig: passt auch als „maskable“ Icon
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, int(size * 0.42))
    text = "ɛɔ"
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], size * 0.47 - h / 2 - box[1]), text, font=font, fill=CREAM)
    bar_w, bar_h = size * 0.42, size * 0.05
    d.rounded_rectangle(((size - bar_w) / 2, size * 0.7, (size + bar_w) / 2, size * 0.7 + bar_h), radius=bar_h / 2, fill=OCHRE)
    out = ROOT / "site" / f"icon-{size}.png"
    img.save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    for s in (192, 512):
        make(s, sys.argv[1])
