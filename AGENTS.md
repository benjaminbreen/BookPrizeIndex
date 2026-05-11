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
- `lib/browse-data.ts` and `lib/browse-types.ts`: Typed access to `data/public/browse.json` for precomputed browse/search rows.
- `lib/award-region.ts`: Region/country classification helpers for award programs.
- `lib/imprint-logos.ts`: Imprint logo asset resolution helpers.
- `lib/topics.ts`: Topic lookup and typing helpers.
- `scripts/build-data.ts`: Builds `data/public/catalog.json` from source inputs and enrichment/curation patches.
- `scripts/build/`: Shared build helpers for award programs, curation, paths, text normalization, title resolution, and browse-data generation.
- `scripts/enrich-books.ts`: Book metadata completion from Open Library and Google Books, with persistent attempt tracking.
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
7. Rebuild public data and inspect reports/queues for unresolved cases.

Treat `data/public/catalog.json` and `data/public/*-report.json` as generated artifacts. The durable source of truth is the seed/source files, raw award records, enrichment patches, and manual curation files.

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

Imprints are intentionally separate from generic catalog enrichment:

- Catalog APIs often return raw publisher strings that may be imprints, parent publishers, publisher groups, or ambiguous edition labels.
- `scripts/enrich-books.ts` should not guess `imprintId` directly from a broad parent string.
- `sources/imprint-normalization.json` is the curated mapping from raw catalog strings to `{ imprint, publisher, confidence }`.
- `sources/enrichment/imprints.normalized.json` is generated. Do not hand-edit it; edit `sources/imprint-normalization.json` and rerun `npm run data:imprints`.
- `data/public/imprint-review-queue.json` lists unresolved raw publisher strings, counts, and sample books. Use it to add high-confidence mappings.

Important limitations:

- `scripts/enrich-books.ts` merges generated patches, but do not run it casually while another agent is curating book metadata.
- Google Books summaries and links are catalog metadata, not verified publisher summaries or publisher pages.
- Google Books thumbnail URLs are external URLs, not locally cached cover assets.
- Matching is heuristic. Review title/author matches before treating generated metadata as reliable.
- The attempts ledger prevents repeated misses from blocking progress; delete or edit `data/public/book-enrichment-attempts.json` only when deliberately resetting enrichment attempts.
- Subject/category and topic classifier output are evidence, not ground truth. Review `data/public/subject-review-report.json`, `data/public/suspicious-subject-topic-report.json`, and `data/public/topic-quality-report.json` before treating broad classifier output as reliable.
- Manual source-backed corrections belong in `sources/curation.json` or a clearly named curated enrichment file, not by hand-editing generated output.

Preferred workflow:

1. Run `npm run data:build` first so the latest award imports are reflected in book IDs.
2. Run `npm run books:queue -- --limit 100` to generate a lane-prioritized missing-field queue for books lacking catalog metadata: ISBN, page count, summary, thumbnail, or publisher URL. Wikipedia appears as a deferred field for a separate pass.
3. Prefer focused passes over one large mixed pass, for example `npm run books:queue -- --lane high_value --limit 100`, `npm run books:enrich -- --lane identity_needed --fields isbn13,publicationYear,publisherId,publisherLink --limit 50`, or `npm run books:enrich -- --lane cover_needed --fields thumbnailUrl --limit 50`.
4. Inspect `data/public/book-enrichment-report.json`.
5. Run `npm run data:build` so generated book patches are reflected in the catalog.
6. Run `npm run subjects:enrich` or `npm run data:subjects` when raw catalog/library subject labels need refreshing.
7. Run `npm run topics:classify` or `npm run data:topics` when topic definitions or book text have changed enough to justify reclassification.
8. Run `npm run imprints:normalize` or `npm run data:imprints` to promote known raw publisher strings into `imprintId` and parent `publisherId`.
9. Inspect `data/public/imprint-review-queue.json` and add clear mappings to `sources/imprint-normalization.json`.
10. Download usable cover thumbnails into `public/book-covers/` when license/source policy allows it, and point `thumbnailUrl` at the local asset.
11. Keep provenance: each ISBN, summary, cover, publisher link, or Wikipedia link should have a source entry when practical.
12. Rebuild with `npm run data:build` and inspect `data/public/enrichment-report.json`, `data/public/book-completion-report.json`, taxonomy reports, and `data/public/imprint-review-queue.json`.

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
- Preserve the app's restrained editorial design. Avoid large decorative UI additions unless they serve the data.
- Follow `DESIGN.md` for UI work. Current reference patterns are `/subjects` for simple browse tables, `/books` for dense catalog tables, and `/subjects/[slug]` for entity detail/insight pages.
- For new or polished UI, prefer the existing design primitives and shared classes (`SearchModeSelect`, `EntityMetricGrid`, `subjects-search`, `filter-toolbar`, `segmented-control`, `filter-select`, `filter-action`) over one-off controls.
- Keep the visual language Swiss-minimalist and editorial: hairlines, restrained typography, 2px control/surface radii, pill search/chips, compact data panels, and quiet motion. Do not introduce arbitrary component hex colors; add/reuse CSS variables in `app/globals.css`.

## Useful Commands

- `npm run dev`: run the Next dev server.
- `npm run build`: rebuild data and produce a production build.
- `npm run data:build`: rebuild `data/public/catalog.json`.
- `npm run books:queue -- --limit 100`: write `data/public/book-enrichment-queue.json` for books missing enrichment fields.
- `npm run books:enrich -- --limit 25`: run targeted Open Library / Google Books book metadata enrichment.
- `npm run books:queue -- --lane high_value --limit 100`: inspect a high-value queue before running an expensive pass.
- `npm run books:enrich -- --lane identity_needed --fields isbn13,publicationYear,publisherId,publisherLink --limit 50`: run a focused identity/catalog pass.
- `npm run books:enrich -- --lane cover_needed --fields thumbnailUrl --limit 50`: run a focused cover pass.
- `npm run books:enrich -- --limit 25 --retry-failures`: retry books that the attempts ledger would otherwise skip.
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
3. Continue metadata completion in batches; inspect low-confidence matches and do not force metadata onto uncertain records.
4. Grow `sources/imprint-normalization.json` from `data/public/imprint-review-queue.json`, prioritizing high-count and high-confidence raw publisher strings.
5. Improve cover handling by caching usable cover thumbnails locally when source/license policy allows it.
6. Keep topic classification and subject/category assignments reviewed through generated reports rather than treating LLM output as final truth.
