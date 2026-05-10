import logoManifest from "@/public/imprint-logos/manifest.json";

export type ImprintLogoEntry = {
  imprintId: string;
  imprintName: string;
  status: "downloaded" | "missing" | "failed";
  logoPath?: string;
  originalPath?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  mime?: string;
  error?: string;
};

export const imprintLogoManifest = logoManifest as ImprintLogoEntry[];

export const imprintLogosById = new Map(
  imprintLogoManifest
    .filter((entry) => entry.status === "downloaded" && entry.logoPath)
    .map((entry) => [entry.imprintId, entry]),
);

export function getImprintLogo(imprintId: string) {
  return imprintLogosById.get(imprintId);
}
