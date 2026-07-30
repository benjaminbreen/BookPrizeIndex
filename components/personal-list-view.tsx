import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PersonalListExportActions } from "@/components/personal-list-export-actions";
import type { PersonalListSnapshot } from "@/lib/personal-list";

export function PersonalListView({ snapshot }: { snapshot: PersonalListSnapshot }) {
  return (
    <main className="personal-reading-list-page">
      <div className="personal-reading-list mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <header className="personal-reading-list-header">
          <div className="min-w-0">
            <p className="personal-reading-list-byline">
              {snapshot.creatorName ? `${possessiveName(snapshot.creatorName)} reading list` : "Shared reading list"}
            </p>
            <h1 className="max-w-4xl font-[var(--font-serif)] text-5xl font-light leading-[1.02] tracking-[-0.025em] sm:text-6xl">
              {snapshot.title}
            </h1>
            {snapshot.introduction ? <div className="personal-reading-list-introduction">{snapshot.introduction}</div> : null}
            <p className="personal-reading-list-count">
              {snapshot.results.length.toLocaleString()} {snapshot.results.length === 1 ? "book" : "books"}
            </p>
          </div>
          <PersonalListExportActions snapshot={snapshot} />
        </header>

        <section aria-label="Books in this reading list" className="personal-reading-list-results">
          <ol className="semantic-list-books">
            {snapshot.results.map((book, index) => (
              <li className="personal-reading-list-book" key={book.bookId}>
                <span className="semantic-list-rank">{String(index + 1).padStart(2, "0")}</span>
                <Link className="semantic-list-cover focus-ring" href={`/books/${book.slug}`} aria-label={`Open ${book.title}`}>
                  {book.thumbnailUrl ? <img alt="" src={book.thumbnailUrl} /> : <span>{book.title.charAt(0)}</span>}
                </Link>
                <div className="min-w-0">
                  <Link className="semantic-list-book-title focus-ring" href={`/books/${book.slug}`}>{book.title}</Link>
                  <p className="mt-1 text-sm muted">{book.author}{book.publicationYear ? ` · ${book.publicationYear}` : ""}</p>
                </div>
                <div className="semantic-list-book-meta">
                  {book.primarySubject ? <span>{book.primarySubject}</span> : null}
                </div>
                <Link aria-label={`Open ${book.title}`} className="semantic-list-book-arrow focus-ring" href={`/books/${book.slug}`}>
                  <ArrowRight size={15} />
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <footer className="personal-reading-list-footer">
          <p>Discover more prize-recognized nonfiction in The Book Prize Index.</p>
          <Link className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" href="/books">
            Explore the index
            <ArrowRight size={14} />
          </Link>
        </footer>
      </div>
    </main>
  );
}

function possessiveName(name: string) {
  return `${name}’s`;
}
