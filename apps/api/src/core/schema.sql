-- maxifyhiring SQLite schema. Applied idempotently on every boot.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  code            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  must_have       TEXT NOT NULL,          -- JSON string[]
  nice_to_have    TEXT NOT NULL,          -- JSON string[]
  min_years       REAL NOT NULL,
  location        TEXT NOT NULL,
  remote_ok       INTEGER NOT NULL,
  hiring_manager  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id               TEXT PRIMARY KEY,
  source_ref       TEXT,
  raw_json         TEXT NOT NULL,
  name             TEXT,
  email            TEXT,
  phone            TEXT,
  role_code        TEXT,
  years_exp        REAL,
  location         TEXT,
  skills           TEXT NOT NULL DEFAULT '[]',
  cv_text          TEXT,
  consent          INTEGER,
  submitted_at     TEXT,
  availability     TEXT NOT NULL DEFAULT '[]',
  state            TEXT NOT NULL,
  owner            TEXT NOT NULL,
  next_action      TEXT NOT NULL,
  next_action_due  TEXT,
  duplicate_of     TEXT REFERENCES applications(id),
  is_primary       INTEGER NOT NULL DEFAULT 0,
  score            REAL,
  summary          TEXT,
  summary_status   TEXT NOT NULL DEFAULT 'off',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
-- One primary (non-duplicate) application per person per role. This index is
-- what makes concurrent duplicate intake safe (reliability F4).
CREATE UNIQUE INDEX IF NOT EXISTS uq_primary_email_role
  ON applications (email, role_code) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS ix_app_state ON applications (state);

CREATE TABLE IF NOT EXISTS validation_errors (
  app_id   TEXT NOT NULL REFERENCES applications(id),
  code     TEXT NOT NULL,
  field    TEXT NOT NULL,
  message  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id           TEXT NOT NULL REFERENCES applications(id),
  from_state       TEXT,
  to_state         TEXT NOT NULL,
  owner            TEXT NOT NULL,
  next_action      TEXT NOT NULL,
  next_action_due  TEXT,
  actor            TEXT NOT NULL,
  note             TEXT NOT NULL DEFAULT '',
  at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_log_app ON pipeline_log (app_id, id);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      TEXT NOT NULL REFERENCES applications(id),
  stage       TEXT NOT NULL CHECK (stage IN ('validation', 'dedupe', 'route', 'schedule', 'human')),
  decided_by  TEXT NOT NULL CHECK (decided_by IN ('rule', 'jev', 'human')),
  verified    INTEGER NOT NULL,
  stamp       TEXT,
  decision    TEXT NOT NULL,
  confidence  REAL,
  reason      TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  rule_hits   TEXT NOT NULL DEFAULT '[]',
  jev         TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_decision_app ON routing_decisions (app_id, id);

CREATE TABLE IF NOT EXISTS interviewers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role_codes  TEXT NOT NULL            -- JSON string[]
);

CREATE TABLE IF NOT EXISTS busy_blocks (
  interviewer_id  TEXT NOT NULL REFERENCES interviewers(id),
  start           TEXT NOT NULL,
  "end"           TEXT NOT NULL,
  label           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id          TEXT NOT NULL REFERENCES applications(id),
  interviewer_id  TEXT NOT NULL REFERENCES interviewers(id),
  start           TEXT NOT NULL,
  "end"           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('scheduled', 'done', 'no_show')),
  attempt         INTEGER NOT NULL
);
-- Slots sit on a fixed grid, so "same interviewer, same start, still live"
-- is exactly a double-booking. The index makes it impossible (reliability F5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_interviewer_slot
  ON interviews (interviewer_id, start) WHERE status IN ('scheduled', 'done');

CREATE TABLE IF NOT EXISTS sim_clock (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  now  TEXT NOT NULL
);
