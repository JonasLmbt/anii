#!/usr/bin/env python3
"""Baut die statische Website nach dist/.

    python3 tools/build_site.py          (ruft vorher build_data.py auf)

Seitentexte liegen in content/<sprache>/*.html, Oberflächentexte in content/<sprache>/ui.json.
Nur Python-Standardbibliothek.
"""
import datetime
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anii  # noqa: E402
import build_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
CONTENT = ROOT / "content"
DIST = ROOT / "dist"
LANGS = ["fr", "de"]  # erste Sprache = Standard

# Seite: Schlüssel, Pfad je Sprache, Icon
PAGES = [
    ("start", {"fr": "", "de": ""}, "house"),
    ("dict", {"fr": "dictionnaire", "de": "woerterbuch"}, "book-open"),
    ("train", {"fr": "apprendre", "de": "lernen"}, "layers"),
    ("alphabet", {"fr": "alphabet", "de": "alphabet"}, "type"),
    ("langue", {"fr": "langue", "de": "sprache"}, "globe"),
    ("sources", {"fr": "sources", "de": "quellen"}, "book"),
    ("participer", {"fr": "participer", "de": "mitmachen"}, "hand-heart"),
]
JS_PAGES = {"dict", "train", "participer"}
CUR_PAGE = ' aria-current="page"'
CUR_LANG = ' aria-current="true"'
ICONS = json.loads((ROOT / "tools" / "icons.json").read_text(encoding="utf-8"))


def esc(s):
    return html.escape(str(s), quote=True)


