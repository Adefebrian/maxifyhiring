import { beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../../core/app";
import { openDb } from "../../core/db";

const app = createApp({ db: openDb(":memory:"), jev: { apiKey: "" } });
const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  const res = await post("/api/pipeline/reset", {});
  const body = (await res.json()) as { processed: number; invariants: { ok: boolean } };
  expect(body.processed).toBe(40);
  expect(body.invariants.ok).toBe(true);
});

describe("pipeline HTTP", () => {
  test("GET /api/stats", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const s = (await res.json()) as any;
    expect(s.total).toBe(40);
    expect(s.byState.interview_scheduled).toBe(16);
    expect(s.decisions.jev).toBe(0);
    expect(s.humanQueue).toBe(12);
  });

  test("GET /api/applications/:id returns log and decisions", async () => {
    const res = await app.request("/api/applications/APP-001");
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.app.id).toBe("APP-001");
    expect(b.log.length).toBeGreaterThan(0);
    expect(b.decisions.length).toBeGreaterThan(0);
    expect(b.interviews.length).toBe(1);
  });

  test("GET unknown id is 404", async () => {
    expect((await app.request("/api/applications/APP-999")).status).toBe(404);
  });

  test("POST /api/decisions/:id schedules a human_review app", async () => {
    const res = await post("/api/decisions/APP-009", { action: "schedule", reason: "Strong portfolio, worth an interview", actor: "Dimas" });
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.idempotent).toBe(false);
    expect(["interview_scheduled", "human_review"]).toContain(b.app.state);
    const d = (await (await app.request("/api/applications/APP-009")).json()) as any;
    expect(d.decisions.some((x: any) => x.decidedBy === "human" && x.decision === "schedule" && x.reason === "Strong portfolio, worth an interview")).toBe(true);
  });

  test("POST /api/decisions/:id on a wrong state is 409", async () => {
    const res = await post("/api/decisions/APP-001", { action: "offer", reason: "Looks great on paper" });
    expect(res.status).toBe(409);
  });

  test("POST /api/decisions/:id without a real reason is 400, bad body is 400", async () => {
    expect((await post("/api/decisions/APP-010", { action: "schedule", reason: "ok" })).status).toBe(400);
    expect((await post("/api/decisions/APP-010", { action: "fire", reason: "whatever reason" })).status).toBe(400);
  });

  test("a repeated identical decision is idempotent", async () => {
    const body = { action: "reject", reason: "Experience does not match the role", actor: "Sari" };
    const first = (await (await post("/api/decisions/APP-010", body)).json()) as any;
    expect(first).toMatchObject({ idempotent: false, app: { state: "rejected" } });
    const again = await post("/api/decisions/APP-010", body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).idempotent).toBe(true);
    const n = ((await (await app.request("/api/applications/APP-010")).json()) as any).decisions.filter((d: any) => d.decidedBy === "human").length;
    expect(n).toBe(1);
  });

  test("a dedupe review offers dedupe actions and mark_duplicate links the match", async () => {
    const before = (await (await app.request("/api/applications/APP-022")).json()) as any;
    expect(before.actions).toEqual(["keep_both", "mark_duplicate", "reject"]);
    const match = before.decisions.at(-1).ruleHits.find((h: string) => h.startsWith("MATCHES:")).slice("MATCHES:".length);
    const res = await post("/api/decisions/APP-022", { action: "mark_duplicate", reason: "Same person, confirmed by phone" });
    expect(((await res.json()) as any).app).toMatchObject({ state: "duplicate", duplicateOf: match });
  });

  test("keep_both on a dedupe review sends the app back through routing", async () => {
    const res = await post("/api/decisions/APP-023", { action: "keep_both", reason: "Different people sharing a family phone" });
    expect(res.status).toBe(200);
    const state = ((await res.json()) as any).app.state;
    expect(["interview_scheduled", "screening_queue", "human_review", "auto_rejected"]).toContain(state);
  });

  test("POST /api/applications runs intake end to end", async () => {
    const res = await post("/api/applications", {
      full_name: "Sinta Maharani", email: " Sinta.M@Gmail.com", phone: "0812-7777-0101", role: "be", years_experience: 6, location: "Jakarta",
      skills: "TypeScript, Postgres, API design, Testing, Bun", cv_text: "Six years shipping TypeScript APIs on Postgres with full test coverage.", consent: true,
      submitted_at: "2026-10-12T03:00:00Z",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).app).toMatchObject({ id: "APP-041", email: "sinta.m@gmail.com", roleCode: "BE", state: "interview_scheduled" });

    const bad = await post("/api/applications", { full_name: "x" });
    expect(((await bad.json()) as any).app.state).toBe("invalid");
    expect((await post("/api/applications", [1, 2])).status).toBe(400);
  });

  test("GET /api/audit?decidedBy=rule filters", async () => {
    const res = await app.request("/api/audit?decidedBy=rule");
    const b = (await res.json()) as any;
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.items.every((d: any) => d.decidedBy === "rule" && d.reason.length > 0)).toBe(true);
  });

  test("GET /api/health/invariants stays ok after a human decision", async () => {
    expect((await app.request("/api/health/invariants")).status).toBe(200);
  });
});
