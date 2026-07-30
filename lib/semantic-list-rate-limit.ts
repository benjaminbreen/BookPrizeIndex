import { createHash } from "node:crypto";

type RateEntry = { count: number; resetAt: number };

const runtime = globalThis as typeof globalThis & {
  __bookPrizeSemanticListRateLimits?: Map<string, RateEntry>;
};

const limits = runtime.__bookPrizeSemanticListRateLimits ??= new Map<string, RateEntry>();
const WINDOW_MS = 10 * 60_000;

export function acquireSemanticListPermit(request: Request, action: "prepare" | "share") {
  const now = Date.now();
  const limit = action === "share" ? 10 : 30;
  const key = `${action}:${requestFingerprint(request)}`;
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    pruneExpired(now);
    return { allowed: true as const, limit, remaining: limit - 1, resetAt: now + WINDOW_MS };
  }
  if (current.count >= limit) {
    return { allowed: false as const, limit, remaining: 0, resetAt: current.resetAt };
  }
  current.count += 1;
  return { allowed: true as const, limit, remaining: limit - current.count, resetAt: current.resetAt };
}

export function semanticListRateHeaders(permit: { limit: number; remaining: number; resetAt: number }) {
  return {
    "RateLimit-Limit": String(permit.limit),
    "RateLimit-Remaining": String(permit.remaining),
    "RateLimit-Reset": String(Math.max(1, Math.ceil((permit.resetAt - Date.now()) / 1000))),
  };
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(address).digest("hex").slice(0, 20);
}

function pruneExpired(now: number) {
  if (limits.size < 500) return;
  for (const [key, value] of limits) {
    if (value.resetAt <= now) limits.delete(key);
  }
}
