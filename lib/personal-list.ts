import { createHash } from "node:crypto";
import type { BrowseBookRow } from "@/lib/browse-types";

export const PERSONAL_LIST_VERSION = 1;
export const MAX_PERSONAL_LIST_RESULTS = 100;

export type PersonalListDraft = {
  creatorName: string;
  introduction?: string;
  results: Array<{ bookId: string }>;
  title: string;
};

export type PersonalListBook = {
  author: string;
  bookId: string;
  primarySubject?: string;
  publicationYear?: number;
  slug: string;
  thumbnailUrl?: string;
  title: string;
};

export type PersonalListSnapshot = {
  createdAt: string;
  creatorName?: string;
  id: string;
  introduction?: string;
  kind: "personal";
  results: PersonalListBook[];
  title: string;
  version: typeof PERSONAL_LIST_VERSION;
};

export type PersonalListDraftValidation =
  | { ok: true; draft: PersonalListDraft }
  | { ok: false; error: string };

export function validatePersonalListDraft(input: unknown): PersonalListDraftValidation {
  if (!isRecord(input)) return invalid("Invalid reading list.");
  const creatorName = cleanString(input.creatorName, 80);
  if (!creatorName) return invalid("Add the name you want shown with this list.");
  const title = cleanString(input.title, 120);
  if (!title) return invalid("Give the list a title.");
  const introduction = cleanIntroduction(input.introduction, 1_200);
  if (!Array.isArray(input.results)) return invalid("Select at least one book.");

  const seen = new Set<string>();
  const results: PersonalListDraft["results"] = [];
  for (const value of input.results.slice(0, MAX_PERSONAL_LIST_RESULTS)) {
    if (!isRecord(value)) continue;
    const bookId = cleanString(value.bookId, 240);
    if (!bookId || seen.has(bookId)) continue;
    seen.add(bookId);
    results.push({ bookId });
  }
  if (!results.length) return invalid("Select at least one book.");

  return {
    ok: true,
    draft: {
      creatorName,
      introduction: introduction || undefined,
      results,
      title,
    },
  };
}

export function createPersonalListSnapshot(
  draft: PersonalListDraft,
  booksById: ReadonlyMap<string, BrowseBookRow>,
  createdAt = new Date().toISOString(),
): PersonalListSnapshot {
  const results = draft.results.flatMap(({ bookId }) => {
    const book = booksById.get(bookId);
    if (!book) return [];
    return [{
      author: book.author,
      bookId,
      primarySubject: book.primarySubject,
      publicationYear: book.publicationYear,
      slug: book.slug,
      thumbnailUrl: book.thumbnailUrl,
      title: book.title,
    }];
  });
  if (!results.length) throw new Error("None of the selected books remain in the public catalog.");

  const content = {
    creatorName: draft.creatorName,
    introduction: draft.introduction,
    kind: "personal" as const,
    results,
    title: draft.title,
    version: PERSONAL_LIST_VERSION,
  } as const;
  return {
    ...content,
    createdAt,
    id: personalListId(content),
  };
}

export function isPersonalListSnapshot(input: unknown): input is PersonalListSnapshot {
  if (!isRecord(input)) return false;
  if (input.kind !== "personal" || input.version !== PERSONAL_LIST_VERSION) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(String(input.id ?? ""))) return false;
  if (!cleanString(input.title, 120)) return false;
  if (input.creatorName !== undefined && cleanString(input.creatorName, 80) !== input.creatorName) return false;
  if (input.introduction !== undefined && cleanIntroduction(input.introduction, 1_200) !== input.introduction) return false;
  if (!Number.isFinite(Date.parse(String(input.createdAt ?? "")))) return false;
  if (!Array.isArray(input.results) || input.results.length < 1 || input.results.length > MAX_PERSONAL_LIST_RESULTS) return false;
  return input.results.every((result) =>
    isRecord(result)
    && Boolean(cleanString(result.bookId, 240))
    && Boolean(cleanString(result.slug, 240))
    && Boolean(cleanString(result.title, 500))
    && Boolean(cleanString(result.author, 500)),
  );
}

function personalListId(content: Omit<PersonalListSnapshot, "createdAt" | "id">) {
  return createHash("sha256").update(stableStringify(content)).digest("base64url").slice(0, 22);
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function cleanIntroduction(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(error: string): PersonalListDraftValidation {
  return { ok: false, error };
}
