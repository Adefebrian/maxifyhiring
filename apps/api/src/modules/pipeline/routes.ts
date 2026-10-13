// HTTP surface of the pipeline. Every body is schema-checked; a malformed
// request is a 400, never a 500 (F3).
import { Hono } from "hono";
import { z } from "zod";
import { allowedActions, decide } from "./decisions";
import { checkInvariants } from "./invariants";
import { intake, runAll, type PipelineDeps } from "./runner";
import { reset } from "./seed";
import { advance } from "./sim";
import { ACTION_TARGET, STATES, type HumanAction } from "./states";
import { getApp, listRoles, now, type AppRow } from "./store";
import { gridSlots } from "../scheduling";
import { nameSimilarity } from "../validation";

const QUEUE_STATES = ["human_review", "awaiting_decision", "screening_queue", "on_hold", "auto_rejected"] as const;

function summary(a: AppRow, roles: Map<string, { title: string }>) {
  return {
    id: a.id,
    ref: a.source_ref,
    name: a.name,
    email: a.email,
    roleCode: a.role_code,
    roleTitle: roles.get(a.role_code ?? "")?.title ?? null,
    state: a.state,
    owner: a.owner,
    nextAction: a.next_action,
    nextActionDue: a.next_action_due,
    score: a.score,
    duplicateOf: a.duplicate_of,
    submittedAt: a.submitted_at,
    updatedAt: a.updated_at,
  };
}

const logRow = (r: Record<string, any>) => ({
  id: r.id,
  appId: r.app_id,
  name: r.name ?? null,
  fromState: r.from_state,
  toState: r.to_state,
  owner: r.owner,
  nextAction: r.next_action,
  nextActionDue: r.next_action_due,
  actor: r.actor,
  note: r.note,
  at: r.at,
});

const decisionRow = (r: Record<string, any>) => ({
  id: r.id,
  appId: r.app_id,
  name: r.name ?? null,
  stage: r.stage,
  decidedBy: r.decided_by,
  verified: !!r.verified,
  stamp: r.stamp,
  decision: r.decision,
  confidence: r.confidence,
  reason: r.reason,
  ruleHits: JSON.parse(r.rule_hits ?? "[]"),
  jev: r.jev ? JSON.parse(r.jev) : null,
  at: r.at,
});

const interviewRow = (r: Record<string, any>) => ({
  id: r.id,
  appId: r.app_id,
  name: r.name ?? null,
  interviewerId: r.interviewer_id,
  interviewerName: r.interviewer_name ?? null,
  start: r.start,
  end: r.end,
  status: r.status,
  attempt: r.attempt,
});

const decisionBody = z.object({
  action: z.enum(Object.keys(ACTION_TARGET) as [HumanAction, ...HumanAction[]]),
  reason: z.string().max(1000),
  actor: z.string().trim().min(1).max(60).default("recruiter"),
});

async function json(c: { req: { json: () => Promise<unknown> } }): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

