# Agent Notes

## Project Overview

The Book Prize Index is a static-first Next.js app for exploring major nonfiction book prize records. It is intended to be a free public resource for writers, researchers, publishers, librarians, and readers.

The current app is a polished prototype, but the dataset is still a starter corpus. The most important next work is building a trustworthy source-backed nonfiction award corpus. See `PLAN.md` for the full roadmap.

## Architecture

- `app/`: Next.js App Router pages.
- `components/`: Client and server UI components.
- `lib/types.ts`: Public data model types.
- `lib/data.ts`: Loads `data/public/catalog.json` and exposes lookup maps/helpers.
- `lib/catalog.ts`: Book sorting and keyword search helpers.
- `scripts/build-data.ts`: Builds `data/public/catalog.json` from source inputs and enrichment/curation patches.
- `scripts/enrich-books.ts`: Prototype book metadata enrichment from Open Library and Google Books.
- `scripts/import-award-records/`: Source importers for normalized award-history records.
- `sources/`: Source manifest, curation patches, enrichment patches, and the starter workbook.
- `sources/enrichment/`: Generated or curated metadata patches for books, awards, publishers, imprints, and sources.
- `data/raw/award-records/`: Source-backed raw award appearances before public catalog build.
- `data/public/`: Generated public data artifacts used by the app.

## Current Data Flow

The existing build reads `sources/manifest.json`, imports the seed workbook, applies `sources/enrichment/*.json`, applies `sources/curation.json`, and writes `data/public/catalog.json` plus import reports.

This should evolve toward a normalized award-record corpus:

1. Import source-backed award records into `data/raw/award-records/`.
2. Dedupe those records into books.
3. Build public catalog data from the normalized records.
4. Enrich book metadata after award records are stable.

Treat `data/public/catalog.json` and `data/public/*-report.json` as generated artifacts. The durable source of truth is the seed/source files, raw award records, enrichment patches, and manual curation files.

## Parallel Data Workflows

There are two related but separate workflows. Keep them separate so multiple agents can work without duplicating or overwriting each other.

### Award-History Import Workflow

Use this when adding winners, finalists, shortlists, longlists, ties, categories, and source URLs for a prize.

- Coordinate prize ownership before importing. Another agent may already be importing an award one at a time.
- Add or update prize metadata in `sources/prizes.json`.
- Put importer code in `scripts/import-award-records/` and write normalized records to `data/raw/award-records/<prize-id>.json`.
- Use `lib/award-records.ts` types for raw award appearances.
- Preserve source URLs for each row whenever the source provides stable row-level or year-level URLs.
- Run `npm run data:validate:raw` after changing raw award records.
- Run `npm run data:build` to regenerate public catalog data after validated imports.
- Do not use LLM output as a factual source. LLMs may parse cited source text into rows, but every row still needs a source URL and import notes.

### Book Metadata And Cover Workflow

Use this when enriching books with ISBNs, page counts, summaries, thumbnails/covers, publisher links, WorldCat, Wikipedia, or buy links.

Current prototype:

- `npm run books:queue -- --limit 100` rebuilds the catalog and writes `data/public/book-enrichment-queue.json`.
- `npm run books:enrich -- --limit 25` runs targeted metadata enrichment without rebuilding first or after.
- `npm run data:enrich` rebuilds the catalog, runs `scripts/enrich-books.ts`, writes `sources/enrichment/books.generated.json`, then rebuilds the catalog again.
- `scripts/enrich-books.ts` queries Open Library and Google Books for top-scoring books with missing fields, selected by `getBookStats`.
- It writes ISBN, page count, summary, external thumbnail URL, Google Books publisher-style link, source IDs, and publisher patches where available.
- It merges into `sources/enrichment/books.generated.json` rather than replacing the whole file.
- It writes `data/public/book-enrichment-report.json` and `data/public/enrichment-report.json` with per-book enrichment status, provider matches, confidence scores, changed fields, skipped fields, and warnings.

Important limitations:

- The script now merges generated patches, but do not run it casually while another agent is curating book metadata.
- Google Books summaries and links are catalog metadata, not verified publisher summaries or publisher pages.
- Google Books thumbnail URLs are external URLs, not locally cached cover assets.
- Matching is heuristic. Review title/author matches before treating generated metadata as reliable.
- Manual source-backed corrections belong in `sources/curation.json` or a clearly named curated enrichment file, not by hand-editing generated output.

Preferred next shape for this workflow:

1. Run `npm run data:build` first so the latest award imports are reflected in book IDs.
2. Run `npm run books:queue -- --limit 100` to generate a missing-field queue for books lacking ISBN, page count, summary, thumbnail, publisher URL, or Wikipedia URL.
3. Run `npm run books:enrich -- --limit 25` for a small targeted pass, then inspect `data/public/book-enrichment-report.json`.
4. Merge new patches into `sources/enrichment/books.generated.json` without deleting existing reviewed patches.
5. Download usable cover thumbnails into `public/book-covers/` when license/source policy allows it, and point `thumbnailUrl` at the local asset.
6. Keep provenance: each ISBN, summary, cover, publisher link, or Wikipedia link should have a source entry when practical.
7. Rebuild with `npm run data:build` and inspect `data/public/enrichment-report.json` or a workflow-specific report.

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
- Do not hide uncertainty; encode it as source confidence, notes, and coverage reports.
- Preserve the app's restrained editorial design. Avoid large decorative UI additions unless they serve the data.

## Useful Commands

- `npm run dev`: run the Next dev server.
- `npm run build`: rebuild data and produce a production build.
- `npm run data:build`: rebuild `data/public/catalog.json`.
- `npm run books:queue -- --limit 100`: write `data/public/book-enrichment-queue.json` for books missing enrichment fields.
- `npm run books:enrich -- --limit 25`: run targeted Open Library / Google Books book metadata enrichment.
- `npm run data:enrich`: run book metadata enrichment wrapped by rebuilds before and after.
- `npm run data:import:pulitzer`: import normalized raw Pulitzer nonfiction records into `data/raw/award-records/pulitzer.json`.
- `npm run data:validate:raw`: validate raw award-record corpus files and write `data/raw/award-records/import-report.json`.

## Immediate Priority

Implement the corpus creation plan in `PLAN.md`, starting with:

1. `sources/prizes.json`
2. normalized award-record types
3. importer framework
4. National Book Awards and NBCC importers
5. build-data changes to consume normalized award records
6. richer import coverage reports
