import { SubjectsBrowser } from "@/components/subjects-browser";
import { browseData } from "@/lib/browse-data";

export const metadata = {
  title: "Subjects / The Book Prize Index",
  description: "Browse prize-recognized nonfiction by primary subject, from biography and history to science, politics, nature, and criticism.",
  alternates: { canonical: "/subjects" },
};

export default function SubjectsPage() {
  return <SubjectsBrowser data={{ ...browseData, books: [] }} defaultRegion="all" />;
}
