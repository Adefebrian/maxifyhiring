// Duplicate detection. Exact matches (same email for the same role) are a
// rule call. Fuzzy matches (same phone, or a near-identical name) are a soft
// call, so JEV judges them; without a verified JEV answer they go to a human.
import { askChoice, MIN_ACT_CONFIDENCE, UNVERIFIED, type JevOptions } from "../jev";
import type { Decision } from "../shared";

export type Existing = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roleCode: string | null;
  submittedAt: string | null;
};

export type Match =
  | { kind: "none" }
  | { kind: "exact"; of: string; ruleHits: string[] }
  | { kind: "fuzzy"; of: string; ruleHits: string[]; similarity: number; samePhone: boolean; daysApart: number };

const WINDOW_DAYS = 90;
const NAME_THRESHOLD = 0.9;

// Keep letters from every script. Folding to [a-z] turned every non-Latin
// name into "", and two empty names compared as identical (F3).
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L} ]/gu, "").replace(/\s+/g, " ").trim();
}

/** Normalised Levenshtein similarity in [0, 1]. */
export function nameSimilarity(a: string, b: string): number {
  const x = fold(a);
  const y = fold(b);
  // A name with no letters carries no identity signal: never a match.
  if (!x.length || !y.length) return 0;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

export function findDuplicate(c: Existing, primaries: Existing[]): Match {
  const sameRole = primaries.filter((p) => p.id !== c.id && p.roleCode === c.roleCode);
  const exact = sameRole.find((p) => p.email && p.email === c.email);
  if (exact) return { kind: "exact", of: exact.id, ruleHits: ["DUP_EXACT_EMAIL_ROLE"] };

  const t = c.submittedAt ? Date.parse(c.submittedAt) : NaN;
  for (const p of sameRole) {
    const pt = p.submittedAt ? Date.parse(p.submittedAt) : NaN;
    const daysApart = Number.isFinite(t) && Number.isFinite(pt) ? Math.abs(t - pt) / 86_400_000 : 0;
    if (daysApart > WINDOW_DAYS) continue;
    const samePhone = !!c.phone && c.phone === p.phone;
    const similarity = c.name && p.name ? nameSimilarity(c.name, p.name) : 0;
    if (samePhone || similarity >= NAME_THRESHOLD) {
      const ruleHits = [samePhone ? "DUP_SAME_PHONE" : null, similarity >= NAME_THRESHOLD ? "DUP_NAME_SIMILAR" : null].filter(Boolean) as string[];
      ruleHits.push(`MATCHES:${p.id}`);
      return { kind: "fuzzy", of: p.id, ruleHits, similarity: Math.round(similarity * 100) / 100, samePhone, daysApart: Math.round(daysApart) };
    }
  }
  return { kind: "none" };
}

export type DupChoice = "mark_duplicate" | "keep_both" | "human_review";

/** Judge a fuzzy match. Only anonymised features leave the system, never PII. */
export async function judgeFuzzy(
  m: Extract<Match, { kind: "fuzzy" }>,
  emailDomainsMatch: boolean,
  jev: JevOptions,
): Promise<Decision<DupChoice>> {
  const v = await askChoice(
    {
      task: "hiring pipeline duplicate check",
      same_phone: m.samePhone,
      name_similarity: m.similarity,
      email_domain_match: emailDomainsMatch,
      days_between_submissions: m.daysApart,
      same_role: true,
    },
    {
      type: "choice",
      instructions:
        "Two applications for the same role look related. Decide if the new one is the same person applying twice. Prefer human_review when the signals disagree.",
      criteria: {
        mark_duplicate: "Clearly the same person, link the new application to the earlier one",
        keep_both: "Different people, process both independently",
        human_review: "Signals conflict, a recruiter must check",
      },
    },
    jev,
  );
  const hits = m.ruleHits.filter((h) => !h.startsWith("MATCHES:")).join(", ");
  if (v.verified && v.choice !== "human_review" && v.confidence < MIN_ACT_CONFIDENCE) {
    return {
      stage: "dedupe",
      decidedBy: "jev",
      verified: true,
      stamp: null,
      decision: "human_review",
      confidence: v.confidence,
      reason: `JEV leaned ${v.choice} at ${Math.round(v.confidence * 100)}%, below the ${MIN_ACT_CONFIDENCE * 100}% floor for acting alone, so a recruiter confirms the possible duplicate of ${m.of} (${hits}, name similarity ${m.similarity}).`,
      ruleHits: [...m.ruleHits, "JEV_LOW_CONFIDENCE"],
      jev: { model: v.model, choice: v.choice, probabilities: v.probabilities },
    };
  }
  if (v.verified) {
    return {
      stage: "dedupe",
      decidedBy: "jev",
      verified: true,
      stamp: null,
      decision: v.choice,
      confidence: v.confidence,
      reason: `JEV chose ${v.choice} (${Math.round(v.confidence * 100)}%) for a possible duplicate of ${m.of}: ${hits}, name similarity ${m.similarity}, ${m.daysApart} days apart.`,
      ruleHits: m.ruleHits,
      jev: { model: v.model, probabilities: v.probabilities },
    };
  }
  return {
    stage: "dedupe",
    decidedBy: "rule",
    verified: false,
    stamp: UNVERIFIED,
    decision: "human_review",
    confidence: null,
    reason: `Possible duplicate of ${m.of} (${hits}). JEV unavailable (${v.error}), fallback rule sends fuzzy matches to a recruiter.`,
    ruleHits: m.ruleHits,
    jev: { error: v.error },
  };
}
