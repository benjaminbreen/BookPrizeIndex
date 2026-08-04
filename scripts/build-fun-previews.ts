/**
 * Small preview payloads for the /fun index cards.
 *
 * The source datasets are large -- the galaxy projection alone is ~3.9 MB -- and the
 * index page only needs a few dozen cover URLs and a sampled dot field. Precomputing
 * here keeps the page from importing megabytes just to draw a thumbnail.
 *
 * The Chromatic Index card is not included: it already derives its preview from
 * cover-spectrum.json, and its hue-sorted ordering is the point of that experiment.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { LlmChoiceData } from "../lib/llm-choice-types";
import type { NonfictionTalksData } from "../lib/nonfiction-talks-types";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "public/fun/previews.json");
const COVER_COUNT = 18;
const GALAXY_DOTS = 900;

type GalaxyFile = {
  points: Array<{ x: number; y: number; subjectIndex: number; recognitionScore: number }>;
};
type ShelfFile = {
  rows: Array<{ thumbnailUrl?: string }>;
};

async function main() {
  const [galaxy, shelf, llmChoice, talks] = await Promise.all([
    readJson<GalaxyFile>(path.join(ROOT, "public/fun/nonfiction-galaxy.json")),
    readJson<ShelfFile>(path.join(ROOT, "data/public/library-shelf.json")),
    readJson<LlmChoiceData>(path.join(ROOT, "public/fun/llm-choice.json")),
    readJson<NonfictionTalksData>(path.join(ROOT, "public/fun/nonfiction-talks.json")),
  ]);

  const previews = {
    generatedAt: new Date().toISOString(),
    // Sampled by even stride rather than taking the head, so the dot field keeps the
    // shape of the whole projection instead of one corner of it.
    galaxy: {
      dots: stride(galaxy.points, GALAXY_DOTS).map((point) => [
        round(point.x),
        round(point.y),
        point.subjectIndex,
      ]),
    },
    // Per-year stance widths only: enough to redraw the wedge at thumbnail size
    // without shipping any claim text. Trailing slot is the unclaimed tail.
    talks: {
      maxRow: talks.maxRow,
      rows: talks.years.filter((row) => row.year >= 1975).map((row) => {
        const widths = new Array<number>(talks.stances.length + 1).fill(0);
        for (const claim of row.claims) widths[claim.stance] += 1;
        widths[talks.stances.length] = row.unclaimed;
        return widths;
      }),
    },
    llmChoice: { covers: coverStrip(llmChoice.overlooked.map((book) => book.thumbnailUrl)) },
    libraryShelf: { covers: coverStrip(shelf.rows.map((row) => row.thumbnailUrl)) },
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(previews)}\n`);
  console.log(
    `Fun previews ready: ${previews.galaxy.dots.length} galaxy dots, ` +
    `${previews.talks.rows.length} talk rows, ${previews.llmChoice.covers.length} + ${previews.libraryShelf.covers.length} covers.`,
  );
}

/** Evenly spaced sample across the whole list, always including the first item. */
function stride<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * step)]);
}

function coverStrip(urls: Array<string | undefined>) {
  return stride(urls.filter((url): url is string => Boolean(url)), COVER_COUNT);
}

function round(value: number) {
  return Number(value.toFixed(4));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
