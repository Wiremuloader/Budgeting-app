/**
 * In-memory sliding-window rate limiter for sensitive app endpoints (assistant,
 * imports, exports). Auth endpoints use Better Auth's own limiter.
 *
 * Limitation: state is per process. Multi-instance deployments must replace this
 * with a shared store (e.g. Redis) — see docs/SECURITY.md.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfterSeconds: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
