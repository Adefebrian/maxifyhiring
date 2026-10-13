// Redis client, lazily constructed. Nothing here connects at import time:
// `new Redis(...)` with `lazyConnect: true` only opens a socket on the first
// command, and every call site that actually issues a command swallows
// connection errors so a missing/unreachable Redis never crashes a request,
// it only disables the feature that needed it (rate limiting fails open).
import Redis from "ioredis";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // never keep retrying in the background
    });
    client.on("error", () => {
      // Swallow: callers already handle rejected commands. This listener
      // only exists so an unhandled 'error' event does not crash the process.
    });
  }
  return client;
}

/**
 * INCR and the window's TTL in one server-side step. Running INCR and EXPIRE
 * as two commands is not atomic: if the process dies or EXPIRE fails between
 * them, the key never expires and that client is limited forever. A Lua
 * script runs as one command on any Redis version, and because it checks TTL
 * on every call (not only when the count is 1) it also heals a key that
 * already lost its expiry. TTL is -1 for a key with no expiry.
 */
export const RATE_LIMIT_SCRIPT = `local count = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) == -1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count`;

/**
 * Fixed-window rate limiter backed by Redis. Returns `{ allowed, remaining }`.
 * Fails open (allowed: true) if Redis is unavailable, never blocks traffic
 * because the cache is down and never throws. `redis` is for tests only.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  redis?: Redis,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const client = redis ?? getRedis();
    const count = Number(await client.eval(RATE_LIMIT_SCRIPT, 1, key, windowSeconds));
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}
