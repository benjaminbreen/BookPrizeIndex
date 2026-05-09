import { notFound } from "next/navigation";
import { SubjectDetail } from "@/components/subject-detail";
import { booksForSubject } from "@/lib/catalog";
import { data } from "@/lib/data";

export function generateStaticParams() {
  return data.subjects.map((subject) => ({ slug: subject.slug }));
}

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const subject = data.subjects.find((item) => item.slug === slug);
  return { title: subject ? `${subject.name} / The Book Prize Index` : "Subject / The Book Prize Index" };
}

export default async function SubjectPage({ params }: PageProps) {
  const { slug } = await params;
  const subject = data.subjects.find((item) => item.slug === slug);
  if (!subject) notFound();
  return <SubjectDetail subject={subject} books={booksForSubject(subject.slug)} />;
}
