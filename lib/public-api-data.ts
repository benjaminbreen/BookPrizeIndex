import fs from "node:fs/promises";
import path from "node:path";
import type { PublicRelease } from "@/lib/public-release";

const releasePath = path.join(process.cwd(), "public", "data", "latest", "book-prize-index.json");
let releasePromise: Promise<PublicRelease> | undefined;

export function readPublicRelease() {
  releasePromise ??= fs.readFile(releasePath, "utf8").then((content) => JSON.parse(content) as PublicRelease);
  return releasePromise;
}

export function pagination(searchParams: URLSearchParams) {
  const requestedPage = Number(searchParams.get("page") ?? 1);
  const requestedLimit = Number(searchParams.get("limit") ?? 50);
  return {
    page: Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1,
    pageSize: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 50,
  };
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return { currentPage, rows: rows.slice(start, start + pageSize), total, totalPages };
}

export function apiResponse(
  release: PublicRelease,
  data: unknown,
  meta: Record<string, unknown> = {},
  status = 200,
) {
  return Response.json(
    {
      data,
      meta: {
        datasetVersion: release.datasetVersion,
        schemaVersion: release.schemaVersion,
        generatedAt: release.generatedAt,
        ...meta,
      },
    },
    {
      status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

export function normalized(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}
