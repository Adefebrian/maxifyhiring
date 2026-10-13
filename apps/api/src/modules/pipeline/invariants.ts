// Pipeline invariants. Run after every reliability test and served at
// GET /api/health/invariants. Each check returns the offending ids, so an
// empty list is a pass.
import type { Database } from "bun:sqlite";
import { STATES } from "./states";

export type InvariantReport = { ok: boolean; checks: { name: string; ok: boolean; offenders: string[] }[] };

const ids = (db: Database, sql: string) => db.query<{ id: string }, []>(sql).all().map((r) => String(r.id));

export function checkInvariants(db: Database): InvariantReport {
  const checks = [
    {
      name: "every application has a log row",
      offenders: ids(db, "SELECT a.id FROM applications a WHERE NOT EXISTS (SELECT 1 FROM pipeline_log l WHERE l.app_id = a.id)"),
    },
    {
      name: "state, owner and next action match the latest log row",
      offenders: ids(
        db,
        `SELECT a.id FROM applications a
         JOIN pipeline_log l ON l.id = (SELECT MAX(id) FROM pipeline_log WHERE app_id = a.id)
         WHERE l.to_state <> a.state OR l.owner <> a.owner OR l.next_action <> a.next_action`,
      ),
    },
    {
      name: "every state is a known state",
      offenders: ids(db, `SELECT id FROM applications WHERE state NOT IN (${STATES.map((s) => `'${s}'`).join(",")})`),
    },
    {
      name: "every routing decision has an audit reason",
      offenders: ids(db, "SELECT CAST(id AS TEXT) AS id FROM routing_decisions WHERE reason IS NULL OR length(trim(reason)) = 0"),
    },
    {
      name: "every non-received application has at least one decision",
      offenders: ids(
        db,
        `SELECT a.id FROM applications a WHERE a.state NOT IN ('received', 'validating')
         AND NOT EXISTS (SELECT 1 FROM routing_decisions d WHERE d.app_id = a.id)`,
      ),
    },
    {
      name: "no interviewer is double-booked",
      offenders: ids(
        db,
        `SELECT DISTINCT x.interviewer_id || '@' || x.start AS id FROM interviews x JOIN interviews y
         ON x.interviewer_id = y.interviewer_id AND x.id < y.id AND x.start < y."end" AND y.start < x."end"
         WHERE x.status IN ('scheduled', 'done') AND y.status IN ('scheduled', 'done')`,
      ),
    },
    {
      name: "every scheduled interview state has exactly one live interview",
      offenders: ids(
        db,
        `SELECT a.id FROM applications a WHERE a.state = 'interview_scheduled'
         AND (SELECT COUNT(*) FROM interviews i WHERE i.app_id = a.id AND i.status = 'scheduled') <> 1`,
      ),
    },
    {
      name: "duplicates link to an existing non-duplicate",
      offenders: ids(
        db,
        `SELECT a.id FROM applications a LEFT JOIN applications p ON p.id = a.duplicate_of
         WHERE a.state = 'duplicate' AND (p.id IS NULL OR p.state = 'duplicate')`,
      ),
    },
    {
      name: "one primary per email and role",
      offenders: ids(db, "SELECT email || '/' || role_code AS id FROM applications WHERE is_primary = 1 GROUP BY email, role_code HAVING COUNT(*) > 1"),
    },
  ].map((c) => ({ ...c, ok: c.offenders.length === 0 }));
  return { ok: checks.every((c) => c.ok), checks };
}
