#!/usr/bin/env python3
"""Staging extractor for anglophone nonfiction prizes outside the US/UK/Canada.

These need no English-edition resolution -- the works are English originals -- so
the output feeds the importer directly.

Usage:
    python3 scripts/staging/extract-anglophone-awards.py [--fetch]
"""
import json, re, sys, pathlib, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "anglophone-awards-wikitext"
OUT = ROOT / "sources" / "anglophone-awards.staging.json"

SOURCES = {
    "nif": "Kamaladevi Chattopadhyay NIF Book Prize",
    "pmla": "Prime Minister's Literary Awards",
    "ockham": "Ockham New Zealand Book Awards",
    "paton": "Sunday Times CNA Literary Awards",
    "irish": "Irish Book Awards",
}


def fetch_all():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, title in SOURCES.items():
        url = ("https://en.wikipedia.org/w/index.php?title="
               + urllib.parse.quote(title.replace(" ", "_")) + "&action=raw")
        req = urllib.request.Request(url, headers={"User-Agent": "book-prize-index/staging"})
        text = urllib.request.urlopen(req, timeout=30).read().decode()
        (CACHE / f"{name}.wiki").write_text(text, encoding="utf-8")
        print(f"fetched {name:8} {len(text):>7} bytes")


if "--fetch" in sys.argv:
    fetch_all()

read = lambda n: (CACHE / f"{n}.wiki").read_text(encoding="utf-8")


# ---------- wikitext helpers ----------
def strip_refs(s):
    s = re.sub(r"<ref[^>]*/>", "", s)
    for _ in range(4):
        s = re.sub(r"<ref[^>]*?>.*?</ref>", "", s, flags=re.S)
    return s


def sortnames(s):
    """{{sortname|last=X|first=Y}} and {{sortname|1=A|2=B}} -> readable text."""
    def repl(m):
        parts = [p.strip() for p in m.group(1).split("|")]
        kv = dict(p.split("=", 1) for p in parts if "=" in p and not p.startswith("nolink"))
        if "first" in kv or "last" in kv:
            return f"{kv.get('first','')} {kv.get('last','')}".strip()
        if "1" in kv or "2" in kv:
            return f"{kv.get('1','')} {kv.get('2','')}".strip()
        pos = [p for p in parts if "=" not in p]
        return " ".join(pos[:2])
    return re.sub(r"\{\{[Ss]ortname\|([^}]*)\}\}", repl, s)


def links(s):
    s = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", s)
    return re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)


