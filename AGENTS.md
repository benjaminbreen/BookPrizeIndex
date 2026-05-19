# Agent Notes

## Project Overview

The Book Prize Index is a static-first Next.js app for exploring major nonfiction book prize records. It is intended to be a free public resource for writers, researchers, publishers, librarians, and readers.

The current app is a polished prototype with an expanded but still incomplete corpus. The most important ongoing work is turning it into a trustworthy, source-backed nonfiction award index with reviewed book metadata, imprints, topics, and coverage reports. See `PLAN.md` for the broader roadmap.

## Architecture

- `app/`: Next.js App Router pages.
- `components/`: Client and server UI components.
- `lib/types.ts`: Public data model types.
- `lib/data.ts`: Loads `data/public/catalog.json` and exposes lookup maps/helpers.
- `lib/catalog.ts`: Book sorting and keyword search helpers.
- `lib/semantic-search.ts`: Shared semantic-search text construction, vector scoring, query normalization, and generic hybrid ranking helpers.
- `lib/browse-data.ts` and `lib/browse-types.ts`: Typed access to `data/public/browse.json` for precomputed browse/search rows.
- `lib/award-region.ts`: Region/country classification helpers for award programs.
- `lib/imprint-logos.ts`: Imprint logo asset resolution helpers.
- `lib/topics.ts`: Topic lookup and typing helpers.
- `app/api/search/semantic/route.ts`: Server-side OpenAI-backed semantic search endpoint used by the catalog UI.
- `components/use-semantic-book-search.ts`: Client hook for debounced semantic book search requests.
- `scripts/build-data.ts`: Builds `data/public/catalog.json` from source inputs and enrichment/curation patches.
- `scripts/build-semantic-index.ts`: Builds `data/public/book-semantic-index.json` from the public catalog using OpenAI embeddings.
- `scripts/build/`: Shared build helpers for award programs, curation, paths, text normalization, title resolution, and browse-data generation.
- `scripts/enrich-books.ts`: Book metadata completion from Open Library and Google Books, with persistent attempt tracking.
- `scripts/enrich-summaries.ts`: Text-first summary/description enrichment from Open Library APIs, Google Books, and optional local Open Library dumps.
- `scripts/book-enrichment-priority.ts`: Shared lane and priority scoring for book enrichment queues and runners.
- `scripts/enrich-subject-categories.ts`: Captures raw Google Books/Open Library subject labels as evidence for subject scoring.
- `scripts/classify-topics.ts`: Embedding/LLM-assisted topic classification that writes generated topic enrichment and review reports.
- `scripts/normalize-imprints.ts`: Converts curated raw catalog publisher strings into explicit imprint and parent-publisher patches.
- `scripts/import-award-records/`: Source importers for normalized award-history records. `helpers.ts` contains shared importer utilities (text normalization, registry reads, write helpers); `wikitable.ts` is a MediaWiki wikitext parser used by several importers.
- `sources/`: Source manifest, curation patches, enrichment patches, taxonomy definitions, imprint normalization mappings, and the starter workbook.
- `sources/enrichment/`: Generated or curated metadata patches for books, awards, publishers, imprints, and sources.
- `data/raw/award-records/`: Source-backed raw award appearances before public catalog build.
- `data/public/`: Generated public data artifacts used by the app, including `catalog.json`, `browse.json`, enrichment queues/reports, taxonomy reports, and classifier caches.
- `public/award-logos/`, `public/imprint-logos/`, and `public/icons/`: Local UI assets for award marks, imprint marks, and retailer icons.

## Current Data Flow

The current build reads `sources/manifest.json`, imports the seed workbook, imports normalized award records from `data/raw/award-records/*.json`, applies `sources/enrichment/*.json` except classifier internals, applies `sources/curation.json`, resolves subject/topic assignments from curated/generated/keyword evidence, and writes `data/public/catalog.json`, `data/public/browse.json`, and reports.

The durable data flow is:

