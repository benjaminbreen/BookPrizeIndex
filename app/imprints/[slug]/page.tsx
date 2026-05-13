import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BookCatalog } from "@/components/book-catalog";
import { ImprintKeyboardNav } from "@/components/imprint-keyboard-nav";
import { imprintSlug, imprintStats } from "@/lib/catalog";
import { browseBooksByImprintId, browseData } from "@/lib/browse-data";
import type { BrowseBookRow } from "@/lib/browse-types";
import { data, imprintsBySlug, publishersById } from "@/lib/data";
import { getImprintLogo } from "@/lib/imprint-logos";

export function generateStaticParams() {
  return data.imprints.map((imprint) => ({ slug: imprintSlug(imprint) }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const imprint = imprintsBySlug.get(slug);
  return { title: imprint ? `${imprint.name} / The Book Prize Index` : "Imprint / The Book Prize Index" };
}

export default async function ImprintPage({ params }: PageProps) {
  const { slug } = await params;
  const imprint = imprintsBySlug.get(slug);
  if (!imprint) notFound();
  const publisher = imprint.publisherId ? publishersById.get(imprint.publisherId) : undefined;
  const books = browseBooksByImprintId.get(imprint.id) ?? [];
  const stats = imprintStats(imprint.id);
  const logo = getImprintLogo(imprint.id);
  const summary = imprintSummary(imprint.name, books);
  const sortedImprints = [...data.imprints].sort((a, b) => imprintStats(b.id).score - imprintStats(a.id).score || a.name.localeCompare(b.name));
  const imprintRoutes = sortedImprints.map((item) => `/imprints/${imprintSlug(item)}`);
  const currentRoute = `/imprints/${imprintSlug(imprint)}`;
  const currentIndex = imprintRoutes.indexOf(currentRoute);
  const previousIndex = currentIndex > 0 ? currentIndex - 1 : sortedImprints.length - 1;
  const nextIndex = currentIndex >= 0 && currentIndex < sortedImprints.length - 1 ? currentIndex + 1 : 0;
  const previousImprint = sortedImprints[previousIndex];
  const nextImprint = sortedImprints[nextIndex];
  const previousHref = previousImprint ? `/imprints/${imprintSlug(previousImprint)}` : undefined;
  const nextHref = nextImprint ? `/imprints/${imprintSlug(nextImprint)}` : undefined;

  return (
    <main>
      <ImprintKeyboardNav previousHref={previousHref} nextHref={nextHref} />
      <section className="mx-auto max-w-7xl px-4 pb-6 pt-12 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between gap-3 font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em]">
          {previousHref && previousImprint ? (
            <Link className="focus-ring inline-flex min-w-0 max-w-[46%] items-center gap-1.5 border hairline px-2.5 py-1.5 transition hover:bg-[var(--accent-soft)]" href={previousHref}>
              <ChevronLeft size={13} />
              <span className="hidden truncate sm:inline">{previousImprint.name}</span>
              <span className="sm:hidden">Prev</span>
            </Link>
          ) : <span />}
          {nextHref && nextImprint ? (
            <Link className="focus-ring inline-flex min-w-0 max-w-[46%] items-center gap-1.5 border hairline px-2.5 py-1.5 transition hover:bg-[var(--accent-soft)]" href={nextHref}>
              <span className="hidden truncate sm:inline">{nextImprint.name}</span>
              <span className="sm:hidden">Next</span>
              <ChevronRight size={13} />
            </Link>
          ) : <span />}
        </div>
        <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)_24rem] lg:items-center xl:grid-cols-[22rem_minmax(0,1fr)_24rem]">
          <ImprintLogo logoPath={logo?.logoPath} name={imprint.name} sourceTitle={logo?.sourceTitle} />

          <div className="min-w-0">
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Imprint</p>
            <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-tight tracking-normal">{imprint.name}</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 muted">
              {publisher ? `An imprint of ${publisher.name}.` : "An imprint in the current award corpus."}
            </p>
          </div>

          <div className="lg:justify-self-end">
            <div className="grid grid-cols-2 border hairline panel sm:min-w-72">
              <HeroMetric value={stats.books} label="Books" />
              <HeroMetric value={stats.appearances} label="Appearances" />
            </div>
          </div>
        </div>
      </section>

      <Suspense>
        <BookCatalog
          awardOptions={browseData.awards}
          books={books}
          title={null}
          deck={summary.description}
          secondaryDeck={summary.topicSentence}
          compactHeader
        />
      </Suspense>
    </main>
  );
}

