"""Gemeinsame Regeln für das Balanka-Anii: Alphabet, Sortierung, Such-Faltung, Zeichenprüfung.

Nur Python-Standardbibliothek. Wird von build_data.py und build_site.py benutzt.
"""
import re
import unicodedata

# Alphabet in Sortierreihenfolge (Vorgabe des Projekts). Digraphen zählen als ein Buchstabe.
ALPHABET = "a ǝ b c d e ɛ f g gb h i ɩ j k kp l m n ny ŋ ŋm o ɔ p r s t u ʊ w y".split()
DIGRAPHS = sorted((l for l in ALPHABET if len(l) > 1), key=len, reverse=True)

# Großbuchstaben, die Python nicht von selbst richtig bildet, sind hier ausdrücklich festgelegt.
UPPER = {"ǝ": "Ǝ", "ɛ": "Ɛ", "ɩ": "Ɩ", "ŋ": "Ŋ", "ɔ": "Ɔ", "ʊ": "Ʊ"}
LOWER = {v: k for k, v in UPPER.items()}


def upper_letter(letter):
    """Großform eines Buchstabens bzw. Digraphen (gb -> Gb)."""
    first = letter[0]
    return UPPER.get(first, first.upper()) + letter[1:]


def lower(text):
    # str.lower() macht aus Ǝ (U+018E) richtig ǝ (U+01DD); trotzdem ausdrücklich, damit es nachvollziehbar bleibt.
    return "".join(LOWER.get(ch, ch) for ch in text).lower()


# Kombinierende Zeichen, die im Anii-Text erlaubt sind (Töne, Nasalierung, Länge).
TONE_MARKS = {"̀", "́", "̂", "̃", "̄", "̌", "̈"}
ALLOWED_ANII = set("".join(ALPHABET)) | {upper_letter(l)[0] for l in ALPHABET} | set(" -'’.,;:!?()[]/…«»\"")

# Doppelgänger-Zeichen: falsches Zeichen -> (Vorschlag, Beschreibung)
LOOKALIKES = {
    "ə": ("ǝ", "ə (U+0259, Schwa) statt ǝ (U+01DD)"),
    "Ə": ("Ǝ", "Ə (U+018F) statt Ǝ (U+018E)"),
    "ι": ("ɩ", "griechisches ι (Iota) statt ɩ"),
    "Ι": ("Ɩ", "griechisches Ι (Iota) statt Ɩ"),
    "ɪ": ("ɩ", "ɪ (U+026A, IPA) statt ɩ"),
    "ı": ("ɩ", "ı (punktloses i) statt ɩ oder i"),
    "ε": ("ɛ", "griechisches ε (Epsilon) statt ɛ"),
    "ϵ": ("ɛ", "ϵ (U+03F5) statt ɛ"),
    "є": ("ɛ", "kyrillisches є statt ɛ"),
    "Є": ("Ɛ", "kyrillisches Є statt Ɛ"),
    "Ε": ("E", "griechisches Ε statt lateinischem E (oder Ɛ?)"),
    "ɷ": ("ʊ", "ɷ (U+0277) statt ʊ"),
    "υ": ("ʊ", "griechisches υ (Ypsilon) statt ʊ"),
    "Υ": ("Ʊ", "griechisches Υ statt Ʊ"),
    "ʋ": ("ʊ", "ʋ (U+028B, v mit Haken) statt ʊ"),
    "Ʋ": ("Ʊ", "Ʋ (U+01B2) statt Ʊ"),
    "℧": ("Ʊ", "℧ statt Ʊ"),
    "η": ("ŋ", "griechisches η (Eta) statt ŋ"),
    "ɲ": ("ŋ", "ɲ (U+0272) statt ŋ oder ny"),
    "ɔ": None,  # ɔ ist richtig (Platzhalter, damit die Tabelle vollständig lesbar ist)
    "ↄ": ("ɔ", "ↄ (U+2184) statt ɔ"),
    "Ↄ": ("Ɔ", "Ↄ (U+2183) statt Ɔ"),
    "ο": ("o", "griechisches ο statt o"),
    "Ο": ("O", "griechisches Ο statt O"),
    "ɑ": ("a", "ɑ (U+0251) statt a"),
    "а": ("a", "kyrillisches а statt a"),
    "е": ("e", "kyrillisches е statt e"),
    "о": ("o", "kyrillisches о statt o"),
    "р": ("p", "kyrillisches р statt p"),
    "с": ("c", "kyrillisches с statt c"),
    "у": ("y", "kyrillisches у statt y"),
    "і": ("i", "kyrillisches і statt i"),
    "ɡ": ("g", "ɡ (U+0261, IPA) statt g"),
    " ": (" ", "geschütztes Leerzeichen"),
}
LOOKALIKES = {k: v for k, v in LOOKALIKES.items() if v}
# Mehrdeutig: nur melden, nie automatisch ersetzen
AMBIGUOUS = {"ı", "Ε", "ɲ"}


