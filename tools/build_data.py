#!/usr/bin/env python3
"""Prüft data/vokabeln.csv und erzeugt daraus JSON, Downloads und Anki-Deck.

    python3 tools/build_data.py            prüfen und nach dist/ bauen
    python3 tools/build_data.py --check    nur prüfen
    python3 tools/build_data.py --ids      fehlende IDs vergeben (schreibt die CSV neu)
    python3 tools/build_data.py --fix      eindeutige Doppelgänger-Zeichen ersetzen (schreibt die CSV neu)

Fehler brechen den Build ab (Exit-Code 1), Warnungen nicht.
"""
import argparse
import csv
import io
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anii  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CSV_FILE = DATA / "vokabeln.csv"
AUDIO_DIR = DATA / "audio"

COLUMNS = ["id", "anii", "deutsch", "francais", "lektion", "plural", "beispiel", "dialekt",
           "quelle", "datum", "audio", "sprecher", "geprueft", "notiz"]
OPTIONAL_COLUMNS = {"id", "sprecher"}  # neuer als die ursprüngliche Spaltenliste
ANII_FIELDS = {"anii", "plural"}  # reiner Anii-Text (Beispielsätze können Übersetzungen enthalten)
AUDIO_EXT = (".mp3", ".ogg", ".opus", ".m4a", ".webm", ".wav")
ID_RE = re.compile(r"^w\d{4,}$")


class Report:
    def __init__(self):
        self.items = []

    def add(self, level, where, msg):
        self.items.append((level, where, msg))

    def error(self, where, msg):
        self.add("FEHLER", where, msg)

    def warn(self, where, msg):
        self.add("WARNUNG", where, msg)

    def info(self, where, msg):
        self.add("HINWEIS", where, msg)

    def count(self, level):
        return sum(1 for i in self.items if i[0] == level)

    def print(self):
        for level, where, msg in self.items:
            print(f"{level:8} {where}: {msg}")
        print(f"\n{self.count('FEHLER')} Fehler, {self.count('WARNUNG')} Warnungen, {self.count('HINWEIS')} Hinweise")


def read_csv(path, report):
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        line = raw[: e.start].count(b"\n") + 1
        report.error(f"{path.name}:{line}", "Datei ist nicht UTF-8. In Excel: „Speichern unter → CSV UTF-8 (durch Trennzeichen getrennt)“.")
        return None, [], bom
    first = text.split("\n", 1)[0]
    if ";" not in first and ("," in first or "\t" in first):
        report.error(f"{path.name}:1", "Kopfzeile enthält kein Semikolon – bitte Semikolon als Trennzeichen verwenden.")
        return None, [], bom
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
    header = [h.strip() for h in (reader.fieldnames or [])]
    reader.fieldnames = header
    rows = list(reader)
    return header, rows, bom