1. Import source-backed award records into `data/raw/award-records/`.
2. Dedupe those records into books.
3. Build public catalog data from seed files, raw records, generated enrichment, and curation.
4. Enrich book metadata after award records are stable.
5. Normalize raw catalog publisher strings into explicit imprint and parent-publisher records.
6. Build browse artifacts for the home, awards, subjects, books, imprints, publishers, and topics routes.
7. Build semantic search artifacts when catalog text materially changes.
8. Rebuild public data and inspect reports/queues for unresolved cases.

Treat `data/public/catalog.json`, `data/public/book-semantic-index.json`, and `data/public/*-report.json` as generated artifacts. The durable source of truth is the seed/source files, raw award records, enrichment patches, and manual curation files.

## Parallel Data Workflows

There are two related but separate workflows. Keep them separate so multiple agents can work without duplicating or overwriting each other.

### Award-History Import Workflow

Use this when adding winners, finalists, shortlists, longlists, ties, categories, and source URLs for a prize.

- Coordinate prize ownership before importing. Another agent may already be importing an award one at a time.
- Add or update prize metadata in `sources/prizes.json`. Each prize should include a `scope` field: `"general"` for cross-genre nonfiction prizes, `"subject"` for prizes limited to one subject area (history, science, political writing, etc.), and `"discipline"` for professional/trade recognition. Use `scope` to avoid over-weighting subject-specific prizes in cross-prize ranking or discovery features.
- Put importer code in `scripts/import-award-records/` and write normalized records to `data/raw/award-records/<prize-id>.json`.
- Use `lib/award-records.ts` types for raw award appearances.
- Preserve source URLs for each row whenever the source provides stable row-level or year-level URLs.
- Run `npm run data:validate:raw` after changing raw award records.
- Run `npm run data:build` to regenerate public catalog data after validated imports.
- Do not use LLM output as a factual source. LLMs may parse cited source text into rows, but every row still needs a source URL and import notes.

### Book Metadata, Subject Evidence, Cover, And Imprint Workflow

Use this when enriching books with ISBNs, page counts, summaries, thumbnails/covers, publisher links, WorldCat, Wikipedia, buy links, publishers, or imprints.

Current workflow:

