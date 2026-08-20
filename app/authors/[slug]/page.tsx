import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";
import { BrowseTrailWriter } from "@/components/browse-trail-writer";
import { authorProfileFor, authors, authorsBySlug, booksByAuthorId } from "@/lib/authors";
import { authorPlatformLinksFor } from "@/lib/author-platform-links";
import { appearancesByBookId, awardProgramsById, awardsById, getBookStats, imprintsById } from "@/lib/data";
import { pageMetadata } from "@/lib/site-metadata";
import { rollupSubjectName, rollupSubjectSlug } from "@/lib/subject-rollup";
import type { Book, Person } from "@/lib/types";

export const dynamicParams = true;
// Only the top pages are prerendered; caching the rest keeps sitemap crawls from
// re-rendering thousands of cold routes.
export const revalidate = 86400;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return authors
    .filter((author) => authorProfileFor(author))
    .sort((a, b) => (authorProfileFor(a)?.rank ?? Number.MAX_SAFE_INTEGER) - (authorProfileFor(b)?.rank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 250)
    .map((author) => ({ slug: author.id.replace(/^person-/, "") }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const author = authorsBySlug.get(slug);
  if (!author) return { title: "Author not found / The Book Prize Index" };
  const books = booksByAuthorId.get(author.id) ?? [];
  return pageMetadata({
    title: `${author.name} / The Book Prize Index`,
    description: `Explore ${books.length} prize-recognized ${books.length === 1 ? "book" : "books"} by ${author.name}, with award results, subjects, and recognition history.`,
    canonical: `/authors/${slug}`,
  });
}

export default async function AuthorPage({ params }: PageProps) {
  const { slug } = await params;
  const author = authorsBySlug.get(slug);
  if (!author) notFound();

  const books = [...(booksByAuthorId.get(author.id) ?? [])]
    .sort((a, b) => getBookStats(b.id).score - getBookStats(a.id).score || (b.publicationYear ?? 0) - (a.publicationYear ?? 0));
  const profile = authorProfileFor(author);
  const platforms = authorPlatformLinksFor([author]);
  const appearances = books.flatMap((book) => appearancesByBookId.get(book.id) ?? []);
  const metrics = books.reduce((total, book) => {
    const stats = getBookStats(book.id);
    return {
      wins: total.wins + stats.wins,
      lists: total.lists + stats.lists,
      score: total.score + stats.score,
    };
  }, { wins: 0, lists: 0, score: 0 });
  const recognitionYears = appearances.map((appearance) => appearance.year);
  const firstYear = recognitionYears.length ? Math.min(...recognitionYears) : undefined;
  const latestYear = recognitionYears.length ? Math.max(...recognitionYears) : undefined;
  const subjectRows = countValues(
    books.flatMap((book) => book.primarySubject ? [rollupSubjectName(book.primarySubject)] : []),
  ).slice(0, 5);
  const topSubjectCount = subjectRows[0]?.count ?? 1;
  const programRows = countValues(appearances.flatMap((appearance) => {
    const award = awardsById.get(appearance.awardId);
    const program = award?.programId ? awardProgramsById.get(award.programId) : undefined;
    return [program?.name ?? award?.name].filter((value): value is string => Boolean(value));
  })).slice(0, 5);
  const countries = [...new Set(profile?.countryConnections.map((country) => country.countryName) ?? [])];
  const description = authorDescription(author, profile?.description, countries);

  return (
    <main className="author-page">
      <BrowseTrailWriter label="this author" slugs={books.map((book) => book.slug)} />
      <section className="author-profile-hero mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <p className="author-profile-kicker">Authors / {author.id}</p>
        <div className="author-profile-intro mt-5">
          <AuthorPortrait author={author} imageSourceUrl={profile?.imageSourceUrl} imageUrl={profile?.imageUrl} />
          <div className="min-w-0">
            <h1>{author.name}</h1>
            <p className="author-profile-deck">{description}</p>
            <div className="author-profile-actions">
              {profile?.wikipediaUrl ? (
                <a className="author-profile-text-link focus-ring" href={profile.wikipediaUrl} rel="noreferrer" target="_blank">
                  Wikipedia <ArrowUpRight size={13} />
                </a>
              ) : null}
              {platforms.map((platform) => (
                <a className="author-substack-action focus-ring" href={platform.url} key={platform.url} rel="noreferrer" target="_blank">
                  <span aria-hidden="true">S</span>
                  {platform.title ?? `${author.name} on Substack`}
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
            {profile?.imageSourceUrl ? (
              <a className="author-image-credit" href={profile.imageSourceUrl} rel="noreferrer" target="_blank">
                Portrait source · Wikimedia Commons
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="author-metric-band border-y hairline">
        <div className="author-metric-grid mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AuthorMetric label="Recognized books" value={books.length} />
          <AuthorMetric label="Wins" value={metrics.wins} />
          <AuthorMetric label="Lists" value={metrics.lists} />
          <AuthorMetric label="Index score" value={metrics.score} />
          <AuthorMetric label="Recognition span" value={firstYear && latestYear ? `${firstYear}—${latestYear}` : "—"} />
        </div>
      </section>

      <section className="author-analysis mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <p className="author-section-label">Author in the index</p>
          <p className="mt-4 max-w-xl text-base leading-7 muted">
            {author.name} {books.length === 1 ? "has one book" : `has ${books.length} books`} in the current index
            {firstYear && latestYear ? `, recognized by prize programs between ${firstYear} and ${latestYear}` : ""}.
            {programRows.length ? ` The records span ${programRows.length} leading ${programRows.length === 1 ? "prize family" : "prize families"} shown here.` : ""}
          </p>
          {programRows.length ? (
            <div className="author-recognition-list mt-6">
              <p className="author-section-label">Top recognition</p>
              {programRows.map((row) => (
                <div key={row.name}>
                  <span>{row.name}</span>
                  <span className="plain-number">{row.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p className="author-section-label">Subject profile</p>
          <div className="author-subject-profile mt-4">
            {subjectRows.map((row) => {
              const subjectSlug = rollupSubjectSlug(row.name);
              return (
                <div key={row.name}>
                  <Link href={subjectSlug ? `/subjects/${subjectSlug}` : "/subjects"}>{row.name}</Link>
                  <span className="author-subject-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(12, (row.count / topSubjectCount) * 100)}%` }} />
                  </span>
                  <span className="plain-number">{row.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="author-books-section border-t hairline">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="author-books-heading">
            <div>
              <p className="author-section-label">Indexed works</p>
              <h2>Books by {author.name}</h2>
            </div>
            <p><span className="plain-number">{books.length}</span> {books.length === 1 ? "book" : "books"} · sorted by recognition</p>
          </div>
          <AuthorBookList author={author} books={books} />
        </div>
      </section>

      <section className="border-t hairline">
        <div className="author-profile-source mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <p>
            Prize metrics come from Book Prize Index records. Biographical description and portrait metadata are
            sourced from the matched Wikidata and Wikimedia records; uncertain identity matches are omitted.
          </p>
          <Link href="/methodology">Read the methodology</Link>
        </div>
      </section>
    </main>
  );
}

function AuthorPortrait({
  author,
  imageSourceUrl,
  imageUrl,
}: {
  author: Person;
  imageSourceUrl?: string;
  imageUrl?: string;
}) {
  const portrait = (
    <span className="author-portrait">
      <span aria-hidden="true">{initials(author.name)}</span>
      {imageUrl ? <img alt={`Portrait of ${author.name}`} src={imageUrl} /> : null}
    </span>
  );
  return imageSourceUrl ? <a className="focus-ring" href={imageSourceUrl} rel="noreferrer" target="_blank">{portrait}</a> : portrait;
}

function AuthorMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="author-metric-value plain-number">{value}</p>
      <p className="author-section-label">{label}</p>
    </div>
  );
}

function AuthorBookList({ author, books }: { author: Person; books: Book[] }) {
  return (
    <>
      <div className="author-book-cards">
        {books.map((book) => {
          const stats = getBookStats(book.id);
          return (
            <Link className="author-book-card" href={`/books/${book.slug}`} key={book.id}>
              <BookCover book={book} />
              <span className="min-w-0">
                <strong>{book.title}</strong>
                {book.subtitle ? <span>{book.subtitle}</span> : null}
                <span>{book.primarySubject ? rollupSubjectName(book.primarySubject) : "Subject pending"}</span>
              </span>
              <span className="author-book-card-stats">
                <span className="plain-number">{book.publicationYear ?? "—"}</span>
                <span className="plain-number">{stats.score} pts</span>
              </span>
            </Link>
          );
        })}
      </div>
      <div className="author-book-table-wrap">
        <table className="author-book-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Title</th>
              <th>Subject</th>
              <th>Score</th>
              <th>Wins</th>
              <th>Lists</th>
              <th>Imprint</th>
            </tr>
          </thead>
          <tbody>
            {books.map((book) => {
              const stats = getBookStats(book.id);
              const imprint = book.imprintId ? imprintsById.get(book.imprintId) : undefined;
              return (
                <tr key={book.id}>
                  <td className="plain-number">{book.publicationYear ?? "—"}</td>
                  <td>
                    <Link className="author-book-title-link" href={`/books/${book.slug}`}>
                      <BookCover book={book} />
                      <span>
                        <strong>{book.title}</strong>
                        {book.subtitle ? <small>{book.subtitle}</small> : null}
                      </span>
                    </Link>
                  </td>
                  <td>{book.primarySubject ? rollupSubjectName(book.primarySubject) : "Unknown"}</td>
                  <td className="plain-number">{stats.score}</td>
                  <td className="plain-number">{stats.wins}</td>
                  <td className="plain-number">{stats.lists}</td>
                  <td>{imprint?.name ?? "Unknown"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sr-only">All books on this page are credited to {author.name}.</p>
    </>
  );
}

function BookCover({ book }: { book: Book }) {
  return (
    <span className="author-book-cover" aria-hidden="true">
      {book.thumbnailUrl ? <img loading="lazy" decoding="async" alt="" src={book.thumbnailUrl} /> : <span>{book.title.charAt(0)}</span>}
    </span>
  );
}

function countValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function authorDescription(author: Person, description: string | undefined, countries: string[]) {
  if (description) {
    const sentence = description.charAt(0).toUpperCase() + description.slice(1).replace(/[.]?$/, ".");
    return sentence;
  }
  if (countries.length) return `${author.name} is connected with ${countries.join(" and ")} in the matched public author record.`;
  return `Explore the prize-recognized books by ${author.name} represented in the index.`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
}
