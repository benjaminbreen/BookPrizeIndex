import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import rawData from "../data/public/catalog.json" with { type: "json" };
import type { Imprint, PublicData } from "../lib/types";

const execFileAsync = promisify(execFile);
const data = rawData as PublicData;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "public", "imprint-logos");
const originalDir = path.join(outputDir, "_originals");
const targetWidth = 256;
const targetHeight = 128;
const sourceThumbWidth = 500;
const requestDelayMs = 450;
const maxAttempts = 4;

type LogoManifestEntry = {
  imprintId: string;
  imprintName: string;
  status: "downloaded" | "missing" | "failed";
  logoPath?: string;
  originalPath?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  mime?: string;
  error?: string;
};

type CommonsImageInfoResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          descriptionurl: string;
          mime: string;
        }>;
      }
    >;
  };
};

const approvedCommonsTitles: Record<string, string> = {
  "imprint-abrams-press": "File:Abrams Logo.svg",
  "imprint-atlantic-monthly-press": "File:Atlantic Monthly Press logo (1924).png",
  "imprint-basic-books": "File:Basic Books logo.svg",
  "imprint-beacon-press": "File:Beacon Press Logo.jpg",
  "imprint-belknap-press": "File:Harvard University Press logo.jpg",
  "imprint-bloomsbury": "File:Bloomsbury-publishing-logo.PNG",
  "imprint-bloomsbury-press": "File:Bloomsbury-publishing-logo.PNG",
  "imprint-bloomsbury-usa": "File:Bloomsbury-publishing-logo.PNG",
  "imprint-columbia-university-press": "File:Columbia University Press logo.jpg",
  "imprint-crown": "File:The Crown Publishing Group logo.png",
  "imprint-doubleday": "File:Doubleday circular logo (1929).png",
  "imprint-duke-university-press": "File:Duke University Press logo.svg",
  "imprint-farrar-straus-and-giroux": "File:Farrar, Straus and Giroux 75th anniversary logo.svg",
  "imprint-feminist-press": "File:The Feminist Press, textlogo.png",
  "imprint-harper": "File:Harper & Brothers leaf logo (1928).png",
  "imprint-harvard-university-press": "File:Harvard University Press logo (1896).png",
  "imprint-haymarket-books": "File:Haymarket Books logo.svg",
  "imprint-henry-holt": "File:Henry Holt and Company logo 1904 red.png",
  "imprint-hogarth": "File:Hogarth Press logo 1929.jpg",
  "imprint-houghton-mifflin-harcourt": "File:Houghton Mifflin Harcourt (HMH) logo 2024.svg",
  "imprint-knopf": "File:Alfred A. Knopf publisher's logo (circa 1926, red).png",
  "imprint-little-brown": "File:Little, Brown, and Company logo 1918.png",
  "imprint-liveright": "File:Boni and Liveright logo 1919.png",
  "imprint-mit-press": "File:MIT Press logo (black).svg",
  "imprint-oneworld": "File:Oneworld logo.svg",
  "imprint-oxford-university-press": "File:Oxford University Press - Logo.png",
  "imprint-pantheon": "File:Pantheon logo.png",
  "imprint-princeton-university-press": "File:Princeton University Press logo.svg",
  "imprint-random-house": "File:Penguin Random House Logo 2016.png",
  "imprint-riverhead-books": "File:Riverhead Books logo.png",
  "imprint-schocken": "File:Schocken Books logo.svg",
  "imprint-scribner": "File:Charles Scribner's Sons logo.png",
  "imprint-simon-and-schuster": "File:Simon & Schuster logo.svg",
  "imprint-university-of-chicago-press": "File:University of Chicago Press logo.jpg",
  "imprint-university-of-north-carolina-press": "File:Unc press.png",
  "imprint-yale-university-press": "File:Yale University Press logo 1985-2010.svg",
};

