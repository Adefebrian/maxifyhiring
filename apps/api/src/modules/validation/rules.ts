// Deterministic validation rules. Each failing rule returns a stable code, the
// field it concerns, and a human message the recruiter can send back.
import type { Candidate } from "../intake";
import type { Role } from "../shared";

export type ValidationError = { code: string; field: string; message: string };

/** Short recruiter-facing fix for each rule code, used as the next action. */
export const FIX_COPY: Record<string, string> = {
  REQUIRED_NAME: "add full name",
  NAME_INVALID: "correct the name",
  REQUIRED_EMAIL: "add email",
  EMAIL_FORMAT: "fix email address",
  REQUIRED_PHONE: "add phone number",
  PHONE_FORMAT: "fix phone number",
  REQUIRED_ROLE: "choose a role",
  ROLE_UNKNOWN: "choose an existing role",
  ROLE_CLOSED: "suggest an open role",
  EXPERIENCE_INVALID: "confirm years of experience",
  CV_MISSING: "attach a full CV",
  CONSENT_MISSING: "collect data consent",
  SUBMITTED_INVALID: "confirm submission date",
  SUBMITTED_IN_FUTURE: "check submission date",
};

export function fixSummary(errors: ValidationError[]): string {
  const parts = [...new Set(errors.map((e) => FIX_COPY[e.code] ?? e.code))];
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const PHONE_ID = /^\+62\d{8,12}$/;
const HAS_LETTER = /\p{L}/u;
const MARKUP = /[<>]/;

export function validate(c: Candidate, roles: Map<string, Role>, now: Date): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (code: string, field: string, message: string) => errors.push({ code, field, message });

  if (!c.name) add("REQUIRED_NAME", "full_name", "Full name is missing.");
  else if (!HAS_LETTER.test(c.name) || MARKUP.test(c.name)) add("NAME_INVALID", "full_name", "Name must contain letters and no markup.");

  if (!c.email) add("REQUIRED_EMAIL", "email", "Email is missing.");
  else if (!EMAIL.test(c.email)) add("EMAIL_FORMAT", "email", `"${c.email.slice(0, 60)}" is not a valid email address.`);

  if (!c.phone) add("REQUIRED_PHONE", "phone", "Phone number is missing.");
  else if (!PHONE_ID.test(c.phone)) add("PHONE_FORMAT", "phone", `"${c.phoneRaw ?? c.phone}" is not a valid Indonesian mobile number.`);

  const role = c.roleCode ? roles.get(c.roleCode) : undefined;
  if (!c.roleCode) add("REQUIRED_ROLE", "role", "Role is missing.");
  else if (!role) add("ROLE_UNKNOWN", "role", `Role "${c.roleCode}" does not exist.`);
  else if (role.status !== "open") add("ROLE_CLOSED", "role", `${role.title} is no longer accepting applications.`);

  if (c.yearsExp === null) add("EXPERIENCE_INVALID", "years_experience", `Years of experience "${String(c.yearsRaw ?? "").slice(0, 20)}" is not a number.`);
  else if (c.yearsExp < 0 || c.yearsExp > 50) add("EXPERIENCE_INVALID", "years_experience", `Years of experience ${c.yearsExp} is outside 0 to 50.`);

  if (!c.cvText || c.cvText.length < 30) add("CV_MISSING", "cv_text", "CV text is missing or too short to assess.");

  if (c.consent !== true) add("CONSENT_MISSING", "consent", "Candidate has not consented to data processing.");

  if (!c.submittedAt) add("SUBMITTED_INVALID", "submitted_at", "Submission time is missing or unreadable.");
  else if (Date.parse(c.submittedAt) > now.getTime() + 5 * 60_000) add("SUBMITTED_IN_FUTURE", "submitted_at", "Submission time is in the future.");

  return errors;
}
