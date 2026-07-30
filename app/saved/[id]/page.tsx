import type { Metadata } from "next";
import { SavedSemanticListDetail } from "@/components/saved-semantic-lists";

export const metadata: Metadata = {
  title: "Saved List / The Book Prize Index",
  description: "A semantic-search reading list saved in this browser.",
  robots: { index: false, follow: false },
};

export default async function SavedListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SavedSemanticListDetail id={id} />;
}