export function createPipelineRoutes(deps: PipelineDeps) {
  const { db } = deps;

  /** The latest agent ruling (not a human one): why the case is where it is. */
  const ruling = (id: string) => {
    const r = db
      .query<Record<string, any>, { id: string }>("SELECT * FROM routing_decisions WHERE app_id = $id AND decided_by <> 'human' ORDER BY id DESC LIMIT 1")
      .get({ id });
    return r ? decisionRow(r) : null;
  };

  /** For a possible-duplicate review: the earlier application it matched and how. */
  const match = (a: AppRow) => {
    if (a.state !== "human_review") return null;
    const r = ruling(a.id);
    if (!r || r.stage !== "dedupe") return null;
    const tag = (r.ruleHits as string[]).find((h) => h.startsWith("MATCHES:"));
    const other = tag ? getApp(db, tag.slice("MATCHES:".length)) : null;
    if (!other) return null;
    return {
      id: other.id,
      name: other.name,
      email: other.email,
      phone: other.phone,
      state: other.state,
      submittedAt: other.submitted_at,
      sameEmail: !!a.email && a.email === other.email,
      samePhone: !!a.phone && a.phone === other.phone,
      nameSimilarity: a.name && other.name ? Math.round(nameSimilarity(a.name, other.name) * 100) / 100 : 0,
    };
  };

  return new Hono()
    .get("/stats", (c) => {
      const byState = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<string, number>;
      for (const r of db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) AS n FROM applications GROUP BY state").all()) byState[r.state] = r.n;
      const d = db
        .query<{ by: string; verified: number; n: number }, []>("SELECT decided_by AS by, verified, COUNT(*) AS n FROM routing_decisions GROUP BY decided_by, verified")
        .all();
      const sum = (f: (r: { by: string; verified: number }) => boolean) => d.filter(f).reduce((t, r) => t + r.n, 0);
      return c.json({
        now: now(db).toISOString(),
        total: Object.values(byState).reduce((a, b) => a + b, 0),
        byState,
        decisions: { rule: sum((r) => r.by === "rule"), jev: sum((r) => r.by === "jev"), human: sum((r) => r.by === "human") },
        jevVerified: sum((r) => r.by === "jev" && r.verified === 1),
        unverified: sum((r) => r.verified === 0),
        humanQueue: QUEUE_STATES.reduce((t, s) => t + (byState[s] ?? 0), 0),
      });
    })
    .get("/applications", (c) => {
      const roles = listRoles(db);
      const state = c.req.query("state");
      const owner = c.req.query("owner");
      const q = c.req.query("q")?.toLowerCase().slice(0, 80);
      let rows = db.query<AppRow, []>("SELECT * FROM applications ORDER BY id").all();
      if (state) rows = rows.filter((r) => r.state === state);
      if (owner) rows = rows.filter((r) => r.owner === owner);
      if (q) rows = rows.filter((r) => `${r.id} ${r.name ?? ""} ${r.email ?? ""}`.toLowerCase().includes(q));
      return c.json({ items: rows.map((r) => summary(r, roles)) });
    })
    .post("/applications", async (c) => {
      const parsed = await json(c);
      if (!parsed.ok) return c.json({ error: "Body must be valid JSON." }, 400);
      if (!parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) return c.json({ error: "Body must be one application object." }, 400);
      const app = await intake(deps, parsed.body);
      return c.json({ app: summary(app, listRoles(db)) }, 201);
    })
    .get("/applications/:id", (c) => {
      const id = c.req.param("id");
      const a = getApp(db, id);
      if (!a) return c.json({ error: `Unknown application ${id}` }, 404);
      const roles = listRoles(db);
      return c.json({
        app: {
          ...summary(a, roles),
          phone: a.phone,
          yearsExp: a.years_exp,
          location: a.location,
          skills: JSON.parse(a.skills),
          cvText: a.cv_text,
          consent: a.consent === null ? null : !!a.consent,
          availability: JSON.parse(a.availability),
          summary: a.summary,
          summaryStatus: a.summary_status,
          raw: JSON.parse(a.raw_json),
        },
        log: db.query<Record<string, any>, { id: string }>("SELECT * FROM pipeline_log WHERE app_id = $id ORDER BY id").all({ id }).map(logRow),
        decisions: db.query<Record<string, any>, { id: string }>("SELECT * FROM routing_decisions WHERE app_id = $id ORDER BY id").all({ id }).map(decisionRow),
        errors: db.query<Record<string, any>, { id: string }>("SELECT code, field, message FROM validation_errors WHERE app_id = $id").all({ id }),
        interviews: db
          .query<Record<string, any>, { id: string }>("SELECT i.*, v.name AS interviewer_name FROM interviews i JOIN interviewers v ON v.id = i.interviewer_id WHERE app_id = $id ORDER BY i.id")
          .all({ id })
          .map(interviewRow),
        ruling: ruling(a.id),
        match: match(a),
        duplicates: db.query<{ id: string; name: string; state: string }, { id: string }>("SELECT id, name, state FROM applications WHERE duplicate_of = $id ORDER BY id").all({ id }),
        actions: allowedActions(deps, a),
      });
    })
    .get("/log", (c) => {
      const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 200) || 200));
      const items = db
        .query<Record<string, any>, { limit: number }>("SELECT l.*, a.name FROM pipeline_log l JOIN applications a ON a.id = l.app_id ORDER BY l.id DESC LIMIT $limit")
        .all({ limit })
        .map(logRow);
      return c.json({ items });
    })
    .get("/audit", (c) => {
      const by = c.req.query("decidedBy");
      const stage = c.req.query("stage");
      const verified = c.req.query("verified");
      let items = db
        .query<Record<string, any>, []>("SELECT d.*, a.name FROM routing_decisions d JOIN applications a ON a.id = d.app_id ORDER BY d.id DESC")
        .all()
        .map(decisionRow);
      if (by) items = items.filter((d) => d.decidedBy === by);
      if (stage) items = items.filter((d) => d.stage === stage);
      if (verified === "true" || verified === "false") items = items.filter((d) => String(d.verified) === verified);
      return c.json({ items });
    })
    .get("/schedule", (c) => {
      const interviews = db
        .query<Record<string, any>, []>(
          "SELECT i.*, a.name, v.name AS interviewer_name FROM interviews i JOIN applications a ON a.id = i.app_id JOIN interviewers v ON v.id = i.interviewer_id ORDER BY i.start, i.id",
        )
        .all()
        .map(interviewRow);
      const interviewers = db
        .query<{ id: string; name: string; role_codes: string }, []>("SELECT * FROM interviewers ORDER BY id")
        .all()
        .map((i) => ({
          id: i.id,
          name: i.name,
          roleCodes: JSON.parse(i.role_codes) as string[],
          busy: db.query<{ start: string; end: string; label: string }, { id: string }>('SELECT start, "end", label FROM busy_blocks WHERE interviewer_id = $id ORDER BY start').all({ id: i.id }),
        }));
      const t = now(db);
      return c.json({ now: t.toISOString(), interviewers, interviews, grid: gridSlots(t, 10, 0).map((s) => s.start) });
    })
    .post("/sim/advance", async (c) => {
      const parsed = await json(c);
      const body = parsed.ok ? z.object({ hours: z.number().int().min(1).max(240) }).safeParse(parsed.body) : null;
      if (!body?.success) return c.json({ error: "Body must be { hours: integer 1 to 240 }." }, 400);
      return c.json(await advance(deps, body.data.hours));
    })
    .post("/pipeline/reset", async (c) => {
      const r = await reset(deps);
      return c.json({ ...r, invariants: checkInvariants(db) });
    })
    .post("/pipeline/run", async (c) => c.json({ resumed: await runAll(deps), invariants: checkInvariants(db) }))
    .get("/decisions/queue", (c) => {
      const roles = listRoles(db);
      const rows = db
        .query<AppRow, []>(`SELECT * FROM applications WHERE state IN (${QUEUE_STATES.map((s) => `'${s}'`).join(",")}) ORDER BY next_action_due, id`)
        .all();
      return c.json({ items: rows.map((r) => ({ ...summary(r, roles), actions: allowedActions(deps, r), ruling: ruling(r.id), match: match(r) })) });
    })
    .post("/decisions/:id", async (c) => {
      const parsed = await json(c);
      const body = parsed.ok ? decisionBody.safeParse(parsed.body) : null;
      if (!body?.success) return c.json({ error: "Body must be { action, reason, actor? } with a known action." }, 400);
      const r = await decide(deps, c.req.param("id"), body.data);
      if (!r.ok) return c.json({ error: r.error }, r.status);
      return c.json({ idempotent: r.idempotent, app: summary(r.app, listRoles(db)) });
    })
    .get("/health/invariants", (c) => {
      const r = checkInvariants(db);
      return c.json(r, r.ok ? 200 : 500);
    });
}
