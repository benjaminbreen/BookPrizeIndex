"use client";

import { useId, useState } from "react";

export function ExpandableBookDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const shouldClamp = text.length > 720;

  return (
    <div className="book-description">
      <p className={`book-description-text ${shouldClamp && !expanded ? "book-description-text-clamped" : ""}`} id={id}>
        {text}
      </p>
      {shouldClamp ? (
        <button
          aria-controls={id}
          aria-expanded={expanded}
          className="book-description-toggle focus-ring"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
