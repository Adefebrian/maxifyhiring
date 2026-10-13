// consumeRateLimit against an in-memory fake Redis: no live Redis needed.
// The regression: INCR then EXPIRE as two commands left a key with no TTL
// whenever EXPIRE failed (or the process died) between them, and that client
// stayed limited forever. Every limiter key must carry a TTL after a call.
import { describe, expect, test } from "bun:test";
import type Redis from "ioredis";
import { consumeRateLimit, RATE_LIMIT_SCRIPT } from "./redis";

type Entry = { value: number; ttl: number }; // ttl -1 means no expiry

class FakeRedis {
  store = new Map<string, Entry>();
  failExpire = false;
  failAll = false;

  private check(): void {
    if (this.failAll) throw new Error("connect ECONNREFUSED");
  }

  async incr(key: string): Promise<number> {
    this.check();
    const entry = this.store.get(key) ?? { value: 0, ttl: -1 };
    entry.value += 1;
    this.store.set(key, entry);
    return entry.value;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.check();
    if (this.failExpire) throw new Error("EXPIRE failed");
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.ttl = seconds;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.check();
    return this.store.get(key)?.ttl ?? -2;
  }

  // Runs the limiter script's contract as one step, like Redis runs a Lua
  // script: INCR, then set the TTL when the key has none. Any other script
  // is a test bug.
  async eval(script: string, numKeys: number, key: string, seconds: number | string): Promise<number> {
    this.check();
    if (script !== RATE_LIMIT_SCRIPT || numKeys !== 1) throw new Error("unexpected script");
    const entry = this.store.get(key) ?? { value: 0, ttl: -1 };
    entry.value += 1;
    if (entry.ttl === -1) entry.ttl = Number(seconds);
    this.store.set(key, entry);
    return entry.value;
  }
}

const asRedis = (fake: FakeRedis) => fake as unknown as Redis;

describe("consumeRateLimit", () => {
  test("the first call leaves the key with the window as its TTL", async () => {
    const fake = new FakeRedis();
    const result = await consumeRateLimit("ratelimit:a", 2, 60, asRedis(fake));
    expect(result).toEqual({ allowed: true, remaining: 1 });
    expect(await fake.ttl("ratelimit:a")).toBe(60);
  });

  test("a key never ends up without a TTL, even when EXPIRE would fail", async () => {
    const fake = new FakeRedis();
    fake.failExpire = true;
    await consumeRateLimit("ratelimit:b", 2, 60, asRedis(fake));
    expect(await fake.ttl("ratelimit:b")).toBeGreaterThan(0);
  });

  test("a key that already lost its TTL is healed on the next call", async () => {
    const fake = new FakeRedis();
    fake.store.set("ratelimit:c", { value: 500, ttl: -1 });
    const result = await consumeRateLimit("ratelimit:c", 120, 60, asRedis(fake));
    expect(result.allowed).toBe(false);
    expect(await fake.ttl("ratelimit:c")).toBe(60);
  });

  test("blocks once the count passes the limit", async () => {
    const fake = new FakeRedis();
    await consumeRateLimit("ratelimit:d", 1, 60, asRedis(fake));
    const result = await consumeRateLimit("ratelimit:d", 1, 60, asRedis(fake));
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  test("fails open when Redis errors", async () => {
    const fake = new FakeRedis();
    fake.failAll = true;
    const result = await consumeRateLimit("ratelimit:e", 5, 60, asRedis(fake));
    expect(result).toEqual({ allowed: true, remaining: 5 });
  });
});
