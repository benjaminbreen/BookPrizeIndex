"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Award, AwardProgram, PublicData } from "@/lib/types";

type AwardSort = "name" | "records" | "subject" | "deadline";
type GeographyFilter = "all" | "us" | "world";
type BookTypeFilter = "all" | "fiction" | "nonfiction";

export function AwardsBrowser({ data }: { data: PublicData }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AwardSort>("name");
  const [geography, setGeography] = useState<GeographyFilter>("all");
  const [bookType, setBookType] = useState<BookTypeFilter>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const programRows = (data.awardPrograms ?? [])
      .map((program) => {
        const awards = data.awards.filter((award) => award.programId === program.id);
        if (awards.length < 2) return null;
        return buildProgramRow(program, awards, data);
      })
      .filter((row): row is AwardBrowserRow => Boolean(row));
    const groupedAwardIds = new Set(programRows.flatMap((row) => row.awards.map((award) => award.id)));
    const awardRows = data.awards
      .filter((award) => !groupedAwardIds.has(award.id))
      .map((award) => buildAwardRow(award, data));

    return [...programRows, ...awardRows]
      .filter((row) => row.records > 0)
      .filter((row) => matchesGeography(row.geography, geography))
      .filter((row) => matchesBookType(row.subjects, bookType))
      .filter((row) =>
        [row.name, row.shortName, row.typeLabel, row.description, row.subjects.join(" "), row.matchedCategories]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .sort((a, b) => {
        if (sort === "records") return b.records - a.records || a.name.localeCompare(b.name);
        if (sort === "subject") return a.subjects.join(", ").localeCompare(b.subjects.join(", "));
        if (sort === "deadline") return (a.deadline ?? "zzz").localeCompare(b.deadline ?? "zzz");
        return a.name.localeCompare(b.name);
      });
  }, [bookType, data.appearances, data.awards, geography, query, sort]);

  return (
    <main className="subjects-page mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <section className="subjects-hero grid gap-8 lg:grid-cols-[0.86fr_1fr] lg:items-center">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Awards</p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-normal">Browse awards.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 muted">
            Explore nonfiction prizes by subject, eligibility, deadline, and source.
            <br />
            Click an award to view related books and records.
          </p>
        </div>

        <div className="subjects-search focus-within:border-[var(--ink)]">
          <Search className="shrink-0 text-[var(--ink)]" size={24} strokeWidth={1.8} />
          <input
            className="min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-[var(--muted)]"
            placeholder="Search awards, subjects, criteria..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </section>

      <section className="subjects-table-panel mt-6 border hairline">
        <div className="subjects-filterbar flex flex-col gap-5 border-b hairline px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            <FilterGroup label="Award Geography">
              <SegmentButton active={geography === "all"} onClick={() => setGeography("all")}>All</SegmentButton>
              <SegmentButton active={geography === "us"} onClick={() => setGeography("us")}>US</SegmentButton>
              <SegmentButton active={geography === "world"} onClick={() => setGeography("world")}>World</SegmentButton>
            </FilterGroup>

            <FilterGroup label="Book Type">
              <SegmentButton active={bookType === "all"} onClick={() => setBookType("all")}>All</SegmentButton>
              <SegmentButton active={bookType === "fiction"} onClick={() => setBookType("fiction")}>Fiction</SegmentButton>
              <SegmentButton active={bookType === "nonfiction"} onClick={() => setBookType("nonfiction")}>Nonfiction</SegmentButton>
            </FilterGroup>
          </div>

          <FilterGroup label="Sort" wrap>
            {(["name", "records", "subject", "deadline"] as AwardSort[]).map((item) => (
              <SegmentButton key={item} active={sort === item} onClick={() => setSort(item)}>
                <span className="inline-flex items-center gap-2 capitalize">
                  <ArrowUpDown size={12} />
                  {item}
                </span>
              </SegmentButton>
            ))}
          </FilterGroup>
        </div>

        <div className="overflow-x-auto">
          <table className="subjects-table w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b hairline">
                <th className="px-6 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Prize</th>
                <th className="w-72 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Subject</th>
                <th className="w-80 px-4 py-4 font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Deadline</th>
                <th className="w-28 px-4 py-4 text-right font-[var(--font-mono)] text-xs font-normal uppercase tracking-[0.18em] muted">Records</th>
                <th className="w-16 px-6 py-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr className="subjects-row border-b hairline" key={row.id} style={{ animationDelay: `${Math.min(index * 28, 420)}ms` }}>
                  <td className="px-6 py-4">
                    <Link className="subjects-title-link block" href={`/awards/${row.slug}`}>
                      <span className="block text-xl font-medium leading-tight">{row.name}</span>
                      <span className="mt-1 block text-sm leading-5 muted">{row.description}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-sm leading-6">{row.subjects.join(", ")}</td>
                  <td className="px-4 py-4 text-sm leading-6 muted">{row.deadline ?? row.typeLabel}</td>
                  <td className="plain-number px-4 py-4 text-right text-lg">{row.records.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">
                    <Link aria-label={`View ${row.name}`} className="subjects-row-icon focus-ring ml-auto" href={`/awards/${row.slug}`}>
                      <ArrowRight size={22} strokeWidth={1.7} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

type AwardBrowserRow = {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  description: string;
  geography?: string;
  subjects: string[];
  deadline?: string;
  typeLabel: string;
  records: number;
  awards: Award[];
  matchedCategories?: string;
};

function buildAwardRow(award: Award, data: PublicData): AwardBrowserRow {
  return {
    id: award.id,
    slug: award.slug,
    name: award.name,
    shortName: award.shortName,
    description: award.criteria ?? "Pending official criteria import",
    geography: award.geography,
    subjects: award.subjectAreas,
    deadline: award.deadline,
    typeLabel: award.awardType === "award" ? "Award" : "Major award",
    records: data.appearances.filter((appearance) => appearance.awardId === award.id).length,
    awards: [award],
  };
}

function buildProgramRow(program: AwardProgram, awards: Award[], data: PublicData): AwardBrowserRow {
  const awardIds = new Set(awards.map((award) => award.id));
  const subjects = unique(awards.flatMap((award) => award.subjectAreas));
  const categories = awards.map((award) => award.categoryName ?? award.name).sort((a, b) => a.localeCompare(b));
  return {
    id: `program-${program.id}`,
    slug: program.slug,
    name: program.name,
    description: `${awards.length} categories represented: ${categories.slice(0, 3).join(", ")}${categories.length > 3 ? ", ..." : ""}`,
    geography: program.geography,
    subjects,
    typeLabel: `${awards.length} categories`,
    records: data.appearances.filter((appearance) => awardIds.has(appearance.awardId)).length,
    awards,
    matchedCategories: categories.join(" "),
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function FilterGroup({ children, label, wrap = false }: { children: React.ReactNode; label: string; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4">
      <span className="text-sm muted">{label}</span>
      <div className={`subjects-segments flex max-w-full overflow-hidden border hairline ${wrap ? "flex-wrap xl:flex-nowrap" : "inline-flex"}`}>{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className={`focus-ring min-w-16 border-r hairline px-4 py-2.5 text-sm transition last:border-r-0 sm:min-w-20 sm:px-5 ${
        active ? "bg-[var(--ink)] text-[var(--paper)] shadow-sm" : "hover:bg-[var(--panel)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function matchesGeography(geography: string | undefined, filter: GeographyFilter) {
  if (filter === "all") return true;
  const value = geography?.toLowerCase() ?? "";
  if (filter === "us") return value.includes("united states") || value.includes("america") || value.includes("u.s.");
  return !value.includes("united states") && !value.includes("u.s.");
}

function matchesBookType(subjects: string[], filter: BookTypeFilter) {
  if (filter === "all") return true;
  const normalized = subjects.map((subject) => subject.toLowerCase());
  return normalized.some((subject) => subject.includes(filter));
}