const localLogoAliases: Record<string, string> = {
  "imprint-bantam-books": "imprint-random-house",
  "imprint-free-press": "imprint-simon-and-schuster",
  "imprint-harcourt": "imprint-houghton-mifflin-harcourt",
  "imprint-harper-and-row": "imprint-harper",
  "imprint-houghton-mifflin": "imprint-houghton-mifflin-harcourt",
  "imprint-mariner-books": "imprint-houghton-mifflin-harcourt",
  "imprint-metropolitan-books": "imprint-henry-holt",
  "imprint-modern-library": "imprint-random-house",
  "imprint-new-american-library": "imprint-random-house",
  "imprint-one-world": "imprint-random-house",
  "imprint-penguin-books": "imprint-random-house",
  "imprint-penguin-press": "imprint-random-house",
  "imprint-pocket-books": "imprint-simon-and-schuster",
  "imprint-putnam": "imprint-random-house",
  "imprint-signet": "imprint-random-house",
  "imprint-st-martin-s-press": "imprint-henry-holt",
  "imprint-summit-books": "imprint-simon-and-schuster",
  "imprint-times-books": "imprint-henry-holt",
  "imprint-viking": "imprint-random-house",
  "imprint-villard": "imprint-random-house",
  "imprint-vintage-books": "imprint-random-house",
};

