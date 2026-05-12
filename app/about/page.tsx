import Link from "next/link";

export const metadata = {
  title: "About / The Book Prize Index",
};

export default function AboutPage() {
  return (
    <main className="text-page mx-auto grid max-w-[58rem] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[10rem_minmax(0,36rem)] md:gap-16 md:py-20 lg:px-8">
      <nav className="border-b hairline pb-4 font-[var(--font-mono)] text-[0.68rem] uppercase leading-7 tracking-[0.14em] muted md:sticky md:top-28 md:self-start md:border-b-0 md:pb-0">
        <p className="mb-3 text-[var(--ink)]">About</p>
        <ol className="grid grid-cols-2 gap-x-5 md:block">
          <li><a className="transition hover:text-[var(--ink)]" href="#purpose">Purpose</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#methods">Methods</a></li>
        </ol>
      </nav>

      <article>
        <h1 className="font-[var(--font-serif)] text-4xl font-light leading-tight tracking-[-0.02em] sm:text-5xl">
          About The Book Prize Index
        </h1>

        <section className="mt-8 scroll-mt-24 border-t hairline pt-5" id="purpose">
          <div className="space-y-5 text-lg leading-9 muted">
            <p>
              As a writer and an avid reader, I grew frustrated with algorithmic book recommendations. I wanted a way to
              discover books in the &ldquo;long tail&rdquo; of excellent work which has been recognized by major awards but
              which might not be what an algorithmic recommendation tool is optimized for.
            </p>
            <p>
              I also wanted to aggregate this publicly-available information to create a useful, completely free tool for
              readers, publishers, and fellow authors. In short, this site is intended to celebrate excellent books and the
              publishers and imprints that champion them.
            </p>
          </div>
        </section>

        <section className="mt-10 scroll-mt-24 border-t hairline pt-5" id="methods">
          <h2 className="font-[var(--font-mono)] text-[0.68rem] font-normal uppercase tracking-[0.16em]">Methods</h2>
          <p className="mt-4 text-lg leading-9 muted">
            The index is built from source-backed award records, then deduplicated into books and enriched with reviewed
            metadata for subjects, publishers, imprints, and discovery features. A fuller technical and editorial account
            is available in the <Link className="border-b hairline text-[var(--ink)] transition hover:text-[var(--accent)]" href="/methodology">methodology note</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}
