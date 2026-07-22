import { pathToFileURL } from "node:url";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry, RawAwardRecord } from "../../lib/award-records";
import {
  cleanText,
  fetchHtml,
  htmlToPlainText,
  normalizeAuthorList,
  readPrizeRegistry,
  slugify,
  writeRawAwardRecords,
} from "./helpers";

type ShortlistRow = { title: string; authors: string[] };

const officialShortlists: Array<{ year: number; url: string; rows: ShortlistRow[] }> = [
  { year: 2019, url: "https://nanovic.nd.edu/news/laura-shannon-prize-announces-2019-shortlist/", rows: [
    { title: "Violence as a Generative Force: Identity, Nationalism, and Memory in a Balkan Community", authors: ["Max Bergholz"] },
    { title: "On British Islam: Religion, Law, and Everyday Practice in Shariʿa Councils", authors: ["John R. Bowen"] },
    { title: "The House of Government: A Saga of the Russian Revolution", authors: ["Yuri Slezkine"] },
    { title: "Women in the Holocaust: A Feminist History", authors: ["Zoë Waxman"] },
    { title: "Conservative Parties and the Birth of Democracy", authors: ["Daniel Ziblatt"] },
  ] },
  { year: 2020, url: "https://nanovic.nd.edu/news/laura-shannon-prize-announces-2020-shortlist/", rows: [
    { title: "Colonial al-Andalus: Spain and the Making of Modern Moroccan Culture", authors: ["Eric Calderwood"] },
    { title: "Catholic Modern: The Challenge of Totalitarianism and the Remaking of the Church", authors: ["James Chappel"] },
    { title: "The Politics of Opera: From Monteverdi to Mozart", authors: ["Mitchell Cohen"] },
    { title: "Restoration: The Fall of Napoleon in the Course of European Art, 1812-1820", authors: ["Thomas Crow"] },
    { title: "To See Paris and Die: The Soviet Lives of Western Culture", authors: ["Eleonory Gilburd"] },
  ] },
  { year: 2021, url: "https://nanovic.nd.edu/news/nanovic-institute-for-european-studies-announces-2021-laura-shannon-prize-shortlist/", rows: [
    { title: "From Triumph to Crisis: Neoliberal Economic Reform in Postcommunist Countries", authors: ["Hilary Appel", "Mitchell Orenstein"] },
    { title: "Manual for Survival: A Chernobyl Guide to the Future", authors: ["Kate Brown"] },
    { title: "The Unsettling of Europe: How Migration Reshaped a Continent", authors: ["Peter Gatrell"] },
    { title: "Leftism Reinvented: Western Parties from Socialism to Neoliberalism", authors: ["Stephanie L. Mudge"] },
    { title: "Empire of Guns: The Violent Making of the Industrial Revolution", authors: ["Priya Satia"] },
  ] },
  { year: 2022, url: "https://nanovic.nd.edu/news/nanovic-institute-announces-2022-laura-shannon-prize-shortlist/", rows: [
    { title: "Ruin and Renewal: Civilizing Europe After World War II", authors: ["Paul Betts"] },
    { title: "Heroines and Local Girls: The Transnational Emergence of Women’s Writing in the Long Eighteenth Century", authors: ["Pamela Cheek"] },
    { title: "The Naked Truth: Viennese Modernism and the Body", authors: ["Alys George"] },
    { title: "Women at Work in Twenty-First-Century European Cinema", authors: ["Barbara Mennel"] },
    { title: "The Ruins Lesson: Meaning and Material in Western Culture", authors: ["Susan Stewart"] },
  ] },
  { year: 2023, url: "https://nanovic.nd.edu/news/nanovic-institute-announces-2023-laura-shannon-prize-shortlist/", rows: [
    { title: "The World Refugees Made: Decolonization and the Foundation of Postwar Italy", authors: ["Pamela Ballinger"] },
    { title: "Conquering Peace: From the Enlightenment to the European Union", authors: ["Stella Ghervas"] },
    { title: "Muslims and the Making of Modern Europe", authors: ["Emily Greble"] },
    { title: "African Europeans: An Untold Story", authors: ["Olivette Otele"] },
    { title: "Statelessness: A Modern History", authors: ["Mira L. Siegelberg"] },
  ] },
  { year: 2024, url: "https://nanovic.nd.edu/news/nanovic-institute-announces-2024-laura-shannon-prize-shortlist/", rows: [
    { title: "Sculptors Against the State: Anarchism and the Anglo-European Avant-Garde", authors: ["Mark Antliff"] },
    { title: "Eurasia Without Borders: The Dream of a Leftist Commons, 1919-1943", authors: ["Katerina Clark"] },
    { title: "Blood of Others: Stalin’s Crimean Atrocity and the Poetics of Solidarity", authors: ["Rory Finnin"] },
    { title: "Time’s Witness: History in the Age of Romanticism", authors: ["Rosemary Hill"] },
    { title: "The Best Weapon for Peace: Maria Montessori, Education, and Children’s Rights", authors: ["Erica Moretti"] },
  ] },
  { year: 2025, url: "https://nanovic.nd.edu/news/shortlist-named-for-the-2025-laura-shannon-prize-in-contemporary-european-studies/", rows: [
    { title: "The Seventh Member State: Algeria, France, and the European Community", authors: ["Megan Brown"] },
    { title: "Southern Europe in the Age of Revolutions", authors: ["Maurizio Isabella"] },
    { title: "The Pursuit of Europe: A History", authors: ["Anthony Pagden"] },
    { title: "Never Again: Germans and Genocide after the Holocaust", authors: ["Andrew I. Port"] },
    { title: "The Life and Death of States: Central Europe and the Transformation of Modern Sovereignty", authors: ["Natasha Wheatley"] },
  ] },
  { year: 2026, url: "https://nanovic.nd.edu/news/2026-laura-shannon-prize-in-contemporary-european-studies-shortlist-named/", rows: [
    { title: "The Stories Old Towns Tell: A Journey through Cities at the Heart of Europe", authors: ["Marek Kohn"] },
    { title: "Herder and Enlightenment Politics", authors: ["Eva Piirimäe"] },
    { title: "Don't Look Away: Art, Nonviolence, and Preventive Publics in Contemporary Europe", authors: ["Brianne Cohen"] },
    { title: "On Earth or in Poems: The Many Lives of al-Andalus", authors: ["Eric Calderwood"] },
    { title: "The Shadow of the Empress: Fairy-Tale Opera and the End of the Habsburg Empire", authors: ["Larry Wolff"] },
  ] },
];

