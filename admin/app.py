#!/usr/bin/env python3
"""Online-Editor für anii.lmbt.app (nur Python-Standardbibliothek).

Schreibt data/vokabeln.csv, data/sprecher.csv und data/audio/ in einem eigenen Git-Klon,
committet jede Änderung und pusht sie zu GitHub. Der Veröffentlichungs-Timer baut die
öffentliche (statische) Seite daraus neu. Die CSV bleibt so die Quelle der Wahrheit.

    python3 admin/app.py passwd     Passwort setzen
    python3 admin/app.py            Server starten (Standard: 127.0.0.1:8101)

Umgebung: ANII_REPO (Git-Klon, Standard: dieses Repository), ANII_ADMIN_CONF (Ordner für
Passwort und Sitzungen, Standard: ~/.config/anii-admin), ANII_ADMIN_PORT, ANII_PUSH=0 (nicht
pushen, zum Testen), ANII_SECURE_COOKIE=0 (Cookie auch ohne HTTPS, zum Testen).
"""
import datetime
import getpass
import hashlib
import hmac
import http.server
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get("ANII_REPO", HERE.parent)).resolve()
sys.path.insert(0, str(REPO / "tools"))
import anii  # noqa: E402
import build_data as bd  # noqa: E402

CONF = Path(os.environ.get("ANII_ADMIN_CONF", Path.home() / ".config" / "anii-admin"))
PORT = int(os.environ.get("ANII_ADMIN_PORT", "8101"))
PUSH = os.environ.get("ANII_PUSH", "1") == "1"
SECURE = os.environ.get("ANII_SECURE_COOKIE", "1") == "1"
STATIC = HERE / "static"
CSV_FILE = REPO / "data" / "vokabeln.csv"
SPK_FILE = REPO / "data" / "sprecher.csv"
AUDIO_DIR = REPO / "data" / "audio"
SPK_COLUMNS = ["kuerzel", "name", "ort", "zustimmung", "datum_zustimmung", "notiz"]
COOKIE = "anii_admin"
SESSION_DAYS = 60
MAX_BODY = 12 * 1024 * 1024
AUDIO_TYPES = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/opus": "opus", "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/wave": "wav", "video/webm": "webm",
}
LOCK = threading.Lock()  # eine Änderung nach der anderen (CSV + Git)
FAILS = []  # Zeitpunkte fehlgeschlagener Anmeldungen

bd.CSV_FILE = CSV_FILE
bd.AUDIO_DIR = AUDIO_DIR


# ------------------------------------------------------------------ Passwort und Sitzungen
def hash_pw(pw, salt=None, n=310_000):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), n)
    return f"pbkdf2_sha256${n}${salt}${dk.hex()}"


def check_pw(pw):
    try:
        _, n, salt, want = (CONF / "password").read_text().strip().split("$")
    except (OSError, ValueError):
        return False
    return hmac.compare_digest(hash_pw(pw, salt, int(n)).split("$")[3], want)


def _sessions():
    try:
        s = json.loads((CONF / "sessions.json").read_text())
    except (OSError, ValueError):
        s = {}
    now = time.time()
    return {k: v for k, v in s.items() if v > now}


def _save_sessions(s):
    CONF.mkdir(parents=True, exist_ok=True)
    p = CONF / "sessions.json"
    p.write_text(json.dumps(s))
    p.chmod(0o600)


def new_session():
    token = secrets.token_urlsafe(32)
    s = _sessions()
    s[hashlib.sha256(token.encode()).hexdigest()] = time.time() + SESSION_DAYS * 86400
    _save_sessions(s)
    return token


def valid_session(token):
    return bool(token) and hashlib.sha256(token.encode()).hexdigest() in _sessions()


def drop_session(token):
    s = _sessions()
    s.pop(hashlib.sha256((token or "").encode()).hexdigest(), None)
    _save_sessions(s)


# ------------------------------------------------------------------ Git
class GitError(Exception):
    pass


def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=90)
    if check and r.returncode:
        raise GitError((r.stderr or r.stdout).strip())
    return r.stdout.strip()


def sync():
    """Vor jeder Änderung den Stand von GitHub holen (z. B. Änderungen vom Laptop)."""
    if not PUSH:
        return
    try:
        git("pull", "-q", "--rebase", "origin", "main")
    except GitError as e:
        git("rebase", "--abort", check=False)
        raise GitError("Konnte den Stand von GitHub nicht holen: " + str(e)[:300])


def commit(message, paths):
    git("add", "--all", "--", *paths)
    if not git("status", "--porcelain", "--", *paths):
        return "keine Änderung"
    git("commit", "-q", "-m", message)
    return push()


