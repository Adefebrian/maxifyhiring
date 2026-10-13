import { describe, expect, test } from "bun:test";
import { UNVERIFIED } from "../jev";
import type { Role } from "../shared";
import { route, score, softSignal } from "./router";

const fakeJev = (choice: string, confidence = 0.82) => ({
  apiKey: "test-key",
  retries: 0,
  fetchImpl: (async () =>
    Response.json({ model: "jev-test", answers: { decision: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } } })) as unknown as typeof fetch,
});

const BE: Role = { code: "BE", title: "Backend Engineer", status: "open", mustHave: ["typescript", "postgres", "api design", "testing"], niceToHave: ["bun", "redis", "docker"], minYears: 3, location: "Jakarta", remoteOk: true, hiringManager: "Dimas" };
const OPS: Role = { code: "OPS", title: "Operations Analyst", status: "open", mustHave: ["sql", "excel", "process mapping"], niceToHave: ["python", "looker"], minYears: 2, location: "Surabaya", remoteOk: false, hiringManager: "Sari" };

const strong = { yearsExp: 5, location: "Jakarta", skills: [...BE.mustHave, ...BE.niceToHave] };
const weak = { yearsExp: 0, location: "Medan", skills: [] as string[] };
const borderline = { yearsExp: 3, location: "Bandung", skills: ["typescript", "postgres"] }; // 25 + 25 + 15 = 65

describe("score", () => {
  test("components add up", () => {
    expect(score(strong, BE).total).toBe(100);
    expect(score(weak, OPS).total).toBe(0);
    expect(score(borderline, BE).total).toBe(65);
    expect(softSignal(score(borderline, BE), borderline, BE)).toContain("70");
  });
});

describe("route", () => {
  test("a low-confidence JEV route goes to a person, not to scheduling", async () => {
    const { decision } = await route(borderline, BE, fakeJev("scheduling", 0.18));
    expect(decision).toMatchObject({ decidedBy: "jev", verified: true, decision: "human_review", confidence: 0.18 });
    expect(decision.ruleHits).toContain("JEV_LOW_CONFIDENCE");
    expect(decision.reason).toContain("below the 60% floor");
  });

  test("under the floor JEV abstains even when its pick is human review", async () => {
    const { decision } = await route(borderline, BE, fakeJev("human_review", 0.16));
    expect(decision).toMatchObject({ decidedBy: "jev", decision: "human_review", confidence: 0.16 });
    expect(decision.ruleHits).toContain("JEV_LOW_CONFIDENCE");
    expect(decision.reason).not.toMatch(/human_review|screening_queue|auto_rejected/);
  });

  test("a confident JEV route is acted on", async () => {
    const { decision } = await route(borderline, BE, fakeJev("screening_queue", 0.8));
    expect(decision).toMatchObject({ decidedBy: "jev", decision: "screening_queue" });
  });

  test("clear high band is a rule scheduling decision", async () => {
    const { decision } = await route(strong, BE, { apiKey: "" });
    expect(decision).toMatchObject({ decidedBy: "rule", decision: "scheduling", verified: true, confidence: 1 });
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  test("clear low band is auto_rejected by rule", async () => {
    const { decision } = await route(weak, OPS, { apiKey: "" });
    expect(decision).toMatchObject({ decidedBy: "rule", decision: "auto_rejected" });
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  test("borderline with verified JEV takes JEV's choice", async () => {
    const { decision } = await route(borderline, BE, fakeJev("screening_queue", 0.74));
    expect(decision).toMatchObject({ decidedBy: "jev", decision: "screening_queue", confidence: 0.74, verified: true });
    expect(decision.ruleHits).toContain("SOFT_CALL");
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  test("borderline JEV answer of auto_rejected is refused, falls back to a human", async () => {
    const { decision } = await route(borderline, BE, fakeJev("auto_rejected"));
    expect(decision.decision).toBe("human_review");
    expect(decision.stamp).toBe(UNVERIFIED);
  });

  test("borderline without a key goes to human_review UNVERIFIED BY JEV", async () => {
    const { decision } = await route(borderline, BE, { apiKey: "" });
    expect(decision).toMatchObject({ decidedBy: "rule", decision: "human_review", verified: false, stamp: UNVERIFIED, confidence: null });
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});