def icon(name):
    return ('<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg></span>")


def url(lang, key):
    for k, paths, _ in PAGES:
        if k == key:
            return f"/{lang}/" + (paths[lang] + "/" if paths[lang] else "")
    raise KeyError(key)


def git_date():
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", "data"], cwd=ROOT, capture_output=True, text=True)
        if out.stdout.strip():
            return out.stdout.strip()
    except OSError:
        pass
    return datetime.date.today().isoformat()


def fmt_date(iso, lang):
    y, m, d = iso.split("-")
    if lang == "de":
        return f"{int(d)}.{int(m)}.{y}"
    months = "janvier février mars avril mai juin juillet août septembre octobre novembre décembre".split()
    return f"{int(d)} {months[int(m) - 1]} {y}"


def todo(ui, text=""):
    return f'<div class="todo"><b>{esc(ui["todo"])}</b>{(" · " + text) if text else ""}</div>'


class Builder:
    def __init__(self, site_data):
        self.data = site_data
        self.ui = {l: json.loads((CONTENT / l / "ui.json").read_text(encoding="utf-8")) for l in LANGS}
        self.version = {}
        self.data_date = git_date()
        self.by_id = {e["id"]: e for e in site_data["entries"]}

    # ---------------------------------------------------------- Assets
    def copy_assets(self):
        dst = DIST / "assets"
        shutil.copytree(SITE / "assets", dst, dirs_exist_ok=True)
        icons_js = "/* Lucide-Icons (ISC-Lizenz, https://lucide.dev) */\nwindow.ANII_ICONS=" + json.dumps(
            {k: v for k, v in ICONS.items() if k != "_"}, ensure_ascii=False, separators=(",", ":")) + ";\n"
        (dst / "icons.js").write_text(icons_js, encoding="utf-8")
        for f in ("app.css", "app.js", "icons.js"):
            self.version[f] = hashlib.sha1((dst / f).read_bytes()).hexdigest()[:10]
        for f in ("manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"):
            if (SITE / f).exists():
                shutil.copy2(SITE / f, DIST / f)

    def asset(self, name):
        return f"/assets/{name}?v={self.version[name]}"

    # ---------------------------------------------------------- Rahmen
    def page(self, lang, key, title, body, extra_head=""):
        ui = self.ui[lang]
        nav = "".join(
            f'<a href="{url(lang, k)}"{CUR_PAGE if k == key else ""}>{icon(ic)}<span>{esc(ui["nav"][k])}</span></a>'
            for k, _, ic in PAGES)
        switch = " ".join(
            f'<a href="{url(l, key)}" hreflang="{l}" lang="{l}" data-lang="{l}"{CUR_LANG if l == lang else ""}>{l.upper()}</a>'
            for l in LANGS)
        alternates = "".join(f'<link rel="alternate" hreflang="{l}" href="{url(l, key)}">' for l in LANGS)
        scripts = ""
        if key in JS_PAGES:
            ui_json = json.dumps(dict(ui, urls={k: url(lang, k) for k, _, _ in PAGES}), ensure_ascii=False).replace("</", "<\\/")
            scripts = (f'<script type="application/json" id="ui">{ui_json}</script>'
                       f'<script src="{self.asset("icons.js")}" defer></script>')
        scripts += f'<script src="{self.asset("app.js")}" defer></script>'
        full_title = esc(ui["site_name"]) if key == "start" else f"{esc(title)} · {esc(ui['site_name'])}"
        return f"""<!doctype html>
<html lang="{lang}" data-page="{key}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{full_title}</title>
<meta name="description" content="{esc(ui['site_desc'])}">
<meta name="theme-color" content="#7a3b12">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/assets/fonts/AniiWeb-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{self.asset('app.css')}">
{alternates}{extra_head}
</head>
<body>
<a class="skip" href="#main">{esc(ui['skip'])}</a>
<header class="topbar">
  <a class="brand" href="{url(lang, 'start')}"><img src="/icon.svg" alt="" width="30" height="30"><span>{esc(ui['site_name'])}</span></a>
  <nav class="langs" aria-label="Langue / Sprache">{switch}</nav>
</header>
<nav class="tabs" aria-label="Navigation">{nav}</nav>
<main id="main" class="wrap">
{body}
</main>
<footer class="foot">
  <p>{esc(ui['footer_license'])} · <a href="{url(lang, 'sources')}">{esc(ui['nav']['sources'])}</a></p>
  <p>{esc(ui['footer_data'])} {esc(fmt_date(self.data_date, lang))} · {esc(ui["d_results"].replace("{n}", str(len(self.data["entries"]))))} <span id="net" class="net"></span></p>
  <p id="audio-dl" hidden></p>
</footer>
{scripts}
</body>
</html>
"""

    def write(self, lang, key, title, body, **kw):
        path = DIST / url(lang, key).strip("/") / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.page(lang, key, title, body, **kw), encoding="utf-8")

    def content(self, lang, name):
        text = (CONTENT / lang / f"{name}.html").read_text(encoding="utf-8")
        ui = self.ui[lang]
        repl = {
            "n_entries": str(len(self.data["entries"])),
            "n_lessons": str(len(self.data["lessons"])),
            "n_checked": str(sum(1 for e in self.data["entries"] if e.get("ok"))),
            "todo": todo(ui),
            "speakers": self.speakers(lang),
            "downloads": self.downloads(lang),
        }
        for k, _, _ in PAGES:
            repl["url_" + k] = url(lang, k)
        text = re.sub(r"\{\{todo:([^}]*)\}\}", lambda m: todo(ui, m.group(1)), text)
        text = re.sub(r"\{\{icon:([a-z0-9-]+)\}\}", lambda m: icon(m.group(1)), text)
        return re.sub(r"\{\{(\w+)\}\}", lambda m: repl.get(m.group(1), m.group(0)), text)

    def speakers(self, lang):
        sp = self.data["speakers"]
        if not sp:
            return todo(self.ui[lang], "aucune voix enregistrée pour l’instant" if lang == "fr" else "noch keine Aufnahmen")
        return "<ul>" + "".join(f"<li>{esc(s['name'])}{' (' + esc(s['ort']) + ')' if s['ort'] else ''}</li>" for s in sp) + "</ul>"

    def downloads(self, lang):
        items = [("anii-vokabeln.csv", "CSV (Excel, LibreOffice)"), ("anii-vokabeln.json", "JSON"), ("anii.apkg", "Anki")]
        out = []
        for f, label in items:
            p = DIST / "telechargement" / f
            if p.exists():
                kb = max(1, round(p.stat().st_size / 1024))
                out.append(f'<li><a href="/telechargement/{f}" download>{icon("download")} {esc(label)}</a> <small class="muted">{f}, {kb} KB</small></li>')
        return '<ul class="downloads">' + "".join(out) + "</ul>"

    # ---------------------------------------------------------- Seiten
    def build_pages(self):
        for lang in LANGS:
            ui = self.ui[lang]
            n = ui["nav"]
            self.write(lang, "start", n["start"], self.start(lang))
            self.write(lang, "langue", n["langue"], self.content(lang, "langue"))
            self.write(lang, "alphabet", n["alphabet"], self.alphabet(lang))
            self.write(lang, "dict", n["dict"],
                       f'<h1>{icon("book-open")} {esc(n["dict"])}</h1><div id="app" data-app="dict"><p class="loading">{esc(ui["loading"])}</p></div>'
                       '<noscript><p>JavaScript est nécessaire pour la recherche. / Für die Suche wird JavaScript benötigt. '
                       '<a href="/telechargement/anii-vokabeln.csv">CSV</a></p></noscript>')
            self.write(lang, "train", n["train"],
                       f'<div id="app" data-app="train"><p class="loading">{esc(ui["loading"])}</p></div>')
            self.write(lang, "sources", n["sources"], self.content(lang, "sources"))
            self.write(lang, "participer", n["participer"], self.content(lang, "participer"))
        self.root_page()
        self.not_found()

    def start(self, lang):
        ui = self.ui[lang]
        cards = []
        for key, _, ic in PAGES[1:]:
            sub = self.content_snippet(lang, key)
            cards.append(f'<a class="card" href="{url(lang, key)}"><span class="card-icon">{icon(ic)}</span>'
                         f'<span class="card-body"><strong>{esc(ui["nav"][key])}</strong><small>{esc(sub)}</small></span></a>')
        return self.content(lang, "start").replace("{{cards}}", '<div class="grid">' + "".join(cards) + "</div>")

    def content_snippet(self, lang, key):
        d = self.data
        fr = lang == "fr"
        return {
            "dict": (f"{len(d['entries'])} mots · recherche anii, français, allemand" if fr
                     else f"{len(d['entries'])} Wörter · Suche auf Anii, Französisch, Deutsch"),
            "train": (f"{len(d['lessons'])} leçons · cartes, quiz, écriture" if fr
                      else f"{len(d['lessons'])} Lektionen · Karteikarten, Quiz, Schreiben"),
            "alphabet": "31 lettres, prononciation" if fr else "31 Buchstaben, Aussprache",
            "langue": "Origine, dialectes, écriture" if fr else "Herkunft, Dialekte, Schrift",
            "sources": "Littérature, voix, licence, téléchargements" if fr else "Literatur, Stimmen, Lizenz, Downloads",
            "participer": "Corriger, ajouter, enregistrer" if fr else "Korrigieren, ergänzen, aufnehmen",
        }[key]

    def alphabet(self, lang):
        ui = self.ui[lang]
        tiles = []
        for t in self.data["alphabet"]:
            ex = self.by_id.get(t.get("ex", ""))
            if ex:
                tr = ex.get(lang) or ex.get("fr") or ex.get("de") or ""
                ex_html = f'<a class="tile-ex" href="{url(lang, "dict")}#{ex["id"]}"><b>{esc(ex["a"])}</b> <small>{esc(tr)}</small></a>'
            else:
                ex_html = f'<span class="tile-ex ph">{esc(ui["todo"])}: {"exemple" if lang == "fr" else "Beispielwort"}</span>'
            if t.get("au"):
                au = f'<button class="speak" type="button" data-audio="/audio/{esc(t["au"])}" aria-label="{esc(ui["play"])} {esc(t["l"])}">{icon("volume-2")}</button>'
            else:
                au = f'<span class="speak off" title="{esc(ui["no_audio"])}" aria-label="{esc(ui["no_audio"])}">{icon("mic")}</span>'
            note = t.get("p" + lang)
            note_html = f'<p class="tile-note">{esc(note)}</p>' if note else f'<p class="tile-note ph">{esc(ui["todo"])}: {"prononciation" if lang == "fr" else "Aussprache"}</p>'
            tiles.append(f'<li class="tile" id="l-{esc(anii.slug(t["l"]) or t["l"])}"><div class="tile-head"><span class="tile-letter" lang="blo">{esc(t["u"])} {esc(t["l"])}</span>{au}</div>{ex_html}{note_html}</li>')
        return self.content(lang, "alphabet").replace("{{tiles}}", '<ul class="tiles">' + "".join(tiles) + "</ul>")

    def root_page(self):
        links = "".join(f'<a class="btn big" href="/{l}/" hreflang="{l}" data-lang="{l}">{esc(self.ui[l]["lang_name"])}</a>' for l in LANGS)
        page = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anii · Balanka</title>
