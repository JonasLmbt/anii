# Archivierung

Die Website kann irgendwann verschwinden, die Daten sollen bleiben. Deshalb sichern wir sie zusätzlich
an zwei Orten, die auf Dauer angelegt sind:

1. **Zenodo** (CERN) für die ganze Wortliste mit allen Aufnahmen. Jede Version bekommt eine DOI und
   lässt sich so zitieren.
2. **Lingua Libre / Wikimedia Commons** für die einzelnen Aufnahmen. Dort können auch Wikipedia,
   Wiktionary und andere Projekte sie verwenden.

> Abläufe und Oberflächen der Dienste können sich ändern. Vor dem ersten Hochladen bitte die
> aktuellen Hilfeseiten prüfen. Stellen, die besonders geprüft werden müssen, sind mit **(prüfen)**
> markiert.

---

## 1. Zenodo (DOI für den Datensatz)

### Variante A: automatisch über GitHub (empfohlen)

Zenodo kann ein GitHub-Repository beobachten und **bei jedem GitHub-Release** automatisch eine neue
Version mit DOI anlegen.

1. Auf <https://zenodo.org> mit dem GitHub-Konto anmelden.
2. Unter *Account → GitHub* das Repository `JonasLmbt/anii` einschalten.
3. Im Repository eine Datei `.zenodo.json` mit den Metadaten anlegen (Vorlage unten). Ohne diese
   Datei übernimmt Zenodo nur den Namen des Repos.
4. Auf GitHub einen Release erstellen, z. B. `v2027.01` („Stand Januar 2027“). Zenodo archiviert
   dann den Stand des Repos als ZIP und vergibt eine DOI.
5. Die **Concept-DOI** (gilt für alle Versionen) in die README und auf die Seite „Quellen“ eintragen.
   Für das Archiv kommt sie in `content/*/sources.html` an die Stelle des Platzhalters.

Vorlage `.zenodo.json` **(prüfen: Feldnamen gegen die aktuelle Zenodo-Dokumentation)**:

```json
{
  "title": "Anii (Balanka) – Wortliste und Aufnahmen / liste de mots et enregistrements",
  "upload_type": "dataset",
  "description": "Wortliste des Anii aus Balanka (Togo) mit deutscher und französischer Übersetzung, Beispielsätzen und Aufnahmen. Quelle: https://anii.lmbt.app",
  "creators": [{ "name": "Lambrecht, Jonas" }],
  "contributors": [],
  "license": "cc-by-sa-4.0",
  "language": "blo",
  "keywords": ["Anii", "Balanka", "Togo", "Ghana-Togo-Mountain", "Kwa", "lexicon", "dictionary", "language documentation"],
  "related_identifiers": [
    { "identifier": "https://anii.lmbt.app", "relation": "isDocumentedBy", "resource_type": "other" }
  ]
}
```

Als `contributors` kommen Sprecherinnen und Sprecher sowie alle, die Wörter beigetragen haben,
dazu. **Nur mit ihrer Zustimmung**, wie auf der Website.

### Variante B: von Hand hochladen

1. Auf dem Server bauen (`tools/build_site.py`), dann die Dateien aus `dist/telechargement/`
   (CSV, JSON, Anki-Deck) und einen ZIP-Ordner mit `data/audio/`, `data/sprecher.csv` (ohne
   private Notizen) sowie `LICENSE-DATA.txt` zusammenstellen.
2. Auf Zenodo *New upload*, Typ **Dataset**, Lizenz **CC BY-SA 4.0**, Metadaten wie oben.
3. Für spätere Stände **„New version“** am bestehenden Eintrag benutzen, keinen neuen Eintrag
   anlegen. Dann bleibt die Concept-DOI gleich.

### Was vor jedem Archiv-Stand zu prüfen ist

- `python3 tools/build_data.py --check` ohne Fehler
- Bei allen veröffentlichten Aufnahmen hat die Person zugestimmt (`zustimmung` = `ja`)
- Die Spalte `notiz` enthält nichts Privates (sie ist in der CSV öffentlich)