def push():
    if not PUSH:
        return "nicht gepusht (Testmodus)"
    r = subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=REPO, capture_output=True, text=True, timeout=90)
    if r.returncode:
        return "Push fehlgeschlagen – wird beim nächsten Speichern erneut versucht: " + (r.stderr.strip()[:300] or "?")
    return "ok"


def unpushed():
    if not PUSH:
        return 0
    out = git("rev-list", "--count", "origin/main..HEAD", check=False)
    return int(out) if out.isdigit() else 0


# ------------------------------------------------------------------ Daten
def clean(v):
    v = re.sub(r"\s+", " ", anii.nfc(str(v or ""))).strip()
    return v


def load_vocab():
    report = bd.Report()
    header, rows, bom = bd.read_csv(CSV_FILE, report)
    if header is None:
        raise ValueError("vokabeln.csv lässt sich nicht lesen: " + "; ".join(m for _, _, m in report.items))
    header = list(header) + [c for c in bd.COLUMNS if c not in header]
    rows = [{c: (r.get(c) or "") for c in header} for r in rows]
    return header, rows, bom


def load_speakers():
    if not SPK_FILE.exists():
        return SPK_COLUMNS, [], False
    header, rows, bom = bd.read_csv(SPK_FILE, bd.Report())
    header = list(header or []) + [c for c in SPK_COLUMNS if c not in (header or [])]
    return header, [{c: (r.get(c) or "") for c in header} for r in rows], bom


def next_id(rows):
    # Höchste je vergebene Nummer (auch aus der Git-Geschichte nicht wiederverwenden: gelöschte merken)
    used = [int(r["id"][1:]) for r in rows if bd.ID_RE.match(r.get("id", ""))]
    deleted = CONF / "deleted-ids.txt"
    if deleted.exists():
        used += [int(x[1:]) for x in deleted.read_text().split() if bd.ID_RE.match(x)]
    return f"w{max(used, default=0) + 1:04d}"


def check_rows(header, rows, target_id):
    """Prüft alle Zeilen wie der Build und liefert die Meldungen zur Zielzeile."""
    report = bd.Report()
    copy = [dict(r) for r in rows]
    bd.validate(header, copy, report)
    line = next((i + 2 for i, r in enumerate(rows) if r.get("id") == target_id), None)
    out = []
    for level, where, msg in report.items:
        if where.startswith("Zeilen "):  # z. B. „Zeilen 4, 29“ (Homonyme)
            nums = [int(x) for x in re.findall(r"\d+", where)]
        else:
            m = re.match(r"Zeile (\d+)", where)
            nums = [int(m.group(1))] if m else []
        if line in nums and "„geprueft“ leer" not in msg:
            out.append({"level": level, "where": where, "msg": msg})
    return out


def entry_from(payload):
    e = {c: clean(payload.get(c, "")) for c in bd.COLUMNS}
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", e["datum"])
    if m:
        e["datum"] = f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    e["geprueft"] = "ja" if str(payload.get("geprueft", "")).lower() in ("ja", "true", "1", "on") else "nein"
    return e


def audio_files(entry_id):
    return [p for p in AUDIO_DIR.glob(entry_id + ".*") if p.suffix.lower() in bd.AUDIO_EXT] if AUDIO_DIR.exists() else []


# ------------------------------------------------------------------ Aktionen
def api_data():
    header, rows, _ = load_vocab()
    _, speakers, _ = load_speakers()
    lessons = sorted({r["lektion"] for r in rows if r["lektion"]}, key=bd.natural_key)
    for r in rows:
        files = audio_files(r["id"]) if not r["audio"] else ([AUDIO_DIR / r["audio"]] if (AUDIO_DIR / r["audio"]).exists() else [])
        r["_audio"] = files[0].name if files else ""
    rows.sort(key=lambda r: anii.sort_key(r["anii"]))
    head = git("log", "-1", "--format=%h · %s · %cr", check=False)
    return {"entries": rows, "lessons": lessons, "speakers": speakers, "next_id": next_id(rows),
            "head": head, "unpushed": unpushed(), "alphabet": anii.ALPHABET}


def api_check(p):
    header, rows, _ = load_vocab()
    e = entry_from(p.get("entry", {}))
    e["id"] = e["id"] or next_id(rows)
    rows = [r for r in rows if r["id"] != e["id"]] + [e]
    return {"messages": check_rows(header, rows, e["id"])}


