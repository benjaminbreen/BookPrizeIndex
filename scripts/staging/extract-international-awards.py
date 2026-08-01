#!/usr/bin/env python3
"""Phase 1 staging extractor for candidate non-anglophone nonfiction awards.

Pulls winner/shortlist lists from Wikipedia wikitext and writes
sources/international-awards.staging.json.

This is a one-off research tool, NOT part of the build. Nothing here touches the
catalog, the schema, or the semantic index. Phase 2 (English-edition resolution)
reads the staging file; only awards that clear the English-edition bar would then
get a real importer under scripts/import-award-records/.

Usage:
    python3 scripts/staging/extract-international-awards.py            # use cache
    python3 scripts/staging/extract-international-awards.py --fetch    # refetch sources
"""
import re, json, sys, unicodedata, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "international-awards-wikitext"
OUT = ROOT / "sources" / "international-awards.staging.json"

SOURCES = {
    "leipzig-sach": ("de", "Preis der Leipziger Buchmesse/Sachbuch und Essayistik"),
    "sachbuchpreis": ("de", "Deutscher Sachbuchpreis"),
    "libris": ("nl", "Libris Geschiedenis Prijs"),
    "august": ("sv", "Augustpriset"),
    "august-nom": ("sv", "Lista \u00f6ver nominerade till Augustpriset i kategorin fackb\u00f6cker"),
    "kapuscinski": ("pl", "Nagroda im. Ryszarda Kapu\u015bci\u0144skiego"),
    "goncourt": ("fr", "Prix Goncourt de la biographie"),
    "brage": ("no", "Brageprisen"),
    "brage-nom": ("no", "Nominasjoner til Brageprisen"),
    "zayed": ("en", "Sheikh Zayed Book Award"),
    "strega": ("it", "Premio Strega"),
}

def fetch_all():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, (lang, title) in SOURCES.items():
        url = (f"https://{lang}.wikipedia.org/w/index.php?"
               f"title={urllib.parse.quote(title.replace(' ', '_'))}&action=raw")
        req = urllib.request.Request(url, headers={"User-Agent": "book-prize-index/staging"})
        text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        (CACHE / f"{name}.wiki").write_text(text, encoding="utf-8")
        print(f"fetched {name:16} {len(text):>7} bytes")

if "--fetch" in sys.argv:
    fetch_all()

# ---------- wikitext helpers ----------
def strip_refs(s):
    s = re.sub(r"<ref[^>]*/>", "", s)
    for _ in range(4):
        s = re.sub(r"<ref[^>]*?>.*?</ref>", "", s, flags=re.S)
    return s

def strip_small(s):
    return re.sub(r"</?small>", "", s)

def links(s):
    """[[A|B]] -> B, [[A]] -> A"""
    s = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    return s

def extlinks(s):
    return re.sub(r"\[https?://[^\s\]]+ ([^\]]*)\]", r"\1", s)

