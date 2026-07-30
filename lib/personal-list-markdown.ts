import type { PersonalListSnapshot } from "@/lib/personal-list";

export function personalListMarkdown(snapshot: PersonalListSnapshot, siteUrl?: string) {
  const lines = [`# ${snapshot.title}`];
  if (snapshot.creatorName) lines.push("", `By ${snapshot.creatorName}`);
  if (snapshot.introduction) lines.push("", snapshot.introduction);
  lines.push("");
  snapshot.results.forEach((book, index) => {
    const details = [book.author, book.publicationYear ? String(book.publicationYear) : undefined]
      .filter(Boolean)
      .join(", ");
    const relativeUrl = `/books/${book.slug}`;
    const bookUrl = siteUrl ? new URL(relativeUrl, siteUrl).toString() : relativeUrl;
    lines.push(`${index + 1}. [${escapeMarkdown(book.title)}](${bookUrl})${details ? ` — ${details}` : ""}`);
  });
  lines.push("", "_Created with The Book Prize Index._", "");
  return lines.join("\n");
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}
