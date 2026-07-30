import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PersonalListView } from "@/components/personal-list-view";
import { readSharedPersonalList } from "@/lib/personal-list-storage";
import { compactDescription } from "@/lib/site";

export const revalidate = 31_536_000;
export const dynamicParams = true;
export const dynamic = "force-static";

export function generateStaticParams() {
  return [];
}

const loadList = cache(unstable_cache(
  readSharedPersonalList,
  ["shared-personal-list-v1"],
  { revalidate: 31_536_000 },
));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const snapshot = await loadList(id);
  if (!snapshot) return { title: "Reading List Not Found / The Book Prize Index", robots: { index: false, follow: false } };
  const title = `${snapshot.title} / The Book Prize Index`;
  const description = compactDescription(
    snapshot.introduction || `${snapshot.creatorName ? `${snapshot.creatorName}’s` : "A"} curated reading list of ${snapshot.results.length} prize-recognized nonfiction books.`,
  );
  const canonical = `/reading-lists/${snapshot.id}`;
  const image = `${canonical}/opengraph-image`;
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
      images: [{ url: image, width: 1200, height: 630, alt: `${snapshot.title} — reading list` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function SharedPersonalListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await loadList(id);
  if (!snapshot) notFound();
  return <PersonalListView snapshot={snapshot} />;
}
