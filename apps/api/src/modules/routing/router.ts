// Routing. A transparent rule score places each valid application in a band.
// Clear bands are a rule decision. A score near a band edge, or signals that
// disagree, is a soft call that JEV judges. A borderline case is never
// auto-rejected: JEV is not even offered that option, and the fallback
// without a verified JEV answer is a human.
import { askChoice, MIN_ACT_CONFIDENCE, UNVERIFIED, type JevOptions } from "../jev";
import { label, type Decision, type Role } from "../shared";

export type Route = "scheduling" | "screening_queue" | "human_review" | "auto_rejected";

export type ScoreInput = { yearsExp: number; location: string | null; skills: string[] };

export type Score = {
  total: number;
  skills: number;
  experience: number;
  location: number;
  mustMatched: string[];
  mustMissing: string[];
  hits: string[];
};

export const BANDS = { schedule: 70, screen: 50, reject: 35 } as const;
const EDGE = 5;

export function score(c: ScoreInput, role: Role): Score {
  const has = new Set(c.skills);
  const mustMatched = role.mustHave.filter((s) => has.has(s));
  const mustMissing = role.mustHave.filter((s) => !has.has(s));
  const nice = role.niceToHave.filter((s) => has.has(s)).length;
  const skills = (mustMatched.length / Math.max(1, role.mustHave.length)) * 50 + (nice / Math.max(1, role.niceToHave.length)) * 10;
  const experience = c.yearsExp >= role.minYears ? 25 : role.minYears > 0 ? (25 * c.yearsExp) / role.minYears : 25;
  const sameCity = !!c.location && c.location.toLowerCase() === role.location.toLowerCase();
  const location = sameCity || role.remoteOk ? 15 : 0;
  const total = Math.round(skills + experience + location);

  const hits = [
    `SKILLS_MUST ${mustMatched.length}/${role.mustHave.length}`,
    `EXPERIENCE ${c.yearsExp}y vs ${role.minYears}y`,
    sameCity ? "LOCATION_MATCH" : role.remoteOk ? "REMOTE_OK" : "LOCATION_MISMATCH",
  ];
  return { total, skills: Math.round(skills), experience: Math.round(experience), location, mustMatched, mustMissing, hits };
}

function band(total: number): Route {
  if (total >= BANDS.schedule) return "scheduling";
  if (total >= BANDS.screen) return "screening_queue";
  if (total >= BANDS.reject) return "human_review";
  return "auto_rejected";
}

/** Why this case is a soft call, or null when the rule band is clear. */
export function softSignal(s: Score, c: ScoreInput, role: Role): string | null {
  const edge = Object.entries(BANDS).find(([, t]) => Math.abs(s.total - t) <= EDGE);
  if (edge) return `score ${s.total} within ${EDGE} of the ${edge[1]} threshold`;
  if (s.mustMissing.length === 0 && c.yearsExp < role.minYears - 1) return "all must-have skills but well under the experience bar";
  if (c.yearsExp >= role.minYears * 2 && s.mustMatched.length / Math.max(1, role.mustHave.length) < 0.5) return "very experienced but under half the must-have skills";
  return null;
}

export async function route(c: ScoreInput, role: Role, jev: JevOptions): Promise<{ score: Score; decision: Decision<Route> }> {
  const s = score(c, role);
  const ruleBand = band(s.total);
  const soft = softSignal(s, c, role);
  const breakdown = `skills ${s.skills}/60, experience ${s.experience}/25, location ${s.location}/15`;

  if (!soft) {
    return {
      score: s,
      decision: {
        stage: "route",
        decidedBy: "rule",
        verified: true,
        stamp: null,
        decision: ruleBand,
        confidence: 1,
        reason: `Score ${s.total} (${breakdown}) is clearly in the ${label(ruleBand)} band.${s.mustMissing.length ? ` Missing: ${s.mustMissing.join(", ")}.` : ""}`,
        ruleHits: s.hits,
        jev: null,
      },
    };
  }

  const v = await askChoice(
    {
      task: "hiring pipeline routing",
      role: role.title,
      score: s.total,
      thresholds: BANDS,
      skills_must_matched: `${s.mustMatched.length}/${role.mustHave.length}`,
      skills_missing: s.mustMissing,
      years_experience: c.yearsExp,
      min_years: role.minYears,
      location_fit: s.location > 0,
      rule_band: ruleBand,
      why_soft: soft,
    },
    {
      type: "choice",
      instructions: "Pick the next stage for a borderline applicant. Interview only when the evidence supports it; send conflicting signals to a person.",
      criteria: {
        scheduling: "Strong enough to book an interview now",
        screening_queue: "Plausible, a recruiter phone screen comes first",
        human_review: "Signals conflict, the hiring manager must decide",
      },
    },
    jev,
  );

  if (v.verified && v.confidence < MIN_ACT_CONFIDENCE) {
    return {
      score: s,
      decision: {
        stage: "route",
        decidedBy: "jev",
        verified: true,
        stamp: null,
        decision: "human_review",
        confidence: v.confidence,
        reason: `Soft call (${soft}). JEV leaned to ${label(v.choice)} at ${Math.round(v.confidence * 100)}%, below the ${MIN_ACT_CONFIDENCE * 100}% floor for acting alone, so the hiring manager decides. Score ${s.total} (${breakdown}).`,
        ruleHits: [...s.hits, "SOFT_CALL", "JEV_LOW_CONFIDENCE"],
        jev: { model: v.model, choice: v.choice, probabilities: v.probabilities },
      },
    };
  }
  if (v.verified) {
    return {
      score: s,
      decision: {
        stage: "route",
        decidedBy: "jev",
        verified: true,
        stamp: null,
        decision: v.choice,
        confidence: v.confidence,
        reason: `Soft call (${soft}). JEV chose ${label(v.choice)} at ${Math.round(v.confidence * 100)}% over the ${label(ruleBand)} band. Score ${s.total} (${breakdown}).`,
        ruleHits: [...s.hits, "SOFT_CALL"],
        jev: { model: v.model, probabilities: v.probabilities },
      },
    };
  }
  return {
    score: s,
    decision: {
      stage: "route",
      decidedBy: "rule",
      verified: false,
      stamp: UNVERIFIED,
      decision: "human_review",
      confidence: null,
      reason: `Soft call (${soft}). JEV unavailable (${v.error}); fallback rule never auto-decides a borderline case, so it goes to the hiring manager. Score ${s.total} (${breakdown}).`,
      ruleHits: [...s.hits, "SOFT_CALL", "JEV_FALLBACK"],
      jev: { error: v.error },
    },
  };
}
