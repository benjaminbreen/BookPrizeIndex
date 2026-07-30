import { browseBooksById } from "@/lib/browse-data";
import {
  createPersonalListSnapshot,
  validatePersonalListDraft,
  type PersonalListDraft,
} from "@/lib/personal-list";
import {
  personalListStorageConfigured,
  writeSharedPersonalList,
} from "@/lib/personal-list-storage";
import {
  acquireSemanticListPermit,
  semanticListRateHeaders,
} from "@/lib/semantic-list-rate-limit";
import { getSiteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PersonalListRequest = {
  draft?: PersonalListDraft;
};

export async function POST(request: Request) {
  const permit = acquireSemanticListPermit(request, "share");
  if (!permit.allowed) {
    return Response.json(
      { error: "Too many list requests. Please wait a few minutes and try again." },
      { status: 429, headers: { ...semanticListRateHeaders(permit), "Retry-After": String(Math.max(1, Math.ceil((permit.resetAt - Date.now()) / 1000))) } },
    );
  }

  const body = await request.json().catch(() => null) as PersonalListRequest | null;
  const validation = validatePersonalListDraft(body?.draft);
  if (!validation.ok) return privateJson({ error: validation.error }, 400, permit);
  if (!personalListStorageConfigured()) {
    return privateJson({ error: "Shared-list storage is not configured." }, 503, permit);
  }

  try {
    const snapshot = createPersonalListSnapshot(validation.draft, browseBooksById);
    const stored = await writeSharedPersonalList(snapshot);
    const pathname = `/reading-lists/${stored.snapshot.id}`;
    const configuredSiteUrl = getSiteUrl();
    const requestUrl = new URL(request.url);
    const linkBase = configuredSiteUrl.hostname === "localhost" || configuredSiteUrl.hostname === "127.0.0.1"
      ? requestUrl.origin
      : configuredSiteUrl;
    return privateJson({
      created: stored.created,
      id: stored.snapshot.id,
      snapshot: stored.snapshot,
      url: new URL(pathname, linkBase).toString(),
    }, 200, permit);
  } catch (error) {
    return privateJson({
      error: error instanceof Error ? error.message : "The reading list could not be shared.",
    }, 500, permit);
  }
}

function privateJson(body: unknown, status: number, permit: { limit: number; remaining: number; resetAt: number }) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...semanticListRateHeaders(permit),
    },
  });
}