---

## 2. Aufnahmen: Lingua Libre und Wikimedia Commons

Auf **Wikimedia Commons** liegen Medien unter freien Lizenzen dauerhaft und können weltweit genutzt
werden. **Lingua Libre** (<https://lingualibre.org>) ist ein Werkzeug der Wikimedia-Gemeinschaft, mit
dem man viele einzelne Wörter schnell aufnehmen kann. Es lädt jede Aufnahme mit Sprecherangaben auf
Commons hoch, unter CC BY-SA 4.0.

### Mit Lingua Libre aufnehmen

1. **Konto:** Die aufnehmende Person braucht ein Wikimedia-Konto (kostenlos) und meldet sich bei Lingua
   Libre an.
2. **Sprache:** Lingua Libre braucht für Anii einen Wikidata-Eintrag der Sprache. Ob Anii schon
   auswählbar ist, **(prüfen)**. Wenn nicht, auf der Diskussionsseite von Lingua Libre darum bitten.
3. **Sprecherprofil:** Für jede sprechende Person ein Profil anlegen (Name oder Pseudonym, Sprache,
   Ort *Balanka*, Sprachniveau). Ein Konto kann Profile für mehrere Sprecher verwalten.
   Die Person muss **vorher zustimmen**, dass ihre Stimme unter CC BY-SA 4.0 veröffentlicht wird.
4. **Wortliste:** Bei Lingua Libre die Wörter einfügen (eine Zeile pro Wort). Die Liste kann man aus
   der CSV kopieren (Spalte `anii`).
5. **Aufnehmen:** Lingua Libre schneidet die Wörter automatisch und lädt sie hoch. Die Dateinamen
   folgen einem festen Muster mit Sprachcode, Benutzername und Wort **(prüfen)**.
6. **Zurück ins Projekt:** Die fertigen Dateien von Commons herunterladen, nach der ID umbenennen
   (`w0012.ogg` o. ä.) und in `data/audio/` legen. In `sprecher.csv` die Person mit Kürzel eintragen,
   in der CSV die Spalte `sprecher` ausfüllen. In `quelle` oder `notiz` kann der Commons-Dateiname
   stehen, damit die Herkunft nachvollziehbar bleibt.

### Ohne Lingua Libre (Aufnahmen schon vorhanden)

Eigene Aufnahmen kann man auch direkt mit dem *Upload Wizard* auf Commons hochladen:

- Lizenz **CC BY-SA 4.0**. Als Urheber die sprechende Person **und** die aufnehmende Person nennen.
- Lädt jemand anderes hoch als die sprechende Person, braucht Commons in der Regel eine
  Freigabe-Erklärung der Rechteinhaber (VRT-Verfahren) **(prüfen)**. Am einfachsten lädt die
  aufnehmende Person mit eigenem Konto hoch und hat die schriftliche Zustimmung der Sprecherin oder
  des Sprechers.
- Beschreibung auf Französisch und Deutsch: Wort, Bedeutung, Dialekt (Balanka), Datum, Ort.
- Eine Kategorie für Anii-Aussprachen verwenden oder anlegen **(prüfen, ob es sie schon gibt)**.

### Einverständnis

Vor jeder Aufnahme schriftlich (oder als Sprachnachricht, die man aufbewahrt) festhalten:

- Name (oder Pseudonym), Dorf, Datum
- Zustimmung zur Veröffentlichung unter CC BY-SA 4.0, also auf dieser Website, auf Zenodo und auf
  Wikimedia Commons
- ob der Name genannt werden soll
- Hinweis: Eine einmal frei lizenzierte und kopierte Aufnahme lässt sich nicht vollständig
  zurückholen. Wir können sie aber von unseren eigenen Seiten entfernen.

Eine fertige Vorlage auf Französisch fehlt noch (Platzhalter auf der Seite „Mitmachen“).