def clean(s):
    s = strip_refs(s)
    s = extlinks(s)
    s = links(s)
    s = strip_small(s)
    s = re.sub(r"'''''|'''|''", "", s)
    s = re.sub(r"&nbsp;", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().strip(",;").strip()

def disambig(name):
    """Drop trailing wikipedia disambiguators the link-resolver left behind."""
    return re.sub(r"\s*\((?:f[oö]rfattare|Autor|Journalistin|Journalist|dziennikarz|professor|ur\. \d+|écrivain|Biologe|roman|bok)\)\s*$", "", name).strip()

def italics(s):
    """Italic runs, tolerating apostrophes inside the title (l'Obstination)."""
    return re.findall(r"''((?:[^']|'(?!'))+)''", s)

HONORIFIC = re.compile(r"^(?:prof\.?|dr\.?|hab\.?|inż\.?|sir|dame|rev\.?|lord)\s+", re.I)


def people(s, sep=r",| och | og | et | i | und "):
    out = []
    for p in re.split(sep, s):
        p = disambig(clean(p))
        # Some source pages prefix academic honorifics ("prof. Arlie Hochschild"),
        # which otherwise fork an author into two catalog identities.
        while HONORIFIC.match(p):
            p = HONORIFIC.sub("", p, count=1).strip()
        p = re.sub(r"\s*\((red\.?|ill\.?)\)\s*", "", p).strip()
        if p and not re.match(r"^(med flera|m\.fl\.|red\.?)$", p, re.I):
            out.append(p)
    return out

def entry(year, status, title, authors, publisher=None, lang=None, **kw):
    e = {
        "year": year,
        "status": status,
        "originalTitle": title,
        "authors": authors,
        "originalLanguage": lang,
        "publisher": publisher,
    }
    e.update(kw)
    return e

def read(f):
    return (CACHE / f).read_text(encoding="utf-8")

AWARDS = []

# ---------- 1. Preis der Leipziger Buchmesse — Sachbuch/Essayistik ----------
def leipzig():
    t = read("leipzig-sach.wiki")
    t = t[t.index("== Preisträger =="):]
    t = t[:t.index("== Weblinks ==")] if "== Weblinks ==" in t else t
    rows = re.split(r"\n\|-", t)
    year, out = None, []
    for row in rows:
        raw = row
        m = re.search(r"!\s*rowspan=\"\d+\"\s*\|\s*(\d{4})", raw)
        if m:
            year = int(m.group(1))
        if year is None:
            continue
        win = "EEDD82" in raw
        pm = re.search(r"\{\{PersonZelle\|([^}]*)\}\}", raw)
        if not pm:
            continue
        parts = [p for p in pm.group(1).split("|") if "=" not in p]
        author = disambig(clean(" ".join(parts[:2])))
        # title cell = first italic run after the PersonZelle
        rest = raw[pm.end():]
        it = italics(strip_refs(rest))
        if not it:
            continue
        title = clean(it[0])
        pub = None
        cells = [c for c in rest.split("\n|") if c.strip()]
        if len(cells) >= 2:
            pub = clean(re.sub(r'^[^|]*\|', '', cells[1]) if "|" in cells[1] and "data-sort" in cells[1] or "style" in cells[1] else cells[1])
        out.append(entry(year, "winner" if win else "finalist", title, [author], pub, "de"))
    return {
        "id": "leipzig-book-fair-prize-nonfiction",
        "name": "Leipzig Book Fair Prize — Nonfiction/Essay",
        "originalName": "Preis der Leipziger Buchmesse — Sachbuch/Essayistik",
        "organization": "Leipziger Buchmesse",
        "geography": "Germany",
        "primaryLanguage": "de",
        "officialUrl": "https://www.preis-der-leipziger-buchmesse.de/",
        "sourceUrl": "https://de.wikipedia.org/wiki/Preis_der_Leipziger_Buchmesse/Sachbuch_und_Essayistik",
        "shortlistCoverage": "complete (5 nominees incl. winner per year)",
        "entries": out,
    }

# ---------- 2. Deutscher Sachbuchpreis ----------
def sachbuchpreis():
    t = read("sachbuchpreis.wiki")
    out = []
    blocks = re.split(r"\n===\s*Deutscher Sachbuchpreis (\d{4})\s*===", t)
    for i in range(1, len(blocks), 2):
        year = int(blocks[i])
        for line in blocks[i + 1].split("\n"):
            if not line.startswith("*"):
                continue
            win = "'''" in line
            # Winner lines wrap the whole entry in bold; drop bold markers so the
            # inner ''title'' stays detectable, then split "Author(s): Title (Publisher)".
            body = strip_refs(line)[1:].replace("'''", "")
            body = links(extlinks(body))
            pubm = re.search(r"\(([^()]*)\)\s*$", body)
            pub = pubm.group(1).split(",")[0].strip() if pubm else None
            if pubm:
                body = body[: pubm.start()]
            m = re.match(r"^\s*(.*?):\s*(.+)$", body)
            if not m:
                continue
            authors = people(m.group(1))
            title = clean(m.group(2))
            if not title or not authors:
                continue
            out.append(entry(year, "winner" if win else "finalist", title, authors, pub, "de"))
    return {
        "id": "deutscher-sachbuchpreis",
        "name": "German Nonfiction Prize",
        "originalName": "Deutscher Sachbuchpreis",
        "organization": "Stiftung Buchkultur und Leseförderung / Börsenverein des Deutschen Buchhandels",
        "geography": "Germany",
        "primaryLanguage": "de",
        "officialUrl": "https://www.deutscher-sachbuchpreis.de/",
        "sourceUrl": "https://de.wikipedia.org/wiki/Deutscher_Sachbuchpreis",
        "shortlistCoverage": "complete (8 nominees incl. winner per year)",
        "entries": out,
    }

# ---------- 3. Libris Geschiedenis Prijs ----------
def libris():
    t = read("libris.wiki")
    def table(start, end):
        seg = t[t.index(start):]
        if end and end in seg:
            seg = seg[: seg.index(end)]
        return seg
    def rows(seg, has_rowspan):
        out, year = [], None
        for line in seg.split("\n"):
            if not line.startswith("|") or line.startswith("|-") or line.startswith("|}"):
                continue
            cells = [c.strip() for c in re.split(r"\|\|", line.lstrip("|"))]
            if has_rowspan:
                m = re.match(r'\s*rowspan="\d+"\s*\|\s*(\d{4})', cells[0])
                if m:
                    year = int(m.group(1))
                    cells = cells[1:]
                elif re.match(r"^\d{4}$", cells[0].strip()):
                    year = int(cells[0].strip()); cells = cells[1:]
            else:
                if re.match(r"^\d{4}$", cells[0].strip()):
                    year = int(cells[0].strip()); cells = cells[1:]
                else:
                    continue
            cells = [c for c in cells if not re.match(r"^\{\{[A-Z]{2}-VLAG\}\}$", c.strip())]
            if len(cells) < 2 or year is None:
                continue
            title = clean(cells[0])
            authors = people(clean(cells[1]))
            isbn = None
            for c in cells[2:]:
                m = re.search(r"ISBN kort\|\s*(\d{9,13})", c)
                if m:
                    isbn = m.group(1); break
            if title:
                out.append((year, title, authors, isbn))
        return out
    wins = rows(table("==Winnaars==", "== Shortlist Nominaties =="), False)
    shorts = rows(table("== Shortlist Nominaties ==", "== Jury =="), True)
    winkeys = {(y, t.lower()) for y, t, a, i in wins}
    out = [entry(y, "winner", t, a, None, "nl", isbn13=i) for y, t, a, i in wins]
    for y, t, a, i in shorts:
        if (y, t.lower()) in winkeys:
            continue
        out.append(entry(y, "finalist", t, a, None, "nl", isbn13=i))
    out.sort(key=lambda e: (-e["year"], e["status"] != "winner", e["originalTitle"]))
    return {
        "id": "libris-geschiedenis-prijs",
        "name": "Libris History Prize",
        "originalName": "Libris Geschiedenis Prijs",
        "organization": "Libris / Historisch Nieuwsblad",
        "geography": "Netherlands",
        "primaryLanguage": "nl",
        "officialUrl": "https://www.librisgeschiedenisprijs.nl/",
        "sourceUrl": "https://nl.wikipedia.org/wiki/Libris_Geschiedenis_Prijs",
        "shortlistCoverage": "partial (shortlists documented for recent years only)",
        "entries": out,
    }

# ---------- 4. Augustpriset — Årets svenska fackbok ----------
def august():
    t = read("august.wiki")
    t = t[t.index("==Pristagare=="):t.index("==Bildgalleri==")]
    out, year = [], None
    for line in t.split("\n"):
        m = re.match(r";\s*(?:\{\{ar\|[Ll]itteratur\|(\d{4})\}\}|\[\[Litteratur[åa]ret (\d{4})[^\]]*\]\])", line)
        if m:
            year = int(m.group(1) or m.group(2)); continue
        if not re.match(r"^\*\s*Fackbok", line) or year is None:
            continue
        body = strip_refs(line)
        body = re.sub(r"^\*\s*Fackbok\s*:?\s*", "", body)
        it = italics(body)
        title = clean(it[0]) if it else None
        if not title:
            continue
        head = body[: body.index(it[0]) - 2]
        head = clean(head).rstrip(":,").strip()
        authors = people(head)
        pubm = re.search(r"\(([^)]*)\)\s*$", clean(body))
        pub = clean(pubm.group(1)) if pubm else None
        out.append(entry(year, "winner", title, authors, pub, "sv"))

    # Nominees live on a separate list article; winners are repeated there in bold.
    wkeys = {(e["year"], e["originalTitle"].lower()) for e in out}
    nt = read("august-nom.wiki")
    year = None
    for line in nt.split("\n"):
        m = re.match(r"==\s*(\d{4})\s*==", line.strip())
        if m:
            year = int(m.group(1)); continue
        if not line.startswith("*") or year is None:
            continue
        body = strip_refs(line)[1:].replace("'''", "")
        it = italics(body)
        if not it:
            continue
        title = clean(it[0])
        rest = body[body.index(it[0]) + len(it[0]):]
        # Two source formats: "''Title'' av Author, Publisher" (pre-2016) and
        # "''Title'', Author, Publisher" (2016 onward).
        tail = clean(re.sub(r"^''", "", rest)).lstrip(",").strip()
        # A handful of source rows have malformed bold, folding author+publisher
        # into the italic run; recover by re-splitting the title on " av ".
        if not tail and re.search(r"\bav\b.*,", title):
            title, tail = re.split(r"\s+av\s+", title, maxsplit=1)
            title, tail = clean(title), clean(tail)
        tail = re.sub(r"^(?:av|med|under redaktion av)\s+", "", tail)
        tail = re.sub(r"\s*som (huvud)?redakt[öo]r\s*", "", tail)
        tail = re.sub(r"\s*under redaktion av\s*", "", tail)
        authors, pub = [], None
        if tail:
            if "," in tail:
                head, pub = tail.rsplit(",", 1)
                pub = pub.strip() or None
            else:
                head = tail
            authors = people(head, sep=r",| och | med | & ")
        if not title or (year, title.lower()) in wkeys:
            continue
        out.append(entry(year, "finalist", title, authors, pub, "sv"))
    out.sort(key=lambda e: (-e["year"], e["status"] != "winner", e["originalTitle"]))
    return {
        "id": "augustpriset-fackbok",
        "name": "August Prize — Swedish Nonfiction Book of the Year",
        "originalName": "Augustpriset — Årets svenska fackbok",
        "organization": "Svenska Förläggareföreningen",
        "geography": "Sweden",
        "primaryLanguage": "sv",
        "officialUrl": "https://www.augustpriset.se/",
        "sourceUrl": "https://sv.wikipedia.org/wiki/Augustpriset",
        "shortlistCoverage": "complete from 1992 (separate Wikipedia nominees list)",
        "entries": out,
    }

# ---------- 5. Nagroda im. Ryszarda Kapuścińskiego ----------
PL_LANG = {
    "francuskiego": "fr", "rosyjskiego": "ru", "angielskiego": "en", "szwedzkiego": "sv",
    "niemieckiego": "de", "hiszpańskiego": "es", "włoskiego": "it", "niderlandzkiego": "nl",
    "norweskiego": "no", "duńskiego": "da", "portugalskiego": "pt", "czeskiego": "cs",
    "ukraińskiego": "uk", "białoruskiego": "be", "węgierskiego": "hu", "chorwackiego": "hr",
    "serbskiego": "sr", "słowackiego": "sk", "hebrajskiego": "he", "arabskiego": "ar",
    "chińskiego": "zh", "japońskiego": "ja", "tureckiego": "tr", "fińskiego": "fi",
    "rumuńskiego": "ro", "bułgarskiego": "bg", "greckiego": "el", "perskiego": "fa",
    "słoweńskiego": "sl", "litewskiego": "lt", "katalońskiego": "ca", "afrikaans": "af",
}

def kap_item(line, year, status):
    raw = strip_refs(line)
    native = None
    nm = re.search(r"<small>\s*\(''([^']+)''\)\s*</small>", raw)
    if nm:
        native = clean(nm.group(1))
        raw = raw[: nm.start()] + raw[nm.end():]
    lang = "pl"
    lm = re.search(r"prze[łl]\.(?: z j[ęe]z\.)? (\w+)", raw)
    if lm:
        lang = PL_LANG.get(lm.group(1).lower(), "und")
    translator = None
    tm = re.search(r"prze[łl]\.(?: z j[ęe]z\. \w+)? ([^,]+)", clean(raw))
    if tm:
        translator = tm.group(1).strip()
    body = re.sub(r"^\*+\s*", "", raw)
    body = re.sub(r"^Edycja [IVXLC]+ \(\d{4}\):\s*", "", body)
    body = extlinks(body)
    it = italics(body)
    if not it:
        return None
    title = clean(it[0])
    head = clean(body[: body.index(it[0]) - 2]).rstrip(",:").strip()
    authors = people(head)
    pubm = re.search(r"((?:Wydawnictwo|wyd\.|Wydawnictwa)\s+[^,<]+)\s*$", clean(body))
    pub = clean(pubm.group(1)) if pubm else None
    # The prize is awarded to reportage published IN POLISH, so `title` here is the
    # Polish edition's title. For a translated entry that is NOT the original title —
    # originalTitle must carry the work's own title (Blood River, not Rzeka krwi) or
    # nothing downstream will dedupe it against an existing catalog record.
    if lang == "pl":
        return entry(year, status, title, authors, pub, lang,
                     polishTitle=None, polishTranslator=None)
    return entry(year, status, native or title, authors, pub, lang,
                 polishTitle=title, polishTranslator=translator,
                 originalTitleUnresolved=native is None)

def kapuscinski():
    t = read("kapuscinski.wiki")
    out = []
    w = t[t.index("== Zdobywcy nagrody za najlepszy reportaż literacki =="):
          t.index("== Zdobywcy nagrody za najlepszy przekład")]
    year = None
    for line in w.split("\n"):
        m = re.match(r"\*\s*Edycja [IVXLC]+ \((\d{4})\)", line)
        if m:
            year = int(m.group(1))
            if "równorzędne" in line or "wyróżnienia" in line:
                continue
        if not line.startswith("*") or year is None:
            continue
        e = kap_item(line, year, "winner")
        if e:
            out.append(e)
    n = t[t.index("== Nominacje =="):t.index("== Jury ==")]
    year, status = None, "finalist"
    for line in n.split("\n"):
        m = re.match(r"'''Edycja [IVXLC]+ \((\d{4})\)'''", line.strip())
        if m:
            year = int(m.group(1)); status = "finalist"; continue
        if re.match(r"^\s*(finaliści|finalisci)", line):
            status = "finalist"; continue
        if re.match(r"^\s*pozostałe nominacje", line):
            status = "longlist"; continue
        if not line.startswith("*") or year is None:
            continue
        e = kap_item(line, year, status)
        if e:
            out.append(e)
    # Key on the Polish title: it is present for every entry and identical between
    # the winners section and the nominations section, whereas originalTitle now
    # varies depending on whether the source gave the native title.
    seen, dedup = set(), []
    for e in out:
        k = (e["year"], (e.get("polishTitle") or e["originalTitle"]).lower())
        if k in seen:
            continue
        seen.add(k); dedup.append(e)
    dedup.sort(key=lambda e: (-e["year"], {"winner": 0, "finalist": 1, "longlist": 2}[e["status"]]))
    return {
        "id": "ryszard-kapuscinski-award",
        "name": "Ryszard Kapuściński Award for Literary Reportage",
        "originalName": "Nagroda im. Ryszarda Kapuścińskiego za Reportaż Literacki",
        "organization": "City of Warsaw / Gazeta Wyborcza",
        "geography": "Poland",
        "primaryLanguage": "pl",
        "officialUrl": "https://kulturalna.um.warszawa.pl/kapuscinski",
        "sourceUrl": "https://pl.wikipedia.org/wiki/Nagroda_im._Ryszarda_Kapuścińskiego",
        "shortlistCoverage": "complete (finalists + wider nominations per year)",
        "note": "Eligibility is reportage PUBLISHED IN POLISH, including translations into Polish. "
                "Most entries are therefore not Polish-language originals; originalLanguage records "
                "the true source language and is 'pl' only for Polish originals.",
        "entries": dedup,
    }

# ---------- 6. Prix Goncourt de la biographie ----------
def goncourt():
    t = read("goncourt.wiki")
    t = t[t.index("== Liste des lauréats =="):t.index("== Notes et références ==")]
    out = []
    for line in t.split("\n"):
        m = re.match(r"\*\s*\[\[Prix littéraires (\d{4})[^\]]*\]\]\s*:\s*(.*)", strip_refs(line))
        if not m:
            continue
        year, body = int(m.group(1)), m.group(2)
        it = italics(body)
        if not it:
            continue
        title = clean(it[0])
        rest = body[body.index(it[0]) + len(it[0]):]
        am = re.search(r"''\s*(?:de|d[''’])\s*(.*)", rest)
        authors = people(clean(am.group(1)), sep=r", | et ") if am else []
        authors = [a for a in authors if a and not a.startswith("(")]
        out.append(entry(year, "winner", title, authors, None, "fr"))
    out.sort(key=lambda e: -e["year"])
    return {
        "id": "prix-goncourt-de-la-biographie",
        "name": "Goncourt Prize for Biography",
        "originalName": "Prix Goncourt de la biographie",
        "organization": "Académie Goncourt",
        "geography": "France",
        "primaryLanguage": "fr",
        "officialUrl": "https://www.academiegoncourt.com/",
        "sourceUrl": "https://fr.wikipedia.org/wiki/Prix_Goncourt_de_la_biographie",
        "shortlistCoverage": "none (winners only)",
        "entries": out,
    }

# ---------- 7. Brageprisen — faglitteratur/sakprosa ----------
def brage():
    t = read("brage.wiki")
    seg = t[t.index("===Faglitteratur/sakprosa==="):t.index("=== Sakprosa for barn og unge ===")]
    out = []
    for line in seg.split("\n"):
        m = re.match(r"\*\s*\[\[Litteratur[åa]ret (\d{4})[^\]]*\]\]\s*[–-]\s*(.*)", strip_refs(line))
        if not m:
            continue
        year, body = int(m.group(1)), m.group(2)
        sm = re.split(r",?\s*for\s+", body, maxsplit=1)
        if len(sm) < 2:
            continue
        head, tail = sm
        it = italics(tail)
        title = clean(it[0]) if it else clean(re.sub(r"^tegneserien\s+", "", tail))
        authors = people(clean(head), sep=r",| og |/")
        if title:
            out.append(entry(year, "winner", title, authors, None, "no"))

    # Nominees live on a separate article covering 2006-2015 only.
    wkeys = {(e["year"], e["originalTitle"].lower()) for e in out}
    wyears = {e["year"] for e in out if e["status"] == "winner"}
    nt = read("brage-nom.wiki")
    year, in_cat = None, False
    for line in nt.split("\n"):
        s = line.strip()
        m = re.match(r"==\s*(\d{4})\s*==\s*$", s)
        if m:
            year = int(m.group(1)); in_cat = False; continue
        m = re.match(r"===\s*(.+?)\s*===\s*$", s)
        if m:
            h = m.group(1)
            in_cat = bool(re.match(r"^(Sakprosa|Faglitteratur)$", h, re.I))
            continue
        if not in_cat or not s.startswith("*") or year is None:
            continue
        win = "'''" in s
        body = links(extlinks(strip_refs(s)[1:].replace("'''", "")))
        fm = re.search(r"\s+for\s+''(.+?)''\s*$", body)
        if fm:
            head, title, pub = body[: fm.start()], clean(fm.group(1)), None
        else:
            sm = re.match(r"^\s*(.*?)\s*[:;]\s*(.+)$", body)
            if not sm:
                continue
            head, tail = sm.group(1), clean(sm.group(2))
            if "," in tail:
                title, pub = [x.strip() for x in tail.rsplit(",", 1)]
            else:
                title, pub = tail, None
        title = clean(title)
        authors = people(clean(head), sep=r",| og |/")
        if not title or (year, title.lower()) in wkeys:
            continue
        # The nominee page repeats each winner in bold, often under a shortened
        # title that won't match wkeys — drop it rather than double-count.
        if win and year in wyears:
            continue
        out.append(entry(year, "winner" if win else "finalist", title, authors, pub, "no"))
    out.sort(key=lambda e: (-e["year"], e["status"] != "winner", e["originalTitle"]))
    return {
        "id": "brageprisen-sakprosa",
        "name": "Brage Prize — Nonfiction",
        "originalName": "Brageprisen — Faglitteratur/sakprosa",
        "organization": "Stiftelsen Den norske Bokprisen",
        "geography": "Norway",
        "primaryLanguage": "no",
        "officialUrl": "https://brageprisen.no/",
        "sourceUrl": "https://no.wikipedia.org/wiki/Brageprisen",
        "shortlistCoverage": "partial (nominees documented 2006-2015 only)",
        "entries": out,
    }

# ---------- 8. Sheikh Zayed Book Award (Arabic / international) ----------
# Only the reliably book-and-nonfiction categories. "Literature" mixes fiction in,
# "Translation" and "Editing of Arabic Manuscripts" honour editorial work rather than
# an original book, and "Cultural Personality of the Year" is a person, not a book.
ZAYED_CATEGORIES = {
    "arab culture in other languages": "en",
    "arabic culture in other languages": "en",
    "contribution to the development of nations": "ar",
    "literary and art criticism": "ar",
}


def zayed():
    t = read("zayed.wiki")
    t = t[t.index("==Winners=="):t.index("==References==")]
    out, year = [], None
    for line in t.split("\n"):
        m = re.match(r"'''(\d{4})'''", line.strip())
        if m:
            year = int(m.group(1))
            continue
        if not line.strip().startswith("*") or year is None:
            continue
        body = re.sub(r"<!--.*?-->", "", strip_refs(line.strip().lstrip("*").strip()))
        if ":" not in body:
            continue
        label, rest = body.split(":", 1)
        lang = ZAYED_CATEGORIES.get(clean(label).lower())
        if not lang:
            continue
        it = italics(rest)
        if not it:
            continue  # Many years name only a laureate, with no book title.
        title = clean(it[0])
        authors = people(clean(rest[: rest.index(it[0]) - 2]), sep=r",| and ")
        pubm = re.search(r"\(([^)]*)\)\s*$", clean(rest))
        pub = clean(re.sub(r",?\s*\d{4}\s*$", "", pubm.group(1))) if pubm else None
        if title and authors:
            out.append(entry(year, "winner", title, authors, pub, lang, category=clean(label)))
    return {
        "id": "sheikh-zayed-book-award",
        "name": "Sheikh Zayed Book Award",
        "originalName": "جائزة الشيخ زايد للكتاب",
        "organization": "Abu Dhabi Arabic Language Centre",
        "geography": "United Arab Emirates / International",
        "primaryLanguage": "ar",
        "officialUrl": "https://www.zayedaward.ae/en/",
        "sourceUrl": "https://en.wikipedia.org/wiki/Sheikh_Zayed_Book_Award",
        "shortlistCoverage": "none (winners only); many years name a laureate without a title",
        "note": "Only nonfiction book categories are imported. 'Arab Culture in Other Languages' "
                "honours works written in English, German or Chinese about Arab culture, so those "
                "entries are English originals rather than translations.",
        "entries": out,
    }


# ---------- 9. Premio Strega Saggistica (Italy) ----------
def strega():
    t = read("strega.wiki")
    t = t[t.index("== Premio Strega Saggistica =="):]
    if "== Note ==" in t:
        t = t[: t.index("== Note ==")]
    out = []
    for line in t.split("\n"):
        m = re.match(r"\*+\s*(?:(\d{4})|Internazionale)\s*-\s*(.*)$", strip_refs(line.strip()))
        if not m:
            continue
        body = m.group(2)
        it = italics(body)
        if not it:
            continue
        title = clean(it[0])
        head = clean(body[: body.index(it[0]) - 2]).rstrip(":").strip()
        pubm = re.search(r"\(([^)]*)\)\s*$", clean(body))
        international = m.group(1) is None
        year = int(m.group(1)) if m.group(1) else (out[-1]["year"] if out else None)
        if not year or not title:
            continue
        out.append(entry(year, "winner", title, people(head),
                         clean(pubm.group(1)) if pubm else None,
                         "und" if international else "it",
                         category="Internazionale" if international else "Saggistica"))
    return {
        "id": "premio-strega-saggistica",
        "name": "Strega Prize for Nonfiction",
        "originalName": "Premio Strega Saggistica",
        "organization": "Fondazione Maria e Goffredo Bellonci",
        "geography": "Italy",
        "primaryLanguage": "it",
        "officialUrl": "https://premiostrega.it/",
        "sourceUrl": "https://it.wikipedia.org/wiki/Premio_Strega",
        "shortlistCoverage": "none; the section launched in 2025 and has one edition",
        "note": "The Internazionale sub-prize honours a foreign work in Italian translation, so "
                "its original language is not Italian.",
        "entries": out,
    }


for fn in (leipzig, sachbuchpreis, libris, august, kapuscinski, goncourt, brage, zayed, strega):
    AWARDS.append(fn())

def norm(s):
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKD", s.lower()))

# Shortlists often repeat the winner under a shortened title ("De Zwijger" vs
# "De zwijger: Het leven van Willem van Oranje"). Drop a non-winner only when the
# same year + same author set + one title is a prefix of the other.
for a in AWARDS:
    wins = [e for e in a["entries"] if e["status"] == "winner"]
    keep = []
    for e in a["entries"]:
        if e["status"] != "winner":
            t = norm(e["originalTitle"])
            dup = any(
                w["year"] == e["year"]
                and [x.lower() for x in w["authors"]] == [x.lower() for x in e["authors"]]
                and (t.startswith(norm(w["originalTitle"])) or norm(w["originalTitle"]).startswith(t))
                for w in wins
            )
            if dup:
                continue
        keep.append(e)
    a["entries"] = keep

doc = {
    "schemaVersion": 1,
    "stage": "phase-1-raw-extraction",
    "description": "Raw award lists for candidate non-anglophone nonfiction prizes. "
                   "Not integrated into the catalog. English-edition resolution is phase 2.",
    "provenance": "Wikipedia wikitext (action=raw), see each award's sourceUrl.",
    "awards": AWARDS,
}
OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"{'award':38} {'entries':>7} {'win':>4} {'fin':>4} {'long':>5}  years")
total = 0
for a in AWARDS:
    es = a["entries"]; total += len(es)
    ys = [e["year"] for e in es]
    c = lambda s: sum(1 for e in es if e["status"] == s)
    print(f"{a['id']:38} {len(es):>7} {c('winner'):>4} {c('finalist'):>4} {c('longlist'):>5}  {min(ys)}–{max(ys)}")
print(f"{'TOTAL':38} {total:>7}")
