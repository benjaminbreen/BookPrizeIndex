import Link from "next/link";
import { booksById } from "@/lib/data";
import { topicSummaries } from "@/lib/topics";

export const metadata = {
  title: "Topics / The Book Prize Index",
  description: "Explore granular topics represented across prize-recognized nonfiction books.",
  alternates: { canonical: "/topics" },
};

export default function TopicsPage() {
  const topics = topicSummaries();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em] muted">Topics</p>
      <h1 className="mt-4 text-4xl font-semibold leading-tight">Browse topics.</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 muted">
        Topic pages collect books across subjects when they share a more specific historical, cultural, or biographical focus.
      </p>

      <div className="mt-8 grid gap-px overflow-hidden border hairline bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic, index) => {
          const topBook = topic.topBookId ? booksById.get(topic.topBookId) : undefined;
          return (
            <Link
              className={`subject-chip topic-index-card topic-mix-color-${index % 8} focus-ring bg-[var(--paper)] p-5`}
              href={`/topics/${topic.slug}`}
              key={topic.slug}
            >
              <span className="block text-xl font-medium">{topic.name}</span>
              <span className="mt-3 block font-[var(--font-mono)] text-xs muted">{topic.bookCount.toLocaleString()} books</span>
              {topBook ? <span className="mt-5 block text-sm muted">Top record: {topBook.title}</span> : null}
            </Link>
          );
        })}
      </div>
    </main>
  );
}
