import { describe, expect, test } from "bun:test";
import { due, fmtDayTime, owner, span, STATE_ORDER, STATE_LABEL, wibDate } from "./format";

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
