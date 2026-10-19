#!/usr/bin/env python3
"""Konten für den Vokabeltrainer von anii.lmbt.app (nur Python-Standardbibliothek + SQLite).

Freiwillig: Wer sich anmeldet, bekommt seinen Lernstand (Leitner-Fächer) auf dem Server
gespeichert und auf allen Geräten abgeglichen. Gespeichert werden nur Name, Passwort-Hash
und Lernstand – keine E-Mail, keine Telefonnummer.

    python3 learn/app.py                       Server starten (127.0.0.1:8102)
    python3 learn/app.py reset-password NAME   neues Passwort setzen (z. B. wenn vergessen)
    python3 learn/app.py delete NAME           Konto mit Lernstand löschen
    python3 learn/app.py list                  Konten anzeigen

Umgebung: ANII_LEARN_DB (Standard: ~/anii-data/learn.db), ANII_LEARN_PORT,
ANII_SECURE_COOKIE=0 (Cookie auch ohne HTTPS, zum Testen).
"""
import getpass
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import unicodedata
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlparse

DB = Path(os.environ.get("ANII_LEARN_DB", Path.home() / "anii-data" / "learn.db"))
PORT = int(os.environ.get("ANII_LEARN_PORT", "8102"))
SECURE = os.environ.get("ANII_SECURE_COOKIE", "1") == "1"
COOKIE = "anii_learn"
SESSION_DAYS = 365
MAX_BODY = 512 * 1024
MAX_CARDS = 20000
KEY_RE = re.compile(r"^w\d{4,}\|[ax]$")
LOCK = threading.Lock()
FAILS = {}  # (ip oder name) -> [Zeitpunkte]

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
  pw TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cards(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL,
  box INTEGER NOT NULL, due INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(user_id, key));
