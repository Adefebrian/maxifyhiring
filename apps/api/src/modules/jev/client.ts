// JEV (TypeSafe systemone) client. A port of the JAL plugin client
// (mcp/jal-design/jev.ts): same endpoint, same retry policy, same
// "UNVERIFIED BY JEV" outage stamp. Two additions for a runtime pipeline:
//   1. every answer is schema-checked before anything acts on it (F2), and
//   2. callers only ever get a typed verdict or a typed failure, never a throw.
import { z } from "zod";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const NO_RETRY = new Set([401, 403, 422]);
const RETRY = new Set([429, 500, 502, 503, 504, 529]);

export const UNVERIFIED = "UNVERIFIED BY JEV" as const;

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
};

export type ChoiceVerdict<C extends string> =
  | {
      verified: true;
      model: string;
      choice: C;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { verified: false; stamp: typeof UNVERIFIED; error: string };

const choiceAnswer = z.object({
  choice: z.string(),
  confidence: z.number().finite().min(0).max(1),
  probabilities: z.record(z.number().finite()).default({}),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(body: string, opts: JevOptions): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const apiKey = opts.apiKey ?? process.env.JEV_API_KEY;
  if (!apiKey) return { ok: false, error: "missing JEV_API_KEY" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const attempts = (opts.retries ?? 2) + 1;
  const base = opts.baseDelayMs ?? 300;
  let lastError = "unknown error";

  for (let i = 0; i < attempts; i++) {
    const last = i === attempts - 1;
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      lastError = name === "TimeoutError" || name === "AbortError" ? "request timed out" : "network error";
      if (!last) {
        await sleep(base * 2 ** i);
        continue;
      }
      return { ok: false, error: lastError };
    }
    if (res.ok) {
      try {
        return { ok: true, json: await res.json() };
      } catch {
        return { ok: false, error: "invalid JSON response" };
      }
    }
    lastError = `JEV request failed: ${res.status}`;
    if (NO_RETRY.has(res.status) || !RETRY.has(res.status) || last) return { ok: false, error: lastError };
    await sleep(base * 2 ** i);
  }
  return { ok: false, error: lastError };
}

/**
 * Ask JEV one choice question. The answer must name one of the offered
 * options with a confidence in [0, 1]; anything else is treated exactly like
 * an outage, so a bad answer can never route an application.
 */
export async function askChoice<C extends string>(
  state: Record<string, unknown>,
  question: ChoiceQuestion & { criteria: Record<C, string> },
  opts: JevOptions = {},
): Promise<ChoiceVerdict<C>> {
  const fail = (error: string): ChoiceVerdict<C> => ({ verified: false, stamp: UNVERIFIED, error });
  const res = await post(JSON.stringify({ model: "jev-latest", state, questions: { decision: question } }), opts);
  if (!res.ok) return fail(res.error);

  const json = res.json as { model?: unknown; answers?: Record<string, unknown> } | null;
  const raw = json && typeof json === "object" ? (json.answers ?? json)?.["decision" as never] : undefined;
  const parsed = choiceAnswer.safeParse(raw);
  if (!parsed.success) return fail("malformed answer: " + parsed.error.issues.map((i) => `${i.path.join(".") || "answer"} ${i.message}`).join("; "));

  const options = Object.keys(question.criteria);
  if (!options.includes(parsed.data.choice)) return fail(`malformed answer: unknown choice "${parsed.data.choice.slice(0, 40)}"`);

  return {
    verified: true,
    model: typeof json?.model === "string" ? json.model : "jev",
    choice: parsed.data.choice as C,
    confidence: parsed.data.confidence,
    probabilities: parsed.data.probabilities,
  };
}
