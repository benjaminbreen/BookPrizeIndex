"use client";

import Link from "next/link";
import { BookOpen, Check, ChevronLeft, ChevronRight, Clipboard, FileText, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { awardsById, getBookStats, imprintsById, publishersById, statusLabels, subjectsByName } from "@/lib/data";
import type { AwardAppearance, Book } from "@/lib/types";

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

  useEffect(() => {
    if (book) {
      setSnapshot({ book, appearances, currentLabel });
      setIsClosing(false);
      setHasEntered(false);
      setCitationCopied(false);
      const frame = window.requestAnimationFrame(() => setHasEntered(true));
      return () => window.cancelAnimationFrame(frame);
    }

    if (!snapshot) {
      setHasEntered(false);
      return;
    }

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

  if (!snapshot) return null;
  const renderedBook = snapshot.book;
  const renderedAppearances = book ? appearances : snapshot.appearances;
  const renderedCurrentLabel = book ? currentLabel : snapshot.currentLabel;
  const imprint = renderedBook.imprintId ? imprintsById.get(renderedBook.imprintId)?.name : undefined;
  const publisher = renderedBook.publisherId ? publishersById.get(renderedBook.publisherId)?.name : undefined;
  const stats = getBookStats(renderedBook.id);
  const sortedAppearances = [...renderedAppearances].sort((a, b) => b.year - a.year || a.statusRank - b.statusRank);
  const layerState = isClosing ? "is-closing" : hasEntered ? "is-open" : "is-entering";
  const citation = formatCitation(renderedBook, publisher);
  const summaryPreview = renderedBook.summary ? makeSummaryPreview(renderedBook.summary) : "";

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
      <aside className="book-drawer-panel absolute bottom-0 right-0 top-0 flex w-full max-w-[45rem] flex-col overflow-y-auto border-l hairline bg-[var(--paper)] p-5 shadow-2xl sm:p-7">
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

        <div className="book-drawer-section grid gap-7 border-b hairline pb-6 sm:grid-cols-[8.5rem_1fr]">
          <MiniCover
            title={renderedBook.title}
            author={renderedBook.authors.map((author) => author.name).join(", ")}
            href={`/books/${renderedBook.slug}`}
            thumbnailUrl={renderedBook.thumbnailUrl}
          />
          <div className="self-center">
            <h2 className="text-4xl font-medium leading-tight">{renderedBook.title}</h2>
            <p className="mt-4 text-xl muted">{renderedBook.authors.map((author) => author.name).join(", ")}</p>
            {summaryPreview ? (
              <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-base italic leading-7 muted">
                {summaryPreview}{" "}
                <Link className="book-detail-text-link font-[var(--font-sans)] text-sm not-italic" href={`/books/${renderedBook.slug}`}>
                  Read more
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className="book-drawer-section grid grid-cols-4 border-b hairline py-4 font-[var(--font-mono)] text-center text-xs">
          <Metric label="Wins" value={stats.wins} />
          <Metric label="Lists" value={stats.lists} />
          <Metric label="Score" value={stats.score} />
          <Metric label="Year" value={renderedBook.publicationYear ?? 0} />
        </div>

        <dl className="book-drawer-section grid border-b hairline py-3 text-sm sm:grid-cols-2">
          <div className="sm:border-r hairline sm:pr-6">
            <Meta label="Publisher" value={publisher ?? "Not yet sourced"} />
            <Meta label="Imprint" value={imprint ?? "Unknown"} />
            <div className="grid gap-2 border-b hairline py-3">
              <dt className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">Subjects</dt>
              <dd className="flex flex-wrap gap-2">
                {renderedBook.subjects.length ? renderedBook.subjects.map((subject, index) => <SubjectChip index={index} key={subject} subject={subject} />) : "Not yet classified"}
              </dd>
            </div>
          </div>
          <div className="sm:pl-6">
            <Meta label="Pages" value={renderedBook.pageCount ? `${renderedBook.pageCount} pp` : "Not yet sourced"} />
            <Meta label="ISBN" value={renderedBook.isbn13.join(", ") || "Not yet sourced"} />
            <Meta label="Language" value="English" />
          </div>
        </dl>

        <div className="book-drawer-section mt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Award history</h3>
            <p className="font-[var(--font-mono)] text-xs muted"><span className="plain-number">{sortedAppearances.length}</span> total</p>
          </div>
          <div className="mt-4 border hairline">
            {sortedAppearances.map((appearance) => {
              const award = awardsById.get(appearance.awardId);
              return (
                <Link
                  className="award-history-link grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b hairline px-4 py-3 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)]"
                  href={award ? `/awards/${award.slug}` : "#"}
                  key={appearance.id}
                >
                  <span>{award?.name}</span>
                  <span className="plain-number text-xs">{appearance.year}</span>
                  <span>{statusLabels[appearance.status]}</span>
                  <ChevronRight size={15} />
                </Link>
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
          <p className="mt-3 text-sm muted">Subjects</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {renderedBook.subjects.map((subject, index) => <SubjectChip index={index} key={subject} subject={subject} />)}
          </div>
          <div className="mt-6 flex items-start gap-3 text-sm muted">
            <BookOpen className="mt-1 shrink-0" size={17} />
            <p>Publisher summaries, cover thumbnails, page counts, and ISBNs will replace placeholders as enrichment sources are added.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r hairline px-3 last:border-r-0">
      <p className="uppercase tracking-[0.16em] muted">{label}</p>
      <p className="plain-number mt-2 text-2xl text-[var(--ink)]">{value || "—"}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b hairline py-3">
      <dt className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MiniCover({ title, author, href, thumbnailUrl }: { title: string; author: string; href: string; thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    return (
      <Link className="book-cover-lift focus-ring block w-32" href={href} aria-label={`Open full record for ${title}`}>
        <img className="book-cover-surface aspect-[0.72] w-full border hairline object-cover" src={thumbnailUrl} alt={`Cover of ${title}`} />
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
    <Link className={`subject-chip subject-chip-${index % 6} focus-ring rounded-full border hairline px-3 py-1 text-xs`} href={subjectSlug ? `/subjects/${subjectSlug}` : "/subjects"}>
      {subject}
    </Link>
  );
}

function dataSubjectSlug(subject: string) {
  return subjectsByName.get(subject.toLowerCase())?.slug;
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
