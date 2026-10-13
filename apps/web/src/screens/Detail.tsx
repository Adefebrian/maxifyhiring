// Screen 2, Application detail (the case file). Concepts (ui.region_gate):
//   head        divided-section  who this is and where the case stands
//   decide      card             the human decision, only when the API offers actions
//   issues      divided-section  validation errors and duplicate links, only when present
//   decisions   rows             every routing ruling: stage, decided by, stamp, confidence, rule hits, reason
//   interviews  divided-section  booked, done or no-show interviews
//   facts       card             what the applicant submitted
//   log         rows             state changes as plain rows (no connector lines, no marker dots)
import { useState } from "react";
import type { Api, Detail as DetailData } from "../api";
import { DecideForm, type DecideResult } from "../DecideForm";
import {
  ACTION_LABEL,
  confidence,
  DECIDED_BY_LABEL,
  decisionLabel,
  fmtDayTime,
  fmtTime,
  owner,
  roleOf,
  STAGE_LABEL,
  stateLabel,
} from "../format";
import { Glyph } from "../icons";
import { Badge, Due, Empty, Linkify, LoadError, Notice, SkeletonRows, StampBadge, StateBadge, useLoad } from "../parts";

export function Detail({ api, id, now, onChanged }: { api: Api; id: string; now: string | null; onChanged: () => void }) {
  const load = useLoad<DetailData>(() => api.application(id), id);
  const [done, setDone] = useState<DecideResult | null>(null);

  const back = (
    <a className="back-link" href="#/pipeline">
      <Glyph name="back" />
      Pipeline
    </a>
  );

  if (load.error && !load.data) {
    return (
      <div className="page page-narrow">
        {back}
        <LoadError message={load.error} onRetry={load.reload} />
      </div>
    );
  }
  if (!load.data) {
    return (
      <div className="page page-narrow">
        {back}
        <div className="page-head">
          <div className="page-head-text">
            <h1>{id}</h1>
            <p className="page-line">Loading the case file.</p>
          </div>
        </div>
        <SkeletonRows rows={5} label="Loading application" />
      </div>
    );
  }

  const { app, log, decisions, errors, interviews, duplicates, actions } = load.data;
  const dupLinks = [
    ...(app.duplicateOf ? [{ id: app.duplicateOf, label: `Duplicate of ${app.duplicateOf}`, state: null as string | null }] : []),
    ...duplicates.filter((d) => d.id !== app.duplicateOf).map((d) => ({ id: d.id, label: `${d.name}, ${d.id}`, state: d.state as string | null })),
  ];
  const hasIssues = errors.length > 0 || dupLinks.length > 0;

  function decided(r: DecideResult) {
    setDone(r);
    load.reload();
    onChanged();
  }

  return (
    <div className="page page-narrow">
      {back}

      <header className="case-head">
        <div className="case-title">
          <h1>{app.name}</h1>
          <StateBadge state={app.state} />
        </div>
        <p className="page-line">
          {roleOf(app)}, <span className="nowrap">{app.id}</span>, reference <span className="nowrap">{app.ref}</span>
        </p>
        <dl className="case-meta">
          <div>
            <dt>Owner</dt>
            <dd>{owner(app.owner)}</dd>
          </div>
          <div>
            <dt>Next action</dt>
            <dd>{app.nextAction || "None"}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>
              <Due iso={app.nextActionDue} now={now} />
            </dd>
          </div>
        </dl>
      </header>

      {done ? (
        <Notice tone="success" title={done.idempotent ? "Already recorded" : "Decision recorded"}>
          {ACTION_LABEL[done.action]}: the case is now {stateLabel(done.app.state).toLowerCase()}, owned by {owner(done.app.owner)}.
        </Notice>
      ) : null}

      {actions.length > 0 ? (
        <section className="card decide-card" aria-labelledby="decide-title">
          <div className="card-head">
            <h2 id="decide-title">Decision needed</h2>
            <p className="card-line">The agent will not decide this one alone. Pick a route and say why; the reason is kept on the audit log.</p>
          </div>
          <DecideForm key={app.state} api={api} appId={app.id} appOwner={app.owner} actions={actions} onDone={decided} />
        </section>
      ) : null}

      {hasIssues ? (
        <section className="band band-divided" aria-labelledby="issues-title">
          <h2 id="issues-title">What blocks it</h2>
          {errors.length > 0 ? (
            <Notice tone="danger" title={errors.length === 1 ? "1 validation error" : `${errors.length} validation errors`}>
              <ul className="plain-list">
                {errors.map((e) => (
                  <li key={`${e.code}-${e.field}`}>
                    <span className="code">{e.code}</span> on {e.field}: {e.message}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {dupLinks.length > 0 ? (
            <Notice tone="warning" title="Possible duplicate">
              <ul className="plain-list">
                {dupLinks.map((d) => (
                  <li key={d.id}>
                    <a href={`#/app/${d.id}`}>{d.label}</a>
                    {d.state ? `, ${stateLabel(d.state).toLowerCase()}` : ""}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </section>
      ) : null}

      <section className="band" aria-labelledby="rulings-title">
        <h2 id="rulings-title">Routing decisions</h2>
        {decisions.length === 0 ? (
          <Empty title="No decisions yet">The agent has not ruled on this application.</Empty>
        ) : (
          <ol className="list">
            {decisions.map((d) => (
              <li className="ruling" key={d.id}>
                <div className="ruling-head">
                  <p className="ruling-title">
                    {STAGE_LABEL[d.stage] ?? d.stage}: {decisionLabel(d.decision)}
                  </p>
                  <div className="ruling-badges">
                    <Badge>Decided by {DECIDED_BY_LABEL[d.decidedBy] ?? d.decidedBy}</Badge>
                    <StampBadge verified={d.verified} stamp={d.stamp} />
                  </div>
                </div>
                <p className="ruling-reason">
                  <Linkify text={d.reason} />
                </p>
                <div className="ruling-meta">
                  <span className="num">Confidence {confidence(d.confidence)}</span>
                  <span className="num">{fmtDayTime(d.at)} WIB</span>
                  {d.ruleHits.map((h) => (
                    <span className="token" key={h}>
                      {h}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="band band-divided" aria-labelledby="iv-title">
        <h2 id="iv-title">Interviews</h2>
        {interviews.length === 0 ? (
          <p className="band-empty">No interview booked for this application.</p>
        ) : (
          <ul className="list">
            {interviews.map((iv) => (
              <li className="row" key={iv.id}>
                <div className="row-main">
                  <p className="row-title">{iv.interviewerName}</p>
                  <p className="row-meta num">
                    {fmtDayTime(iv.start)} to {fmtTime(iv.end)} WIB, attempt {iv.attempt}
                  </p>
                </div>
                <Badge tone={iv.status === "no_show" ? "danger" : iv.status === "done" ? "success" : "neutral"}>
                  {iv.status === "no_show" ? "No-show" : iv.status === "done" ? "Done" : "Scheduled"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card facts-card" aria-labelledby="facts-title">
        <h2 id="facts-title">Submitted facts</h2>
        <dl className="facts">
          <Fact label="Email" value={app.email} />
          <Fact label="Phone" value={app.phone ?? "Not given"} />
          <Fact label="Location" value={app.location ?? "Not given"} />
          <Fact label="Experience" value={app.yearsExp === null ? "Not given" : `${app.yearsExp} years`} />
          <Fact label="Submitted" value={`${fmtDayTime(app.submittedAt)} WIB`} />
          <Fact label="Consent" value={app.consent ? "Given" : "Not given"} />
          <Fact label="Match score" value={app.score === null ? "Not scored" : String(app.score)} />
          <Fact label="Updated" value={`${fmtDayTime(app.updatedAt)} WIB`} />
          <div className="fact fact-wide">
            <dt>Skills</dt>
            <dd className="tokens">
              {app.skills.length ? app.skills.map((s) => <span className="token" key={s}>{s}</span>) : "None listed"}
            </dd>
          </div>
          <div className="fact fact-wide">
            <dt>Availability</dt>
            <dd>
              {app.availability.length
                ? app.availability.map((a, i) => (
                    <span className="num" key={i}>
                      {i > 0 ? "; " : ""}
                      {fmtDayTime(a.start)} to {fmtTime(a.end)} WIB
                    </span>
                  ))
                : "Any interviewer slot"}
            </dd>
          </div>
          <div className="fact fact-wide">
            <dt>CV text</dt>
            <dd className="prose">{app.cvText || "No CV text."}</dd>
          </div>
        </dl>
      </section>

      <section className="band" aria-labelledby="log-title">
        <h2 id="log-title">Pipeline log</h2>
        <ol className="list">
          {log.map((l) => (
            <li className="row log-row" key={l.id}>
              <div className="row-main">
                <p className="row-title">
                  {l.fromState ? `${stateLabel(l.fromState)} to ${stateLabel(l.toState)}` : `Entered as ${stateLabel(l.toState).toLowerCase()}`}
                </p>
                <p className="row-meta">
                  <span className="num">{fmtDayTime(l.at)} WIB</span>, by {owner(l.actor)}, now owned by {owner(l.owner)}
                  {l.note ? `. ${l.note}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
