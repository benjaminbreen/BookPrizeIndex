import { Link2 } from "lucide-react";

export function SectionPermalink({ id, label }: { id: string; label: string }) {
  return (
    <a
      aria-label={`Link to ${label}`}
      className="focus-ring ml-2 inline-flex rounded-sm align-middle text-[var(--muted)] opacity-60 transition hover:text-[var(--accent)] hover:opacity-100"
      href={`#${id}`}
      title={`Link to ${label}`}
    >
      <Link2 aria-hidden="true" size={17} strokeWidth={1.6} />
    </a>
  );
}
