// Domain types shared by more than one module (public index only).

export type Role = {
  code: string;
  title: string;
  status: "open" | "closed";
  mustHave: string[];
  niceToHave: string[];
  minYears: number;
  location: string;
  remoteOk: boolean;
  hiringManager: string;
};

export type DecidedBy = "rule" | "jev" | "human";

/** One audited decision. `reason` is mandatory and enforced by the schema too. */
export type Decision<D extends string = string> = {
  stage: "validation" | "dedupe" | "route" | "schedule" | "human";
  decidedBy: DecidedBy;
  verified: boolean;
  stamp: string | null;
  decision: D;
  confidence: number | null;
  reason: string;
  ruleHits: string[];
  jev: unknown;
};

/** Plain words for decision codes, used inside audit reasons (codes stay in `decision` and rule hits). */
export const DECISION_LABEL: Record<string, string> = {
  scheduling: "Scheduling",
  screening_queue: "Screening queue",
  human_review: "Human review",
  auto_rejected: "Auto-reject",
  mark_duplicate: "Mark duplicate",
  keep_both: "Keep both",
  no_slot: "No interview slot",
};

export const label = (code: string): string => DECISION_LABEL[code] ?? code.replace(/_/g, " ");

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
