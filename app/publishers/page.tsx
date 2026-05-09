import Link from "next/link";
import { data } from "@/lib/data";

export const metadata = {
  title: "Publishers and Imprints / The Book Prize Index",
};

export default function PublishersPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Publishers and imprints</p>
      <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Imprints tracked separately from publishers.</h1>
      <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
        The seed workbook supplies imprint data. Publisher relationships are represented in the schema and will be filled by
        curation and enrichment rather than inferred.
      </p>
      <div className="mt-8 grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
        {data.imprints.map((imprint) => {
          const count = data.books.filter((book) => book.imprintId === imprint.id).length;
          const slug = imprint.id.replace(/^imprint-/, "");
          return (
            <Link className="bg-[var(--paper)] p-5 transition hover:bg-[var(--accent-soft)]" href={`/publishers/${slug}`} key={imprint.id}>
              <p className="font-[var(--font-serif)] text-2xl font-light">{imprint.name}</p>
              <p className="mt-3 font-[var(--font-mono)] text-xs muted">{count} books / publisher pending</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
