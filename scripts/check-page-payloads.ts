type PayloadTarget = {
  path: string;
  label: string;
  maxBytes: number;
};

const DEFAULT_BASE_URL = "http://localhost:3000";

const targets: PayloadTarget[] = [
  { path: "/", label: "Home", maxBytes: 750_000 },
  { path: "/publishers/penguin-random-house", label: "Top publisher", maxBytes: 750_000 },
  { path: "/publishers/abc-clio", label: "Long-tail publisher", maxBytes: 250_000 },
  { path: "/imprints/oxford-university-press", label: "Top imprint", maxBytes: 500_000 },
  { path: "/imprints/37-ink", label: "Long-tail imprint", maxBytes: 250_000 },
  { path: "/topics", label: "Topics", maxBytes: 250_000 },
];

async function main() {
  const baseUrl = getBaseUrl();
  const rows = [];
  let failed = false;

  for (const target of targets) {
    const url = new URL(target.path, baseUrl);
    const response = await fetch(url);
    const body = Buffer.from(await response.arrayBuffer());
    const passed = response.ok && body.byteLength <= target.maxBytes;
    if (!passed) failed = true;
    rows.push({
      ...target,
      bytes: body.byteLength,
      status: response.status,
      passed,
    });
  }

  const labelWidth = Math.max(...rows.map((row) => row.label.length), "Page".length);
  console.log(`${pad("Page", labelWidth)}  Status  Payload   Budget    Result`);
  for (const row of rows) {
    console.log(
      `${pad(row.label, labelWidth)}  ${row.status}     ${formatBytes(row.bytes)}  ${formatBytes(row.maxBytes)}  ${row.passed ? "ok" : "over budget"}`,
    );
  }

  if (failed) process.exit(1);
}

function getBaseUrl() {
  const argvBaseUrl = process.argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length);
  const rawBaseUrl = argvBaseUrl || process.env.PAYLOAD_BASE_URL || DEFAULT_BASE_URL;
  return rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

function pad(value: string, width: number) {
  return value.padEnd(width, " ");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
