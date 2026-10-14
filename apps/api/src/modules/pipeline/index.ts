// Public surface of the pipeline module.
import { createPipelineRoutes } from "./routes";
import type { PipelineDeps } from "./runner";

export { checkInvariants } from "./invariants";
export type { InvariantReport } from "./invariants";
export { intake, process, runAll, RECRUITER } from "./runner";
export type { PipelineDeps, Summarize } from "./runner";
export { importBatch, reset, seedApplications, seedReference, wipe } from "./seed";
export { advance } from "./sim";
export { decide, allowedActions } from "./decisions";
export { STATES, TRANSITIONS, IllegalTransition, canTransition } from "./states";
export type { State, HumanAction } from "./states";
export { getApp, now, setNow, transition } from "./store";
export type { AppRow, Faults } from "./store";

export function createPipelineModule(deps: PipelineDeps) {
  return createPipelineRoutes(deps);
}
