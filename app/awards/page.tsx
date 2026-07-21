import { AwardsBrowser } from "@/components/awards-browser";
import { browseData } from "@/lib/browse-data";

export const metadata = {
  title: "Find Awards / The Book Prize Index",
};

export default function AwardsPage() {
  return <AwardsBrowser data={{ ...browseData, books: [] }} defaultRegion="all" />;
}
