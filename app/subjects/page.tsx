import { SubjectsBrowser } from "@/components/subjects-browser";
import { data } from "@/lib/data";

export const metadata = {
  title: "Subjects / The Book Prize Index",
};

export default function SubjectsPage() {
  return <SubjectsBrowser data={data} />;
}
