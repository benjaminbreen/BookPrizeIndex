import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

export const DEFAULT_SOCIAL_IMAGE = {
  url: "/social-card.png",
  width: 1200,
  height: 630,
  alt: "The Book Prize Index — a source-backed index of nonfiction book prizes",
};

export function pageMetadata({
  canonical,
  description,
  title,
}: {
  canonical: string;
  description: string;
  title: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      images: [DEFAULT_SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_SOCIAL_IMAGE.url],
    },
  };
}
