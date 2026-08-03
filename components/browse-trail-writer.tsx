"use client";

import { useEffect } from "react";
import { writeBrowseTrail } from "@/lib/browse-trail";

/**
 * Records the ordered list a reader is browsing so book detail pages can offer
 * up/down arrow navigation through it. Renders nothing; safe to drop into
 * server components.
 */
export function BrowseTrailWriter({ label, slugs }: { label: string; slugs: string[] }) {
  const signature = slugs.join(",");

  useEffect(() => {
    writeBrowseTrail({ label, slugs: signature ? signature.split(",") : [] });
  }, [label, signature]);

  return null;
}
