"use client";

import Link from "next/link";
import { ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PublicData } from "@/lib/types";

type AwardSort = "name" | "records" | "subject" | "deadline";

export function AwardsBrowser({ data }: { data: PublicData }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AwardSort>("name");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.awards
      .map((award) => ({
        award,
        records: data.appearances.filter((appearance) => appearance.awardId === award.id).length,
      }))
      .filter(({ award }) =>
        [award.name, award.shortName, award.awardType, award.criteria, award.subjectAreas.join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .sort((a, b) => {
        if (sort === "records") return b.records - a.records || a.award.name.localeCompare(b.award.name);
        if (sort === "subject") return a.award.subjectAreas.join(", ").localeCompare(b.award.subjectAreas.join(", "));
        if (sort === "deadline") return (a.award.deadline ?? "zzz").localeCompare(b.award.deadline ?? "zzz");
        return a.award.name.localeCompare(b.award.name);
      });
  }, [data.appearances, data.awards, query, sort]);

  return (
    <main>
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Find awards</p>
        <h1 className="mt-3 max-w-4xl font-[var(--font-serif)] text-5xl font-light leading-tight">
          Search prizes by subject, criteria, source, and deadline.
        </h1>
        <p className="mt-5 max-w-2xl font-[var(--font-serif)] text-xl font-light leading-8 muted">
          This directory starts with the prize histories in the seed workbook. Deadline, criteria, fee, geography, and
          submission fields are part of the schema and ready for enrichment.
        </p>

        <div className="panel mt-8 border hairline p-4">
          <div className="flex items-center gap-3 border-b hairline pb-4">
            <Search size={18} className="muted" />
            <input
              className="w-full bg-transparent text-lg outline-none placeholder:text-[var(--muted)]"
              placeholder="Search awards, subjects, criteria..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 font-[var(--font-mono)] text-xs">
            {(["name", "records", "subject", "deadline"] as AwardSort[]).map((item) => (
              <button
                key={item}
                className={`focus-ring inline-flex items-center gap-2 border hairline px-3 py-2 capitalize transition ${
                  sort === item ? "bg-[var(--ink)] text-[var(--paper)]" : "muted hover:text-[var(--ink)]"
                }`}
                onClick={() => setSort(item)}
              >
                <ArrowUpDown size={12} />
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 overflow-x-auto border hairline panel">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead className="font-[var(--font-mono)] text-xs uppercase tracking-[0.08em] muted">
              <tr className="border-b hairline">
                <th className="px-4 py-3 font-normal">Prize</th>
                <th className="px-4 py-3 font-normal">Type</th>
                <th className="px-4 py-3 font-normal">Subject</th>
                <th className="px-4 py-3 font-normal">Deadline</th>
                <th className="px-4 py-3 font-normal">Criteria</th>
                <th className="px-4 py-3 font-normal">Records</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ award, records }) => (
                <tr className="border-b hairline transition hover:bg-[var(--accent-soft)]" key={award.id}>
                  <td className="px-4 py-4">
                    <Link className="font-[var(--font-serif)] text-xl font-light" href={`/awards/${award.slug}`}>
                      {award.name}
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    <span className="border hairline px-2 py-1 font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.08em]">
                      {award.awardType === "award" ? "Award" : "Major"}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm">{award.subjectAreas.join(", ")}</td>
                  <td className="px-4 py-4 font-[var(--font-mono)] text-xs muted">{award.deadline ?? "Not sourced"}</td>
                  <td className="px-4 py-4 text-sm muted">{award.criteria ?? "Pending official criteria import"}</td>
                  <td className="plain-number px-4 py-4 text-sm">{records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