def api_save(p):
    with LOCK:
        sync()
        header, rows, bom = load_vocab()
        e = entry_from(p.get("entry", {}))
        new = not e["id"]
        if new:
            e["id"] = next_id(rows)
        elif not any(r["id"] == e["id"] for r in rows):
            raise LookupError(f"ID {e['id']} gibt es nicht (mehr)")
        if not new:
            old = next(r for r in rows if r["id"] == e["id"])
            e["audio"] = old["audio"]  # Audio nur über die Audio-Funktionen ändern
            rows = [e if r["id"] == e["id"] else r for r in rows]
        else:
            rows.append(e)
        msgs = check_rows(header, rows, e["id"])
        if any(m["level"] == "FEHLER" for m in msgs):
            return 422, {"messages": msgs}
        bd.write_csv(CSV_FILE, header, rows, bom)
        status = commit(f"Editor: {e['anii']} ({e['id']}) {'neu' if new else 'geändert'}", ["data/vokabeln.csv"])
        return 200, {"id": e["id"], "messages": msgs, "push": status}


def api_delete(p):
    with LOCK:
        sync()
        header, rows, bom = load_vocab()
        eid = p.get("id", "")
        e = next((r for r in rows if r["id"] == eid), None)
        if not e:
            raise LookupError(f"ID {eid} gibt es nicht")
        rows = [r for r in rows if r["id"] != eid]
        bd.write_csv(CSV_FILE, header, rows, bom)
        for f in audio_files(eid) + ([AUDIO_DIR / e["audio"]] if e["audio"] else []):
            if f.exists():
                f.unlink()
        CONF.mkdir(parents=True, exist_ok=True)
        with open(CONF / "deleted-ids.txt", "a") as fh:
            fh.write(eid + "\n")
        status = commit(f"Editor: {e['anii']} ({eid}) gelöscht", ["data/vokabeln.csv", "data/audio"])
        return 200, {"push": status}


def api_audio(eid, speaker, ctype, body):
    ext = AUDIO_TYPES.get((ctype or "").split(";")[0].strip().lower())
    if not ext:
        raise ValueError(f"Audioformat „{ctype}“ wird nicht unterstützt (MP3, M4A, OGG/Opus, WebM, WAV)")
    if not body:
        raise ValueError("Leere Aufnahme")
    with LOCK:
        sync()
        header, rows, bom = load_vocab()
        e = next((r for r in rows if r["id"] == eid), None)
        if not e:
            raise LookupError(f"ID {eid} gibt es nicht")
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        for f in audio_files(eid) + ([AUDIO_DIR / e["audio"]] if e["audio"] else []):
            if f.exists():
                f.unlink()
        name = f"{eid}.{ext}"
        (AUDIO_DIR / name).write_bytes(body)
        e["audio"] = name
        if speaker:
            e["sprecher"] = clean(speaker)
        bd.write_csv(CSV_FILE, header, rows, bom)
        status = commit(f"Editor: Aufnahme für {e['anii']} ({eid})", ["data/vokabeln.csv", "data/audio"])
        return 200, {"audio": name, "push": status}


def api_audio_delete(p):
    with LOCK:
        sync()
        header, rows, bom = load_vocab()
        eid = p.get("id", "")
        e = next((r for r in rows if r["id"] == eid), None)
        if not e:
            raise LookupError(f"ID {eid} gibt es nicht")
        for f in audio_files(eid) + ([AUDIO_DIR / e["audio"]] if e["audio"] else []):
            if f.exists():
                f.unlink()
        e["audio"] = ""
        bd.write_csv(CSV_FILE, header, rows, bom)
        status = commit(f"Editor: Aufnahme für {e['anii']} ({eid}) entfernt", ["data/vokabeln.csv", "data/audio"])
        return 200, {"push": status}


def api_speaker(p):
    with LOCK:
        sync()
        header, rows, bom = load_speakers()
        s = {c: clean(p.get(c, "")) for c in SPK_COLUMNS}
        if not s["name"]:
            raise ValueError("Name fehlt")
        s["zustimmung"] = "ja" if s["zustimmung"].lower() in ("ja", "true", "1", "on") else "nein"
        if not s["kuerzel"]:
            nums = [int(r["kuerzel"][1:]) for r in rows if re.match(r"^S\d+$", r["kuerzel"])]
            s["kuerzel"] = f"S{max(nums, default=0) + 1:02d}"
            rows.append(s)
        else:
            if not any(r["kuerzel"] == s["kuerzel"] for r in rows):
                rows.append(s)
            rows = [s if r["kuerzel"] == s["kuerzel"] else r for r in rows]
        bd.write_csv(SPK_FILE, header, rows, bom)
        status = commit(f"Editor: Sprecher {s['kuerzel']}", ["data/sprecher.csv"])
        return 200, {"kuerzel": s["kuerzel"], "push": status}


def api_push():
    with LOCK:
        sync()
        return 200, {"push": push(), "unpushed": unpushed()}


