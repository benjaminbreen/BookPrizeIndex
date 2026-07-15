import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Award, AwardAppearance, Book, PublicData } from "../lib/types";

type Args = {
  limit?: number;
  budgetUsd: number;
  force: boolean;
  dryRun: boolean;
  model: string;
  concurrency: number;
  bookQuery?: string;
};

type SubjectDefinitionEntry = {
  id: string;
  name: string;
  description: string;
  fallback?: boolean;
};

type SubjectPatch = {
  primarySubject: string;
  secondarySubjects: string[];
  confidence: "high" | "medium" | "low";
  method: "llm";
  model: string;
  rationale: string;
  reviewStatus: "generated" | "reviewed" | "rejected";
  inputHash: string;
};

type GeneratedSubjectsFile = {
  generatedAt: string | null;
  notes: string;
  books: Record<string, SubjectPatch>;
};

type BookReport = {
  bookId: string;
  title: string;
  author: string;
  status: "classified" | "cached" | "failed" | "skipped_budget";
  primarySubject?: string;
  secondarySubjects?: string[];
  confidence?: "high" | "medium" | "low";
  rationale?: string;
  error?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "data", "public", "catalog.json");
const subjectsPath = path.join(root, "sources", "subjects.json");
const generatedPath = path.join(root, "sources", "enrichment", "subjects.generated.json");
const reportPath = path.join(root, "data", "reports", "subject-llm-classification-report.json");

const INPUT_PRICE_PER_MILLION = 0.15;
const OUTPUT_PRICE_PER_MILLION = 0.6;
const ESTIMATED_OUTPUT_TOKENS = 160;
const BUDGET_HARD_CEILING_USD = 5;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const parsed: Args = {
    limit: value("limit") ? Number(value("limit")) : undefined,
    budgetUsd: value("budget-usd") ? Number(value("budget-usd")) : 4,
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
    model: value("model") ?? "gpt-4o-mini",
    concurrency: value("concurrency") ? Number(value("concurrency")) : 6,
    bookQuery: value("book-query")?.toLowerCase(),
  };
  if (parsed.budgetUsd > BUDGET_HARD_CEILING_USD && !args.includes("--confirm-over-ceiling")) {
    throw new Error(
      `Budget $${parsed.budgetUsd} exceeds the $${BUDGET_HARD_CEILING_USD} ceiling. Confirm the spend with the project owner first, then pass --confirm-over-ceiling.`,
    );
  }
  return parsed;
}

