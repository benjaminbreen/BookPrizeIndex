export type SemanticSearchGuardConfig = {
  maxConcurrent: number;
  maxRequestsPerWindow: number;
  windowMs: number;
};

export type SemanticSearchPermit =
  | {
      allowed: true;
      limit: number;
      remaining: number;
      release: () => void;
    }
  | {
      allowed: false;
      limit: number;
      reason: "concurrency" | "rate";
      remaining: number;
      retryAfterSeconds: number;
    };

export type SemanticSearchGuard = {
  acquire: (now?: number) => SemanticSearchPermit;
};

const DEFAULT_MAX_REQUESTS_PER_MINUTE = 20;
const DEFAULT_MAX_CONCURRENT = 3;
const ONE_MINUTE_MS = 60_000;

type SemanticSearchGuardEnvironment = Record<string, string | undefined>;

type SemanticSearchGlobal = typeof globalThis & {
  __bookPrizeSemanticSearchGuard?: SemanticSearchGuard;
};

export function semanticSearchEnabled(environment: SemanticSearchGuardEnvironment = process.env) {
  return environment.SEMANTIC_SEARCH_ENABLED?.trim().toLowerCase() !== "false";
}

export function semanticSearchGuardConfig(
  environment: SemanticSearchGuardEnvironment = process.env,
): SemanticSearchGuardConfig {
  return {
    maxConcurrent: boundedInteger(environment.SEMANTIC_SEARCH_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT, 1, 20),
    maxRequestsPerWindow: boundedInteger(
      environment.SEMANTIC_SEARCH_REQUESTS_PER_MINUTE,
      DEFAULT_MAX_REQUESTS_PER_MINUTE,
      1,
      600,
    ),
    windowMs: ONE_MINUTE_MS,
  };
}

export function getSemanticSearchGuard() {
  const runtime = globalThis as SemanticSearchGlobal;
  runtime.__bookPrizeSemanticSearchGuard ??= createSemanticSearchGuard(semanticSearchGuardConfig());
  return runtime.__bookPrizeSemanticSearchGuard;
}

export function createSemanticSearchGuard(config: SemanticSearchGuardConfig): SemanticSearchGuard {
  let windowStartedAt = 0;
  let requestsInWindow = 0;
  let inFlight = 0;

  return {
    acquire(now = Date.now()) {
      if (!windowStartedAt || now - windowStartedAt >= config.windowMs) {
        windowStartedAt = now;
        requestsInWindow = 0;
      }

      if (requestsInWindow >= config.maxRequestsPerWindow) {
        return {
          allowed: false,
          limit: config.maxRequestsPerWindow,
          reason: "rate",
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + config.windowMs - now) / 1000)),
        };
      }

      if (inFlight >= config.maxConcurrent) {
        return {
          allowed: false,
          limit: config.maxRequestsPerWindow,
          reason: "concurrency",
          remaining: Math.max(0, config.maxRequestsPerWindow - requestsInWindow),
          retryAfterSeconds: 2,
        };
      }

      requestsInWindow += 1;
      inFlight += 1;
      let released = false;

      return {
        allowed: true,
        limit: config.maxRequestsPerWindow,
        remaining: Math.max(0, config.maxRequestsPerWindow - requestsInWindow),
        release() {
          if (released) return;
          released = true;
          inFlight = Math.max(0, inFlight - 1);
        },
      };
    },
  };
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}
