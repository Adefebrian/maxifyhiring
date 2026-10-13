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
  overdue: boolean;
  label: string;
  at: string;
}

/** Due relative to the sim clock: "Due in 25 h" or "Overdue by 3 h". */
export function due(iso: string | null, now: string | null): DueInfo | null {
  if (!iso) return null;
  const at = fmtDayTime(iso);
  if (!now) return { overdue: false, label: `Due ${at}`, at };
  const diff = new Date(iso).getTime() - new Date(now).getTime();
  if (diff < 0) return { overdue: true, label: `Overdue by ${span(diff)}`, at };
  return { overdue: false, label: `Due in ${span(diff)}`, at };
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
  return c === null || c === undefined ? "n/a" : c.toFixed(2);
}

/** Pluralise a count: plural(3, "interview") is "3 interviews". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The role as submitted; an unknown or empty role reads as such instead of a blank. */
export function roleOf(a: { roleTitle?: string | null; roleCode?: string | null }): string {
  return a.roleTitle?.trim() || (a.roleCode?.trim() ? `Role ${a.roleCode.trim()}` : "Role not given");
}
