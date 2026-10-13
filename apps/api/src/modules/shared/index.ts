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
