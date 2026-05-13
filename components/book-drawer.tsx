"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Clipboard, ExternalLink, FileText, Link2, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { awardsById, getBookStats, imprintsById, publishersById, statusLabels, subjectsByName, wikipediaEvidenceByBook } from "@/lib/data";
import type { AwardAppearance, Book, WikipediaBookEvidence } from "@/lib/types";

const DRAWER_EXIT_MS = 360;

type BookDrawerSnapshot = {
  book: Book;
  appearances: AwardAppearance[];
  currentLabel?: string;
};

export function BookDrawer({
  book,
  appearances,
  currentLabel,
  onNext,
  onPrevious,
  onClose,
}: {
  book: Book | null;
  appearances: AwardAppearance[];
  currentLabel?: string;
  onNext?: () => void;
  onPrevious?: () => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<BookDrawerSnapshot | null>(() => book ? { book, appearances, currentLabel } : null);
  const [isClosing, setIsClosing] = useState(false);
  const [hasEntered, setHasEntered] = useState(Boolean(book));
  const [citationCopied, setCitationCopied] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const animatedBookIdRef = useRef<string | null>(book?.id ?? null);

  useEffect(() => {
    if (book) {
      const shouldAnimate = animatedBookIdRef.current !== book.id;
      animatedBookIdRef.current = book.id;
      setSnapshot({ book, appearances, currentLabel });
      setIsClosing(false);
      setCitationCopied(false);
      if (!shouldAnimate) return;
      setHasEntered(false);
      let secondFrame = 0;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setHasEntered(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }

    if (!snapshot) {
      setHasEntered(false);
      return;
    }

    animatedBookIdRef.current = null;
    setIsClosing(true);
    setHasEntered(false);
    const timeout = window.setTimeout(() => {
      setSnapshot(null);
      setIsClosing(false);
    }, DRAWER_EXIT_MS);

    return () => window.clearTimeout(timeout);
  }, [appearances, book, currentLabel]);

  useEffect(() => {
    if (!snapshot || isClosing) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft" && onPrevious) {
        event.preventDefault();
        onPrevious();
      }
      if (event.key === "ArrowRight" && onNext) {
        event.preventDefault();
        onNext();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isClosing, onClose, onNext, onPrevious, snapshot]);

  useEffect(() => {
    if (!book) return;
    panelRef.current?.scrollTo({ top: 0 });
  }, [book?.id]);

  if (!snapshot) return null;
  const renderedBook = snapshot.book;
  const renderedAppearances = book ? appearances : snapshot.appearances;
  const renderedCurrentLabel = book ? currentLabel : snapshot.currentLabel;
  const imprint = renderedBook.imprintId ? imprintsById.get(renderedBook.imprintId)?.name : undefined;
  const publisher = renderedBook.publisherId ? publishersById.get(renderedBook.publisherId)?.name : undefined;
  const stats = getBookStats(renderedBook.id);
  const wikipediaEvidence = wikipediaEvidenceByBook.get(renderedBook.id);
  const wikipediaInfobox = wikipediaEvidence?.infobox;
  const wikipediaUrl = renderedBook.links.wikipedia ?? wikipediaEvidence?.url;
  const sortedAppearances = sortAwardAppearances(renderedAppearances);
  const winsCount = sortedAppearances.filter((appearance) => isWinningStatus(appearance.status)).length;
  const layerState = isClosing ? "is-closing" : hasEntered ? "is-open" : "is-entering";
  const citation = formatCitation(renderedBook, publisher);
  const summaryPreview = renderedBook.displaySummary ?? renderedBook.summary ? makeSummaryPreview(renderedBook.displaySummary ?? renderedBook.summary ?? "") : "";

  function copyCitation() {
    setCitationCopied(true);
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(citation);
    }
    window.setTimeout(() => setCitationCopied(false), 1600);
  }

  return (
    <div className={`book-drawer-layer fixed inset-0 z-30 ${layerState}`}>
      <button aria-label="Close detail panel" className="book-drawer-backdrop absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <aside ref={panelRef} className="book-drawer-panel absolute bottom-0 right-0 top-0 flex w-full max-w-[45rem] flex-col overflow-y-auto border-l hairline bg-[var(--paper)] p-5 shadow-2xl sm:p-7">
        <div className="book-drawer-section mb-5 flex items-center justify-between">
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Book record</p>
          <div className="flex items-center gap-4">
            <button
              className="focus-ring grid h-10 w-10 place-items-center border hairline transition hover:bg-[var(--panel)] disabled:opacity-35"
              aria-label="Previous book"
              disabled={!onPrevious}
              onClick={onPrevious}
            >
              <ChevronLeft size={17} />
            </button>
            <p className="font-[var(--font-mono)] text-xs muted">{renderedCurrentLabel ?? "Record"}</p>
            <button
              className="focus-ring grid h-10 w-10 place-items-center border hairline transition hover:bg-[var(--panel)] disabled:opacity-35"
              aria-label="Next book"
              disabled={!onNext}
              onClick={onNext}
            >
              <ChevronRight size={17} />
            </button>
            <button className="focus-ring ml-3 grid h-10 w-10 place-items-center border hairline transition hover:bg-[var(--panel)]" onClick={onClose} aria-label="Close detail panel">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="book-drawer-section grid gap-6 border-b hairline pb-5 sm:grid-cols-[8.5rem_1fr]">
          <div className="grid content-start justify-items-start gap-3">
            <MiniCover
              title={renderedBook.title}
              author={renderedBook.authors.map((author) => author.name).join(", ")}
              href={`/books/${renderedBook.slug}`}
              thumbnailUrl={renderedBook.thumbnailUrl}
            />
            <Link
              className="focus-ring inline-flex w-32 items-center justify-center gap-2 border hairline px-3 py-2 text-sm transition hover:bg-[var(--panel)]"
              href={`/books/${renderedBook.slug}`}
            >
              <FileText size={15} />
              Full record
            </Link>
            {wikipediaUrl ? (
              <a
                className="focus-ring inline-flex w-32 items-center justify-center gap-2 border hairline px-3 py-2 text-sm transition hover:bg-[var(--panel)]"
                href={wikipediaUrl}
                rel="noreferrer"
                target="_blank"
              >
                <WikipediaMark />
                Wikipedia
              </a>
            ) : null}
          </div>
          <div className="self-center">
            <h2 className="text-[1.9rem] font-medium leading-[1.12] sm:text-[2.2rem]">{renderedBook.title}</h2>
            <p className="mt-2.5 text-lg muted">{renderedBook.authors.map((author) => author.name).join(", ")}</p>
            {summaryPreview ? (
              <p className="mt-3.5 max-w-2xl font-[var(--font-serif)] text-base italic leading-7 muted">
                {summaryPreview}{" "}
                <Link className="book-detail-text-link font-[var(--font-sans)] text-sm not-italic" href={`/books/${renderedBook.slug}`}>
                  Read more
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className="book-drawer-section grid grid-cols-4 border-b hairline py-3 font-[var(--font-mono)] text-center text-xs">
          <Metric label="Wins" value={stats.wins} />
          <Metric label="Lists" value={stats.lists} />
          <Metric label="Score" value={stats.score} />
          <Metric label="Year" value={renderedBook.publicationYear ?? 0} />
        </div>

        <dl className="book-drawer-section grid border-b hairline py-2 text-sm sm:grid-cols-2">
          <div className="sm:border-r hairline sm:pr-6">
            <Meta label="Publisher" value={metadataValue(publisher, wikipediaInfobox?.publisher, "Not yet sourced")} missing={!publisher && !wikipediaInfobox?.publisher} />
            <Meta label="Imprint" value={imprint ?? "Unknown"} missing={!imprint} />
            <div className="grid gap-2 border-b hairline py-2.5">
              <dt className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">Primary subject</dt>
              <dd className="flex flex-wrap gap-2">
                {renderedBook.primarySubject ? <SubjectChip index={0} subject={renderedBook.primarySubject} /> : <span className="book-missing-value">Not yet classified</span>}
              </dd>
            </div>
          </div>
          <div className="sm:pl-6">
            <Meta label="Pages" value={metadataValue(renderedBook.pageCount ? `${renderedBook.pageCount} pp` : undefined, wikipediaInfobox?.pages, "Not yet sourced")} missing={!renderedBook.pageCount && !wikipediaInfobox?.pages} />
            <Meta label="ISBN" value={metadataValue(renderedBook.isbn13.join(", ") || undefined, wikipediaInfobox?.isbn, "Not yet sourced")} missing={!renderedBook.isbn13.length && !wikipediaInfobox?.isbn} />
            <Meta label="Language" value="English" />
          </div>
        </dl>

        <div className="book-drawer-section mt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Award history</h3>
            <p className="font-[var(--font-mono)] text-xs muted">
              <span className="plain-number">{winsCount}</span> wins · <span className="plain-number">{sortedAppearances.length}</span> total
            </p>
          </div>
          <div className="mt-4 border hairline">
            {sortedAppearances.map((appearance) => {
              const award = awardsById.get(appearance.awardId);
              const isMajor = award?.awardType === "major_award";
              const isWinner = isWinningStatus(appearance.status);
              return (
                <div
                  className={`award-history-link grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b hairline px-4 py-3 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)] ${isWinner ? "award-history-winner" : ""} ${isMajor ? "award-history-major" : ""}`}
                  key={appearance.id}
                >
                  <Link className="award-history-award-title focus-ring transition hover:text-[var(--accent)]" href={award ? `/awards/${award.slug}` : "#"}>
                    <span>{award?.name}</span>
                    {isMajor ? <span className="award-major-pill">Major</span> : null}
                  </Link>
                  <span className="plain-number text-xs">{appearance.year}</span>
                  <span className={isWinner ? "award-status-winner" : "award-status-secondary"}>{statusLabels[appearance.status]}</span>
                  {appearance.sourceUrl ? (
                    <a
                      aria-label={`Open source for ${award?.name ?? "award record"}`}
                      className="focus-ring grid h-7 w-7 place-items-center text-[var(--muted)] transition hover:text-[var(--accent)]"
                      href={appearance.sourceUrl}
                      onClick={(event) => event.stopPropagation()}
                      rel="noreferrer"
                      target="_blank"
                      title="Source"
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : (
                    <span className="h-7 w-7" />
                  )}
                  <Link className="focus-ring grid h-7 w-7 place-items-center transition hover:text-[var(--accent)]" href={award ? `/awards/${award.slug}` : "#"} aria-label={`Open ${award?.name ?? "award"}`}>
                    <ChevronRight size={15} />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className="book-drawer-section mt-7">
          <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Quick actions</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link className="focus-ring inline-flex items-center justify-center gap-3 border hairline px-4 py-4 text-sm transition hover:bg-[var(--panel)]" href={`/books/${renderedBook.slug}`}>
              <FileText size={17} />
              Full record
            </Link>
            <a className="focus-ring inline-flex items-center justify-center gap-3 border hairline px-4 py-4 text-sm transition hover:bg-[var(--panel)]" href={renderedBook.links.worldcat ?? "#"} target="_blank" rel="noreferrer">
              <Link2 size={17} />
              Open links
            </a>
            <button className="focus-ring inline-flex items-center justify-center gap-3 border hairline px-4 py-4 text-sm transition hover:bg-[var(--panel)]" onClick={copyCitation}>
              {citationCopied ? <Check size={17} /> : <Clipboard size={17} />}
              {citationCopied ? "Copied" : "Copy citation"}
            </button>
          </div>
        </div>

        <div className="book-drawer-section mt-7 border-t hairline pt-5">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Related</h3>
            <Link className="inline-flex items-center gap-2 text-sm transition hover:text-[var(--accent)]" href="/subjects">
              View all subjects
              <ChevronRight size={15} />
            </Link>
          </div>
          <p className="mt-3 text-sm muted">All subjects</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {renderedBook.subjects.map((subject, index) => <SubjectChip index={index} key={subject} subject={subject} />)}
          </div>
          {renderedBook.topics.length ? (
            <>
              <p className="mt-5 text-sm muted">Topics</p>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
                {renderedBook.topics.map((topic, index) => <TopicTag isPrimary={topic === renderedBook.primaryTopic || index === 0} key={topic} topic={topic} />)}
              </div>
            </>
          ) : null}
          {wikipediaEvidence ? <WikipediaDrawerReference evidence={wikipediaEvidence} /> : null}
        </div>
      </aside>
    </div>
  );
}

function WikipediaDrawerReference({ evidence }: { evidence: WikipediaBookEvidence }) {
  const excerpt = wikipediaExcerpt(evidence);
  return (
    <div className="mt-6 border-t hairline pt-5">
      <div className="wikipedia-reference wikipedia-reference-compact">
        <div className="flex items-center justify-between gap-4">
          <p className="font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.18em] muted">Wikipedia</p>
          <a className="focus-ring inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.12em] muted transition hover:text-[var(--accent)]" href={evidence.url} rel="noreferrer" target="_blank">
            Article
            <ExternalLink size={11} />
          </a>
        </div>
        {excerpt ? <p className="wikipedia-reference-text mt-2">{excerpt}</p> : null}
        <p className="mt-2 text-[0.68rem] leading-4 muted">
          From <a className="book-detail-text-link" href={evidence.attribution.url} rel="noreferrer" target="_blank">{evidence.attribution.label}</a>.
        </p>
      </div>
    </div>
  );
}

function WikipediaMark() {
  return (
    <span className="wikipedia-action-mark" aria-hidden="true">
      W
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r hairline px-3 last:border-r-0">
      <p className="uppercase tracking-[0.16em] muted">{label}</p>
      <p className="plain-number mt-1.5 text-2xl text-[var(--ink)]">{value || "—"}</p>
    </div>
  );
}

function Meta({ label, value, missing }: { label: string; value: React.ReactNode; missing?: boolean }) {
  return (
    <div className="grid gap-1 border-b hairline py-2.5">
      <dt className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">{label}</dt>
      <dd className={missing ? "book-missing-value" : undefined}>{value}</dd>
    </div>
  );
}

function MiniCover({ title, author, href, thumbnailUrl }: { title: string; author: string; href: string; thumbnailUrl?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (thumbnailUrl && !imageFailed) {
    return (
      <Link className="book-cover-lift focus-ring block w-32" href={href} aria-label={`Open full record for ${title}`}>
        <img className="book-cover-surface aspect-[0.72] w-full border hairline object-cover" src={thumbnailUrl} alt={`Cover of ${title}`} onError={() => setImageFailed(true)} />
      </Link>
    );
  }
  return (
    <Link className="book-cover-lift focus-ring block aspect-[0.72] w-32 border hairline bg-[color-mix(in_srgb,var(--panel)_84%,var(--line))] p-4" href={href} aria-label={`Open full record for ${title}`}>
      <div className="book-cover-surface flex h-full flex-col items-center justify-between border hairline p-3 text-center">
        <p className="font-[var(--font-mono)] text-[0.58rem] uppercase tracking-[0.24em]">{title.slice(0, 34)}</p>
        <div className="h-11 w-11 rounded-full border hairline" />
        <p className="font-[var(--font-mono)] text-[0.52rem] uppercase tracking-[0.18em] muted">{author.slice(0, 28)}</p>
      </div>
    </Link>
  );
}

function SubjectChip({ subject, index }: { subject: string; index: number }) {
  const subjectSlug = dataSubjectSlug(subject);
  return (
    <Link className={`subject-chip ${subjectChipClass(subject)} focus-ring rounded-full border hairline px-3 py-1 text-xs`} href={subjectSlug ? `/subjects/${subjectSlug}` : "/subjects"}>
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

function dataSubjectSlug(subject: string) {
  return subjectsByName.get(subject.toLowerCase())?.slug;
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

function formatCitation(book: Book, publisher?: string) {
  const authors = book.authors.map((author) => author.name).join(", ");
  const year = book.publicationYear ? ` (${book.publicationYear}).` : ".";
  const publisherText = publisher ? ` ${publisher}.` : "";
  return `${authors}.${year} ${book.title}.${publisherText}`.replace(/\s+/g, " ").trim();
}

function makeSummaryPreview(summary: string) {
  const cleaned = summary.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 230) return cleaned;
  const clipped = cleaned.slice(0, 230);
  const sentenceBreak = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (sentenceBreak > 120) return `${clipped.slice(0, sentenceBreak + 1)}`;
  return `${clipped.replace(/[,;:\s]+$/, "")}...`;
}

function wikipediaExcerpt(evidence: WikipediaBookEvidence) {
  if (!evidence.extract) return undefined;
  const words = evidence.extract.replace(/\s+/g, " ").trim().split(/\s+/);
  return words.slice(0, 58).join(" ") + (words.length > 58 ? "..." : "");
}

function sortAwardAppearances(appearances: AwardAppearance[]) {
  return [...appearances].sort((a, b) => {
    const awardA = awardsById.get(a.awardId);
    const awardB = awardsById.get(b.awardId);
    const winnerDelta = Number(isWinningStatus(b.status)) - Number(isWinningStatus(a.status));
    if (winnerDelta) return winnerDelta;
    const majorDelta = Number(awardB?.awardType === "major_award") - Number(awardA?.awardType === "major_award");
    if (majorDelta) return majorDelta;
    return b.year - a.year || a.statusRank - b.statusRank || (awardA?.name ?? "").localeCompare(awardB?.name ?? "");
  });
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
