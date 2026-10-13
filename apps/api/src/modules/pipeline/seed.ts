// Loads the dummy dataset: roles, interviewers with busy calendars, and the
// application batch (valid, invalid, duplicate, borderline, no-show, no-slot
// records). `reset()` wipes the database and replays the batch in
// submission order, so "keep the earliest" duplicate handling is stable.
import type { Database } from "bun:sqlite";
import { intake, type PipelineDeps } from "./runner";
import { setNow } from "./store";

const dir = new URL("../../../data/seed/", import.meta.url);
const load = async <T>(name: string): Promise<T> => JSON.parse(await Bun.file(new URL(name, dir)).text());

type SeedRole = { code: string; title: string; status: string; must_have: string[]; nice_to_have: string[]; min_years: number; location: string; remote_ok: boolean; hiring_manager: string };
type SeedPanel = {
  sim_start: string;
  interviewers: { id: string; name: string; role_codes: string[] }[];
  busy: { interviewer_id: string; start: string; end: string; label: string }[];
};

export async function seedApplications(): Promise<unknown[]> {
  return load<unknown[]>("applications.json");
}

export async function seedReference(db: Database): Promise<void> {
  const roles = await load<SeedRole[]>("roles.json");
  const panel = await load<SeedPanel>("interviewers.json");
  db.transaction(() => {
    for (const r of roles) {
      db.query(
        `INSERT INTO roles (code, title, status, must_have, nice_to_have, min_years, location, remote_ok, hiring_manager)
         VALUES ($code, $title, $status, $must, $nice, $min, $loc, $remote, $hm)`,
      ).run({ code: r.code, title: r.title, status: r.status, must: JSON.stringify(r.must_have), nice: JSON.stringify(r.nice_to_have), min: r.min_years, loc: r.location, remote: r.remote_ok ? 1 : 0, hm: r.hiring_manager });
    }
    for (const i of panel.interviewers) {
      db.query("INSERT INTO interviewers (id, name, role_codes) VALUES ($id, $name, $roles)").run({ id: i.id, name: i.name, roles: JSON.stringify(i.role_codes) });
    }
    for (const b of panel.busy) {
      db.query('INSERT INTO busy_blocks (interviewer_id, start, "end", label) VALUES ($iv, $start, $end, $label)').run({ iv: b.interviewer_id, start: b.start, end: b.end, label: b.label });
    }
  })();
  setNow(db, new Date(panel.sim_start));
}

export function wipe(db: Database): void {
  db.transaction(() => {
    for (const t of ["routing_decisions", "pipeline_log", "validation_errors", "interviews", "applications", "busy_blocks", "interviewers", "roles", "sim_clock"]) {
      db.exec(`DELETE FROM ${t}`);
    }
  })();
}

/** Wipe, load reference data, and run the whole seed batch through the pipeline. */
export async function reset(deps: PipelineDeps): Promise<{ processed: number }> {
  wipe(deps.db);
  await seedReference(deps.db);
  const apps = (await seedApplications()) as { submitted_at?: string }[];
  const ordered = [...apps].sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")));
  for (const raw of ordered) await intake(deps, raw);
  return { processed: ordered.length };
}
