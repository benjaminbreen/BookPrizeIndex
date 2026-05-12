import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-copy" aria-labelledby="not-found-title">
        <p className="not-found-eyebrow">The Book Prize Index / missing record</p>
        <h1 className="not-found-code" id="not-found-title">404</h1>
        <p className="not-found-headline">This page slipped into the wrong drawer.</p>
        <p className="not-found-deck">
          The catalog is intact, but this card has no matching shelf mark. Try the index,
          return to the front desk, or browse the prize records from the beginning.
        </p>
        <nav className="not-found-actions" aria-label="Recovery links">
          <Link className="not-found-button not-found-button-primary" href="/">Return home <span aria-hidden="true">-&gt;</span></Link>
          <Link className="not-found-button" href="/books">Search books</Link>
        </nav>
      </section>

      <section className="not-found-cabinet" aria-label="Animated misfiled catalog cards">
        <div className="not-found-drawer" aria-hidden="true">
          <div className="not-found-handle" />
        </div>
        <div className="not-found-index" aria-hidden="true">
          <span>A</span>
          <span>B</span>
          <span>C</span>
          <span>D</span>
          <span>?</span>
          <span>F</span>
        </div>
        <article className="not-found-card not-found-card-one">
          <div className="not-found-card-content">
            <span className="not-found-stamp">Misfiled</span>
            <br />
            Title: Unknown page
            <br />
            Author: A broken link
            <br />
            Status: Not in catalog
          </div>
        </article>
        <article className="not-found-card not-found-card-two">
          <div className="not-found-card-content">
            Shelf mark: 404
            <br />
            Subject: Detours
            <br />
            Prize record: unresolved
          </div>
        </article>
        <article className="not-found-card not-found-card-three">
          <div className="not-found-card-content">
            Suggested action:
            <br />
            Start with the books index, then narrow by subject, prize, or imprint.
          </div>
        </article>
      </section>
    </main>
  );
}
