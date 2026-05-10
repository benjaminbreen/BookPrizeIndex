# The Book Prize Index Roadmap

## Product Goal

The Book Prize Index is a free public resource for writers, researchers, librarians, publishers, and curious readers. Its first public scope is major nonfiction book prizes, including international prizes where the records are significant and the source quality is strong. Fiction can be added later, but v1 should make nonfiction genuinely useful before expanding.

The most important near-term work is not UI polish. It is building a trustworthy award-record corpus. Search, enrichment, semantic search, provenance UI, filters, and recommendations all depend on that corpus being real.

## Guiding Principles

- Award records are canonical. A row is `award + category + year + status + title + author + source`, and books are deduped from those rows.
- Every public award appearance should have a source URL. If a row has no source, it should stay out of the public corpus or be marked as manual/draft.
- Historical coverage can be uneven, but the unevenness must be explicit. Winners-only before finalist data exists is acceptable.
- Prefer official award archives. Use reputable secondary sources only when official archives are incomplete, and mark confidence clearly.
- Use LLMs as parsers, not as sources. They may structure messy source text, but every row must point back to a URL or manual source file.
- Keep v1 practical. We do not need legal pages or paid-product polish, but methodology and source clarity are essential.

## Phase 1: Major Nonfiction Award Corpus

### Scope

Include nonfiction broadly:

- general nonfiction
- history
- biography
- memoir/autobiography
- criticism
- science and nature writing
- political/current-affairs writing
- investigative/reportage nonfiction
- major translated or international nonfiction where the prize is significant

Include international prizes, but only the major ones for v1.

### Initial Award Targets

US:

- Pulitzer Prize: General Nonfiction, History, Biography, Memoir/Autobiography
- National Book Award: Nonfiction and historical General Nonfiction variants
- National Book Critics Circle: Nonfiction, Biography, Autobiography/Memoir, Criticism
- Andrew Carnegie Medal for Excellence in Nonfiction
- Kirkus Prize for Nonfiction
- Baillie Gifford Prize for Non-Fiction
- Cundill History Prize
- PEN/John Kenneth Galbraith Award for Nonfiction
- Los Angeles Times Book Prize nonfiction categories
- PEN America: Galbraith Nonfiction, Bograd Weld Biography, E.O. Wilson Science Writing, major essay/current-affairs prizes where records are strong
- Lukas Prize Project: J. Anthony Lukas Book Prize, Mark Lynton History Prize

UK / Ireland:

- Baillie Gifford Prize for Non-Fiction
- Orwell Prize for Political Writing
- Wolfson History Prize
- Royal Society Science Book Prize
- Duff Cooper Prize
- Wainwright Prize, if nature/environment writing is in scope

Canada / International:

- Cundill History Prize
- Hilary Weston Writers' Trust Prize for Nonfiction
- Governor General's Literary Award for Non-fiction
- British Academy Book Prize
- Financial Times and Schroders Business Book of the Year

Avoid long-tail niche prizes until the major corpus is stable.

### Data Model

Add a normalized raw award-record layer, likely under `data/raw/award-records/`.

Canonical raw record shape:

```ts
type RawAwardRecord = {
  awardId: string;
  awardName: string;
  categoryId: string;
  categoryName: string;
  year: number;
  status: "winner" | "co_winner" | "finalist" | "shortlist" | "longlist" | "honorable_mention" | "commended" | "unknown";
  title: string;
  authors: string[];
  publisher?: string;
  imprint?: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceConfidence: "official" | "secondary" | "manual" | "unknown";
  notes?: string;
};
```

Add a prize registry, likely `sources/prizes.json`, with:

- award id/name
- organization
- geography
- active years
- category definitions
- source archive URLs
- import strategy
- expected statuses
- winner/finalist/longlist coverage start years
- historical caveats

### Import Pipeline

Create importer modules by source type:

- `html-category-page`: category archive pages, such as Pulitzer category pages
- `html-year-page`: yearly archive pages
- `archive-search-page`: paginated archive search pages, such as National Book Foundation
- `press-release-series`: yearly press releases, common for PEN and some recent awards
- `manual-json`: curated older records or edge cases

Each importer should write normalized JSON rows. Then `scripts/build-data.ts` should consume normalized award records and produce:

- books
- awards
- award categories/editions
- appearances
- publishers/imprints when present in source data
- sources
- import reports

### Corpus Validation

Generate a more useful `data/public/import-report.json` with:

- total award records
- unique books
- records by award/category/status/year
- records missing source URL
- suspected duplicate books
- missing title/author/status
- awards with missing years
- coverage notes per prize/category

Definition of done for corpus v0.1:

- 12-15 major nonfiction awards/categories registered
- 3-5 reliable importers working
- every imported appearance has a source URL
- winners go back as far as official/public records reasonably allow
- finalists/shortlists/longlists included where reliably available
- app builds from the normalized corpus
- report clearly states incomplete coverage

Recommended first importer batch:

1. Pulitzer nonfiction categories
2. National Book Awards nonfiction archive
3. National Book Critics Circle nonfiction-related categories
4. Kirkus Prize for Nonfiction
5. Baillie Gifford Prize
6. PEN/Galbraith or Cundill, depending on source tractability

Progress:

- `sources/prizes.json` now contains the initial Pulitzer, National Book Awards, National Book Critics Circle, Andrew Carnegie Medals, Kirkus Prize, Baillie Gifford Prize, Cundill History Prize, PEN/Galbraith, and Los Angeles Times Book Prize registry entries.
- `scripts/import-award-records/pulitzer.ts` imports Pulitzer General Nonfiction, History, Biography or Autobiography, and Memoir or Autobiography from deterministic MediaWiki tables as a secondary source.
- `scripts/import-award-records/national-book-awards.ts` imports National Book Awards nonfiction records, including historical nonfiction subcategories, from deterministic MediaWiki tables as a secondary source.
- `scripts/import-award-records/nbcc.ts` imports NBCC Nonfiction, Biography, Memoir and Autobiography, and Criticism records from deterministic MediaWiki tables as a secondary source. Memoir and Autobiography is filtered to 2005 onward to avoid duplicating the earlier Biography/Autobiography lineage.
- `scripts/import-award-records/carnegie.ts` imports Andrew Carnegie Medal nonfiction winners and finalists from the deterministic MediaWiki table as a secondary source, including the 2018 no-winner year.
- `scripts/import-award-records/kirkus.ts` imports Kirkus Prize nonfiction winners and finalists from the deterministic MediaWiki table as a secondary source.
- `scripts/import-award-records/baillie-gifford.ts` imports Baillie Gifford Prize / Samuel Johnson Prize winners and shortlisted books from deterministic MediaWiki decade tables as a secondary source.
- `scripts/import-award-records/cundill.ts` imports Cundill History Prize winners, finalists, and longlisted books from the deterministic MediaWiki table as a secondary source.
- `scripts/import-award-records/pen-galbraith.ts` imports PEN/John Kenneth Galbraith Award nonfiction winners, runners-up, and finalists from the deterministic MediaWiki table as a secondary source. Runner-up rows are normalized to finalist status.
- `scripts/import-award-records/latimes.ts` imports Los Angeles Times Book Prize History, Biography, Current Interest, and Science and Technology winners and finalists from deterministic MediaWiki category tables as secondary sources.
- `data/raw/award-records/pulitzer.json`, `data/raw/award-records/national-book-awards.json`, `data/raw/award-records/nbcc.json`, `data/raw/award-records/carnegie.json`, `data/raw/award-records/kirkus.json`, `data/raw/award-records/baillie-gifford.json`, `data/raw/award-records/cundill.json`, `data/raw/award-records/pen-galbraith.json`, and `data/raw/award-records/latimes.json` are the first normalized raw corpus artifacts.
- `scripts/import-award-records/validate.ts` writes `data/raw/award-records/import-report.json`.
- Current raw corpus validation covers 3,388 award records across 9 files with no missing source URLs or duplicate canonical keys.
- Next importer targets should be narrower PEN America nonfiction/biography/science awards, Bancroft/Mark Lynton/Frederick Douglass history prizes, or official-source verification for the secondary-source imports.