- `npm run books:queue -- --limit 100` rebuilds the catalog and writes `data/public/book-enrichment-queue.json`.
- `npm run books:enrich -- --limit 25` runs targeted metadata enrichment without rebuilding first or after.
- Both `books:queue` and `books:enrich` support `--lane <lane>` and `--fields <comma,separated,fields>` for focused passes. Current lanes are `high_value`, `identity_needed`, `cover_needed`, `summary_needed`, `catalog_completion`, `imprint_only`, and `low_confidence_review`.
- `npm run data:enrich` rebuilds the catalog, runs `scripts/enrich-books.ts`, writes `sources/enrichment/books.generated.json`, then rebuilds the catalog again.
- `scripts/enrich-books.ts` queries Open Library and Google Books for top-scoring books with missing fields, selected by `getBookStats`.
- It writes ISBN, page count, summary, external thumbnail URL, Google Books publisher-style link, source IDs, and publisher patches where available.
- `npm run summaries:enrich` runs focused description/summary enrichment for books still missing `summary`, without mixing in cover, imprint, or broad publisher normalization work.
- `npm run data:summaries` wraps rebuild -> summary enrichment -> rebuild.
- `scripts/enrich-summaries.ts` writes separate generated patches to `sources/enrichment/summaries.generated.json` and reports/cache/attempts files to `data/public/summary-enrichment-report.json`, `data/public/summary-enrichment-provider-cache.json`, and `data/public/summary-enrichment-attempts.json`. Keep it separate from `books.generated.json` so large text-completion passes do not trample general metadata work.
- Summary enrichment supports `--provider open_library`, `--provider google_books`, `--provider all`, and `--provider open_library_dump`. It also supports `--isbn-only`, `--retry-failures`, `--retry-status <status>`, `--request-delay-ms`, `--concurrency`, `--checkpoint-every`, `--open-library-editions-dump`, and `--open-library-works-dump`.
- Summary enrichment should write only conservative catalog text and closely related source-backed fields: `summary`, `subjectCategories`, `pageCount`, `publicationYear`, `isbn13`, `links.publisher`, and `sourceIds`. Avoid publisher/imprint/covers/Wikipedia in this pass unless the script has explicit high-confidence evidence and the workflow calls for it.
- Current summary baseline after the 2026-05-18 checkpointed Google Books, Open Library, and ISBN discovery passes: 2389 of 5216 books have summaries (45.8%). Reaching 50% requires 219 additional summaries. `sources/enrichment/summaries.generated.json` currently contains 1935 generated summary patches from Open Library and Google Books passes.
- The best near-term path to materially better semantic search is summary coverage, not query-specific ranking hacks. Run ISBN discovery first, then large summary batches, then rebuild semantic search after a material coverage jump.
- `npm run isbn:discover` runs the ISBN-first discovery workflow. It matches books to Open Library works, fetches editions, and writes high-confidence ISBN patches to `sources/enrichment/isbn.generated.json`, plus `data/public/isbn-discovery-report.json`, `data/public/isbn-review-queue.json`, and a provider cache. Prefer the earliest plausible English trade edition with ISBN13; do not use award year as the primary selector because awards can lag publication.
- ISBN discovery supports `--checkpoint-every <N>` and writes partial generated ISBN patches, attempts, reports, review queues, and provider cache while running. Use checkpointing for large runs so long Open Library passes can be interrupted without losing all progress.
- ISBN discovery should filter out obvious ebooks, audiobooks, large-print editions, translations, excerpts, and school/library bindings before choosing the earliest publication date. If several plausible earliest editions conflict, leave the row in review instead of guessing.
- It now writes `data/public/book-enrichment-attempts.json` so low-confidence, not-found, no-new-field, and error results are skipped on later batches when the missing-field state has not changed. Use `--retry-failures` only when intentionally retesting those rows.
- It treats Wikipedia as deferred enrichment; Open Library / Google Books queues do not select books only missing Wikipedia links.
- It merges into `sources/enrichment/books.generated.json` rather than replacing the whole file.
- It writes `data/public/book-completion-report.json`, `data/public/book-enrichment-report.json`, and `data/public/enrichment-report.json` with per-book enrichment status, provider matches, confidence scores, changed fields, skipped fields, and warnings.
- It may add `subjectCategories` from catalog/library metadata. Those are raw evidence labels, not final public subject assignments.
- `npm run subjects:enrich` writes `sources/enrichment/subject-categories.generated.json` and `data/public/subject-category-enrichment-report.json`.
- `npm run imprints:normalize` reads `sources/imprint-normalization.json`, generated book/publisher metadata, and existing catalog state. It writes `sources/enrichment/imprints.normalized.json` plus `data/public/imprint-review-queue.json`.
- `npm run data:imprints` wraps rebuild -> imprint normalization -> rebuild.

Subjects and topics are separate:

- Subjects are the primary browse taxonomy. Build-time evidence scoring chooses exactly one `primarySubject`/`subjects[0]` from manual curation, raw catalog labels, award categories, topic-derived evidence, and keyword fallback.
- Subject mapping rules live in `sources/subject-map.json`; subject definitions live in `sources/subjects.json`.
- Topics are more granular book-level tags. Topic definitions live in `sources/topics.json`.
- `npm run topics:classify` uses cached OpenAI embeddings plus optional LLM selection to write `sources/enrichment/topics.generated.json`, `data/public/topic-enrichment-report.json`, `data/public/topic-quality-report.json`, and `data/public/topic-embedding-cache.json`.
- Manual topic/subject corrections belong in `sources/curation.json`; generated topic rows can also be rejected with `reviewStatus: "rejected"` in generated enrichment when needed.

Semantic search is separate from topic classification:

