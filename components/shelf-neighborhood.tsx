import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LibraryShelfNeighborhood as Neighborhood } from "@/lib/library-shelf-types";

export function ShelfNeighborhood({
  neighborhood,
  mode = "full",
}: {
  neighborhood: Neighborhood;
  mode?: "full" | "drawer" | "inline";
}) {
  const rows = [
    ...neighborhood.before.map((row) => ({ row, selected: false })),
    { row: neighborhood.selected, selected: true },
    ...neighborhood.after.map((row) => ({ row, selected: false })),
  ];

  return (
    <section className={`shelf-neighborhood shelf-neighborhood-${mode}`} aria-label={`Books near ${neighborhood.selected.title} on the Library of Congress shelf`}>
      <div className="shelf-neighborhood-heading">
        <div className="shelf-neighborhood-heading-text">
          <p>On the shelf</p>
          <h2>Browse around this book</h2>
          <p className="shelf-neighborhood-deck">
            Prize-recognized books immediately before and after this one in Library of Congress call-number order.
          </p>
        </div>
        <Link href={`/fun/library-of-congress-shelf?book=${neighborhood.selected.slug}`}>
          Open the full shelf
          <ArrowRight size={14} />
        </Link>
      </div>
      <ol className="shelf-neighborhood-list">
        {rows.map(({ row, selected }) => (
          <li className={selected ? "is-selected" : ""} key={row.id}>
            <Link aria-current={selected ? "true" : undefined} href={`/books/${row.slug}`} title={`${row.title} — ${row.author}`}>
              <span className="shelf-neighborhood-call">{row.callNumber}</span>
              <span className="shelf-neighborhood-title">{row.title}</span>
              <span className="shelf-neighborhood-author">{row.author}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
