// Fixed-window rate limiter held in process memory. Enough for a single-process
// prototype; swap for the Redis limiter if this ever runs as several replicas.
const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_KEYS = 10_000;

export function consumeRateLimit(key: string, limit: number, windowSeconds: number, nowMs = Date.now()): { allowed: boolean; remaining: number } {
  let w = windows.get(key);
  if (!w || w.resetAt <= nowMs) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, v] of windows) if (v.resetAt <= nowMs) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    w = { count: 0, resetAt: nowMs + windowSeconds * 1000 };
    windows.set(key, w);
  }
  w.count++;
  return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count) };
}
