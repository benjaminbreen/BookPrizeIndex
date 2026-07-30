import { notFound } from "next/navigation";
import { SubjectDetail } from "@/components/subject-detail";
import { browseBooksBySubject, browseData } from "@/lib/browse-data";
import { data, subjectsBySlug } from "@/lib/data";
import { pageMetadata } from "@/lib/site-metadata";
import { HISTORY_SUBJECT, HISTORY_SUBJECTS, rollupSubjectName } from "@/lib/subject-rollup";

export function generateStaticParams() {
  return data.subjects.map((subject) => ({ slug: subject.slug }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const subject = subjectsBySlug.get(slug);
  if (!subject) return { title: "Subject / The Book Prize Index", robots: { index: false, follow: false } };
  return pageMetadata({
    title: `${subject.name} / The Book Prize Index`,
    description: subject.description ?? `Browse prize-recognized nonfiction books about ${subject.name.toLowerCase()}.`,
    canonical: `/subjects/${subject.slug}`,
  });
}

export default async function SubjectPage({ params }: PageProps) {
  const { slug } = await params;
  const subject = subjectsBySlug.get(slug);
  if (!subject) notFound();
  const isHistoryLanding = subject.name === HISTORY_SUBJECT;
  const books = browseBooksBySubject.get(subject.name) ?? [];
  const displayedSubject = isHistoryLanding ? {
    ...subject,
    bookCount: books.length,
    description: "History across the United States, the wider world, and transnational or general historical subjects.",
  } : subject;
  const relatedSubjects = browseData.subjects["all:all"]
    .filter((item) => rollupSubjectName(item.name) !== rollupSubjectName(subject.name))
    .slice(0, 6);
  return (
    <SubjectDetail
      awardOptions={browseData.awards}
      books={books}
      relatedSubjects={relatedSubjects}
      subdivisions={isHistoryLanding ? HISTORY_SUBJECTS.map((storedSubject) => ({
        label: storedSubject === HISTORY_SUBJECT ? "General" : storedSubject === "American History" ? "American" : "World & international",
        subject: storedSubject,
      })) : undefined}
      subject={displayedSubject}
    />
  );
}
