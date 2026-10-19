"""Anki-Deck (.apkg): ein Unterdeck „Anii::<Lektion>“ pro Lektion, Karten in beide Richtungen, mit Audio.

Benötigt genanki (siehe requirements.txt). IDs sind fest, damit ein erneuter Import
in Anki den Lernstand behält und Einträge aktualisiert statt verdoppelt.
"""
import hashlib
import html
from pathlib import Path

import genanki


def _num(text):
    return int(hashlib.sha1(text.encode()).hexdigest()[:8], 16) | (1 << 30)


CSS = """
.card { font-family: Andika, "Charis SIL", "Noto Sans", sans-serif; font-size: 26px; text-align: center; }
.anii { font-size: 40px; }
.small { font-size: 18px; color: #666; }
.de { color: #555; }
"""

MODEL = genanki.Model(
    _num("anii-model-v1"),
    "Anii (Balanka)",
    fields=[{"name": n} for n in ("ID", "Anii", "Français", "Deutsch", "Plural", "Exemple", "Audio", "Source")],
    templates=[
        {
            "name": "Anii → Français/Deutsch",
            "qfmt": '<div class="anii">{{Anii}}</div>{{Audio}}',
            "afmt": '{{FrontSide}}<hr id="answer"><div>{{Français}}</div><div class="de">{{Deutsch}}</div>'
                    '{{#Plural}}<div class="small">pl. {{Plural}}</div>{{/Plural}}'
                    '{{#Exemple}}<div class="small"><i>{{Exemple}}</i></div>{{/Exemple}}',
        },
        {
            "name": "Français/Deutsch → Anii",
            "qfmt": '<div>{{Français}}</div><div class="de">{{Deutsch}}</div>',
            "afmt": '{{FrontSide}}<hr id="answer"><div class="anii">{{Anii}}</div>{{Audio}}'
                    '{{#Plural}}<div class="small">pl. {{Plural}}</div>{{/Plural}}',
        },
    ],
    css=CSS,
)


def write_apkg(entries, lessons, path: Path, audio_dir: Path):
    decks = {l["id"]: genanki.Deck(_num("anii-deck-" + l["id"]), "Anii::" + l["name"]) for l in lessons}
    media = []
    from anii import slug
    for e in entries:
        audio = e.get("_audio")
        sound = f"[sound:{audio}]" if audio else ""
        if audio:
            media.append(str(audio_dir / audio))
        note = genanki.Note(
            model=MODEL,
            fields=[html.escape(e[k]) for k in ("id", "anii", "francais", "deutsch", "plural", "beispiel")] + [sound, html.escape(e["quelle"])],
            guid=genanki.guid_for("anii", e["id"]),
            tags=["anii", "geprueft" if e["geprueft"] == "ja" else "ungeprueft"],
        )
        decks[slug(e["lektion"])].add_note(note)
    pkg = genanki.Package(list(decks.values()))
    pkg.media_files = media
    pkg.write_to_file(str(path))
