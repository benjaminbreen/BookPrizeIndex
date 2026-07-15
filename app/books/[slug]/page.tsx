import Link from "next/link";
import type React from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { ExpandableBookDescription } from "@/components/expandable-book-description";
import { withAmazonAssociateTag } from "@/lib/affiliate-links";
import {
  appearancesByBookId,
  awardsById,
  booksByAuthorName,
  booksById,
  booksBySlug,
  data,
  getBookStats,
  imprintsById,
  publishersById,
  sourcesById,
  statusLabels,
  wikipediaEvidenceByBook,
} from "@/lib/data";
import { rollupSubjectName, rollupSubjectSlug } from "@/lib/subject-rollup";
import type { AwardAppearance, Book, ExperimentalSemanticEntity, ExperimentalSemanticProfile, WikipediaBookEvidence } from "@/lib/types";

const STATIC_BOOK_PAGE_LIMIT = 250;

export const dynamicParams = true;

export function generateStaticParams() {
  return [...data.books]
    .sort((a, b) => {
      const aStats = getBookStats(a.id);
      const bStats = getBookStats(b.id);
      return (
        bStats.score - aStats.score ||
        bStats.majorWins - aStats.majorWins ||
        bStats.wins - aStats.wins ||
        (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
        a.title.localeCompare(b.title)
      );
    })
    .slice(0, STATIC_BOOK_PAGE_LIMIT)
    .map((book) => ({ slug: book.slug }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const book = booksBySlug.get(slug);
  return { title: book ? `${book.title} / The Book Prize Index` : "Book / The Book Prize Index" };
}

export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const book = booksBySlug.get(slug);
  if (!book) notFound();
  const stats = getBookStats(book.id);
  const appearances = [...(appearancesByBookId.get(book.id) ?? [])].sort(compareAwardAppearances);
  const winsCount = appearances.filter((appearance) => isWinningStatus(appearance.status)).length;
  const imprint = book.imprintId ? imprintsById.get(book.imprintId) : undefined;
  const publisher = book.publisherId ? publishersById.get(book.publisherId) : undefined;
  const wikipediaEvidence = wikipediaEvidenceByBook.get(book.id);
  const firstAwardYear = appearances.length ? Math.min(...appearances.map((appearance) => appearance.year)) : undefined;
  const latestRecognition = appearances.length ? Math.max(...appearances.map((appearance) => appearance.year)) : undefined;
  const authorNames = new Set(book.authors.map((author) => author.name));
  const booksByAuthor = [...authorNames]
    .flatMap((authorName) => booksByAuthorName.get(authorName) ?? [])
    .filter((candidate, index, candidates) => candidate.id !== book.id && candidates.findIndex((item) => item.id === candidate.id) === index)
    .slice(0, 1);
  const relatedBooks = (book.relatedBookIds ?? [])
    .map((bookId) => booksById.get(bookId))
    .filter((candidate): candidate is Book => Boolean(candidate))
    .slice(0, 4);
  const detailDescription = detailPageDescription(book);
  const wikipediaInfobox = wikipediaEvidence?.infobox;

  return (
    <main className="book-detail-page">
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)_20rem] lg:items-start lg:px-8">
        <aside className="border-r-0 hairline lg:border-r lg:pr-6">
          <BookCover title={book.title} author={book.authors.map((author) => author.name).join(", ")} thumbnailUrl={book.thumbnailUrl} />
          <dl className="mt-3 grid text-[0.72rem]">
            <RailMeta label="Author" value={book.authors.map((author) => author.name).join(", ")} />
            <RailMeta label="Publisher" value={metadataValue(publisher?.name, wikipediaInfobox?.publisher, "Not yet sourced")} />
            <RailMeta
              label="Imprint"
              value={imprint ? <Link className="book-detail-text-link" href={`/imprints/${imprint.id.replace(/^imprint-/, "")}`}>{imprint.name}</Link> : "Unknown"}
            />
            <RailMeta label="Publication year" value={metadataValue(book.publicationYear ? String(book.publicationYear) : undefined, wikipediaInfobox?.publicationDate, "Unknown")} />
            <RailMeta label="Pages" value={metadataValue(book.pageCount ? String(book.pageCount) : undefined, wikipediaInfobox?.pages, "Not yet sourced")} />
            <RailMeta label="ISBN" value={metadataValue(book.isbn13.join(", ") || undefined, wikipediaInfobox?.isbn, "Not yet sourced")} />
          </dl>
        </aside>

        <section className="min-w-0">
          <h1 className="font-[var(--font-serif)] text-4xl font-light leading-[1.06] sm:text-5xl">{book.title}</h1>
          {book.subtitle ? <p className="mt-2 text-xl">{book.subtitle}</p> : null}
          <p className="mt-3 text-lg muted">{book.authors.map((author) => author.name).join(", ")}</p>

          <div className="mt-6 max-w-3xl space-y-4 text-base leading-7">
            {detailDescription ? (
              <ExpandableBookDescription text={detailDescription} />
            ) : (
              <>
                <p className="muted">
                  Catalog metadata is still pending for this record. The prize history is available, but publisher,
                  ISBN, cover, page count, and summary fields may need source-backed enrichment.
                </p>
                <p className="muted">
                  Award history and subject assignments below are generated from the current imported prize records
                  and catalog evidence that has already been matched.
                </p>
              </>
            )}
          </div>

          {wikipediaEvidence ? <WikipediaReferencePanel evidence={wikipediaEvidence} /> : null}

          <div className="mt-6 flex flex-wrap gap-2.5">
            {book.primarySubject ? (
              <SubjectEvidenceHint book={book}>
                <SubjectPill index={0} subject={book.primarySubject} />
              </SubjectEvidenceHint>
            ) : null}
            {book.topics.map((topic, index) => <TopicTag isPrimary={topic === book.primaryTopic || index === 0} key={topic} topic={topic} />)}
          </div>
        </section>

        <aside className="book-detail-stats mt-6 text-sm lg:mt-14">
          <dl>
            <StatLine label="Awards won" value={String(stats.wins)} />
            <StatLine label="Shortlisted" value={String(stats.statuses.finalist + stats.statuses.shortlist)} />
            <StatLine label="Longlisted" value={String(stats.statuses.longlist)} />
            <StatLine label="First award year" value={String(firstAwardYear ?? "Unknown")} />
            <StatLine label="Latest recognition" value={String(latestRecognition ?? "Unknown")} />
            <StatLine label="Award score" value={String(stats.score)} />
          </dl>
          {book.nytBestseller ? <NytBestsellerPanel stats={book.nytBestseller} /> : null}
          <RetailerLinks book={book} />
        </aside>
      </section>

      <section className="border-t hairline">
        <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-8">
          <div className="py-8 lg:pr-10">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-[var(--font-serif)] text-2xl font-light">Award History</h2>
              <p className="font-[var(--font-mono)] text-xs muted">
                <span className="plain-number">{winsCount}</span> wins · <span className="plain-number">{appearances.length}</span> total
              </p>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.12em] muted">
                  <tr className="border-b hairline">
                    <th className="py-2 pr-4 font-normal">Award</th>
                    <th className="px-4 py-2 font-normal">Year</th>
                    <th className="px-4 py-2 font-normal">Result</th>
                    <th className="px-4 py-2 font-normal">Category / Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {appearances.map((appearance) => {
                    const award = awardsById.get(appearance.awardId);
                    const isMajor = award?.awardType === "major_award";
                    const isWinner = isWinningStatus(appearance.status);
                    return (
                      <tr className={`award-history-row border-b hairline text-sm ${isWinner ? "award-history-winner" : ""} ${isMajor ? "award-history-major" : ""}`} key={appearance.id}>
                        <td className="py-2 pl-3 pr-4">
                          {award ? (
                            <Link className="book-award-row-link transition hover:text-[var(--accent)]" href={`/awards/${award.slug}`}>
                              <span>{award.name}</span>
                              {isMajor ? <span className="award-major-pill">Major</span> : null}
                            </Link>
                          ) : null}
                        </td>
                        <td className="plain-number px-4 py-2 text-xs muted">{appearance.year}</td>
                        <td className={`px-4 py-2 ${isWinner ? "award-status-winner" : "award-status-secondary"}`}>{statusLabels[appearance.status]}</td>
                        <td className="px-4 py-2 muted">
                          {appearance.sourceUrl ? (
                            <a className="inline-flex items-center gap-1 hover:text-[var(--ink)]" href={appearance.sourceUrl}>
                              {sourceLabelForAppearance(appearance)} <ArrowUpRight size={12} />
                            </a>
                          ) : (
                            "Source URL pending"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Link
              className="focus-ring mt-5 inline-flex items-center gap-2 border hairline px-4 py-3 font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] transition hover:bg-[var(--accent-soft)]"
              href="/awards"
            >
              View all award history ({appearances.length})
              <ArrowUpRight size={13} />
            </Link>
          </div>

          <aside className="border-t hairline py-8 lg:border-l lg:border-t-0 lg:pl-10">
            <h2 className="font-[var(--font-serif)] text-2xl font-light">Browse connections</h2>
            <div className="mt-5 border-t hairline">
              {booksByAuthor.map((candidate) => (
                <ConnectionRow book={candidate} href={`/books/${candidate.slug}`} key={candidate.id} label={`Books by ${book.authors[0]?.name}`} meta="same author" />
              ))}
            </div>
            {relatedBooks.length ? (
              <div className="mt-8">
                <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Related books</h3>
                <div className="mt-3 border-t hairline">
                  {relatedBooks.map((candidate) => (
                    <ConnectionRow
                      book={candidate}
                      href={`/books/${candidate.slug}`}
                      key={candidate.id}
                      label={candidate.title}
                      meta={`${getBookStats(candidate.id).lists} records`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      {book.experimentalSemanticProfile ? (
        <ExperimentalSemanticProfilePanel profile={book.experimentalSemanticProfile} />
      ) : null}
    </main>
  );
}

function ExperimentalSemanticProfilePanel({ profile }: { profile: ExperimentalSemanticProfile }) {
  const flagged = profile.reviewStatus === "flagged";
  return (
    <section className="experimental-profile-section border-t hairline">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <details className="experimental-profile" open>
          <summary className="experimental-profile-summary focus-ring">
            <span className="min-w-0">
              <span className="experimental-profile-kicker">Experimental book profile</span>
              <span className="experimental-profile-disclosure">Generated by GPT-5.4 nano · may contain inaccuracies</span>
            </span>
            <span aria-hidden="true" className="experimental-profile-toggle">
              <span className="experimental-profile-toggle-open">View generated fields</span>
              <span className="experimental-profile-toggle-close">Close</span>
              <span className="experimental-profile-toggle-mark">+</span>
            </span>
          </summary>

          <div className="experimental-profile-body">
            <p className="experimental-profile-note">
              This is an unverified interpretation of the catalog description, offered as an opt-in discovery experiment—not as bibliographic fact.
              {flagged ? " Automated checks have flagged this profile for extra review." : ""}
            </p>

            <ol className="experimental-profile-grid">
              <li className="experimental-profile-field">
                <p className="experimental-profile-field-label"><span>01</span> Central figures</p>
                {profile.centralFigures.length ? (
                  <ExperimentalEntityList entities={profile.centralFigures} />
                ) : (
                  <LowerConfidenceEntityReveal entities={profile.lowerConfidenceCandidates?.centralFigures} />
                )}
                {profile.centralFigures.length && profile.lowerConfidenceCandidates?.centralFigures?.length ? (
                  <LowerConfidenceEntityReveal entities={profile.lowerConfidenceCandidates.centralFigures} hasAcceptedEntities />
                ) : null}
              </li>

              <li className="experimental-profile-field">
                <p className="experimental-profile-field-label"><span>02</span> Central places</p>
                {profile.centralPlaces.length ? (
                  <ExperimentalEntityList entities={profile.centralPlaces} />
                ) : (
                  <LowerConfidenceEntityReveal entities={profile.lowerConfidenceCandidates?.centralPlaces} />
                )}
                {profile.centralPlaces.length && profile.lowerConfidenceCandidates?.centralPlaces?.length ? (
                  <LowerConfidenceEntityReveal entities={profile.lowerConfidenceCandidates.centralPlaces} hasAcceptedEntities />
                ) : null}
              </li>

              <li className="experimental-profile-field">
                <p className="experimental-profile-field-label"><span>03</span> Suggested argument</p>
                {profile.argument.present ? (
                  <div className="experimental-profile-argument">
                    <p>{profile.argument.statement}</p>
                    <p className="plain-number experimental-profile-confidence">Model confidence {confidencePercent(profile.argument.confidence)}</p>
                  </div>
                ) : profile.lowerConfidenceCandidates?.argument ? (
                  <LowerConfidenceArgumentReveal argument={profile.lowerConfidenceCandidates.argument} />
                ) : <p className="experimental-profile-empty">No argument inferred with sufficient confidence.</p>}
              </li>

              <li className="experimental-profile-field">
                <p className="experimental-profile-field-label"><span>04</span> Reading orientation</p>
                <div className="experimental-profile-orientation">
                  <div>
                    <span className="plain-number experimental-profile-score">{Math.round(profile.academicOrientation.score)}</span>
                    <span className="muted"> / 100 academic</span>
                  </div>
                  <p>{academicOrientationLabel(profile.academicOrientation.score)}</p>
                  <p className="experimental-profile-empty">An estimate of intended readership and scholarly apparatus—not quality or importance.</p>
                </div>
              </li>
            </ol>

            <p className="experimental-profile-method">
              Confidence percentages are the model&apos;s own estimates. Profile confidence: <span className="plain-number">{confidencePercent(profile.profileConfidence)}</span>.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function ExperimentalEntityList({ entities }: { entities: ExperimentalSemanticEntity[] }) {
  return (
    <ul className="experimental-profile-entity-list">
      {entities.map((entity) => (
        <li key={entity.name}>
          <span>{entity.name}</span>
          <span className="plain-number muted">{confidencePercent(entity.confidence)}</span>
        </li>
      ))}
    </ul>
  );
}

function LowerConfidenceEntityReveal({
  entities,
  hasAcceptedEntities = false,
}: {
  entities?: ExperimentalSemanticEntity[];
  hasAcceptedEntities?: boolean;
}) {
  if (!entities?.length) return <p className="experimental-profile-empty">None extracted with sufficient confidence.</p>;
  return (
    <details className="experimental-profile-low-confidence">
      <summary>{hasAcceptedEntities ? "Show lower-confidence suggestions" : "None extracted with sufficient confidence."}</summary>
      <p>These suggestions did not meet the normal display threshold and are more likely to be wrong.</p>
      <ExperimentalEntityList entities={entities} />
    </details>
  );
}

function LowerConfidenceArgumentReveal({ argument }: { argument: { statement: string; confidence: number } }) {
  return (
    <details className="experimental-profile-low-confidence">
      <summary>No argument inferred with sufficient confidence.</summary>
      <p>This suggestion did not meet the normal display threshold and is more likely to be wrong.</p>
      <div className="experimental-profile-argument">
        <p>{argument.statement}</p>
        <p className="plain-number experimental-profile-confidence">Model confidence {confidencePercent(argument.confidence)}</p>
      </div>
    </details>
  );
}

function confidencePercent(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function academicOrientationLabel(score: number) {
  if (score <= 20) return "Popular trade";
  if (score <= 40) return "Serious trade";
  if (score <= 60) return "Trade / academic crossover";
  if (score <= 80) return "Academic";
  return "Specialist / reference";
}

function sourceLabelForAppearance(appearance: AwardAppearance) {
  const confidences = appearance.sourceIds
    .map((sourceId) => sourcesById.get(sourceId)?.confidence)
    .filter(Boolean);

  if (confidences.includes("official")) return "Official source";
  if (confidences.includes("secondary")) return "Secondary source";
  if (confidences.includes("catalog")) return "Catalog source";
  if (confidences.includes("manual")) return "Curated source";
  return "Source record";
}

function SubjectEvidenceHint({ book, children }: { book: Book; children: React.ReactNode }) {
  const decision = book.subjectEvidence;
  if (!decision) return <>{children}</>;
  const topCandidates = decision.candidates.slice(0, 3);
  const topEvidence = decision.evidence.slice(0, 3);
  return (
    <span className="subject-evidence-hint">
      {children}
      <span className="subject-evidence-tooltip" role="tooltip">
        <span className="subject-evidence-tooltip-title">{decision.primarySubject} · {decision.confidence} confidence</span>
        {decision.confidence === "low" ? (
          <span className="subject-evidence-tooltip-list">
            Catalog subject evidence is still thin for this record; the current assignment is provisional.
          </span>
        ) : null}
        <span className="subject-evidence-tooltip-grid">
          {topCandidates.map((candidate) => (
            <span className="subject-evidence-tooltip-row" key={candidate.subject}>
              <span>{candidate.subject}</span>
              <span className="plain-number">{candidate.score}</span>
              <span>{candidate.evidenceCount} signals</span>
            </span>
          ))}
        </span>
        <span className="subject-evidence-tooltip-list">
          {topEvidence.map((item) => (
            <span key={item.id}>{`${sourceLabel(item.source)}: ${item.rawLabel} -> ${item.mappedSubject}`}</span>
          ))}
        </span>
      </span>
    </span>
  );
}

function sourceLabel(source: NonNullable<Book["subjectEvidence"]>["evidence"][number]["source"]) {
  return source
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function WikipediaReferencePanel({ evidence }: { evidence: WikipediaBookEvidence }) {
  const excerpt = wikipediaExcerpt(evidence);
  return (
    <aside className="wikipedia-reference mt-5 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <p className="font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.18em] muted">Wikipedia</p>
        <a className="focus-ring inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.12em] muted transition hover:text-[var(--accent)]" href={evidence.url} rel="noreferrer" target="_blank">
          Article
          <ArrowUpRight size={11} />
        </a>
      </div>
      {excerpt ? <p className="wikipedia-reference-text mt-2">{excerpt}</p> : null}
      <p className="mt-2 text-[0.68rem] leading-4 muted">
        From <a className="book-detail-text-link" href={evidence.attribution.url} rel="noreferrer" target="_blank">{evidence.attribution.label}</a>
        {" "}under <a className="book-detail-text-link" href={evidence.attribution.licenseUrl} rel="noreferrer" target="_blank">{evidence.attribution.license}</a>.
      </p>
    </aside>
  );
}

function wikipediaExcerpt(evidence: WikipediaBookEvidence) {
  if (!evidence.extract) return undefined;
  const words = evidence.extract.replace(/\s+/g, " ").trim().split(/\s+/);
  return words.slice(0, 86).join(" ") + (words.length > 86 ? "..." : "");
}

function compareAwardAppearances(a: AwardAppearance, b: AwardAppearance) {
  const awardA = awardsById.get(a.awardId);
  const awardB = awardsById.get(b.awardId);
  const winnerDelta = Number(isWinningStatus(b.status)) - Number(isWinningStatus(a.status));
  if (winnerDelta) return winnerDelta;
  const majorDelta = Number(awardB?.awardType === "major_award") - Number(awardA?.awardType === "major_award");
  if (majorDelta) return majorDelta;
  return b.year - a.year || a.statusRank - b.statusRank || (awardA?.name ?? "").localeCompare(awardB?.name ?? "");
}

function isWinningStatus(status: AwardAppearance["status"]) {
  return status === "winner" || status === "co_winner";
}

function metadataValue(primary: string | undefined, fallback: string | undefined, missing: string) {
  if (primary) return primary;
  if (!fallback) return missing;
  return (
    <span className="metadata-fallback">
      {fallback}
      <span className="metadata-source">Wiki</span>
    </span>
  );
}

function detailPageDescription(book: Book) {
  const source = book.summary ?? book.displaySummary;
  if (!source) return undefined;
  return source.replace(/\s+/g, " ").trim();
}

function BookCover({ title, author, thumbnailUrl }: { title: string; author: string; thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    return <img className="book-detail-cover aspect-[0.72] w-full max-w-[14.5rem] border hairline object-cover" src={thumbnailUrl} alt={`Cover of ${title}`} />;
  }
  return (
    <div className="book-detail-cover aspect-[0.72] w-full max-w-[14.5rem] border hairline bg-[color-mix(in_srgb,var(--panel)_84%,var(--line))] p-6">
      <div className="flex h-full flex-col items-center justify-between border hairline p-5 text-center">
        <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.28em]">{title.slice(0, 52)}</p>
        <div className="h-20 w-20 rounded-full border hairline" />
        <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.2em] muted">{author.slice(0, 42)}</p>
      </div>
    </div>
  );
}

function RailMeta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.7rem_1fr] gap-3 border-b hairline py-1.5">
      <dt className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em] muted">{label}</dt>
      <dd className="plain-number text-right">{value}</dd>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-5 border-b hairline py-2.5">
      <dt className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function NytBestsellerPanel({ stats }: { stats: NonNullable<Book["nytBestseller"]> }) {
  const listLabel = stats.lists.map((list) => list.displayName).join(" · ");
  return (
    <div className="mt-5 border-t hairline pt-4">
      <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em]">New York Times bestseller</p>
      <p className="mt-1 text-xs muted">{listLabel}</p>
      <dl className="mt-2">
        <StatLine label="Best rank" value={`#${stats.bestRank}`} />
        <StatLine label="Weeks listed" value={String(stats.weeksOnList)} />
        <StatLine label="First listed" value={formatBestsellerDate(stats.firstPublishedDate)} />
        <StatLine label="Latest listing" value={formatBestsellerDate(stats.latestPublishedDate)} />
      </dl>
      <a
        className="mt-3 inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.12em] muted transition hover:text-[var(--ink)]"
        href="https://developer.nytimes.com/docs/books-product/1/overview"
        rel="noreferrer"
        target="_blank"
      >
        New York Times Books API <ArrowUpRight size={11} />
      </a>
    </div>
  );
}

function formatBestsellerDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date)
    : value;
}

function RetailerLinks({ book }: { book: Book }) {
  const links = retailerLinks(book);
  if (!links.length) return null;
  return (
    <div className="book-retailer-links">
      <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.18em] muted">Find this book</p>
      <div className="mt-3 flex flex-nowrap items-center gap-2">
        {links.map((link) => (
          <a
            aria-label={link.label}
            className="book-retailer-link focus-ring"
            href={link.href}
            key={link.label}
            rel="noreferrer"
            target="_blank"
            title={link.label}
          >
            <img alt="" src={link.icon} />
            <span className="book-retailer-tooltip" role="tooltip">{`Buy on ${link.label}`}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function retailerLinks(book: Book) {
  const query = encodeURIComponent([book.title, book.authors[0]?.name].filter(Boolean).join(" "));
  const isbn = book.isbn13[0];
  return [
    book.links.bookshop ? { label: "Bookshop.org", href: book.links.bookshop, icon: "/icons/bookshop.png" } : undefined,
    book.links.indiebound ? { label: "IndieBound", href: book.links.indiebound, icon: "/icons/indiebound.png" } : undefined,
    { label: "Barnes & Noble", href: `https://www.barnesandnoble.com/s/${encodeURIComponent(isbn ?? [book.title, book.authors[0]?.name].filter(Boolean).join(" "))}`, icon: "/icons/bn.png" },
    book.links.amazon ? { label: "Amazon", href: withAmazonAssociateTag(book.links.amazon), icon: "/icons/amazon.png" } : undefined,
  ].filter((link): link is { label: string; href: string; icon: string } => Boolean(link?.href) && Boolean(query || isbn));
}

function ConnectionRow({ book, href, label, meta }: { book?: Book; href: string; label: string; meta: string }) {
  return (
    <Link className="group flex items-center justify-between gap-4 border-b hairline py-3 text-sm transition hover:bg-[var(--panel)]" href={href}>
      <span className="flex min-w-0 items-center gap-3">
        {book ? <BookThumb book={book} /> : null}
        <span className="min-w-0">{label}</span>
      </span>
      <span className="flex items-center gap-2 font-[var(--font-mono)] text-xs muted">
        {meta}
        <ArrowUpRight size={12} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

function BookThumb({ book }: { book: Book }) {
  return (
    <span className="book-connection-thumb" aria-hidden="true">
      {book.thumbnailUrl ? <img alt="" src={book.thumbnailUrl} /> : <span>{book.title.trim()[0]?.toUpperCase() ?? "?"}</span>}
    </span>
  );
}

function SubjectPill({ subject, index }: { subject: string; index: number }) {
  const slug = rollupSubjectSlug(subject);
  return (
    <Link className={`subject-chip ${subjectChipClass(subject)} focus-ring rounded-full border hairline px-4 py-2 text-sm`} href={`/subjects/${slug}`}>
      {rollupSubjectName(subject)}
    </Link>
  );
}

function TopicTag({ topic, isPrimary }: { topic: string; isPrimary?: boolean }) {
  return (
    <Link className={`topic-tag focus-ring ${isPrimary ? "topic-tag-primary" : ""}`} href={`/books?topic=${encodeURIComponent(topic)}`}>
      {topic}
    </Link>
  );
}

function subjectChipClass(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("american history") || normalized.includes("world history") || normalized === "history") return "subject-chip-brick";
  if (normalized.includes("travel")) return "subject-chip-teal";
  if (normalized.includes("biography") || normalized.includes("memoir")) return "subject-chip-plum";
  if (normalized.includes("politics") || normalized.includes("journalism")) return "subject-chip-indigo";
  if (normalized.includes("society") || normalized.includes("race") || normalized.includes("gender") || normalized.includes("religion")) return "subject-chip-olive";
  if (normalized.includes("science") || normalized.includes("medicine") || normalized.includes("technology") || normalized.includes("nature")) return "subject-chip-slate";
  if (normalized.includes("business") || normalized.includes("arts") || normalized.includes("sports")) return "subject-chip-ochre";
  if (normalized.includes("war") || normalized.includes("crime") || normalized.includes("justice")) return "subject-chip-forest";
  return "subject-chip-teal";
}
