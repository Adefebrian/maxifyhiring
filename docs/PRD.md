# PRD: maxifyhiring (Hiring Application Pipeline AI Agent)

## Context
Brian wants a prototype AI-agent hiring pipeline: intake → validation → routing → interview scheduling → human decision point. JEV (TypeSafe systemone, same client as the JAL plugin `mcp/jal-design/jev.ts`) judges soft routing calls at runtime. Dummy data must include invalid and duplicate records. Every application carries a pipeline log (state, owner, next action), scheduling is simulated, and every routing decision stores an audit reason. Started via `/jal-new` (scaffold) and `/jal-ui` (screens). Prototype scope: lean, no security/QA ceremony beyond JAL baseline + ui_audit.

Decisions (Brian, 2026-10-13): prototype; SQLite via `bun:sqlite` (deviation from JAL Postgres default, approved); JEV API + deterministic fallback stamped `UNVERIFIED BY JEV`; gpt-4o-mini optional, off unless `OPENAI_API_KEY`.

## Location / git
- `~/Documents/maxifyhiring` is empty but sits inside the `~/Documents` git root (never `git add -A` there). Scaffold template **into this folder directly** and `git init` a standalone repo here so `git add -A` is safe inside. Commit with repo identity (Adefebrian), no Claude co-author trailer.
- Scaffold source: `~/.claude/plugins/cache/jal-aidev-marketplace/jal-aidev/0.7.0/templates/monorepo`, replace `__APP_NAME__` → `maxifyhiring`. Remove Postgres bits (`apps/api/src/lib/db.ts` pg pool, `pg` dep, `migrations/0001_init.sql`), keep Redis/S3 libs unused or delete (prototype: delete).

## PRD

### Users / owners
- `agent:intake`, `agent:validator`, `agent:router`, `agent:scheduler` (system owners)
- `jev` (judge for soft calls)
- Humans: `recruiter` (Rina), `hiring_manager` per role (e.g. Dimas Eng, Sari Ops), `interviewer` panel with simulated calendars.

### State machine (`application.state`)
`received → validating → {invalid | duplicate | valid | human_review} → {screening_queue | scheduling | human_review | auto_rejected} → interview_scheduled → interview_done → awaiting_decision → {offer | rejected | on_hold}`
Each transition writes a `pipeline_log` row: `{app_id, from_state, to_state, owner, next_action, next_action_due, actor, at}`. Allowed transitions enforced by one table in `pipeline/states.ts`; illegal transition throws.

### Stages
1. **Intake**: accepts JSON/CSV batch (seed) and single POST. Normalises email (lowercase/trim), phone (E.164 +62), name, role code. Stores raw payload + normalised.
2. **Validation** (deterministic rules, each returns code + message): required fields, email format, phone format, role exists + open, years_experience numeric 0..50, CV url/text present, consent=true, submitted_at not future. Invalid → state `invalid`, owner `recruiter`, next action `request_fix` with failing codes.
   **Duplicate detection**: exact (same normalised email+role), fuzzy (same phone, or name similarity ≥0.9 + same role within 90 days). Exact → `duplicate` linked `duplicate_of`, keep earliest. Fuzzy/ambiguous → ask JEV `hire.duplicate` (choice: merge / keep_both / human_review); fallback = human_review.
3. **Routing**: rule score (skills match vs role must-haves, experience band, location/remote fit) → candidate band. Clear bands decided by rule; borderline (score within ±10 of threshold) or conflicting signals → JEV `hire.route` choice {scheduling, screening_queue, human_review, auto_rejected} + score question for confidence. JEV veto on auto_reject: if JEV says human_review, never auto-reject. Every decision writes `routing_decision` row: `{app_id, decided_by: rule|jev|human, verified, decision, confidence, reason, rule_hits[], jev_answers, at}`. Audit reason is mandatory text (NOT NULL).
4. **Interview scheduling simulation**: seeded interviewer calendars (busy blocks, WIB working hours 09-17, Mon-Fri), candidate availability windows. Scheduler finds earliest common 60-min slot within 10 working days, with 15-min buffer; no double-booking (unique interviewer+slot). Simulated clock (`SIM_NOW`) + "advance time" control; outcomes: scheduled, no_slot → human_review with reason, candidate_no_show (seeded random w/ fixed seed) → reschedule once. Mock invite record only, no real email.
5. **Human decision point**: queue of `human_review` + `awaiting_decision`. Human picks offer/reject/hold/override-route with required reason; recorded as `routing_decision` decided_by `human`. AI never finalises offer/reject; only humans.

