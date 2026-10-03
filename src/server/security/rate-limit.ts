import { AppError } from "@/server/errors";

/**
 * Fixed-window rate limiter held in process memory.
 * Correct for a single instance; a multi-instance deployment must swap this for a shared store (e.g. Redis).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    b.count++;
    if (b.count > limit) {
      throw new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", {
        retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000),
      });
    }
  }
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
