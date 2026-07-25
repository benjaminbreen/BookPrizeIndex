import Link from "next/link";

export const metadata = {
  title: "About / The Book Prize Index",
  description: "About The Book Prize Index, a free, source-backed catalog of nonfiction prizes and prize-recognized books.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="text-page mx-auto grid max-w-[58rem] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[10rem_minmax(0,36rem)] md:gap-16 md:py-20 lg:px-8">
      <nav className="border-b hairline pb-4 font-[var(--font-mono)] text-[0.68rem] uppercase leading-7 tracking-[0.14em] muted md:sticky md:top-28 md:self-start md:border-b-0 md:pb-0">
        <p className="mb-3 text-[var(--ink)]">About</p>
        <ol className="grid grid-cols-2 gap-x-5 md:block">
          <li><a className="transition hover:text-[var(--ink)]" href="#purpose">Purpose</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#methods">Methods</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#affiliate-links">Affiliate links</a></li>
          <li><a className="transition hover:text-[var(--ink)]" href="#contact">Contact</a></li>
        </ol>
      </nav>

      <article>
        <h1 className="font-[var(--font-serif)] text-4xl font-light leading-tight tracking-[-0.02em] sm:text-5xl">
          About The Book Prize Index
        </h1>

        <section className="mt-8 scroll-mt-24 border-t hairline pt-5" id="purpose">
          <div className="space-y-5 text-lg leading-9 muted">
            <p>
              The Book Prize Index was created by Benjamin Breen, a historian, writer, and avid reader. I built the site
              with help from Claude Code and OpenAI Codex.
            </p>
            <p>
              I grew frustrated with algorithmic book recommendations and wanted a way to discover books in the
              &ldquo;long tail&rdquo; of excellent work which has been recognized by major awards but which might not be
              what an algorithmic recommendation tool is optimized for.
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

        <section className="mt-10 scroll-mt-24 border-t hairline pt-5" id="affiliate-links">
          <h2 className="font-[var(--font-mono)] text-[0.68rem] font-normal uppercase tracking-[0.16em]">Affiliate links</h2>
          <p className="mt-4 text-lg leading-9 muted">
            Some book links are affiliate links. If you make a purchase after following one, I may receive a small
            commission at no additional cost to you. This helps offset the costs of developing and hosting the site.
            As an Amazon Associate I earn from qualifying purchases.
          </p>
        </section>

        <section className="mt-10 scroll-mt-24 border-t hairline pt-5" id="contact">
          <h2 className="font-[var(--font-mono)] text-[0.68rem] font-normal uppercase tracking-[0.16em]">Contact</h2>
          <p className="mt-4 text-lg leading-9 muted">
            If you spot an error—or have feedback, suggestions, or comments—I&rsquo;d be glad to hear from you. You can
            reach me at <span className="text-[var(--ink)]">breen85 [at] gmail [dot] com</span>.
          </p>
        </section>
      </article>
    </main>
  );
}
