"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import { booksById, data, imprintsById, statusLabels } from "@/lib/data";
import type { AwardAppearance, Book } from "@/lib/types";

export function AwardBookList({ appearances }: { appearances: AwardAppearance[] }) {
  const rows = useMemo(
    () =>
      appearances
        .map((appearance) => ({ appearance, book: booksById.get(appearance.bookId) }))
        .filter((row): row is { appearance: AwardAppearance; book: Book } => Boolean(row.book)),
    [appearances],
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedRow = selectedIndex === null ? null : rows[selectedIndex] ?? null;
  const selectedBook = selectedRow?.book ?? null;

  const goPrevious = selectedIndex !== null && selectedIndex > 0 ? () => openRow(selectedIndex - 1) : undefined;
  const goNext = selectedIndex !== null && selectedIndex < rows.length - 1 ? () => openRow(selectedIndex + 1) : undefined;

  useEffect(() => {
    const slug = searchParams.get("book");
    if (!slug) {
      setSelectedIndex(null);
      return;
    }

    const index = rows.findIndex((row) => row.book.slug === slug);
    setSelectedIndex(index >= 0 ? index : null);
  }, [rows, searchParams]);

  function setBookParam(bookSlug: string | null) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (bookSlug) {
      nextParams.set("book", bookSlug);
    } else {
      nextParams.delete("book");
    }
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function openRow(index: number) {
    const row = rows[index];
    if (!row) return;
    setSelectedIndex(index);
    setBookParam(row.book.slug);
  }

  function closeBook() {
    setSelectedIndex(null);
    setBookParam(null);
  }

  return (
    <>
      <div className="mt-4 grid border-y hairline md:hidden">
        {rows.map(({ appearance, book }, index) => {
          const isWinner = appearance.status === "winner" || appearance.status === "co_winner";
          return (
            <div
              className={`book-mobile-card cursor-pointer border-b hairline p-4 text-sm transition last:border-b-0 hover:bg-[var(--accent-soft)] ${
                selectedIndex === index ? "book-table-row-active" : ""
              }`}
              key={appearance.id}
              onClick={() => openRow(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openRow(index);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-lg font-medium leading-tight">{book.title}</p>
                  <p className="mt-1 text-sm leading-5 muted">{book.authors.map((author) => author.name).join(", ")}</p>
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
                  <p className="mt-1 muted">{displayImprint(book.imprintId)}</p>
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
            {rows.map(({ appearance, book }, index) => {
              const isWinner = appearance.status === "winner" || appearance.status === "co_winner";
              return (
                <tr
                  className={`book-table-row cursor-pointer border-b hairline text-sm transition hover:bg-[var(--accent-soft)] ${
                    selectedIndex === index ? "book-table-row-active" : ""
                  }`}
                  key={appearance.id}
                  onClick={() => openRow(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRow(index);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <td className="plain-number py-2 pr-4 text-xs muted">{appearance.year}</td>
                  <td className={`px-4 py-2 ${isWinner ? "font-medium text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                    {statusLabels[appearance.status]}
                  </td>
                  <td className="px-4 py-2">
                    <span className="transition group-hover:text-[var(--accent)]">{book.title}</span>
                  </td>
                  <td className="px-4 py-2 muted">{book.authors.map((author) => author.name).join(", ")}</td>
                  <td className="px-4 py-2 muted">{displayImprint(book.imprintId)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BookDrawer
        book={selectedBook}
        appearances={selectedBook ? data.appearances.filter((appearance) => appearance.bookId === selectedBook.id) : []}
        currentLabel={selectedIndex === null ? undefined : `${selectedIndex + 1} of ${rows.length}`}
        onClose={closeBook}
        onNext={goNext}
        onPrevious={goPrevious}
      />
    </>
  );
}

function displayImprint(imprintId?: string) {
  if (!imprintId) return "Unknown";
  const imprint = imprintsById.get(imprintId);
  return imprint?.shortName ?? imprint?.name ?? "Unknown";
}
