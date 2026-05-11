export const metadata = {
  title: "About / The Book Prize Index",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-[var(--font-serif)] text-3xl font-semibold tracking-tight">About</h1>

      <div className="mt-8 space-y-5 text-[length:var(--step-0)] leading-8 muted">
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
    </div>
  );
}
