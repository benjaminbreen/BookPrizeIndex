import type { Book } from "@/lib/types";

const DEFAULT_AMAZON_ASSOCIATE_TAG = "ro067-20";

export type RetailerLink = {
  label: string;
  href: string;
  icon?: string;
  mark?: string;
  tooltip: string;
};

export type RetailerLinkGroup = {
  label: "New & ebook" | "Used books";
  links: RetailerLink[];
};

type AffiliateConfig = {
  amazonAssociateTag?: string;
  bookshopAffiliateId?: string;
  barnesNobleUrlTemplate?: string;
  koboUrlTemplate?: string;
  thriftBooksUrlTemplate?: string;
};

function publicAffiliateConfig(): AffiliateConfig {
  return {
    amazonAssociateTag: process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG ?? DEFAULT_AMAZON_ASSOCIATE_TAG,
    bookshopAffiliateId: process.env.NEXT_PUBLIC_BOOKSHOP_AFFILIATE_ID,
    barnesNobleUrlTemplate: process.env.NEXT_PUBLIC_BARNES_NOBLE_AFFILIATE_URL_TEMPLATE,
    koboUrlTemplate: process.env.NEXT_PUBLIC_KOBO_AFFILIATE_URL_TEMPLATE,
    thriftBooksUrlTemplate: process.env.NEXT_PUBLIC_THRIFTBOOKS_AFFILIATE_URL_TEMPLATE,
  };
}

export function withAmazonAssociateTag(href: string, associateTag = publicAffiliateConfig().amazonAssociateTag) {
  if (!associateTag) return href;
  try {
    const url = new URL(href);
    if (url.hostname !== "amazon.com" && !url.hostname.endsWith(".amazon.com")) return href;
    url.searchParams.set("tag", associateTag);
    return url.toString();
  } catch {
    return href;
  }
}

export function withAffiliateUrlTemplate(href: string, template?: string) {
  if (!template?.includes("{url}")) return href;
  return template.replaceAll("{url}", encodeURIComponent(href));
}

export function retailerLinkGroups(book: Book, config: AffiliateConfig = publicAffiliateConfig()): RetailerLinkGroup[] {
  const searchText = [book.title, book.authors[0]?.name].filter(Boolean).join(" ").trim();
  const isbn = book.isbn13[0];
  const lookup = isbn ?? searchText;
  if (!lookup) return [];

  const bookshopSearch = book.links.bookshop ?? `https://bookshop.org/search?keywords=${encodeURIComponent(searchText)}`;
  const bookshopHref = config.bookshopAffiliateId && isbn
    ? `https://bookshop.org/a/${encodeURIComponent(config.bookshopAffiliateId)}/${encodeURIComponent(isbn)}`
    : bookshopSearch;
  const amazonSearch = book.links.amazon ?? `https://www.amazon.com/s?k=${encodeURIComponent(lookup)}`;
  const barnesNobleSearch = `https://www.barnesandnoble.com/s/${encodeURIComponent(lookup)}`;
  const koboSearch = `https://www.kobo.com/us/en/search?query=${encodeURIComponent(searchText)}`;
  const thriftBooksSearch = `https://www.thriftbooks.com/browse/?b.search=${encodeURIComponent(lookup)}`;

  return [
    {
      label: "New & ebook",
      links: [
        {
          label: "Bookshop.org",
          href: bookshopHref,
          icon: "/icons/bookshop.png",
          tooltip: "Buy on Bookshop.org",
        },
        {
          label: "Barnes & Noble",
          href: withAffiliateUrlTemplate(barnesNobleSearch, config.barnesNobleUrlTemplate),
          icon: "/icons/bn.png",
          tooltip: "Buy on Barnes & Noble",
        },
        {
          label: "Amazon",
          href: withAmazonAssociateTag(amazonSearch, config.amazonAssociateTag),
          icon: "/icons/amazon.png",
          tooltip: "Buy on Amazon",
        },
        {
          label: "Kobo",
          href: withAffiliateUrlTemplate(koboSearch, config.koboUrlTemplate),
          mark: "K",
          tooltip: "Find the ebook on Kobo",
        },
      ],
    },
    {
      label: "Used books",
      links: [
        {
          label: "ThriftBooks",
          href: withAffiliateUrlTemplate(thriftBooksSearch, config.thriftBooksUrlTemplate),
          mark: "T",
          tooltip: "Search ThriftBooks for a used copy",
        },
      ],
    },
  ];
}
