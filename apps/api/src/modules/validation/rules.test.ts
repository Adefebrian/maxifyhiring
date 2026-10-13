import { describe, expect, test } from "bun:test";
import { normalize } from "../intake";
import type { Role } from "../shared";
import { validate } from "./rules";

const role = (code: string, status: "open" | "closed"): Role => ({
  code, title: code, status, mustHave: [], niceToHave: [], minYears: 0, location: "Jakarta", remoteOk: true, hiringManager: "Dimas",
});
const roles = new Map([["BE", role("BE", "open")], ["DS", role("DS", "closed")]]);
const now = new Date("2026-10-13T01:00:00Z");

const base = {
  full_name: "Ayu Lestari",
  email: "ayu.lestari@gmail.com",
  phone: "0812-3456-7001",
  role: "BE",
  years_experience: 5,
  cv_text: "Five years building payment APIs in TypeScript on Postgres.",
  consent: true,
  submitted_at: "2026-09-20T03:10:00Z",
};
const codes = (patch: Record<string, unknown>) => validate(normalize({ ...base, ...patch }), roles, now).map((e) => e.code);

describe("validate", () => {
  test("a fully valid record has no errors", () => {
    expect(validate(normalize(base), roles, now)).toEqual([]);
  });

  test.each([
    ["REQUIRED_NAME", { full_name: "  " }],
    ["NAME_INVALID", { full_name: "<script>x</script>" }],
    ["REQUIRED_EMAIL", { email: undefined }],
    ["EMAIL_FORMAT", { email: "ayu.lestari@gmail" }],
    ["REQUIRED_PHONE", { phone: "" }],
    ["PHONE_FORMAT", { phone: "12345" }],
    ["REQUIRED_ROLE", { role: null }],
    ["ROLE_UNKNOWN", { role: "CEO" }],
    ["ROLE_CLOSED", { role: "DS" }],
    ["EXPERIENCE_INVALID", { years_experience: "lima" }],
    ["CV_MISSING", { cv_text: "short" }],
    ["CONSENT_MISSING", { consent: false }],
    ["SUBMITTED_INVALID", { submitted_at: "kemarin" }],
    ["SUBMITTED_IN_FUTURE", { submitted_at: "2027-01-01T00:00:00Z" }],
  ] as const)("%s", (code, patch) => {
    expect(codes(patch)).toEqual([code]);
  });

  test("experience outside 0..50 is invalid", () => {
    expect(codes({ years_experience: 60 })).toEqual(["EXPERIENCE_INVALID"]);
  });

  test("every error carries a field and message", () => {
    for (const e of validate(normalize({}), roles, now)) {
      expect(e.field.length).toBeGreaterThan(0);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});