## Phase 2: Book Identity And Metadata Reconciliation

After award records are stable, dedupe award rows into books.

Tasks:

- Build a deterministic book identity pass using normalized title, normalized authors, year proximity, publisher/imprint, and ISBN when available.
- Add a duplicate review report for uncertain merges.
- Preserve multiple award appearances across category/name changes.
- Keep source-provided publisher/imprint distinct from later catalog enrichment.
- Add manual curation patches for known duplicates and title variants.

Only after this phase should broad metadata enrichment be trusted.

## Phase 3: Metadata Enrichment

Use whichever source works, but track source confidence.

Preferred order:

1. Official publisher page, when available
2. Award page metadata, when available
3. Google Books / Open Library for ISBN, page count, thumbnail, publisher
4. Manual curation for mismatches
5. Leave blank rather than guessing

Tasks:

- Scale `scripts/enrich-books.ts` beyond the current top-25 prototype.
- Add review rules for bad matches.
- Store generated enrichment separately from manual curation.
- Add metadata source IDs to enriched fields.
- Track missing summary, cover, ISBN, publisher, and page count by book.

## Phase 4: Detail-Page Provenance

Do not clutter browsing pages with provenance. Show it on detail pages.

Book detail pages should show:

- award record sources
- catalog metadata sources
- publisher/summary source if available
- source confidence and accessed date where useful

Award detail pages should show:

- official award page
- archive/history source pages
- criteria/submission source pages
- coverage notes, such as "finalists available from 1980 onward"

## Phase 5: Search, Filters, And Semantic Search

Once the corpus is real, make discovery powerful.

Keyword search:

- Use one search path everywhere, probably MiniSearch.
- Index title, subtitle, author, award names, category names, status, subjects, publisher, imprint, central figures, and summary.
- Put search/filter state in URL query params.

Semantic search:

- Use OpenAI `text-embedding-3-small` unless requirements change.
- Precompute one embedding document per book and possibly one per award record cluster.
- Store the static vector index as a build artifact.
- Query embedding should be generated server-side through an API route using `OPENAI_API_KEY`, not in client code.
- Rank by cosine similarity and blend with keyword results where useful.

Filters:

- award
- category
- status
- year range
- subject
- country/region
- publisher/imprint
- has cover / has summary / has source

Make current placeholder controls real or remove them:

- `All filters`
- `Clear`
- `Density`
- table column sort icons
- semantic mode messaging

## Phase 6: Interaction Completeness

Finish visible app affordances:

- Book drawer previous/next controls
- Copy citation
- External links menu
- Empty states for searches and filters
- Mobile list/card alternatives for dense tables
- Keyboard and focus behavior for drawer and controls
- Reduced-motion handling for animations

## Phase 7: Public Context Pages

Skip legal boilerplate for now, but add context pages that make the free resource credible:

- `/about`
- `/methodology`
- `/sources`

Methodology should explain:

- what counts as a record
- how statuses are normalized
- how winners/finalists/longlists are handled
- why coverage differs by award and period
- how source confidence works
- how to report corrections

## Phase 8: Quality And Release

Tasks:

- Add tests for importers, status normalization, slug stability, dedupe, and search.
- Add data validation to the build.
- Add per-page metadata and Open Graph content.
- Add deployment/rebuild process.
- Add correction workflow, even if it is just a contact link or GitHub issue template.

## Near-Term Next Step

Start with the corpus importer framework and prize registry. Do not spend more time on enrichment, semantic search, or provenance UI until the app is building from a source-backed nonfiction award corpus rather than the starter workbook.
