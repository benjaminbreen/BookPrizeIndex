import { ArrowUpRight, Library } from "lucide-react";
import { libraryLookupUrl } from "@/lib/library-links";
import type { Book } from "@/lib/types";

export function LibraryLookupLink({ book, variant = "detail" }: { book: Book; variant?: "detail" | "drawer" }) {
  const href = libraryLookupUrl(book);

  if (variant === "drawer") {
    return (
      <a
        className="focus-ring inline-flex items-center justify-center gap-3 border hairline px-4 py-4 text-sm transition hover:bg-[var(--panel)]"
        href={href}
        referrerPolicy="no-referrer"
        rel="noreferrer"
        target="_blank"
      >
        <Library aria-hidden="true" size={17} />
        Find at a library
      </a>
    );
  }

  return (
    <div className="mt-5 border-t hairline pt-4">
      <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.18em] muted">Library lookup</p>
      <a
        className="focus-ring mt-3 flex items-center justify-between gap-3 border hairline px-3 py-3 transition hover:bg-[var(--accent-soft)]"
        href={href}
        referrerPolicy="no-referrer"
        rel="noreferrer"
        target="_blank"
      >
        <span className="flex items-center gap-2.5">
          <Library aria-hidden="true" size={16} />
          <span>Find at a library</span>
        </span>
        <ArrowUpRight aria-hidden="true" size={14} />
      </a>
      <p className="mt-2 text-[0.68rem] leading-4 muted">
        Opens WorldCat. We don&apos;t request or receive your location; WorldCat handles any local results.
      </p>
    </div>
  );
}
