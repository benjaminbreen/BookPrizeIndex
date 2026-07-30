import { booksByTopic, data, statsByBookId } from "@/lib/data";
import topicDefinitionsJson from "@/sources/topics.json";
import type { Book, TopicDefinition } from "@/lib/types";

const topicDefinitions = topicDefinitionsJson as TopicDefinition[];
const topicDefinitionsByName = new Map(topicDefinitions.map((topic) => [topic.name, topic]));

export type TopicSummary = {
  name: string;
  slug: string;
  description: string;
  bookCount: number;
  topBookId?: string;
  sortOrder: number;
};

let defaultTopicSummaries: TopicSummary[] | undefined;

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
  if (books === data.books) return booksByTopic.get(topic) ?? [];
  return books.filter((book) => book.topics.includes(topic));
}

export function topicSummaries(books: Book[] = data.books): TopicSummary[] {
  if (books === data.books && defaultTopicSummaries) return defaultTopicSummaries;
  const counts = new Map<string, { bookIds: Set<string>; topBookId?: string; topScore: number }>();
  for (const book of books) {
    for (const topic of book.topics) {
      const current = counts.get(topic) ?? { bookIds: new Set<string>(), topScore: -1 };
      current.bookIds.add(book.id);
      const score = statsByBookId.get(book.id)?.score ?? 0;
      if (score > current.topScore) {
        current.topScore = score;
        current.topBookId = book.id;
      }
      counts.set(topic, current);
    }
  }
  const summaries = [...counts.entries()]
    .map(([name, value]) => {
      const definition = topicDefinitionsByName.get(name);
      return {
        name,
        slug: topicSlug(name),
        description: definition?.description ?? `Books connected by the theme of ${name.toLowerCase()}.`,
        bookCount: value.bookIds.size,
        topBookId: value.topBookId,
        sortOrder: definition?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => b.bookCount - a.bookCount || a.name.localeCompare(b.name));
  if (books === data.books) {
    defaultTopicSummaries = summaries;
  }
  return summaries;
}

export function topicSummaryForSlug(slug: string) {
  return topicSummaries().find((topic) => topic.slug === slug);
}
