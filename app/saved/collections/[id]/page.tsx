import type { Metadata } from "next";
import { PersonalBookListDetail } from "@/components/saved-semantic-lists";

export const metadata: Metadata = {
  title: "Personal List / The Book Prize Index",
  description: "A personal book list saved in this browser.",
  robots: { index: false, follow: false },
};

export default async function PersonalListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonalBookListDetail id={id} />;
}
