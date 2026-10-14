# Reliability

Nine failure types are tested in `apps/api/src/reliability/reliability.test.ts`
(46 tests). After every scenario the test asserts `checkInvariants()`: every
application has a log row, its state/owner/next action match the latest log row,
every decision has a reason, no interviewer is double-booked, duplicates point at
a primary, and there is one primary per email and role.

| # | Failure type | What is injected | Expected recovery |
|---|---|---|---|
| F1 | Tool unavailable / timeout (JEV) | missing key, timeout, HTTP 500, 429 until retries run out, network error | soft call falls back to a rule, stamped `UNVERIFIED BY JEV`, reason names the fallback; all 40 seed apps still finish |
| F2 | Tool returns bad output (JEV) | unknown choice, missing answer, confidence NaN / 1.7, non-JSON body | answer rejected by schema, same fallback, error stored in the decision |
| F3 | Missing fields and malformed input | invalid JSON, arrays, wrong types, over 1 MB, markup and emoji names, 30 KB CV | `400` / `413`, or `invalid` with rule codes; never `500`; oversized raw payload stored as valid bounded JSON |
| F4 | Duplicates under concurrency | the same application POSTed 20 times at once; twins racing through a slow fuzzy check | exactly one primary, 19 linked duplicates; loser of a race is linked with `DUP_RACE` |
| F5 | Scheduling clashes | another booking lands between slot search and insert; every calendar full; grid edges | unique index refuses the double booking, the loser takes the next slot; no slot goes to a person with a "No interview slot" reason |
| F6 | Interrupted processing | crash between state update and log write; crash while booking; crash while the sim clock runs; batch with crashes, then `POST /api/pipeline/run` | state, log row and decision commit in one transaction, so a crash leaves nothing half-written; resume finishes every app; a second resume adds nothing |
| F7 | Illegal transition / bad human input | decision on a received or invalid app, empty reason, unknown action, double submit (sequential and concurrent) | `409` / `400` with no write; the second identical submit is answered idempotently with no extra row |
| F8 | LLM failure (optional summary) | summariser throws, hangs, or returns garbage | summary marked failed, routing identical to a run without the LLM |
| F9 | Conflicting data | very experienced but few required skills; every skill but far under the experience bar; same phone, different person | never auto-decided: routed to a person with the conflict named in the reason; a shared phone is reviewed, never merged on its own |

## Recovery without duplicate actions

`bun run eval` (in `apps/api`) also replays the whole seed with a crash on every
7th state change, restarting after each crash by resuming parked applications
and replaying the same batch (known source refs are skipped). Result recorded in
`apps/api/evals/report.md`: 20 crashes, 40 of 40 applications, every final state
identical to the uninterrupted run, and a second resume adds 0 log rows, 0
decisions and 0 interviews.

## Defects these tests found and fixed

- Raw payload over 20 KB was cut mid-string, leaving invalid JSON that blocked every later application (F3).
- Non-Latin names folded to an empty string and scored as identical, flagging two different people as duplicates (F3).
- `keep_both` on a second same-email review hit the unique index and returned `500`; now `409` (F7).
- A hanging summariser held routing for 8 s per application and leaked its timer (F8).
- After a crash, the dedupe reason claimed the later twin "was submitted first" (F6).
- Live JEV marked two siblings sharing a phone as one person at 38% confidence; verdicts under 60% now go to a person.
- A borderline score hid the conflicting-data signal in the audit reason (F9).
