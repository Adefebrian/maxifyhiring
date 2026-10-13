// SQLite via bun:sqlite. Brian approved SQLite over the JAL Postgres default
// for this prototype (2026-10-13): zero setup, the whole pipeline runs from
// one file. The schema is applied idempotently on every open.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database;

const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();

/** Opens (and creates if needed) the database. `:memory:` for tests. */
export function openDb(path = ":memory:"): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(schema);
  return db;
}