const approvedDirectLogoUrls: Record<string, string> = {
  "imprint-w-w-norton": "https://appservices.wwnorton.com/media/api/v1/asset/cf/5cf68354f9543f0017537085/seagull_logo-homepage.svg",
};

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(originalDir, { recursive: true });

  const manifest: LogoManifestEntry[] = [];

  for (const imprint of data.imprints) {
    const entry = await fetchLogoForImprint(imprint).catch((error) => ({
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    manifest.push(entry);
    const mark = entry.status === "downloaded" ? "✓" : entry.status === "missing" ? "○" : "×";
    const sourceTitle = "sourceTitle" in entry ? entry.sourceTitle : undefined;
    console.log(`${mark} ${imprint.name}${sourceTitle ? ` <- ${sourceTitle}` : ""}`);
  }

  await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const summary = {
    downloaded: manifest.filter((item) => item.status === "downloaded").length,
    missing: manifest.filter((item) => item.status === "missing").length,
    failed: manifest.filter((item) => item.status === "failed").length,
  };
  console.log(`Imprint logo fetch complete: ${JSON.stringify(summary)}`);
}

async function fetchLogoForImprint(imprint: Imprint): Promise<LogoManifestEntry> {
  const aliasId = localLogoAliases[imprint.id];
  if (aliasId) {
    const aliasOutputName = `${aliasId}.png`;
    const outputName = `${imprint.id}.png`;
    const aliasOutputPath = path.join(outputDir, aliasOutputName);
    const outputPath = path.join(outputDir, outputName);
    if (await exists(aliasOutputPath)) {
      if (!(await exists(outputPath))) await fs.copyFile(aliasOutputPath, outputPath);
      return {
        imprintId: imprint.id,
        imprintName: imprint.name,
        status: "downloaded",
        logoPath: `/imprint-logos/${outputName}`,
        sourceTitle: `Same-brand logo from ${aliasId}`,
      };
    }
  }

  const directUrl = approvedDirectLogoUrls[imprint.id];
  if (directUrl) {
    const outputName = `${imprint.id}.png`;
    const outputPath = path.join(outputDir, outputName);
    const originalName = `${imprint.id}${path.extname(new URL(directUrl).pathname) || ".svg"}`;
    const originalPath = path.join(originalDir, originalName);
    if (!(await exists(outputPath))) {
      if (!(await exists(originalPath))) await downloadFile(directUrl, originalPath);
      await normalizeToTransparentPng(originalPath, outputPath);
    }
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "downloaded",
      logoPath: `/imprint-logos/${outputName}`,
      originalPath: `/imprint-logos/_originals/${originalName}`,
      sourceTitle: "Official W. W. Norton seagull logo",
      sourceUrl: directUrl,
    };
  }

  const title = approvedCommonsTitles[imprint.id];
  if (!title) {
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "missing",
    };
  }
  const outputName = `${imprint.id}.png`;
  const outputPath = path.join(outputDir, outputName);
  if (await exists(outputPath)) {
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "downloaded",
      logoPath: `/imprint-logos/${outputName}`,
      sourceTitle: title,
    };
  }

  const image = await getCommonsImageInfo(title);
  if (!image || !isSupportedMime(image.mime)) {
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "missing",
      sourceTitle: title,
    };
  }

  try {
    const downloadUrl = thumbnailUrlFor(image.url, image.mime);
    const originalExt = extensionForMime(image.mime, downloadUrl);
    const originalName = `${imprint.id}${originalExt}`;
    const originalPath = path.join(originalDir, originalName);
    if (!(await exists(outputPath))) {
      if (!(await exists(originalPath))) await downloadFile(downloadUrl, originalPath);
      await normalizeToTransparentPng(originalPath, outputPath);
    }
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "downloaded",
      logoPath: `/imprint-logos/${outputName}`,
      originalPath: `/imprint-logos/_originals/${originalName}`,
      sourceTitle: title,
      sourceUrl: image.descriptionurl,
      mime: image.mime,
    };
  } catch (error) {
    return {
      imprintId: imprint.id,
      imprintName: imprint.name,
      status: "failed",
      sourceTitle: title,
      sourceUrl: image.descriptionurl,
      mime: image.mime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getCommonsImageInfo(title: string) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|mime");
  url.searchParams.set("iiurlwidth", "512");
  url.searchParams.set("titles", title);
  url.searchParams.set("origin", "*");
  const response = await fetchWithRetry(url);
  const json = (await response.json()) as CommonsImageInfoResponse;
  const page = Object.values(json.query?.pages ?? {})[0];
  return page?.imageinfo?.[0];
}

async function downloadFile(url: string, outputPath: string) {
  await execFileAsync("curl", ["-L", "-A", "BookPrizeIndex/0.1 (imprint logo research)", "-o", outputPath, url]);
  const maybeRedirect = await readSignedAssetRedirect(outputPath);
  if (maybeRedirect) {
    await execFileAsync("curl", ["-L", "-A", "BookPrizeIndex/0.1 (imprint logo research)", "-o", outputPath, maybeRedirect]);
  }
  const stat = await fs.stat(outputPath);
  if (stat.size < 500) {
    await fs.unlink(outputPath).catch(() => undefined);
    throw new Error(`Logo download produced an unexpectedly small file (${stat.size} bytes)`);
  }
}

async function readSignedAssetRedirect(outputPath: string) {
  const raw = await fs.readFile(outputPath, "utf8").catch(() => "");
  if (!raw.trim().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(raw) as { message?: { url?: string } };
    return parsed.message?.url;
  } catch {
    return undefined;
  }
}

async function fetchWithRetry(url: URL) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await delay(requestDelayMs * attempt);
    const response = await fetch(url, { headers: { "user-agent": "BookPrizeIndex/0.1 (imprint logo research)" } });
    if (response.ok) return response;
    lastStatus = response.status;
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    await delay(1000 * attempt);
  }
  throw new Error(`Commons request failed: ${lastStatus}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(filePath: string) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function normalizeToTransparentPng(inputPath: string, outputPath: string) {
  await execFileAsync("magick", [
    inputPath,
    "-background",
    "none",
    "-resize",
    `${targetWidth - 32}x${targetHeight - 32}>`,
    "-gravity",
    "center",
    "-extent",
    `${targetWidth}x${targetHeight}`,
    "PNG32:" + outputPath,
  ]);
}

function isSupportedMime(mime: string) {
  return ["image/svg+xml", "image/png", "image/jpeg", "image/webp"].includes(mime);
}

function extensionForMime(mime: string, url: string) {
  const ext = path.extname(new URL(url).pathname);
  if (ext) return ext.toLowerCase();
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ext || ".img";
}

function thumbnailUrlFor(originalUrl: string, mime: string) {
  const url = new URL(originalUrl);
  const cleanPath = url.pathname;
  const filename = decodeURIComponent(path.basename(cleanPath));
  const encodedFilename = encodeURIComponent(filename).replace(/%20/g, "_");
  if (!cleanPath.includes("/wikipedia/commons/")) return originalUrl;

  const thumbPath = cleanPath.replace("/wikipedia/commons/", "/wikipedia/commons/thumb/");
  const suffix = mime === "image/svg+xml" ? ".png" : "";
  return `${url.origin}${thumbPath}/${sourceThumbWidth}px-${encodedFilename}${suffix}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
