const BROWSE_TRAIL_KEY = "bpi:browse-trail";
const BROWSE_TRAIL_LIMIT = 600;

export type BrowseTrail = {
  label: string;
  slugs: string[];
};

export function writeBrowseTrail(trail: BrowseTrail) {
  if (typeof window === "undefined") return;
  try {
    const slugs = trail.slugs.filter(Boolean).slice(0, BROWSE_TRAIL_LIMIT);
    if (slugs.length < 2) {
      window.sessionStorage.removeItem(BROWSE_TRAIL_KEY);
      return;
    }
    window.sessionStorage.setItem(BROWSE_TRAIL_KEY, JSON.stringify({ label: trail.label, slugs }));
  } catch {
    // sessionStorage can be unavailable (private mode, quota); trail navigation is optional.
  }
}

export function readBrowseTrail(): BrowseTrail | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BROWSE_TRAIL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseTrail>;
    if (!Array.isArray(parsed.slugs) || parsed.slugs.length < 2) return null;
    return {
      label: typeof parsed.label === "string" ? parsed.label : "this list",
      slugs: parsed.slugs.filter((slug): slug is string => typeof slug === "string"),
    };
  } catch {
    return null;
  }
}