- Semantic book search is exposed in the UI through `SearchModeSelect` as `Keyword` vs. `Meaning`. The home page routes meaning searches to `/books?mode=semantic`, and `/books` plus subject detail pages call `/api/search/semantic`.
- The semantic index lives at `data/public/book-semantic-index.json` and is generated by `npm run semantic:index`. It embeds catalog-derived book text with OpenAI embeddings and writes `data/public/book-semantic-index-report.json`.
- `OPENAI_API_KEY` must be available server-side for both index building and live query embedding. The API route returns a 503 if the key or semantic index is missing.
- Query interpretation may use the OpenAI Responses API for natural-language searches, then falls back to local generic term/period extraction if unavailable.
- Ranking should remain generic: combine embedding similarity with corpus-aware exact-term, subject/topic, period, and recognition signals. Do not hard-code specific demo queries, phrases, titles, subjects, or eras into semantic ranking.
- Rebuild the semantic index after catalog text, summaries, subjects, topics, central figures, imprints, publishers, or award recognition changes enough to affect discovery.
- When summary coverage is still low, defer semantic index rebuilds until there is a material text change, for example +500 summaries or a milestone such as 1000, 1500, 2000, or 50% summary coverage. Rebuilding after tiny batches costs time without fixing the core retrieval-quality problem.

Imprints are intentionally separate from generic catalog enrichment:

- Catalog APIs often return raw publisher strings that may be imprints, parent publishers, publisher groups, or ambiguous edition labels.
- `scripts/enrich-books.ts` should not guess `imprintId` directly from a broad parent string.
- `sources/imprint-normalization.json` is the curated mapping from raw catalog strings to `{ imprint, publisher, confidence }`.
- `sources/enrichment/imprints.normalized.json` is generated. Do not hand-edit it; edit `sources/imprint-normalization.json` and rerun `npm run data:imprints`.
- `data/public/imprint-review-queue.json` lists unresolved raw publisher strings, counts, and sample books. Use it to add high-confidence mappings.
- When a book only has a broad parent publisher such as Penguin Random House, Macmillan, Hachette, HarperCollins, Simon & Schuster, Wiley, or Springer, the project policy is to prefer the first US/UK trade edition imprint where it can be established from catalog evidence. Do not flatten broad parent publishers into same-name imprints just to fill the field.
- Exception: Wiley technical/reference records may use `Wiley` as both imprint and publisher when catalog evidence only names Wiley, John Wiley & Sons, or equivalent corporate variants and no more specific imprint such as Wiley-Blackwell, Wiley-Liss, Wiley-IEEE Press, Current Protocols, or Jossey-Bass is present.
- Use `npm run imprints:resolve` to investigate broad-parent publisher rows. The resolver writes `data/public/imprint-resolution-queue.json`, `data/public/imprint-resolution-report.json`, and high-confidence generated patches to `sources/enrichment/imprints.resolved.generated.json`.
- The resolver may auto-apply an imprint only when title/author matching is strong, any candidate year is compatible with the catalog publication year, exactly one known imprint candidate maps through `sources/imprint-normalization.json`, and that imprint belongs to the current broad parent publisher. Multiple candidates, weak title/author matches, edition/reprint conflicts, unmapped publisher strings, and parent-only results must remain in the report for manual review.
- If manual review establishes a reusable raw string to imprint relationship, add it to `sources/imprint-normalization.json` and rerun `npm run data:imprints`; if it establishes a one-off book correction, put it in `sources/curation.json` or a clearly named curated enrichment file.

Important limitations:

