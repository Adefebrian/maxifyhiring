// Pipeline eval. Runs the 40-record seed through the real pipeline with JEV
// off (deterministic fallback) and scores it against hand-labelled
// expectations in expected.json, then replays an interrupted run to prove
// recovery creates no duplicate actions. Writes evals/report.md.
//
//   cd apps/api && bun evals/run.ts
import { openDb } from "../src/core/db";
import { advance, checkInvariants, importBatch, reset, runAll, seedApplications, seedReference, type PipelineDeps } from "../src/modules/pipeline";

type Expect = { ref: string; label: string; state: string; codes?: string[]; duplicateOfRef?: string; ruleHit?: string };
const expected = (await Bun.file(new URL("./expected.json", import.meta.url)).json()) as Expect[];

const deps = (): PipelineDeps => ({ db: openDb(":memory:"), jev: { apiKey: "" } });
const d = deps();
await reset(d);

type Row = { id: string; source_ref: string; state: string; duplicate_of: string | null };
const rows = d.db.query<Row, []>("SELECT id, source_ref, state, duplicate_of FROM applications").all();
const byRef = new Map(rows.map((r) => [r.source_ref, r]));
const idToRef = new Map(rows.map((r) => [r.id, r.source_ref]));
const codes = (id: string) => d.db.query<{ code: string }, { id: string }>("SELECT code FROM validation_errors WHERE app_id = $id").all({ id }).map((r) => r.code);
const hits = (id: string) =>
  d.db.query<{ rule_hits: string }, { id: string }>("SELECT rule_hits FROM routing_decisions WHERE app_id = $id").all({ id }).flatMap((r) => JSON.parse(r.rule_hits) as string[]);

const results = expected.map((e) => {
  const r = byRef.get(e.ref);
  const problems: string[] = [];
  if (!r) problems.push("not found");
  else {
    if (r.state !== e.state) problems.push(`state ${r.state}, expected ${e.state}`);
    if (e.codes) {
      const got = codes(r.id).sort().join(",");
      if (got !== [...e.codes].sort().join(",")) problems.push(`codes ${got || "none"}, expected ${e.codes.join(",")}`);
    }
    if (e.duplicateOfRef && idToRef.get(r.duplicate_of ?? "") !== e.duplicateOfRef) problems.push(`duplicate_of ${r.duplicate_of}, expected ${e.duplicateOfRef}`);
    if (e.ruleHit && !hits(r.id).includes(e.ruleHit)) problems.push(`missing rule hit ${e.ruleHit}`);
  }
  return { ...e, id: r?.id ?? "-", ok: problems.length === 0, problems };
});

const cleanFinal = new Map(d.db.query<{ source_ref: string; state: string }, []>("SELECT source_ref, state FROM applications").all().map((r) => [r.source_ref, r.state]));

// Every decision carries a reason; every app has a log; the invariants hold.
const reasonless = d.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM routing_decisions WHERE length(trim(reason)) = 0").get()!.n;
const inv1 = checkInvariants(d.db);

// Scheduling simulation: one week forward, no-shows handled.
await advance(d, 24 * 7);
const inv2 = checkInvariants(d.db);
const byState = Object.fromEntries(d.db.query<{ state: string; n: number }, []>("SELECT state, COUNT(*) AS n FROM applications GROUP BY state").all().map((r) => [r.state, r.n]));

// Recovery: crash on every 7th state change, then restart the way an operator
// would: replay the same batch (known refs are skipped) and resume parked apps.
const c = deps();
await seedReference(c.db);
const batch = await seedApplications();
let changes = 0;
c.faults = {
  afterStateUpdate: () => {
    if (++changes % 7 === 0) throw new Error("simulated crash");
  },
};
let crashes = 0;
for (let i = 0; i < 200; i++) {
  try {
    await runAll(c);
    const r = await importBatch(c, batch);
    if (r.imported === 0) break;
  } catch {
    crashes++;
  }
}
c.faults = {};
await runAll(c);
const replay = await importBatch(c, batch);
const total = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM applications").get()!.n;
const sameAsClean = c.db
  .query<{ source_ref: string; state: string }, []>("SELECT source_ref, state FROM applications")
  .all()
  .filter((r) => cleanFinal.get(r.source_ref) === r.state).length;
const logBefore = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pipeline_log").get()!.n;
const decBefore = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM routing_decisions").get()!.n;
const ivBefore = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM interviews").get()!.n;
const resumedAgain = await runAll(c);
const logAfter = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM pipeline_log").get()!.n;
const decAfter = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM routing_decisions").get()!.n;
const ivAfter = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM interviews").get()!.n;
const stuck = c.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM applications WHERE state IN ('received','validating','valid','scheduling')").get()!.n;
const doubleBooked = checkInvariants(c.db).checks.find((x) => x.name.includes("double-booked"))!.offenders.length;
const inv3 = checkInvariants(c.db);

const passed = results.filter((r) => r.ok).length;
const byLabel = new Map<string, { ok: number; total: number }>();
for (const r of results) {
  const b = byLabel.get(r.label) ?? { ok: 0, total: 0 };
  b.total++;
  if (r.ok) b.ok++;
  byLabel.set(r.label, b);
}

const lines = [
  "# Pipeline eval report",
  "",
  `Seed: 40 applications, JEV off (deterministic fallback). Generated by \`bun evals/run.ts\`.`,
  "",
  `## Outcome accuracy: ${passed}/${results.length} labelled records`,
  "",
  "| Category | Correct |",
  "|---|---|",
  ...[...byLabel].map(([k, v]) => `| ${k} | ${v.ok}/${v.total} |`),
  "",
  "| Ref | App | Category | Expected | Result |",
  "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.ref} | ${r.id} | ${r.label} | ${r.state}${r.codes ? ` (${r.codes.join(", ")})` : ""} | ${r.ok ? "PASS" : "FAIL: " + r.problems.join("; ")} |`),
  "",
  "## Audit and invariants",
  "",
  `- Routing decisions without a reason: ${reasonless}`,
  `- Invariants after the seed run: ${inv1.ok ? "all hold" : "FAILED"}`,
  `- Invariants after simulating one week of interviews: ${inv2.ok ? "all hold" : "FAILED"}`,
  `- States after one week: ${JSON.stringify(byState)}`,
  "",
  "## Recovery without duplicate actions",
  "",
  `- Simulated crashes (every 7th state change) during the seed import: ${crashes}, each followed by a restart`,
  `- Applications after recovery: ${total} of ${batch.length} (a final batch replay imported ${replay.imported}, skipped ${replay.skipped})`,
  `- Final state identical to the uninterrupted run: ${sameAsClean} of ${total}`,
  `- Applications left stuck in an automated state: ${stuck}`,
  `- Second resume picked up ${resumedAgain} applications and added ${logAfter - logBefore} log rows, ${decAfter - decBefore} decisions, ${ivAfter - ivBefore} interviews`,
  `- Double-booked interviewer slots: ${doubleBooked}`,
  `- Invariants after recovery: ${inv3.ok ? "all hold" : "FAILED"}`,
  "",
];
await Bun.write(new URL("./report.md", import.meta.url), lines.join("\n"));
console.log(lines.join("\n"));
const ok = total === batch.length && sameAsClean === total && replay.imported === 0 && passed === results.length && reasonless === 0 && inv1.ok && inv2.ok && inv3.ok && stuck === 0 && logAfter === logBefore && decAfter === decBefore && ivAfter === ivBefore;
process.exit(ok ? 0 : 1);
