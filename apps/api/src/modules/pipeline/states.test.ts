import { describe, expect, test } from "bun:test";
import { ACTION_TARGET, AUTOMATED, canTransition, HUMAN_ACTIONS, STATES, TRANSITIONS } from "./states";

const known = new Set<string>(STATES);
const TERMINAL = ["invalid", "duplicate", "offer", "rejected"] as const;

describe("state machine", () => {
  test("every transition target is a known state", () => {
    for (const s of STATES) for (const t of TRANSITIONS[s]) expect(known.has(t)).toBe(true);
  });

  test("terminal states have no exits", () => {
    for (const s of TERMINAL) expect(TRANSITIONS[s]).toEqual([]);
  });

  test("automated, action targets and human action states are known", () => {
    for (const s of AUTOMATED) expect(known.has(s)).toBe(true);
    for (const t of Object.values(ACTION_TARGET)) expect(known.has(t)).toBe(true);
    for (const s of Object.keys(HUMAN_ACTIONS)) expect(known.has(s)).toBe(true);
  });

  test("every offered human action is a legal transition", () => {
    for (const [s, actions] of Object.entries(HUMAN_ACTIONS)) {
      for (const a of actions!) expect(canTransition(s as never, ACTION_TARGET[a])).toBe(true);
    }
  });

  test("illegal moves are refused", () => {
    expect(canTransition("received", "offer")).toBe(false);
    expect(canTransition("offer", "rejected")).toBe(false);
  });
});
