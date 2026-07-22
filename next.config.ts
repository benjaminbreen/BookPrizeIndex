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
  outputFileTracingIncludes: {
    "/api/v1/books": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/books/[id]": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/appearances": ["./public/data/latest/book-prize-index.json"],
    "/api/v1/awards": ["./public/data/latest/book-prize-index.json"],
  },
};

export default nextConfig;