def clean(s):
    s = strip_refs(s or "")
    s = sortnames(s)
    s = re.sub(r"\[https?://[^\s\]]+ ([^\]]*)\]", r"\1", s)
    s = links(s)
    s = re.sub(r"\{\{[Ee]fn\|[^}]*\}\}", "", s)
    s = re.sub(r"\{\{[^}]*\}\}", "", s)
    s = re.sub(r"'''''|'''|''", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"&nbsp;", " ", s)
    # Stripped templates such as {{Blue ribbon}} leave empty parentheses behind.
    s = re.sub(r"\(\s*\)", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip().strip(",;.").strip()


def italics(s):
    return re.findall(r"''((?:[^']|'(?!'))+)''", s)


def people(s):
    out = []
    for p in re.split(r",| and | & ", s):
        p = clean(p)
        p = re.sub(r"\s*\((?:ed(?:itor)?s?\.?|illustrator|ill\.)\)\s*", "", p, flags=re.I)
        p = re.sub(r"^(?:with|and)\s+", "", p, flags=re.I)
        if p and len(p) < 60 and not re.match(r"^(ed|eds|editor|illustrated by)$", p, re.I):
            out.append(p)
    return out


def drop_year_cell(cells):
    """Remove a leading cell that is only a year (the rowspan year header)."""
    if cells and re.match(r"^\s*\d{4}\s*$", cells[0]):
        return cells[1:]
    return cells


def entry(year, status, title, authors, publisher=None):
    return {"year": year, "status": status, "originalTitle": title,
            "authors": authors, "originalLanguage": "en", "publisher": publisher}


def strip_row_attrs(row):
    """Drop attributes that follow "|-" on the row-start line."""
    first, sep, rest = row.partition("\n")
    return ("\n" + rest) if sep and "=" in first and "|" not in first else row


def section(text, start, end=None):
    seg = text[text.index(start):]
    if end and end in seg:
        seg = seg[: seg.index(end)]
    return seg


AWARDS = []


# ---------- 1. Kamaladevi Chattopadhyay NIF Book Prize (India) ----------
def nif():
    t = section(read("nif"), "== Recipients ==", "== References ==")
    out = []
    for row in re.split(r"\n\|-", t):
        ym = re.search(r"\n\|\s*(\d{4})\s*\n", row)
        if not ym:
            continue
        year = int(ym.group(1))
        cells = row[ym.end():]
        # Winner is the first cell; shortlist entries are the bullets that follow.
        winner_cell = cells.split("\n|")[0].lstrip("|").strip()
        it = italics(strip_refs(winner_cell))
        if it:
            title = clean(it[0])
            head = clean(winner_cell[: winner_cell.index(it[0]) - 2])
            pub = re.search(r"\(([^)]*)\)\s*$", clean(winner_cell))
            out.append(entry(year, "winner", title, people(head),
                             clean(re.sub(r"\s*\d{4}\s*$", "", pub.group(1))) if pub else None))
        for line in cells.split("\n"):
            if not line.startswith("*"):
                continue
            body = strip_refs(line[1:])
            it = italics(body)
            if not it:
                continue
            title = clean(it[0])
            head = clean(body[: body.index(it[0]) - 2])
            pub = re.search(r"\(([^)]*)\)\s*$", clean(body))
            if title:
                out.append(entry(year, "finalist", title, people(head),
                                 clean(pub.group(1)) if pub else None))
    return {"id": "kamaladevi-chattopadhyay-nif-book-prize",
            "name": "Kamaladevi Chattopadhyay NIF Book Prize",
            "organization": "New India Foundation", "geography": "India",
            "officialUrl": "https://www.newindiafoundation.org/nif-book-prize",
            "sourceUrl": "https://en.wikipedia.org/wiki/Kamaladevi_Chattopadhyay_NIF_Book_Prize",
            "category": "Nonfiction", "entries": out}


# ---------- 2. Prime Minister's Literary Awards (Australia) ----------
def pmla_category(heading, next_heading):
    t = section(read("pmla"), heading, next_heading)
    out, year = [], None
    for row in re.split(r"\n\|-", t):
        row = strip_row_attrs(row)
        ym = re.search(r"!\s*(?:rowspan=\"\d+\"\s*\|)?\s*(?:\[\[[^\]]*?\|)?(\d{4})\]?\]?", row)
        if ym:
            year = int(ym.group(1))
        if year is None:
            continue
        cells = [c for c in re.split(r"\n\|", row) if c.strip() and not c.strip().startswith("-")]
        # Drop the year header cell so author/title/result line up.
        cells = [c for c in cells if not c.strip().startswith("!")]
        cells = drop_year_cell([re.sub(r'^\s*(?:style|rowspan)="[^"]*"\s*\|', "", c) for c in cells])
        if len(cells) < 2:
            continue
        author = clean(cells[0])
        it = italics(strip_refs(cells[1]))
        title = clean(it[0]) if it else clean(cells[1])
        result = " ".join(clean(c) for c in cells[2:])
        status = "winner" if re.search(r"\bwinner\b", result, re.I) else "finalist"
        if not title or not author or len(title) < 3:
            continue
        out.append(entry(year, status, title, people(author)))
    return out


def pmla():
    return {"id": "australian-pm-literary-awards",
            "name": "Prime Minister's Literary Awards",
            "organization": "Australian Government", "geography": "Australia",
            "officialUrl": "https://www.arts.gov.au/pmla",
            "sourceUrl": "https://en.wikipedia.org/wiki/Prime_Minister%27s_Literary_Awards",
            "categories": [
                {"name": "Nonfiction",
                 "entries": pmla_category("=== Nonfiction ===", "=== Poetry ===")},
                {"name": "Australian History",
                 "entries": pmla_category("=== Australian history ===", "=== Children's fiction ===")},
            ]}


# ---------- 3. Ockham New Zealand Book Awards ----------
def ockham_category(heading, next_heading):
    t = section(read("ockham"), heading, next_heading)
    out = []
    for line in t.split("\n"):
        m = re.match(r"\*\s*(\d{4})\s*[–-]\s*(.*)$", strip_refs(line))
        if not m:
            continue
        year, body = int(m.group(1)), m.group(2)
        if re.search(r"no award", body, re.I):
            continue
        it = italics(body)
        if not it:
            continue
        title = clean(it[0])
        head = clean(body[: body.index(it[0]) - 2])
        tail = clean(body[body.index(it[0]) + len(it[0]):])
        pub = tail.lstrip(".").strip() or None
        if title and head:
            out.append(entry(year, "winner", title, people(head), pub))
    return out


def ockham():
    return {"id": "ockham-new-zealand-book-awards",
            "name": "Ockham New Zealand Book Awards",
            "organization": "New Zealand Book Awards Trust", "geography": "New Zealand",
            "officialUrl": "https://www.nzbookawards.nz/new-zealand-book-awards/",
            "sourceUrl": "https://en.wikipedia.org/wiki/Ockham_New_Zealand_Book_Awards",
            "categories": [
                {"name": "General Non-Fiction",
                 "entries": ockham_category("===General non-fiction award===",
                                            "===Best first book award (general non-fiction)===")},
                {"name": "Illustrated Non-Fiction",
                 "entries": ockham_category("===Illustrated non-fiction award===",
                                            "===Best first book award (illustrated non-fiction)===")},
            ]}


# ---------- 4. Alan Paton Award (South Africa) ----------
def paton():
    t = section(read("paton"), "== Non-fiction winners ==", "==References==")
    out, year = [], None
    for row in re.split(r"\n\|-", t):
        ym = (re.search(r"rowspan=\"\d+\"\s*\|\s*(\d{4})", row)
              or re.match(r"\s*\n\|\s*(\d{4})\s*\n", row))
        if ym:
            year = int(ym.group(1))
        if year is None:
            continue
        cells = [c for c in re.split(r"\n\|", row) if c.strip()]
        cells = [re.sub(r'^\s*(?:style|rowspan)="[^"]*"\s*\|', "", c) for c in cells]
        cells = drop_year_cell(cells)
        if len(cells) < 2:
            continue
        author = clean(cells[0])
        it = italics(strip_refs(cells[1]))
        title = clean(it[0]) if it else clean(cells[1])
        result = " ".join(clean(c) for c in cells[2:])
        if not author or not title or len(title) < 3 or author.isdigit():
            continue
        status = "winner" if re.search(r"\bwon\b|\bwinner\b", result, re.I) else "finalist"
        out.append(entry(year, status, title, people(author)))
    return {"id": "alan-paton-award", "name": "Alan Paton Award",
            "organization": "Sunday Times (South Africa)", "geography": "South Africa",
            "officialUrl": "https://www.timeslive.co.za/sunday-times/books/",
            "sourceUrl": "https://en.wikipedia.org/wiki/Sunday_Times_CNA_Literary_Awards",
            "category": "Nonfiction", "entries": out}


# ---------- 5. Irish Book Awards ----------
IRISH_CATEGORIES = re.compile(
    r"^(Non-?Fiction Book of the Year|Biography of the Year|Popular Non-?Fiction Book of the Year)$", re.I)


def irish():
    """Winners only. The awards run several nonfiction categories in parallel, so
    each is kept separate rather than collapsed into one list with two winners a year."""
    t = section(read("irish"), "==Winners==")
    buckets = {}
    year = None
    for block in re.split(r"\n===", t):
        ym = re.match(r"\s*(\d{4})\s*===", block)
        if ym:
            year = int(ym.group(1))
        if year is None:
            continue
        for row in re.split(r"\n\|-", block):
            cells = [c.strip() for c in re.split(r"\n\|", strip_refs(row)) if c.strip()]
            if len(cells) < 2:
                continue
            label = clean(cells[0])
            if not IRISH_CATEGORIES.match(label):
                continue
            body = cells[1]
            it = italics(body)
            if not it:
                continue
            title = clean(it[0])
            after = body[body.index(it[0]) + len(it[0]):]
            am = re.search(r"''\s*by\s+(.*)$", after)
            authors = people(clean(am.group(1))) if am else []
            if title and authors:
                key = re.sub(r"\s+", " ", label.title())
                buckets.setdefault(key, []).append(entry(year, "winner", title, authors))
    return {"id": "irish-book-awards", "name": "An Post Irish Book Awards",
            "organization": "An Post / Irish Book Awards", "geography": "Ireland",
            "officialUrl": "https://www.irishbookawards.ie/",
            "sourceUrl": "https://en.wikipedia.org/wiki/Irish_Book_Awards",
            "categories": [{"name": k, "entries": v} for k, v in sorted(buckets.items())]}


for fn in (nif, pmla, ockham, paton, irish):
    AWARDS.append(fn())

doc = {"schemaVersion": 1, "stage": "anglophone-extraction",
       "description": "Nonfiction prizes from anglophone countries outside the US/UK/Canada. "
                      "All works are English originals; no translation resolution needed.",
       "provenance": "English Wikipedia wikitext (action=raw), see each award's sourceUrl.",
       "awards": AWARDS}
OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"\n{'award':42} {'cat':26} {'n':>5} {'win':>4} {'fin':>4}  years")
total = 0
for a in AWARDS:
    cats = a.get("categories") or [{"name": a.get("category", "Nonfiction"), "entries": a["entries"]}]
    for c in cats:
        es = c["entries"]; total += len(es)
        if not es:
            print(f"{a['id']:42} {c['name']:26} {0:>5}  (no rows parsed)")
            continue
        ys = [e["year"] for e in es]
        w = sum(1 for e in es if e["status"] == "winner")
        print(f"{a['id']:42} {c['name']:26} {len(es):>5} {w:>4} {len(es)-w:>4}  {min(ys)}-{max(ys)}")
print(f"{'TOTAL':42} {'':26} {total:>5}")
