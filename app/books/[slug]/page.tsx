import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { awardsById, booksById, data, getBookStats, imprintsById, publishersById, statusLabels } from "@/lib/data";

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
  const relatedSubjects = data.subjects.filter((subject) => book.subjects.includes(subject.name)).slice(0, 5);
  const authorNames = new Set(book.authors.map((author) => author.name));
  const booksByAuthor = data.books
    .filter((candidate) => candidate.id !== book.id && candidate.authors.some((author) => authorNames.has(author.name)))
    .slice(0, 1);
  const relatedBooks = findRelatedBooks(book.id).slice(0, 4);
  const subjectValue = book.subjects.length ? book.subjects.join(", ") : "Not yet classified";

  return (
    <main>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[19rem_1fr] lg:px-8">
        <aside className="border-r-0 hairline lg:border-r lg:pr-8">
          <BookCover title={book.title} author={book.authors.map((author) => author.name).join(", ")} thumbnailUrl={book.thumbnailUrl} />
          <dl className="mt-4 grid text-[0.78rem]">
            <RailMeta label="Author" value={book.authors.map((author) => author.name).join(", ")} />
            <RailMeta label="Publisher" value={publisher?.name ?? "Not yet sourced"} />
            <RailMeta label="Imprint" value={imprint?.name ?? "Unknown"} />
            <RailMeta label="Publication year" value={String(book.publicationYear ?? "Unknown")} />
            <RailMeta label="Pages" value={book.pageCount ? String(book.pageCount) : "Not yet sourced"} />
            <RailMeta label="ISBN" value={book.isbn13.join(", ") || "Not yet sourced"} />
            <RailMeta label="Subjects" value={subjectValue} />
          </dl>
        </aside>

        <section>
          <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
            <div>
              <h1 className="font-[var(--font-serif)] text-5xl font-light leading-[1.02] sm:text-6xl">{book.title}</h1>
              {book.subtitle ? <p className="mt-3 text-2xl">{book.subtitle}</p> : null}
              <p className="mt-4 text-xl muted">{book.authors.map((author) => author.name).join(", ")}</p>

              <div className="mt-8 max-w-3xl space-y-5 text-base leading-8">
                {book.summary ? (
                  <p>{book.summary}</p>
                ) : (
                  <>
                    <p className="muted">
                      Publisher summary has not yet been sourced for this record. The detail page is ready to display a
                      concise sourced summary once the enrichment pipeline adds publisher-page data.
                    </p>
                    <p className="muted">
                      Award history, imprint data, search links, and subject assignments below are generated from the
                      current imported prize records.
                    </p>
                  </>
                )}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {book.subjects.map((subject) => (
                  <Link
                    className="focus-ring border hairline px-4 py-2 text-sm transition hover:bg-[var(--accent-soft)]"
                    href={`/subjects/${slugify(subject)}`}
                    key={subject}
                  >
                    {subject}
                  </Link>
                ))}
              </div>
            </div>

            <dl className="self-end text-sm lg:pt-20">
              <StatLine label="Awards won" value={String(stats.wins)} />
              <StatLine label="Shortlisted" value={String(stats.statuses.finalist + stats.statuses.shortlist)} />
              <StatLine label="Longlisted" value={String(stats.statuses.longlist)} />
              <StatLine label="First award year" value={String(firstAwardYear ?? "Unknown")} />
              <StatLine label="Latest recognition" value={String(latestRecognition ?? "Unknown")} />
              <StatLine label="Publisher" value={publisher?.name ?? "Not yet sourced"} />
              <StatLine label="Imprint" value={imprint?.name ?? "Unknown"} />
            </dl>
          </div>
        </section>
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
              {relatedSubjects.map((subject) => (
                <ConnectionRow href={`/subjects/${subject.slug}`} key={subject.id} label={subject.name} meta={`${subject.bookCount} books`} />
              ))}
              {booksByAuthor.map((candidate) => (
                <ConnectionRow href={`/books/${candidate.slug}`} key={candidate.id} label={`Books by ${book.authors[0]?.name}`} meta="same author" />
              ))}
              {imprint ? (
                <ConnectionRow
                  href={`/publishers/${imprint.id.replace(/^imprint-/, "")}`}
                  label={`Books from ${imprint.name}`}
                  meta={`${data.books.filter((candidate) => candidate.imprintId === imprint.id).length} books`}
                />
              ) : null}
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

function BookCover({ title, author, thumbnailUrl }: { title: string; author: string; thumbnailUrl?: string }) {
  if (thumbnailUrl) {
    return <img className="aspect-[0.72] w-full max-w-[16rem] border hairline object-cover shadow-sm" src={thumbnailUrl} alt={`Cover of ${title}`} />;
  }
  return (
    <div className="aspect-[0.72] w-full max-w-[16rem] border hairline bg-[color-mix(in_srgb,var(--panel)_84%,var(--line))] p-7 shadow-sm">
      <div className="flex h-full flex-col items-center justify-between border hairline p-5 text-center">
        <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.28em]">{title.slice(0, 52)}</p>
        <div className="h-20 w-20 rounded-full border hairline" />
        <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.2em] muted">{author.slice(0, 42)}</p>
      </div>
    </div>
  );
}

function RailMeta({ label, value }: { label: string; value: string }) {
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

function findRelatedBooks(bookId: string) {
  const book = booksById.get(bookId);
  if (!book) return [];
  const subjectSet = new Set(book.subjects);
  return data.books
    .filter((candidate) => candidate.id !== book.id)
    .map((candidate) => ({
      candidate,
      score:
        candidate.subjects.filter((subject) => subjectSet.has(subject)).length * 3 +
        (candidate.imprintId && candidate.imprintId === book.imprintId ? 1 : 0) +
        getBookStats(candidate.id).score / 20,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title))
    .map((item) => item.candidate);
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
