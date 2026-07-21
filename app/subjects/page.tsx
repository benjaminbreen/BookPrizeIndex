import { SubjectsBrowser } from "@/components/subjects-browser";
import { browseData } from "@/lib/browse-data";

export const metadata = {
  title: "Subjects / The Book Prize Index",
};

export default function SubjectsPage() {
  return <SubjectsBrowser data={{ ...browseData, books: [] }} defaultRegion="all" />;
}
