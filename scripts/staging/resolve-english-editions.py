#!/usr/bin/env python3
"""Phase 2 staging resolver: does each award entry have an English edition?

Reads sources/international-awards.staging.json and writes
sources/international-awards.english-editions.json.

PIPELINE
  1. Google Books: all books by the entry's first author (cached per author).
  2. Filter to genuinely English volumes inside a plausible translation window.
     Google's `language` field mislabels some foreign editions as `en`, so titles
     are additionally sniffed for non-English orthography.
  3. Adjudicate: metadata alone cannot tell "the translation of THIS book" from
     "a different English book by the same author" -- descriptions carry no
     translation markers. A small model compares the original title against each
     surviving candidate and decides.

Steps 1-2 alone score 57% precision / 89% recall against the 23 hand-verified
cases in international-awards.verification-sample.json; step 3 is what makes the
output usable. Run --validate to re-measure against that ground truth.

Costs money (OpenAI). Guarded by --budget-usd, default 2.00.

Usage:
    python3 scripts/staging/resolve-english-editions.py --validate
    python3 scripts/staging/resolve-english-editions.py [--limit N] [--budget-usd 2]
"""
import json, os, re, sys, time, pathlib, unicodedata, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
STAGING = ROOT / "sources" / "international-awards.staging.json"
TRUTH = ROOT / "sources" / "international-awards.verification-sample.json"
GB_CACHE = ROOT / "data" / "cache" / "google-books-author-cache.json"
LLM_CACHE = ROOT / "data" / "cache" / "english-edition-adjudication.json"
OUT = ROOT / "sources" / "international-awards.english-editions.json"

WINDOW_BEFORE, WINDOW_AFTER = 1, 15

# USD per 1M tokens, August 2026. Keep in step with lib/llm-models.ts -- these drive
# the --budget-usd guard, so a stale entry silently under-reports spend.
PRICING = {
    "gpt-5.4-nano": (0.20, 1.25),
    "gpt-5.6-luna": (0.20, 1.20),
}
MODEL = "gpt-5.4-nano"
if "--model" in sys.argv:
    MODEL = sys.argv[sys.argv.index("--model") + 1]
if MODEL not in PRICING:
    raise SystemExit(f"No pricing recorded for {MODEL}; add it to PRICING.")
COST_IN, COST_OUT = (p / 1e6 for p in PRICING[MODEL])

def env(name):
    for line in (ROOT / ".env.local").read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get(name)

GB_KEY, OPENAI_KEY = env("GOOGLE_BOOKS_API_KEY"), env("OPENAI_API_KEY")
gb_cache = json.loads(GB_CACHE.read_text()) if GB_CACHE.exists() else {}
llm_cache = json.loads(LLM_CACHE.read_text()) if LLM_CACHE.exists() else {}
spend = [0.0]


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", (s or "").lower())).strip()


def looks_english(title):
    """Reject foreign-language titles that Google mislabels as English."""
    # Case-fold first: with re.IGNORECASE the dotless "ı" matches a plain "i",
    # which rejects almost every English title.
    t = (title or "").lower()
    if re.search(r"[ćčšžđłńśźżęąğıøæåõäöüßéèêàùâîôûñ]", t):
        return False
    stop = {"i", "u", "na", "za", "od", "je", "se", "og", "av", "til", "der", "die",
            "das", "und", "den", "det", "en", "et", "le", "la", "les", "de", "du",
            "el", "il", "en", "van", "het"}
    words = [w for w in re.findall(r"[a-z]+", t.lower()) if len(w) > 1]
    if len(words) >= 3 and sum(w in stop for w in words) / len(words) > 0.5:
        return False
    return True


def http_json(url, data=None, headers=None, tries=6):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, data=data,
                headers={"User-Agent": "book-prize-index/staging", **(headers or {})})
            return json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
        except Exception as e:
            code = getattr(e, "code", None)
            if attempt == tries - 1 or code in (400, 401, 403):
                raise
            # 429 is a quota window, not congestion: short retries just burn tries.
            time.sleep(30 * (attempt + 1) if code == 429 else 2 * (attempt + 1))


