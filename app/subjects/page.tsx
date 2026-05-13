import { SubjectsBrowser } from "@/components/subjects-browser";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { browseData } from "@/lib/browse-data";
import { cookies } from "next/headers";

export const metadata = {
  title: "Subjects / The Book Prize Index",
};

export default async function SubjectsPage() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);
  return <SubjectsBrowser data={{ ...browseData, books: [] }} defaultRegion={defaultRegion} />;
}