- `scripts/enrich-books.ts` merges generated patches, but do not run it casually while another agent is curating book metadata.
- Google Books summaries and links are catalog metadata, not verified publisher summaries or publisher pages.
- Google Books thumbnail URLs are external URLs, not locally cached cover assets.
- Google Books API research: public volume search can use an API key by adding `key=...`; search supports fielded queries including `isbn:<isbn>`; volume resources can include `volumeInfo.description`, `publisher`, `publishedDate`, `industryIdentifiers`, `pageCount`, `categories`, and links. Official docs: https://developers.google.com/books/docs/v1/using, https://developers.google.com/books/docs/v1/reference/volumes/list, and https://developers.google.com/books/docs/v1/reference/volumes.
- The enrichment scripts load `.env.local` / `.env`, read `GOOGLE_BOOKS_API_KEY` or `GOOGLE_API_KEY`, and append it to Google Books requests. Without a usable key/quota, unauthenticated requests may fail with 429 `RESOURCE_EXHAUSTED` and quota value 0, which was observed from this environment on 2026-05-15.
- If the user already has a Google Books API key, prefer `GOOGLE_BOOKS_API_KEY=... npm run summaries:enrich -- --provider google_books ...` for focused Google passes. Use lower concurrency and request delay until quota behavior is understood.
- Open Library dump enrichment is possible but disk-heavy. The current latest dump redirects observed on 2026-05-15 were roughly 11.5GB compressed for editions and 3.8GB compressed for works. Local free disk was about 12GB, so download to an external volume or other spacious path and pass it via `--open-library-editions-dump` / `--open-library-works-dump`.
- The current Open Library dump matcher is ISBN-centered. It is useful after ISBN discovery, but it will not solve no-ISBN summary gaps unless enhanced with title/author dump matching.
- Matching is heuristic. Review title/author matches before treating generated metadata as reliable.
- The attempts ledger prevents repeated misses from blocking progress; delete or edit `data/public/book-enrichment-attempts.json` only when deliberately resetting enrichment attempts.
- Subject/category and topic classifier output are evidence, not ground truth. Review `data/public/subject-review-report.json`, `data/public/suspicious-subject-topic-report.json`, and `data/public/topic-quality-report.json` before treating broad classifier output as reliable.
- Manual source-backed corrections belong in `sources/curation.json` or a clearly named curated enrichment file, not by hand-editing generated output.

Preferred workflow:

1. Run `npm run data:build` first so the latest award imports are reflected in book IDs.
2. Run `npm run books:queue -- --limit 100` to generate a lane-prioritized missing-field queue for books lacking catalog metadata: ISBN, page count, summary, thumbnail, or publisher URL. Wikipedia appears as a deferred field for a separate pass.
3. Run `npm run isbn:discover -- --lane high_value --limit 100` before broad metadata enrichment when ISBN coverage is low. Rebuild with `npm run data:build`, then use ISBNs for more reliable Open Library / Google Books metadata lookup.
4. For summary coverage, prefer broad but conservative summary passes after ISBN discovery. Good first passes are Open Library API batches, then Google Books with an API key, then Open Library dumps if disk space is available.
5. Inspect `data/public/summary-enrichment-report.json` after every large summary pass. If most rows are `no_new_fields`, `low_confidence`, or `not_found`, change provider strategy instead of blindly raising the limit.
6. Prefer focused metadata passes over one large mixed pass, for example `npm run books:queue -- --lane high_value --limit 100`, `npm run books:enrich -- --lane identity_needed --fields isbn13,publicationYear,publisherId,publisherLink --limit 50`, or `npm run books:enrich -- --lane cover_needed --fields thumbnailUrl --limit 50`.
7. Inspect `data/public/book-enrichment-report.json`.
8. Run `npm run data:build` so generated book patches are reflected in the catalog.
9. Rebuild semantic search only after material summary/text coverage gains, not after each small enrichment batch.
10. Run `npm run subjects:enrich` or `npm run data:subjects` when raw catalog/library subject labels need refreshing.
11. Run `npm run topics:classify` or `npm run data:topics` when topic definitions or book text have changed enough to justify reclassification.
12. Run `npm run imprints:normalize` or `npm run data:imprints` to promote known raw publisher strings into `imprintId` and parent `publisherId`.
13. Run `npm run imprints:resolve` when broad parent publishers need imprint drill-down, then inspect `data/public/imprint-resolution-report.json` before trusting new generated imprint patches.
14. Inspect `data/public/imprint-review-queue.json` and add clear mappings to `sources/imprint-normalization.json`.
15. Download usable cover thumbnails into `public/book-covers/` when license/source policy allows it, and point `thumbnailUrl` at the local asset.
16. Keep provenance: each ISBN, summary, cover, publisher link, or Wikipedia link should have a source entry when practical.
17. Rebuild with `npm run data:build` and inspect `data/public/enrichment-report.json`, `data/public/book-completion-report.json`, taxonomy reports, and `data/public/imprint-review-queue.json`.

If an enrichment pass discovers that a book record is actually a duplicate, wrong edition, wrong author, or wrong publication year, stop and add a curation note rather than silently overwriting the generated record.

## Product Direction

V1 should cover major nonfiction prizes internationally, not only history:

