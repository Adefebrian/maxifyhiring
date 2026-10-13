import { describe, expect, test } from "bun:test";
import { decisionLabel, due, fmtDayTime, leanedTo, owner, queueGroup, sealLabel, sealOf, span, STATE_ORDER, STATE_LABEL, wibDate } from "./format";

describe("format", () => {
  test("shows times in WIB", () => {
    expect(fmtDayTime("2026-10-14T02:00:00.000Z")).toBe("Wed 14 Oct, 09:00");
    expect(wibDate("2026-10-13T18:30:00.000Z")).toBe("2026-10-14");
  });

  test("due is measured against the sim clock, not the browser clock", () => {
    const now = "2026-10-13T01:00:00.000Z";
    expect(due("2026-10-14T02:00:00.000Z", now)).toMatchObject({ overdue: false, label: "Due in 25 h" });
    expect(due("2026-10-12T22:00:00.000Z", now)).toMatchObject({ overdue: true, label: "Overdue by 3 h" });
    expect(due(null, now)).toBeNull();
  });

  test("spans read short", () => {
    expect(span(30 * 60000)).toBe("30 min");
    expect(span(5 * 86_400_000)).toBe("5 d");
  });

  test("owners read as people, agents read as agents", () => {
    expect(owner("recruiter:Rina")).toBe("Rina, recruiter");
    expect(owner("hm:Dimas")).toBe("Dimas, hiring manager");
    expect(owner("agent:scheduler")).toBe("Scheduler agent");
    expect(owner("jev")).toBe("JEV");
  });

  test("every state has a label and a place in the order", () => {
    expect(new Set(STATE_ORDER).size).toBe(15);
    for (const s of STATE_ORDER) expect(STATE_LABEL[s]).toBeTruthy();
  });
});

describe("seals", () => {
  const base = { verified: true, stamp: null, confidence: 1, ruleHits: [] as string[], jev: null as unknown };
  test("a rule row is neutral and deterministic, never verified by JEV", () => {
    expect(sealOf({ ...base, decidedBy: "rule" })).toBe("rule");
    expect(sealLabel({ ...base, decidedBy: "rule" })).toBe("Rule, deterministic");
  });
  test("JEV verified and acted reads as verified", () => {
    expect(sealOf({ ...base, decidedBy: "jev", confidence: 0.69 })).toBe("jev");
  });
  test("JEV under the floor abstains, names the confidence, and what it leaned to", () => {
    const d = { ...base, decidedBy: "jev", confidence: 0.38, ruleHits: ["DUP_SAME_PHONE", "JEV_LOW_CONFIDENCE"], jev: { choice: "mark_duplicate" } };
    expect(sealOf(d)).toBe("abstained");
    expect(sealLabel(d)).toBe("JEV abstained, 38% < 60%, routed to human");
    expect(leanedTo(d)).toBe("Mark duplicate");
  });
  test("JEV choosing a person at or above the floor (no JEV_LOW_CONFIDENCE hit) is routed, neutral, never green", () => {
    const d = { ...base, decidedBy: "jev", decision: "human_review", confidence: 0.64, ruleHits: ["SOFT_CALL"], jev: { probabilities: { scheduling: 0.2, human_review: 0.64 } } };
    expect(sealOf(d)).toBe("routed");
    expect(sealLabel(d)).toBe("JEV routed to human");
  });
  test("JEV choosing a person under the floor carries JEV_LOW_CONFIDENCE and abstains", () => {
    const d = { ...base, decidedBy: "jev", decision: "human_review", confidence: 0.2, ruleHits: ["SOFT_CALL", "JEV_LOW_CONFIDENCE"], jev: { probabilities: { scheduling: 0.3, human_review: 0.47 } } };
    expect(sealOf(d)).toBe("abstained");
  });
  test("decision labels share one sentence casing", () => {
    expect(decisionLabel("mark_duplicate")).toBe("Mark duplicate");
    expect(decisionLabel("no_slot")).toBe("No interview slot");
    expect(decisionLabel("human_review")).toBe("Human review");
  });
  test("a stamped fallback is unverified", () => {
    expect(sealOf({ ...base, decidedBy: "rule", verified: false, stamp: "UNVERIFIED BY JEV" })).toBe("unverified");
  });
});

describe("due urgency and queue groups", () => {
  test("within 4 hours of the sim clock is soon", () => {
    const now = "2026-10-13T01:00:00.000Z";
    expect(due("2026-10-13T04:00:00.000Z", now)?.kind).toBe("soon");
    expect(due("2026-10-13T08:00:00.000Z", now)?.kind).toBe("later");
  });
  test("cases group by why they wait", () => {
    expect(queueGroup({ state: "human_review", match: { id: "APP-004" } })).toBe("duplicate");
    expect(queueGroup({ state: "human_review", ruling: { stage: "schedule", decision: "no_slot" } })).toBe("no_slot");
    expect(queueGroup({ state: "human_review", ruling: { stage: "route", decision: "human_review" } })).toBe("borderline");
    expect(queueGroup({ state: "auto_rejected" })).toBe("rejection");
  });
});
