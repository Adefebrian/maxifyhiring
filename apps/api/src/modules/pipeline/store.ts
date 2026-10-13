// Persistence for the pipeline. The single write path for a state change is
// `transition()`: the application row, its pipeline_log row, and the audited
// decision (when there is one) commit together or not at all (F6).
import type { Database } from "bun:sqlite";
import type { Decision, Role } from "../shared";
import { canTransition, IllegalTransition, type State } from "./states";

export type AppRow = {
  id: string;
  source_ref: string | null;
  raw_json: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role_code: string | null;
  years_exp: number | null;
  location: string | null;
  skills: string;
  cv_text: string | null;
  consent: number | null;
  submitted_at: string | null;
  availability: string;
  state: State;
  owner: string;
  next_action: string;
  next_action_due: string | null;
  duplicate_of: string | null;
  is_primary: number;
  score: number | null;
  summary: string | null;
  summary_status: string;
  created_at: string;
  updated_at: string;
};

export type Assignment = { owner: string; nextAction: string; due: string | null };

export type TransitionInput = Assignment & {
  to: State;
  actor: string;
  note?: string;
  decision?: Decision;
  patch?: Partial<Pick<AppRow, "duplicate_of" | "is_primary" | "score" | "summary" | "summary_status">>;
  validationErrors?: { code: string; field: string; message: string }[];
};

/** Test-only fault hooks. Production code never sets these. */
export type Faults = { afterStateUpdate?: (appId: string, to: State) => void };

export function now(db: Database): Date {
  const row = db.query<{ now: string }, []>("SELECT now FROM sim_clock WHERE id = 1").get();
  return row ? new Date(row.now) : new Date();
}

export function setNow(db: Database, at: Date): void {
  db.query("INSERT INTO sim_clock (id, now) VALUES (1, $now) ON CONFLICT(id) DO UPDATE SET now = excluded.now").run({ now: at.toISOString() });
}

export function getApp(db: Database, id: string): AppRow | null {
  return db.query<AppRow, { id: string }>("SELECT * FROM applications WHERE id = $id").get({ id });
}

export function listRoles(db: Database): Map<string, Role> {
  const rows = db.query<Record<string, any>, []>("SELECT * FROM roles").all();
  return new Map(
    rows.map((r) => [
      r.code,
      {
        code: r.code,
        title: r.title,
        status: r.status,
        mustHave: JSON.parse(r.must_have),
        niceToHave: JSON.parse(r.nice_to_have),
        minYears: r.min_years,
        location: r.location,
        remoteOk: !!r.remote_ok,
        hiringManager: r.hiring_manager,
      } satisfies Role,
    ]),
  );
}

export function insertDecision(db: Database, appId: string, d: Decision, at: string): void {
  db.query(
    `INSERT INTO routing_decisions (app_id, stage, decided_by, verified, stamp, decision, confidence, reason, rule_hits, jev, at)
     VALUES ($app, $stage, $by, $verified, $stamp, $decision, $confidence, $reason, $hits, $jev, $at)`,
  ).run({
    app: appId,
    stage: d.stage,
    by: d.decidedBy,
    verified: d.verified ? 1 : 0,
    stamp: d.stamp,
    decision: d.decision,
    confidence: d.confidence,
    reason: d.reason,
    hits: JSON.stringify(d.ruleHits),
    jev: d.jev == null ? null : JSON.stringify(d.jev),
    at,
  });
}

/** Creates the application in `received` with its first log row, atomically. */
export function createApplication(
  db: Database,
  row: Omit<AppRow, "state" | "owner" | "next_action" | "next_action_due" | "duplicate_of" | "is_primary" | "score" | "summary" | "summary_status" | "created_at" | "updated_at">,
  assignment: Assignment,
): void {
  const at = now(db).toISOString();
  db.transaction(() => {
    db.query(
      `INSERT INTO applications (id, source_ref, raw_json, name, email, phone, role_code, years_exp, location, skills, cv_text, consent,
         submitted_at, availability, state, owner, next_action, next_action_due, created_at, updated_at)
       VALUES ($id, $source_ref, $raw_json, $name, $email, $phone, $role_code, $years_exp, $location, $skills, $cv_text, $consent,
         $submitted_at, $availability, 'received', $owner, $next, $due, $at, $at)`,
    ).run({ ...row, owner: assignment.owner, next: assignment.nextAction, due: assignment.due, at });
    db.query(
      `INSERT INTO pipeline_log (app_id, from_state, to_state, owner, next_action, next_action_due, actor, note, at)
       VALUES ($id, NULL, 'received', $owner, $next, $due, 'agent:intake', 'Application received', $at)`,
    ).run({ id: row.id, owner: assignment.owner, next: assignment.nextAction, due: assignment.due, at });
  })();
}

export function transition(db: Database, appId: string, t: TransitionInput, faults: Faults = {}): AppRow {
  const at = now(db).toISOString();
  return db.transaction(() => {
    const app = getApp(db, appId);
    if (!app) throw new Error(`Unknown application ${appId}`);
    if (!canTransition(app.state, t.to)) throw new IllegalTransition(appId, app.state, t.to);

    const patch = t.patch ?? {};
    db.query(
      `UPDATE applications SET state = $to, owner = $owner, next_action = $next, next_action_due = $due, updated_at = $at,
         duplicate_of = COALESCE($dup, duplicate_of), is_primary = COALESCE($primary, is_primary), score = COALESCE($score, score),
         summary = COALESCE($summary, summary), summary_status = COALESCE($summary_status, summary_status)
       WHERE id = $id`,
    ).run({
      id: appId,
      to: t.to,
      owner: t.owner,
      next: t.nextAction,
      due: t.due,
      at,
      dup: patch.duplicate_of ?? null,
      primary: patch.is_primary ?? null,
      score: patch.score ?? null,
      summary: patch.summary ?? null,
      summary_status: patch.summary_status ?? null,
    });
    faults.afterStateUpdate?.(appId, t.to);

    db.query(
      `INSERT INTO pipeline_log (app_id, from_state, to_state, owner, next_action, next_action_due, actor, note, at)
       VALUES ($id, $from, $to, $owner, $next, $due, $actor, $note, $at)`,
    ).run({ id: appId, from: app.state, to: t.to, owner: t.owner, next: t.nextAction, due: t.due, actor: t.actor, note: t.note ?? "", at });

    if (t.decision) insertDecision(db, appId, t.decision, at);
    for (const e of t.validationErrors ?? []) {
      db.query("INSERT INTO validation_errors (app_id, code, field, message) VALUES ($id, $code, $field, $message)").run({ id: appId, ...e });
    }
    return getApp(db, appId)!;
  })();
}
