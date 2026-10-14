// Reliability pass, one describe per failure type (F1 to F8). Every scenario
// ends by asserting the pipeline invariants on the database it used.
import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../core/app";
import {
  advance,
  checkInvariants,
  decide,
  getApp,
  IllegalTransition,
  intake,
  reset,
  runAll,
  seedReference,
  transition,
  type PipelineDeps,
} from "../modules/pipeline";
import { stepSchedule } from "../modules/pipeline/runner";
import { findSlot, gridSlots } from "../modules/scheduling";
import { crashOn, fakeFetch, fakeSummarizer, makeDeps, type FetchImpl } from "./faults";

// ---------------------------------------------------------------- helpers

const used: Database[] = [];
function deps(opts: Parameters<typeof makeDeps>[0] = {}): PipelineDeps {
  const d = makeDeps(opts);
  used.push(d.db);
  return d;
}

afterEach(() => {
  for (const db of used.splice(0)) {
    const r = checkInvariants(db);
    const failed = r.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(r.ok).toBe(true);
  }
});

const AUTOMATED_LEFT = ["received", "validating", "valid", "scheduling"];

type DecisionRow = { app_id: string; stage: string; decided_by: string; verified: number; stamp: string | null; decision: string; reason: string; rule_hits: string; jev: string | null };

const count = (db: Database, sql: string, params: Record<string, string> = {}) => db.query<{ n: number }, any>(sql).get(params)!.n;
const states = (db: Database) => Object.fromEntries(db.query<{ id: string; state: string }, []>("SELECT id, state FROM applications ORDER BY id").all().map((r) => [r.id, r.state]));
const decisions = (db: Database) => db.query<DecisionRow, []>("SELECT * FROM routing_decisions ORDER BY id").all();
/** Decisions where JEV was (or should have been) consulted. */
const softDecisions = (db: Database) =>
  decisions(db).filter((d) => (d.stage === "route" && d.rule_hits.includes("SOFT_CALL")) || (d.stage === "dedupe" && !d.rule_hits.includes("DUP_EXACT_EMAIL_ROLE")));
const logCount = (db: Database, id?: string) =>
  id ? count(db, "SELECT COUNT(*) AS n FROM pipeline_log WHERE app_id = $id", { id }) : count(db, "SELECT COUNT(*) AS n FROM pipeline_log");

function expectFinished(db: Database, total = 40) {
  expect(count(db, "SELECT COUNT(*) AS n FROM applications")).toBe(total);
  const stuck = db.query<{ id: string }, []>(`SELECT id FROM applications WHERE state IN (${AUTOMATED_LEFT.map((s) => `'${s}'`).join(",")})`).all();
  expect(stuck).toEqual([]);
}

let seq = 0;
// Pairwise far apart, so two helper applicants never look like a fuzzy name match.
const NAMES = ["Andi Saputra", "Bella Kurniawati", "Cahyo Ramadhan", "Dina Marlina", "Eka Wibowo", "Fitri Handayani", "Gilang Permana", "Hana Susanti", "Irfan Hakim", "Joko Widodo", "Kartika Sari", "Lukman Hidayat", "Maya Anggraini", "Nanda Pratama", "Oki Setiawan", "Putri Ayuningtyas", "Rizal Fauzi", "Sinta Dewi", "Teguh Santoso", "Umi Kalsum", "Vino Bastian", "Wulan Guritno", "Yusuf Mansur", "Zahra Aulia"];
/** A clean, clearly strong BE applicant. Every call is a different person unless overridden. */
function applicant(over: Record<string, unknown> = {}) {
  seq++;
  return {
    ref: `REL-${seq}`,
    full_name: NAMES[seq % NAMES.length],
    email: `rel${seq}@example.com`,
    phone: `0813${String(70000000 + seq).padStart(8, "0")}`,
    role: "BE",
    years_experience: 5,
    location: "Jakarta",
    skills: ["TypeScript", "Postgres", "API design", "Testing", "Bun"],
    cv_text: "Five years building payment APIs in TypeScript on Postgres, owns the test suite.",
    consent: true,
    submitted_at: "2026-10-01T03:00:00Z",
    availability: [],
    ...over,
  };
}

