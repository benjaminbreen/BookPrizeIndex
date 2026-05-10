import { data } from "@/lib/data";
import type { Book } from "@/lib/types";

export type TopicSummary = {
  name: string;
  slug: string;
  bookCount: number;
  topBookId?: string;
};

export function topicSlug(topic: string) {
  return topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function booksForTopic(topic: string, books: Book[] = data.books) {
  return books.filter((book) => book.topics.includes(topic));
}

export function topicSummaries(books: Book[] = data.books): TopicSummary[] {
  const counts = new Map<string, { bookIds: Set<string>; topBookId?: string; topScore: number }>();
  for (const book of books) {
    for (const topic of book.topics) {
      const current = counts.get(topic) ?? { bookIds: new Set<string>(), topScore: -1 };
      current.bookIds.add(book.id);
      const score = data.stats.find((stat) => stat.bookId === book.id)?.score ?? 0;
      if (score > current.topScore) {
        current.topScore = score;
        current.topBookId = book.id;
      }
      counts.set(topic, current);
    }
  }
  return [...counts.entries()]
    .map(([name, value]) => ({
      name,
      slug: topicSlug(name),
      bookCount: value.bookIds.size,
      topBookId: value.topBookId,
    }))
    .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name));
}

export function topicNameForSlug(slug: string) {
  return topicSummaries().find((topic) => topic.slug === slug)?.name;
}
