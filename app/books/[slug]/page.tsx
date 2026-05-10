import Link from "next/link";
import type React from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { awardsById, booksById, data, getBookStats, imprintsById, publishersById, statusLabels, subjectsByName } from "@/lib/data";
import type { Book } from "@/lib/types";

export function generateStaticParams() {
  return data.books.map((book) => ({ slug: book.slug }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const book = data.books.find((item) => item.slug === slug);
  return { title: book ? `${book.title} / The Book Prize Index` : "Book / The Book Prize Index" };
}

export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const book = data.books.find((item) => item.slug === slug);
  if (!book) notFound();
  const stats = getBookStats(book.id);
  const appearances = data.appearances
    .filter((appearance) => appearance.bookId === book.id)
    .sort((a, b) => b.year - a.year || a.statusRank - b.statusRank);
  const imprint = book.imprintId ? imprintsById.get(book.imprintId) : undefined;
  const publisher = book.publisherId ? publishersById.get(book.publisherId) : undefined;
  const firstAwardYear = appearances.length ? Math.min(...appearances.map((appearance) => appearance.year)) : undefined;
  const latestRecognition = appearances.length ? Math.max(...appearances.map((appearance) => appearance.year)) : undefined;
  const authorNames = new Set(book.authors.map((author) => author.name));
  const booksByAuthor = data.books
    .filter((candidate) => candidate.id !== book.id && candidate.authors.some((author) => authorNames.has(author.name)))
    .slice(0, 1);
  const relatedBooks = findRelatedBooks(book.id).slice(0, 4);
  const detailSummary = detailPageSummary(book);

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)_20rem] lg:items-start lg:px-8">
        <aside className="border-r-0 hairline lg:border-r lg:pr-7">
          <BookCover title={book.title} author={book.authors.map((author) => author.name).join(", ")} thumbnailUrl={book.thumbnailUrl} />
          <dl className="mt-4 grid text-[0.78rem]">
            <RailMeta label="Author" value={book.authors.map((author) => author.name).join(", ")} />
            <RailMeta label="Publisher" value={publisher?.name ?? "Not yet sourced"} />
            <RailMeta
              label="Imprint"
              value={imprint ? <Link className="book-detail-text-link" href={`/imprints/${imprint.id.replace(/^imprint-/, "")}`}>{imprint.name}</Link> : "Unknown"}
            />
            <RailMeta label="Publication year" value={String(book.publicationYear ?? "Unknown")} />
            <RailMeta label="Pages" value={book.pageCount ? String(book.pageCount) : "Not yet sourced"} />
            <RailMeta label="ISBN" value={book.isbn13.join(", ") || "Not yet sourced"} />
          </dl>
        </aside>

        <section className="min-w-0">
          <h1 className="font-[var(--font-serif)] text-5xl font-light leading-[1.02] sm:text-6xl">{book.title}</h1>
          {book.subtitle ? <p className="mt-3 text-2xl">{book.subtitle}</p> : null}
          <p className="mt-4 text-xl muted">{book.authors.map((author) => author.name).join(", ")}</p>

          <div className="mt-8 max-w-3xl space-y-5 text-base leading-8">
            {detailSummary ? (
              <p>{detailSummary}</p>
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

          <div className="mt-8 flex flex-wrap gap-3">
            {book.primarySubject ? <SubjectPill index={0} subject={book.primarySubject} /> : null}
            {book.topics.map((topic, index) => <TopicTag isPrimary={topic === book.primaryTopic || index === 0} key={topic} topic={topic} />)}
            <SubjectEvidenceHint book={book} />
          </div>
        </section>

        <aside className="book-detail-stats mt-8 text-sm lg:mt-28">
          <dl>
            <StatLine label="Awards won" value={String(stats.wins)} />
            <StatLine label="Shortlisted" value={String(stats.statuses.finalist + stats.statuses.shortlist)} />
            <StatLine label="Longlisted" value={String(stats.statuses.longlist)} />
            <StatLine label="First award year" value={String(firstAwardYear ?? "Unknown")} />
            <StatLine label="Latest recognition" value={String(latestRecognition ?? "Unknown")} />
            <StatLine label="Award score" value={String(stats.score)} />
          </dl>
          <RetailerLinks book={book} />
        </aside>
      </section>

      <section className="border-t hairline">
        <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-8">
          <div className="py-8 lg:pr-10">
            <h2 className="font-[var(--font-serif)] text-2xl font-light">Award History</h2>
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
                    return (
                      <tr className="border-b hairline text-sm" key={appearance.id}>
                        <td className="py-2 pr-4">
                          {award ? (
                            <Link className="transition hover:text-[var(--accent)]" href={`/awards/${award.slug}`}>
                              {award.name}
                            </Link>
                          ) : null}
                        </td>
                        <td className="plain-number px-4 py-2 text-xs muted">{appearance.year}</td>
                        <td className="px-4 py-2">{statusLabels[appearance.status]}</td>
                        <td className="px-4 py-2 muted">
                          {appearance.sourceUrl ? (
                            <a className="inline-flex items-center gap-1 hover:text-[var(--ink)]" href={appearance.sourceUrl}>
                              Official source <ArrowUpRight size={12} />
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
                <ConnectionRow href={`/books/${candidate.slug}`} key={candidate.id} label={`Books by ${book.authors[0]?.name}`} meta="same author" />
              ))}
            </div>
            {relatedBooks.length ? (
              <div className="mt-8">
                <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Related books</h3>
                <div className="mt-3 border-t hairline">
                  {relatedBooks.map((candidate) => (
                    <ConnectionRow
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
    </main>
  );
}

function SubjectEvidenceHint({ book }: { book: Book }) {
  const decision = book.subjectEvidence;
  if (!decision) return null;
  const topCandidates = decision.candidates.slice(0, 3);
  const topEvidence = decision.evidence.slice(0, 3);
  return (
    <span className="subject-evidence-hint">
      <button className="subject-evidence-trigger focus-ring" type="button" aria-label={`Subject assignment evidence for ${decision.primarySubject}`}>
        ?
      </button>
      <span className="subject-evidence-label">Subject assignment</span>
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

function detailPageSummary(book: Book) {
  const source = book.summary ?? book.displaySummary;
  if (!source) return undefined;
  const cleaned = source
    .replace(/\s+/g, " ")
    .replace(/\b(?:pulitzer prize winner|national book award winner|new york times bestseller)\b\s*[•:,-]?\s*/gi, " ")
    .replace(/[“"][^”"]{20,260}[”"]\s*\([^)]{3,120}\),?\s*/g, " ")
    .replace(/^from\b[\s\S]{20,420}?\b(long before|in this|this)\b/i, (_match, start: string) => start[0].toUpperCase() + start.slice(1))
    .replace(/\b(?:winner|finalist|shortlisted|longlisted)\s+of\s+[^.?!]+[.?!]/gi, " ")
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:["”])?/g) ?? [];
  const descriptiveSentences = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 35 && !/^(winner|finalist|shortlisted|longlisted|recipient)\b/i.test(sentence));
  const excerpt = descriptiveSentences.slice(0, 3).join(" ");
  if (excerpt.length >= 260) return excerpt;
  const fallback = cleaned.slice(0, 620).trim();
  return fallback.length > 180 ? fallback : book.displaySummary;
}

function BookCover({ title, author, thumbnailUrl }: { title: string; author: string; thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    return <img className="book-detail-cover aspect-[0.72] w-full max-w-[16rem] border hairline object-cover" src={thumbnailUrl} alt={`Cover of ${title}`} />;
  }
  return (
    <div className="book-detail-cover aspect-[0.72] w-full max-w-[16rem] border hairline bg-[color-mix(in_srgb,var(--panel)_84%,var(--line))] p-7">
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
    <div className="grid grid-cols-[6.2rem_1fr] gap-3 border-b hairline py-2">
      <dt className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em] muted">{label}</dt>
      <dd className="plain-number text-right">{value}</dd>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-5 border-b hairline py-3">
      <dt className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
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
    book.links.amazon ? { label: "Amazon", href: book.links.amazon, icon: "/icons/amazon.png" } : undefined,
  ].filter((link): link is { label: string; href: string; icon: string } => Boolean(link?.href) && Boolean(query || isbn));
}

function ConnectionRow({ href, label, meta }: { href: string; label: string; meta: string }) {
  return (
    <Link className="group flex items-center justify-between gap-4 border-b hairline py-3 text-sm transition hover:bg-[var(--panel)]" href={href}>
      <span>{label}</span>
      <span className="flex items-center gap-2 font-[var(--font-mono)] text-xs muted">
        {meta}
        <ArrowUpRight size={12} className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

function SubjectPill({ subject, index }: { subject: string; index: number }) {
  const slug = subjectsByName.get(subject.toLowerCase())?.slug ?? slugify(subject);
  return (
    <Link className={`subject-chip ${subjectChipClass(subject)} focus-ring rounded-full border hairline px-4 py-2 text-sm`} href={`/subjects/${slug}`}>
      {subject}
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

function findRelatedBooks(bookId: string) {
  const book = booksById.get(bookId);
  if (!book) return [];
  const subjectSet = new Set(book.subjects);
  const topicSet = new Set(book.topics);
  const awardSet = new Set(data.appearances.filter((appearance) => appearance.bookId === book.id).map((appearance) => appearance.awardId));
  return data.books
    .filter((candidate) => candidate.id !== book.id)
    .map((candidate) => ({
      candidate,
      score: relatedBookScore({ awardSet, book, candidate, subjectSet, topicSet }),
    }))
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title))
    .map((item) => item.candidate);
}

function subjectChipClass(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("american history") || normalized === "history") return "subject-chip-brick";
  if (normalized.includes("world history") || normalized.includes("travel")) return "subject-chip-teal";
  if (normalized.includes("biography") || normalized.includes("memoir")) return "subject-chip-plum";
  if (normalized.includes("politics") || normalized.includes("journalism")) return "subject-chip-indigo";
  if (normalized.includes("society") || normalized.includes("race") || normalized.includes("gender") || normalized.includes("religion")) return "subject-chip-olive";
  if (normalized.includes("science") || normalized.includes("medicine") || normalized.includes("technology") || normalized.includes("nature")) return "subject-chip-slate";
  if (normalized.includes("business") || normalized.includes("arts") || normalized.includes("sports")) return "subject-chip-ochre";
  if (normalized.includes("war") || normalized.includes("crime") || normalized.includes("justice")) return "subject-chip-forest";
  return "subject-chip-teal";
}

function relatedBookScore({
  awardSet,
  book,
  candidate,
  subjectSet,
  topicSet,
}: {
  awardSet: Set<string>;
  book: Book;
  candidate: Book;
  subjectSet: Set<string>;
  topicSet: Set<string>;
}) {
  const candidateAwards = data.appearances.filter((appearance) => appearance.bookId === candidate.id).map((appearance) => appearance.awardId);
  const sameAwardCount = candidateAwards.filter((awardId) => awardSet.has(awardId)).length;
  const topicOverlap = candidate.topics.filter((topic) => topicSet.has(topic)).length;
  const samePrimaryTopic = book.primaryTopic && candidate.primaryTopic === book.primaryTopic ? 1 : 0;
  const sameSubject = candidate.subjects.filter((subject) => subjectSet.has(subject)).length;
  const sameImprint = candidate.imprintId && candidate.imprintId === book.imprintId ? 1 : 0;
  return (
    samePrimaryTopic * 12 +
    topicOverlap * 4 +
    sameAwardCount * 2 +
    sameSubject * 2 +
    sameImprint +
    getBookStats(candidate.id).score / 50
  );
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
