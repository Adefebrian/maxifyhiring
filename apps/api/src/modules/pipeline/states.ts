// The application state machine: the one table of legal transitions, which
// states the agents advance on their own, and what a human can do where.

export const STATES = [
  "received",
  "validating",
  "invalid",
  "duplicate",
  "valid",
  "screening_queue",
  "scheduling",
  "human_review",
  "auto_rejected",
  "interview_scheduled",
  "interview_done",
  "awaiting_decision",
  "offer",
  "rejected",
  "on_hold",
] as const;

export type State = (typeof STATES)[number];

export const TRANSITIONS: Record<State, readonly State[]> = {
  received: ["validating"],
  validating: ["invalid", "duplicate", "valid", "human_review"],
  invalid: [],
  duplicate: [],
  valid: ["scheduling", "screening_queue", "human_review", "auto_rejected"],
  screening_queue: ["scheduling", "rejected", "on_hold"],
  scheduling: ["interview_scheduled", "human_review"],
  human_review: ["scheduling", "screening_queue", "rejected", "on_hold", "valid", "duplicate"],
  auto_rejected: ["human_review"],
  interview_scheduled: ["interview_done", "scheduling", "human_review"],
  interview_done: ["awaiting_decision"],
  awaiting_decision: ["offer", "rejected", "on_hold"],
  on_hold: ["scheduling", "offer", "rejected"],
  offer: [],
  rejected: [],
};

/** States an agent moves forward without waiting for a person. */
export const AUTOMATED: readonly State[] = ["received", "validating", "valid", "scheduling", "interview_done"];

export type HumanAction = "schedule" | "screen" | "reject" | "hold" | "offer" | "keep_both" | "mark_duplicate" | "reopen";

export const ACTION_TARGET: Record<HumanAction, State> = {
  schedule: "scheduling",
  screen: "screening_queue",
  reject: "rejected",
  hold: "on_hold",
  offer: "offer",
  keep_both: "valid",
  mark_duplicate: "duplicate",
  reopen: "human_review",
};

/** Which human actions make sense in which state (the UI shows exactly these). */
export const HUMAN_ACTIONS: Partial<Record<State, readonly HumanAction[]>> = {
  human_review: ["schedule", "screen", "hold", "reject"],
  screening_queue: ["schedule", "hold", "reject"],
  awaiting_decision: ["offer", "hold", "reject"],
  on_hold: ["schedule", "offer", "reject"],
  auto_rejected: ["reopen"],
};

/** Dedupe reviews add two more choices to the human_review set. */
export const DEDUPE_ACTIONS: readonly HumanAction[] = ["keep_both", "mark_duplicate", "reject"];

export class IllegalTransition extends Error {
  constructor(
    readonly appId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal transition for ${appId}: ${from} -> ${to}`);
    this.name = "IllegalTransition";
  }
}

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