"""


def db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def init():
    with db() as con:
        con.executescript(SCHEMA)


def hash_pw(pw, salt=None, n=200_000):
    salt = salt or secrets.token_hex(16)
    return f"pbkdf2_sha256${n}${salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), n).hex()}"


def check_pw(pw, stored):
    try:
        _, n, salt, want = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_pw(pw, salt, int(n)).split("$")[3], want)


def name_key(name):
    return unicodedata.normalize("NFKC", name).casefold().strip()


def clean_name(name):
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(name or ""))).strip()
    if not 2 <= len(name) <= 30:
        raise ValueError("name")
    if any(unicodedata.category(c).startswith("C") for c in name):
        raise ValueError("name")
    return name


def tok_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


def new_session(con, uid):
    t = secrets.token_urlsafe(32)
    con.execute("INSERT INTO sessions VALUES(?,?,?)", (tok_hash(t), uid, int(time.time()) + SESSION_DAYS * 86400))
    con.execute("DELETE FROM sessions WHERE expires < ?", (int(time.time()),))
    return t


def user_for(con, token):
    if not token:
        return None
    return con.execute("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?",
                       (tok_hash(token), int(time.time()))).fetchone()


def throttled(*keys):
    now = time.time()
    for k in keys:
        FAILS[k] = [t for t in FAILS.get(k, []) if now - t < 900]
        if len(FAILS[k]) >= 10:
            return True
    return False


def fail(*keys):
    for k in keys:
        FAILS.setdefault(k, []).append(time.time())


def merge(con, uid, cards):
    """Pro Karte gewinnt der neuere Stand (updated in ms)."""
    if not isinstance(cards, dict) or len(cards) > MAX_CARDS:
        raise ValueError("cards")
    for k, v in cards.items():
        if not KEY_RE.match(k) or not isinstance(v, list) or len(v) < 3:
            continue
        try:
            box, due, upd = int(v[0]), int(v[1]), int(v[2])
        except (TypeError, ValueError):
            continue
        if not 0 <= box <= 5:
            continue
        con.execute("""INSERT INTO cards VALUES(?,?,?,?,?)
                       ON CONFLICT(user_id, key) DO UPDATE SET box=excluded.box, due=excluded.due, updated=excluded.updated
                       WHERE excluded.updated > cards.updated""", (uid, k, box, due, upd))
    return {k: [b, d, u] for k, b, d, u in con.execute("SELECT key, box, due, updated FROM cards WHERE user_id = ?", (uid,))}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "anii-learn"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s %s\n" % (self.command, self.path.split("?")[0], args[1] if len(args) > 1 else ""))

    def ip(self):
        return self.headers.get("CF-Connecting-IP") or self.headers.get("X-Real-IP") or self.client_address[0]

    def token(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return c[COOKIE].value if COOKIE in c else ""

    def cookie(self, value, max_age):
        parts = [f"{COOKIE}={value}", "Path=/api", "HttpOnly", "SameSite=Strict", f"Max-Age={max_age}"]
        if SECURE:
            parts.append("Secure")
        return "; ".join(parts)

    def send(self, code, body, headers=None):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def same_origin(self):
        origin = self.headers.get("Origin") or self.headers.get("Referer") or ""
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(":")[0]
        return bool(origin) and (urlparse(origin).hostname or "") == host

    def json_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("too_big")
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def do_GET(self):
        path = urlparse(self.path).path
        with db() as con:
            u = user_for(con, self.token())
            if path == "/api/me":
                return self.send(200, {"name": u[1]} if u else {"name": None})
            if path == "/api/progress":
                if not u:
                    return self.send(401, {"error": "login"})
                return self.send(200, {"cards": merge(con, u[0], {})})
        self.send(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send(403, {"error": "origin"})
        try:
            p = self.json_body()
        except (ValueError, UnicodeDecodeError):
            return self.send(400, {"error": "bad_request"})
        try:
            with LOCK, db() as con:
                return self.route(con, path, p)
        except ValueError as e:
            return self.send(400, {"error": str(e) or "bad_request"})

    def route(self, con, path, p):
        if path in ("/api/register", "/api/login"):
            name = clean_name(p.get("name"))
            pw = str(p.get("password") or "")
            key = name_key(name)
            if throttled(self.ip(), "n:" + key):
                return self.send(429, {"error": "too_many"})
            row = con.execute("SELECT id, name, pw FROM users WHERE name_key = ?", (key,)).fetchone()
            if path == "/api/register":
                if len(pw) < 6 or len(pw) > 200:
                    raise ValueError("password")
                if row:
                    fail(self.ip())
                    return self.send(409, {"error": "taken"})
                cur = con.execute("INSERT INTO users(name, name_key, pw, created) VALUES(?,?,?,?)", (name, key, hash_pw(pw), int(time.time())))
                uid = cur.lastrowid
            else:
                if not row or not check_pw(pw, row[2]):
                    fail(self.ip(), "n:" + key)
                    time.sleep(0.8)
                    return self.send(401, {"error": "wrong"})
                uid, name = row[0], row[1]
            cards = merge(con, uid, p.get("cards") or {})
            t = new_session(con, uid)
            return self.send(200, {"name": name, "cards": cards}, {"Set-Cookie": self.cookie(t, SESSION_DAYS * 86400)})

        u = user_for(con, self.token())
        if path == "/api/logout":
            con.execute("DELETE FROM sessions WHERE token = ?", (tok_hash(self.token() or "-"),))
            return self.send(200, {"ok": True}, {"Set-Cookie": self.cookie("", 0)})
        if not u:
            return self.send(401, {"error": "login"})
        if path == "/api/progress":
            return self.send(200, {"cards": merge(con, u[0], p.get("cards") or {})})
        if path == "/api/password":
            row = con.execute("SELECT pw FROM users WHERE id = ?", (u[0],)).fetchone()
            new = str(p.get("new") or "")
            if not check_pw(str(p.get("old") or ""), row[0]):
                return self.send(401, {"error": "wrong"})
            if len(new) < 6:
                raise ValueError("password")
            con.execute("UPDATE users SET pw = ? WHERE id = ?", (hash_pw(new), u[0]))
            return self.send(200, {"ok": True})
        if path == "/api/delete":
            row = con.execute("SELECT pw FROM users WHERE id = ?", (u[0],)).fetchone()
            if not check_pw(str(p.get("password") or ""), row[0]):
                return self.send(401, {"error": "wrong"})
            con.execute("DELETE FROM users WHERE id = ?", (u[0],))
            return self.send(200, {"ok": True}, {"Set-Cookie": self.cookie("", 0)})
        return self.send(404, {"error": "not_found"})


def cli(args):
    init()
    with db() as con:
        if args[0] == "list":
            for name, created, n in con.execute(
                    "SELECT u.name, u.created, COUNT(c.key) FROM users u LEFT JOIN cards c ON c.user_id = u.id GROUP BY u.id ORDER BY u.name"):
                print(f"{name:30} seit {time.strftime('%Y-%m-%d', time.localtime(created))}  {n} Karten")
            return
        row = con.execute("SELECT id FROM users WHERE name_key = ?", (name_key(args[1]),)).fetchone()
        if not row:
            sys.exit("Kein Konto mit diesem Namen.")
        if args[0] == "reset-password":
            pw = getpass.getpass("Neues Passwort: ")
            if len(pw) < 6:
                sys.exit("Mindestens 6 Zeichen.")
            con.execute("UPDATE users SET pw = ? WHERE id = ?", (hash_pw(pw), row[0]))
            con.execute("DELETE FROM sessions WHERE user_id = ?", (row[0],))
            print("Passwort geändert, alle Geräte abgemeldet.")
        elif args[0] == "delete":
            con.execute("DELETE FROM users WHERE id = ?", (row[0],))
            print("Konto gelöscht.")


def main():
    if sys.argv[1:2] and sys.argv[1] in ("list", "reset-password", "delete"):
        return cli(sys.argv[1:])
    init()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Anii-Konten auf http://127.0.0.1:{PORT}/api/ (Datenbank {DB})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
