# Retailer and affiliate links

The book page and drawer use one shared retailer-link builder in
`lib/affiliate-links.ts`. It shows Bookshop.org, Barnes & Noble, Amazon, and
Kobo under **New & ebook**, with ThriftBooks in a separate **Used books** row.
ISBN is preferred for print searches; title and first author are the fallback.

## Current configuration

- **Amazon Associates**: `NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG` is added as the
  `tag` query parameter. The existing `ro067-20` tag remains the default.
- **Bookshop.org**: after affiliate approval, set
  `NEXT_PUBLIC_BOOKSHOP_AFFILIATE_ID`. Books with an ISBN then use
  `https://bookshop.org/a/{affiliate-id}/{isbn}`. Title searches remain
  non-affiliate links when no ISBN is available.
- **Barnes & Noble**: apply through Impact. After approval, create a
  deep-link template and set `NEXT_PUBLIC_BARNES_NOBLE_AFFILIATE_URL_TEMPLATE`.
- **Kobo**: apply through Rakuten Advertising. After approval, set the
  retailer-specific deep-link template in
  `NEXT_PUBLIC_KOBO_AFFILIATE_URL_TEMPLATE`.
- **ThriftBooks**: ThriftBooks does not currently publish a direct affiliate
  signup on its own site. Affiliate-network availability changes; if the site
  is accepted by a network that supports ThriftBooks deep links, set
  `NEXT_PUBLIC_THRIFTBOOKS_AFFILIATE_URL_TEMPLATE`.

For each template variable, paste the tracking/deep-link URL supplied by the
approved network and replace the encoded destination value with `{url}`. The
builder substitutes a URL-encoded retailer search destination. A missing or
malformed template safely falls back to the ordinary retailer link.

`NEXT_PUBLIC_*` values are included in the browser bundle and must never contain
network passwords, API secrets, or private account credentials.

## Disclosure

The retailer panel says that purchases may earn the Index a commission and
includes Amazon's required associate statement. The About page repeats the
disclosure. External retailer links use `rel="sponsored noreferrer"`.

## Program notes reviewed July 2026

- [Bookshop.org](https://bookshop.org/affiliates/profile/introduction) offers
  a non-bookstore affiliate program and documents direct ISBN links in the form
  `bookshop.org/a/{affiliate-id}/{isbn}`.
- [Barnes & Noble](https://www.barnesandnoble.com/terms/affiliates) directs
  affiliate applicants to Impact.
- [Kobo](https://www.kobo.com/us/en/p/affiliate) directs applicants to
  Rakuten Advertising and states that approval usually takes one to two weeks.
- [IndieBound](https://www.indiebound.org/bookshop-affiliate-program) asked
  sites to replace its former buy buttons with Bookshop.org buttons in 2023;
  its duplicate retailer button was therefore removed here.
- [Amazon](https://affiliate-program.amazon.com/help/operating/agreement/)
  requires tagged Special Links and the statement included in the UI.
- [FTC guidance](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
  says commission relationships should be disclosed clearly and close to the
  relevant links, rather than only on a separate About page.
