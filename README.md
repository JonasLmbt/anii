# Anii · Balanka

Offene Sammlung des Anii aus Balanka (Togo): Wörterbuch, Alphabet und Vokabeltrainer.
Live unter **https://anii.lmbt.app**. Die Oberfläche ist auf Französisch und Deutsch.

Die **Daten** sind das Wichtigste. Die Website ist nur die Oberfläche dafür. Quelle der Wahrheit ist
[`data/vokabeln.csv`](data/vokabeln.csv). Alles andere (JSON, Downloads, Anki-Deck, Website) wird daraus erzeugt.

- Statische Seite: reines HTML/CSS/JS, kein Backend, keine Datenbank, keine Tracker, keine externen CDNs
- Offline-fähig (PWA): nach dem ersten Besuch funktionieren Wörterbuch und Trainer ohne Netz
- Mobile first, kleine Seiten (erster Besuch ≈ 350 KB inkl. Schrift, danach aus dem Speicher)

## Aufbau

```
data/vokabeln.csv     Wortliste (Quelle der Wahrheit)
data/audio/           Aufnahmen (Dateiname = ID, z. B. w0012.mp3)
data/sprecher.csv     Sprecherinnen und Sprecher, mit Zustimmung
data/alphabet.csv     Beispielwort, Aufnahme und Aussprache-Notiz je Buchstabe
content/fr|de/        Seitentexte (HTML-Fragmente) und Oberflächentexte (ui.json)
site/                 Gestaltung, JavaScript, Service Worker, Schrift, Icons
tools/                Build-Skripte (Python)
deploy/               Veröffentlichung auf dem Server (systemd-Timer, nginx)
docs/archivierung.md  Sicherung auf Zenodo und Wikimedia Commons
```

## Die CSV pflegen

Die Datei ist **UTF-8** und **durch Semikolons getrennt**. In Excel: *Datei → Speichern unter →
„CSV UTF-8 (durch Trennzeichen getrennt)“*. In LibreOffice beim Öffnen und Speichern „UTF-8“ und
„Semikolon“ wählen.

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `id` | ja | feste Nummer `w0001`, `w0002` … – wird automatisch vergeben, **nie ändern oder neu verwenden** |
| `anii` | ja | das Wort auf Anii |
| `deutsch` | eine der beiden | deutsche Übersetzung(en), mehrere mit Komma trennen |
| `francais` | eine der beiden | französische Übersetzung(en) |
| `lektion` | ja | Name der Lektion, z. B. `3 · Familie`. Zahlen am Anfang bestimmen die Reihenfolge |
| `plural` | | Pluralform |
| `beispiel` | | Beispielsatz |
| `dialekt` | | z. B. `Balanka` |
| `quelle` | | woher das Wort stammt (Person, Buch, Wortliste …) |
| `datum` | | `JJJJ-MM-TT`, `JJJJ-MM` oder `JJJJ` |
| `audio` | | Dateiname in `data/audio/`. Leer lassen, wenn die Datei wie die ID heißt (`w0012.mp3`) |
| `sprecher` | bei Audio | Kürzel aus `data/sprecher.csv` |
| `geprueft` | | `ja` oder `nein` – hat jemand aus Balanka das Wort bestätigt? |
| `notiz` | | Anmerkung zum Gebrauch (z. B. „pendant le matin“, Antwort auf einen Gruß). Wird im Wörterbuch und auf den Karten angezeigt – also nichts Privates hineinschreiben |

**IDs:** Lernstand im Trainer, Aufnahmen, Anki-Karten und Links (`/fr/dictionnaire/#w0012`) hängen an
der ID. Deshalb darf man ein Wort korrigieren, ohne dass etwas verloren geht. Neue Zeilen lässt man
ohne ID und ruft danach `--ids` auf (siehe unten). Gelöschte IDs werden nicht wiederverwendet.

**Aufnahmen:** Am besten MP3 oder Opus, mono, etwa 64 kbit/s, ein Wort pro Datei, Name = ID.
Eine Aufnahme wird nur veröffentlicht, wenn in `sprecher.csv` bei der Person `zustimmung` = `ja` steht.