def gb_author(author):
    if author in gb_cache:
        return gb_cache[author]
    out, failed = [], False
    # Two passes. `langRestrict` is only a relevance bias, not a filter, but without
    # it a prolific author's 40 top hits are all original-language editions and the
    # translation never surfaces. The plain pass catches what the biased one misses.
    for restrict in ("en", None):
        try:
            p = {"q": f'inauthor:"{author}"', "key": GB_KEY, "maxResults": 40,
                 "printType": "books"}
            if restrict:
                p["langRestrict"] = restrict
            r = http_json("https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode(p))
            for i in r.get("items") or []:
                v = i["volumeInfo"]
                out.append({"title": v.get("title"), "subtitle": v.get("subtitle"),
                            "language": v.get("language"),
                            "date": (v.get("publishedDate") or "")[:4],
                            "publisher": v.get("publisher"),
                            "description": (v.get("description") or "")[:400],
                            "isbn13": next((x["identifier"] for x in v.get("industryIdentifiers") or []
                                            if x.get("type") == "ISBN_13"), None)})
        except Exception as e:
            failed = True
            print(f"  ! google books failed for {author!r}: {e}", file=sys.stderr)
        time.sleep(0.35)
    if failed:
        return out
    gb_cache[author] = out
    time.sleep(0.35)
    return out


def candidates_for(entry):
    author = (entry.get("authors") or [None])[0]
    if not author:
        return []
    year, orig = entry["year"], entry["originalTitle"]
    out = []
    for v in gb_author(author):
        if v.get("language") != "en" or not (v.get("date") or "").isdigit():
            continue
        y = int(v["date"])
        if not (year - WINDOW_BEFORE <= y <= year + WINDOW_AFTER):
            continue
        title = v["title"] or ""
        if norm(title) == norm(orig) or not looks_english(title):
            continue
        out.append({**v, "year": y})
    seen, uniq = set(), []
    for c in sorted(out, key=lambda c: abs(c["year"] - entry["year"])):
        k = norm(c["title"])
        if k in seen:
            continue
        seen.add(k); uniq.append(c)
    return uniq[:6]


SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "matchIndex": {"type": ["integer", "null"],
                       "description": "0-based index of the candidate that is an English translation of the original work, or null if none is."},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason": {"type": "string"},
    },
    "required": ["matchIndex", "confidence", "reason"],
}


