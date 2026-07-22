export const metadata = {
  title: "Colophon / The Book Prize Index",
  description: "Design, typography, technology, and acknowledgments for The Book Prize Index.",
  alternates: { canonical: "/colophon" },
};

export default function ColophonPage() {
  return (
    <main className="colophon-page">
      <article className="colophon-leaf" aria-labelledby="colophon-title">
        <div className="colophon-head">
          <span aria-hidden="true">❦</span>
          <span aria-hidden="true">❦</span>
          <span aria-hidden="true">❦</span>
        </div>

        <p className="colophon-kicker">(Of this index)</p>
        <h1 id="colophon-title" className="colophon-title">
          The Book Prize Index
        </h1>
        <div className="colophon-taper colophon-taper-wide">
          <p className="colophon-kicker">is set with</p>
           <span>Atkinson Hyperlegible Next for interface text,</span>
          <span>Newsreader for editorial headings & accents,</span>
          <span>Atkinson Hyperlegible Mono for labels,</span>
          <span>and Public Sans for tabular numbers.</span>
        </div>

        <div className="colophon-mark" aria-hidden="true">
          <span className="colophon-mark-flower">❦</span>
          <span className="colophon-mark-arc" />
          <span className="colophon-mark-box">
            OPEN
            <br />
            RECORDS
          </span>
          <span className="colophon-mark-arc" />
          <span className="colophon-mark-flower">❦</span>
        </div>

        <div className="colophon-taper colophon-taper-credit">
          <span>The vast majority of this application's code,</span>
          <span>methodology, tooling, & data gathering</span>
          <span>was done by GPT Five Point Five</span>
          <span>directed by Benjamin Breen,</span>
          <p className="colophon-kicker">a historian.</p>
        </div>

        <p className="colophon-date">We have also made use of:</p>

        <div className="colophon-taper colophon-taper-tools">
          <span>Next.js, TypeScript, Tailwind CSS,</span>
          <span>Semantic search uses OpenAI embeddings over a book index;</span>
          <span>visual checks use Playwright.</span>
        
        </div>

        <p className="colophon-date">In the year MMXXVI</p>
      </article>
    </main>
  );
}
