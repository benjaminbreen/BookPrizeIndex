import Link from "next/link";
import { imprintSlug, imprintStats } from "@/lib/catalog";
import { data, publishersById } from "@/lib/data";

export const metadata = {
  title: "Imprints / The Book Prize Index",
};

export default function ImprintsPage() {
  const imprints = [...data.imprints].sort((a, b) => imprintStats(b.id).score - imprintStats(a.id).score || a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Imprints</p>
      <h1 className="mt-3 font-[var(--font-serif)] text-5xl font-light leading-tight">Browse imprints.</h1>
      <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
        Imprints are publishing labels. Parent publisher groups are available in the publisher index.
      </p>
      <div className="mt-8 grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
        {imprints.map((imprint) => {
          const stats = imprintStats(imprint.id);
          const publisher = imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined;
          return (
            <Link className="bg-[var(--paper)] p-5 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
              <p className="font-[var(--font-serif)] text-2xl font-light">{imprint.name}</p>
              <p className="mt-3 font-[var(--font-mono)] text-xs muted">
                {stats.books} books / {stats.appearances} appearances
              </p>
              {publisher ? <p className="mt-2 text-sm muted">{publisher.name}</p> : null}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
