import { beforeAll, describe, expect, test } from "bun:test";
import { openDb } from "../../core/db";
import { advance, checkInvariants, reset, type PipelineDeps } from ".";

const deps: PipelineDeps = { db: openDb(":memory:"), jev: { apiKey: "" } };
const one = <T>(sql: string, ...p: any[]) => deps.db.query<T, any[]>(sql).get(...p) as T;
const counts = () =>
  Object.fromEntries(deps.db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) AS n FROM applications GROUP BY state").all().map((r) => [r.state, r.n]));

describe("seed snapshot (no JEV key)", () => {
  beforeAll(async () => {
    expect((await reset(deps)).processed).toBe(40);
  });

  test("state counts", () => {
    expect(counts()).toEqual({ invalid: 9, duplicate: 3, human_review: 10, auto_rejected: 2, interview_scheduled: 16 });
  });

  test("every application has a log row and every decision a reason", () => {
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM applications a WHERE NOT EXISTS (SELECT 1 FROM pipeline_log l WHERE l.app_id = a.id)").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM routing_decisions").n).toBeGreaterThan(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM routing_decisions WHERE reason IS NULL OR length(trim(reason)) = 0").n).toBe(0);
  });

  test("without JEV no decision is attributed to jev, and soft calls carry the stamp", () => {
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM routing_decisions WHERE decided_by = 'jev'").n).toBe(0);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM routing_decisions WHERE verified = 0 AND stamp IS NOT 'UNVERIFIED BY JEV'").n).toBe(0);
  });

  test("invariants hold", () => {
    expect(checkInvariants(deps.db).ok).toBe(true);
  });

  test("reset is repeatable", async () => {
    await reset(deps);
    expect(counts().interview_scheduled).toBe(16);
    expect(checkInvariants(deps.db).ok).toBe(true);
  });

  describe("after advancing the clock 72h", () => {
    let res: Awaited<ReturnType<typeof advance>>;
    beforeAll(async () => {
      res = await advance(deps, 72);
    });

    test("held interviews move to awaiting_decision", () => {
      expect(res.done.length).toBeGreaterThan(0);
      expect(counts().awaiting_decision).toBe(res.done.length);
    });

    test("APP-007 (one no-show) is rescheduled once", () => {
      expect(res.noShows).toContain("APP-007");
      const rows = deps.db.query<{ status: string; attempt: number }, []>("SELECT status, attempt FROM interviews WHERE app_id = 'APP-007' ORDER BY attempt").all();
      expect(rows).toEqual([{ status: "no_show", attempt: 1 }, { status: "scheduled", attempt: 2 }]);
      expect(one<{ state: string }>("SELECT state FROM applications WHERE id = 'APP-007'").state).toBe("interview_scheduled");
    });

    test("invariants still hold", () => {
      expect(checkInvariants(deps.db).ok).toBe(true);
    });
  });

  describe("a second no-show", () => {
    test("APP-027 (sim_no_show 2) goes to human_review after attempt 2", async () => {
      const r = await advance(deps, 120);
      expect(r.noShows).toContain("APP-027");
      const rows = deps.db.query<{ status: string; attempt: number }, []>("SELECT status, attempt FROM interviews WHERE app_id = 'APP-027' ORDER BY attempt").all();
      expect(rows).toEqual([{ status: "no_show", attempt: 1 }, { status: "no_show", attempt: 2 }]);
      expect(one<{ state: string }>("SELECT state FROM applications WHERE id = 'APP-027'").state).toBe("human_review");
      expect(checkInvariants(deps.db).ok).toBe(true);
    });
  });
});