async function referenceOnly(opts: Parameters<typeof makeDeps>[0] = {}) {
  const d = deps(opts);
  await seedReference(d.db);
  return d;
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Baseline: the seed with JEV unreachable (missing key). Soft calls fall back. */
let fallbackBaseline: Record<string, string> | null = null;
async function baseline() {
  if (!fallbackBaseline) {
    const d = makeDeps();
    await reset(d);
    fallbackBaseline = states(d.db);
  }
  return fallbackBaseline;
}

// ---------------------------------------------------------------- F1

describe("F1 JEV unavailable: soft calls fall back, pipeline finishes", () => {
  const cases: [string, () => { fetch?: FetchImpl; apiKey?: string }, RegExp, number | null][] = [
    ["missing JEV_API_KEY", () => ({ apiKey: "" }), /^missing JEV_API_KEY$/, 0],
    ["timeout", () => ({ fetch: fakeFetch.timeout() }), /^request timed out$/, 3],
    ["HTTP 500", () => ({ fetch: fakeFetch.status(500) }), /^JEV request failed: 500$/, 3],
    ["429 burst exhausting retries", () => ({ fetch: fakeFetch.rateLimited() }), /^JEV request failed: 429$/, 3],
    ["network error", () => ({ fetch: fakeFetch.network() }), /^network error$/, 3],
    ["401 is not retried", () => ({ fetch: fakeFetch.status(401) }), /^JEV request failed: 401$/, 1],
  ];

  for (const [name, make, error, attemptsPerCall] of cases) {
    test(`${name}: every soft call is UNVERIFIED BY JEV with a fallback reason, all 40 seed apps finish`, async () => {
      const opts = make();
      const d = deps(opts);
      await reset(d);
      expectFinished(d.db);

      const soft = softDecisions(d.db);
      expect(soft.length).toBeGreaterThan(0);
      for (const s of soft) {
        expect(s.verified).toBe(0);
        expect(s.stamp).toBe("UNVERIFIED BY JEV");
        expect(s.decided_by).toBe("rule");
        expect(s.decision).toBe("human_review");
        expect(s.reason).toMatch(/JEV unavailable/);
        expect(s.reason).toMatch(/fallback/);
        expect(JSON.parse(s.jev!).error).toMatch(error);
      }
      if (opts.fetch && attemptsPerCall !== null) expect((opts.fetch as any).calls).toBe(soft.length * attemptsPerCall);
      expect(states(d.db)).toEqual(await baseline());
    });
  }

  test("a 429 burst shorter than the retry budget recovers to a verified JEV answer", async () => {
    const f = fakeFetch.burstThenOk(2, (o) => (o.includes("keep_both") ? "keep_both" : "screening_queue"));
    const d = deps({ fetch: f });
    await reset(d);
    expectFinished(d.db);
    const soft = softDecisions(d.db);
    expect(soft.length).toBeGreaterThan(0);
    // Only the first soft call paid for the burst; it and every later call are verified.
    expect(soft.every((s) => s.verified === 1 && s.decided_by === "jev" && s.stamp === null)).toBe(true);
    expect(f.calls).toBe(soft.length + 2);
  });
});

// ---------------------------------------------------------------- F2

describe("F2 JEV bad answer: treated exactly like an outage", () => {
  const cases: [string, () => FetchImpl, RegExp][] = [
    ["200 with an unknown choice", () => fakeFetch.unknownChoice(), /^malformed answer: unknown choice "auto_rejected"$/],
    ["200 with no answers", () => fakeFetch.missingAnswers(), /^malformed answer: /],
    ["confidence NaN", () => fakeFetch.confidence(Number.NaN), /^malformed answer: confidence/],
    ["confidence 1.7", () => fakeFetch.confidence(1.7), /^malformed answer: confidence/],
    ["confidence -0.1", () => fakeFetch.confidence(-0.1), /^malformed answer: confidence/],
    ["non-JSON body", () => fakeFetch.invalidJson(), /^invalid JSON response$/],
  ];

  for (const [name, make, error] of cases) {
    test(`${name}: fallback, error recorded in decision.jev.error`, async () => {
      const d = deps({ fetch: make() });
      await reset(d);
      expectFinished(d.db);
      const soft = softDecisions(d.db);
      expect(soft.length).toBeGreaterThan(0);
      for (const s of soft) {
        expect(s.verified).toBe(0);
        expect(s.stamp).toBe("UNVERIFIED BY JEV");
        expect(s.decision).toBe("human_review");
        expect(JSON.parse(s.jev!).error).toMatch(error);
      }
      expect(states(d.db)).toEqual(await baseline());
    });
  }
});

// ---------------------------------------------------------------- F3

describe("F3 malformed intake over HTTP: never a 500", () => {
  test("invalid JSON, array, null and scalar bodies are 400", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    for (const body of ["{not json", "[1,2,3]", "[]", "null", "42", '"text"', ""]) {
      const res = await post(app, "/api/applications", body);
      expect(res.status).toBe(400);
    }
    expect(count(d.db, "SELECT COUNT(*) AS n FROM applications")).toBe(0);
  });

  test("wrong types are stored as invalid with codes", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    const res = await post(app, "/api/applications", {
      full_name: { first: "A" },
      email: 12,
      phone: ["0812"],
      role: true,
      years_experience: "lots",
      skills: { a: 1 },
      cv_text: null,
      consent: "maybe",
      submitted_at: 99,
      availability: "monday",
    });
    expect(res.status).toBe(201);
    const { app: a } = (await res.json()) as { app: { id: string; state: string } };
    expect(a.state).toBe("invalid");
    const codes = d.db.query<{ code: string }, { id: string }>("SELECT code FROM validation_errors WHERE app_id = $id").all({ id: a.id }).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["REQUIRED_NAME", "EMAIL_FORMAT", "REQUIRED_ROLE", "EXPERIENCE_INVALID", "CV_MISSING", "CONSENT_MISSING", "SUBMITTED_INVALID"]));
  });

  test("a body over 1 MB with Content-Length is 413", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    const big = JSON.stringify(applicant({ cv_text: "x".repeat(1_100_000) }));
    const res = await post(app, "/api/applications", big, { "Content-Length": String(big.length) });
    expect(res.status).toBe(413);
    expect(count(d.db, "SELECT COUNT(*) AS n FROM applications")).toBe(0);
  });

  test("a body over 1 MB without Content-Length is handled gracefully", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    const res = await post(app, "/api/applications", JSON.stringify(applicant({ cv_text: "x".repeat(1_100_000) })));
    expect([201, 400, 413]).toContain(res.status);
  });

  test("a large but legal payload (30 KB CV) is processed, and its detail page and the batch rerun still work", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    const res = await post(app, "/api/applications", applicant({ cv_text: "Built payment APIs in TypeScript. ".repeat(900) }));
    expect(res.status).toBe(201);
    const { app: a } = (await res.json()) as { app: { id: string; state: string } };
    expect(AUTOMATED_LEFT).not.toContain(a.state);
    const detail = await app.request(`/api/applications/${a.id}`);
    expect(detail.status).toBe(200);
    const run = await post(app, "/api/pipeline/run", {});
    expect(run.status).toBe(200);
  });

  test("markup, emoji-only and blank names are invalid; unicode names are valid", async () => {
    const d = await referenceOnly();
    const app = createApp(d);
    const bad = ["<script>alert(1)</script>", "\u{1F600}\u{1F680}", "   ", "12345"];
    for (const name of bad) {
      const res = await post(app, "/api/applications", applicant({ full_name: name }));
      expect(res.status).toBe(201);
      const { app: a } = (await res.json()) as { app: { id: string; state: string } };
      expect(a.state).toBe("invalid");
      const codes = d.db.query<{ code: string }, { id: string }>("SELECT code FROM validation_errors WHERE app_id = $id").all({ id: a.id }).map((r) => r.code);
      expect(codes.some((c) => c === "NAME_INVALID" || c === "REQUIRED_NAME")).toBe(true);
    }
    for (const name of ["Siti Nurhaliza", "Nguyễn Văn An", "José María", "O'Brien-Smith"]) {
      const res = await post(app, "/api/applications", applicant({ full_name: name }));
      expect(res.status).toBe(201);
      const { app: a } = (await res.json()) as { app: { state: string } };
      expect(a.state).not.toBe("invalid");
    }
  });

  test("two different people with non-Latin names are not flagged as possible duplicates", async () => {
    // JEV that always says "same person": the worst case if dedupe wrongly fires.
    const d = await referenceOnly({ fetch: fakeFetch.ok((o) => (o.includes("mark_duplicate") ? "mark_duplicate" : o[0]!)) });
    const app = createApp(d);
    const people = ["李小龍", "王小明", "Иван Петров", "محمد علي"];
    const ids: string[] = [];
    for (const name of people) {
      const res = await post(app, "/api/applications", applicant({ full_name: name }));
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { app: { id: string } }).app.id);
    }
    for (const id of ids) {
      const a = getApp(d.db, id)!;
      expect(a.state).not.toBe("duplicate");
      expect(a.duplicate_of).toBeNull();
      expect(count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions WHERE app_id = $id AND stage = 'dedupe'", { id })).toBe(0);
    }
  });
});

