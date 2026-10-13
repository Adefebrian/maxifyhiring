// Display helpers. Every time is ISO UTC from the API and shows in WIB
// (Asia/Jakarta). "Now" is always the sim clock from the API, never the
// browser clock, so due and overdue match what the agent sees.
import type { HumanAction, State } from "./api";

const TZ = "Asia/Jakarta";

const dayTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const timeOnly = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayOnly = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const weekdayIdx = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });

function parts(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "Wed 14 Oct, 09:00" in WIB. */
export function fmtDayTime(iso: string): string {
  const p = parts(dayTime, new Date(iso));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** "09:00" in WIB. */
export function fmtTime(iso: string): string {
  const p = parts(timeOnly, new Date(iso));
  return `${p.hour}:${p.minute}`;
}

/** "Wed 14 Oct" in WIB. */
export function fmtDay(iso: string): string {
  const p = parts(dayOnly, new Date(iso));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "2026-10-14", the WIB calendar date, for grouping by day. */
export function wibDate(iso: string): string {
  return dateKey.format(new Date(iso));
}

/** True when the WIB calendar day is Saturday or Sunday. */
export function isWeekend(iso: string): boolean {
  const w = weekdayIdx.format(new Date(iso));
  return w === "Sat" || w === "Sun";
}

/** "3 h", "2 d", "45 min": a compact span, never negative. */
export function span(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export interface DueInfo {
  /** overdue: past the sim clock; soon: within 4 hours of it; later: further out. */
  kind: "overdue" | "soon" | "later";
  overdue: boolean;
  label: string;
  at: string;
}

const SOON_MS = 4 * 3_600_000;

/** Due relative to the sim clock: "Due in 25 h" or "Overdue by 3 h". */
export function due(iso: string | null, now: string | null): DueInfo | null {
  if (!iso) return null;
  const at = fmtDayTime(iso);
  if (!now) return { kind: "later", overdue: false, label: `Due ${at}`, at };
  const diff = new Date(iso).getTime() - new Date(now).getTime();
  if (diff < 0) return { kind: "overdue", overdue: true, label: `Overdue by ${span(diff)}`, at };
  return { kind: diff <= SOON_MS ? "soon" : "later", overdue: false, label: `Due in ${span(diff)}`, at };
}

/** Sort key for "due soonest first"; no due time sorts last. */
export function dueKey(iso: string | null): number {
  return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;
}

export const STATE_LABEL: Record<State, string> = {
  received: "Received",
  validating: "Validating",
  invalid: "Invalid",
  duplicate: "Duplicate",
  valid: "Valid",
  screening_queue: "Screening queue",
  scheduling: "Scheduling",
  human_review: "Human review",
  auto_rejected: "Auto-rejected",
  interview_scheduled: "Interview scheduled",
  interview_done: "Interview done",
  awaiting_decision: "Awaiting decision",
  offer: "Offer",
  rejected: "Rejected",
  on_hold: "On hold",
};

/** Group order follows the reader's questions: what needs a person, what is
 * blocked, what is moving, what is closed. */
export const STATE_ORDER: State[] = [
  "human_review",
  "awaiting_decision",
  "screening_queue",
  "on_hold",
  "invalid",
  "duplicate",
  "received",
  "validating",
  "valid",
  "scheduling",
  "interview_scheduled",
  "interview_done",
  "offer",
  "rejected",
  "auto_rejected",
];

export type Tone = "neutral" | "danger" | "warning" | "success";

export const STATE_TONE: Record<State, Tone> = {
  received: "neutral",
  validating: "neutral",
  invalid: "danger",
  duplicate: "warning",
  valid: "neutral",
  screening_queue: "warning",
  scheduling: "neutral",
  human_review: "warning",
  auto_rejected: "danger",
  interview_scheduled: "neutral",
  interview_done: "neutral",
  awaiting_decision: "warning",
  offer: "success",
  rejected: "danger",
  on_hold: "warning",
};

export function stateLabel(s: string): string {
  return STATE_LABEL[s as State] ?? s.replace(/_/g, " ");
}

const ROLE_LABEL: Record<string, string> = {
  agent: "agent",
  recruiter: "recruiter",
  hm: "hiring manager",
  interviewer: "interviewer",
};

/** "recruiter:Rina" reads "Rina, recruiter"; "agent:scheduler" reads "Scheduler agent". */
export function owner(raw: string): string {
  if (!raw) return "Nobody";
  if (raw === "jev") return "JEV";
  const i = raw.indexOf(":");
  if (i < 0) return raw;
  const kind = raw.slice(0, i);
  const who = raw.slice(i + 1);
  if (kind === "agent") return `${who.charAt(0).toUpperCase()}${who.slice(1)} agent`;
  return `${who}, ${ROLE_LABEL[kind] ?? kind}`;
}

/** True for owners that are a person (a recruiter or a hiring manager). */
export function isPersonDecider(raw: string): boolean {
  return raw.startsWith("recruiter:") || raw.startsWith("hm:");
}

export const ACTION_LABEL: Record<HumanAction, string> = {
  schedule: "Schedule an interview",
  screen: "Send to screening",
  reject: "Reject",
  hold: "Put on hold",
  offer: "Make an offer",
  keep_both: "Keep both applications",
  mark_duplicate: "Mark as duplicate",
  reopen: "Reopen",
};

export const DECIDED_BY_LABEL: Record<string, string> = { rule: "Rule", jev: "JEV", human: "Human" };

export const STAGE_LABEL: Record<string, string> = {
  validation: "Validation",
  dedupe: "Dedupe",
  route: "Routing",
  schedule: "Scheduling",
  human: "Human decision",
};

/** Decision values read as words: "human_review" becomes "human review". */
export function decisionLabel(d: string): string {
  return STATE_LABEL[d as State] ?? d.replace(/_/g, " ");
}

export function confidence(c: number | null): string {
  return c === null || c === undefined ? "n/a" : `${Math.round(c * 100)}%`;
}

/** The JEV floor: verdicts under it are not acted on (API policy). */
export const JEV_FLOOR = 0.6;

export type SealKind = "rule" | "human" | "jev" | "routed" | "abstained" | "unverified";

export interface SealInput {
  decidedBy: string;
  verified: boolean;
  stamp: string | null;
  confidence: number | null;
  ruleHits: string[];
  decision?: string;
  jev?: unknown;
}

/** Which seal a decision carries. Green ("jev") is reserved for JEV acting on
 * its own. JEV choosing a person is "routed" (neutral, its confidence is real),
 * and JEV leaning to an action under the floor is "abstained" (API sets
 * JEV_LOW_CONFIDENCE; the UI follows the data, it does not re-apply the floor). */
export function sealOf(d: SealInput): SealKind {
  if (d.stamp || !d.verified) return "unverified";
  if (d.ruleHits.includes("JEV_LOW_CONFIDENCE")) return "abstained";
  if (d.decidedBy === "human") return "human";
  if (d.decidedBy === "jev") return d.decision === "human_review" ? "routed" : "jev";
  return "rule";
}

/** What JEV leaned to on an abstained call, as words, or null. */
export function leanedTo(d: SealInput): string | null {
  const j = d.jev as { choice?: string; probabilities?: Record<string, number> } | null | undefined;
  if (!j) return null;
  if (typeof j.choice === "string") return decisionLabel(j.choice);
  const top = Object.entries(j.probabilities ?? {}).sort((a, b) => b[1] - a[1])[0];
  return top ? decisionLabel(top[0]) : null;
}

export function sealLabel(d: SealInput): string {
  switch (sealOf(d)) {
    case "unverified":
      return d.stamp ?? "UNVERIFIED BY JEV";
    case "abstained":
      return `JEV abstained, ${confidence(d.confidence)} < ${Math.round(JEV_FLOOR * 100)}%, routed to human`;
    case "routed":
      return "JEV routed to human";
    case "human":
      return "Human, signed";
    case "jev":
      return "Verified by JEV";
    default:
      return "Rule, deterministic";
  }
}

/** Rule hits worth showing as chips: the match pointer and the floor flag are
 * already said by the compare block and the seal. */
export function topHits(hits: string[], n = 3): string[] {
  return hits.filter((h) => !h.startsWith("MATCHES:") && h !== "JEV_LOW_CONFIDENCE").slice(0, n);
}

export type QueueGroup = "duplicate" | "borderline" | "no_slot" | "awaiting" | "screening" | "on_hold" | "rejection";

export const QUEUE_GROUP_LABEL: Record<QueueGroup, string> = {
  duplicate: "Possible duplicate",
  borderline: "Borderline route",
  no_slot: "No interview slot",
  awaiting: "Awaiting decision after interview",
  screening: "Screening queue",
  on_hold: "On hold",
  rejection: "Rejection notice",
};

export const QUEUE_GROUP_ORDER: QueueGroup[] = ["duplicate", "borderline", "no_slot", "awaiting", "screening", "on_hold", "rejection"];

/** Why a case waits on a person, from its state and the agent's last ruling. */
export function queueGroup(a: { state: string; ruling?: { stage: string; decision: string } | null; match?: unknown }): QueueGroup {
  if (a.state === "auto_rejected") return "rejection";
  if (a.state === "awaiting_decision") return "awaiting";
  if (a.state === "screening_queue") return "screening";
  if (a.state === "on_hold") return "on_hold";
  if (a.match || a.ruling?.stage === "dedupe") return "duplicate";
  if (a.ruling?.stage === "schedule" || a.ruling?.decision === "no_slot") return "no_slot";
  return "borderline";
}

/** Pluralise a count: plural(3, "interview") is "3 interviews". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The role as submitted; an unknown or empty role reads as such instead of a blank. */
export function roleOf(a: { roleTitle?: string | null; roleCode?: string | null }): string {
  return a.roleTitle?.trim() || (a.roleCode?.trim() ? `Role ${a.roleCode.trim()}` : "Role not given");
}
