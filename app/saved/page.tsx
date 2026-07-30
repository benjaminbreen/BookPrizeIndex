import type { Metadata } from "next";
import { SavedLibraryIndex } from "@/components/saved-semantic-lists";

export const metadata: Metadata = {
  title: "Saved / The Book Prize Index",
  description: "Return to books, personal reading lists, and search results saved in this browser.",
  alternates: { canonical: "/saved" },
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="saved-lists-header border-b hairline pb-9">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Personal library</p>
          <h1 className="mt-4 font-[var(--font-serif)] text-5xl font-light leading-none">Saved</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 muted">
            Books, reading lists, and frozen Meaning-search results kept only in this browser. Nothing is uploaded
            unless you explicitly create a share link.
          </p>
        </div>
        <p className="saved-lists-device-note">On this device</p>
      </header>
      <section className="py-8">
        <SavedLibraryIndex />
      </section>
    </main>
  );
}