async function main() {
  const registry = await readPrizeRegistry();
  const prize = registry.find((entry) => entry.id === "laura-shannon-prize");
  const category = prize?.categories.find((entry) => entry.id === "laura-shannon-european-studies");
  if (!prize || !category) throw new Error("Missing Laura Shannon Prize registry entry");

  console.log(`Fetching Laura Shannon Prize winners from ${category.sourceUrl}...`);
  const winners = parseLauraShannon(prize, category, await fetchHtml(category.sourceUrl));
  const winnerKeys = new Set(winners.map((record) => `${record.year}:${slugify(record.title)}`));
  const finalists = officialShortlists.flatMap(({ year, url, rows }) => rows
    .filter((row) => !winnerKeys.has(`${year}:${slugify(row.title)}`))
    .map((row): RawAwardRecord => ({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year,
      status: "finalist",
      title: row.title,
      authors: row.authors,
      sourceUrl: url,
      sourceLabel: `Laura Shannon Prize ${year} official shortlist`,
      sourceConfidence: "official",
    })));
  const records = [...winners, ...finalists]
    .sort((a, b) => b.year - a.year);
  assertCoverage(records);

  await writeRawAwardRecords("laura-shannon.json", records, {
    importer: "scripts/import-award-records/laura-shannon.ts",
    source: category.sourceLabel,
    notes: "Imports winner cards from the official archive and official five-book shortlists for 2019-2026. Shortlisted winners retain only winner status. Silver medalists and honorable mentions are intentionally deferred.",
    records: records.length,
    winners: winners.length,
    finalists: finalists.length,
    yearRange: yearRange(records),
  });
  console.log(`Imported ${winners.length} Laura Shannon Prize winners and ${finalists.length} finalists (${yearRange(records)}).`);
}

export function parseLauraShannon(
  prize: PrizeRegistryEntry,
  category: PrizeCategoryRegistryEntry,
  html: string,
): RawAwardRecord[] {
  const records: RawAwardRecord[] = [];

  for (const match of html.matchAll(/<li\b[^>]*class="[^"]*shannon-prize-card[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const titleMatch = block.match(/<h2\b[^>]*class="[^"]*card-title[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const authorMatch = block.match(/<p>\s*<em>([\s\S]*?)<\/em>\s*<\/p>/i);
    const yearMatch = block.match(/<p>\s*((?:19|20)\d{2})\s*<\/p>/i);
    if (!titleMatch || !authorMatch || !yearMatch) continue;

    const title = htmlToPlainText(titleMatch[2]);
    const authors = normalizeAuthorList(htmlToPlainText(authorMatch[1]).replace(/^Sir\s+/i, ""));
    if (!title || !authors.length) continue;

    records.push({
      awardId: prize.id,
      awardName: prize.name,
      categoryId: category.id,
      categoryName: category.name,
      year: Number(yearMatch[1]),
      status: "winner",
      title,
      authors,
      sourceUrl: new URL(titleMatch[1], category.sourceUrl).toString(),
      sourceLabel: `Laura Shannon Prize ${yearMatch[1]} official winner page`,
      sourceConfidence: category.sourceConfidence,
    });
  }

  return records;
}

function assertCoverage(records: RawAwardRecord[]) {
  if (records.length < 17) throw new Error(`Expected at least 17 Laura Shannon winners, got ${records.length}`);
  if (yearRange(records) !== "2010-2026") throw new Error(`Unexpected Laura Shannon range: ${yearRange(records)}`);
}

function yearRange(records: RawAwardRecord[]) {
  const years = records.map((record) => record.year);
  return years.length ? `${Math.min(...years)}-${Math.max(...years)}` : "none";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
