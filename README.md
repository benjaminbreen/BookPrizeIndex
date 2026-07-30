# The Book Prize Index

The Book Prize Index is a searchable index of book prizes and award-recognized books, with an initial focus on nonfiction and history. It gathers publicly available data about literary awards, winners, finalists, shortlists, publishers, imprints, subjects, and related bibliographic metadata.

The project was created by Benjamin Breen, a history professor at the University of California, Santa Cruz, using GPT-5.5 as a coding and research assistant.

## Purpose

Book prize data is often scattered across award websites, publisher pages, press releases, archives, and reference sources. The Book Prize Index aims to make that information easier to search, compare, and verify by bringing it into a structured public catalog.

The index is designed for readers, writers, scholars, librarians, publishers, editors, booksellers, and anyone interested in the ecology of literary recognition.

## Data

The project uses publicly available sources wherever possible, including official award pages, publisher records, library and catalog metadata, and other public reference sources. The goal is to preserve links back to source material so that records can be checked, corrected, and expanded over time.

The dataset is still in development. Some records are complete, while others are provisional or awaiting source-backed enrichment.

## Technology

The app is built with:

- Next.js
- TypeScript
- Tailwind CSS
- Static JSON data generated from source and enrichment files
- Semantic and keyword search workflows under development

It is designed to be deployed on Vercel as a static-first web application.

### Semantic search safeguards

Meaning search requires `OPENAI_API_KEY` on the server. The public endpoint keeps no visitor identifiers or query
history and applies a process-wide cost guard before provider calls: 20 requests per minute and 3 concurrent searches
by default. Operators can tune `SEMANTIC_SEARCH_REQUESTS_PER_MINUTE` and `SEMANTIC_SEARCH_MAX_CONCURRENT`, or set
`SEMANTIC_SEARCH_ENABLED=false` as an immediate kill switch. Provider-level project budgets remain the final backstop
when a serverless host runs more than one process.

### Saved books and lists

Individual books and user-created reading lists are kept locally in the browser's IndexedDB storage, alongside
completed Meaning searches that users choose to freeze. The header bookmark links to this local library, briefly
pulses when an item is added, and offers an accent hover state when the library is non-empty. Personal lists can be
prepared for sharing with a creator display name, edited title, optional introduction, selected books, and a chosen
order. Sharing writes an immutable, content-addressed JSON snapshot to Vercel Blob and returns
`/reading-lists/<id>`; semantic-list sharing uses `/lists/<id>`. Shared personal lists include generated
social-preview images and Markdown export.

Connect a private Vercel Blob store to production so `BLOB_STORE_ID` is available for the current OIDC connection
(or `BLOB_READ_WRITE_TOKEN` for a legacy connection). The public reading-list URL is served by the app; its JSON
snapshot remains in private storage. When the app is not running on Vercel and neither Blob credential is configured,
shared snapshots use the gitignored `.semantic-lists/` and `.personal-lists/` directories for local development.
Shared pages are unlisted and excluded from search-engine indexing. Opening a saved or shared list never invokes the
semantic-search provider; rerunning is a separate, explicit action.

## Status

This is an early version of the project. The current focus is building a reliable, source-backed corpus of book award data and improving metadata for individual books.
