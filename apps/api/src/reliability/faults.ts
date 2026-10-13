// Reliability harness: builds pipeline deps on an in-memory database with a
// fake JEV transport, a fake summariser, and an optional crash hook, so every
// failure type (F1 to F8) can be injected without touching the network.
import { openDb } from "../core/db";
import type { JevOptions } from "../modules/jev";
import type { Faults, PipelineDeps, Summarize } from "../modules/pipeline";

export type FetchImpl = typeof fetch;

/** Fast retry and timeout settings so outage tests finish in milliseconds. */
export const FAST: Required<Pick<JevOptions, "retries" | "baseDelayMs" | "timeoutMs">> = { retries: 2, baseDelayMs: 1, timeoutMs: 30 };

type Counted = FetchImpl & { calls: number };

function counted(fn: (init?: RequestInit) => Promise<Response>): Counted {
  const f = (async (_input: unknown, init?: RequestInit) => {
    f.calls++;
    return fn(init);
  }) as unknown as Counted;
  f.calls = 0;
  return f;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A Response-like object whose json() yields a value JSON cannot encode (NaN). */
const rawJson = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as unknown as Response;

/** The real JEV answer shape for one choice question. */
export function answer(choice: string, confidence = 0.9, model = "jev-test") {
  return { model, answers: { decision: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } } };
}

/** Choice picker for a well-behaved JEV: reads the offered options from the request. */
export type Picker = (options: string[], state: Record<string, unknown>) => string;

export const fakeFetch = {
  /** Healthy JEV. Picks with `pick` (default: first option), optionally after a delay. */
  ok(pick: Picker = (o) => o[0]!, delayMs = 0): Counted {
    return counted(async (init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const options = Object.keys(body?.questions?.decision?.criteria ?? {});
      if (delayMs) await abortableSleep(delayMs, init?.signal ?? undefined);
      return json(answer(pick(options, body.state ?? {})));
    });
  },
  /** Never answers; honours the abort signal like the real fetch does. */
  timeout(): Counted {
    return counted((init) => abortableSleep(60_000, init?.signal ?? undefined).then(() => json({})));
  },
  status(code: number): Counted {
    return counted(async () => json({ error: "upstream" }, code));
  },
  /** 429 on every call: retries are exhausted. */
  rateLimited(): Counted {
    return fakeFetch.status(429);
  },
  /** `n` 429 responses, then a healthy answer. */
  burstThenOk(n: number, pick: Picker = (o) => o[0]!): Counted {
    const healthy = fakeFetch.ok(pick);
    let left = n;
    return counted(async (init) => (left-- > 0 ? json({ error: "slow down" }, 429) : healthy(ENDPOINT_STUB, init)));
  },
  network(): Counted {
    return counted(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
  },
  invalidJson(): Counted {
    return counted(async () => new Response("<html>502 Bad Gateway</html>", { status: 200 }));
  },
  unknownChoice(): Counted {
    return counted(async () => json(answer("auto_rejected")));
  },
  missingAnswers(): Counted {
    return counted(async () => json({ model: "jev-test" }));
  },
  confidence(value: number): Counted {
    return counted(async () => rawJson({ model: "jev-test", answers: { decision: { type: "choice", choice: "human_review", confidence: value, probabilities: {} } } }));
  },
};

const ENDPOINT_STUB = "https://jev.invalid";

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}

export const fakeSummarizer = {
  ok: (async (cv: string) => `Summary of ${cv.length} characters.`) as Summarize,
  throws: (async () => {
    throw new Error("openai 500");
  }) as Summarize,
  throwsSync: ((() => {
    throw new Error("sync boom");
  }) as unknown) as Summarize,
  /** Never resolves: only the pipeline's own timeout ends it. */
  hangs: (() => new Promise<string>(() => {})) as Summarize,
  garbage: (value: unknown) => (async () => value) as unknown as Summarize,
};

/** A crash hook that throws once the given application reaches `to` (or any state when omitted). */
export function crashOn(match: { appId?: string; to?: string; times?: number } = {}): Faults & { fired: number } {
  const hook = {
    fired: 0,
    afterStateUpdate(appId: string, to: string) {
      if (match.appId && match.appId !== appId) return;
      if (match.to && match.to !== to) return;
      if (match.times !== undefined && hook.fired >= match.times) return;
      hook.fired++;
      throw new Error(`injected crash: ${appId} -> ${to}`);
    },
  };
  return hook;
}

/** Deps on a fresh in-memory database. JEV defaults to an explicit missing key, so no test ever reaches the network. */
export function makeDeps(opts: { fetch?: FetchImpl; apiKey?: string; jev?: JevOptions; summarize?: Summarize; summaryTimeoutMs?: number; faults?: Faults } = {}): PipelineDeps {
  const jev: JevOptions = opts.fetch
    ? { apiKey: opts.apiKey ?? "test-key", fetchImpl: opts.fetch, ...FAST, ...opts.jev }
    : { apiKey: opts.apiKey ?? "", ...FAST, ...opts.jev };
  return { db: openDb(":memory:"), jev, summarize: opts.summarize, summaryTimeoutMs: opts.summaryTimeoutMs, faults: opts.faults };
}
