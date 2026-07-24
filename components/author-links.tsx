"use client";

import Link from "next/link";

export type LinkedAuthor = {
  id: string;
  name: string;
  slug: string;
};

export function AuthorLinks({
  authors,
  className = "",
}: {
  authors: LinkedAuthor[];
  className?: string;
}) {
  return (
    <span className={`book-author-links ${className}`}>
      {authors.map((author, index) => (
        <span key={author.id}>
          {index > 0 ? ", " : null}
          <Link
            className="focus-ring transition hover:text-[var(--accent)]"
            href={`/authors/${author.slug}`}
            onClick={(event) => event.stopPropagation()}
          >
            {author.name}
          </Link>
        </span>
      ))}
    </span>
  );
}
