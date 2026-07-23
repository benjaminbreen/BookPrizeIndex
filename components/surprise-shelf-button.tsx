"use client";

import { Shuffle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function SurpriseShelfButton({
  currentIndex,
  totalBooks,
}: {
  currentIndex: number;
  totalBooks: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function surpriseMe() {
    if (totalBooks < 1) return;
    let nextIndex = Math.floor(Math.random() * totalBooks);
    if (totalBooks > 1 && nextIndex === currentIndex) {
      nextIndex = (nextIndex + 1) % totalBooks;
    }
    startTransition(() => {
      router.replace(`/fun/library-of-congress-shelf?index=${nextIndex}`, { scroll: false });
    });
  }

  return (
    <button
      aria-label="Choose a random book from the Library of Congress shelf"
      className="focus-ring library-shelf-surprise"
      disabled={pending || totalBooks < 1}
      onClick={surpriseMe}
      type="button"
    >
      <Shuffle aria-hidden="true" size={15} />
      <span>{pending ? "Choosing…" : "Surprise me"}</span>
    </button>
  );
}
