# Library of Congress Shelf — Implementation Plan

Status: implemented
Prepared: 2026-07-23
Feature owner: unassigned

## Decision

Build this as a source-backed bibliographic browsing feature in two product stages:

1. Launch a standalone `/fun/library-of-congress-shelf` experiment after the data pipeline, parser, and QA gates are met.
2. Reuse the same data and presentation component for an optional “On the shelf” expansion on book records and catalog rows.

The feature should simulate the experience of browsing the prize corpus in Library of Congress call-number order. It should not be described as a recommendation algorithm, as a replacement for the Book Prize Index subject taxonomy, or as an exact representation of the shelves in the Library of Congress or any local library.

Recommended public wording:

> A simulated shelf of prize-recognized books, ordered by cataloged Library of Congress call numbers. Call numbers are edition-level records; actual holdings and local shelving may differ.

## Why This Is Worth Building

The shelf creates a form of discovery that the existing keyword, semantic, subject, topic, award, and chronological views do not provide. It lets the cataloging system create adjacency: a reader begins with a known book, then samples the nearby books that the classification system places around it.

The feature is especially well matched to the project because it is:

- bibliographic rather than promotional;
- explainable and source-backed;
- useful to readers, researchers, and librarians;
- playful without being decorative;
- capable of surfacing unexpected books without pretending that an opaque model “recommends” them.

Its limitations are also intellectually useful. Sparse classes, uneven international coverage, and disagreements among edition records reveal properties of the source catalogs and the prize corpus. Those limitations should be reported rather than hidden.

## Terminology

Use these terms precisely in code, reports, and user-facing copy:

- **LCCN**: Library of Congress Control Number. This identifies a bibliographic or authority record. It is not a shelf-order key.
- **Library of Congress Classification (LCC)**: the classification system and its class numbers.
- **Classification number**: the subject-oriented portion of a call number, such as `E185.61`.
- **Book number / Cutter number**: the alphanumeric portion used to arrange works within a classification.
- **Call number**: the combined value, often including a date, such as `E185.61 .B7914 1988`.
- **Shelf order**: ordering produced by parsing and comparing the components of the call number according to LC filing and shelflisting rules.

The Library of Congress defines a call number as a classification number plus a book number, with a date normally present on modern monographs. Class letters, whole numbers, decimals, and Cutter numbers do not all sort the same way. See:

- [MARC 21 field 050](https://www.loc.gov/marc/bibliographic/concise/bd050.html)
- [Classification and Shelflisting Manual, G 55: Call Numbers](https://www.loc.gov/aba/publications/FreeCSM/G055.pdf)
- [Classification and Shelflisting Manual, F 60: Filing Rules](https://www.loc.gov/aba/publications/FreeCSM/F060.pdf)
- [Classification and Shelflisting Manual, G 65: Preferred Shelflist Order](https://www.loc.gov/aba/publications/FreeCSM/G065.pdf)
- [Library of Congress Classification outline](https://www.loc.gov/catdir/cpso/lcco/)

## Current Feasibility Baseline

The 2026-07-23 local catalog and cache audit found:

- 7,066 books in `data/cache/catalog.full.generated.json`;
- 4,696 books with at least one ISBN13;
- 21,395 cached Open Library edition rows across the ISBN discovery, summary, and imprint caches;
- 8,866 cached edition rows containing at least one `lc_classifications` value;
- 1,685 catalog books with LC classification evidence on an edition matching a known catalog ISBN;
- 2,634 catalog books with some LC classification evidence elsewhere in an Open Library work family linked through a known ISBN.

These are feasibility counts, not publishable coverage counts. They precede:

- normalization of cosmetic variants such as `HV6322.7.P69` versus `HV6322.7 .P69`;
- removal or downgrading of ebook, translation, reprint, and partial-classification variants;
- edition compatibility checks;
- resolution of materially different classifications within a work family;
- call-number parsing and sort validation;
- manual sampling.

The important conclusion is that the first implementation should be **cache-first**. It should not begin by issuing thousands of provider requests.

## Product Scope

### In scope for the first release

- One accepted LCC shelf placement per eligible book.
- A source and match method for every accepted placement.
- A parser and comparator for supported monograph call numbers.
- A generated, compact, globally sorted shelf artifact.
- A standalone shelf experiment with search, class navigation, keyboard navigation, deep links, and book-record links.
- A reusable neighborhood component showing the selected book and up to three books on either side.
- Coverage, conflict, parse-failure, and review reports.
- Clear disclosure of incomplete and edition-dependent coverage.

### In scope after the standalone shelf is validated

- “On the shelf” in the book drawer and full book detail page.
- An explicit row-expansion control in the desktop catalog table.
- A corresponding expansion control in mobile book cards.
- Class-level browse links from the shelf and book records.

### Not in scope

- Inventing or predicting call numbers with an LLM.
- Assigning a classification from the project’s own subjects or topics.
- Presenting an LCCN as a call number.
- Mixing Dewey Decimal and LCC values into one ordering.
- Claiming that the result reproduces the physical order of a particular library.
- Replacing the project’s curated primary subjects with LCC.
- Scraping Classification Web or any subscription catalog.
- Rendering all classified books in the DOM simultaneously.
- Adding analytics or tracking for this feature. The current privacy policy says the site does not retain analytics; evaluation should use QA reports, direct feedback, and voluntary usability testing.

## Source Policy

### Source priority

Use the following source order:

1. **Manual source-backed correction** in `sources/curation.json`.
2. **Library of Congress catalog record**, retrieved through the public SRU/Z39.50 catalog service and matched by exact ISBN or a reviewed bibliographic identity.
3. **Open Library exact edition**, matched by an ISBN already accepted for the Book Prize Index record.
4. **Open Library work-family consensus**, only under the conservative rules below.
5. **Review queue**, rather than an automatic placement, for all ambiguous title/author or materially conflicting work-family results.

The ordinary `loc.gov` JSON API is not a complete interface to the current library catalog. The Library of Congress directs catalog use cases to its SRU/Z39.50 services:

- [Library of Congress SRU overview](https://www.loc.gov/apis/additional-apis/search-retrieval-via-url/)
- [Library catalog keyword indexes, including ISBN](https://catalog.loc.gov/vwebv/ui/en_US/htdocs/help/index_keyword.html)

Open Library is appropriate for the cache-first pass and for human-facing, mission-aligned discovery, but its current guidance asks bulk users to use dumps or cached/batched access rather than hundreds of individual API calls:

- [Open Library API usage guidance](https://openlibrary.org/developers/api)
- [Open Library Search API](https://openlibrary.org/dev/docs/api/search)
- [Open Library edition JSON example with `lc_classifications`](https://openlibrary.org/dev/docs/json_api)

### Provenance requirements

Every accepted placement must retain:

- provider;
- provider record or edition URL;
- accessed date;
- raw call-number string;
- normalized display call number;
- matched ISBN, when applicable;
- Open Library edition/work identifier or Library of Congress record identifier;
- match method;
- assignment authority when available (`LC`, another cataloging agency, or unknown);
- confidence;
- source ID connected to the book record.

The public UI may show only the selected call number, confidence language, and source link. Alternative evidence belongs in the on-demand book detail artifact and review reports, not the compact shared catalog.

## Proposed Public Data Model

Add an optional field to `Book` in `lib/types.ts`:

```ts
export type LibraryShelfPlacement = {
  scheme: "lcc";
  callNumber: string;
  rawCallNumber: string;
  mainClass: string;
  subclass: string;
  completeness: "full_call_number" | "classification_only";
  confidence: "high" | "medium";
  matchedBy:
    | "manual"
    | "loc_exact_isbn"
    | "open_library_exact_isbn"
    | "open_library_work_consensus";
  sourceId: string;
  sourceEditionId?: string;
  sourceWorkId?: string;
  sourceIsbn13?: string;
  sort: LibraryCallNumberSortParts;
};

export type LibraryCallNumberSortParts = {
  classLetters: string;
  classWholeNumber: number;
  classDecimalDigits?: string;
  cutters: Array<{
    letters: string;
    decimalDigits: string;
  }>;
  year?: number;
  suffix?: string;
  trailingTokens?: string[];
};
```

Then add:

```ts
libraryShelf?: LibraryShelfPlacement;
```

to `Book`.

Design constraints:

- Keep the verbatim provider value as `rawCallNumber`.
- Keep a canonical human-readable value as `callNumber`.
- Use structured sort parts and a comparator. Do not rely on naïve string sorting or a JavaScript floating-point representation of decimal/Cutter digits.
- Do not put all alternative provider candidates into `Book`.
- Do not expose low-confidence placements through the public type.

## Generated and Cached Files

Keep this workflow separate from generic book enrichment:

- `sources/enrichment/library-classifications.generated.json`
  - accepted generated `Book.libraryShelf` patches;
  - source records for accepted placements;
  - committed durable generated enrichment.
- `data/cache/library-classification-provider-cache.json`
  - additional provider responses;
  - gitignored and safe to regenerate.
- `data/cache/library-classification-attempts.json`
  - input signatures and terminal results;
  - prevents repeated misses and ambiguous cases.
- `data/reports/library-classification-report.json`
  - compact run summary and a bounded set of examples.
- `data/reports/library-classification-review.json`
  - unresolved candidates requiring review.
- `data/reports/library-classification-quality-report.json`
  - coverage, parser, conflict, and source-distribution metrics.
- `data/reports/ci-artifacts/library-classification-rows.json`
  - full row-level QA when needed;
  - gitignored under the existing CI-artifact policy.
- `data/public/library-shelf.json`
  - compact app-consumed shelf artifact generated by `data:build`.

Manual one-off corrections should remain in `sources/curation.json`. Do not hand-edit the generated enrichment file.

## Work Package 1: Cache-First Evidence Extraction

Create `scripts/enrich-library-classifications.ts` with separate cache-only and network-enabled modes.

Recommended commands:

```json
{
  "library-shelf:extract": "tsx scripts/enrich-library-classifications.ts --cache-only",
  "library-shelf:enrich": "tsx scripts/enrich-library-classifications.ts",
  "data:library-shelf": "npm run data:build && npm run library-shelf:extract && npm run data:build"
}
```

The exact script names may change during implementation, but the cache-only mode must remain explicit.

### Cache inputs

Read, without modifying:

- `data/cache/isbn-discovery-cache.json`;
- `data/cache/summary-enrichment-provider-cache.json`;
- `data/cache/imprint-edition-provider-cache.json`;
- accepted catalog ISBNs and publication years from `data/cache/catalog.full.generated.json`;
- existing ISBN discovery reports/attempts when they contain a selected Open Library edition or work ID.

### Extraction rules

For each book:

1. Normalize and validate every catalog ISBN.
2. Find cached Open Library editions with an exact ISBN match.
3. Find the matched Open Library work family only when at least one edition in the family has an exact ISBN connection to the book.
4. Collect nonempty `lc_classifications` values with edition metadata:
   - ISBNs;
   - language;
   - physical format;
   - publication date;
   - publisher;
   - edition and work keys.
5. Retain raw evidence before any selection.
6. Record an input signature based on normalized title, authors, accepted ISBNs, publication year, and relevant work/edition IDs.
7. Skip unchanged terminal attempts unless `--retry-failures` is supplied.

### Disqualifying evidence

Do not automatically select a call number from an edition that is clearly:

- an ebook when print alternatives exist;
- an audiobook;
- large print;
- a translation inconsistent with the book record;
- an excerpt or adaptation;
- a school/library binding when a normal trade edition exists;
- an implausibly late reprint with a materially different classification;
- a different title/author work connected through a contaminated ISBN record.

The existing ISBN discovery filtering code should be factored into shared helpers where practical instead of reimplemented inconsistently.

## Work Package 2: Call-Number Parser and Comparator

Create `lib/library-call-number.ts` and `lib/library-call-number.test.ts`.

The module should export:

```ts
parseLibraryCallNumber(raw: string): ParseResult;
normalizeLibraryCallNumber(raw: string): string;
compareLibraryCallNumbers(a: LibraryCallNumberSortParts, b: LibraryCallNumberSortParts): number;
mainClassForCallNumber(parts: LibraryCallNumberSortParts): string;
subclassForCallNumber(parts: LibraryCallNumberSortParts): string;
```

### Normalization

Normalization should:

- apply Unicode normalization;
- trim and collapse whitespace;
- uppercase class and Cutter letters;
- normalize spacing around periods without altering semantic components;
- retain the provider value unchanged in `rawCallNumber`;
- identify electronic-resource and copy suffixes;
- remove only explicitly understood non-shelving annotations from the sort representation;
- reject empty strings and obvious non-LCC identifiers.

Do not “repair” a malformed call number by guessing missing letters or numbers.

### Parsing

Support the monograph patterns observed in the current caches:

- one to three class letters;
- a whole classification number;
- an optional decimal extension;
- zero or more Cutter segments;
- an optional four-digit date;
- an optional date suffix;
- explicitly retained unparsed trailing tokens.

Treat a value such as `QH361` as a valid `classification_only` placement, not as a full call number. It can appear in coverage reporting and a future approximate view, but it should not be mixed into the default exact shelf at launch.

### Sorting

The comparator must follow component semantics:

1. class letters alphabetically;
2. whole class number numerically;
3. class decimal as a decimal digit sequence;
4. Cutter letter portion alphabetically;
5. Cutter digits as a decimal digit sequence, not an integer;
6. additional Cutters in sequence;
7. date numerically;
8. supported suffix filing order;
9. stable fallback by ASCII-normalized author filing key, title filing key, publication year, and book ID.

Do not use an environment-dependent locale collation for the final fallback. Generate stable filing keys during the build.

For example, the official G 55 sequence includes:

```text
TH1
TH17
TH149
TH915
TH1096
TH7414
```

and:

```text
QA76.64
QA76.642
QA76.65
```

These and additional official/manual examples should become fixtures.

### Required parser tests

- Official G 55 whole-number ordering.
- Official G 55 decimal ordering.
- One and multiple Cutter segments.
- Cutter decimal behavior.
- Dates and date suffixes.
- Cosmetic spacing equivalence.
- Upper/lower-case equivalence.
- `eb` and understood electronic suffix handling.
- Partial classification values.
- Unsupported or malformed input.
- Stable fallback when two books share a call number.
- Local regression fixtures drawn from every distinct pattern in the current caches.

The parser should report unsupported patterns rather than silently sorting them incorrectly.

## Work Package 3: Candidate Selection and Confidence

Selection must happen after cosmetic normalization collapses equivalent strings.

### High confidence

Publish as high confidence when one of these is true:

- a reviewed manual correction supplies the placement and source;
- an exact catalog ISBN matches a compatible print edition with one parseable full call number;
- exact-ISBN candidates collapse to the same normalized full call number after cosmetic and electronic-suffix normalization;
- an exact ISBN matches a Library of Congress MARC record with an LC-assigned `050` call number and compatible title/author/year.

### Medium confidence

Publish as medium confidence only when:

- no high-confidence exact-edition result exists;
- the book-to-work identity is strong;
- at least two plausible English print editions agree on the same normalized full call number, or differ only by an edition date while retaining the same classification and Cutter structure;
- no plausible edition places the work in a materially different class/subclass;
- the selected representative is compatible with the project’s publication-year and edition policy;
- the parser fully understands the selected value.

An agency-assigned rather than LC-assigned MARC `050` may also be medium confidence when identity and compatibility checks pass.

### Review, not publication

Queue the book when:

- exact-edition candidates disagree beyond cosmetic differences;
- work-family candidates span different subclasses or materially different classification numbers;
- only a partial classification exists;
- only a title/author heuristic connects the catalog book to the provider work;
- the call number parses only partially;
- language, format, authorship, or year conflicts with the catalog;
- a duplicate/wrong-edition/wrong-work problem is discovered.

### Rejected

Reject:

- LCCNs presented in place of call numbers;
- Dewey or other classification schemes in the LCC field;
- empty or placeholder values;
- known ebook-only shelf strings when a print placement cannot be established;
- evidence from a mismatched work.

### Candidate scoring

Use hard gates before scores. A score must never override an identity or edition conflict.

Within the eligible set, ranking may consider:

- exact accepted ISBN;
- LC-assigned versus other-agency assignment;
- title/author match;
- English language;
- print/trade format;
- compatible publication year;
- agreement across records;
- completeness of call number;
- absence of electronic/reprint warnings.

Record reasons and warnings in reports as the existing ISBN enrichment workflow does.

## Work Package 4: Network Backfill

Run network backfill only after the cache-first report is reviewed.

Order:

1. Exact ISBN queries against the Library of Congress SRU catalog, requesting MARCXML or MODS with enough data to recover identity and field `050`.
2. Batched or narrowly scoped Open Library requests for books whose accepted ISBN has no cached edition response.
3. Open Library dump processing if the remaining coverage gain justifies it and disk space is available.
4. Conservative title/author investigation for review only.

Requirements:

- identify the application in provider requests;
- use request delay, bounded concurrency, checkpointing, retry status, and persistent cache conventions already used elsewhere;
- allow `--cache-only`, `--limit`, `--book-ids`, `--retry-failures`, `--request-delay-ms`, `--concurrency`, and `--checkpoint-every`;
- never use provider APIs at page-request time;
- never make the public feature depend on an external catalog being online.

The first network run should be a pilot of at most 100 high-value missing books. Inspect yield and conflicts before increasing the limit.

## Work Package 5: QA and Review Reports

### Compact summary metrics

The quality report should include:

- total catalog books;
- books with ISBNs;
- books considered;
- accepted high-confidence placements;
- accepted medium-confidence placements;
- exact-ISBN placements;
- work-consensus placements;
- manual placements;
- LC catalog versus Open Library sources;
- classification-only evidence;
- parse failures;
- materially conflicting candidates;
- rejected candidates;
- not found;
- coverage by main LCC class;
- coverage by project primary subject;
- coverage by publication decade;
- coverage by award region;
- coverage by recognition score/lane;
- count of books with at least three neighbors on each side in the same subclass;
- count of books with at least three neighbors on each side in the same main class.

### Review queue fields

Each review row should show:

- Book Prize Index ID, title, authors, year, ISBNs, and subjects;
- match method and provider work/edition;
- all candidate raw and normalized call numbers;
- candidate edition metadata;
- parsed components;
- reasons and warnings;
- whether disagreement is cosmetic, edition-date-only, Cutter-level, subclass-level, or main-class-level;
- direct provider links;
- suggested curation action.

### Automated quality checks

Fail the shelf artifact build when:

- a public placement has low confidence;
- a public placement lacks a source;
- a public placement cannot be parsed completely;
- two shelf rows use the same book ID;
- the generated rows are not in comparator order;
- `mainClass` or `subclass` disagrees with parsed parts;
- a neighbor references a missing row;
- a classification-only placement enters the exact shelf;
- the artifact generation is nondeterministic for unchanged inputs.

### Manual audit

Before public release, review at least 100 accepted rows, stratified across:

- high and medium confidence;
- exact ISBN and work consensus;
- common and sparse LCC classes;
- pre-1950, 1950–1999, and 2000-present books;
- US and international awards;
- books with several edition candidates;
- books whose project subject and LCC class appear surprising.

Acceptance target:

- at least 95% correct book/provider identity in the audit;
- at least 95% correct selected display call number relative to the documented policy;
- 100% correct relative shelf order for the audited neighboring sequences;
- zero known materially conflicting low-confidence placements in the public artifact.

Do not launch merely because a coverage percentage is high.

## Work Package 6: Public Shelf Artifact

Generate `data/public/library-shelf.json` during `npm run data:build`.

Suggested shape:

```ts
export type LibraryShelfArtifact = {
  generatedAt: string;
  policyVersion: number;
  stats: {
    catalogBooks: number;
    shelfBooks: number;
    highConfidence: number;
    mediumConfidence: number;
  };
  classes: Array<{
    code: string;
    label: string;
    count: number;
    startIndex: number;
    endIndex: number;
  }>;
  rows: LibraryShelfRow[];
};

export type LibraryShelfRow = {
  id: string;
  slug: string;
  title: string;
  author: string;
  publicationYear?: number;
  thumbnailUrl?: string;
  primarySubject?: string;
  callNumber: string;
  mainClass: string;
  subclass: string;
  confidence: "high" | "medium";
};
```

The rows must already be sorted. Do not ship raw evidence, alternatives, summaries, award appearances, or full source objects in this artifact.

Keep the full `libraryShelf` object in the on-demand book detail artifact, but explicitly remove it in `compactBook()` when writing `catalog-books.json`. If catalog controls need to know availability, add only a `hasLibraryShelfPlacement` boolean to `BrowseBookRow`. This prevents shelf metadata from increasing the shared catalog payload.

Add:

- `lib/library-shelf-types.ts`;
- a small data loader/index helper;
- a `positionByBookId` map at runtime;
- a helper that returns up to `radius` neighbors without wrapping from the end to the beginning.

### Public payload strategy

Do not serialize all rows into the initial page HTML.

Preferred implementation:

- keep the precomputed artifact server-side;
- add `/api/library-shelf` that returns:
  - summary/class metadata;
  - a requested class window;
  - a search result window;
  - a selected book window;
- give responses a public cache header;
- load a bounded shelf window in the client;
- include compact shelf neighbors in each on-demand book detail payload at build time or derive them in the existing detail API.

If a single static JSON client fetch proves materially simpler and remains within the project’s payload budget, it can be considered after measuring compressed size. It should not be chosen by assumption.

Update `next.config.ts` output tracing if the new route reads the artifact from disk rather than importing it.

### Neighbor semantics

Neighbors are global shelf neighbors in the accepted prize corpus, not neighbors among the currently filtered search results.

For a radius of three:

- return up to three preceding and three following books;
- preserve the selected book in the center;
- do not wrap across A/Z;
- report when the beginning/end of the accepted shelf or a class boundary truncates the result;
- allow a later UI option to restrict neighbors to the same subclass or main class.

The first contextual UI should use global shelf order and visibly mark class transitions.

## Work Package 7: Standalone Shelf Experience

Create:

- `app/fun/library-of-congress-shelf/page.tsx`;
- `components/library-shelf.tsx`;
- `components/shelf-neighborhood.tsx`;
- page metadata and canonical URL;
- a live link from `app/fun/page.tsx`.

### Page structure

Follow the editorial/dense-data patterns in `DESIGN.md`:

1. Editorial header:
   - eyebrow: `Experiment / Library shelf`;
   - title: `The Library of Congress Shelf`;
   - short explanation and limitation;
   - compact metrics for classified books, catalog coverage, and classes represented.
2. Filter toolbar:
   - search by title or author;
   - jump to main class;
   - previous/next class controls;
   - copy-link action for the selected book.
3. Class context:
   - current class code and official broad label;
   - position within the class and entire shelf;
   - a restrained distribution strip or tick marks, not a decorative chart.
4. Shelf viewport:
   - a bounded window around the selected book;
   - selected book clearly centered;
   - call numbers always visible;
   - cover color may be used as a quiet accent, but text remains primary.
5. Selected book panel:
   - title, author, year, call number, project subject, confidence/source note;
   - link to the full book record;
   - previous/next controls.
6. Method note:
   - link to methodology;
   - explicit statement that placement is edition-dependent and coverage is incomplete.

### Visual direction

Do not build a faux-wood, photorealistic, or heavily skeuomorphic bookshelf.

Use:

- hairline shelf rules;
- narrow vertical or horizontal book marks;
- the existing paper/panel/ink/muted/accent variables;
- the mono font for call numbers and positions;
- the serif font for selected titles where appropriate;
- 2px radii;
- restrained cover-derived color only when it remains legible in light and dark mode.

The experience should evoke shelf browsing through order and proximity, not through decoration.

### URL state

Make selection shareable:

```text
/fun/library-of-congress-shelf?book=<book-slug>
```

Optional fallback:

```text
/fun/library-of-congress-shelf?class=E
```

Rules:

- `book` wins over `class`;
- invalid or unavailable books fall back to the start of the requested/default class with a nonfatal notice;
- moving on the shelf updates URL state without a full page reload;
- query variants should canonicalize to the base page for search indexing.

### Keyboard and screen-reader behavior

- Use a semantic list or listbox-like pattern only if its interaction contract is fully implemented.
- The selected item should use `aria-current` or the appropriate selected-state attribute.
- Left/right arrows move one shelf item only while focus is within the shelf control.
- Page Up/Page Down may move by a viewport; Home/End may move to class boundaries.
- Do not capture arrow keys globally.
- Announce selection changes in a polite live region: title, author, call number, and position.
- Keep visible focus and restore focus sensibly after search/class jumps.
- Treat cover images as decorative when adjacent text provides the title.
- Provide buttons or links for every pointer-only action.
- Respect `prefers-reduced-motion`.

### Mobile behavior

- Show a horizontally scrollable or button-navigated bounded shelf window.
- Keep the selected book detail below the viewport.
- Preserve 44px minimum control targets.
- Avoid rotated text as the only way to read a title.
- Do not require precision dragging.
- Test at narrow mobile width with long titles and multi-part call numbers.

## Work Package 8: Contextual “On the Shelf” Component

Build `ShelfNeighborhood` once and reuse it in:

- the standalone page;
- the book drawer;
- the full book detail page;
- later, catalog row/card expansion.

### Component contract

Inputs:

- selected compact shelf row;
- preceding/following compact rows;
- display mode: `full`, `drawer`, or `inline`;
- optional class-boundary indicators;
- navigation callback or normal book links.

Outputs:

- selected book plus up to three books on either side;
- call number and title for every item;
- an empty/unavailable state when the book lacks an accepted placement;
- a link to open the full shelf at the selected book.

### Book drawer and detail page

Add the section after core catalog metadata and before award history. That placement makes the shelf a discovery tool attached to bibliographic metadata rather than part of award provenance.

Copy:

```text
ON THE SHELF
Three prize-recognized books on either side in Library of Congress call-number order.
```

Only render the section for accepted full call-number placements.

### Desktop catalog row expansion

The current table row opens the book drawer. Preserve that behavior.

Add a distinct shelf control:

- use an icon plus accessible label such as `Show shelf neighbors for <title>`;
- stop propagation so it does not open the drawer;
- use `aria-expanded` and `aria-controls`;
- insert a second `<tr>` immediately after the book row;
- place one `<td colSpan={9}>` containing `ShelfNeighborhood`;
- allow only one expanded shelf row at a time;
- retain expansion when appropriate during local interaction, but close it when pagination/search removes the selected row;
- do not overload the current sort headers or add “call number” as a global sort until coverage is strong enough to make that useful.

The exact control placement should be tested. Prefer a compact action in the title cell before adding a tenth table column.

### Mobile catalog cards

- Add a `Shelf neighbors` button only when a placement exists.
- Stop propagation so it does not open the drawer.
- Expand below the card’s metadata.
- Preserve logical tab order.
- Do not horizontally overflow the page.

### Unclassified books

Do not show disabled shelf icons on thousands of unclassified rows. Absence is quieter and avoids turning incomplete coverage into a visual defect.

On the full book detail page, a restrained `Library shelf placement not yet sourced` line may be shown within provenance/debug contexts, but it should not dominate the public record.

## Work Package 9: Class Labels and Methodology

Add a small curated source file such as:

```text
sources/library-of-congress-classes.json
```

It should contain:

- main class code;
- official broad label;
- official outline URL;
- optional subclass labels used by the UI;
- source/access date.

Do not ingest or reproduce the complete paid Classification Web hierarchy. The freely published LCC outline is enough for navigation and context.

Add a methodology section explaining:

- the difference between LCCN and call number;
- data sources;
- edition-level selection;
- confidence;
- why actual local shelves may differ;
- why coverage may be more complete for US-published and English-language books;
- that LCC is a historically situated classification system, not a neutral or exhaustive map of knowledge;
- how to report a correction.

The feature must not imply that the project endorses every historical category or arrangement embedded in LCC.

## Work Package 10: Tests and Verification

### Unit tests

- Parser and comparator fixtures.
- Cosmetic normalization.
- Candidate equivalence clustering.
- Exact-ISBN selection.
- Work-consensus selection.
- Rejection of materially divergent classifications.
- Confidence assignment.
- Stable input signatures and attempt reuse.
- Neighbor selection at start, middle, class boundary, and end.

Use `tsx --test`, matching the existing repository test style.

### Data integration tests

- Generated patch applies through `readEnrichment`.
- Manual `sources/curation.json` overrides generated placement.
- Source IDs merge into book details.
- Compact catalog does not accidentally include bulky evidence.
- Shelf artifact is deterministic and sorted.
- All artifact book IDs exist in the public catalog.
- Every public shelf row has a corresponding on-demand detail record.

### UI verification

Run:

```text
npm run data:build
npm run lint
npm run build
npm run payload:check
```

Then inspect with the in-app browser:

- standalone shelf at desktop and mobile widths;
- direct link to a selected book;
- search and class jump;
- keyboard-only navigation;
- reduced-motion mode;
- light and dark modes if both are supported;
- book drawer neighborhood;
- desktop table row expansion;
- mobile card expansion;
- missing/unclassified book behavior;
- long title/author/call-number stress cases;
- beginning/end and class-boundary behavior.

### Performance budgets

Measure before fixing final numeric budgets. Initial targets at the current corpus:

- no more than 31 shelf items rendered simultaneously;
- no per-book provider requests;
- no N+1 Book Prize Index API requests while moving item by item;
- initial page remains useful before shelf data arrives;
- class/window responses are cacheable;
- shelf artifact does not enter the shared home/books browse bundle;
- no regression beyond the accepted threshold in `npm run payload:check`.

## Release Gates

### Gate A: data proof

Proceed to UI implementation only when:

- at least 1,500 books have accepted, parseable full call numbers;
- at least 95% of normalized candidate strings that pass basic LCC validation parse completely, with every remainder explicitly reported as unsupported;
- manual audit targets are met;
- the quality report makes US/international and decade coverage visible;
- the exact-shelf artifact contains no low-confidence or classification-only rows.

The 1,500 threshold is deliberately below the full corpus. A coherent, honest shelf is better than a nominally complete one filled with guesses.

### Gate B: standalone experiment

Publish `/fun/library-of-congress-shelf` when:

- Gate A is met;
- the artifact and neighbor invariants pass;
- desktop/mobile/keyboard verification passes;
- user-facing caveats and methodology are present;
- the `/fun` card changes from `To do` to `Live`.

### Gate C: contextual book UI

Add the drawer and full-record neighborhood after:

- the standalone feature has no known ordering or identity defects;
- direct feedback confirms the neighborhood is understandable;
- empty coverage does not overwhelm the book-record experience.

### Gate D: catalog row expansion

Add row/card expansion last, after:

- the reusable component is stable;
- the interaction does not conflict with existing row-to-drawer behavior;
- the control remains visually quiet in compact density;
- mobile expansion is usable;
- common catalog result sets contain enough eligible books for the feature to feel intentional.

## Rollout Sequence

### Phase 0 — Reproducible audit

Deliver:

- cache audit command/script;
- baseline quality report;
- sample raw evidence;
- confirmed parser pattern inventory.

No public data changes.

### Phase 1 — Parser and schema

Deliver:

- `LibraryShelfPlacement` types;
- parser/comparator;
- official and local fixtures;
- class outline source;
- no network dependency.

### Phase 2 — Cache-first enrichment

Deliver:

- generated enrichment;
- source records;
- attempts ledger;
- review and quality reports;
- manual audit sample.

Rebuild and inspect before any network pass.

### Phase 3 — Targeted backfill

Deliver:

- exact-ISBN Library of Congress SRU integration;
- optional missing Open Library edition requests;
- checkpointed cache;
- updated QA.

Stop if yield is low or conflict rate rises.

### Phase 4 — Shelf artifact

Deliver:

- compact sorted artifact;
- data loader/index;
- neighbor helpers;
- build invariants and tests.

### Phase 5 — Standalone page

Deliver:

- `/fun/library-of-congress-shelf`;
- bounded shelf navigation;
- search/class jump/deep links;
- methodology and accessibility;
- `/fun` live card.

### Phase 6 — Book context

Deliver:

- shared `ShelfNeighborhood`;
- book drawer section;
- full detail-page section;
- provenance/source link.

### Phase 7 — Catalog expansion

Deliver:

- desktop expanded table row;
- mobile card expansion;
- interaction and payload verification.

### Phase 8 — Post-launch review

After direct user feedback:

- correct bad placements through curation;
- revisit medium-confidence work-consensus rules;
- consider an opt-in “approximate placements” view for classification-only records;
- consider subclass navigation or class-level editorial notes;
- do not add Dewey or inferred classifications merely to raise coverage.

## Risks and Mitigations

### Edition ambiguity

Risk: the same work has several legitimate call numbers or dates.

Mitigation: exact-edition preference, consensus rules, alternative evidence in review, confidence, and no automatic publication of material conflicts.

### Cosmetic variants mistaken for conflicts

Risk: spacing, punctuation, and ebook suffixes inflate disagreement.

Mitigation: preserve raw values, normalize before clustering, and test known variants.

### Incorrect shelf sorting

Risk: lexicographic sorting produces plausible-looking but wrong order.

Mitigation: structured parser/comparator, official fixtures, and audited neighbor sequences.

### Coverage bias

Risk: US/English books receive better coverage, making the international corpus appear less important.

Mitigation: publish coverage by region/decade, do not show disabled controls everywhere, describe the limitation, and prioritize authoritative backfill for undercovered high-value books.

### Classification-system bias

Risk: LCC categories are mistaken for neutral truth.

Mitigation: position the feature as one historical cataloging lens, preserve the project’s curated subjects separately, and add methodology.

### False physical-shelf claim

Risk: users assume the books are literally adjacent at the Library of Congress.

Mitigation: consistently call it a simulated Book Prize Index shelf arranged by cataloged call numbers; note that holdings/local shelving vary.

### Provider load and instability

Risk: bulk API use is rate-limited or provider schemas change.

Mitigation: cache-first workflow, dumps for bulk access, bounded requests, persistent caches, input signatures, and static generated app data.

### UI clutter

Risk: another discovery control makes the dense catalog harder to scan.

Mitigation: standalone experiment first, optional contextual expansion, no disabled controls, shared restrained component, and row integration last.

### Payload growth

Risk: thousands of shelf rows enter every catalog page.

Mitigation: separate artifact, bounded server responses or measured static fetch, on-demand detail neighbors, and payload checks.

## File-Level Implementation Map

Expected new files:

- `LIBRARY_SHELF_PLAN.md`
- `lib/library-call-number.ts`
- `lib/library-call-number.test.ts`
- `lib/library-shelf-types.ts`
- `lib/library-shelf-data.ts`
- `scripts/enrich-library-classifications.ts`
- `scripts/build/library-shelf.ts` or an equivalent helper called by `build-data`
- `sources/library-of-congress-classes.json`
- `sources/enrichment/library-classifications.generated.json`
- `data/public/library-shelf.json`
- `data/reports/library-classification-report.json`
- `data/reports/library-classification-review.json`
- `data/reports/library-classification-quality-report.json`
- `app/fun/library-of-congress-shelf/page.tsx`
- `components/library-shelf.tsx`
- `components/shelf-neighborhood.tsx`
- optionally `app/api/library-shelf/route.ts`

Expected modified files:

- `lib/types.ts`
- `scripts/build-data.ts`
- `scripts/build/public-catalog-artifacts.ts`
- `lib/book-drawer-types.ts`
- `components/book-drawer.tsx`
- `app/books/[slug]/page.tsx`
- `components/book-catalog.tsx`
- `lib/browse-types.ts` and `scripts/build/browse-data.ts` for a compact eligibility flag only, if needed
- `app/fun/page.tsx`
- `app/methodology/page.tsx`
- `app/sitemap.ts`
- `next.config.ts` if output tracing is needed
- `package.json`
- `app/globals.css`

Avoid adding shelf evidence to semantic search text unless later evaluation demonstrates a generic retrieval benefit. A call number is primarily browse/order metadata, not natural-language book content.

## Definition of Done

The feature is complete when:

- accepted shelf placement is deterministic, source-backed, edition-aware, and reviewable;
- the comparator passes official and local regression fixtures;
- no low-confidence or partial classification is silently presented as exact;
- the standalone page makes moving left and right through the corpus fast and understandable;
- a selected book can be deep-linked;
- contextual neighbors reuse the same ordering and component;
- desktop, mobile, keyboard, reduced-motion, and screen-reader behavior are verified;
- the feature does not introduce provider calls at runtime or a large shared payload;
- methodology clearly explains provenance, limitations, and the simulated nature of the shelf;
- the public experience remains restrained, editorial, and free of recommendation or sales language.
