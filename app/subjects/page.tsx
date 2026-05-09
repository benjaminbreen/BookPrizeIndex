import Link from "next/link";
import { booksById, data } from "@/lib/data";

export const metadata = {
  title: "Subjects / The Book Prize Index",
};

export default function SubjectsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Subjects</p>
      <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Browse by subject.</h1>
      <div className="mt-8 grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
        {data.subjects.map((subject) => {
          const topBook = subject.topBookId ? booksById.get(subject.topBookId) : undefined;
          return (
            <Link className="group bg-[var(--paper)] p-5 transition hover:bg-[var(--accent-soft)]" href={`/subjects/${subject.slug}`} key={subject.id}>
              <p className="font-[var(--font-serif)] text-2xl font-light">{subject.name}</p>
              <p className="mt-3 font-[var(--font-mono)] text-xs muted">{subject.bookCount} books</p>
              {topBook ? <p className="mt-5 text-sm muted">Top record: {topBook.title}</p> : null}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