function ImprintLogo({ logoPath, name, sourceTitle }: { logoPath?: string; name: string; sourceTitle?: string }) {
  if (!logoPath) {
    return (
      <div className="grid min-h-32 place-items-center px-2 py-4 text-center">
        <span className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Logo pending</span>
      </div>
    );
  }

  return (
    <figure className="grid h-32 place-items-center overflow-hidden px-2 py-4 sm:h-44 lg:h-56 lg:justify-items-start lg:overflow-visible xl:h-64" title={sourceTitle}>
      <img
        alt={`${name} logo`}
        className="max-h-28 max-w-full object-contain grayscale sm:max-h-44 lg:max-h-56 lg:max-w-[18rem] xl:max-h-64 xl:max-w-[22rem]"
        src={logoPath}
      />
    </figure>
  );
}

function HeroMetric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="border-r hairline px-5 py-6 text-center last:border-r-0">
      <p className="plain-number text-3xl">{value}</p>
      <p className="mt-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em] muted">{label}</p>
    </div>
  );
}

function imprintSummary(imprintName: string, books: BrowseBookRow[]) {
  const subjectCounts = new Map<string, number>();
  for (const book of books) {
    for (const subject of book.subjects.slice(0, 3)) {
      subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
    }
  }
  const subjects = [...subjectCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([subject]) => subject);
  const topicSentence = subjects.length ? `The imprint's award-recognized nonfiction in this index is especially concentrated in ${formatSeries(subjects)}.` : undefined;
  return {
    description: imprintDescriptions[imprintName] ?? `${imprintName} is a publishing imprint represented in this index through award-recognized nonfiction.`,
    topicSentence,
  };
}

