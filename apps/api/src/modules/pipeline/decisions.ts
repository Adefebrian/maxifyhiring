// The human decision point. Only a person can offer, reject (outside the
// clear auto-reject band), hold, or override a route, and every such call
// needs a written reason. A repeated identical submit is a no-op (F7).
import { getApp, now, transition, type AppRow } from "./store";
import { process, RECRUITER, type PipelineDeps } from "./runner";
import { ACTION_TARGET, DEDUPE_ACTIONS, HUMAN_ACTIONS, type HumanAction, type State } from "./states";

export type HumanInput = { action: HumanAction; reason: string; actor: string };
export type HumanResult =
  | { ok: true; idempotent: boolean; app: AppRow }
  | { ok: false; status: 400 | 404 | 409; error: string };

function lastHuman(deps: PipelineDeps, id: string) {
  return deps.db
    .query<{ decision: string; reason: string }, { id: string }>("SELECT decision, reason FROM routing_decisions WHERE app_id = $id AND decided_by = 'human' ORDER BY id DESC LIMIT 1")
    .get({ id });
}

function isDedupeReview(deps: PipelineDeps, id: string): boolean {
  const last = deps.db.query<{ stage: string }, { id: string }>("SELECT stage FROM routing_decisions WHERE app_id = $id ORDER BY id DESC LIMIT 1").get({ id });
  return last?.stage === "dedupe";
}

export function allowedActions(deps: PipelineDeps, app: AppRow): HumanAction[] {
  if (app.state === "human_review" && isDedupeReview(deps, app.id)) return [...DEDUPE_ACTIONS];
  return [...(HUMAN_ACTIONS[app.state] ?? [])];
}

export async function decide(deps: PipelineDeps, id: string, input: HumanInput): Promise<HumanResult> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { ok: false, status: 400, error: "A reason of at least 5 characters is required for every human decision." };
  const app = getApp(deps.db, id);
  if (!app) return { ok: false, status: 404, error: `Unknown application ${id}` };

  const target = ACTION_TARGET[input.action];
  const allowed = allowedActions(deps, app).includes(input.action);
  const prev = lastHuman(deps, id);
  // A double submit: the same action and reason already landed and moved the
  // application on, so the action is no longer offered. Answer as before.
  if (!allowed && prev && prev.decision === input.action && prev.reason === reason) {
    return { ok: true, idempotent: true, app };
  }
  if (!allowed) {
    return { ok: false, status: 409, error: `"${input.action}" is not allowed while the application is ${app.state}.` };
  }

  const hm = app.owner.startsWith("hm:") ? app.owner : RECRUITER;
  const due = (h: number) => new Date(now(deps.db).getTime() + h * 3_600_000).toISOString();
  const assign: Record<State, { owner: string; nextAction: string; due: string | null }> = {
    scheduling: { owner: "agent:scheduler", nextAction: "Find an interview slot", due: due(1) },
    screening_queue: { owner: RECRUITER, nextAction: "Phone screen, then schedule or reject", due: due(48) },
    rejected: { owner: RECRUITER, nextAction: "Send rejection notice", due: due(72) },
    on_hold: { owner: hm, nextAction: "Revisit this application", due: due(24 * 7) },
    offer: { owner: RECRUITER, nextAction: "Prepare and send the offer letter", due: due(48) },
    valid: { owner: "agent:router", nextAction: "Score and route", due: due(1) },
    duplicate: { owner: RECRUITER, nextAction: "None. Linked as duplicate", due: null },
    human_review: { owner: hm, nextAction: "Re-review this application", due: due(24) },
  } as Record<State, { owner: string; nextAction: string; due: string | null }>;

  let dupOf: string | null = null;
  if (input.action === "mark_duplicate") {
    const hits = deps.db
      .query<{ rule_hits: string }, { id: string }>("SELECT rule_hits FROM routing_decisions WHERE app_id = $id AND stage = 'dedupe' ORDER BY id DESC LIMIT 1")
      .get({ id })?.rule_hits;
    const tag = (JSON.parse(hits ?? "[]") as string[]).find((h) => h.startsWith("MATCHES:"));
    dupOf = tag ? tag.slice("MATCHES:".length) : null;
  }

  transition(deps.db, id, {
    to: target,
    ...assign[target],
    actor: `human:${input.actor}`,
    note: reason,
    patch: dupOf ? { duplicate_of: dupOf } : input.action === "keep_both" ? { is_primary: 1 } : undefined,
    decision: {
      stage: "human",
      decidedBy: "human",
      verified: true,
      stamp: null,
      decision: input.action,
      confidence: null,
      reason,
      ruleHits: [`FROM_${app.state.toUpperCase()}`],
      jev: null,
    },
  }, deps.faults);

  const after = await process(deps, id);
  return { ok: true, idempotent: false, app: after };
}
