import type { MetadataRoute } from "next";
import { data } from "@/lib/data";
import { getSiteUrl } from "@/lib/site";
import { topicSummaries } from "@/lib/topics";

const STATIC_ROUTES = [
  "/about",
  "/accessibility",
  "/colophon",
  "/methodology",
  "/privacy",
  "/terms",
];

const DATA_ROUTES = [
  "",
  "/awards",
  "/books",
  "/data",
  "/experiments",
  "/fun",
  "/fun/chromatic-index",
  "/fun/nonfiction-galaxy",
  "/imprints",
  "/publishers",
  "/subjects",
  "/topics",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date(data.generatedAt);
  const awardProgramSlugs = (data.awardPrograms ?? [])
    .filter((program) => data.awards.filter((award) => award.programId === program.id).length > 1)
    .map((program) => program.slug);
  const publisherIdsWithBooks = new Set(data.books.map((book) => book.publisherId).filter(Boolean));
  const imprintIdsWithBooks = new Set(data.books.map((book) => book.imprintId).filter(Boolean));
  const dataPaths = [
    ...DATA_ROUTES,
    ...data.books.map((book) => `/books/${book.slug}`),
    ...data.awards.map((award) => `/awards/${award.slug}`),
    ...awardProgramSlugs.map((slug) => `/awards/${slug}`),
    ...data.subjects.map((subject) => `/subjects/${subject.slug}`),
    ...topicSummaries().map((topic) => `/topics/${topic.slug}`),
    ...data.publishers
      .filter((publisher) => publisherIdsWithBooks.has(publisher.id))
      .map((publisher) => `/publishers/${publisher.id.replace(/^publisher-/, "")}`),
    ...data.imprints
      .filter((imprint) => imprintIdsWithBooks.has(imprint.id))
      .map((imprint) => `/imprints/${imprint.id.replace(/^imprint-/, "")}`),
  ];

  return [
    ...STATIC_ROUTES.map((path) => ({ url: new URL(path, siteUrl).toString() })),
    ...[...new Set(dataPaths)].map((path) => ({
      url: new URL(path || "/", siteUrl).toString(),
      lastModified,
    })),
  ];
}
