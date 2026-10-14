# PRD: Recruitment pipeline AI agent (maxifyhiring)

## Problem and goal
Recruiters lose time on malformed, duplicate and borderline applications, and
nobody can later explain why a candidate went where they went. The agent takes
every application from intake to a human decision, decides the clear cases
itself, hands the unclear ones to a person, and leaves an auditable reason for
every routing decision.

## Users and owners
- Agents (system owners): `agent:intake`, `agent:validator`, `agent:router`, `agent:scheduler`.
- JEV: an external decision model consulted only for soft calls.
- People: recruiter (screens, fixes invalid applications, confirms duplicates),
  hiring manager per role (borderline routes, final decision), interviewers
  (simulated calendars).

## Workflow
```
received -> validating -> invalid | duplicate | valid | human_review (possible duplicate)
valid    -> scheduling | screening_queue | human_review | auto_rejected
scheduling -> interview_scheduled | human_review (no slot)
interview_scheduled -> interview_done -> awaiting_decision -> offer | rejected | on_hold
```
Every transition writes a pipeline log row: from and to state, owner, next
action, due time, actor, note. Legal transitions live in one table; an illegal
transition is refused and nothing is written.

### 1. Intake
Accepts a batch (seed) or one application over HTTP. Normalises email (trim,
lowercase), phone (to +62), role code, skills, availability. Stores the raw
payload (bounded, always valid JSON) next to the normalised record. A replayed
batch skips source refs already stored.

### 2. Validation
Deterministic rules, each with a stable code and a recruiter message: required
name, email, phone, role; email and phone format; role exists and is open;
years of experience is a number from 0 to 50; CV present; consent given;
submission time readable and not in the future. Failing applications become
`invalid`, owned by the recruiter, with a plain next action ("Ask candidate to
fix email address").

Duplicate detection:
- Exact: same email for the same role. Rule decision, linked to the earlier
  application, which stays primary (a unique index enforces one primary).
- Fuzzy: same phone, or name similarity of 90% or more, same role, within 90
  days. A soft call: JEV judges with anonymised features only. Without a
  confident JEV answer it goes to the recruiter.

### 3. Routing
A transparent score: must-have skills (50), nice-to-have (10), experience (25),
location fit (15). Bands: 70 and up schedule, 50 to 69 recruiter screen, 35 to
49 human review, under 35 auto-reject.
- Clear cases are a rule decision.
- Soft calls (score within 5 of a band edge, or conflicting data such as many
  years but few required skills) go to JEV. A borderline case is never offered
  auto-reject.
- JEV verdicts under 60% confidence are an abstention and go to a person. JEV
  unreachable means a rule fallback stamped `UNVERIFIED BY JEV`.

Every decision stores: stage, decided by (rule, jev, human), verified, stamp,
decision, confidence, rule hits, JEV answer, and a mandatory reason (the schema
rejects an empty one).

### 4. Interview scheduling (simulated)
Six interviewers with busy blocks; slots on a fixed WIB grid (09:00 to 17:00,
Monday to Friday, 60 minutes, 15 minute buffers), 24 hour lead time, 10 working
day horizon. The earliest slot that fits the candidate's availability and a
free qualified interviewer is booked; a unique index makes double booking
impossible. No slot goes to the hiring manager. A simulated clock advances
time: interviews complete, a first no-show is rescheduled once, a second goes
to a person. Invites are records only.

### 5. Human decision points
Queue: possible duplicates, borderline routes, no slot, awaiting decision,
screening, on hold, auto-rejected (reopen). Offers and rejections outside the
clear auto-reject band are human only and need a written reason. A double
submit is answered idempotently.

## Sample data
`apps/api/data/seed/`: 40 fictional applications (16 complete clear fits, 2 clear
misses, 9 invalid or incomplete, 3 exact duplicates, 3 possible duplicates, 1
same email for another role, borderline and conflicting cases, 2 with no common
slot, 1 single and 1 double no-show), 4 roles (one closed), 6 interviewers.

## Interfaces
HTTP API under `/api` (stats, applications, log, audit, schedule, sim advance,
pipeline reset and resume, decision queue, human decisions, invariants) and a
web UI with Pipeline, Application detail, Schedule, Decisions and Audit screens.

## Non-goals
Real email or calendar integration, authentication, multi-tenant data, CV
parsing beyond plain text.

## Success criteria
- 100% of labelled seed outcomes correct (`bun run eval`).
- Every application has a log; every routing decision has a reason.
- At least six failure types tested, including recovery after interrupted
  processing with no duplicate actions (see [RELIABILITY.md](RELIABILITY.md)).