# ------------------------------------------------------------------ HTTP
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "anii-admin"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def token(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return c[COOKIE].value if COOKIE in c else ""

    def send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def same_origin(self):
        origin = self.headers.get("Origin") or self.headers.get("Referer") or ""
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
        return bool(origin) and urlparse(origin).netloc == host

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/admin", "/admin/"):
            return self.file(STATIC / "index.html")
        if path.startswith("/admin/static/"):
            return self.file(STATIC / path[len("/admin/static/"):])
        if path == "/admin/api/me":
            return self.send(200, {"ok": valid_session(self.token()), "has_password": (CONF / "password").exists()})
        if not valid_session(self.token()):
            return self.send(401, {"error": "Bitte anmelden"})
        if path == "/admin/api/data":
            return self.guard(lambda: (200, api_data()))
        if path.startswith("/admin/audio/"):
            name = path[len("/admin/audio/"):]
            if re.match(r"^[\w.-]+$", name):
                return self.file(AUDIO_DIR / name)
        return self.send(404, {"error": "nicht gefunden"})

    do_HEAD = do_GET

    def file(self, p):
        try:
            p = p.resolve()
            if not (p.is_relative_to(STATIC) or p.is_relative_to(AUDIO_DIR)) or not p.is_file():
                raise FileNotFoundError
            data = p.read_bytes()
        except (OSError, ValueError):
            return self.send(404, {"error": "nicht gefunden"})
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send(200, data, ctype)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Datei zu groß (höchstens 12 MB)")
        return self.rfile.read(n) if n else b""

    def guard(self, fn):
        try:
            res = fn()
            code, payload = res if isinstance(res, tuple) else (200, res)
            return self.send(code, payload)
        except LookupError as e:
            return self.send(404, {"error": str(e)})
        except GitError as e:
            return self.send(409, {"error": str(e)})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001 – Fehler sichtbar machen statt abstürzen
            sys.stderr.write(f"Fehler: {e!r}\n")
            return self.send(500, {"error": "Interner Fehler: " + str(e)[:200]})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send(403, {"error": "fremde Herkunft"})
        if path == "/admin/api/login":
            return self.login()
        if not valid_session(self.token()):
            return self.send(401, {"error": "Bitte anmelden"})
        if path == "/admin/api/logout":
            drop_session(self.token())
            return self.send(200, {"ok": True}, headers={"Set-Cookie": self.cookie("", 0)})
        if path == "/admin/api/audio":
            q = parse_qs(urlparse(self.path).query)
            return self.guard(lambda: api_audio(q.get("id", [""])[0], q.get("speaker", [""])[0],
                                                self.headers.get("Content-Type"), self.body()))
        try:
            p = json.loads(self.body() or b"{}")
        except (ValueError, UnicodeDecodeError):
            return self.send(400, {"error": "ungültige Anfrage"})
        actions = {
            "/admin/api/check": lambda: (200, api_check(p)),
            "/admin/api/save": lambda: api_save(p),
            "/admin/api/delete": lambda: api_delete(p),
            "/admin/api/audio-delete": lambda: api_audio_delete(p),
            "/admin/api/speaker": lambda: api_speaker(p),
            "/admin/api/push": api_push,
        }
        if path in actions:
            return self.guard(actions[path])
        return self.send(404, {"error": "nicht gefunden"})

    def cookie(self, value, max_age):
        parts = [f"{COOKIE}={value}", "Path=/admin", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
        if SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def login(self):
        now = time.time()
        FAILS[:] = [t for t in FAILS if now - t < 600]
        if len(FAILS) >= 8:
            return self.send(429, {"error": "Zu viele Versuche – bitte in 10 Minuten noch einmal."})
        try:
            pw = json.loads(self.body() or b"{}").get("password", "")
        except ValueError:
            pw = ""
        if not check_pw(pw):
            FAILS.append(now)
            time.sleep(1)
            return self.send(401, {"error": "Falsches Passwort"})
        return self.send(200, {"ok": True}, headers={"Set-Cookie": self.cookie(new_session(), SESSION_DAYS * 86400)})


def set_password():
    pw = getpass.getpass("Neues Passwort: ")
    if len(pw) < 10:
        sys.exit("Bitte mindestens 10 Zeichen.")
    if pw != getpass.getpass("Noch einmal: "):
        sys.exit("Die Passwörter stimmen nicht überein.")
    CONF.mkdir(parents=True, exist_ok=True)
    (CONF / "password").write_text(hash_pw(pw) + "\n")
    (CONF / "password").chmod(0o600)
    _save_sessions({})  # alte Sitzungen abmelden
    print("Passwort gespeichert in", CONF / "password")


def main():
    if sys.argv[1:] == ["passwd"]:
        return set_password()
    mimetypes.add_type("audio/webm", ".webm")
    mimetypes.add_type("audio/ogg", ".opus")
    mimetypes.add_type("audio/mp4", ".m4a")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Anii-Editor auf http://127.0.0.1:{PORT}/admin/ (Repo {REPO}, Push {'an' if PUSH else 'aus'})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
