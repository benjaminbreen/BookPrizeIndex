import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { TextPageSection, TextPageShell, TextPageTitle } from "@/components/text-page";

export const metadata = {
  title: "Data & API / The Book Prize Index",
  description: "Download and query the public Book Prize Index dataset.",
};

const navItems = [
  { href: "#download", label: "Download" },
  { href: "#api", label: "API" },
  { href: "#fields", label: "Fields" },
  { href: "#citation", label: "Citation" },
];

const fields = [
  ["appearance_id", "Stable identifier for an award appearance."],
  ["book_id", "Stable book identifier used by the site and API."],
  ["title / authors", "The recognized book and credited authors."],
  ["award_program", "The prize program that administers the category."],
  ["award_category", "The specific prize or category."],
  ["award_year", "Year associated with the award decision."],
  ["status", "Normalized result: winner, finalist, shortlist, longlist, or another documented status."],
  ["original_status", "Status wording retained from the imported record."],
  ["source_url", "The most specific available source for the appearance."],
  ["source_confidence", "Editorial source class such as official or secondary."],
];

export default async function DataPage() {
  const manifest = await readManifest();
  const csv = manifest.files.find((file) => file.mediaType === "text/csv");
  const json = manifest.files.find((file) => file.mediaType === "application/json");

  return (
    <TextPageShell label="Data & API" navItems={navItems}>
      <TextPageTitle>Data & API</TextPageTitle>
      <p className="mt-5 font-[var(--font-serif)] text-xl font-light leading-8 muted">
        Download the source-backed public dataset or query its current release through a small read-only API.
      </p>
      <p className="mt-5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">
        Release {manifest.datasetVersion} · {manifest.counts.books.toLocaleString()} books · {manifest.counts.appearances.toLocaleString()} appearances
      </p>

      <TextPageSection id="download" title="Download">
        <p>
          The CSV contains one row per award appearance and is the simplest format for research. The JSON preserves the
          normalized books, prizes, editions, appearances, publishers, imprints, subjects, and sources used by the API.
        </p>
        <div className="grid gap-3 text-base sm:grid-cols-2">
          <DownloadLink href="/data/latest/book-prize-index.csv" label="Download CSV" detail={csv ? formatBytes(csv.bytes) : "CSV"} />
          <DownloadLink href="/data/latest/book-prize-index.json" label="Download JSON" detail={json ? formatBytes(json.bytes) : "JSON"} />
        </div>
        <p className="text-sm leading-7">
          Machine-readable release details and checksums are in the <a className="text-page-link" href="/data/latest/manifest.json">manifest</a>.
        </p>
      </TextPageSection>

      <TextPageSection id="api" title="API">
        <p>No key is required. Results are limited to 100 records per request; bulk use should prefer the downloads.</p>
        <div className="overflow-x-auto border hairline bg-[var(--panel)] p-4 font-[var(--font-mono)] text-sm leading-7 text-[var(--ink)]">
          <pre>{`GET /api/v1/books?query=empire&subject=History&limit=25
GET /api/v1/books/{id}
GET /api/v1/appearances?awardId={id}&status=winner&yearFrom=2000
GET /api/v1/awards?scope=general`}</pre>
        </div>
        <p className="text-sm leading-7">
          Example: <a className="text-page-link" href="/api/v1/appearances?status=winner&limit=5">five winner records as JSON</a>.
        </p>
      </TextPageSection>

      <TextPageSection id="fields" title="Core CSV fields">
        <dl className="divide-y hairline border-y hairline text-base">
          {fields.map(([name, description]) => (
            <div className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-5" key={name}>
              <dt className="font-[var(--font-mono)] text-sm text-[var(--ink)]">{name}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <p>
          Status normalization, source selection, book deduplication, and known limitations are described in the{" "}
          <Link className="text-page-link" href="/methodology">methodology note</Link>.
        </p>
      </TextPageSection>

      <TextPageSection id="citation" title="Citation & license">
        <p>
          Benjamin Breen, <em>The Book Prize Index</em>, release {manifest.datasetVersion}, {" "}
          <span className="whitespace-nowrap">https://github.com/benjaminbreen/BookPrizeIndex</span>.
        </p>
        <p>
          The downloadable core dataset is licensed under{" "}
          <a className="text-page-link" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer" target="_blank">CC BY 4.0</a>.
          Cover images, logos, summaries, and third-party material are not included in the release. Please verify important
          claims against the linked sources and report corrections to breen85 [at] gmail [dot] com.
        </p>
      </TextPageSection>
    </TextPageShell>
  );
}

function DownloadLink({ detail, href, label }: { detail: string; href: string; label: string }) {
  return (
    <a className="focus-ring flex items-center justify-between border hairline px-4 py-3 text-[var(--ink)] transition hover:bg-[var(--panel)]" href={href}>
      <span>{label}</span>
      <span className="font-[var(--font-mono)] text-xs uppercase tracking-[0.12em] muted">{detail}</span>
    </a>
  );
}

type Manifest = {
  datasetVersion: string;
  counts: { books: number; appearances: number };
  files: Array<{ name: string; mediaType: string; bytes: number; sha256: string }>;
};

async function readManifest() {
  const filename = path.join(process.cwd(), "public", "data", "latest", "manifest.json");
  return JSON.parse(await fs.readFile(filename, "utf8")) as Manifest;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
