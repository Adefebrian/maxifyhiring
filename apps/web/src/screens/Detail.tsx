// Screen 2, Application detail (the case file). Concepts (ui.region_gate):
//   head        divided-section  who this is and where the case stands
//   decide      card             the human decision, only when the API offers actions,
//                                with the agent's ruling (and the duplicate compare) above it
//   issues      section          validation problems, or the duplicate link
//   decisions   rows             every ruling with its seal: rule, verified by JEV, JEV abstained, unverified
//   interviews  rows             booked, done or no-show interviews
//   facts       card             what the applicant submitted
//   log         rows             state changes as plain rows (no connector lines, no marker dots)
// Every section has its heading outside its container, one pattern down the page.
import { useState } from "react";
import type { Api, Detail as DetailData } from "../api";
import { DecideForm, type DecideResult } from "../DecideForm";
import { ACTION_LABEL, confidence, DECIDED_BY_LABEL, decisionLabel, fmtDayTime, fmtTime, owner, roleOf, sealOf, STAGE_LABEL, stateLabel, topHits } from "../format";
import { Glyph } from "../icons";
import { Badge, Compare, Due, Empty, KeepIds, Linkify, LoadError, Notice, RulingSummary, Seal, SkeletonRows, StateBadge, useLoad } from "../parts";

/** A log note that only repeats what the title already says is dropped. */
function usefulNote(note: string): string | null {
  const n = note.trim();
  if (!n || /^application received$/i.test(n)) return null;
  return n;
}

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

  const { app, log, decisions, errors, interviews, duplicates, actions, ruling, match } = load.data;
  // A confirmed duplicate links once, neutrally. An open review (match present)
  // shows the compare inside the decide card instead.
  const linkedTo = app.state === "duplicate" ? app.duplicateOf ?? duplicates[0]?.id ?? null : null;
  const otherDupes = duplicates.filter((d) => d.id !== linkedTo && d.id !== match?.id);
  const hasIssues = errors.length > 0 || linkedTo !== null || otherDupes.length > 0;

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
            <dd>
              <KeepIds text={app.nextAction || "None"} />
            </dd>
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
        <section className="band" aria-labelledby="decide-title">
          <div className="band-head">
            <h2 id="decide-title">Decision needed</h2>
            <p className="band-line">The agent did not decide this one alone. Read its ruling, pick a route, and say why; the reason is kept on the audit log.</p>
          </div>
          <div className="card decide-card">
            {ruling ? <RulingSummary r={ruling} /> : null}
            {match ? (
              <div className="decide-compare">
                <p className="decide-sub">Possible duplicate</p>
                <Compare self={app} match={match} />
              </div>
            ) : null}
            <DecideForm key={app.state} api={api} appId={app.id} appOwner={app.owner} actions={actions} onDone={decided} />
          </div>
        </section>
      ) : null}

      {hasIssues ? (
        <section className="band" aria-labelledby="issues-title">
          <h2 id="issues-title">{linkedTo && errors.length === 0 ? "Linked application" : "What blocks it"}</h2>
          {errors.length > 0 ? (
            <Notice tone="danger" title={errors.length === 1 ? "1 thing to fix" : `${errors.length} things to fix`}>
              <ul className="plain-list issue-list">
                {errors.map((e) => (
                  <li key={`${e.code}-${e.field}`}>
                    <span>{e.message}</span> <span className="token">{e.code}</span>
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {linkedTo ? (
            <div className="link-row">
              <Glyph name="link" />
              <p>
                Linked as duplicate of <a href={`#/app/${linkedTo}`}>{linkedTo}</a>. The earlier application stays primary.
              </p>
            </div>
          ) : null}
          {otherDupes.length > 0 ? (
            <div className="link-row">
              <Glyph name="link" />
              <p>
                Later applications linked here:{" "}
                {otherDupes.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 ? ", " : ""}
                    <a href={`#/app/${d.id}`}>{d.id}</a>
                  </span>
                ))}
                .
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="band" aria-labelledby="rulings-title">
        <h2 id="rulings-title">Routing decisions</h2>
        {decisions.length === 0 ? (
          <Empty title="No decisions yet">The agent has not ruled on this application.</Empty>
        ) : (
          <ol className="list">
            {decisions.map((d) => {
              const hits = topHits(d.ruleHits, 8);
              return (
                <li className="ruling" key={d.id}>
                  <div className="ruling-head">
                    <p className="ruling-title">
                      {STAGE_LABEL[d.stage] ?? d.stage}: {decisionLabel(d.decision)}
                    </p>
                    <Seal d={d} />
                  </div>
                  <p className="ruling-reason">
                    <Linkify text={d.reason} />
                  </p>
                  <div className="ruling-meta">
                    <span>Decided by {DECIDED_BY_LABEL[d.decidedBy] ?? d.decidedBy}</span>
                    {sealOf(d) !== "abstained" ? <span className="num">Confidence {confidence(d.confidence)}</span> : null}
                    <span className="num">{fmtDayTime(d.at)} WIB</span>
                    {hits.map((h) => (
                      <span className="token" key={h}>
                        {h}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="band" aria-labelledby="iv-title">
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

      <section className="band" aria-labelledby="facts-title">
        <h2 id="facts-title">Submitted facts</h2>
        <div className="card">
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
                {app.skills.length
                  ? app.skills.map((s) => (
                      <span className="token" key={s}>
                        {s}
                      </span>
                    ))
                  : "None listed"}
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
        </div>
      </section>

      <section className="band" aria-labelledby="log-title">
        <h2 id="log-title">Pipeline log</h2>
        <ol className="list">
          {log.map((l) => {
            const note = usefulNote(l.note);
            return (
              <li className="row log-row" key={l.id}>
                <span className="log-time">{fmtDayTime(l.at)}</span>
                <div className="row-main">
                  <p className="log-title">{l.fromState ? `${stateLabel(l.fromState)} to ${stateLabel(l.toState)}` : `Entered as ${stateLabel(l.toState).toLowerCase()}`}</p>
                  <p className="row-meta">
                    By {owner(l.actor)}, now owned by {owner(l.owner)}
                    {note ? `. ${note}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
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
