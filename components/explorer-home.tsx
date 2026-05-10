"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Filter, Info, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BookDrawer } from "@/components/book-drawer";
import {
  bookSearchText,
  booksById,
  getBookStats,
  imprintsById,
  publishersById,
} from "@/lib/data";
import type { PublicData } from "@/lib/types";

type SortKey = "score" | "year" | "title" | "wins" | "lists" | "imprint";
type RegionFilter = "us" | "world";
type TypeFilter = "fiction" | "nonfiction" | "all";

export function ExplorerHome({ data }: { data: PublicData }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<RegionFilter>("world");
  const [type, setType] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rankedBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.books.filter((book) => !q || bookSearchText(book).includes(q));
    return filtered.sort((a, b) => {
      const aStats = getBookStats(a.id);
      const bStats = getBookStats(b.id);
      if (sortKey === "score") {
        return (
          bStats.score - aStats.score ||
          bStats.majorWins - aStats.majorWins ||
          bStats.wins - aStats.wins ||
          bStats.majorShortlists - aStats.majorShortlists ||
          bStats.normalShortlists - aStats.normalShortlists ||
          bStats.majorLonglists - aStats.majorLonglists ||
          bStats.normalLonglists - aStats.normalLonglists ||
          (b.publicationYear ?? 0) - (a.publicationYear ?? 0) ||
          a.title.localeCompare(b.title)
        );
      }
      if (sortKey === "wins") return bStats.wins - aStats.wins || a.title.localeCompare(b.title);
      if (sortKey === "lists") return bStats.lists - aStats.lists || a.title.localeCompare(b.title);
      if (sortKey === "year") return (b.publicationYear ?? 0) - (a.publicationYear ?? 0) || a.title.localeCompare(b.title);
      if (sortKey === "imprint") {
        const aImprint = a.imprintId ? imprintsById.get(a.imprintId)?.name ?? "" : "";
        const bImprint = b.imprintId ? imprintsById.get(b.imprintId)?.name ?? "" : "";
        return aImprint.localeCompare(bImprint) || a.title.localeCompare(b.title);
      }
      return a.title.localeCompare(b.title);
    });
  }, [data.books, query, sortKey]);

  const topBooks = rankedBooks.slice(0, 12);
  const selectedBook = selectedBookId ? booksById.get(selectedBookId) ?? null : null;
  const selectedIndex = selectedBookId ? topBooks.findIndex((book) => book.id === selectedBookId) : -1;
  const goPrevious = selectedIndex > 0 ? () => openBook(topBooks[selectedIndex - 1].id) : undefined;
  const goNext = selectedIndex >= 0 && selectedIndex < topBooks.length - 1 ? () => openBook(topBooks[selectedIndex + 1].id) : undefined;
  const browseData = useMemo(() => getBrowseData(data, region, type), [data, region, type]);
  const showingLabel = `${region === "world" ? "World" : "US"} · ${type === "all" ? "All" : titleCase(type)}`;

  useEffect(() => {
    const slug = searchParams.get("book");
    if (!slug) {
      setSelectedBookId(null);
      return;
    }

    const book = data.books.find((item) => item.slug === slug);
    setSelectedBookId(book?.id ?? null);
  }, [data.books, searchParams]);

  function setBookParam(bookSlug: string | null) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (bookSlug) {
      nextParams.set("book", bookSlug);
    } else {
      nextParams.delete("book");
    }
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}#books` : pathname, { scroll: false });
  }

  function openBook(bookId: string) {
    const book = data.books.find((item) => item.id === bookId);
    setSelectedBookId(bookId);
    setBookParam(book?.slug ?? null);
  }

  function closeBook() {
    setSelectedBookId(null);
    setBookParam(null);
  }

  return (
    <main>
      <section className="bg-[var(--paper)]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:px-8 lg:pb-12 lg:pt-20">
          <div>
            <h1 className="max-w-2xl font-[var(--font-serif)] text-4xl font-light leading-[1.02] sm:text-5xl lg:text-5xl">
              A searchable index of award-winning books.
            </h1>
            <p className="mt-6 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
              Browse award-winning, shortlisted, and longlisted books by subject, prize, imprint, publisher,
              figure, period, and source.
            </p>
          </div>

          <div className="panel self-end rounded-lg border hairline p-4 shadow-[0_18px_40px_color-mix(in_srgb,var(--ink)_5%,transparent)] sm:p-5">
            <div className="group flex min-h-14 items-center gap-3 rounded-md border border-[color-mix(in_srgb,var(--line)_82%,var(--paper))] bg-[color-mix(in_srgb,var(--paper)_88%,white)] px-4 transition hover:border-[color-mix(in_srgb,var(--ink)_24%,var(--line))] hover:bg-[color-mix(in_srgb,var(--paper)_78%,white)] focus-within:border-[var(--focus)] focus-within:bg-[var(--panel)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_16%,transparent)]">
              <Search size={22} className="muted transition group-focus-within:text-[var(--ink)]" />
              <input
                className="w-full bg-transparent text-lg outline-none placeholder:text-[color-mix(in_srgb,var(--muted)_78%,transparent)]"
                placeholder="Search books, awards, authors, subjects..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="mt-5 border-t hairline pt-5">
              <div className="grid gap-4 lg:grid-cols-[auto_auto_auto_auto_minmax(9rem,1fr)] lg:items-end">
                <FilterGroup label="Region">
                  {(["us", "world"] as const).map((item) => (
                    <FilterButton key={item} active={region === item} onClick={() => setRegion(item)}>
                      {item === "us" ? "US" : "World"}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <div className="hidden h-10 w-px bg-[var(--line)] lg:block" />
                <FilterGroup label="Type">
                  {(["fiction", "nonfiction", "all"] as const).map((item) => (
                    <FilterButton key={item} active={type === item} onClick={() => setType(item)}>
                      {titleCase(item)}
                    </FilterButton>
                  ))}
                </FilterGroup>
                <div className="hidden h-10 w-px bg-[var(--line)] lg:block" />
                <p className="flex items-start gap-2 text-xs leading-5 muted">
                  <Info size={15} className="mt-0.5 shrink-0" />
                  Lists update based on your selections.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y hairline" id="subjects">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 border-b hairline py-4 text-sm muted">
            <Filter size={16} />
            <span>
              Showing: <strong className="font-medium text-[var(--ink)]">{showingLabel}</strong>
            </span>
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl gap-0 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <BrowseList
            title="Browse by subject"
            seeAllHref="/subjects"
            items={browseData.subjects.slice(0, 8).map((subject) => ({
              id: subject.id,
              label: subject.name,
              meta: `${subject.bookCount} books`,
              href: `/subjects/${subject.slug}`,
            }))}
          />
          <BrowseList
            title="Browse by prize"
            id="awards"
            seeAllHref="/awards"
            items={browseData.awards.slice(0, 8).map((award) => ({
              id: award.id,
              label: award.name,
              meta: `${award.recordCount} records`,
              href: `/awards/${award.slug}`,
            }))}
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" id="books">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Ranked catalog</p>
            <h2 className="mt-2 font-[var(--font-serif)] text-3xl font-light">Most awarded books</h2>
          </div>
          <div className="flex flex-wrap gap-2 font-[var(--font-mono)] text-xs">
            {(["score", "wins", "lists", "year", "title", "imprint"] as SortKey[]).map((key) => (
              <button
                key={key}
                className={`focus-ring border hairline px-3 py-2 capitalize transition ${
                  sortKey === key ? "bg-[var(--ink)] text-[var(--paper)]" : "panel muted hover:text-[var(--ink)]"
                }`}
                onClick={() => setSortKey(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto border hairline panel">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-xs uppercase tracking-[0.08em] muted">
              <tr className="border-b hairline">
                <th className="px-4 py-3 font-normal">Year</th>
                <th className="px-4 py-3 font-normal">Title</th>
                <th className="px-4 py-3 font-normal">Author</th>
                <th className="px-4 py-3 font-normal">Wins</th>
                <th className="px-4 py-3 font-normal">Lists</th>
                <th className="px-4 py-3 font-normal">Imprint</th>
                <th className="px-4 py-3 font-normal">Publisher</th>
              </tr>
            </thead>
            <tbody>
              {topBooks.map((book, index) => {
                const stats = getBookStats(book.id);
                const imprint = book.imprintId ? imprintsById.get(book.imprintId)?.name : "";
                const publisher = book.publisherId ? publishersById.get(book.publisherId)?.name : "";
                return (
                  <tr
                    key={book.id}
                    className={`book-table-row fade-up cursor-pointer border-b hairline transition hover:bg-[var(--accent-soft)] ${
                      selectedBookId === book.id ? "book-table-row-active" : ""
                    }`}
                    style={{ animationDelay: `${Math.min(index * 18, 140)}ms` }}
                    onClick={() => openBook(book.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openBook(book.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="plain-number px-4 py-4 text-sm muted">{book.publicationYear}</td>
                    <td className="px-4 py-4">
                      <button
                        className="focus-ring block w-full text-left font-[var(--font-serif)] text-xl font-light transition hover:text-[var(--accent)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          openBook(book.id);
                        }}
                        type="button"
                      >
                        {book.title}
                      </button>
                    </td>
                    <td className="px-4 py-4 text-sm">{book.authors.map((author) => author.name).join(", ")}</td>
                    <td className="plain-number px-4 py-4 text-sm">{stats.wins}</td>
                    <td className="plain-number px-4 py-4 text-sm">{stats.lists}</td>
                    <td className="px-4 py-4 text-sm">{imprint || "Unknown"}</td>
                    <td className="px-4 py-4 text-sm muted">{publisher || "Not yet sourced"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" id="publishers">
        <div className="grid gap-4 border-t hairline pt-8 font-[var(--font-mono)] text-xs muted sm:grid-cols-4">
          <Stat label="Books" value={data.books.length} />
          <Stat label="Award appearances" value={data.appearances.length} />
          <Stat label="Prizes" value={data.awards.length} />
          <Stat label="Imprints" value={data.imprints.length} />
        </div>
      </section>

      <BookDrawer
        book={selectedBook}
        appearances={selectedBook ? data.appearances.filter((appearance) => appearance.bookId === selectedBook.id) : []}
        currentLabel={selectedIndex >= 0 ? `${selectedIndex + 1} of ${topBooks.length}` : undefined}
        onClose={closeBook}
        onNext={goNext}
        onPrevious={goPrevious}
      />
    </main>
  );
}

function BrowseList({
  title,
  items,
  id,
  seeAllHref,
}: {
  title: string;
  id?: string;
  items: { id: string; label: string; meta: string; href: string }[];
  seeAllHref: string;
}) {
  return (
    <div className="py-8 lg:px-8 lg:[&:first-child]:border-r lg:[&:first-child]:pl-0 lg:[&:last-child]:pr-0 hairline" id={id}>
      <h2 className="mb-5 font-[var(--font-mono)] text-xs uppercase tracking-[0.22em] muted">{title}</h2>
      <div className="border-t hairline">
        {items.map((item) => (
          <Link
            href={item.href}
            key={item.id}
            className="group flex min-h-10 items-center justify-between gap-4 border-b hairline py-2.5 transition hover:bg-[color-mix(in_srgb,var(--panel)_74%,transparent)]"
          >
            <span className="text-base font-medium leading-snug">{item.label}</span>
            <span className="flex shrink-0 items-center gap-3 text-sm muted">
              {item.meta}
              <ArrowRight size={15} className="transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
      <Link
        className="focus-ring mx-auto mt-5 flex min-w-40 items-center justify-center gap-2 rounded-md border hairline px-5 py-3 text-sm transition hover:bg-[var(--panel)] hover:text-[var(--ink)]"
        href={seeAllHref}
      >
        See all
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.22em] muted">{label}</p>
      <div className="inline-flex overflow-hidden rounded-md border hairline bg-[color-mix(in_srgb,var(--paper)_68%,var(--panel))] text-sm">
        {children}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`focus-ring min-w-20 px-4 py-2.5 transition ${
        active ? "bg-[var(--ink)] text-[var(--paper)]" : "hover:bg-[var(--panel)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function getBrowseData(data: PublicData, region: RegionFilter, type: TypeFilter) {
  const awards = data.awards.filter((award) => {
    const matchesRegion = region === "world" || isUsAward(award.geography);
    const matchesType =
      type === "all" ||
      award.subjectAreas.some((subject) => {
        const normalized = subject.toLowerCase();
        if (type === "fiction") return normalized === "fiction" || normalized.includes(" fiction");
        return normalized === "nonfiction" || normalized.includes("nonfiction");
      });
    return matchesRegion && matchesType;
  });
  const awardIds = new Set(awards.map((award) => award.id));
  const appearances = data.appearances.filter((appearance) => awardIds.has(appearance.awardId));
  const bookIds = new Set(appearances.map((appearance) => appearance.bookId));
  const subjectCounts = new Map<string, number>();

  for (const book of data.books) {
    if (!bookIds.has(book.id)) continue;
    for (const subject of book.subjects) subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }

  return {
    subjects: data.subjects
      .map((subject) => ({ ...subject, bookCount: subjectCounts.get(subject.name) ?? 0 }))
      .filter((subject) => subject.bookCount > 0)
      .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name)),
    awards: awards
      .map((award) => ({
        ...award,
        recordCount: appearances.filter((appearance) => appearance.awardId === award.id).length,
      }))
      .filter((award) => award.recordCount > 0)
      .sort((a, b) => b.recordCount - a.recordCount || a.name.localeCompare(b.name)),
  };
}

function isUsAward(geography?: string) {
  if (!geography) return true;
  const normalized = geography.toLowerCase();
  return normalized.includes("united states") || normalized.includes("american") || normalized.includes("americas");
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p>{label}</p>
      <p className="mt-1 text-2xl text-[var(--ink)]">{value.toLocaleString()}</p>
    </div>
  );
}
