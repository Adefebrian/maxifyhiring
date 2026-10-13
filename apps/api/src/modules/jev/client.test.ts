import { describe, expect, test } from "bun:test";
import { askChoice, UNVERIFIED } from "./client";

const q = { type: "choice" as const, instructions: "pick", criteria: { a: "A", b: "B" } };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fake(...responses: (Response | Error)[]) {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const opts = (f: ReturnType<typeof fake>, retries = 2) => ({ apiKey: "k", fetchImpl: f.fetchImpl, retries, baseDelayMs: 1 });

describe("askChoice", () => {
  test("parses the real response shape and sends the bearer key", async () => {
    const f = fake(reply({ model: "jev-7", answers: { decision: { type: "choice", choice: "b", confidence: 0.8, probabilities: { a: 0.2, b: 0.8 } } } }));
    const v = await askChoice({ x: 1 }, q, opts(f));
    expect(v).toEqual({ verified: true, model: "jev-7", choice: "b", confidence: 0.8, probabilities: { a: 0.2, b: 0.8 } });
    expect((f.calls[0]!.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  test("missing key never calls fetch", async () => {
    const f = fake(reply({}));
    const v = await askChoice({}, q, { apiKey: "", fetchImpl: f.fetchImpl });
    expect(v).toMatchObject({ verified: false, stamp: UNVERIFIED });
    expect(f.calls.length).toBe(0);
  });

  test("unknown choice and out-of-range confidence are treated as outages", async () => {
    const bad1 = await askChoice({}, q, opts(fake(reply({ answers: { decision: { choice: "c", confidence: 0.9 } } }))));
    const bad2 = await askChoice({}, q, opts(fake(reply({ answers: { decision: { choice: "a", confidence: 7 } } }))));
    expect(bad1).toMatchObject({ verified: false, stamp: UNVERIFIED });
    expect(bad2).toMatchObject({ verified: false, stamp: UNVERIFIED });
  });

  test("retries 503 then succeeds; does not retry 401", async () => {
    const ok = reply({ answers: { decision: { choice: "a", confidence: 0.6 } } });
    const f = fake(reply({}, 503), ok);
    expect((await askChoice({}, q, opts(f))).verified).toBe(true);
    expect(f.calls.length).toBe(2);

    const g = fake(reply({}, 401), ok);
    const v = await askChoice({}, q, opts(g));
    expect(v).toMatchObject({ verified: false, error: "JEV request failed: 401" });
    expect(g.calls.length).toBe(1);
  });

  test("network errors exhaust retries into a typed failure", async () => {
    const f = fake(new TypeError("boom"));
    const v = await askChoice({}, q, opts(f, 1));
    expect(v).toMatchObject({ verified: false, error: "network error" });
    expect(f.calls.length).toBe(2);
  });
});