- general nonfiction
- history
- biography
- memoir/autobiography
- criticism
- science/nature writing
- political/current-affairs writing
- reportage/investigative nonfiction

Historical winners-only coverage is acceptable where finalist/shortlist records do not exist or were not announced. Coverage gaps should be explicit in data reports and methodology.

## Development Notes

- Prefer deterministic scraping/parsing of official award archives.
- Use LLMs only to parse source text into structured rows, never as independent data sources.
- Every public award appearance should have a source URL or be clearly marked as manual/draft.
- Keep generated enrichment separate from manual curation.
- New award programs should default to `award`; use `major_award` only for the established site-level major nonfiction prizes.
- Do not hide uncertainty; encode it as source confidence, notes, and coverage reports.
- Keep semantic search explainable and corpus-driven. If tuning ranking, use broad signals and evaluation queries rather than example-specific boosts.
- Preserve the app's restrained editorial design. Avoid large decorative UI additions unless they serve the data.
- Follow `DESIGN.md` for UI work. Current reference patterns are `/subjects` for simple browse tables, `/books` for dense catalog tables, and `/subjects/[slug]` for entity detail/insight pages.
- For new or polished UI, prefer the existing design primitives and shared classes (`SearchModeSelect`, `EntityMetricGrid`, `subjects-search`, `filter-toolbar`, `segmented-control`, `filter-select`, `filter-action`) over one-off controls.
- Keep the visual language Swiss-minimalist and editorial: hairlines, restrained typography, 2px control/surface radii, pill search/chips, compact data panels, and quiet motion. Do not introduce arbitrary component hex colors; add/reuse CSS variables in `app/globals.css`.

## Useful Commands