// ---------------------------------------------------------------- F4

describe("F4 duplicate race", () => {
  test("the same application POSTed 20x concurrently: exactly 1 primary, 19 duplicates of it", async () => {
    const d = await referenceOnly({ fetch: fakeFetch.ok(undefined, 5) });
    const app = createApp(d);
    const body = applicant();
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(app, "/api/applications", body)));
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
    const rows = d.db.query<{ id: string; state: string; is_primary: number; duplicate_of: string | null }, []>("SELECT id, state, is_primary, duplicate_of FROM applications").all();
    expect(rows.length).toBe(20);
    const primary = rows.filter((r) => r.is_primary === 1 && r.state !== "duplicate");
    expect(primary.length).toBe(1);
    const dups = rows.filter((r) => r.state === "duplicate");
    expect(dups.length).toBe(19);
    expect(dups.every((r) => r.duplicate_of === primary[0]!.id && r.is_primary === 0)).toBe(true);
  });

  test("pipeline-level race: two same-email apps both waiting on a slow fuzzy JEV call, the loser links to the winner", async () => {
    const f = fakeFetch.ok((o) => (o.includes("keep_both") ? "keep_both" : "scheduling"), 15);
    const d = await referenceOnly({ fetch: f });
    // P is primary; A and B share P's phone (fuzzy match) and each other's email.
    const p = await intake(d, applicant({ phone: "081399990000", full_name: "Primary Person" }));
    expect(p.is_primary).toBe(1);
    const twin = { phone: "081399990000", email: "twin@example.com", full_name: "Twin Applicant" };
    const [a, b] = await Promise.all([intake(d, applicant(twin)), intake(d, applicant(twin))]);
    const pair = [getApp(d.db, a.id)!, getApp(d.db, b.id)!];
    const winners = pair.filter((x) => x.is_primary === 1);
    const losers = pair.filter((x) => x.state === "duplicate");
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0]!.duplicate_of).toBe(winners[0]!.id);
    const last = d.db.query<{ rule_hits: string }, { id: string }>("SELECT rule_hits FROM routing_decisions WHERE app_id = $id ORDER BY id DESC LIMIT 1").get({ id: losers[0]!.id })!;
    expect(JSON.parse(last.rule_hits)).toContain("DUP_RACE");
  });
});