async function main() {
  await loadEnvLocal();
  const args = parseArgs();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for subject classification. Set it in .env.local before running subjects:classify.");
  }
  const data = JSON.parse(await fs.readFile(catalogPath, "utf8")) as PublicData;
  const subjectDefinitions = (JSON.parse(await fs.readFile(subjectsPath, "utf8")) as SubjectDefinitionEntry[]).filter(
    (subject) => subject.name !== "General Nonfiction",
  );
  const allowedSubjects = new Set(subjectDefinitions.map((subject) => subject.name));
  const generated = await readGeneratedSubjects();
  const awardText = awardsByBook(data.appearances, data.awards);

  const books = data.books
    .filter((book) => !args.bookQuery || [book.title, book.subtitle, ...book.authors.map((author) => author.name)].filter(Boolean).join(" ").toLowerCase().includes(args.bookQuery))
    .sort((a, b) => a.id.localeCompare(b.id));
  const inputs = books
    .map((book) => {
      const text = classificationText(book, awardText.get(book.id) ?? "");
      return { book, text, inputHash: hash(text) };
    })
    .filter(({ book, inputHash }) => args.force || generated.books[book.id]?.inputHash !== inputHash)
    .slice(0, args.limit ?? books.length);

  const promptOverheadTokens = estimateTokens(systemPrompt() + subjectListJson(subjectDefinitions));
  const estimatedFullCost = inputs.reduce(
    (sum, item) => sum + costCall(promptOverheadTokens + estimateTokens(item.text), ESTIMATED_OUTPUT_TOKENS),
    0,
  );
  console.log(
    `Classifying ${inputs.length} books (cached: ${books.length - inputs.length}) with ${args.model}; estimated cost $${estimatedFullCost.toFixed(2)}, budget $${args.budgetUsd}.`,
  );
  if (args.dryRun) return;

  const reportRows: BookReport[] = [];
  let estimatedSpendUsd = 0;
  let completed = 0;
  let failed = 0;
  let stoppedForBudget = false;
  let cursor = 0;
  let dirty = 0;

  const persist = async () => {
    generated.generatedAt = new Date().toISOString();
    generated.notes =
      "Generated subject patches from scripts/classify-subjects.ts. Manual subject corrections belong in sources/curation.json and override this file.";
    generated.books = sortObject(generated.books);
    await fs.writeFile(generatedPath, `${JSON.stringify(generated, null, 2)}\n`);
  };

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      const { book, text, inputHash } = inputs[index];
      const callCost = costCall(promptOverheadTokens + estimateTokens(text), ESTIMATED_OUTPUT_TOKENS);
      if (estimatedSpendUsd + callCost > args.budgetUsd) {
        stoppedForBudget = true;
        reportRows.push(reportRow(book, { status: "skipped_budget" }));
        continue;
      }
      estimatedSpendUsd += callCost;
      try {
        const result = await classifyWithLlm({ book, text, subjectDefinitions, allowedSubjects, args });
        generated.books[book.id] = { ...result, method: "llm", model: args.model, reviewStatus: "generated", inputHash };
        reportRows.push(reportRow(book, { status: "classified", ...result }));
        completed += 1;
        dirty += 1;
      } catch (error) {
        failed += 1;
        reportRows.push(reportRow(book, { status: "failed", error: error instanceof Error ? error.message.slice(0, 240) : String(error) }));
      }
      if ((completed + failed) % 25 === 0) {
        console.log(`  [${completed + failed}/${inputs.length}] failed=${failed} spend=$${estimatedSpendUsd.toFixed(2)}`);
      }
      if (dirty >= 200) {
        dirty = 0;
        await persist();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, () => worker()));
  await persist();

  const report = {
    generatedAt: new Date().toISOString(),
    model: args.model,
    budgetUsd: args.budgetUsd,
    estimatedSpendUsd: Number(estimatedSpendUsd.toFixed(4)),
    stoppedForBudget,
    totals: {
      considered: inputs.length,
      classified: completed,
      failed,
      skippedForBudget: reportRows.filter((row) => row.status === "skipped_budget").length,
      alreadyCached: books.length - inputs.length,
    },
    books: reportRows.sort((a, b) => a.title.localeCompare(b.title)),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Subject classification wrote ${completed} patches (${failed} failed${stoppedForBudget ? ", stopped at budget" : ""}); estimated spend $${estimatedSpendUsd.toFixed(2)}.`,
  );
}

function reportRow(book: Book, fields: Partial<BookReport> & { status: BookReport["status"] }): BookReport {
  return {
    bookId: book.id,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    ...fields,
  };
}

function systemPrompt() {
  return [
    "You classify nonfiction books into a fixed subject taxonomy for a book prize index.",
    "Choose exactly one primarySubject from the provided subject list, plus up to two secondarySubjects when the book genuinely spans subjects. Never invent subjects.",
    "Classify by the book's dominant frame, not incidental content.",
    "Disambiguation rules:",
    "- Memoir & Autobiography: the author writes about their own life or experience. Biography: a life story of someone other than the author. A surgeon's or soldier's first-person account is Memoir & Autobiography, not Biography.",
    "- Biography requires the book to be centrally a life story; a history told through people is History (or another subject), not Biography.",
    "- American History: the past centered on the United States. World History: the past centered outside the U.S. or transnational. History: only when neither regional frame fits (e.g. historiography, the history of a practice or object across many regions).",
    "- Prefer a substantive subject (Science, War & Military, Race & Ethnicity, ...) over History when the book is primarily about that domain.",
    "Confidence: high when the choice is clear; medium when two subjects are plausible; low when the evidence is thin or contradictory.",
    "Return compact JSON with primarySubject, secondarySubjects, confidence, and a one-sentence rationale.",
  ].join("\n");
}

function subjectListJson(subjectDefinitions: SubjectDefinitionEntry[]) {
  return JSON.stringify(subjectDefinitions.map((subject) => ({ name: subject.name, definition: subject.description })));
}

async function classifyWithLlm({
  book,
  text,
  subjectDefinitions,
  allowedSubjects,
  args,
  correction,
}: {
  book: Book;
  text: string;
  subjectDefinitions: SubjectDefinitionEntry[];
  allowedSubjects: Set<string>;
  args: Args;
  correction?: string;
}) {
  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        { role: "system", content: systemPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            book: text,
            subjects: subjectDefinitions.map((subject) => ({ name: subject.name, definition: subject.description })),
            ...(correction ? { correction } : {}),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "subject_selection",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              primarySubject: { type: "string" },
              secondarySubjects: { type: "array", items: { type: "string" }, maxItems: 2 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string" },
            },
            required: ["primarySubject", "secondarySubjects", "confidence", "rationale"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`LLM subject selection failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const textOut = json.output_text ?? json.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
  const parsed = JSON.parse(textOut) as {
    primarySubject: string;
    secondarySubjects: string[];
    confidence: "high" | "medium" | "low";
    rationale: string;
  };
  if (!allowedSubjects.has(parsed.primarySubject)) {
    if (correction) throw new Error(`LLM returned unknown primary subject "${parsed.primarySubject}" for ${book.id}.`);
    return classifyWithLlm({
      book,
      text,
      subjectDefinitions,
      allowedSubjects,
      args,
      correction: `"${parsed.primarySubject}" is not in the subject taxonomy. You must pick the closest primarySubject from the provided subjects list, even if the fit is imperfect.`,
    });
  }
  const secondarySubjects = [...new Set(parsed.secondarySubjects)]
    .filter((subject) => allowedSubjects.has(subject) && subject !== parsed.primarySubject)
    .slice(0, 2);
  return {
    primarySubject: parsed.primarySubject,
    secondarySubjects,
    confidence: parsed.confidence,
    rationale: parsed.rationale.slice(0, 400),
  };
}

