import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.4.34", "192.168.4.42", "192.168.4.47", "169.233.133.216"],
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // Book slugs are derived from titles. When a newly imported award supplies a
  // fuller title than the record previously had, the slug changes and the old URL
  // 404s. Keep a redirect for each such rename so existing links survive.
  async redirects() {
    return [
      {
        source: "/books/mandela-anthony-sampson",
        destination: "/books/mandela-the-authorised-biography-anthony-sampson",
        permanent: true,
      },
      {
        source: "/books/nature-boy-sean-ronayne",
        destination: "/books/nature-boy-a-journey-of-birdsong-and-belonging-sean-ronayne",
        permanent: true,
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/v1/books": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/books/[id]": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/appearances": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/awards": ["./public/data/latest/book-prize-index.json"],
  },
};

export default nextConfig;
