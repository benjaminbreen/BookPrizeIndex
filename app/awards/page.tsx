import { AwardsBrowser } from "@/components/awards-browser";
import { browseData } from "@/lib/browse-data";

export const metadata = {
  title: "Find Awards / The Book Prize Index",
  description: "Browse sourced histories of major nonfiction book prizes, including winners, finalists, shortlists, and longlists.",
  alternates: { canonical: "/awards" },
};

export default function AwardsPage() {
  return <AwardsBrowser data={{ ...browseData, books: [] }} defaultRegion="all" />;
}
