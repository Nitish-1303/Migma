/**
 * Token bucket, per key, in memory.
 *
 * This limit protects the workspace's own upstream quota -- Standard is 500/min
 * and 10,000/day across the whole account -- so a client stuck in a retry loop
 * cannot spend the day's allowance in an afternoon.
 *
 * State is per instance. Two replicas therefore allow twice the configured rate;
 * a deployment that needs an exact ceiling wants a shared counter instead, and
 * the README says so rather than leaving it to be discovered.
 */

export function createRateLimiter({ perMinute, burst = perMinute, sweepMs = 60000 }) {
  const buckets = new Map();
  const refillPerMs = perMinute / 60000;

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      // A bucket back at full and untouched for a minute carries no information.
      if (bucket.tokens >= burst && now - bucket.seen > sweepMs) buckets.delete(key);
    }
  }, sweepMs);
  // Never the reason the process stays alive.
  sweep.unref?.();

  return {
    take(key, cost = 1) {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: burst, seen: now };
        buckets.set(key, bucket);
      }
      bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.seen) * refillPerMs);
      bucket.seen = now;

      if (bucket.tokens < cost) {
        const waitMs = Math.ceil((cost - bucket.tokens) / refillPerMs);
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil(waitMs / 1000)),
          resetAt: Math.ceil((now + waitMs) / 1000)
        };
      }

      bucket.tokens -= cost;
      const toFull = Math.ceil((burst - bucket.tokens) / refillPerMs);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfter: 0,
        resetAt: Math.ceil((now + toFull) / 1000)
      };
    },

    headers(result) {
      return {
        "x-ratelimit-limit": String(perMinute),
        "x-ratelimit-remaining": String(result.remaining),
        // Epoch seconds, matching how Migma publishes its own reset.
        "x-ratelimit-reset": String(result.resetAt)
      };
    },

    get size() {
      return buckets.size;
    },

    stop() {
      clearInterval(sweep);
      buckets.clear();
    }
  };
}
