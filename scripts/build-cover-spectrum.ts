import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { BrowseBookRow, BrowseData } from "../lib/browse-types";
import type { CoverSpectrumBook, CoverSpectrumData, CoverSpectrumLayout } from "../lib/cover-spectrum-types";

const ROOT = process.cwd();
// Keep enough source detail for the interactive view to remain useful when a
// reader zooms in. The overview is rendered down to roughly 12x18 CSS pixels
// per cover on a typical desktop, so 48x72 gives it four useful zoom levels.
const TILE_WIDTH = 48;
const TILE_HEIGHT = 72;
const DESKTOP_COLUMNS = 112;
const MOBILE_COLUMNS = 60;
const BACKGROUND = { r: 24, g: 23, b: 19 };

type AnalyzedCover = {
  book: CoverSpectrumBook;
  pixels: Buffer;
  hue: number;
  saturation: number;
  brightness: number;
};

async function main() {
  const browse = JSON.parse(await readFile(path.join(ROOT, "data/public/browse.json"), "utf8")) as BrowseData;
  const candidates = browse.books.filter(
    (book): book is BrowseBookRow & { thumbnailUrl: string } => Boolean(book.thumbnailUrl?.startsWith("/book-covers/")),
  );

  console.log(`Analyzing ${candidates.length} locally cached book covers...`);
  const analyzed = (await mapWithConcurrency(candidates, 16, analyzeCover)).filter(
    (entry): entry is AnalyzedCover => Boolean(entry),
  );

  const desktop = createSpectrumLayout(analyzed, DESKTOP_COLUMNS, "/fun/cover-spectrum-desktop.webp");
  const mobile = createSpectrumLayout(analyzed, MOBILE_COLUMNS, "/fun/cover-spectrum-mobile.webp");
  const publicFunDir = path.join(ROOT, "public/fun");
  await mkdir(publicFunDir, { recursive: true });
  await Promise.all([
    buildSprite(analyzed, desktop, path.join(publicFunDir, "cover-spectrum-desktop.webp")),
    buildSprite(analyzed, mobile, path.join(publicFunDir, "cover-spectrum-mobile.webp")),
  ]);

  const output: CoverSpectrumData = {
    generatedAt: new Date().toISOString(),
    count: analyzed.length,
    books: analyzed.map((entry) => entry.book),
    layouts: { desktop, mobile },
  };
  const outputPath = path.join(ROOT, "data/public/cover-spectrum.json");
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Wrote ${analyzed.length} covers to ${path.relative(ROOT, outputPath)}.`);
}

async function analyzeCover(book: BrowseBookRow & { thumbnailUrl: string }): Promise<AnalyzedCover | undefined> {
  const coverPath = path.join(ROOT, "public", book.thumbnailUrl.replace(/^\/+/, ""));
  try {
    const { data, info } = await sharp(coverPath)
      .rotate()
      .resize(TILE_WIDTH, TILE_HEIGHT, { fit: "cover", position: "centre" })
      .flatten({ background: BACKGROUND })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { red, green, blue } = averageRgb(data, info.channels);
    const { hue, saturation } = rgbToHsl(red, green, blue);
    const brightness = relativeLuminance(red, green, blue);

    return {
      pixels: data,
      hue,
      saturation,
      brightness,
      book: {
        slug: book.slug,
        title: book.title,
        author: book.author,
        publicationYear: book.publicationYear,
        primarySubject: book.primarySubject,
        wins: book.wins,
        lists: book.lists,
        score: book.score,
        thumbnailUrl: book.thumbnailUrl,
      },
    };
  } catch (error) {
    console.warn(`Skipping ${book.thumbnailUrl}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function createSpectrumLayout(entries: AnalyzedCover[], columns: number, imageUrl: string): CoverSpectrumLayout {
  const colorOrder = entries
    .map((_, index) => index)
    .sort((a, b) => compareColorAxis(entries[a], entries[b]));
  const columnGroups = Array.from({ length: columns }, (_, column) => {
    const start = Math.floor((column * colorOrder.length) / columns);
    const end = Math.floor(((column + 1) * colorOrder.length) / columns);
    return colorOrder.slice(start, end).sort((a, b) => {
      const coverA = entries[a];
      const coverB = entries[b];
      return coverA.brightness - coverB.brightness || coverA.saturation - coverB.saturation || coverA.book.title.localeCompare(coverB.book.title);
    });
  });
  const rows = Math.max(...columnGroups.map((group) => group.length));
  const order: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      order.push(columnGroups[column][row] ?? -1);
    }
  }
  return { columns, rows, imageUrl, order };
}

function compareColorAxis(a: AnalyzedCover, b: AnalyzedCover) {
  const aNeutral = a.saturation < 0.12;
  const bNeutral = b.saturation < 0.12;
  if (aNeutral !== bNeutral) return Number(aNeutral) - Number(bNeutral);
  if (aNeutral) return a.brightness - b.brightness || a.book.title.localeCompare(b.book.title);
  return a.hue - b.hue || b.saturation - a.saturation || a.book.title.localeCompare(b.book.title);
}

async function buildSprite(entries: AnalyzedCover[], layout: CoverSpectrumLayout, outputPath: string) {
  const width = layout.columns * TILE_WIDTH;
  const rowBuffers: Buffer[] = [];
  for (let row = 0; row < layout.rows; row += 1) {
    const composites = layout.order
      .slice(row * layout.columns, (row + 1) * layout.columns)
      .map((bookIndex, column) => bookIndex < 0 ? undefined : {
        input: entries[bookIndex].pixels,
        raw: { width: TILE_WIDTH, height: TILE_HEIGHT, channels: 3 as const },
        left: column * TILE_WIDTH,
        top: 0,
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const rowBuffer = await sharp({
      create: { width, height: TILE_HEIGHT, channels: 3, background: BACKGROUND },
    })
      .composite(composites)
      // Sharp promotes a composited image to RGBA even when the base image and
      // every cover tile are RGB. The second compositing pass expects RGB row
      // buffers, so strip that generated alpha channel before stacking rows.
      // Otherwise the RGBA bytes are interpreted as RGB and produce the
      // repeating red/cyan stripes that make the cover mosaic look corrupted.
      .removeAlpha()
      .raw()
      .toBuffer();
    rowBuffers.push(rowBuffer);
  }

  await sharp({
    create: { width, height: layout.rows * TILE_HEIGHT, channels: 3, background: BACKGROUND },
  })
    .composite(rowBuffers.map((input, row) => ({
      input,
      raw: { width, height: TILE_HEIGHT, channels: 3 },
      left: 0,
      top: row * TILE_HEIGHT,
    })))
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toFile(outputPath);
}

function averageRgb(pixels: Buffer, channels: number) {
  let red = 0;
  let green = 0;
  let blue = 0;
  const count = pixels.length / channels;
  for (let offset = 0; offset < pixels.length; offset += channels) {
    red += pixels[offset];
    green += pixels[offset + 1];
    blue += pixels[offset + 2];
  }
  return {
    red: Math.round(red / count),
    green: Math.round(green / count),
    blue: Math.round(blue / count),
  };
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { hue, saturation };
}

function relativeLuminance(red: number, green: number, blue: number) {
  const linearize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }));
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
