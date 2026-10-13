// The pipeline agent. `process()` advances one application through every
// automated state until it reaches a state that waits on a person, a clock,
// or nothing at all. It is state-driven and idempotent: re-running it after a
// crash picks up from whatever state was last committed (F6).
import type { Database } from "bun:sqlite";
import { normalize, storableRaw, type Candidate } from "../intake";
import type { JevOptions } from "../jev";
import { route } from "../routing";
import { findSlot, type Busy, type Interviewer } from "../scheduling";
import type { Decision, Role } from "../shared";
import { findDuplicate, fixSummary, judgeFuzzy, validate, type Existing } from "../validation";
import { AUTOMATED, type State } from "./states";
import { createApplication, getApp, listRoles, now, transition, type AppRow, type Faults } from "./store";

export const RECRUITER = "recruiter:Rina";
export type Summarize = (cvText: string) => Promise<string>;
export type PipelineDeps = {
  db: Database;
  jev: JevOptions;
  summarize?: Summarize;
  /** Upper bound on one CV summary; a hung LLM never holds routing longer than this. */
  summaryTimeoutMs?: number;
  faults?: Faults;
};

const MAX_SLOT_RETRIES = 5;
const SUMMARY_TIMEOUT_MS = 8000;

const hours = (db: Database, h: number) => new Date(now(db).getTime() + h * 3_600_000).toISOString();
const WIB_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
export const wib = (iso: string) => {
  const p = Object.fromEntries(WIB_FMT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute} WIB`;
};

function nextId(db: Database): string {
  const row = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM applications").get();
  let n = (row?.n ?? 0) + 1;
  while (getApp(db, `APP-${String(n).padStart(3, "0")}`)) n++;
  return `APP-${String(n).padStart(3, "0")}`;
}

/** Intake: store the raw payload plus the normalised record, then run the pipeline on it. */
export async function intake(deps: PipelineDeps, raw: unknown): Promise<AppRow> {
  const { db } = deps;
  const c = normalize(raw);
  const id = nextId(db);
  createApplication(
    db,
    {
      id,
      source_ref: c.ref,
      raw_json: storableRaw(raw),
      name: c.name,
      email: c.email,
      phone: c.phone,
      role_code: c.roleCode,
      years_exp: c.yearsExp,
      location: c.location,
      skills: JSON.stringify(c.skills),
      cv_text: c.cvText,
      consent: c.consent === null ? null : c.consent ? 1 : 0,
      submitted_at: c.submittedAt,
      availability: JSON.stringify(c.availability),
    },
    { owner: "agent:validator", nextAction: "Validate fields and check duplicates", due: hours(db, 1) },
  );
  return process(deps, id);
}

function candidateOf(a: AppRow): Candidate {
  return normalize(JSON.parse(a.raw_json));
}

function primaries(db: Database, roleCode: string | null): Existing[] {
  return db
    .query<{ id: string; name: string; email: string; phone: string; role_code: string; submitted_at: string }, { role: string | null }>(
      "SELECT id, name, email, phone, role_code, submitted_at FROM applications WHERE is_primary = 1 AND role_code = $role",
    )
    .all({ role: roleCode })
    .map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, roleCode: r.role_code, submittedAt: r.submitted_at }));
}

const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

async function stepValidating(deps: PipelineDeps, a: AppRow, roles: Map<string, Role>): Promise<void> {
  const { db } = deps;
  const c = candidateOf(a);
  const errors = validate(c, roles, now(db));
  if (errors.length) {
    transition(db, a.id, {
      to: "invalid",
      owner: RECRUITER,
      nextAction: `Ask candidate to ${fixSummary(errors).charAt(0).toLowerCase()}${fixSummary(errors).slice(1)}`,
      due: hours(db, 48),
      actor: "agent:validator",
      note: `${errors.length} validation error(s)`,
      validationErrors: errors,
      decision: {
        stage: "validation",
        decidedBy: "rule",
        verified: true,
        stamp: null,
        decision: "invalid",
        confidence: 1,
        reason: `Failed ${errors.length} rule(s): ${errors.map((e) => e.message).join(" ")}`,
        ruleHits: errors.map((e) => e.code),
        jev: null,
      },
    }, deps.faults);
    return;
  }

  const self: Existing = { id: a.id, name: a.name, email: a.email, phone: a.phone, roleCode: a.role_code, submittedAt: a.submitted_at };
  const match = findDuplicate(self, primaries(db, a.role_code));

  if (match.kind === "exact") {
    // After crash recovery an earlier submission can resume after its later
    // twin already became primary. The audit reason must say which happened.
    const primary = getApp(db, match.of);
    const earlier = !a.submitted_at || !primary?.submitted_at || Date.parse(primary.submitted_at) <= Date.parse(a.submitted_at);
    markDuplicate(deps, a.id, match.of, {
      stage: "dedupe",
      decidedBy: "rule",
      verified: true,
      stamp: null,
      decision: "mark_duplicate",
      confidence: 1,
      reason: earlier
        ? `Same email and role as ${match.of}, which was submitted first. Linked; the earlier application stays primary.`
        : `Same email and role as ${match.of}, which was processed first although this application was submitted earlier (its processing was delayed). Linked; ${match.of} stays primary.`,
      ruleHits: earlier ? match.ruleHits : [...match.ruleHits, "DUP_PROCESSED_OUT_OF_ORDER"],
      jev: null,
    });
    return;
  }

  if (match.kind === "fuzzy") {
    const domain = (e: string | null) => e?.split("@")[1] ?? "";
    const other = getApp(db, match.of);
    const d = await judgeFuzzy(match, domain(a.email) === domain(other?.email ?? null), deps.jev);
    if (d.decision === "mark_duplicate") return markDuplicate(deps, a.id, match.of, d);
    if (d.decision === "human_review") {
      transition(db, a.id, {
        to: "human_review",
        owner: RECRUITER,
        nextAction: `Confirm whether this is the same person as ${match.of}`,
        due: hours(db, 24),
        actor: d.decidedBy === "jev" ? "jev" : "agent:validator",
        note: "Possible duplicate",
        decision: d,
      }, deps.faults);
      return;
    }
    return markValid(deps, a.id, d);
  }

  markValid(deps, a.id, {
    stage: "validation",
    decidedBy: "rule",
    verified: true,
    stamp: null,
    decision: "valid",
    confidence: 1,
    reason: "Passed every validation rule and no earlier application matches by email, phone, or name for this role.",
    ruleHits: ["VALID", "NO_DUPLICATE"],
    jev: null,
  });
}

function markDuplicate(deps: PipelineDeps, id: string, of: string, d: Decision): void {
  transition(deps.db, id, {
    to: "duplicate",
    owner: RECRUITER,
    nextAction: `None. Linked to ${of}`,
    due: null,
    actor: d.decidedBy === "jev" ? "jev" : "agent:validator",
    note: `Duplicate of ${of}`,
    decision: d,
    patch: { duplicate_of: of },
  }, deps.faults);
}

/** Becoming primary can lose a race on the unique index; the loser is an exact duplicate (F4). */
function markValid(deps: PipelineDeps, id: string, d: Decision): void {
  try {
    transition(deps.db, id, {
      to: "valid",
      owner: "agent:router",
      nextAction: "Score and route",
      due: hours(deps.db, 1),
      actor: "agent:validator",
      decision: d,
      patch: { is_primary: 1 },
    }, deps.faults);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const a = getApp(deps.db, id)!;
    const winner = primaries(deps.db, a.role_code).find((p) => p.email === a.email);
    markDuplicate(deps, id, winner?.id ?? "unknown", {
      stage: "dedupe",
      decidedBy: "rule",
      verified: true,
      stamp: null,
      decision: "mark_duplicate",
      confidence: 1,
      reason: `Another application with the same email and role became primary first (${winner?.id}). Linked as a duplicate.`,
      ruleHits: ["DUP_EXACT_EMAIL_ROLE", "DUP_RACE"],
      jev: null,
    });
  }
}

async function summarise(deps: PipelineDeps, a: AppRow): Promise<{ summary: string | null; summary_status: string }> {
  if (!deps.summarize || !a.cv_text) return { summary: null, summary_status: "off" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      deps.summarize(a.cv_text),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("timeout")), deps.summaryTimeoutMs ?? SUMMARY_TIMEOUT_MS);
      }),
    ]);
    const clean = typeof out === "string" ? out.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600) : "";
    return clean ? { summary: clean, summary_status: "ok" } : { summary: null, summary_status: "failed" };
  } catch {
    return { summary: null, summary_status: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function stepRoute(deps: PipelineDeps, a: AppRow, roles: Map<string, Role>): Promise<void> {
  const { db } = deps;
  const role = roles.get(a.role_code ?? "")!;
  const [{ score, decision }, sum] = await Promise.all([
    route({ yearsExp: a.years_exp ?? 0, location: a.location, skills: JSON.parse(a.skills) }, role, deps.jev),
    summarise(deps, a),
  ]);
  const actor = decision.decidedBy === "jev" ? "jev" : "agent:router";
  const patch = { score: score.total, ...sum };
  const target = decision.decision as State;
  const assign: Record<string, { owner: string; nextAction: string; due: string | null }> = {
    scheduling: { owner: "agent:scheduler", nextAction: "Find an interview slot", due: hours(db, 1) },
    screening_queue: { owner: RECRUITER, nextAction: "Phone screen, then schedule or reject", due: hours(db, 48) },
    human_review: { owner: `hm:${role.hiringManager}`, nextAction: "Review borderline application and choose a route", due: hours(db, 24) },
    auto_rejected: { owner: RECRUITER, nextAction: "Send rejection notice", due: hours(db, 72) },
  };
  transition(db, a.id, { to: target, actor, decision, patch, ...assign[target]! }, deps.faults);
}

function interviewers(db: Database): Interviewer[] {
  return db
    .query<{ id: string; name: string; role_codes: string }, []>("SELECT * FROM interviewers ORDER BY id")
    .all()
    .map((r) => ({ id: r.id, name: r.name, roleCodes: JSON.parse(r.role_codes) }));
}

function busy(db: Database): Busy[] {
  return db
    .query<{ interviewer_id: string; start: string; end: string }, []>('SELECT interviewer_id, start, "end" FROM busy_blocks')
    .all()
    .map((b) => ({ interviewerId: b.interviewer_id, start: b.start, end: b.end }));
}

function booked(db: Database) {
  return db
    .query<{ interviewer_id: string; start: string }, []>("SELECT interviewer_id, start FROM interviews WHERE status IN ('scheduled', 'done')")
    .all()
    .map((b) => ({ interviewerId: b.interviewer_id, start: b.start }));
}

function attempts(db: Database, id: string): number {
  return db.query<{ n: number }, { id: string }>("SELECT COUNT(*) AS n FROM interviews WHERE app_id = $id").get({ id })?.n ?? 0;
}

/** Book the earliest common slot. A lost race on the slot index retries the next slot (F5). */
export function stepSchedule(deps: PipelineDeps, a: AppRow, extraBooked: { interviewerId: string; start: string }[] = []): void {
  const { db } = deps;
  const role = listRoles(db).get(a.role_code ?? "");
  const ivs = interviewers(db);
  const taken = [...booked(db), ...extraBooked];
  const attempt = attempts(db, a.id) + 1;

  for (let i = 0; i < MAX_SLOT_RETRIES; i++) {
    const pick = findSlot({ now: now(db), roleCode: a.role_code ?? "", availability: JSON.parse(a.availability), interviewers: ivs, busy: busy(db), booked: taken });
    if (!pick) break;
    const iv = ivs.find((x) => x.id === pick.interviewerId)!;
    try {
      db.transaction(() => {
        db.query(
          `INSERT INTO interviews (app_id, interviewer_id, start, "end", status, attempt) VALUES ($app, $iv, $start, $end, 'scheduled', $attempt)`,
        ).run({ app: a.id, iv: iv.id, start: pick.start, end: pick.end, attempt });
        transition(db, a.id, {
          to: "interview_scheduled",
          owner: `interviewer:${iv.name}`,
          nextAction: `Interview ${a.name ?? a.id} at ${wib(pick.start)}`,
          due: pick.start,
          actor: "agent:scheduler",
          note: `Mock invite sent for ${wib(pick.start)}`,
          decision: {
            stage: "schedule",
            decidedBy: "rule",
            verified: true,
            stamp: null,
            decision: "interview_scheduled",
            confidence: 1,
            reason: `Earliest common slot inside the candidate's availability with a free ${role?.title ?? ""} interviewer: ${iv.name}, ${wib(pick.start)}${attempt > 1 ? `, attempt ${attempt}` : ""}.`,
            ruleHits: ["SLOT_FOUND", `ATTEMPT_${attempt}`, i > 0 ? "SLOT_RACE_RETRY" : "FIRST_PICK"],
            jev: null,
          },
        }, deps.faults);
      })();
      return;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      taken.push({ interviewerId: pick.interviewerId, start: pick.start });
    }
  }

  transition(db, a.id, {
    to: "human_review",
    owner: `hm:${role?.hiringManager ?? "unassigned"}`,
    nextAction: "No common slot in 10 working days: extend availability or add an interviewer",
    due: hours(db, 24),
    actor: "agent:scheduler",
    decision: {
      stage: "schedule",
      decidedBy: "rule",
      verified: true,
      stamp: null,
      decision: "no_slot",
      confidence: 1,
      reason: "no_slot: no free interviewer slot overlaps the candidate's availability within 10 working days.",
      ruleHits: ["NO_SLOT"],
      jev: null,
    },
  }, deps.faults);
}

