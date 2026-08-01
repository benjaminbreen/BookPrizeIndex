import type { Book } from "@/lib/types";

/**
 * Whether an anglophone reader can actually read this book.
 *
 * The catalog was anglophone-only before international prizes were added, so an
 * absent `originalLanguage` means English rather than "unknown". Everything else
 * needs a confirmed English edition.
 */
export function isReadableInEnglish(
  book: Pick<Book, "originalLanguage" | "hasEnglishEdition">,
): boolean {
  if (!book.originalLanguage || book.originalLanguage === "en") return true;
  return book.hasEnglishEdition === true;
}

/** Language filter applied to retrieval. "english" is the default. */
export type LanguageFilter = "english" | "all" | { originalLanguage: string };

export function normalizeLanguageFilter(value: string | undefined | null): LanguageFilter {
  if (!value || value === "english") return "english";
  if (value === "all") return "all";
  if (/^[a-z]{2}$/.test(value)) return { originalLanguage: value };
  return "english";
}

export function matchesLanguageFilter(
  book: Pick<Book, "originalLanguage" | "hasEnglishEdition">,
  filter: LanguageFilter,
): boolean {
  if (filter === "english") return isReadableInEnglish(book);
  if (filter === "all") return true;
  return (book.originalLanguage ?? "en") === filter.originalLanguage;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", nl: "Dutch", sv: "Swedish", no: "Norwegian", pl: "Polish",
  fr: "French", es: "Spanish", it: "Italian", ru: "Russian", pt: "Portuguese",
  uk: "Ukrainian", da: "Danish", cs: "Czech", en: "English",
};

/**
 * Title to show a reader. Translated works are catalogued under their original
 * title, but a reader browsing in English is looking for the edition they can
 * actually buy — "Bees and Their Keepers", not "Bin och människor".
 */
export function bookDisplayTitle(
  book: { title: string; englishTitle?: string; originalLanguage?: string },
  filter: LanguageFilter = "english",
): string {
  if (filter !== "english") return book.title;
  return book.englishTitle?.trim() || book.title;
}

/** Original title, when it differs from what is being displayed. */
export function bookOriginalTitleAside(
  book: { title: string; englishTitle?: string; originalLanguage?: string },
  filter: LanguageFilter = "english",
): string | undefined {
  const shown = bookDisplayTitle(book, filter);
  return shown === book.title ? undefined : book.title;
}
