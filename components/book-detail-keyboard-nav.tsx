"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readBrowseTrail } from "@/lib/browse-trail";

/**
 * Arrow-key navigation on a book detail page.
 *
 * Up / Down step through the list the reader clicked in from (recorded by
 * BrowseTrailWriter). Left / Right step along the Library of Congress shelf,
 * matching the direction of the shelf strip further down the page.
 */
export function BookDetailKeyboardNav({
  slug,
  shelfPreviousHref,
  shelfNextHref,
}: {
  slug: string;
  shelfPreviousHref?: string;
  shelfNextHref?: string;
}) {
  const router = useRouter();
  const [trailSlugs, setTrailSlugs] = useState<string[]>([]);

  useEffect(() => {
    setTrailSlugs(readBrowseTrail()?.slugs ?? []);
  }, [slug]);

  const index = trailSlugs.indexOf(slug);
  const previousInTrail = index > 0 ? trailSlugs[index - 1] : undefined;
  const nextInTrail = index >= 0 && index < trailSlugs.length - 1 ? trailSlugs[index + 1] : undefined;
  const hasTrail = Boolean(previousInTrail || nextInTrail);
  const hasShelf = Boolean(shelfPreviousHref || shelfNextHref);

  useEffect(() => {
    const targets: Record<string, string | undefined> = {
      ArrowUp: previousInTrail ? `/books/${previousInTrail}` : undefined,
      ArrowDown: nextInTrail ? `/books/${nextInTrail}` : undefined,
      ArrowLeft: shelfPreviousHref,
      ArrowRight: shelfNextHref,
    };

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTextEntry(event.target) || isInsideOverlay(event.target)) return;

      const href = targets[event.key];
      if (!href) return;

      event.preventDefault();
      router.push(href);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextInTrail, previousInTrail, router, shelfNextHref, shelfPreviousHref]);

  if (!hasTrail && !hasShelf) return null;

  return (
    <p className="book-detail-key-hints">
      {hasTrail ? (
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          browse this list
        </span>
      ) : null}
      {hasShelf ? (
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd>
          walk the shelf
        </span>
      ) : null}
    </p>
  );
}

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isInsideOverlay(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("[role='dialog']"));
}