<meta name="description" content="{esc(self.ui['fr']['site_desc'])}">
<meta name="theme-color" content="#7a3b12">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="{self.asset('app.css')}">
</head>
<body class="root">
<main class="wrap narrow center">
<img src="/icon.svg" alt="" width="72" height="72">
<h1>Anii · Balanka</h1>
<p>{esc(self.ui['fr']['site_desc'])}</p>
<p lang="de" class="muted">{esc(self.ui['de']['site_desc'])}</p>
<div class="row gap center">{links}</div>
</main>
<script src="{self.asset('app.js')}" defer></script>
</body>
</html>
"""
        (DIST / "index.html").write_text(page, encoding="utf-8")

    def not_found(self):
        body = ('<h1>404</h1><p>Page introuvable. · Seite nicht gefunden.</p>'
                '<p><a class="btn" href="/fr/">Français</a> <a class="btn" href="/de/">Deutsch</a></p>')
        (DIST / "404.html").write_text(self.page("fr", "start", "404", body).replace(' data-page="start"', ' data-page="404"'), encoding="utf-8")

    # ---------------------------------------------------------- Service Worker
    def service_worker(self):
        files = []
        for p in sorted(DIST.rglob("*")):
            rel = p.relative_to(DIST).as_posix()
            if p.is_dir() or rel.startswith(("telechargement/", "audio/")) or rel in ("sw.js", "404.html"):
                continue
            if rel.endswith("OFL.txt"):
                continue
            files.append(p)
        h = hashlib.sha1()
        urls = []
        for p in files:
            rel = p.relative_to(DIST).as_posix()
            h.update(rel.encode() + b"\0" + p.read_bytes())
            if rel.endswith("index.html"):
                u = "/" + rel[: -len("index.html")]
            else:
                u = "/" + rel
                name = rel.removeprefix("assets/")
                if name in self.version:
                    u = self.asset(name)
            urls.append(u)
        version = h.hexdigest()[:12]
        sw = (SITE / "sw.js").read_text(encoding="utf-8")
        sw = sw.replace("__VERSION__", version).replace("__PRECACHE__", json.dumps(urls, ensure_ascii=False))
        (DIST / "sw.js").write_text(sw, encoding="utf-8")
        size = sum(p.stat().st_size for p in files)
        print(f"Service Worker {version}: {len(urls)} Dateien, {size / 1024:.0f} KB vorab gespeichert")


def main():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    sys.argv = [sys.argv[0]] + [a for a in sys.argv[1:]]
    report = build_data.Report()
    header, rows, _ = build_data.read_csv(build_data.CSV_FILE, report)
    if header is None:
        report.print()
        return 1
    entries, _ = build_data.validate(header, rows, report)
    speakers = build_data.read_simple_csv(build_data.DATA / "sprecher.csv", report, ["kuerzel", "name", "zustimmung"])
    alphabet_rows = build_data.read_simple_csv(build_data.DATA / "alphabet.csv", report, ["buchstabe"])
    if report.count("FEHLER"):
        report.print()
        print("Build abgebrochen – bitte zuerst die Fehler beheben (python3 tools/build_data.py --check).")
        return 1
    site_data = build_data.build(entries, speakers, alphabet_rows, report, DIST)
    report.print()
    b = Builder(site_data)
    b.copy_assets()
    b.build_pages()
    b.service_worker()
    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"Fertig: dist/ ({total / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(main())
