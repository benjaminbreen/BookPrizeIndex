export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function clean(input: unknown) {
  return String(input ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeTitleForMatch(input: string) {
  return clean(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeAuthorKey(authors: string[]) {
  return authors.map((author) => slugify(author)).filter(Boolean).join("|");
}