def nfc(text):
    return unicodedata.normalize("NFC", text)


def strip_marks(text):
    """Entfernt kombinierende Zeichen (Töne usw.), lässt Basisbuchstaben stehen."""
    return unicodedata.normalize(
        "NFC", "".join(ch for ch in unicodedata.normalize("NFD", text) if not unicodedata.combining(ch))
    )


# Such-Faltung: „e“ findet auch „ɛ“ und „ǝ“. Muss zu fold() in site/assets/app.js passen.
FOLD = str.maketrans({"ǝ": "e", "ə": "e", "ɛ": "e", "ɔ": "o", "ɩ": "i", "ɪ": "i", "ʊ": "u", "ŋ": "n", "ɖ": "d",
                      "œ": "oe", "æ": "ae", "ß": "ss", "’": "'"})


def fold(text):
    return strip_marks(lower(text)).translate(FOLD)


def tokens(word):
    """Zerlegt ein Wort in Buchstaben des Alphabets (Digraphen gierig)."""
    w = strip_marks(lower(nfc(word)))
    out, i = [], 0
    while i < len(w):
        for d in DIGRAPHS:
            if w.startswith(d, i):
                out.append(d)
                i += len(d)
                break
        else:
            out.append(w[i])
            i += 1
    return out


_RANK = {l: i for i, l in enumerate(ALPHABET)}


def sort_key(word):
    """Primär nach Anii-Alphabet (Töne und Satzzeichen ignoriert), dann nach genauer Schreibung."""
    prim = []
    for t in tokens(word):
        if t in _RANK:
            prim.append((0, _RANK[t]))
        elif t.isalpha():
            prim.append((1, ord(t)))  # unbekannte Buchstaben ans Ende
        # Leerzeichen, Bindestriche, Apostrophe zählen nicht
    return (prim, nfc(word))


def first_letter(word):
    for t in tokens(word):
        if t in _RANK:
            return t
    return None


def check_chars(text, anii_field):
    """Liefert (zeichen, vorschlag, beschreibung) für verdächtige Zeichen."""
    found = []
    for ch in text:
        if ch in LOOKALIKES:
            sug, desc = LOOKALIKES[ch]
            found.append((ch, sug, desc))
    if anii_field:
        for ch in unicodedata.normalize("NFD", text):
            if ch in LOOKALIKES or ch in TONE_MARKS or ch in ALLOWED_ANII:
                continue
            if unicodedata.combining(ch):
                found.append((ch, None, f"unbekanntes kombinierendes Zeichen U+{ord(ch):04X}"))
            elif ch.isalpha():
                found.append((ch, None, f"Buchstabe „{ch}“ (U+{ord(ch):04X}) gehört nicht zum Alphabet"))
            elif not ch.isspace():
                found.append((ch, None, f"Zeichen „{ch}“ (U+{ord(ch):04X}) ungewöhnlich"))
    return found


def slug(text):
    s = strip_marks(lower(text)).translate(FOLD)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"
