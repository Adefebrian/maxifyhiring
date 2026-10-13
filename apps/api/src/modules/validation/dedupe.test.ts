import { describe, expect, test } from "bun:test";
import { normalize } from "../intake";
import { UNVERIFIED } from "../jev";
import { findDuplicate, judgeFuzzy, nameSimilarity, type Existing } from "./dedupe";

const existing = (id: string, raw: Record<string, unknown>): Existing => {
  const c = normalize(raw);
  return { id, name: c.name, email: c.email, phone: c.phone, roleCode: c.roleCode, submittedAt: c.submittedAt };
};
const first = existing("APP-001", { full_name: "Muhammad Fauzan", email: "fauzan@gmail.com", phone: "0812-1111-2222", role: "BE", submitted_at: "2026-09-20T00:00:00Z" });

const fakeJev = (choice: string, confidence = 0.82) => ({
  apiKey: "test-key",
  retries: 0,
  fetchImpl: (async () =>
    new Response(JSON.stringify({ model: "jev-test", answers: { decision: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch,
});

describe("findDuplicate", () => {
  test("same email and role with case/space variants is exact", () => {
    const c = existing("APP-002", { full_name: "Someone Else", email: "  FAUZAN@Gmail.com ", phone: "0899-0000-0000", role: "be", submitted_at: "2026-09-25T00:00:00Z" });
    expect(findDuplicate(c, [first])).toEqual({ kind: "exact", of: "APP-001", ruleHits: ["DUP_EXACT_EMAIL_ROLE"] });
  });

  test("same email for a different role is not a duplicate", () => {
    const c = existing("APP-002", { full_name: "Muhammad Fauzan", email: "fauzan@gmail.com", phone: "0812-1111-2222", role: "OPS", submitted_at: "2026-09-25T00:00:00Z" });
    expect(findDuplicate(c, [first]).kind).toBe("none");
  });

  test("same phone, different email is fuzzy", () => {
    const c = existing("APP-002", { full_name: "Budi", email: "budi@yahoo.com", phone: "+62 812 1111 2222", role: "BE", submitted_at: "2026-09-25T00:00:00Z" });
    const m = findDuplicate(c, [first]);
    expect(m.kind).toBe("fuzzy");
    if (m.kind === "fuzzy") {
      expect(m.samePhone).toBe(true);
      expect(m.ruleHits).toContain("DUP_SAME_PHONE");
      expect(m.ruleHits).toContain("MATCHES:APP-001");
    }
  });

  test("near-identical name scores >= 0.9 and is fuzzy", () => {
    expect(nameSimilarity("Muhammad Fauzan", "Muhamad Fauzan")).toBeGreaterThanOrEqual(0.9);
    const c = existing("APP-002", { full_name: "Muhamad Fauzan", email: "m.fauzan@outlook.com", phone: "0813-9999-0000", role: "BE", submitted_at: "2026-09-25T00:00:00Z" });
    expect(findDuplicate(c, [first]).kind).toBe("fuzzy");
  });

  test("more than 90 days apart is not a fuzzy match", () => {
    const c = existing("APP-002", { full_name: "Muhammad Fauzan", email: "other@gmail.com", phone: "0812-1111-2222", role: "BE", submitted_at: "2027-01-05T00:00:00Z" });
    expect(findDuplicate(c, [first]).kind).toBe("none");
  });

  test("an application never matches itself", () => {
    expect(findDuplicate(first, [first]).kind).toBe("none");
  });
});

describe("judgeFuzzy", () => {
  const m = { kind: "fuzzy" as const, of: "APP-001", ruleHits: ["DUP_SAME_PHONE", "MATCHES:APP-001"], similarity: 0.4, samePhone: true, daysApart: 5 };

  test("verified JEV answer is a jev decision with confidence", async () => {
    const d = await judgeFuzzy(m, false, fakeJev("mark_duplicate", 0.9));
    expect(d.decidedBy).toBe("jev");
    expect(d.verified).toBe(true);
    expect(d.decision).toBe("mark_duplicate");
    expect(d.confidence).toBe(0.9);
    expect(d.stamp).toBeNull();
    expect(d.reason.length).toBeGreaterThan(0);
  });

  test("no key falls back to human_review stamped UNVERIFIED BY JEV", async () => {
    const d = await judgeFuzzy(m, false, { apiKey: "" });
    expect(d.decision).toBe("human_review");
    expect(d.verified).toBe(false);
    expect(d.stamp).toBe(UNVERIFIED);
    expect(d.reason).toContain("JEV unavailable");
  });
});
