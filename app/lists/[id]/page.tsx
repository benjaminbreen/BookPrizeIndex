import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SemanticListView } from "@/components/semantic-list-view";
import { readSharedSemanticList } from "@/lib/semantic-list-storage";
import { compactDescription } from "@/lib/site";
import { DEFAULT_SOCIAL_IMAGE } from "@/lib/site-metadata";

export const revalidate = 31_536_000;
export const dynamicParams = true;
export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

const loadList = cache(unstable_cache(
  readSharedSemanticList,
  ["shared-semantic-list-v1"],
  { revalidate: 31_536_000 },
));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await loadList(id);
  if (!snapshot) return { title: "Shared List Not Found / The Book Prize Index", robots: { index: false, follow: false } };
  const title = `${snapshot.title} / The Book Prize Index`;
  const description = compactDescription(
    `A frozen list of ${snapshot.results.length} prize-recognized nonfiction books from the Meaning search “${snapshot.query}”.`,
  );
  const canonical = `/lists/${snapshot.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: false, nocache: false },
    openGraph: {
      type: "article",
      title,
      description,
      url: canonical,
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}

export default async function SharedSemanticListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await loadList(id);
  if (!snapshot) notFound();
  return <SemanticListView snapshot={snapshot} />;
}
