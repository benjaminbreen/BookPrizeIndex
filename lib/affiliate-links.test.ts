import assert from "node:assert/strict";
import test from "node:test";
import { retailerLinkGroups, withAffiliateUrlTemplate, withAmazonAssociateTag } from "./affiliate-links";
import type { Book } from "./types";

const book: Book = {
  id: "book-example",
  slug: "example",
  title: "An Example Book",
  authors: [{ id: "person-reader", name: "A. Reader" }],
  isbn13: ["9781234567890"],
  subjects: [],
  topics: [],
  centralFigures: [],
  links: {},
  sourceIds: [],
};

test("adds an Amazon associate tag without discarding search parameters", () => {
  const href = withAmazonAssociateTag("https://www.amazon.com/s?k=example", "index-20");
  const url = new URL(href);
  assert.equal(url.searchParams.get("k"), "example");
  assert.equal(url.searchParams.get("tag"), "index-20");
});

test("does not add an Amazon tag to another host", () => {
  assert.equal(
    withAmazonAssociateTag("https://example.com/s?k=example", "index-20"),
    "https://example.com/s?k=example",
  );
});

test("wraps a destination only when an affiliate template has a URL placeholder", () => {
  assert.equal(
    withAffiliateUrlTemplate("https://retailer.example/search?q=book", "https://network.example/click?url={url}"),
    "https://network.example/click?url=https%3A%2F%2Fretailer.example%2Fsearch%3Fq%3Dbook",
  );
  assert.equal(
    withAffiliateUrlTemplate("https://retailer.example/search?q=book", "https://network.example/click"),
    "https://retailer.example/search?q=book",
  );
});

test("builds distinct new and used groups with configurable affiliate links", () => {
  const groups = retailerLinkGroups(book, {
    amazonAssociateTag: "index-20",
    bookshopAffiliateId: "1234",
    thriftBooksUrlTemplate: "https://network.example/click?url={url}",
  });

  assert.deepEqual(groups.map((group) => group.label), ["New & ebook", "Used books"]);
  assert.equal(groups[0]?.links[0]?.href, "https://bookshop.org/a/1234/9781234567890");
  assert.match(groups[0]?.links.find((link) => link.label === "Amazon")?.href ?? "", /tag=index-20/);
  assert.match(groups[1]?.links[0]?.href ?? "", /^https:\/\/network\.example\/click\?url=/);
});
