import type { PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  writeRawAwardRecords,
} from "./helpers";

const winnersUrl = "https://proseawards.com/winners/";
const skippedCategoryNames = new Set([
  "Accounting Practice",
  "Clinical Medicine Practice",
  "Environmental ScienceGetty Publications",
  "Excellence in D & P - Books",
  "Hard Media, Mathematics/Science",
  "Honorable Mention",
  "Johns Hopkins University Press",
  "Legal & Accounting Practice",
  "Legal and Accounting Practice",
  "Palgrave Macmillan",
]);
const skippedCategoryPatterns = [
  /\bjournals?\b/i,
  /\beproducts?\b/i,
  /\bapp\b/i,
  /\bplatform\b/i,
  /\belectronic product\b/i,
  /\bhard media\b/i,
  /\bhandbooks?\b/i,
  /\breference\b/i,
  /\bmultivolume\b/i,
  /\bmulti[-\s]?volume\b/i,
  /\bsingle volume\b/i,
  /\btextbooks?\b/i,
];
const canonicalCategoryByKey: Record<string, string> = {
  "anthropology": "Anthropology and Sociology",
  "anthropology criminology and sociology": "Anthropology and Sociology",
  "applied social work nursing and allied health": "Nursing, Allied Health, and Social Work",
  "archaeology and ancient history": "Archaeology and Ancient History",
  "archaeology and anthropology": "Archaeology and Ancient History",
  "archeology and ancient history": "Archaeology and Ancient History",
  "archeology and anthropology": "Archaeology and Ancient History",
  "architecture and urban planning": "Architecture and Urban Planning",
  "architecture and urban studies": "Architecture and Urban Planning",
  "architecture urban planning": "Architecture and Urban Planning",
  "art and art history": "Art History and Criticism",
  "arts and art history": "Art History and Criticism",
  "art exhibitions": "Art History and Criticism",
  "art history and criticism": "Art History and Criticism",
  "arts": "Arts and Culture",
  "arts language and literature": "Literature, Language, and Linguistics",
  "arts literature and language": "Literature, Language, and Linguistics",
  "bio and medical sciences": "Biomedicine and Neuroscience",
  "biography and autobiography": "Biography and Autobiography",
  "biological anthropology ancient history and archaeology": "Biological Anthropology and Ancient History",
  "biological anthropology archaeology and ancient history": "Biological Anthropology and Ancient History",
  "biological anthropology archeology and ancient history": "Biological Anthropology and Ancient History",
  "biological science": "Biological Sciences",
  "biological sciences": "Biological Sciences",
  "biology includes animal science and botany": "Biological Sciences",
  "biomedicine": "Biomedicine and Neuroscience",
  "biomedicine and neuroscience": "Biomedicine and Neuroscience",
  "biomedicine and neuroscience includes biochemistry and biophysics": "Biomedicine and Neuroscience",
  "business and management": "Business, Finance, and Management",
  "business finance and management": "Business, Finance, and Management",
  "business management and accounting": "Business, Finance, and Management",
  "business management and finance": "Business, Finance, and Management",
  "business social sciences humanities": "Business, Finance, and Management",
  "business social sciences and humanities": "Business, Finance, and Management",
  "businesssocial scienceshumanities": "Business, Finance, and Management",
  "chemistry": "Chemistry, Physics, Astronomy, and Cosmology",
  "chemistry and physics": "Chemistry, Physics, Astronomy, and Cosmology",
  "chemistry physics astronomy and cosmology": "Chemistry, Physics, Astronomy, and Cosmology",
  "chemistry physics mathematics and astronomy": "Chemistry, Physics, Astronomy, and Cosmology",
  "classics": "Classics and Ancient History",
  "classics and ancient history": "Classics and Ancient History",
  "classics and archeology": "Classics and Ancient History",
  "clinical medicine": "Clinical Medicine",
  "clinical medicine and allied health": "Clinical Medicine",
  "clinical psychology": "Psychology",
  "clinical psychology and psychiatry": "Psychology",
  "communication and cultural studies": "Media and Cultural Studies",
  "computer and information science": "Computing and Information Sciences",
  "computer and information sciences": "Computing and Information Sciences",
  "computer science": "Computing and Information Sciences",
  "computer science and data processing": "Computing and Information Sciences",
  "computing and information science": "Computing and Information Sciences",
  "computing and information sciences": "Computing and Information Sciences",
  "cosmology and astronomy": "Chemistry, Physics, Astronomy, and Cosmology",
  "cultural anthropology and sociology": "Anthropology and Sociology",
  "earth science": "Earth and Environmental Sciences",
  "earth sciences": "Earth and Environmental Sciences",
  "economics": "Economics",
  "education": "Education",
  "education practice": "Education",
  "education practice and theory": "Education",
  "education theory": "Education",
  "education theory and practice": "Education",
  "engineering": "Engineering and Technology",
  "engineering and technology": "Engineering and Technology",
  "environmental science": "Earth and Environmental Sciences",
  "european and world history": "World History",
  "european history": "World History",
  "finance and economics": "Economics",
  "general engineering": "Engineering and Technology",
  "geography and earth science": "Earth and Environmental Sciences",
  "geography and earth sciences": "Earth and Environmental Sciences",
  "geography and earth sciences psychology": "Earth and Environmental Sciences",
  "geology and earth science": "Earth and Environmental Sciences",
  "geology and geography": "Earth and Environmental Sciences",
  "government and political science": "Government and Politics",
  "government and politics": "Government and Politics",
  "government policy and politics": "Government and Politics",
  "history": "History",
  "history and american studies": "U.S. History",
  "history of science": "History of Science, Medicine, and Technology",
  "history of science and technology": "History of Science, Medicine, and Technology",
  "history of science medicine and technology": "History of Science, Medicine, and Technology",
  "history of science medicine technology": "History of Science, Medicine, and Technology",
  "history of science technology medicine": "History of Science, Medicine, and Technology",
  "history of science technology and medicine": "History of Science, Medicine, and Technology",
  "history of stm": "History of Science, Medicine, and Technology",
  "history government and political science": "Government and Politics",
  "language and linguistics": "Literature, Language, and Linguistics",
  "law": "Law and Legal Studies",
  "law and legal studies": "Law and Legal Studies",
  "legal": "Law and Legal Studies",
  "legal studies": "Law and Legal Studies",
  "legal studies and criminology": "Law and Legal Studies",
  "literature": "Literature, Language, and Linguistics",
  "literature and language": "Literature, Language, and Linguistics",
  "literature language and linguistics": "Literature, Language, and Linguistics",
  "mathematics": "Mathematics and Statistics",
  "mathematics and statistics": "Mathematics and Statistics",
  "mathematics science": "Mathematics and Statistics",
  "media and cultural studies": "Media and Cultural Studies",
  "medical science": "Biomedicine and Neuroscience",
  "music and performing arts": "Music and the Performing Arts",
  "music and the performing arts": "Music and the Performing Arts",
  "neuroscience": "Biomedicine and Neuroscience",
  "nonfiction graphic novels": "Nonfiction Graphic Novels",
  "north american and u s history": "U.S. History",
  "north american and us history": "U.S. History",
  "north american history": "U.S. History",
  "north american u s history": "U.S. History",
  "nursing and allied health": "Nursing, Allied Health, and Social Work",
  "nursing and allied health including social work": "Nursing, Allied Health, and Social Work",
  "nursing and allied health sciences": "Nursing, Allied Health, and Social Work",
  "nursing and allied health services": "Nursing, Allied Health, and Social Work",
  "outstanding scholarly work by a trade publisher": "Outstanding Work by a Trade Publisher",
  "outstanding work by a trade publisher": "Outstanding Work by a Trade Publisher",
  "outstanding works by a trade publisher": "Outstanding Work by a Trade Publisher",
  "philosophy": "Philosophy and Religion",
  "philosophy and religion": "Philosophy and Religion",
  "physics and astronomy": "Chemistry, Physics, Astronomy, and Cosmology",
  "popular science and mathematics": "Popular Science and Mathematics",
  "popular science and popular mathematics": "Popular Science and Mathematics",
  "psychology": "Psychology",
  "psychology and applied social work": "Psychology",
  "psychology and cognitive science": "Psychology",
  "religion": "Theology and Religious Studies",
  "science technology medicine": "History of Science, Medicine, and Technology",
  "science technology and medicine": "History of Science, Medicine, and Technology",
  "sciencetechnologymedicine": "History of Science, Medicine, and Technology",
  "social sciences": "Social Sciences",
  "social sciences humanities": "Social Sciences",
  "sociology and anthropology": "Anthropology and Sociology",
  "sociology and social work": "Anthropology and Sociology",
  "theology and religious studies": "Theology and Religious Studies",
  "theology religious studies": "Theology and Religious Studies",
  "u s history": "U.S. History",
  "u s history and biography autobiography": "U.S. History",
  "world history": "World History",
  "world history and biography autobiography": "World History",
};

