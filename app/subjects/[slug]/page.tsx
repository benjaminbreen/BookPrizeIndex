import { notFound } from "next/navigation";
import { SubjectDetail } from "@/components/subject-detail";
import { browseBooksBySubject, browseData } from "@/lib/browse-data";
import { data, subjectsBySlug } from "@/lib/data";

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
  return (
    <SubjectDetail
      awardOptions={browseData.awards}
      books={browseBooksBySubject.get(subject.name) ?? []}
      relatedSubjects={browseData.subjects["all:all"].filter((item) => item.id !== subject.id).slice(0, 6)}
      subject={subject}
    />
  );
}
