import { retailerLinkGroups, type RetailerLink } from "@/lib/affiliate-links";
import type { Book } from "@/lib/types";

export function BookRetailerLinks({ book, compact = false }: { book: Book; compact?: boolean }) {
  const groups = retailerLinkGroups(book);
  if (!groups.length) return null;

  const content = (
    <>
      <div className="book-retailer-groups">
        {groups.map((group) => (
          <div className="book-retailer-group" key={group.label}>
            <span className="book-retailer-group-label">{group.label}</span>
            <span className="flex flex-nowrap items-center gap-2">
              {group.links.map((link) => <RetailerLinkButton key={link.label} link={link} />)}
            </span>
          </div>
        ))}
      </div>
      <p className="book-retailer-disclosure">
        Purchases may earn the Index a commission. As an Amazon Associate I earn from qualifying purchases.
      </p>
    </>
  );

  if (compact) {
    return (
      <div className="book-retailer-links book-retailer-links-compact grid gap-2 border-b hairline py-2.5">
        <dt className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">Find this book</dt>
        <dd>{content}</dd>
      </div>
    );
  }

  return (
    <div className="book-retailer-links">
      <p className="font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.18em] muted">Find this book</p>
      {content}
    </div>
  );
}

function RetailerLinkButton({ link }: { link: RetailerLink }) {
  return (
    <a
      aria-label={link.tooltip}
      className="book-retailer-link focus-ring"
      href={link.href}
      rel="noreferrer sponsored"
      target="_blank"
      title={link.label}
    >
      {link.icon ? <img alt="" src={link.icon} /> : <span className="book-retailer-mark" aria-hidden="true">{link.mark}</span>}
      <span className="book-retailer-tooltip" role="tooltip">{link.tooltip}</span>
    </a>
  );
}
