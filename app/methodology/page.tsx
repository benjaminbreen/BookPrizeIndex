import Link from "next/link";

export const metadata = {
  title: "Methodology / The Book Prize Index",
  description: "How The Book Prize Index imports award records, builds book records, assigns subjects, and ranks recognition.",
  alternates: { canonical: "/methodology" },
};

export default function MethodologyPage() {
  return (
    <main className="text-page mx-auto grid max-w-[64rem] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[12rem_minmax(0,42rem)] md:gap-16 md:py-20 lg:px-8">
      <nav className="border-b hairline pb-4 font-[var(--font-mono)] text-[0.68rem] uppercase leading-7 tracking-[0.14em] muted md:sticky md:top-28 md:self-start md:border-b-0 md:pb-0">
        <p className="mb-3 text-[var(--ink)]">Methodology</p>
        <ol className="grid grid-cols-2 gap-x-5 md:block">
          <li><a className="transition hover:text-[var(--ink)]" href="#authorship">Authorship</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#principles">Principles</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#data-sources">Data sources</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#imports">Imports</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#books">Books</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#subjects">Subjects</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#ranking">Ranking</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#search">Search</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#limits">Limits</a></li>
        </ol>
      </nav>

      <article>
        <h1 className="font-[var(--font-serif)] text-4xl font-light leading-tight tracking-[-0.02em] sm:text-5xl">
          Methodology
        </h1>
        <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
          How award records become a searchable index of books, prizes, subjects, imprints, and publishers.
        </p>

        <section className="mt-8 scroll-mt-24 border-t hairline pt-5" id="authorship">
          <h2 className="methodology-heading">Authorship note</h2>
          <p className="methodology-copy">
            This methodology writeup was authored by GPT-5.5 for The Book Prize Index. It describes the current
            architecture and editorial rules of the project as implemented in the repository; it is not itself a source
            for any award result, book fact, or bibliographic claim.
          </p>
        </section>

        <MethodSection id="principles" title="Principles">
          <p>
            The index starts from award appearances, not from book metadata. A public record is treated as a row with a
            prize, category, year, status, title, author, and source. Books are then deduplicated from those rows. This
            matters because prize data is historical and contextual: categories split and merge, finalist lists appear
            inconsistently, and official archives often differ in how much detail they preserve.
          </p>
          <p>
            The project prefers deterministic imports over hand-entered lists. When a source can be parsed from a stable
            archive page, importer code should capture the transformation so it can be rerun, validated, and corrected.
            LLMs may help parse messy source text, but they are not treated as factual authorities. Every public award
            appearance should either point to a source URL or remain clearly provisional.
          </p>
        </MethodSection>

        <MethodSection id="data-sources" title="Data sources">
          <p>
            Prize data comes from public records. The preferred source is the prize's own public website: official
            winner and finalist pages, archive pages, annual announcement posts, downloadable lists, press releases,
            category pages, and similar pages published by the administering foundation, book prize, newspaper,
            university, learned society, or professional organization. These sources are used because they are closest
            to the institution that made the award decision and often preserve category names, eligibility notes,
            shortlist language, and year-specific context.
          </p>
          <p>
            Wikipedia is also used as a public secondary source, especially when an official archive is incomplete,
            difficult to parse, split across many historical pages, or no longer available in a stable form. In those
            cases, Wikipedia can provide a useful index of winners, finalists, historical category names, and links back
            to primary sources. It is treated as supporting evidence, not as a substitute for provenance when a stable
            official prize page is available.
          </p>
          <p>
            Imported rows should retain the most specific source URL practical for that record. When a prize publishes a
            year page or category page, the row should point there. When the best available public source is a broader
            official archive page, the importer records that page and preserves notes about the level of coverage. When
            Wikipedia is used to fill or cross-check historical lists, the row or importer notes should make that clear
            so later review can replace it with a stronger official or archival source if one is found.
          </p>
          <p>
            The project does not use LLM output as a factual source for prize results. Automated tools may help parse
            public pages into structured rows, but the factual claim still needs to trace back to a public prize site,
            Wikipedia page, or another explicit source URL captured in the import record.
          </p>
        </MethodSection>

        <MethodSection id="imports" title="Award imports">
          <p>
            Award-history work is kept separate from book-metadata enrichment. Importers live under
            <Code>scripts/import-award-records/</Code> and write normalized JSON records into
            <Code>data/raw/award-records/</Code>. Those raw records preserve prize identity, category, year, status,
            title, author, source URL, and notes where needed.
          </p>
          <p>
            Before raw records are promoted into the public catalog, they should pass validation. Validation looks for
            malformed rows, missing required fields, duplicate canonical keys, and source coverage problems. The durable
            source of truth is not the generated public JSON; it is the combination of source manifests, raw award
            records, curation patches, and enrichment files.
          </p>
        </MethodSection>

        <MethodSection id="books" title="Book records">
          <p>
            The catalog build deduplicates award appearances into books. It normalizes titles and authors, applies
            curation patches, merges generated enrichment, and writes the public catalog used by the Next.js app.
            Generated browse rows, shared catalog indexes, per-book detail records, and reports in <Code>data/reports/</Code> are
            outputs, not hand-edited authority.
          </p>
          <p>
            Book metadata is completed in focused passes. ISBNs, page counts, summaries, thumbnails, publisher links,
            Wikipedia links, and raw subject labels can come from catalog providers or reference sources, but generated
            matches are reviewed for confidence. When enrichment suggests that a book is a duplicate, wrong edition,
            wrong author, or wrong year, the correct response is a curation note rather than silently overwriting the
            record.
          </p>
        </MethodSection>

        <MethodSection id="subjects" title="Subjects, topics, and imprints">
          <p>
            Subjects and topics are deliberately separate. Subjects are an editorial browse taxonomy, not Library of
            Congress Subject Headings or Library of Congress Classification. Each book gets one primary subject so the
            catalog and historical comparisons do not double-count it. Manual curation takes precedence; otherwise an
            accepted high-confidence model classification becomes primary. Catalog subject labels (BISAC, Google Books,
            Open Library), award categories, and keyword rules remain as supporting evidence and as fallbacks when the
            classifier is uncertain. The build retains conflicting evidence instead of discarding it.
          </p>
          <p>
            Confidence measures agreement between independent evidence families. The browse taxonomy intentionally
            favors familiar reader-facing shelves over a formal bibliographic hierarchy. The stored History, American
            History, and World History classifications remain distinct, but the main subject index and comparative
            charts roll them into one History category; the History page exposes them as General, American, and World &
            International filters. This avoids comparing a parent category directly with its own subdivisions. Topics
            remain the more granular, overlapping discovery layer.
          </p>
          <p>
            Imprints are also handled separately from generic publisher metadata. Catalog APIs often return strings that
            may be imprints, parent companies, publisher groups, or edition labels. The project therefore uses a curated
            normalization map to turn raw publisher strings into explicit imprint and parent-publisher records. Generated
            imprint output should be regenerated from that map rather than edited directly.
          </p>
        </MethodSection>

        <MethodSection id="ranking" title="Recognition ranking">
          <p>
            The default book ranking is a recognition score. It is not a claim that one book is objectively better than
            another; it is a compact way to sort dense prize data. Major-award wins carry the most weight, followed by
            major finalists or shortlists, major longlists, and then equivalent appearances in non-major or
            subject-specific prizes.
          </p>
          <p>
            In the current scoring helper, a major-award win or co-win receives 10 points, a major finalist or shortlist
            receives 4, and a major longlist receives 2. Non-major wins receive 4 points, non-major finalists or
            shortlists receive 2, and non-major longlists receive 1. Tie-breakers favor major wins, total wins,
            shortlists, longlists, publication year, and then title.
          </p>
          <p>
            Regional filters can recalculate stats for U.S., international, or all-award views. Publisher and imprint
            rankings use related recognition aggregates, with extra care around award geography and publication-region
            requirements.
          </p>
        </MethodSection>

        <MethodSection id="search" title="Keyword and meaning search">
          <p>
            Meaning search is the default discovery mode. Keyword search remains available for exact-title, author,
            prize, publisher, and catalog-term lookups.
          </p>
          <p>
            Keyword search uses a local MiniSearch index over titles, authors, publishers, imprints, subjects, awards,
            central figures, and summaries. Field boosts favor titles, authors, awards, and subjects while still allowing
            fuzzy and prefix matching.
          </p>
          <p>
            Meaning search is separate. The semantic index is generated from catalog-derived book text with OpenAI
            embeddings stored as Float32 vectors alongside <Code>data/public/book-semantic-index.json</Code>. At query time, the server embeds
            the submitted query, optionally interprets longer natural-language prompts, and ranks candidates with a
            generic hybrid score: embedding similarity plus corpus-aware exact terms, subject/topic signals, period
            hints, and a small recognition boost. Ranking should remain generic and should not hard-code demo queries or
            favored phrases.
          </p>
          <p>
            The public meaning-search endpoint does not retain queries or client identifiers. A process-wide request
            budget and concurrency cap are applied before provider calls, and operators can disable meaning search with
            a server-side kill switch if traffic or cost becomes abnormal.
          </p>
        </MethodSection>

        <MethodSection id="limits" title="Limitations">
          <p>
            The index is incomplete by design because prize archives are incomplete. Some prizes publish full longlists;
            others publish only winners. Some historical category names changed. Some source pages disappear or move.
            Coverage gaps should be encoded in reports and notes rather than hidden behind a polished interface.
          </p>
          <p>
            Metadata enrichment also has limits. Catalog summaries are not publisher-verified descriptions. External
            thumbnails are not the same as locally cached cover assets. Subject and topic classifiers are evidence, not
            ground truth. The project should become more useful as provenance improves, not by pretending every field has
            the same confidence.
          </p>
          <p>
            Corrections should be made in durable source files or curation patches, then regenerated into public data.
            That keeps the catalog auditable and makes future changes reproducible.
          </p>
        </MethodSection>

        <p className="mt-12 border-t hairline pt-5 text-sm leading-7 muted">
          Return to <Link className="border-b hairline text-[var(--ink)] transition hover:text-[var(--accent)]" href="/about">About</Link>.
        </p>
      </article>
    </main>
  );
}

function MethodSection({ children, id, title }: { children: React.ReactNode; id: string; title: string }) {
  return (
    <section className="mt-10 scroll-mt-24 border-t hairline pt-5" id={id}>
      <h2 className="methodology-heading">{title}</h2>
      <div className="space-y-5 text-lg leading-9 muted">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-[var(--font-mono)] text-[0.88em] text-[var(--ink)]">{children}</code>;
}
