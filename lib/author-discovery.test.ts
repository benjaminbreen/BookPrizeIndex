import assert from "node:assert/strict";
import test from "node:test";
import { authorFacetMatchesIntent, bookAuthorsMatchIntent, fallbackAuthorIntent } from "./author-discovery";
import { authorPlatformLinksFor } from "./author-platform-links";

const irishLivingAuthor = {
  personId: "person-example",
  name: "Example Writer",
  countries: [{ code: "IE", name: "Ireland" }],
  lifeStatus: "living" as const,
  platforms: ["substack"],
};

test("matches all requested facets on the same author", () => {
  assert.equal(authorFacetMatchesIntent(irishLivingAuthor, {
    countries: ["Irish"],
    lifeStatus: "living",
    platforms: ["substack"],
    mode: "filter",
  }), true);
  assert.equal(bookAuthorsMatchIntent([
    { ...irishLivingAuthor, lifeStatus: "deceased" },
    { ...irishLivingAuthor, countries: [{ code: "US", name: "United States" }] },
  ], {
    countries: ["Irish"],
    lifeStatus: "living",
    mode: "filter",
  }), false);
});

test("treats explicit author requests as filters and audience taste as boosts", () => {
  assert.deepEqual(fallbackAuthorIntent("books by living Irish writers"), {
    countries: ["ireland"],
    lifeStatus: "living",
    platforms: [],
    mode: "filter",
  });
  assert.deepEqual(fallbackAuthorIntent("books that Substack readers would like"), {
    countries: [],
    lifeStatus: undefined,
    platforms: ["substack"],
    mode: "boost",
  });
  assert.deepEqual(fallbackAuthorIntent("books by Substack writers"), {
    countries: [],
    lifeStatus: undefined,
    platforms: ["substack"],
    mode: "filter",
  });
  assert.equal(fallbackAuthorIntent("classic Latin American biographies"), undefined);
});

test("exposes only verified author platform links", () => {
  assert.deepEqual(authorPlatformLinksFor([{ id: "person-benjamin-breen", name: "Benjamin Breen" }]), [{
    authorName: "Benjamin Breen",
    personId: "person-benjamin-breen",
    service: "substack",
    title: "Res Obscura",
    url: "https://resobscura.substack.com",
  }]);
  assert.deepEqual(authorPlatformLinksFor([{ id: "person-no-platform", name: "No Platform" }]), []);
});
