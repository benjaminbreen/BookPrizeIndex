import { pathToFileURL } from "node:url";
import type { RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchMediaWikiWikitext,
  isLikelyTitle,
  normalizeAuthorList,
  readPrizeRegistry,
  writeRawAwardRecords,
} from "./helpers";

// Wikipedia uses the FT-only canonical title (sponsor name has changed over time)
const pageTitle = "Financial Times Business Book of the Year Award";

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "ft-business-book-of-the-year");
  const category = prize?.categories.find((entry) => entry.id === "ft-business-book");
  if (!prize || !category) throw new Error("Missing ft-business-book-of-the-year registry entry in sources/prizes.json");

  console.log(`Fetching ${pageTitle} from Wikipedia...`);
  const wikitext = await fetchMediaWikiWikitext(pageTitle);
  const records = parse(prize.id, prize.name, category.id, category.name, category.sourceUrl, category.sourceLabel, category.sourceConfidence, category.officialUrl, wikitext);

  records.sort((a, b) => b.year - a.year || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  const yearRange = `${Math.min(...records.map((r) => r.year))}-${Math.max(...records.map((r) => r.year))}`;

  await writeRawAwardRecords("ft-business-book.json", records, {
    importer: "scripts/import-award-records/ft-business-book.ts",
    source: "Wikipedia prose bullet lists for FT Business Book of the Year Award",
    notes: "Winners marked with {{blue ribbon}} template in prose sections. Sponsor: Goldman Sachs (2005–2013), McKinsey (2014–2021), Schroders (2023–present).",
    categories: [{
      categoryId: category.id,
      categoryName: category.name,
      sourceUrl: category.sourceUrl,
      records: records.length,
      winners: records.filter((r) => r.status === "winner" || r.status === "co_winner").length,
      shortlisted: records.filter((r) => r.status === "shortlist").length,
      yearRange,
    }],
  });

  console.log(`Imported ${records.length} FT Business Book of the Year records (${yearRange}).`);
}

function parse(
  awardId: string,
  awardName: string,
  categoryId: string,
  categoryName: string,
  sourceUrl: string,
  sourceLabel: string,
  sourceConfidence: string,
  officialUrl: string | undefined,
  wikitext: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];

  // Split into per-year sections using === Year === headings
  const yearSectionPattern = /===\s*(\d{4})\s*===/g;
  const sections: Array<{ year: number; body: string }> = [];

  let match: RegExpExecArray | null;
  const positions: Array<{ year: number; index: number }> = [];
  while ((match = yearSectionPattern.exec(wikitext)) !== null) {
    positions.push({ year: Number(match[1]), index: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = positions[i + 1]?.index ?? wikitext.length;
    sections.push({ year: positions[i].year, body: wikitext.slice(start, end) });
  }

  for (const { year, body } of sections) {
    const winnerCount = (body.match(/\{\{[Bb]lue ribbon\}\}/g) ?? []).length;

    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("*")) continue;
      // Strip leading list marker and any nested markers
      const bulletContent = trimmed.replace(/^\*+\s*/, "");

      const isWinner = /\{\{[Bb]lue ribbon\}\}/.test(bulletContent);
      // Remove the blue ribbon template
      const content = bulletContent.replace(/\{\{[Bb]lue ribbon\}\}\s*/, "");

      const { authors, title } = extractAuthorAndTitle(content);
      if (!authors.length || !isLikelyTitle(title)) continue;
      // Skip stray award/prize references that are not books
      if (authors.some((a) => /\b(award|prize|for best)\b/i.test(a))) continue;

      const status = isWinner
        ? winnerCount > 1 ? "co_winner" : "winner"
        : "shortlist";

      records.push({
        awardId,
        awardName,
        categoryId,
        categoryName,
        year,
        status,
        title,
        authors,
        sourceUrl,
        sourceLabel,
        sourceConfidence: sourceConfidence as RawAwardRecord["sourceConfidence"],
        notes: officialUrl ? `Official awards URL: ${officialUrl}` : undefined,
      });
    }
  }

  return records;
}

function extractAuthorAndTitle(content: string): { authors: string[]; title: string } {
  // Format: Author(s), ''Title'' or Author(s), ''[[Title]]'' or Author(s), ''[[Canonical|Display]]''
  // Authors come before the first '' (italic marker for title)
  const italicIndex = content.indexOf("''");
  if (italicIndex === -1) return { authors: [], title: "" };

  const authorRaw = content.slice(0, italicIndex).replace(/,\s*$/, "").trim();
  const titleRaw = content.slice(italicIndex).replace(/^''|''$/g, "").trim();

  const authors = normalizeAuthorList(wiklinksToPlain(authorRaw));
  const title = cleanText(wikiTitleToPlain(titleRaw));

  return { authors, title };
}

function wiklinksToPlain(input: string): string {
  // [[Canonical|Display]] → Display, [[Name]] → Name
  return input
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/&\s+/g, "and ")
    .trim();
}

function wikiTitleToPlain(input: string): string {
  return wiklinksToPlain(input)
    .replace(/^''|''$/g, "")
    .replace(/''/g, "")
    .trim();
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "shortlist") return 2;
  return 9;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
