// Data layer for the hiring pipeline API (apps/api, mounted under /api).
// Plain fetch with hand-written types that mirror the API contract: the API
// routes are still moving, and a typed hc client would couple this build to
// every in-flight change there. The base URL is baked in at bundle time by
// build.ts (define process.env.API_URL), the same variable server.ts uses for
// its CSP connect-src, so the two can never point at different origins.

export type State =
  | "received"
  | "validating"
  | "invalid"
  | "duplicate"
  | "valid"
  | "screening_queue"
  | "scheduling"
  | "human_review"
  | "auto_rejected"
  | "interview_scheduled"
  | "interview_done"
  | "awaiting_decision"
  | "offer"
  | "rejected"
  | "on_hold";

export type HumanAction = "schedule" | "screen" | "reject" | "hold" | "offer" | "keep_both" | "mark_duplicate" | "reopen";

export interface AppSummary {
  id: string;
  ref: string;
  name: string;
  email: string;
  roleCode: string;
  roleTitle: string;
  state: State;
  owner: string;
  nextAction: string;
  nextActionDue: string | null;
  score: number | null;
  duplicateOf: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface AppDetail extends AppSummary {
  phone: string | null;
  yearsExp: number | null;
  location: string | null;
  skills: string[];
  cvText: string | null;
  consent: boolean;
  availability: { start: string; end: string }[];
  summary: string | null;
  summaryStatus: string;
}

export interface LogRow {
  id: number;
  appId: string;
  name?: string | null;
  fromState: State | null;
  toState: State;
  owner: string;
  nextAction: string;
  nextActionDue: string | null;
  actor: string;
  note: string;
  at: string;
}

export interface Decision {
  id: number;
  appId: string;
  name?: string | null;
  stage: "validation" | "dedupe" | "route" | "schedule" | "human";
  decidedBy: "rule" | "jev" | "human";
  verified: boolean;
  stamp: string | null;
  decision: string;
  confidence: number | null;
  reason: string;
  ruleHits: string[];
  jev: unknown;
  at: string;
}

export interface Interview {
  id: number;
  appId: string;
  name?: string;
  interviewerId: string;
  interviewerName: string;
  start: string;
  end: string;
  status: "scheduled" | "done" | "no_show";
  attempt: number;
}

export interface Detail {
  app: AppDetail;
  log: LogRow[];
  decisions: Decision[];
  errors: { code: string; field: string; message: string }[];
  interviews: Interview[];
  duplicates: { id: string; name: string; state: State }[];
  actions: HumanAction[];
}

export interface Stats {
  now: string;
  total: number;
  byState: Record<State, number>;
  decisions: { rule: number; jev: number; human: number };
  jevVerified: number;
  unverified: number;
  humanQueue: number;
}

export interface Schedule {
  now: string;
  interviewers: { id: string; name: string; roleCodes: string[]; busy: { start: string; end: string; label: string }[] }[];
  interviews: Interview[];
  grid: string[];
}

export type QueueItem = AppSummary & { actions: HumanAction[] };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Api {
  stats(): Promise<Stats>;
  applications(params?: { state?: string; q?: string }): Promise<{ items: AppSummary[] }>;
  application(id: string): Promise<Detail>;
  schedule(): Promise<Schedule>;
  audit(params?: { decidedBy?: string; stage?: string; verified?: string }): Promise<{ items: Decision[] }>;
  queue(): Promise<{ items: QueueItem[] }>;
  decide(id: string, body: { action: HumanAction; reason: string; actor: string }): Promise<{ idempotent: boolean; app: AppSummary }>;
  advance(hours: number): Promise<{ now: string; done: string[]; noShows: string[] }>;
  reset(): Promise<{ processed: number; invariants: unknown }>;
}

function readBase(): string {
  // 1. Runtime: /env.js (server.ts) sets window.__API_URL__ from the web
  //    process's API_URL. 2. Build time: build.ts defines process.env.API_URL.
  const runtime = typeof window === "undefined" ? undefined : (window as { __API_URL__?: string }).__API_URL__;
  if (runtime) return runtime;
  try {
    return process.env.API_URL ?? "http://localhost:3001";
  } catch {
    return "http://localhost:3001";
  }
}

function query(params: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createApi(base: string = readBase()): Api {
  const root = `${base.replace(/\/$/, "")}/api`;
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(root + path, {
        ...init,
        headers: init?.body ? { "content-type": "application/json" } : undefined,
      });
    } catch {
      throw new ApiError("The API did not answer. Check that it is running, then try again.", 0);
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new ApiError(body?.error ?? `Request failed with status ${res.status}.`, res.status);
    return body as T;
  }
  const post = <T>(path: string, data: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(data) });
  return {
    stats: () => call("/stats"),
    applications: (p) => call(`/applications${query(p)}`),
    application: (id) => call(`/applications/${encodeURIComponent(id)}`),
    schedule: () => call("/schedule"),
    audit: (p) => call(`/audit${query(p)}`),
    queue: () => call("/decisions/queue"),
    decide: (id, body) => post(`/decisions/${encodeURIComponent(id)}`, body),
    advance: (hours) => post("/sim/advance", { hours }),
    reset: () => post("/pipeline/reset", {}),
  };
}