### Dummy data (`data/seed/applications.json`, ~40 records, fixed)
- ~24 valid across 3 roles (Backend Engineer, Ops Analyst, Product Designer)
- 9 invalid: bad email, missing phone, bad phone, unknown role, closed role, experience "lima" and -3, future date, consent false + short CV
- 6 duplicate-shaped: 3 exact (same email, case/space variants), 2 same phone (one same person, one sibling sharing a phone), 1 name-typo near-dup; plus one same email for a different role (not a duplicate)
- 2 borderline routing cases to exercise JEV
Plus `data/seed/interviewers.json` (6 interviewers, busy blocks) and `roles.json`. Seeded deterministic (fixed RNG seed) so runs reproduce.

### API (Hono, `apps/api`)
- `POST /api/pipeline/reset` (reseed + run) · `POST /api/pipeline/run` · `POST /api/applications` (single intake)
- `GET /api/applications?state=&owner=` · `GET /api/applications/:id` (incl. log, decisions, validation errors, interview)
- `GET /api/log` (global pipeline log) · `GET /api/audit` (routing decisions, filter decided_by/verified)
- `GET /api/schedule` (interviews + interviewer calendars) · `POST /api/sim/advance {hours}`
- `POST /api/decisions/:id {decision, reason}` (human)
- `GET /api/stats` (counts per state, invalid/duplicate counts, JEV verified ratio)
Zod-validate inputs; JAL `core/hardening.ts` kept.

### Modules (modular monolith, `apps/api/src/modules/*`, each `index.ts` public)
`intake/`, `validation/` (rules.ts, dedupe.ts), `routing/` (score.ts, router.ts), `scheduling/` (slots.ts, simulator.ts), `decisions/`, `pipeline/` (states.ts, log.ts, runner.ts), `jev/` (client port of plugin `jev.ts` with redaction + fallback; `decide()` returns verified/unverified), `ai/` (optional gpt-4o-mini summary via existing template `lib/ai.ts`). `lib/db.ts` → bun:sqlite + `schema.sql` self-applied on boot.

### Tables (SQLite)
`roles, applications(raw_json, normalised fields, state, owner, next_action, next_action_due, duplicate_of), validation_errors, pipeline_log, routing_decisions, interviewers, busy_blocks, interviews, sim_clock`.

## UI (`/jal-ui`, mode `modern`, jal-ux lead, JAL Core kit, white-first, mobile app-shell)
Screens (one SPA, tab bar on mobile, rail on desktop):
1. **Pipeline**: stat row (per state + invalid/duplicate), state-column board on desktop / grouped rows on mobile; each row shows name, role, state, owner, next action + due.
2. **Application detail**: header facts, validation errors, duplicate link, routing decisions (rule hits, JEV answers, confidence, verified stamp, reason), pipeline log timeline as plain rows (no connector lines/dots per JAL law), interview slot.
3. **Schedule**: simulated clock + advance control, interviewer week grid (Carbon-style table), list of scheduled/no-slot.
4. **Decisions**: human queue, decide sheet with required reason.
5. **Audit**: filterable table of routing decisions (decided_by, verified/UNVERIFIED, reason), export JSON.
JEV calls per jal-ui flow: `ui.experience`, container picks per region, `ui.finish_disposition` via fresh critic. ui_audit PASS at 320/375/414/768/1280.

