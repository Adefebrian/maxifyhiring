import { describe, expect, test } from "bun:test";
import { findSlot, gridSlots, type Interviewer } from "./slots";

const TUE_0800_WIB = new Date("2026-10-13T01:00:00Z");
const FRI_0800_WIB = new Date("2026-10-16T01:00:00Z");
const wibDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).getUTCDay();
const A: Interviewer = { id: "IV-A", name: "A", roleCodes: ["BE"] };
const base = { now: TUE_0800_WIB, roleCode: "BE", availability: [], interviewers: [A], busy: [], booked: [] };

describe("gridSlots", () => {
  test("first slot respects the 24h lead and the 09:00 WIB grid", () => {
    const s = gridSlots(TUE_0800_WIB);
    expect(s[0]!.start).toBe("2026-10-14T02:00:00.000Z");
    expect(s.every((x) => Date.parse(x.start) >= TUE_0800_WIB.getTime() + 24 * 3_600_000)).toBe(true);
    expect(s.length).toBe(54); // Tue itself counts as a workday but every slot is inside the lead
  });

  test("weekend is skipped", () => {
    const s = gridSlots(FRI_0800_WIB, 3);
    expect(s[0]!.start).toBe("2026-10-19T02:00:00.000Z");
    expect(s.some((x) => [0, 6].includes(wibDay(x.start)))).toBe(false);
  });
});

describe("findSlot", () => {
  test("picks the earliest grid slot", () => {
    expect(findSlot(base)).toEqual({ interviewerId: "IV-A", start: "2026-10-14T02:00:00.000Z", end: "2026-10-14T03:00:00.000Z" });
  });

  test("busy block is respected", () => {
    const pick = findSlot({ ...base, busy: [{ interviewerId: "IV-A", start: "2026-10-14T01:00:00Z", end: "2026-10-14T05:00:00Z" }] });
    expect(pick!.start).toBe("2026-10-14T06:30:00.000Z");
  });

  test("an already booked slot is skipped", () => {
    const pick = findSlot({ ...base, booked: [{ interviewerId: "IV-A", start: "2026-10-14T02:00:00.000Z" }] });
    expect(pick!.start).toBe("2026-10-14T03:15:00.000Z");
  });

  test("candidate availability window is respected", () => {
    const pick = findSlot({ ...base, availability: [{ start: "2026-10-15T06:00:00Z", end: "2026-10-15T08:00:00Z" }] });
    expect(pick!.start).toBe("2026-10-15T06:30:00.000Z");
  });

  test("returns null when nothing fits", () => {
    expect(findSlot({ ...base, availability: [{ start: "2026-10-17T00:00:00Z", end: "2026-10-18T23:00:00Z" }] })).toBeNull();
    expect(findSlot({ ...base, roleCode: "OPS" })).toBeNull();
  });
});