/** Advance one application until it waits on a person or the clock. */
export async function process(deps: PipelineDeps, id: string): Promise<AppRow> {
  const roles = listRoles(deps.db);
  for (let guard = 0; guard < 10; guard++) {
    const a = getApp(deps.db, id);
    if (!a) throw new Error(`Unknown application ${id}`);
    if (!AUTOMATED.includes(a.state)) return a;
    switch (a.state) {
      case "received":
        transition(deps.db, id, { to: "validating", owner: "agent:validator", nextAction: "Run validation rules", due: hours(deps.db, 1), actor: "agent:validator" }, deps.faults);
        break;
      case "validating":
        await stepValidating(deps, a, roles);
        break;
      case "valid":
        await stepRoute(deps, a, roles);
        break;
      case "scheduling":
        stepSchedule(deps, a);
        break;
      case "interview_done": {
        const role = roles.get(a.role_code ?? "");
        transition(deps.db, id, {
          to: "awaiting_decision",
          owner: `hm:${role?.hiringManager ?? "unassigned"}`,
          nextAction: "Read interview notes and decide: offer, hold, or reject",
          due: hours(deps.db, 48),
          actor: "agent:scheduler",
        }, deps.faults);
        break;
      }
    }
  }
  return getApp(deps.db, id)!;
}

/** Resume every application parked in an automated state (crash recovery). */
export async function runAll(deps: PipelineDeps): Promise<number> {
  const ids = deps.db
    .query<{ id: string }, []>(`SELECT id FROM applications WHERE state IN (${AUTOMATED.map((s) => `'${s}'`).join(",")}) ORDER BY submitted_at, id`)
    .all();
  // One broken application must not strand the rest: process every one, then
  // fail loudly with the ids that still could not advance.
  const failed: string[] = [];
  for (const { id } of ids) {
    try {
      await process(deps, id);
    } catch (e) {
      failed.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed.length) throw new Error(`runAll could not advance ${failed.length} application(s): ${failed.join("; ")}`);
  return ids.length;
}