function formatSeries(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

const imprintDescriptions: Record<string, string> = {
  "37 Ink": "37 Ink is a Simon & Schuster imprint associated with commercially ambitious nonfiction, memoir, and books by influential public voices.",
  "Abrams Press": "Abrams Press publishes narrative nonfiction, history, biography, and culture books within the wider Abrams publishing program.",
  "Algonquin Books": "Algonquin Books is a Chapel Hill-founded literary publisher known for accessible fiction and nonfiction with strong narrative appeal.",
  "Amistad": "Amistad is a HarperCollins imprint focused on books by and about Black writers, history, politics, culture, and lived experience.",
  "Astra House": "Astra House is an independent-minded literary imprint publishing international fiction, essays, and serious nonfiction.",
  "Atheneum": "Atheneum is a long-running Simon & Schuster imprint with a history of literary publishing across fiction and nonfiction.",
  "Atlantic Monthly Press": "Atlantic Monthly Press publishes literary nonfiction, history, journalism, memoir, and fiction with an editorial lineage tied to The Atlantic.",
  "Avid Reader Press": "Avid Reader Press is a Simon & Schuster imprint publishing idea-driven nonfiction, memoir, culture, and literary fiction.",
  "Avon Books": "Avon Books is a mass-market publishing imprint historically associated with popular fiction and broad commercial nonfiction.",
  "Bantam Books": "Bantam Books is a major paperback and trade imprint with a deep backlist across popular nonfiction, history, memoir, and fiction.",
  "Basic Books": "Basic Books is known for serious nonfiction in history, science, politics, psychology, and the social sciences.",
  "Beacon Press": "Beacon Press is an independent nonprofit publisher known for progressive nonfiction, social criticism, religion, history, and civil-rights writing.",
  "Belknap Press": "Belknap Press is Harvard University Press's distinguished imprint for major scholarly and trade works in history, biography, and the humanities.",
  "Berkley": "Berkley is a Penguin Random House imprint best known for commercial fiction, with a broader list that has included popular nonfiction.",
  "Blackstone Audio": "Blackstone Audio is an audiobook publisher and media company that appears here through audio and publishing editions attached to award-recognized books.",
  "Bloomsbury": "Bloomsbury is an independent British-founded publisher with a strong list in history, biography, politics, culture, and literary nonfiction.",
  "Bloomsbury Press": "Bloomsbury Press publishes serious trade nonfiction, including history, politics, biography, science, and narrative journalism.",
  "Bloomsbury USA": "Bloomsbury USA is the American arm of Bloomsbury, publishing literary fiction and nonfiction across history, culture, and public affairs.",
  "Bold Type Books": "Bold Type Books publishes progressive nonfiction, journalism, politics, history, and cultural criticism.",
  "Catapult": "Catapult is a literary publisher known for memoir, essays, literary fiction, and works by emerging and established writers.",
  "Chicago Review Press": "Chicago Review Press is an independent publisher with a broad nonfiction list in history, biography, music, science, and popular culture.",
  "Coffee House Press": "Coffee House Press is an independent literary publisher known for formally adventurous fiction, essays, poetry, and nonfiction.",
  "Columbia University Press": "Columbia University Press publishes scholarly and trade nonfiction across history, politics, literary studies, science, and global affairs.",
  "Crown": "Crown publishes high-profile commercial nonfiction, memoir, history, politics, and narrative journalism.",
  "Doubleday": "Doubleday is a historic trade imprint known for major fiction and nonfiction, including biography, history, memoir, and public affairs.",
  "Duke University Press": "Duke University Press publishes influential scholarly nonfiction in cultural studies, politics, history, anthropology, and theory.",
  "Dutton": "Dutton is a Penguin Random House imprint publishing commercial fiction and nonfiction, including memoir, history, and current affairs.",
  "Ecco": "Ecco is a HarperCollins imprint known for literary fiction, poetry, memoir, food writing, music, and serious trade nonfiction.",
  "Faber & Faber": "Faber & Faber is an independent British publisher with a distinguished list in literature, poetry, drama, memoir, and cultural nonfiction.",
  "Farrar, Straus and Giroux": "Farrar, Straus and Giroux is a literary trade imprint known for prize-winning fiction, essays, criticism, history, and serious nonfiction.",
  "Feminist Press": "Feminist Press publishes feminist literature, recovered classics, memoir, history, and politically engaged nonfiction.",
  "Free Press": "Free Press is a Simon & Schuster imprint historically associated with influential nonfiction in politics, sociology, history, and public affairs.",
  "Godine": "Godine is an independent publisher known for carefully made literary books, essays, memoir, classics, and regional nonfiction.",
  "Graywolf Press": "Graywolf Press is an independent literary publisher celebrated for essays, poetry, memoir, criticism, and formally distinctive nonfiction.",
  "Grove Press": "Grove Press is a landmark independent imprint known for literary fiction, drama, political writing, memoir, and international nonfiction.",
  "Harcourt": "Harcourt was a major trade and educational publisher with an important backlist in literature, history, biography, and nonfiction.",
  "Harper": "Harper is a flagship HarperCollins imprint publishing major commercial and literary nonfiction, history, memoir, and public-affairs books.",
  "Harper & Row": "Harper & Row was a major American publisher whose list included influential nonfiction, history, biography, religion, and literary works.",
  "Harvard University Press": "Harvard University Press publishes scholarly and trade nonfiction across history, science, politics, philosophy, and the humanities.",
  "Haymarket Books": "Haymarket Books is an independent left publisher focused on politics, social movements, history, labor, race, and international affairs.",
  "Henry Holt": "Henry Holt is a historic trade imprint publishing literary fiction and nonfiction, including history, biography, journalism, and politics.",
  "Hogarth": "Hogarth is a literary imprint associated with fiction, memoir, essays, and narrative nonfiction.",
  "Houghton Mifflin": "Houghton Mifflin was a major American publisher with a strong literary and nonfiction backlist in history, biography, nature, and education.",
  "Houghton Mifflin Harcourt": "Houghton Mifflin Harcourt combined major trade and educational lists, including notable nonfiction in history, biography, science, and nature writing.",
  "Johns Hopkins University Press": "Johns Hopkins University Press publishes scholarly and trade nonfiction in history, medicine, science, politics, and the humanities.",
  "Knopf": "Knopf is a prestigious literary imprint known for carefully edited fiction and major nonfiction in biography, history, politics, and culture.",
  "Legacy Lit": "Legacy Lit is a Hachette imprint focused on books by writers of color and works about identity, culture, politics, and social change.",
  "Little, Brown": "Little, Brown is a major trade imprint publishing commercial and literary nonfiction, biography, history, memoir, and journalism.",
  "Liveright": "Liveright is a W. W. Norton imprint with a revived list in literary nonfiction, history, biography, philosophy, and serious fiction.",
  "Mad Creek Books": "Mad Creek Books is an Ohio State University Press imprint publishing literary nonfiction, essays, memoir, and contemporary literature.",
  "Mariner Books": "Mariner Books is a trade paperback and nonfiction imprint with a strong backlist in history, biography, memoir, and literary nonfiction.",
  "MCD": "MCD is a Farrar, Straus and Giroux imprint associated with contemporary literary fiction, essays, journalism, and genre-crossing nonfiction.",
  "Metropolitan Books": "Metropolitan Books was a Henry Holt imprint known for serious nonfiction in politics, history, current affairs, and investigative journalism.",
  "Milkweed Editions": "Milkweed Editions is an independent literary publisher known for nature writing, memoir, essays, poetry, and environmental nonfiction.",
  "MIT Press": "MIT Press publishes influential nonfiction in science, technology, design, architecture, economics, and intellectual history.",
  "Modern Library": "Modern Library is a Random House imprint known for canonical reissues, classics, and durable works of literature and nonfiction.",
  "Nation Books": "Nation Books was a progressive nonfiction imprint associated with politics, journalism, history, and social criticism.",
  "New American Library": "New American Library was a mass-market and trade publisher known for Signet paperbacks, classics, fiction, and popular nonfiction.",
  "New Directions": "New Directions is an independent literary publisher known for international literature, poetry, essays, criticism, and experimental prose.",
  "One World": "One World is a Random House imprint focused on literary and narrative books about identity, justice, politics, history, and culture.",
  "Oneworld": "Oneworld is an independent publisher known for literary fiction and serious nonfiction in history, politics, religion, science, and ideas.",
  "Other Press": "Other Press publishes literary fiction and nonfiction, including memoir, psychology, history, and works in translation.",
  "Oxford University Press": "Oxford University Press publishes scholarly and trade nonfiction across history, biography, politics, science, and reference.",
  "Palgrave Macmillan": "Palgrave Macmillan publishes academic and professional nonfiction in history, politics, economics, cultural studies, and the social sciences.",
  "Pantheon": "Pantheon is a literary imprint known for international fiction, graphic nonfiction, history, politics, biography, and cultural criticism.",
  "Pegasus Books": "Pegasus Books is an independent publisher of history, biography, current affairs, mystery, and narrative nonfiction.",
  "Penguin Books": "Penguin Books is a historic paperback and trade imprint with a broad list spanning classics, literary nonfiction, history, memoir, and culture.",
  "Penguin Press": "Penguin Press is a Penguin Random House imprint known for serious nonfiction, history, politics, biography, science, and literary journalism.",
  "Picador": "Picador is a literary imprint associated with trade paperbacks, fiction, essays, memoir, and serious nonfiction.",
  "Pocket Books": "Pocket Books is a Simon & Schuster imprint historically central to mass-market paperbacks and popular nonfiction.",
  "Princeton University Press": "Princeton University Press publishes scholarly and trade nonfiction in history, science, economics, philosophy, politics, and the humanities.",
  "PublicAffairs": "PublicAffairs publishes nonfiction in politics, history, business, current affairs, biography, and investigative journalism.",
  "Putnam": "Putnam is a long-running trade imprint publishing commercial fiction and nonfiction, including memoir, history, and public affairs.",
  "Random House": "Random House is a flagship trade imprint known for major fiction and nonfiction across history, biography, politics, memoir, and culture.",
  "Riverhead Books": "Riverhead Books is a literary imprint known for fiction, memoir, essays, reportage, and culturally influential nonfiction.",
  "Schocken": "Schocken is a literary and Jewish-interest imprint known for works in Jewish history, religion, literature, and culture.",
  "Scribner": "Scribner is a historic literary imprint publishing major fiction and nonfiction, including biography, history, memoir, and criticism.",
  "Secker & Warburg": "Secker & Warburg was a British literary publisher known for fiction, political writing, memoir, and serious nonfiction.",
  "Signet": "Signet is a New American Library paperback imprint historically associated with classics, popular fiction, and mass-market nonfiction.",
  "Simon & Schuster": "Simon & Schuster is a flagship trade imprint publishing major commercial nonfiction, memoir, history, politics, and biography.",
  "Spiegel & Grau": "Spiegel & Grau is an independent literary imprint known for memoir, narrative nonfiction, fiction, and socially engaged books.",
  "St. Martin’s Press": "St. Martin's Press is a major trade imprint publishing commercial nonfiction, history, biography, memoir, and current affairs.",
  "Summit Books": "Summit Books was a Simon & Schuster imprint associated with literary fiction, memoir, politics, and trade nonfiction.",
  "The New Press": "The New Press is a nonprofit publisher focused on social justice, politics, law, education, history, and public-interest nonfiction.",
  "Tim Duggan Books": "Tim Duggan Books was a Crown imprint known for narrative nonfiction, history, politics, and literary fiction.",
  "Times Books": "Times Books was an imprint associated with journalistic nonfiction, politics, history, science, and public affairs.",
  "Tin House": "Tin House is an independent literary publisher known for fiction, essays, memoir, poetry, and contemporary nonfiction.",
  "Tiny Reparations Books": "Tiny Reparations Books is a Plume imprint curated by Phoebe Robinson, publishing humor, essays, memoir, fiction, and cultural commentary.",
  "Touchstone": "Touchstone was a Simon & Schuster trade paperback and hardcover imprint publishing commercial fiction and nonfiction.",
  "University of Chicago Press": "University of Chicago Press publishes scholarly and trade nonfiction in history, sociology, philosophy, science, and the humanities.",
  "University of Nebraska Press": "University of Nebraska Press publishes scholarly and trade nonfiction in history, Indigenous studies, sports, regional studies, and literature.",
  "University of North Carolina Press": "University of North Carolina Press publishes scholarly and trade nonfiction in American history, southern studies, politics, and culture.",
  "University of Pennsylvania Press": "University of Pennsylvania Press publishes scholarly nonfiction in history, politics, law, Jewish studies, and the humanities.",
  "University of Texas Press": "University of Texas Press publishes scholarly and trade nonfiction in history, Latin American studies, media, music, and regional culture.",
  "University of Washington Press": "University of Washington Press publishes scholarly and trade nonfiction in environmental studies, Asian studies, Indigenous studies, and regional history.",
  "Viking": "Viking is a Penguin Random House imprint known for literary fiction and serious nonfiction in history, biography, politics, and culture.",
  "Villard": "Villard was a Random House imprint associated with popular nonfiction, humor, sports, memoir, and commercial trade books.",
  "Vintage Books": "Vintage Books is a trade paperback imprint known for literary fiction, classics, memoir, history, and serious nonfiction.",
  "W. W. Norton": "W. W. Norton is an independent employee-owned publisher known for serious nonfiction, history, biography, science, and college texts.",
  "William Morrow": "William Morrow is a HarperCollins imprint publishing commercial fiction and nonfiction, including memoir, history, biography, and popular culture.",
  "Yale University Press": "Yale University Press publishes scholarly and trade nonfiction in history, biography, art, politics, religion, and the humanities.",
};
