import { describe, expect, test } from "bun:test";
import { app } from "./index";

describe("GET /health", () => {
  test("returns 200 and { ok: true }", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  test("responds with a secure header set by the hardening middleware", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("does not require a live database, redis, or S3 connection", async () => {
    // Importing ./index above already exercises this: no lib module opens
    // a real connection at import time. This assertion documents the
    // requirement so a future regression fails loudly here too.
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});

describe("default app wiring", () => {
  test("mounts the pipeline under /api with an empty in-memory db", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(typeof body.total).toBe("number");
  });

  test("unknown application is a JSON 404, not a 500", async () => {
    const res = await app.request("/api/applications/APP-404");
    expect(res.status).toBe(404);
  });
});
