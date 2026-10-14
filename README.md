# maxifyhiring

Prototype hiring application pipeline AI agent: intake, validation, duplicate
detection, routing, simulated interview scheduling, and a human decision point.
Every state change writes a pipeline log row (state, owner, next action, due) and
every routing decision stores an audit reason. JEV (TypeSafe systemone) judges
the soft calls; without it the pipeline falls back to rules and stamps the
decision `UNVERIFIED BY JEV`.

Product spec: [docs/PRD.md](docs/PRD.md). Reliability: [docs/RELIABILITY.md](docs/RELIABILITY.md). Eval report: [apps/api/evals/report.md](apps/api/evals/report.md). Design direction: [docs/design/direction.md](docs/design/direction.md).

## Run locally

```bash
bun install
cp .env.example .env          # JEV_API_KEY and OPENAI_API_KEY are optional

# API (seeds 40 dummy applications on boot; SEED_ON_BOOT=0 resumes instead)
cd apps/api && API_PORT=3481 DB_PATH=./data/dev.sqlite CORS_ORIGINS=http://localhost:3480 bun --env-file=../../.env src/index.ts

# Web (second terminal)
cd apps/web && bun run build.ts && WEB_PORT=3480 API_URL=http://localhost:3481 bun server.ts
```

Open http://localhost:3480. Screens: `/` Pipeline, `/app/APP-001` detail,
`/decisions` human queue, `/schedule` simulated clock and interviewer week,
`/audit` every routing decision with Export JSON.

## Pipeline

```
received -> validating -> invalid | duplicate | valid | human_review (possible duplicate)
valid    -> scheduling | screening_queue | human_review | auto_rejected
scheduling -> interview_scheduled | human_review (no slot)
interview_scheduled -> interview_done -> awaiting_decision -> offer | rejected | on_hold
```

- Rules decide the clear cases: validation codes, exact duplicates (same email
  and role), clear score bands (>= 70 schedule, 50 to 69 screen, < 35 auto-reject),
  and slot search on a fixed WIB grid.
- JEV decides soft calls: a score within 5 of a band edge, conflicting signals, and
  fuzzy duplicates (same phone or similar name). Only anonymised features are sent.
- A JEV verdict under 60% confidence is an abstention and goes to a person; a
  borderline case is never auto-rejected; offers and rejections are human only and
  need a written reason.

## Dummy data

`apps/api/data/seed/`: 40 applications (24 valid across three roles, 9 invalid,
3 exact duplicates, 3 fuzzy duplicate reviews, borderline routing cases, one
candidate who misses an interview once and one who misses twice, two candidates
whose availability has no free slot), 4 roles (one closed), 6 interviewers with
busy calendars.

## Tests and evals

```bash
cd apps/api && bun test     # unit suite + reliability harness F1-F9
cd apps/api && bun run eval # 40 labelled outcomes + crash/recovery replay -> evals/report.md
cd apps/web && bun test
bun run build && bun run check:boundaries
```

`apps/api/src/reliability/` covers nine failure types: tool unavailable or timing
out, tool returning bad output, missing fields and malformed input, duplicates
under concurrency, scheduling clashes, interrupted processing, illegal transitions
or bad human input, LLM failure, and conflicting data. See
[docs/RELIABILITY.md](docs/RELIABILITY.md). Every scenario ends with
`checkInvariants()` (also served at `GET /api/health/invariants`).