type ProseWinner = {
  categoryName: string;
  publisher: string;
  title: string;
  authors: string[];
  status: "winner" | "honorable_mention";
};

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "prose-awards");
  if (!prize) throw new Error("Missing prose-awards registry entry in sources/prizes.json");

  console.log(`Fetching PROSE winners archive from ${winnersUrl}...`);
  const archiveHtml = await fetchHtml(winnersUrl);
  const yearPages = extractYearPages(archiveHtml);
  const records: RawAwardRecord[] = [];

  for (const page of yearPages) {
    console.log(`Fetching PROSE ${page.year} winners...`);
    const html = await fetchHtml(page.url);
    const winners = parseYearCategoryWinners(html);
    records.push(...winners.map((winner) => toRawAwardRecord(prize, winner, page.year, page.url)));
  }

  records.sort((a, b) => b.year - a.year || a.categoryName.localeCompare(b.categoryName) || statusSort(a.status) - statusSort(b.status) || a.title.localeCompare(b.title));

  await writeRawAwardRecords("prose.json", records, {
    importer: "scripts/import-award-records/prose.ts",
    source: "Official PROSE Awards winners archive",
    notes: "Imports category winners and honorable mentions from official PROSE Awards year pages. Journal categories are skipped because they are not book records.",
    categories: categoryReports(records),
  });

  console.log(`Imported ${records.length} PROSE category records across ${yearPages.length} years.`);
}

