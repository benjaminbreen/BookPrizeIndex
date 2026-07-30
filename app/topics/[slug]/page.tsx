import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCatalog } from "@/components/book-catalog";
import { browseBooksByTopic, browseData } from "@/lib/browse-data";
import { topicSummaries, topicSummaryForSlug } from "@/lib/topics";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return topicSummaries().map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const topic = topicSummaryForSlug(slug);
  if (!topic) return { title: "Topic / The Book Prize Index", robots: { index: false, follow: false } };
  return {
    title: `${topic.name} / The Book Prize Index`,
    description: topic.description,
    alternates: { canonical: `/topics/${slug}` },
  };
}

export default async function TopicPage({ params }: PageProps) {
  const { slug } = await params;
  const topic = topicSummaryForSlug(slug);
  if (!topic) notFound();

  const books = browseBooksByTopic.get(topic.name) ?? [];

  return (
    <Suspense>
      <BookCatalog
        awardOptions={browseData.awards}
        books={books}
        title={topic.name}
        deck={topic.description}
      />
    </Suspense>
  );
}
