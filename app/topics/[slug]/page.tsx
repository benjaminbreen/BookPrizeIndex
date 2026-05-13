import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCatalog } from "@/components/book-catalog";
import { browseBooksByTopic, browseData } from "@/lib/browse-data";
import { topicNameForSlug, topicSummaries } from "@/lib/topics";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return topicSummaries().map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const topic = topicNameForSlug(slug);
  return { title: topic ? `${topic} / The Book Prize Index` : "Topic / The Book Prize Index" };
}

export default async function TopicPage({ params }: PageProps) {
  const { slug } = await params;
  const topic = topicNameForSlug(slug);
  if (!topic) notFound();

  const books = browseBooksByTopic.get(topic) ?? [];

  return (
    <Suspense>
      <BookCatalog
        awardOptions={browseData.awards}
        books={books}
        title={topic}
        deck={`Award-recognized books tagged under ${topic.toLowerCase()}, with sortable prize results, subjects, authors, and imprints.`}
      />
    </Suspense>
  );
}
