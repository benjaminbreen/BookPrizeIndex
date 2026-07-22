export const SITE_NAME = "The Book Prize Index";
export const SITE_DESCRIPTION = "A sourced index of nonfiction book awards, publishers, imprints, subjects, and prize records.";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const value = configuredUrl ?? (vercelProductionUrl ? `https://${vercelProductionUrl}` : "http://localhost:3000");
  return new URL(value.endsWith("/") ? value : `${value}/`);
}

export function compactDescription(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : clipped.length).trimEnd()}…`;
}