## Execution order
1. Scaffold (jal-new steps: bun check, copy, rename, bun install, git init, first commit, `bun run build && bun test`).
2. Backend wave (parallel by module): validation+dedupe, routing+jev, scheduling sim, pipeline/log + api routes; seed data.
3. Tests (bun test): rule per invalid code, dedupe exact/fuzzy, routing band + JEV fallback stamping (mock fetch), scheduler no-double-book + no_slot, illegal transition throws, full seed run snapshot counts (e.g. 8 invalid, 6 duplicate, every routing_decision has reason).
4. Reliability pass via `/jal-debug` (section below), fixes routed to owning module.
5. UI wave via jal-ux, then ui_audit + ui_shots + critic.
6. README: run `bun install && bun run dev`, env (`JEV_API_KEY`, `OPENAI_API_KEY` optional), pipeline diagram in text.

## Reliability pass via `/jal-debug` (after backend built, before UI sign-off)
Run `/jal-debug discover` (jal-debugger, JEV picks depth; escalate to deep on any real failure) against the pipeline with a fault-injection harness `apps/api/src/reliability/` (`faults.ts` toggles: injectable `fetchImpl` for JEV/LLM, clock, RNG, DB wrapper) and `reliability.test.ts`. Rule from jal-debugging: each failure reproduced as a failing test first, root cause, then fix, then the bug class becomes a mechanical rule (test kept in suite). Minimum 6 failure types, target 8:

| # | Failure type | Injection | Expected (pass condition) |
|---|---|---|---|
| F1 | JEV unavailable | fetch → timeout / 500 / 429 exhaust retries, missing key | decision falls back to rule, `verified=false`, stamp `UNVERIFIED BY JEV`, reason names the fallback; pipeline never stalls |
| F2 | JEV bad answer | 200 with unknown choice, missing key, confidence NaN | answer rejected by schema, same fallback, audit stores raw error |
| F3 | Malformed intake | bad JSON, wrong types, 1MB body, script tags, unicode/emoji names | 400 or `invalid` with codes, never 500, never stored unescaped |
| F4 | Duplicate race | same application POSTed 20x concurrently | exactly 1 non-duplicate row (unique index normalised email+role in a transaction), rest `duplicate` with `duplicate_of` |
| F5 | Scheduling conflict | two schedulers race for the same interviewer slot; all calendars full; DST-free TZ edge at 17:00 | no double-booking (unique interviewer+slot), loser retries next slot, full calendar → `human_review` with reason `no_slot` |
| F6 | Crash mid-pipeline | throw between routing and log write; kill runner mid-batch, rerun | state change + log row + decision written in ONE transaction; rerun idempotent, zero apps whose state lacks a matching last log row |
| F7 | Illegal transition / bad human input | decision on `received` app, empty reason, double-submit decision | 409/400, no state change; second submit idempotent |
| F8 | LLM failure (optional path) | gpt-4o-mini timeout/garbage | summary skipped and marked, routing unaffected |

Invariant checker `pipeline/invariants.ts` (run after every reliability test and exposed at `GET /api/health/invariants`): every app has ≥1 log row; app.state == last log to_state; every routing_decision has non-empty reason; no interviewer overlap; duplicates point to an existing non-duplicate.
Report: table of F1-F8 with reproduced/fixed/test file, debugger depth chosen by JEV.

## Verification
- `bun run build && bun test && bun run typecheck` green.
- `POST /api/pipeline/reset` then `GET /api/stats`: invalid=8, duplicate counts match seed, zero apps without log rows, zero routing_decisions with empty reason, no interviewer double-booked.
- Without `JEV_API_KEY`: decisions show `UNVERIFIED BY JEV` + fallback rule reason. With key: verified answers + confidence logged.
- `bun test apps/api/src/reliability` green for F1-F8; `GET /api/health/invariants` returns all-true after reset and after each fault run.
- UI: ui_audit PASS all 5 widths, screenshots reviewed, critic ≥15/21.
