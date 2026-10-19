#!/usr/bin/env python3
"""Erzeugt die Webschrift „Anii Web“ aus Andika (SIL, OFL 1.1).

Andika ist unter der SIL Open Font License mit dem geschützten Namen (Reserved Font Name)
„Andika“ veröffentlicht. Eine verkleinerte Fassung (Subset) ist laut OFL-FAQ 2.6 eine
geänderte Version und darf diesen Namen nicht tragen – deshalb heißt sie hier „Anii Web“.
Copyright- und Lizenzangaben bleiben in der Schrift erhalten.

    uvx --from 'fonttools[woff]' python tools/make_font.py PFAD/Andika-7.000

Ergebnis: site/assets/fonts/AniiWeb-{Regular,Bold}.woff2 und OFL.txt
"""
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "assets" / "fonts"

UNICODES = (
    "U+0020-007E,"            # Basic Latin
    "U+00A0-00FF,"            # Latin-1 (Französisch, Deutsch)
    "U+0100-017F,"            # Latin Extended-A (ŋ Ŋ œ ā …)
    "U+0186,U+018E,U+018F,U+0190,U+0196,U+01B1,U+01DD,"  # Ɔ Ǝ Ə Ɛ Ɩ Ʊ ǝ
    "U+0189,U+01CD-01DC,U+01F8-01F9,"                    # Ɖ, Vokale mit Hatschek, Ǹ ǹ
    "U+0254,U+0256,U+0259,U+025B,U+0269,U+028A,"         # ɔ ɖ ə ɛ ɩ ʊ
    "U+02BC,U+02C6,U+02C7,U+02C8,U+02D0,U+02DC,"         # Modifikatoren
    "U+0300-0304,U+0306,U+0308,U+030C,U+0323,U+0330,"    # kombinierende Tonzeichen
    "U+1E3E-1E3F,U+1E44-1E45,U+1EB8-1EBD,U+1ECC-1ECD,"   # Ḿ ḿ Ṅ ṅ Ẹ ẹ Ẽ ẽ Ọ ọ
    "U+2013-2014,U+2018-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2190-2193,U+2212,U+25CC,U+27E6-27E7"
)


def make(src: Path, style: str):
    font = TTFont(src / f"Andika-{style}.ttf")
    opts = subset.Options()
    # Standard-Funktionen (ccmp, mark, mkmk, kern, liga, locl …) für die Platzierung der Tonzeichen;
    # Stil-Alternativen (cv../ss..) und Graphite-Tabellen fallen weg, das spart viel Platz.
    opts.drop_tables += ["Silf", "Silt", "Sill", "Glat", "Gloc", "Feat"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.flavor = "woff2"
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    name = font["name"]
    for rec in name.names:
        if rec.nameID in (1, 3, 4, 6, 16, 17, 21):
            text = rec.toUnicode()
            text = text.replace("Andika", "Anii Web" if rec.nameID != 6 else "AniiWeb")
            rec.string = text
    note = ("Anii Web is a Modified Version (subset) of Andika by SIL Global, made for anii.lmbt.app. "
            "Original: https://software.sil.org/andika/")
    for rec in list(name.names):
        if rec.nameID == 10:
            rec.string = note
    name.setName(note, 10, 3, 1, 0x409)
    out = OUT / f"AniiWeb-{style}.woff2"
    font.save(out)
    print(out, out.stat().st_size, "Bytes")


def main():
    src = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for style in ("Regular", "Bold"):
        make(src, style)
    shutil.copy(src / "OFL.txt", OUT / "OFL.txt")


if __name__ == "__main__":
    main()
