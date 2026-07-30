import { TopicsBrowser } from "@/components/topics-browser";
import { booksById } from "@/lib/data";
import { topicSummaries } from "@/lib/topics";

export const metadata = {
  title: "Topics / The Book Prize Index",
  description: "Explore granular topics represented across prize-recognized nonfiction books.",
  alternates: { canonical: "/topics" },
};

export default function TopicsPage() {
  const topics = topicSummaries().map((topic) => {
    const topBook = topic.topBookId ? booksById.get(topic.topBookId) : undefined;
    return {
      name: topic.name,
      slug: topic.slug,
      description: topic.description,
      bookCount: topic.bookCount,
      topBook: topBook ? {
        title: topBook.title,
      } : undefined,
    };
  });
  return <TopicsBrowser topics={topics} />;
}
