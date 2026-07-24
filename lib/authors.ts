import generatedPeople from "@/sources/enrichment/people.generated.json";
import type { AuthorDiscoveryProfile } from "@/lib/author-discovery";
import { data } from "@/lib/data";
import type { Book, Person } from "@/lib/types";

type GeneratedPeople = {
  profiles: Record<string, AuthorDiscoveryProfile>;
};

const generatedProfiles = (generatedPeople as GeneratedPeople).profiles;

export const authorsById = new Map<string, Person>();
export const booksByAuthorId = new Map<string, Book[]>();

for (const book of data.books) {
  for (const author of book.authors) {
    authorsById.set(author.id, author);
    const books = booksByAuthorId.get(author.id) ?? [];
    books.push(book);
    booksByAuthorId.set(author.id, books);
  }
}

export const authors = [...authorsById.values()].sort((a, b) => a.name.localeCompare(b.name));
export const authorsBySlug = new Map(authors.map((author) => [authorSlug(author), author]));
export const authorProfilesById = new Map(Object.entries(generatedProfiles));

export function authorSlug(author: Pick<Person, "id">) {
  return author.id.replace(/^person-/, "");
}

export function authorHref(author: Pick<Person, "id">) {
  return `/authors/${authorSlug(author)}`;
}

export function authorProfileFor(author: Pick<Person, "id">) {
  return authorProfilesById.get(author.id);
}
