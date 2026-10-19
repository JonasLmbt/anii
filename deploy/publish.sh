#!/bin/sh
# Holt neue Commits von GitHub, baut die Seite und veröffentlicht sie nach /var/www/anii.
# Läuft alle 2 Minuten über anii-publish.timer.  Manuell:  ./deploy/publish.sh --force
#
# Der CHUWI hat vermutlich fehlerhaften Arbeitsspeicher. Deshalb wird zweimal gebaut und nur
# veröffentlicht, wenn beide Ergebnisse bitgleich sind (ausgenommen das Anki-Deck, das
# Zeitstempel enthält).
set -eu
cd "$(dirname "$0")/.."
TARGET=/var/www/anii
BUILD=$HOME/anii-build
PY=.venv/bin/python

exec 9>/tmp/anii-publish.lock
flock -n 9 || exit 0

git fetch -q origin main
NEW=$(git rev-parse origin/main)
if [ "$NEW" = "$(cat .last-published 2>/dev/null || true)" ] && [ "${1:-}" != "--force" ]; then
    exit 0
fi
OLD=$(git rev-parse HEAD)
git reset -q --hard "$NEW"
[ -x "$PY" ] || { ~/.local/bin/uv venv -q .venv && ~/.local/bin/uv pip install -q --python "$PY" -r requirements.txt; }

rm -rf "$BUILD" && mkdir -p "$BUILD"
for run in a b; do
    "$PY" tools/build_site.py > "$BUILD/log-$run.txt" 2>&1 || { cat "$BUILD/log-$run.txt" >&2; exit 1; }
    mv dist "$BUILD/$run"
done
sums() { (cd "$1" && find . -type f ! -name anii.apkg -print0 | sort -z | xargs -0 sha256sum); }
if [ "$(sums "$BUILD/a")" != "$(sums "$BUILD/b")" ]; then
    echo "Die zwei Builds unterscheiden sich – nichts veröffentlicht (Speicherfehler?)" >&2
    exit 1
fi
rsync -a --delete --chmod=D755,F644 "$BUILD/a"/ "$TARGET"/
echo "$NEW" > .last-published
# Konten-Dienst neu starten, wenn sich sein Code geändert hat
if ! git diff --quiet "$OLD" "$NEW" -- learn/; then sudo -n systemctl restart anii-learn || echo "anii-learn bitte neu starten" >&2; fi
echo "Veröffentlicht: $(git log -1 --format='%h %s')"
grep -E "Fehler,|Fertig" "$BUILD/log-a.txt" || true
