# data/cache

Pipeline provider caches and attempt ledgers. Everything here is machine-generated
state that the enrichment scripts read and write to avoid repeating provider requests:

- `*-provider-cache.json`, `isbn-discovery-cache.json`, `topic-embedding-cache.json`:
  raw provider responses / embeddings. Safe to delete; the next run re-fetches (at
  API-cost and time).
- `*-attempts.json`: skip ledgers recording failed or low-confidence lookups so later
  batches do not retry them. Delete or edit only when deliberately resetting attempts
  (see AGENTS.md).
- `book-enrichment-progress.json`: checkpoint state for long enrichment runs.
- `catalog.full.generated.json`: the full catalog used by enrichment and reporting
  scripts. `npm run data:build` regenerates it; runtime pages use the split artifacts
  in `data/public/` instead.

This directory is gitignored. The durable sources of truth live in `sources/` and
`data/raw/`; generated app data lives in `data/public/`; QA reports and review queues
live in `data/reports/`.
