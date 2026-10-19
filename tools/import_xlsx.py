#!/usr/bin/env python3
"""Übernimmt eine Excel-Tabelle in data/vokabeln.csv, ohne bestehende IDs zu verlieren.

    uvx --from openpyxl python tools/import_xlsx.py Anii.xlsx            Vorschau
    uvx --from openpyxl python tools/import_xlsx.py Anii.xlsx --write    CSV schreiben

Zuordnung: Hat die Tabelle eine Spalte „id“, zählt diese. Sonst wird ein Eintrag über
anii + Übersetzung (ohne Groß-/Kleinschreibung, Leerzeichen, Unicode-Form) wiedererkannt.
Neue Zeilen bekommen die nächste freie ID. Spalten, die in der Excel-Tabelle fehlen
(z. B. lektion), bleiben aus der CSV erhalten. Einträge, die nur noch in der CSV stehen,
werden gemeldet, aber nicht gelöscht.
"""
import argparse
import datetime
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anii  # noqa: E402
import build_data as bd  # noqa: E402


def clean(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    return " ".join(anii.nfc(str(v)).split())


def key(e):
    return (anii.lower(e.get("anii", "")), anii.lower(e.get("francais", "")), anii.lower(e.get("deutsch", "")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    ws = openpyxl.load_workbook(args.xlsx, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    head = [clean(h) for h in rows[0]]
    xl = [dict(zip(head, (clean(v) for v in r))) for r in rows[1:]]
    xl = [r for r in xl if any(r.values())]

    report = bd.Report()
    header, old, bom = bd.read_csv(bd.CSV_FILE, report)
    old = [{k: clean(v) for k, v in r.items() if k} for r in old]
    by_id = {r["id"]: r for r in old if r.get("id")}
    by_key = {key(r): r for r in old}
    used = [int(i[1:]) for i in by_id if bd.ID_RE.match(i)]
    nxt = max(used, default=0) + 1

    out, matched, new = [], set(), []
    for r in xl:
        base = by_id.get(r.get("id", "")) or by_key.get(key(r))
        e = dict(base) if base else {c: "" for c in bd.COLUMNS}
        for c in bd.COLUMNS:
            if c in head and c != "id":
                e[c] = r.get(c, "")
        if base:
            matched.add(base["id"])
        else:
            e["id"] = f"w{nxt:04d}"
            nxt += 1
            new.append(e)
        out.append(e)

    gone = [r for r in old if r["id"] not in matched]
    for r in gone:
        out.append(r)  # nichts stillschweigend löschen
    print(f"{len(xl)} Zeilen in der Tabelle: {len(matched)} wiedererkannt, {len(new)} neu, {len(gone)} nur in der CSV (bleiben erhalten)")
    for e in new:
        print(f"  neu  {e['id']}  {e['anii']} = {e['francais'] or e['deutsch']}")
    for e in gone:
        print(f"  fehlt in der Tabelle  {e['id']}  {e['anii']}")
    if args.write:
        bd.write_csv(bd.CSV_FILE, bd.COLUMNS, out, bom)
        print(f"{bd.CSV_FILE} geschrieben – jetzt  python3 tools/build_data.py --check")


if __name__ == "__main__":
    main()
