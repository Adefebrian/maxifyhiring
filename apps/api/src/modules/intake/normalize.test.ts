import { describe, expect, test } from "bun:test";
import { normalize, normalizePhone } from "./normalize";

describe("normalize", () => {
  test("phone formats all land on +62", () => {
    expect(normalizePhone("0812-3456-7001")).toBe("+6281234567001");
    expect(normalizePhone("+62 812 3456 7001")).toBe("+6281234567001");
    expect(normalizePhone("6285712341003")).toBe("+6285712341003");
    expect(normalizePhone(undefined)).toBeNull();
  });

  test("email is trimmed and lowercased, role uppercased", () => {
    const c = normalize({ email: "  Ayu.Lestari@Gmail.COM ", role: " be " });
    expect(c.email).toBe("ayu.lestari@gmail.com");
    expect(c.roleCode).toBe("BE");
  });

  test("years: numbers and numeric strings parse, words do not", () => {
    expect(normalize({ years_experience: "lima" }).yearsExp).toBeNull();
    expect(normalize({ years_experience: " 4 " }).yearsExp).toBe(4);
    expect(normalize({ years_experience: 2.5 }).yearsExp).toBe(2.5);
  });

  test("skills string splits on comma and semicolon, lowercased and deduped", () => {
    expect(normalize({ skills: "SQL, Excel; Process mapping, sql" }).skills).toEqual(["sql", "excel", "process mapping"]);
  });

  test("availability keeps only well-formed windows", () => {
    const c = normalize({
      availability: [
        { start: "2026-10-14T02:00:00Z", end: "2026-10-14T05:00:00Z" },
        { start: "2026-10-14T05:00:00Z", end: "2026-10-14T02:00:00Z" },
        { start: "nope", end: "2026-10-14T05:00:00Z" },
      ],
    });
    expect(c.availability).toEqual([{ start: "2026-10-14T02:00:00.000Z", end: "2026-10-14T05:00:00.000Z" }]);
  });

  test("never throws on garbage", () => {
    for (const raw of [null, undefined, 42, "x", [], { email: 5, phone: {}, skills: 7 }]) {
      expect(() => normalize(raw)).not.toThrow();
    }
    expect(normalize(null).skills).toEqual([]);
  });
});