def write_csv(path, header, rows, bom):
    buf = io.StringIO(newline="")
    w = csv.DictWriter(buf, fieldnames=header, delimiter=";", lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    path.write_text(("﻿" if bom else "") + buf.getvalue(), encoding="utf-8", newline="")


def natural_key(text):
    return [(0, int(t), "") if t.isdigit() else (1, 0, t.lower()) for t in re.split(r"(\d+)", text) if t]


def read_simple_csv(path, report, required):
    if not path.exists():
        report.warn(path.name, "Datei fehlt")
        return []
    header, rows, _ = read_csv(path, report)
    if header is None:
        return []
    for col in required:
        if col not in header:
            report.error(f"{path.name}:1", f"Spalte „{col}“ fehlt")
    return [{k: anii.nfc((v or "").strip()) for k, v in r.items() if k} for r in rows]


def validate(header, rows, report, fix=False):
    """Prüft und normalisiert die Zeilen. Gibt die bereinigten Einträge zurück."""
    for col in COLUMNS:
        if col not in header and col not in OPTIONAL_COLUMNS:
            report.error(f"{CSV_FILE.name}:1", f"Spalte „{col}“ fehlt")
    for col in header:
        if col not in COLUMNS:
            report.warn(f"{CSV_FILE.name}:1", f"unbekannte Spalte „{col}“ wird ignoriert")
    if "id" not in header:
        report.error(f"{CSV_FILE.name}:1", "Spalte „id“ fehlt – mit  python3 tools/build_data.py --ids  anlegen lassen")

    entries, seen_ids, seen_full, by_word = [], {}, {}, {}
    changed = False
    for n, row in enumerate(rows, start=2):  # Zeile 1 ist die Kopfzeile
        if None in row:  # mehr Felder als Spalten
            report.error(f"Zeile {n}", f"zu viele Felder – steht ein Semikolon im Text? ({'; '.join(row.pop(None))})")
        e = {}
        for col in COLUMNS:
            raw = row.get(col) or ""
            val = anii.nfc(raw).strip()
            val = re.sub(r"\s+", " ", val)
            if val != raw:
                changed = True
            for ch, sug, desc in anii.check_chars(val, col in ANII_FIELDS):
                hint = f" → „{sug}“" if sug else ""
                sure = sug and ch not in anii.AMBIGUOUS
                if fix and sure:
                    val = val.replace(ch, sug)
                    report.info(f"Zeile {n}, {col}", f"{desc}: ersetzt{hint}")
                else:
                    level = report.error if sure and ch != " " else report.warn
                    level(f"Zeile {n}, {col}", f"„{raw.strip()}“: {desc}{hint}")
            if fix and val != row.get(col):
                row[col] = val
            e[col] = val
        if not any(e.values()):
            continue  # leere Zeile
        where = f"Zeile {n}" + (f" ({e['anii']})" if e["anii"] else "")

        if not e["anii"]:
            report.error(where, "Pflichtfeld „anii“ ist leer")
        if not e["deutsch"] and not e["francais"]:
            report.error(where, "mindestens eine Übersetzung (deutsch oder francais) fehlt")
        if not e["lektion"]:
            report.error(where, "Pflichtfeld „lektion“ ist leer")

        if not e["id"]:
            report.error(where, "keine ID – mit  python3 tools/build_data.py --ids  vergeben lassen")
        elif not ID_RE.match(e["id"]):
            report.error(where, f"ID „{e['id']}“ hat nicht die Form w0001")
        elif e["id"] in seen_ids:
            report.error(where, f"ID {e['id']} doppelt (auch Zeile {seen_ids[e['id']]})")
        else:
            seen_ids[e["id"]] = n

        g = anii.lower(e["geprueft"])
        if g in ("ja", "oui", "yes", "x", "1"):
            e["geprueft"] = "ja"
        elif g in ("", "nein", "non", "no", "0"):
            if g == "" and e["anii"]:
                report.info(where, "„geprueft“ leer → nein")
            e["geprueft"] = "nein"
        else:
            report.warn(where, f"„geprueft“ = „{e['geprueft']}“, erwartet ja oder nein")
            e["geprueft"] = "nein"

        if e["datum"] and not re.match(r"^\d{4}(-\d{2}(-\d{2})?)?$", e["datum"]):
            report.warn(where, f"Datum „{e['datum']}“ bitte als JJJJ-MM-TT, JJJJ-MM oder JJJJ")

        key = (anii.lower(e["anii"]), anii.lower(e["deutsch"]), anii.lower(e["francais"]))
        if e["anii"] and key in seen_full:
            report.error(where, f"doppelter Eintrag (gleich wie Zeile {seen_full[key]})")
        else:
            seen_full[key] = n
            if e["anii"]:
                by_word.setdefault(anii.lower(e["anii"]), []).append(n)
        e["_line"] = n
        entries.append(e)

    for word, lines in by_word.items():
        if len(lines) > 1:
            report.info(f"Zeilen {', '.join(map(str, lines))}", f"„{word}“ kommt mehrfach mit verschiedener Bedeutung vor (Homonym? sonst zusammenlegen)")
    return entries, changed


def assign_ids(header, rows):
    if "id" not in header:
        header.insert(0, "id")
    used = [int(r["id"][1:]) for r in rows if ID_RE.match((r.get("id") or "").strip())]
    nxt = max(used, default=0) + 1
    added = 0
    for r in rows:
        if not (r.get("id") or "").strip() and any((v or "").strip() for k, v in r.items() if k):
            r["id"] = f"w{nxt:04d}"
            nxt += 1
            added += 1
    return added


def find_audio(e, report):
    name = e["audio"]
    if name:
        if "/" in name or "\\" in name:
            report.error(f"Zeile {e['_line']}", f"Audio „{name}“: nur den Dateinamen angeben (liegt in data/audio/)")
            return None
        if not (AUDIO_DIR / name).is_file():
            report.warn(f"Zeile {e['_line']}", f"Audio-Datei data/audio/{name} fehlt")
            return None
        return name
    for ext in AUDIO_EXT:  # Datei mit dem Namen der ID, z. B. w0001.mp3
        if e["id"] and (AUDIO_DIR / (e["id"] + ext)).is_file():
            return e["id"] + ext
    return None


def build(entries, speakers, alphabet_rows, report, out):
    spk = {s.get("kuerzel", ""): s for s in speakers if s.get("kuerzel")}
    used_audio = set()
    audio_bytes = 0
    lessons = {}
    site_entries = []
    for e in sorted(entries, key=lambda x: anii.sort_key(x["anii"])):
        audio = find_audio(e, report)
        if audio and e["sprecher"]:
            s = spk.get(e["sprecher"])
            if not s:
                report.warn(f"Zeile {e['_line']}", f"Sprecher-Kürzel „{e['sprecher']}“ steht nicht in data/sprecher.csv")
            elif anii.lower(s.get("zustimmung", "")) != "ja":
                report.warn(f"Zeile {e['_line']}", f"Sprecher {e['sprecher']} hat (noch) nicht zugestimmt – Aufnahme wird nicht veröffentlicht")
                audio = None
        elif audio and not e["sprecher"]:
            report.warn(f"Zeile {e['_line']}", "Aufnahme ohne Sprecher-Kürzel – für Lizenz und Archiv bitte eintragen")
        if audio:
            used_audio.add(audio)
            audio_bytes += (AUDIO_DIR / audio).stat().st_size
            if audio.endswith(".wav"):
                report.warn(f"Zeile {e['_line']}", f"{audio} ist WAV (groß) – für die Website besser MP3/Opus")
        e["_audio"] = audio
        lid = anii.slug(e["lektion"])
        lessons.setdefault(lid, {"id": lid, "name": e["lektion"], "n": 0})
        lessons[lid]["n"] += 1
        item = {"id": e["id"], "a": e["anii"], "l": lid, "fl": anii.first_letter(e["anii"]) or ""}
        for src, dst in (("deutsch", "de"), ("francais", "fr"), ("plural", "pl"), ("beispiel", "ex"),
                         ("dialekt", "dia"), ("quelle", "src"), ("datum", "date"), ("sprecher", "sp")):
            if e[src]:
                item[dst] = e[src]
        if audio:
            item["au"] = audio
        if e["geprueft"] == "ja":
            item["ok"] = 1
        site_entries.append(item)

    if AUDIO_DIR.is_dir():
        for f in sorted(AUDIO_DIR.iterdir()):
            if f.is_file() and f.suffix.lower() in AUDIO_EXT and f.name not in used_audio:
                report.info(f"data/audio/{f.name}", "Datei wird von keinem Eintrag benutzt")

    ids = {e["id"] for e in entries}
    by_id = {e["id"]: e for e in entries}
    alphabet = []
    letters = {r.get("buchstabe", ""): r for r in alphabet_rows}
    for l in anii.ALPHABET:
        r = letters.get(l, {})
        tile = {"l": l, "u": anii.upper_letter(l)}
        ex = r.get("beispiel_id", "")
        if ex:
            if ex not in ids:
                report.warn(f"alphabet.csv ({l})", f"Beispiel-ID {ex} gibt es nicht in vokabeln.csv")
            else:
                tile["ex"] = ex
                if by_id[ex]["_audio"]:
                    tile["au"] = by_id[ex]["_audio"]
        if r.get("audio"):
            if (AUDIO_DIR / r["audio"]).is_file():
                tile["au"] = r["audio"]
                used_audio.add(r["audio"])
            else:
                report.warn(f"alphabet.csv ({l})", f"Audio data/audio/{r['audio']} fehlt")
        for k, dst in (("aussprache_fr", "pfr"), ("aussprache_de", "pde")):
            if r.get(k):
                tile[dst] = r[k]
        alphabet.append(tile)
    for l in letters:
        if l and l not in anii.ALPHABET:
            report.warn("alphabet.csv", f"„{l}“ ist kein Buchstabe des Alphabets")

    lesson_list = sorted(lessons.values(), key=lambda x: natural_key(x["name"]))
    public_speakers = [{"k": s["kuerzel"], "name": s.get("name", ""), "ort": s.get("ort", "")}
                       for s in speakers if anii.lower(s.get("zustimmung", "")) == "ja" and s.get("kuerzel")]
    site = {
        "lessons": lesson_list,
        "entries": site_entries,
        "alphabet": alphabet,
        "speakers": public_speakers,
        "audio": {"files": sorted(used_audio), "bytes": audio_bytes},
    }
    if out is None:
        return site

    (out / "data").mkdir(parents=True, exist_ok=True)
    (out / "data" / "anii.json").write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if used_audio:
        (out / "audio").mkdir(parents=True, exist_ok=True)
        for name in used_audio:
            shutil.copy2(AUDIO_DIR / name, out / "audio" / name)

    # Downloads: normalisierte CSV, vollständiges JSON, Anki-Deck
    dl = out / "telechargement"
    dl.mkdir(parents=True, exist_ok=True)
    full = [{c: e[c] for c in COLUMNS} for e in sorted(entries, key=lambda x: anii.sort_key(x["anii"]))]
    buf = io.StringIO(newline="")
    w = csv.DictWriter(buf, fieldnames=COLUMNS, delimiter=";", lineterminator="\n")
    w.writeheader()
    w.writerows(full)
    (dl / "anii-vokabeln.csv").write_text("﻿" + buf.getvalue(), encoding="utf-8", newline="")
    meta = {
        "title": "Anii (Balanka) – Wörterbuch / Dictionnaire",
        "license": "CC BY-SA 4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "source": "https://anii.lmbt.app",
        "alphabet": anii.ALPHABET,
        "entries": full,
    }
    (dl / "anii-vokabeln.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    try:
        import anki_export
        anki_export.write_apkg(entries, lesson_list, dl / "anii.apkg", AUDIO_DIR)
    except ImportError as err:
        report.warn("Anki", f"Deck nicht erzeugt ({err}). Einmalig:  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")
    return site


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="nur prüfen, nichts bauen")
    ap.add_argument("--ids", action="store_true", help="fehlende IDs vergeben und CSV neu schreiben")
    ap.add_argument("--fix", action="store_true", help="eindeutige Doppelgänger ersetzen, NFC normalisieren und CSV neu schreiben")
    ap.add_argument("--csv", help="andere CSV-Datei prüfen (Standard: data/vokabeln.csv)")
    ap.add_argument("--out", default=str(ROOT / "dist"), help="Ausgabeordner (Standard: dist/)")
    args = ap.parse_args()
    global CSV_FILE
    if args.csv:
        CSV_FILE = Path(args.csv).resolve()

    report = Report()
    header, rows, bom = read_csv(CSV_FILE, report)
    if header is None:
        report.print()
        return 1

    if args.ids:
        added = assign_ids(header, rows)
        print(f"{added} neue IDs vergeben.")
    entries, changed = validate(header, rows, report, fix=args.fix)
    if args.ids or args.fix:
        write_csv(CSV_FILE, header, rows, bom)
        print(f"{CSV_FILE} neu geschrieben.")

    speakers = read_simple_csv(DATA / "sprecher.csv", report, ["kuerzel", "name", "zustimmung"])
    alphabet_rows = read_simple_csv(DATA / "alphabet.csv", report, ["buchstabe"])
    if changed and not args.fix:
        report.info(CSV_FILE.name, "Leerzeichen/Unicode-Form wurden für den Build bereinigt (mit --fix auch in der CSV)")

    out = None if args.check else Path(args.out)
    if out is not None and report.count("FEHLER"):
        out = None
    site = build(entries, speakers, alphabet_rows, report, out)
    report.print()
    print(f"{len(site['entries'])} Einträge in {len(site['lessons'])} Lektionen, {len(site['audio']['files'])} Aufnahmen")
    if report.count("FEHLER"):
        print("Build abgebrochen – bitte zuerst die Fehler beheben.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
