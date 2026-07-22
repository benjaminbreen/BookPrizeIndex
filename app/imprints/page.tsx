import Link from "next/link";
import { ImprintLogoMark } from "@/components/imprint-logo-mark";
import { imprintSlug, imprintStats } from "@/lib/catalog";
import { data, publishersById } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";

export const metadata = {
  title: "Imprints / The Book Prize Index",
  description: "Browse publishing imprints and their prize-recognized nonfiction books.",
  alternates: { canonical: "/imprints" },
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
          const logo = getImprintLogo(imprint.id);
          return (
            <Link className="flex min-h-36 gap-5 bg-[var(--paper)] p-5 transition hover:bg-[var(--accent-soft)]" href={`/imprints/${imprintSlug(imprint)}`} key={imprint.id}>
              <ImprintLogoMark className="h-20 w-24" logoPath={logo?.logoPath} name={imprint.name} />
              <span className="min-w-0">
                <span className="block font-[var(--font-serif)] text-2xl font-light leading-snug">{imprint.name}</span>
                <span className="mt-3 block font-[var(--font-mono)] text-xs muted">
                  {stats.books} books / {stats.appearances} appearances
                </span>
                {publisher ? <span className="mt-2 block text-sm muted">{publisher.name}</span> : null}
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
