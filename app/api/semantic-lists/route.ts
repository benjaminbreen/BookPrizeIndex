import { browseBooksById } from "@/lib/browse-data";
import {
  createSemanticListSnapshot,
  validateSemanticListDraft,
  type SemanticListDraft,
} from "@/lib/semantic-list";
import {
  acquireSemanticListPermit,
  semanticListRateHeaders,
} from "@/lib/semantic-list-rate-limit";
import {
  semanticListStorageConfigured,
  writeSharedSemanticList,
} from "@/lib/semantic-list-storage";
import { getSiteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SemanticListRequest = {
  action?: "prepare" | "share";
  draft?: SemanticListDraft;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as SemanticListRequest | null;
  const action = body?.action === "share" ? "share" : "prepare";
  const permit = acquireSemanticListPermit(request, action);
  if (!permit.allowed) {
    return Response.json(
      { error: "Too many list requests. Please wait a few minutes and try again." },
      { status: 429, headers: { ...semanticListRateHeaders(permit), "Retry-After": String(Math.max(1, Math.ceil((permit.resetAt - Date.now()) / 1000))) } },
    );
  }

  const validation = validateSemanticListDraft(body?.draft);
  if (!validation.ok) {
    return privateJson({ error: validation.error }, 400, permit);
  }

  try {
    const snapshot = createSemanticListSnapshot(validation.draft, browseBooksById);
    if (action === "prepare") {
      return privateJson({ snapshot }, 200, permit);
    }
    if (!semanticListStorageConfigured()) {
      return privateJson({ error: "Shared-list storage is not configured." }, 503, permit);
    }
    const stored = await writeSharedSemanticList(snapshot);
    const pathname = `/lists/${stored.snapshot.id}`;
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
      error: error instanceof Error ? error.message : "The list snapshot could not be created.",
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