function classificationText(book: Book, awards: string) {
  // Deliberately excludes primarySubject/subjects so the classifier cannot echo the old keyword-derived labels.
  return [
    `Title: ${book.title}`,
    book.subtitle ? `Subtitle: ${book.subtitle}` : "",
    `Authors: ${book.authors.map((author) => author.name).join(", ")}`,
    book.publicationYear ? `Publication year: ${book.publicationYear}` : "",
    book.subjectCategories?.length ? `Catalog subject labels: ${book.subjectCategories.map((category) => category.label).join("; ")}` : "",
    book.centralFigures.length ? `Central figures: ${book.centralFigures.join(", ")}` : "",
    awards ? `Award categories: ${awards}` : "",
    book.summary ? `Description: ${book.summary.slice(0, 1800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function awardsByBook(appearances: AwardAppearance[], awards: Award[]) {
  const awardsById = new Map(awards.map((award) => [award.id, award]));
  const map = new Map<string, Set<string>>();
  for (const appearance of appearances) {
    const award = awardsById.get(appearance.awardId);
    if (!award) continue;
    const values = map.get(appearance.bookId) ?? new Set<string>();
    values.add([award.name, award.subjectAreas.join(", ")].filter(Boolean).join(" / "));
    map.set(appearance.bookId, values);
  }
  return new Map([...map.entries()].map(([bookId, values]) => [bookId, [...values].join("; ")]));
}

async function loadEnvLocal() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(root, filename), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Optional local env file.
    }
  }
}

async function readGeneratedSubjects(): Promise<GeneratedSubjectsFile> {
  try {
    return JSON.parse(await fs.readFile(generatedPath, "utf8")) as GeneratedSubjectsFile;
  } catch {
    return { generatedAt: null, notes: "", books: {} };
  }
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4) {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  const timeoutMs = Number(process.env.CLASSIFY_FETCH_TIMEOUT_MS ?? 60000);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status < 500 || attempt === attempts) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

function hash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function estimateTokens(input: string) {
  return Math.ceil(input.length / 4);
}

function costCall(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION + (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
}

function sortObject<T>(value: Record<string, T>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
