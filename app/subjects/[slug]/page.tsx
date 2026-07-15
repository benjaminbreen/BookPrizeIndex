import { notFound } from "next/navigation";
import { SubjectDetail } from "@/components/subject-detail";
import { browseBooksBySubject, browseData } from "@/lib/browse-data";
import { data, subjectsBySlug } from "@/lib/data";
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
  return { title: subject ? `${subject.name} / The Book Prize Index` : "Subject / The Book Prize Index" };
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