export function parseYearCategoryWinners(html: string): ProseWinner[] {
  const lines = htmlToLines(html);
  const categoryHeaderIndex = lines.findIndex((line) => line === "Category Award Winners");
  if (categoryHeaderIndex === -1) return [];

  const winners: ProseWinner[] = [];
  const sectionLines = lines.slice(categoryHeaderIndex + 1);
  const sections: string[][] = [];
  let current: string[] = [];
  for (const line of sectionLines) {
    if (/^The PROSE Awards are sponsored/i.test(line) || /^Terms &/i.test(line)) break;
    if (line === "*" || line === " " || line === "&nbsp;") {
      if (current.length) sections.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) sections.push(current);

  for (const section of sections) {
      const categoryName = canonicalCategoryName(section[0]);
    if (!categoryName) continue;
    if (shouldSkipCategory(categoryName)) {
      continue;
    }

    let status: ProseWinner["status"] = "winner";
    for (let index = 1; index < section.length;) {
      const marker = statusMarker(section[index]);
      if (marker) {
        status = marker;
        index += 1;
        continue;
      }
      const publisher = section[index];
      const title = section[index + 1];
      const authorText = section[index + 2];
      if (!publisher || !title || !authorText || statusMarker(authorText)) break;
      if (statusMarker(title) || isNonBookTitle(title)) {
        index += 1;
        continue;
      }
      winners.push({
        categoryName,
        publisher,
        title,
        authors: normalizeProseAuthorList(authorText),
        status,
      });
      index += 3;
    }
  }

  return winners.filter((winner) => winner.authors.length && winner.title);
}

function toRawAwardRecord(prize: PrizeRegistryEntry, winner: ProseWinner, year: number, sourceUrl: string): RawAwardRecord {
  return {
    awardId: prize.id,
    awardName: prize.name,
    categoryId: `prose-${slugify(winner.categoryName)}`,
    categoryName: winner.categoryName,
    year,
    status: winner.status,
    title: winner.title,
    authors: winner.authors,
    publisher: winner.publisher,
    sourceUrl,
    sourceLabel: `PROSE Awards ${year} winners archive`,
    sourceConfidence: "official",
    notes: `Official awards URL: ${sourceUrl}`,
  };
}

function categoryReports(records: RawAwardRecord[]) {
  const reports = new Map<string, { categoryId: string; categoryName: string; sourceUrl: string; records: number; winners: number; honorableMentions: number; years: number[] }>();
  for (const record of records) {
    const current = reports.get(record.categoryId) ?? {
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      sourceUrl: record.sourceUrl,
      records: 0,
      winners: 0,
      honorableMentions: 0,
      years: [],
    };
    current.records += 1;
    if (record.status === "winner" || record.status === "co_winner") current.winners += 1;
    if (record.status === "honorable_mention") current.honorableMentions += 1;
    current.years.push(record.year);
    reports.set(record.categoryId, current);
  }
  return [...reports.values()]
    .map((report) => ({
      categoryId: report.categoryId,
      categoryName: report.categoryName,
      sourceUrl: report.sourceUrl,
      records: report.records,
      winners: report.winners,
      honorableMentions: report.honorableMentions,
      yearRange: `${Math.min(...report.years)}-${Math.max(...report.years)}`,
    }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "book-prize-index-importer/0.1 (research dataset builder)",
    },
  });
  if (!response.ok) throw new Error(`PROSE request failed for ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

function extractYearPages(html: string) {
  const pages = new Map<number, string>();
  const linkPattern = /href="([^"]+)"[^>]*>(\d{4}) Award Winners/gi;
  for (const match of html.matchAll(linkPattern)) {
    const year = Number(match[2]);
    const rawUrl = match[1].replace(/#.*$/, "");
    if (year >= 1991 && year <= new Date().getFullYear() + 1) pages.set(year, rawUrl);
  }
  return [...pages.entries()]
    .map(([year, url]) => ({ year, url }))
    .sort((a, b) => b.year - a.year);
}

function normalizeProseAuthorList(input: string) {
  return normalizeAuthorList(
    input
      .replace(/^(?:By|By:|Edited by|Editor:|Editors:|Editor-in-Chief)\s+/i, "")
      .replace(/\bWith\b/g, "and"),
  );
}

function statusMarker(input: string): ProseWinner["status"] | undefined {
  if (/^Honou?rable Mention$/i.test(input)) return "honorable_mention";
  return undefined;
}

function isNonBookTitle(input: string) {
  return /^(winner|finalist|shortlist|longlist|honou?rable mention|notable)$/i.test(input.trim());
}

function statusSort(status: RawAwardRecord["status"]) {
  if (status === "winner" || status === "co_winner") return 1;
  if (status === "honorable_mention") return 2;
  return 9;
}

function shouldSkipCategory(categoryName: string) {
  return skippedCategoryNames.has(categoryName) || skippedCategoryPatterns.some((pattern) => pattern.test(categoryName));
}

function canonicalCategoryName(categoryName: string) {
  return canonicalCategoryByKey[categoryKey(categoryName)] ?? categoryName;
}

function categoryKey(categoryName: string) {
  return categoryName
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " ")
    .replace(/\bu\.?s\.?\b/g, "u s")
    .replace(/\bstm\b/g, "science technology medicine")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function htmlToLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<li[^>]*>/gi, "\n* ")
      .replace(/<h[1-6][^>]*>/gi, "\n")
      .replace(/<p[^>]*>/gi, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function decodeHtml(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&ldquo;/g, "\"")
    .replace(/&#8221;|&rdquo;/g, "\"")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
