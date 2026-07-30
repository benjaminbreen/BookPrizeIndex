import assert from "node:assert/strict";
import test from "node:test";
import type { PrizeCategoryRegistryEntry, PrizeRegistryEntry } from "../../lib/award-records";
import { buildRosenBookRecords, parseWelchBooks } from "./aahm-book-prizes";
import { buildLevinsonRecords } from "./levinson";

function fixtures(id: string, categoryId: string) {
  const category: PrizeCategoryRegistryEntry = {
    id: categoryId,
    name: categoryId,
    sourceUrl: "https://official.example/",
    sourceLabel: "Official test source",
    sourceConfidence: "official",
    importStrategy: "test",
  };
  const prize: PrizeRegistryEntry = {
    id,
    name: id,
    organization: "Test organization",
    geography: "United States",
    categories: [category],
  };
  return { prize, category };
}

test("Welch parser keeps named books and rejects contribution/no-award rows", () => {
  const { prize, category } = fixtures("william-h-welch-medal", "welch-medical-history");
  const records = parseWelchBooks(prize, category, `
    <h4>Congratulations to Melissa Reynolds, 2026 Welch medalist for her monograph,
      <i>Reading Practice: The Pursuit of Natural Knowledge from Manuscript to Print</i>
      published by the University of Chicago Press.</h4>
    <h4>Past Welch Winners</h4>
    <p><strong>2025</strong> Elizabeth O'Brien, <em>Surgery &amp; Salvation</em>
      (University of North Carolina Press, 2023)</p>
    <p>1982<br>James Harvey Young, for scholarly contributions to the history of medicine</p>
    <p>1970<br>No award</p>
    <p>1954<br>Jerome Pierce Webster and Martha Teach Gnudi, The Life and Times of Gaspare Tagliacozzi
      (New York: Reichner, 1950)</p>
    <p>Genevieve Miller, “The Missing Seal”</p>
  `);
  assert.deepEqual(records.map((record) => record.year), [2026, 2025, 1954]);
  assert.deepEqual(records[0].authors, ["Melissa Reynolds"]);
  assert.equal(records[0].publisher, "University of Chicago Press");
  assert.deepEqual(records[2].authors, ["Jerome Pierce Webster", "Martha Teach Gnudi"]);
});

test("Rosen reviewed rows contain only nonfiction books", () => {
  const { prize, category } = fixtures("george-rosen-prize", "rosen-public-health-social-medicine-book");
  const records = buildRosenBookRecords(prize, category);
  assert.equal(records.length, 9);
  assert.deepEqual(records.filter((record) => [2019, 2023, 2025].includes(record.year)), []);
  assert.equal(records.find((record) => record.year === 2021)?.title, "The Oxford Handbook of Disability History");
});

test("Levinson rows cover every even award year from 2006 through 2024", () => {
  const { prize, category } = fixtures("suzanne-j-levinson-prize", "levinson-life-sciences-natural-history");
  const records = buildLevinsonRecords(prize, category);
  assert.deepEqual(records.map((record) => record.year), [2024, 2022, 2020, 2018, 2016, 2014, 2012, 2010, 2008, 2006]);
});