// ---------------------------------------------------------------- F5

/** Wraps the db so `hook` runs once, right before the first transaction opens: "another scheduler committed in between". */
function interleaveBeforeFirstTransaction(db: Database, hook: () => void): Database {
  let fired = false;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "transaction") {
        return (fn: (...a: unknown[]) => unknown) => {
          const t = target.transaction(fn);
          return (...args: unknown[]) => {
            if (!fired) {
              fired = true;
              hook();
            }
            return t(...args);
          };
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("F5 scheduling conflict", () => {
  test("a competing booking lands between findSlot and insert: no double-booking, loser takes the next slot", async () => {
    // Park X and Y in scheduling (a crash right at booking), then let Y's
    // scheduler commit in the gap between X's findSlot and X's insert.
    const d = await referenceOnly({ faults: crashOn({ to: "interview_scheduled", times: 2 }) });
    await expect(intake(d, applicant())).rejects.toThrow(/injected crash/);
    await expect(intake(d, applicant())).rejects.toThrow(/injected crash/);
    d.faults = undefined;
    const [x, y] = d.db.query<{ id: string }, []>("SELECT id FROM applications ORDER BY id").all().map((r) => getApp(d.db, r.id)!);
    expect([x!.state, y!.state]).toEqual(["scheduling", "scheduling"]);

    const raced = interleaveBeforeFirstTransaction(d.db, () => stepSchedule(d, y!));
    stepSchedule({ ...d, db: raced }, x!);

    const slot = (id: string) => d.db.query<{ k: string }, { id: string }>("SELECT interviewer_id || '|' || start AS k FROM interviews WHERE app_id = $id AND status = 'scheduled'").all({ id }).map((r) => r.k);
    expect(slot(x!.id).length).toBe(1);
    expect(slot(y!.id).length).toBe(1);
    expect(slot(x!.id)[0]).not.toBe(slot(y!.id)[0]);
    expect(getApp(d.db, x!.id)!.state).toBe("interview_scheduled");
    expect(getApp(d.db, y!.id)!.state).toBe("interview_scheduled");
    const hits = (id: string) => JSON.parse(d.db.query<{ rule_hits: string }, { id: string }>("SELECT rule_hits FROM routing_decisions WHERE app_id = $id ORDER BY id DESC LIMIT 1").get({ id })!.rule_hits);
    expect(hits(x!.id)).toContain("SLOT_RACE_RETRY");
    expect(hits(y!.id)).toContain("FIRST_PICK");
  });

  test("a stale booked list cannot double-book: the unique slot index forces a retry", async () => {
    const d = await referenceOnly();
    const first = await intake(d, applicant());
    const second = await intake(d, applicant());
    const s1 = d.db.query<{ interviewer_id: string; start: string }, { id: string }>("SELECT interviewer_id, start FROM interviews WHERE app_id = $id").get({ id: first.id })!;
    const s2 = d.db.query<{ interviewer_id: string; start: string }, { id: string }>("SELECT interviewer_id, start FROM interviews WHERE app_id = $id").get({ id: second.id })!;
    expect(`${s1.interviewer_id}|${s1.start}`).not.toBe(`${s2.interviewer_id}|${s2.start}`);
  });

  test("every calendar full: human_review with a no-slot reason", async () => {
    const d = deps();
    await seedReference(d.db);
    for (const iv of ["IV-1", "IV-2", "IV-3", "IV-4", "IV-5", "IV-6"]) {
      d.db.query('INSERT INTO busy_blocks (interviewer_id, start, "end", label) VALUES ($iv, $s, $e, $l)').run({ iv, s: "2026-10-01T00:00:00Z", e: "2026-12-31T00:00:00Z", l: "fully booked" });
    }
    const a = await intake(d, applicant());
    expect(a.state).toBe("human_review");
    const last = d.db.query<{ decision: string; reason: string }, { id: string }>("SELECT decision, reason FROM routing_decisions WHERE app_id = $id ORDER BY id DESC LIMIT 1").get({ id: a.id })!;
    expect(last.decision).toBe("no_slot");
    expect(last.reason).toContain("No interview slot");
    expect(count(d.db, "SELECT COUNT(*) AS n FROM interviews")).toBe(0);
  });

  test("slot grid edges: 16:00 WIB is the last start, nothing at 17:00, weekends skipped, 24h lead", () => {
    // Friday 10 Oct 2026, 09:00 WIB.
    const now = new Date("2026-10-10T02:00:00Z");
    const slots = gridSlots(now, 10);
    const wib = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000);
    const starts = new Set(slots.map((s) => wib(s.start).toISOString().slice(11, 16)));
    expect([...starts].sort()).toEqual(["09:00", "10:15", "11:30", "13:30", "14:45", "16:00"]);
    for (const s of slots) {
      const w = wib(s.start);
      expect([0, 6]).not.toContain(w.getUTCDay());
      expect(w.getUTCHours() * 60 + w.getUTCMinutes()).toBeLessThanOrEqual(16 * 60);
      expect(Date.parse(s.end) - Date.parse(s.start)).toBe(3_600_000);
      expect(Date.parse(s.start)).toBeGreaterThanOrEqual(now.getTime() + 24 * 3_600_000);
    }
    // Friday's slots are inside the lead; Monday is the first day.
    expect(wib(slots[0]!.start).toISOString().slice(0, 16)).toBe("2026-10-12T09:00");
    expect(slots.length).toBe(60);

    const iv = [{ id: "IV-X", name: "X", roleCodes: ["BE"] }];
    const day = (h: string) => `2026-10-12T${h}:00+07:00`;
    // Availability ending exactly at 17:00 fits the 16:00 slot; ending 16:59 does not.
    expect(findSlot({ now, roleCode: "BE", availability: [{ start: day("16:00"), end: day("17:00") }], interviewers: iv, busy: [], booked: [] })?.start).toBe(new Date(day("16:00")).toISOString());
    expect(findSlot({ now, roleCode: "BE", availability: [{ start: day("16:00"), end: day("16:59") }], interviewers: iv, busy: [], booked: [] })).toBeNull();
    // A Saturday-only window never matches.
    expect(findSlot({ now, roleCode: "BE", availability: [{ start: "2026-10-17T00:00:00+07:00", end: "2026-10-18T23:59:00+07:00" }], interviewers: iv, busy: [], booked: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------- F6

describe("F6 crash mid-pipeline", () => {
  test("a crash between state update and log write rolls back; rerun completes and is idempotent", async () => {
    const crash = crashOn({ to: "valid" });
    const d = await referenceOnly({ faults: crash });
    let id = "";
    await expect(
      (async () => {
        const raw = applicant();
        try {
          await intake(d, raw);
        } finally {
          id = d.db.query<{ id: string }, []>("SELECT id FROM applications ORDER BY id DESC LIMIT 1").get()!.id;
        }
      })(),
    ).rejects.toThrow(/injected crash/);
    expect(crash.fired).toBe(1);
    const a = getApp(d.db, id)!;
    expect(a.state).toBe("validating");
    expect(a.is_primary).toBe(0);
    expect(logCount(d.db, id)).toBe(2);
    expect(count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions WHERE app_id = $id", { id })).toBe(0);

    d.faults = undefined;
    expect(await runAll(d)).toBe(1);
    expect(getApp(d.db, id)!.state).toBe("interview_scheduled");
    const logs = logCount(d.db);
    const decs = count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions");
    expect(await runAll(d)).toBe(0);
    expect(logCount(d.db)).toBe(logs);
    expect(count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions")).toBe(decs);
  });

  test("a crash while booking leaves no orphan interview row", async () => {
    const d = await referenceOnly({ faults: crashOn({ to: "interview_scheduled" }) });
    await expect(intake(d, applicant())).rejects.toThrow(/injected crash/);
    const id = d.db.query<{ id: string }, []>("SELECT id FROM applications").get()!.id;
    expect(getApp(d.db, id)!.state).toBe("scheduling");
    expect(count(d.db, "SELECT COUNT(*) AS n FROM interviews")).toBe(0);
    d.faults = undefined;
    await runAll(d);
    expect(getApp(d.db, id)!.state).toBe("interview_scheduled");
    expect(count(d.db, "SELECT COUNT(*) AS n FROM interviews")).toBe(1);
  });

  test("seed batch with crashes, then POST /api/pipeline/run: all 40 finish, second run resumes nothing", async () => {
    const crash = crashOn({ times: 6 });
    const d = await referenceOnly({ faults: crash });
    const app = createApp(d);
    const { seedApplications } = await import("../modules/pipeline/seed");
    const raws = ((await seedApplications()) as { submitted_at?: string }[]).sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")));
    let failures = 0;
    for (const raw of raws) {
      const res = await post(app, "/api/applications", raw);
      if (res.status === 500) failures++;
      else expect(res.status).toBe(201);
    }
    expect(failures).toBe(6);
    d.faults = undefined;
    const r1 = (await (await post(app, "/api/pipeline/run", {})).json()) as { resumed: number; invariants: { ok: boolean } };
    expect(r1.resumed).toBe(6);
    expect(r1.invariants.ok).toBe(true);
    expectFinished(d.db);
    const logs = logCount(d.db);
    const r2 = (await (await post(app, "/api/pipeline/run", {})).json()) as { resumed: number };
    expect(r2.resumed).toBe(0);
    expect(logCount(d.db)).toBe(logs);
    // Recovery may change which twin is primary (a crashed earlier app resumes
    // after its later twin). The audit reason must still tell the truth about
    // submission order.
    const dupReasons = d.db
      .query<{ id: string; reason: string; mine: string; theirs: string }, []>(
        `SELECT a.id, r.reason, a.submitted_at AS mine, p.submitted_at AS theirs FROM routing_decisions r
         JOIN applications a ON a.id = r.app_id JOIN applications p ON p.id = a.duplicate_of
         WHERE r.stage = 'dedupe' AND r.rule_hits LIKE '%DUP_EXACT_EMAIL_ROLE%'`,
      )
      .all();
    expect(dupReasons.length).toBeGreaterThan(0);
    for (const r of dupReasons) {
      if (r.reason.includes("submitted first")) expect(Date.parse(r.theirs)).toBeLessThanOrEqual(Date.parse(r.mine));
    }
  });

  test("a crash while the sim clock runs an interview rolls back the interview status too", async () => {
    const d = await referenceOnly();
    const a = await intake(d, applicant());
    d.faults = crashOn({ to: "interview_done" });
    await expect(advance(d, 24 * 14)).rejects.toThrow(/injected crash/);
    expect(getApp(d.db, a.id)!.state).toBe("interview_scheduled");
    expect(count(d.db, "SELECT COUNT(*) AS n FROM interviews WHERE app_id = $id AND status = 'scheduled'", { id: a.id })).toBe(1);
    d.faults = undefined;
    await advance(d, 0);
    expect(getApp(d.db, a.id)!.state).toBe("awaiting_decision");
  });
});

// ---------------------------------------------------------------- F7

describe("F7 illegal transitions and bad human input", () => {
  const decision = (app: ReturnType<typeof createApp>, id: string, body: unknown) => post(app, `/api/decisions/${id}`, body);

  test("decisions on received and invalid apps are 409; nothing is written", async () => {
    const d = await referenceOnly({ faults: crashOn({ to: "validating" }) });
    const app = createApp(d);
    expect((await post(app, "/api/applications", applicant())).status).toBe(500);
    const received = d.db.query<{ id: string }, []>("SELECT id FROM applications WHERE state = 'received'").get()!.id;
    d.faults = undefined;
    const invalid = (await intake(d, applicant({ email: "nope" }))).id;
    expect(getApp(d.db, invalid)!.state).toBe("invalid");
    for (const id of [received, invalid]) {
      const before = logCount(d.db, id);
      for (const action of ["reject", "offer", "schedule", "keep_both"]) {
        const res = await decision(app, id, { action, reason: "Recruiter decided after a call." });
        expect(res.status).toBe(409);
      }
      expect(logCount(d.db, id)).toBe(before);
    }
    // Leave the received app finished for the invariant check.
    await runAll(d);
  });

  test("empty, blank or 3-char reasons, unknown actions and bad bodies are 400; unknown id is 404", async () => {
    const d = deps();
    await reset(d);
    const app = createApp(d);
    const id = d.db.query<{ id: string }, []>("SELECT id FROM applications WHERE state = 'human_review' ORDER BY id LIMIT 1").get()!.id;
    const before = logCount(d.db, id);
    for (const body of [
      { action: "reject", reason: "" },
      { action: "reject", reason: "     " },
      { action: "reject", reason: "abc" },
      { action: "reject", reason: " ab \n " },
      { action: "fire_them", reason: "Because I said so." },
      { action: "reject" },
      { reason: "Missing the action." },
      { action: "reject", reason: 12345 },
      [],
    ]) {
      expect((await decision(app, id, body)).status).toBe(400);
    }
    expect((await decision(app, id, "{bad json")).status).toBe(400);
    expect((await decision(app, "APP-999", { action: "reject", reason: "Not a fit for the role." })).status).toBe(404);
    expect(logCount(d.db, id)).toBe(before);
  });

  test("an identical double submit is idempotent (sequential and concurrent): one log row, one decision", async () => {
    const d = deps();
    await reset(d);
    const app = createApp(d);
    const [a, b] = d.db.query<{ id: string }, []>("SELECT id FROM applications WHERE state = 'human_review' ORDER BY id LIMIT 2").all().map((r) => r.id);
    const body = { action: "reject", reason: "Experience does not match the role.", actor: "rina" };

    const before = logCount(d.db, a!);
    const r1 = await decision(app, a!, body);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { idempotent: boolean }).idempotent).toBe(false);
    const r2 = await decision(app, a!, body);
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { idempotent: boolean }).idempotent).toBe(true);
    expect(logCount(d.db, a!)).toBe(before + 1);
    expect(count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions WHERE app_id = $id AND decided_by = 'human'", { id: a! })).toBe(1);
    // A different reason is a new decision, and it is not allowed any more.
    expect((await decision(app, a!, { ...body, reason: "Another reason entirely." })).status).toBe(409);

    const beforeB = logCount(d.db, b!);
    const both = await Promise.all([decision(app, b!, body), decision(app, b!, body)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(logCount(d.db, b!)).toBe(beforeB + 1);
  });

  test("direct illegal transition() throws IllegalTransition and writes nothing", async () => {
    const d = await referenceOnly();
    const a = await intake(d, applicant());
    const logs = logCount(d.db);
    const decs = count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions");
    for (const to of ["offer", "received", "valid", "duplicate"] as const) {
      expect(() =>
        transition(d.db, a.id, {
          to,
          owner: "x",
          nextAction: "x",
          due: null,
          actor: "test",
          decision: { stage: "human", decidedBy: "human", verified: true, stamp: null, decision: to, confidence: null, reason: "should never land", ruleHits: [], jev: null },
        }),
      ).toThrow(IllegalTransition);
    }
    expect(getApp(d.db, a.id)!.state).toBe("interview_scheduled");
    expect(logCount(d.db)).toBe(logs);
    expect(count(d.db, "SELECT COUNT(*) AS n FROM routing_decisions")).toBe(decs);
  });

  test("keep_both on a second same-email dedupe review is a 409, never a 500", async () => {
    // JEV down: both twins fall back to a dedupe review against P.
    const d = await referenceOnly();
    const app = createApp(d);
    await intake(d, applicant({ phone: "081399990001", full_name: "Primary Person" }));
    const twin = { phone: "081399990001", email: "twin2@example.com", full_name: "Twin Applicant" };
    const a = await intake(d, applicant(twin));
    const b = await intake(d, applicant(twin));
    expect([a.state, b.state]).toEqual(["human_review", "human_review"]);
    const ok = await decision(app, a.id, { action: "keep_both", reason: "Different person, checked by phone." });
    expect(ok.status).toBe(200);
    const before = logCount(d.db, b.id);
    const clash = await decision(app, b.id, { action: "keep_both", reason: "Different person, checked by phone." });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toContain(a.id);
    expect(getApp(d.db, b.id)!.state).toBe("human_review");
    expect(logCount(d.db, b.id)).toBe(before);
  });
});

// ---------------------------------------------------------------- F8

describe("F8 LLM summary failure never changes routing", () => {
  const routing = (db: Database) =>
    decisions(db).map((d) => ({ app: d.app_id, stage: d.stage, by: d.decided_by, decision: d.decision, reason: d.reason }));

  let noLlm: ReturnType<typeof routing> | null = null;
  async function noLlmRouting() {
    if (!noLlm) {
      const d = makeDeps();
      await reset(d);
      noLlm = routing(d.db);
    }
    return noLlm;
  }

  const cases: [string, Parameters<typeof makeDeps>[0]][] = [
    ["summarize throws", { summarize: fakeSummarizer.throws }],
    ["summarize throws synchronously", { summarize: fakeSummarizer.throwsSync }],
    ["summarize never resolves", { summarize: fakeSummarizer.hangs, summaryTimeoutMs: 20 }],
    ["summarize returns a number", { summarize: fakeSummarizer.garbage(42) }],
    ["summarize returns an object", { summarize: fakeSummarizer.garbage({ text: "x" }) }],
    ["summarize returns undefined", { summarize: fakeSummarizer.garbage(undefined) }],
    ["summarize returns control characters only", { summarize: fakeSummarizer.garbage("\u0000\u0001\u001f  ") }],
  ];

  for (const [name, opts] of cases) {
    test(`${name}: summary_status failed, routing identical to the no-LLM run`, async () => {
      const d = deps(opts);
      await reset(d);
      expectFinished(d.db);
      const routed = d.db.query<{ summary_status: string; summary: string | null }, []>("SELECT summary_status, summary FROM applications WHERE score IS NOT NULL").all();
      expect(routed.length).toBeGreaterThan(0);
      expect(routed.every((r) => r.summary_status === "failed" && r.summary === null)).toBe(true);
      expect(routing(d.db)).toEqual(await noLlmRouting());
    });
  }

  test("a healthy summariser: status ok, routing still identical", async () => {
    const d = deps({ summarize: fakeSummarizer.ok });
    await reset(d);
    const routed = d.db.query<{ summary_status: string }, []>("SELECT summary_status FROM applications WHERE score IS NOT NULL").all();
    expect(routed.every((r) => r.summary_status === "ok")).toBe(true);
    expect(routing(d.db)).toEqual(await noLlmRouting());
  });
});

describe("F9 conflicting data: contradictory signals are never auto-decided", () => {
  const lastDecision = (db: Database, id: string) =>
    db.query<{ decided_by: string; decision: string; reason: string; rule_hits: string }, { id: string }>("SELECT * FROM routing_decisions WHERE app_id = $id ORDER BY id DESC LIMIT 1").get({ id })!;

  test("twelve years of experience but under half the must-have skills goes to a person", async () => {
    const d = deps();
    await seedReference(d.db);
    const a = await intake(d, applicant({ years_experience: 12, skills: ["java", "postgres"] }));
    expect(a.state).toBe("human_review");
    const last = lastDecision(d.db, a.id);
    expect(JSON.parse(last.rule_hits)).toContain("SOFT_CALL");
    expect(last.reason).toContain("very experienced but under half the must-have skills");
  });

  test("every must-have skill but well under the experience bar goes to a person", async () => {
    const d = deps();
    await seedReference(d.db);
    const a = await intake(d, applicant({ years_experience: 1, skills: ["typescript", "postgres", "api design", "testing"] }));
    expect(a.state).toBe("human_review");
    expect(lastDecision(d.db, a.id).reason).toContain("well under the experience bar");
  });

  test("same phone, different person: a conflicting identity is reviewed, never merged on its own", async () => {
    const d = deps();
    await seedReference(d.db);
    const first = await intake(d, applicant({ full_name: "Dian Puspita", phone: "0813-9000-1005" }));
    const second = await intake(d, applicant({ full_name: "Dimas Anggara", phone: "0813 9000 1005" }));
    expect(first.state).not.toBe("duplicate");
    expect(second.state).toBe("human_review");
    expect(second.duplicate_of).toBeNull();
    expect(JSON.parse(lastDecision(d.db, second.id).rule_hits)).toContain("DUP_SAME_PHONE");
  });
});