- `npm run dev`: run the Next dev server.
- `npm run build`: rebuild data and produce a production build.
- `npm run data:build`: rebuild `data/public/catalog.json`.
- `npm run semantic:index`: rebuild `data/public/book-semantic-index.json` using OpenAI embeddings.
- `npm run data:semantic`: rebuild public catalog data and then rebuild the semantic index.
- `npm run books:queue -- --limit 100`: write `data/public/book-enrichment-queue.json` for books missing enrichment fields.
- `npm run books:enrich -- --limit 25`: run targeted Open Library / Google Books book metadata enrichment.
- `npm run books:queue -- --lane high_value --limit 100`: inspect a high-value queue before running an expensive pass.
- `npm run books:enrich -- --lane identity_needed --fields isbn13,publicationYear,publisherId,publisherLink --limit 50`: run a focused identity/catalog pass.
- `npm run books:enrich -- --lane cover_needed --fields thumbnailUrl --limit 50`: run a focused cover pass.
- `npm run books:enrich -- --limit 25 --retry-failures`: retry books that the attempts ledger would otherwise skip.
- `npm run isbn:discover -- --limit 2000 --request-delay-ms 250 --concurrency 3 --checkpoint-every 50`: run a large checkpointed ISBN discovery pass before another ISBN-only summary pass.
- `npm run summaries:enrich -- --limit 500 --provider open_library --request-delay-ms 250 --concurrency 3`: run a broad Open Library summary pass.
- `GOOGLE_BOOKS_API_KEY=... npm run summaries:enrich -- --limit 1000 --provider google_books --request-delay-ms 500 --concurrency 1 --checkpoint-every 50`: run a Google Books summary pass with a project API key and periodic checkpoint writes.
- `npm run summaries:enrich -- --limit 1000 --provider google_books --isbn-only --request-delay-ms 500 --concurrency 1`: run a safer ISBN-only Google Books pass.
- `npm run summaries:enrich -- --limit 250 --provider all --retry-failures --retry-status low_confidence --min-score 0.6 --request-delay-ms 250 --concurrency 2 --checkpoint-every 50`: narrowly retry low-confidence summary matches with a lower threshold.
- `npm run summaries:enrich -- --limit 1500 --provider open_library_dump --open-library-editions-dump /path/to/ol_dump_editions.txt.gz --open-library-works-dump /path/to/ol_dump_works.txt.gz`: run summary enrichment from local Open Library dumps.
- `npm run data:summaries`: rebuild, enrich summaries, and rebuild again.
- `npm run subjects:enrich`: fetch raw Open Library / Google Books subject-category labels for subject evidence.
- `npm run data:subjects`: rebuild, enrich subject-category labels, and rebuild again.
- `npm run topics:classify`: classify books into curated topics and write generated topic enrichment/report files.
- `npm run data:topics`: rebuild, classify topics, and rebuild again.
- `npm run imprints:normalize`: convert curated raw publisher strings into generated imprint/publisher patches and a review queue.
- `npm run data:imprints`: rebuild, normalize imprints, and rebuild again.
- `npm run data:enrich`: run book metadata enrichment wrapped by rebuilds before and after.
- `npm run data:complete`: alias workflow for book metadata completion wrapped by rebuilds.
- `npm run data:import:pulitzer`: import normalized raw Pulitzer nonfiction records into `data/raw/award-records/pulitzer.json`.
- `npm run data:import:nba`: import normalized raw National Book Awards nonfiction records into `data/raw/award-records/national-book-awards.json`.
- `npm run data:import:nbcc`: import normalized raw National Book Critics Circle nonfiction-related records into `data/raw/award-records/nbcc.json`.
- `npm run data:import:carnegie`: import normalized raw Andrew Carnegie Medal nonfiction records into `data/raw/award-records/carnegie.json`.
- `npm run data:import:kirkus`: import normalized raw Kirkus Prize nonfiction records into `data/raw/award-records/kirkus.json`.
- `npm run data:import:baillie-gifford`: import normalized raw Baillie Gifford Prize nonfiction records into `data/raw/award-records/baillie-gifford.json`.
- `npm run data:import:cundill`: import normalized raw Cundill History Prize records into `data/raw/award-records/cundill.json`.
- `npm run data:import:pen-galbraith`: import normalized raw PEN/John Kenneth Galbraith Award nonfiction records into `data/raw/award-records/pen-galbraith.json`.
- `npm run data:import:bancroft`: import normalized raw Bancroft Prize history records into `data/raw/award-records/bancroft.json`.
- `npm run data:import:latimes`: import normalized raw Los Angeles Times Book Prize nonfiction-category records into `data/raw/award-records/latimes.json`.
- `npm run data:import:lukas-prizes`: import normalized raw J. Anthony Lukas Book Prize and Mark Lynton History Prize records into `data/raw/award-records/j-anthony-lukas.json` and `data/raw/award-records/mark-lynton.json`.
- `npm run data:import:prose`: import normalized raw PROSE Awards records into `data/raw/award-records/prose.json`.
- `npm run data:import:wolfson`: import normalized raw Wolfson History Prize records into `data/raw/award-records/wolfson.json`.
- `npm run data:import:phi-beta-kappa`: import normalized raw Phi Beta Kappa book award records into `data/raw/award-records/phi-beta-kappa.json`.
- `npm run data:import:royal-society`: import normalized raw Royal Society science book prize records into `data/raw/award-records/royal-society.json`.
- `npm run data:import:orwell`: import normalized raw Orwell Prize political writing records into `data/raw/award-records/orwell.json`.
- `npm run data:validate:raw`: validate raw award-record corpus files and write `data/raw/award-records/import-report.json`.
- `npm run logos:imprints`: fetch or refresh imprint logo assets.

## Immediate Priority

The normalized award-record foundation, importer framework, and several major-award importers now exist. Current priorities are:

1. Continue source-backed award import coverage and QA, especially stable source URLs, result normalization, and category notes.
2. Fix malformed imported rows at the raw-record or curation layer when enrichment reveals bad title/author/year data.
3. Raise summary/description coverage before tuning semantic search. Target at least 50% coverage, using ISBN discovery, Open Library API batches, Google Books with `GOOGLE_BOOKS_API_KEY` if available, and optionally Open Library dumps on a spacious disk.
4. Grow `sources/imprint-normalization.json` from `data/public/imprint-review-queue.json`, prioritizing high-count and high-confidence raw publisher strings.
5. Improve cover handling by caching usable cover thumbnails locally when source/license policy allows it.
6. Keep topic classification and subject/category assignments reviewed through generated reports rather than treating LLM output as final truth.
