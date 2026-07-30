import { SubjectsBrowser } from "@/components/subjects-browser";
import { browseData } from "@/lib/browse-data";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata({
  title: "Subjects / The Book Prize Index",
  description: "Browse prize-recognized nonfiction by primary subject, from biography and history to science, politics, nature, and criticism.",
  canonical: "/subjects",
});

export default function SubjectsPage() {
  return <SubjectsBrowser data={{ ...browseData, books: [] }} defaultRegion="all" />;
}
