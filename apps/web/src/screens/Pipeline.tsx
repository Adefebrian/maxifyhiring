// Screen 1, Pipeline. Concepts (ui.region_gate, all kept):
//   head     divided-section  where the queue stands and what the sim clock says; secondary Reset
//   stats    card             six counts that open the exception they name
//   toolbar  divided-section  search and state filter, with the result count
//   board    rows             applications grouped by state: name, role, state, owner, next action, due
import { useMemo, useState } from "react";
import type { Api, AppSummary, State, Stats } from "../api";
import { dueKey, fmtDayTime, owner, plural, roleOf, STATE_LABEL, STATE_ORDER } from "../format";
import { Glyph } from "../icons";
import { Due, Empty, KeepIds, LoadError, Notice, PageHeader, SkeletonRows, StateBadge, useLoad } from "../parts";

const OVERDUE = "__overdue";

interface Data {
  stats: Stats;
  items: AppSummary[];
}

export function Pipeline({ api, initialState, onChanged }: { api: Api; initialState: string; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState(initialState);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useLoad<Data>(async () => {
    const [stats, apps] = await Promise.all([api.stats(), api.applications()]);
    return { stats, items: apps.items };
  }, "pipeline");

  const stats = load.data?.stats ?? null;
  const now = stats?.now ?? null;

  const nowMs = now ? new Date(now).getTime() : null;
  const isOverdue = (a: AppSummary) => nowMs !== null && a.nextActionDue !== null && new Date(a.nextActionDue).getTime() < nowMs;
  const overdueCount = (load.data?.items ?? []).filter(isOverdue).length;
  const [allStats, setAllStats] = useState(false);

  const filtered = useMemo(() => {
    const items = load.data?.items ?? [];
    const needle = q.trim().toLowerCase();
    return items.filter((a) => {
      if (state === OVERDUE) {
        if (!isOverdue(a)) return false;
      } else if (state && a.state !== state) return false;
      if (!needle) return true;
      return [a.name, a.email, a.ref, a.id, a.roleTitle].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [load.data, q, state]);

  const groups = useMemo(() => {
    const by = new Map<State, AppSummary[]>();
    for (const a of filtered) {
      const list = by.get(a.state) ?? [];
      list.push(a);
      by.set(a.state, list);
    }
    // Within a group the soonest due comes first; no due time goes last.
    return STATE_ORDER.filter((s) => by.has(s)).map((s) => ({ state: s, items: by.get(s)!.sort((a, b) => dueKey(a.nextActionDue) - dueKey(b.nextActionDue)) }));
  }, [filtered]);

  async function reset() {
    setResetting(true);
    setResetMsg(null);
    try {
      const r = await api.reset();
      const inv = r.invariants as { ok?: boolean } | null;
      setResetMsg({
        tone: "success",
        text: `Reseeded and reprocessed ${plural(r.processed, "application")}.${inv && inv.ok === false ? " Some invariants failed; open the API health check." : " Every invariant holds."}`,
      });
      setQ("");
      setState("");
      load.reload();
      onChanged();
    } catch (e) {
      setResetMsg({ tone: "danger", text: e instanceof Error ? e.message : "Reset failed." });
    } finally {
      setResetting(false);
    }
  }

  const line = stats ? (
    <>
      Sim clock <span className="num">{fmtDayTime(stats.now)} WIB</span>. {plural(stats.total, "application")} in the pipeline.
    </>
  ) : load.error ? (
    "Pipeline data is not available."
  ) : (
    "Loading the sim clock."
  );

  return (
    <div className="page">
      <PageHeader
        title="Pipeline"
        line={line}
        actions={
          <button type="button" className="btn-secondary" onClick={reset} aria-busy={resetting ? true : undefined} aria-label="Reset demo data">
            <Glyph name="reset" />
            <span className="action-label">Reset demo data</span>
          </button>
        }
      />

      {resetMsg ? <Notice tone={resetMsg.tone} title={resetMsg.tone === "success" ? "Demo data reset" : "Reset failed"}>{resetMsg.text}</Notice> : null}
      {load.error && !load.data ? <LoadError message={load.error} onRetry={load.reload} /> : null}

      <section className="stats" aria-label="Pipeline counts">
        <div className="card stat-card" data-open={allStats ? "" : undefined} id="pipe-stats">
          <StatCell label="Waiting on a person" value={stats?.humanQueue} href="#/decisions" />
          <StatCell label="Overdue" value={load.data ? overdueCount : undefined} href="#/pipeline" onPick={() => setState(OVERDUE)} />
          <StatCell label="Unverified JEV calls" value={stats?.unverified} href="#/audit?verified=false" />
          <StatCell extra label="Interviews booked" value={stats?.byState.interview_scheduled} href="#/pipeline" onPick={() => setState("interview_scheduled")} />
          <StatCell extra label="Invalid" value={stats?.byState.invalid} href="#/pipeline" onPick={() => setState("invalid")} />
          <StatCell extra label="Duplicates" value={stats?.byState.duplicate} href="#/pipeline" onPick={() => setState("duplicate")} />
        </div>
        <button type="button" className="btn-ghost stats-more" aria-expanded={allStats} aria-controls="pipe-stats" onClick={() => setAllStats((v) => !v)}>
          {allStats ? "Show fewer counts" : "Show all counts"}
        </button>
      </section>

      <section className="toolbar" aria-label="Filter applications">
        <div className="field-row toolbar-fields">
          <div className="field">
            <label htmlFor="pipe-q">Search</label>
            <div className="control-wrap">
              <span className="icon icon-start" aria-hidden="true">
                <Glyph name="search" />
              </span>
              <input
                id="pipe-q"
                type="search"
                className="control-icon-start"
                placeholder="Name, email, ref"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="pipe-state">State</label>
            <select id="pipe-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All states</option>
              <option value={OVERDUE}>Overdue{load.data ? ` (${overdueCount})` : ""}</option>
              {STATE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                  {stats ? ` (${stats.byState[s] ?? 0})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="toolbar-count" aria-live="polite">
          {load.data ? `Showing ${plural(filtered.length, "application")}` : " "}
        </p>
      </section>

      <div className="groups">
        {!load.data && !load.error ? <SkeletonRows rows={6} label="Loading applications" /> : null}
        {load.data && groups.length === 0 ? (
          <Empty
            title="No applications match"
            action={
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setQ("");
                  setState("");
                }}
              >
                Clear filters
              </button>
            }
          >
            Nothing in this state matches the search. Clear the filters to see every application.
          </Empty>
        ) : null}
        {groups.map((g) => (
          <section className="group" key={g.state} aria-labelledby={`grp-${g.state}`}>
            <h2 className="group-title" id={`grp-${g.state}`}>
              {STATE_LABEL[g.state]}
              <span className="group-count num">{g.items.length}</span>
            </h2>
            <div className="list rec-list">
              <div className="rec-head" aria-hidden="true">
                <span>Applicant</span>
                <span>State</span>
                <span>Owner</span>
                <span>Next action</span>
                <span>Due</span>
              </div>
              {g.items.map((a) => (
                <a className="rec" key={a.id} href={`#/app/${a.id}`}>
                  <span className="rec-main">
                    <span className="rec-title">{a.name}</span>
                    <span className="rec-meta">
                      {roleOf(a)}, <span className="nowrap">{a.id}</span>
                    </span>
                  </span>
                  <span className="rec-state">
                    <StateBadge state={a.state} />
                  </span>
                  <span className="rec-owner">{owner(a.owner)}</span>
                  <span className="rec-next">
                    <KeepIds text={a.nextAction} />
                  </span>
                  <span className="rec-due">
                    <Due iso={a.nextActionDue} now={now} />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function StatCell({ label, value, href, onPick, extra }: { label: string; value: number | undefined; href: string; onPick?: () => void; extra?: boolean }) {
  return (
    <a className="stat" href={href} onClick={onPick} data-extra={extra ? "" : undefined}>
      <span className="stat-value num">{value ?? <span className="skel skel-num" />}</span>
      <span className="stat-label">{label}</span>
    </a>
  );
}
