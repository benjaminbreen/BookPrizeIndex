import Link from "next/link";
import { AuthorLinks } from "@/components/author-links";
import { browseBooksById } from "@/lib/browse-data";
import type { AwardAppearance } from "@/lib/types";

const statusLabels: Record<AwardAppearance["status"], string> = {
  winner: "Winner",
  co_winner: "Co-winner",
  finalist: "Finalist",
  shortlist: "Shortlist",
  longlist: "Longlist",
  honorable_mention: "Honorable mention",
  commended: "Commended",
  notable: "Notable",
  unknown: "Listed",
};

export function AwardBookList({ appearances }: { appearances: AwardAppearance[] }) {
  const rows = appearances
    .map((appearance) => ({ appearance, book: browseBooksById.get(appearance.bookId) }))
    .filter((row): row is { appearance: AwardAppearance; book: NonNullable<typeof row.book> } => Boolean(row.book));

  return (
    <>
      <div className="mt-4 grid border-y hairline md:hidden">
        {rows.map(({ appearance, book }) => {
          const isWinner = appearance.status === "winner" || appearance.status === "co_winner";
          return (
            <div
              className="book-mobile-card block border-b hairline p-4 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)]"
              key={appearance.id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link className="focus-ring text-lg font-medium leading-tight transition hover:text-[var(--accent)]" href={`/books/${book.slug}`}>{book.title}</Link>
                  <AuthorLinks authors={book.authors} className="mt-1 text-sm leading-5 muted" />
                </div>
                <span className="plain-number shrink-0 font-[var(--font-mono)] text-xs muted">{appearance.year}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t hairline pt-3">
                <div>
                  <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Result</p>
                  <p className={`mt-1 ${isWinner ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}>{statusLabels[appearance.status]}</p>
                </div>
                <div>
                  <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.14em] muted">Imprint</p>
                  <p className="mt-1 muted">{book.imprint ?? "Unknown"}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.12em] muted">
            <tr className="border-b hairline">
              <th className="py-2 pr-4 font-normal">Year</th>
              <th className="px-4 py-2 font-normal">Result</th>
              <th className="px-4 py-2 font-normal">Book</th>
              <th className="px-4 py-2 font-normal">Author</th>
              <th className="px-4 py-2 font-normal">Imprint</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ appearance, book }) => {
              const isWinner = appearance.status === "winner" || appearance.status === "co_winner";
              return (
                <tr className="book-table-row border-b hairline text-sm transition hover:bg-[var(--accent-soft)]" key={appearance.id}>
                  <td className="plain-number py-2 pr-4 text-xs muted">{appearance.year}</td>
                  <td className={`px-4 py-2 ${isWinner ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                    {statusLabels[appearance.status]}
                  </td>
                  <td className="px-4 py-2">
                    <Link className="focus-ring transition hover:text-[var(--accent)]" href={`/books/${book.slug}`}>
                      {book.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 muted"><AuthorLinks authors={book.authors} /></td>
                  <td className="px-4 py-2 muted">{book.imprint ?? "Unknown"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
