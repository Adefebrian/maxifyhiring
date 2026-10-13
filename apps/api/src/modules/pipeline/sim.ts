// Scheduling simulation. Moving the simulated clock forward "runs" every
// interview whose slot has ended. A seed record may carry `sim_no_show: n`,
// meaning the candidate misses their first n interviews: the first miss is
// rescheduled automatically, a second miss goes to the hiring manager.
import { getApp, listRoles, now, setNow, transition } from "./store";
import { process, type PipelineDeps } from "./runner";

export type AdvanceResult = { now: string; done: string[]; noShows: string[] };

export async function advance(deps: PipelineDeps, hoursForward: number): Promise<AdvanceResult> {
  const { db } = deps;
  const to = new Date(now(db).getTime() + hoursForward * 3_600_000);
  setNow(db, to);
  const result: AdvanceResult = { now: to.toISOString(), done: [], noShows: [] };
  const roles = listRoles(db);
  // A reschedule can land inside the window just advanced, so keep draining
  // until no scheduled interview has ended before the new clock.
  const nextDue = () =>
    db
      .query<{ id: number; app_id: string; attempt: number }, { now: string }>(
        `SELECT id, app_id, attempt FROM interviews WHERE status = 'scheduled' AND "end" <= $now ORDER BY start, id LIMIT 1`,
      )
      .get({ now: to.toISOString() });
  for (let iv = nextDue(); iv; iv = nextDue()) {
    const app = getApp(db, iv.app_id);
    if (!app || app.state !== "interview_scheduled") {
      db.query("UPDATE interviews SET status = 'no_show' WHERE id = $id").run({ id: iv.id });
      continue;
    }
    const misses = Number((JSON.parse(app.raw_json) ?? {}).sim_no_show ?? 0);
    const hm = `hm:${roles.get(app.role_code ?? "")?.hiringManager ?? "unassigned"}`;

    if (iv.attempt <= misses) {
      db.transaction(() => {
        db.query("UPDATE interviews SET status = 'no_show' WHERE id = $id").run({ id: iv.id });
        if (iv.attempt === 1) {
          transition(db, app.id, {
            to: "scheduling",
            owner: "agent:scheduler",
            nextAction: "Candidate missed the interview: reschedule once",
            due: to.toISOString(),
            actor: "agent:scheduler",
            note: "No-show, attempt 1",
            decision: { stage: "schedule", decidedBy: "rule", verified: true, stamp: null, decision: "reschedule", confidence: 1, reason: "Candidate did not attend attempt 1. Policy allows one automatic reschedule.", ruleHits: ["NO_SHOW", "RESCHEDULE_ONCE"], jev: null },
          }, deps.faults);
        } else {
          transition(db, app.id, {
            to: "human_review",
            owner: hm,
            nextAction: "Candidate missed two interviews: decide whether to continue",
            due: new Date(to.getTime() + 24 * 3_600_000).toISOString(),
            actor: "agent:scheduler",
            note: `No-show, attempt ${iv.attempt}`,
            decision: { stage: "schedule", decidedBy: "rule", verified: true, stamp: null, decision: "human_review", confidence: 1, reason: `Candidate missed attempt ${iv.attempt}. Only one automatic reschedule is allowed, so a person decides.`, ruleHits: ["NO_SHOW", "RESCHEDULE_LIMIT"], jev: null },
          }, deps.faults);
        }
      })();
      result.noShows.push(app.id);
    } else {
      db.transaction(() => {
        db.query("UPDATE interviews SET status = 'done' WHERE id = $id").run({ id: iv.id });
        transition(db, app.id, { to: "interview_done", owner: "agent:scheduler", nextAction: "Collect interview notes", due: to.toISOString(), actor: "agent:scheduler", note: "Interview held" }, deps.faults);
      })();
      result.done.push(app.id);
    }
    await process(deps, app.id);
  }
  return result;
}
