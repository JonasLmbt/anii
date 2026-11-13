"""Anki-Deck (.apkg): ein Unterdeck „Anii::<Lektion>“ pro Lektion, Karten in beide Richtungen, mit Audio.

Benötigt genanki (siehe requirements.txt). IDs sind fest, damit ein erneuter Import
in Anki den Lernstand behält und Einträge aktualisiert statt verdoppelt.
"""
import hashlib
import html
import shutil
import subprocess
import tempfile
from pathlib import Path

import genanki

# Browser-Aufnahmen sind WebM ohne Längenangabe: AnkiDroid bricht sie oft zu früh ab, AnkiMobile
# spielt WebM gar nicht. Fürs Deck deshalb MP3 mit sauberem Kopf, kurzer Stille vorn (Anlauf),
# 0,4 s Puffer hinten und angeglichener Lautstärke. Die Originale für die Website bleiben unverändert.
AUDIO_FILTER = "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.2,loudnorm=I=-18:TP=-2,apad=pad_dur=0.4"
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "anki-audio"


def _ffmpeg():
    try:
        import imageio_ffmpeg  # bringt ein eigenes ffmpeg mit (requirements.txt)
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return shutil.which("ffmpeg")


def _as_mp3(src: Path, exe):
    """Umgewandelte Datei (mit Zwischenspeicher nach Inhalt) oder None, wenn das nicht geht."""
    if not exe:
        return None
    key = hashlib.sha1(src.read_bytes() + AUDIO_FILTER.encode()).hexdigest()[:16]
    out = CACHE / f"{key}.mp3"
    if not out.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp.mp3")
        r = subprocess.run([exe, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-af", AUDIO_FILTER,
                            "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "5", str(tmp)], capture_output=True)
        if r.returncode or not tmp.exists() or tmp.stat().st_size < 500:
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(out)
    return out


def _num(text):
    return int(hashlib.sha1(text.encode()).hexdigest()[:8], 16) | (1 << 30)


CSS = """
.card { font-family: Andika, "Charis SIL", "Noto Sans", sans-serif; font-size: 26px; text-align: center; }
.anii { font-size: 40px; }
.small { font-size: 18px; color: #666; }
.de { color: #555; }
.plbtn { font-size: 16px; border: 1px solid #bbb; border-radius: 50%; width: 30px; height: 30px; padding: 0;
         background: transparent; color: inherit; cursor: pointer; vertical-align: middle; }
"""

MODEL = genanki.Model(
    _num("anii-model-v2"),  # v2: eigene Plural-Aufnahme
    "Anii (Balanka)",
    fields=[{"name": n} for n in (("ID", "Anii", "Français", "Deutsch", "Plural", "Exemple", "Audio", "Source", "Remarque", "AudioPluriel")) ],
    templates=[
        {
            "name": "Anii → Français/Deutsch",
            "qfmt": '<div class="anii">{{Anii}}</div>{{Audio}}',
            "afmt": '{{FrontSide}}<hr id="answer"><div>{{Français}}</div><div class="de">{{Deutsch}}</div>'
                    '{{#Plural}}<div class="small">pl. {{Plural}} {{AudioPluriel}}</div>{{/Plural}}'
                    '{{#Exemple}}<div class="small"><i>{{Exemple}}</i></div>{{/Exemple}}'
                    '{{#Remarque}}<div class="small">{{Remarque}}</div>{{/Remarque}}',
        },
        {
            "name": "Français/Deutsch → Anii",
            "qfmt": '<div>{{Français}}</div><div class="de">{{Deutsch}}</div>',
            "afmt": '{{FrontSide}}<hr id="answer"><div class="anii">{{Anii}}</div>{{Audio}}'
                    '{{#Plural}}<div class="small">pl. {{Plural}} {{AudioPluriel}}</div>{{/Plural}}',
        },
    ],
    css=CSS,
)


def write_apkg(entries, lessons, path: Path, audio_dir: Path):
    decks = {l["id"]: genanki.Deck(_num("anii-deck-" + l["id"]), "Anii::" + l["name"]) for l in lessons}
    media = []
    from anii import slug
    exe = _ffmpeg()
    tmpdir = tempfile.TemporaryDirectory()
    staged = Path(tmpdir.name)

    def sound_for(name, button=False):
        """[sound:…]-Tag (spielt Anki von selbst ab) oder – mit button=True – ein ▶-Knopf, der nur auf
        Antippen abspielt (für den Plural). Legt die (umgewandelte) Datei unter ihrem Namen im Deck ab."""
        if not name:
            return ""
        src = audio_dir / name
        mp3 = _as_mp3(src, exe)
        if mp3:
            name = Path(name).stem + ".mp3"
            shutil.copyfile(mp3, staged / name)
            media.append(str(staged / name))
        else:
            media.append(str(src))  # ohne ffmpeg: Original
        if button:
            # src="…" erkennt Anki als Medienverweis (bleibt bei „Medien überprüfen“ erhalten)
            return ('<button type="button" class="plbtn" onclick="var a=this.nextElementSibling;a.currentTime=0;a.play()">▶</button>'
                    f'<audio src="{html.escape(name)}" preload="auto"></audio>')
        return f"[sound:{name}]"

    for e in entries:
        sound = sound_for(e.get("_audio"))
        sound_pl = sound_for(e.get("_audio_pl"), button=True)
        note = genanki.Note(
            model=MODEL,
            fields=[html.escape(e[k]) for k in ("id", "anii", "francais", "deutsch", "plural", "beispiel")] + [sound, html.escape(e["quelle"]), html.escape(e["notiz"]), sound_pl],
            guid=genanki.guid_for("anii", e["id"]),
            tags=["anii", "geprueft" if e["geprueft"] == "ja" else "ungeprueft"],
        )
        decks[slug(e["lektion"])].add_note(note)
    pkg = genanki.Package(list(decks.values()))
    pkg.media_files = media
    pkg.write_to_file(str(path))
    tmpdir.cleanup()