def adjudicate(entry, cands):
    key = json.dumps([MODEL, entry["originalTitle"], entry.get("authors"), entry["year"],
                      [c["title"] for c in cands]], ensure_ascii=False, sort_keys=True)
    if key in llm_cache:
        return llm_cache[key]
    payload = {
        "originalTitle": entry["originalTitle"],
        "originalLanguage": entry.get("originalLanguage"),
        "author": (entry.get("authors") or [None])[0],
        "originalPublicationYear": entry["year"],
        "candidates": [{"index": i, "title": c["title"], "subtitle": c.get("subtitle"),
                        "year": c["year"], "publisher": c.get("publisher"),
                        "description": c.get("description")}
                       for i, c in enumerate(cands)],
    }
    body = json.dumps({
        "model": MODEL,
        "input": [
            {"role": "system", "content":
             "You identify which English book, if any, is the translation of a given "
             "foreign-language work. All candidates share the original's author, so a shared "
             "author is not evidence; judge by SUBJECT MATTER.\n"
             "Select a candidate when its title/subtitle/description describes the same book "
             "as the original -- this includes the common case where the English title is a "
             "direct rendering of the original ('Verdensteater. Kartenes historie' -> 'Theater "
             "of the World: The Maps that Made History'). A close subject correspondence IS a "
             "match; do not withhold one because the wording differs or you lack an explicit "
             "statement that it is a translation. Such statements are almost never present.\n"
             "Return null only when no candidate plausibly covers the original's subject -- "
             "for example when the author simply wrote a different English book."},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        "text": {"format": {"type": "json_schema", "name": "translation_match",
                            "strict": True, "schema": SCHEMA}},
    }).encode()
    r = http_json("https://api.openai.com/v1/responses", data=body,
                  headers={"Content-Type": "application/json",
                           "Authorization": f"Bearer {OPENAI_KEY}"})
    u = r.get("usage", {})
    spend[0] += u.get("input_tokens", 0) * COST_IN + u.get("output_tokens", 0) * COST_OUT
    text = ""
    for item in r.get("output", []):
        for c in item.get("content", []) or []:
            if c.get("type") == "output_text":
                text += c.get("text", "")
    verdict = json.loads(text)
    llm_cache[key] = verdict
    return verdict


def resolve(entry, budget):
    if entry.get("originalLanguage") == "en":
        return {"status": "native-english", "note": "English-language original."}
    cands = candidates_for(entry)
    if not cands:
        return {"status": "no-english-found", "candidates": []}
    if spend[0] >= budget:
        return {"status": "budget-exhausted", "candidates": cands[:3]}
    try:
        v = adjudicate(entry, cands)
    except Exception as e:
        # A transient network failure must not abandon the whole run; caches make
        # a re-run cheap, and this entry is retried then.
        print(f"  ! adjudication failed for {entry['originalTitle'][:40]!r}: {e}", file=sys.stderr)
        return {"status": "lookup-failed", "candidates": [c["title"] for c in cands[:3]]}
    idx = v.get("matchIndex")
    if idx is None or not (0 <= idx < len(cands)):
        return {"status": "no-english-found", "rejectedCandidates": [c["title"] for c in cands],
                "note": v.get("reason")}
    m = cands[idx]
    return {"status": "confirmed", "confidence": v.get("confidence"),
            "englishTitle": m["title"], "englishSubtitle": m.get("subtitle"),
            "englishYear": m["year"], "publisher": m.get("publisher"),
            "isbn13": m.get("isbn13"), "reason": v.get("reason")}


def save_caches():
    GB_CACHE.write_text(json.dumps(gb_cache, ensure_ascii=False))
    LLM_CACHE.write_text(json.dumps(llm_cache, ensure_ascii=False))


def validate(budget):
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))["results"]
    tp = fp = tn = fn = 0
    for r in truth:
        e = {"originalTitle": r["originalTitle"], "authors": [r["author"]],
             "year": r["year"], "originalLanguage": None}
        res = resolve(e, budget)
        pred = res["status"] == "confirmed"
        mark = {(1, 1): "TP", (0, 0): "TN", (1, 0): "FP", (0, 1): "FN"}[(int(pred), int(r["english"]))]
        tp += mark == "TP"; tn += mark == "TN"; fp += mark == "FP"; fn += mark == "FN"
        got = res.get("englishTitle", "-")
        print(f"  {mark}  {r['author'][:20]:22} {r['originalTitle'][:28]:30} -> {got[:38]}")
    save_caches()
    print(f"\n  TP={tp} FP={fp} TN={tn} FN={fn}")
    if tp + fp: print(f"  precision = {tp/(tp+fp):.0%}")
    if tp + fn: print(f"  recall    = {tp/(tp+fn):.0%}")
    print(f"  accuracy  = {(tp+tn)/len(truth):.0%}   spend=${spend[0]:.4f}")


def main():
    budget = float(sys.argv[sys.argv.index("--budget-usd") + 1]) if "--budget-usd" in sys.argv else 2.0
    if "--validate" in sys.argv:
        return validate(budget)

    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    doc = json.loads(STAGING.read_text(encoding="utf-8"))
    total = sum(len(a["entries"]) for a in doc["awards"]); done = 0
    for award in doc["awards"]:
        for e in award["entries"]:
            if limit is not None and done >= limit:
                break
            e["englishEdition"] = resolve(e, budget)
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{total}  spend=${spend[0]:.3f}", flush=True)
                save_caches()
    save_caches()

    doc["stage"] = "phase-2-english-edition-resolution"
    doc["resolutionMethod"] = {
        "providers": ["google-books", MODEL],
        "window": [WINDOW_BEFORE, WINDOW_AFTER],
        "validatedAgainst": "sources/international-awards.verification-sample.json",
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    hdr = f"{'award':38} {'n':>4} {'nativeEN':>9} {'confirmed':>10} {'none':>6} {'rate':>6}"
    print("\n" + hdr); print("-" * len(hdr))
    for a in doc["awards"]:
        es = [e for e in a["entries"] if "englishEdition" in e]
        if not es: continue
        c = lambda *s: sum(1 for e in es if e["englishEdition"]["status"] in s)
        nat, con = c("native-english"), c("confirmed")
        print(f"{a['id']:38} {len(es):>4} {nat:>9} {con:>10} {c('no-english-found'):>6} "
              f"{(nat+con)/len(es)*100:>5.0f}%")
    print(f"\nspend = ${spend[0]:.3f}")


if __name__ == "__main__":
    main()