**Sprecher (`data/sprecher.csv`):** `kuerzel;name;ort;zustimmung;datum_zustimmung;notiz`.
Namen erscheinen auf der Seite „Quellen“ nur mit Zustimmung. Das Kürzel pro Aufnahme braucht man für
die Lizenz (CC BY-SA verlangt die Namensnennung der Urheber) und für die Archivierung auf Wikimedia
Commons. Außerdem lassen sich so alle Aufnahmen einer Person entfernen, falls sie ihre Zustimmung
zurückzieht.

## Prüfen und bauen

Auf dem Server (oder überall mit Python ≥ 3.9):

```sh
python3 tools/build_data.py --check      # nur prüfen
python3 tools/build_data.py --ids        # fehlende IDs vergeben (schreibt die CSV neu)
python3 tools/build_data.py --fix        # eindeutige Zeichenfehler (ə → ǝ, ε → ɛ …) ersetzen
python3 tools/build_data.py --check --csv andere.csv   # eine andere Datei prüfen
.venv/bin/python tools/build_site.py      # alles nach dist/ bauen
```

Für das Anki-Deck braucht man `genanki` (einmalig, z. B. mit uv):

```sh
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

Die Prüfung meldet:

- **Fehler** (Build bricht ab): Doppelgänger-Zeichen wie ə/Ə statt ǝ/Ǝ, griechisches ι/ε/υ, ɷ, ʋ, ɪ,
  kyrillische Buchstaben, außerdem fehlende Pflichtfelder, doppelte IDs und doppelte Einträge.
  Zu jedem Zeichenfehler gibt es einen Vorschlag.
- **Warnungen**: Buchstaben außerhalb des Alphabets, unbekannte Spalten, fehlende Audio-Dateien,
  Aufnahmen ohne Sprecher oder ohne Zustimmung, ungewöhnliche Datumsangaben.
- **Hinweise**: gleiche Schreibung mit verschiedener Bedeutung (Homonyme), ungenutzte Audio-Dateien.

Alles wird auf Unicode NFC normalisiert. Mit `tests/fehlerbeispiel.csv` kann man die Meldungen ausprobieren.

**Alphabet und Sortierung** stehen in [`tools/anii.py`](tools/anii.py):
`a ǝ b c d e ɛ f g gb h i ɩ j k kp l m n ny ŋ ŋm o ɔ p r s t u ʊ w y`. Die Digraphen gb, kp, ny und ŋm
werden als ein Buchstabe sortiert, Tonzeichen beim Sortieren ignoriert. Die Suche findet Wörter auch
ohne Sonderzeichen („e“ findet ɛ und ǝ). Die Faltung steht doppelt in `tools/anii.py` und in
`site/assets/app.js` und muss in beiden Dateien gleich bleiben.

## Veröffentlichen

Auf dem CHUWI-Server liegt ein Klon in `~/anii-site`. `anii-publish.timer` prüft alle 2 Minuten, ob
es neue Commits auf `main` gibt, baut dann **zweimal** und veröffentlicht nur, wenn beide Builds
gleich sind (Schutz vor RAM-Fehlern). Ziel ist `/var/www/anii`, nginx-Konfiguration in
[`deploy/anii.lmbt.app.nginx`](deploy/anii.lmbt.app.nginx). Bei Fehlern in der CSV bleibt die alte Seite
online. Die Meldungen zeigt `journalctl -u anii-publish`.

Ablauf also: CSV bearbeiten → committen → pushen → nach spätestens 2 Minuten ist die Seite aktuell.

## Lizenzen

- Inhalte, Daten und Aufnahmen: [CC BY-SA 4.0](LICENSE-DATA.txt)
- Code: [MIT](LICENSE)
- Schrift „Anii Web“: verkleinerte Fassung von [Andika](https://software.sil.org/andika/) (SIL Global),
  [SIL Open Font License 1.1](site/assets/fonts/OFL.txt). Weil „Andika“ ein geschützter Schriftname ist,
  trägt die verkleinerte Fassung einen anderen Namen. Neu erzeugen mit `tools/make_font.py`.
- Icons: [Lucide](https://lucide.dev) (ISC)
