// Intake normalisation. Takes anything (a JSON row, a form post, garbage) and
// returns a typed, cleaned candidate record plus the raw payload. It never
// throws: rejecting bad data is validation's job, not intake's (F3).

export type Slot = { start: string; end: string };

export type Candidate = {
  ref: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  phoneRaw: string | null;
  roleCode: string | null;
  yearsRaw: unknown;
  yearsExp: number | null;
  location: string | null;
  skills: string[];
  cvText: string | null;
  consent: boolean | null;
  submittedAt: string | null;
  submittedRaw: unknown;
  availability: Slot[];
};

const CONTROL = /[\u0000-\u001f\u007f]/g;
const MAX_TEXT = 4000;

function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return s.length ? s : null;
}

export function normalizePhone(v: unknown): string | null {
  const s = text(v, 40);
  if (!s) return null;
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = "+" + digits.slice(1).replace(/\+/g, "");
  if (digits.startsWith("08")) digits = "+62" + digits.slice(1);
  else if (digits.startsWith("62")) digits = "+" + digits;
  return digits || null;
}

function years(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}

function skills(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [];
  const out = new Set<string>();
  for (const item of list.slice(0, 50)) {
    const s = text(item, 40)?.toLowerCase();
    if (s) out.add(s);
  }
  return [...out];
}

function availability(v: unknown): Slot[] {
  if (!Array.isArray(v)) return [];
  const out: Slot[] = [];
  for (const item of v.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const { start, end } = item as Record<string, unknown>;
    const s = typeof start === "string" ? Date.parse(start) : NaN;
    const e = typeof end === "string" ? Date.parse(end) : NaN;
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
  }
  return out;
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "yes" || v === 1) return true;
  if (v === "false" || v === "no" || v === 0) return false;
  return null;
}

export function normalize(raw: unknown): Candidate {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const submitted = typeof r.submitted_at === "string" ? Date.parse(r.submitted_at) : NaN;
  return {
    ref: text(r.ref, 60),
    name: text(r.full_name ?? r.name, 120),
    email: text(r.email, 200)?.toLowerCase() ?? null,
    phone: normalizePhone(r.phone),
    phoneRaw: text(r.phone, 40),
    roleCode: text(r.role, 40)?.toUpperCase() ?? null,
    yearsRaw: r.years_experience,
    yearsExp: years(r.years_experience),
    location: text(r.location, 80),
    skills: skills(r.skills),
    cvText: text(r.cv_text, MAX_TEXT),
    consent: bool(r.consent),
    submittedAt: Number.isFinite(submitted) ? new Date(submitted).toISOString() : null,
    submittedRaw: r.submitted_at,
    availability: availability(r.availability),
  };
}
