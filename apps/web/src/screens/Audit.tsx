// Screen 5, Audit. Concepts (ui.region_gate):
//   toolbar  card  decided-by and verification segmented filters, stage select, count, Export JSON
//   table    rows  every routing decision; a DataTable from 1024px, stacked records below
import { useMemo, useState } from "react";
import type { Api, Decision } from "../api";
import { confidence, DECIDED_BY_LABEL, decisionLabel, fmtDayTime, plural, STAGE_LABEL } from "../format";
import { Glyph } from "../icons";
import { Badge, Empty, Linkify, LoadError, PageHeader, SkeletonRows, StampBadge, useLoad } from "../parts";

const BY = [
  { v: "", label: "All" },
  { v: "rule", label: "Rule" },
  { v: "jev", label: "JEV" },
  { v: "human", label: "Human" },
];
const VERIFIED = [
  { v: "", label: "All" },
  { v: "true", label: "Verified" },
  { v: "false", label: "Unverified" },
];
const STAGES = ["validation", "dedupe", "route", "schedule", "human"];
const PAGE = 30;

export function Audit({ api, initial }: { api: Api; initial: { decidedBy?: string; stage?: string; verified?: string } }) {
  const [decidedBy, setDecidedBy] = useState(initial.decidedBy ?? "");
  const [stage, setStage] = useState(initial.stage ?? "");
  const [verified, setVerified] = useState(initial.verified ?? "");
  const key = `${decidedBy}|${stage}|${verified}`;
  const pick = (set: (v: string) => void) => (v: string) => {
    set(v);
    setShown(PAGE);
  };
  const load = useLoad(() => api.audit({ decidedBy, stage, verified }), key);
  const items = useMemo(() => load.data?.items ?? [], [load.data]);
  const [shown, setShown] = useState(PAGE);
  const visible = items.slice(0, shown);

  function exportJson() {
    const payload = { exportedAt: new Date().toISOString(), filters: { decidedBy: decidedBy || "all", stage: stage || "all", verified: verified || "all" }, count: items.length, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maxifyhiring-audit-${[decidedBy || "all", stage || "all", verified ? (verified === "true" ? "verified" : "unverified") : "all"].join("-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="page">
      <PageHeader title="Audit" line="Every routing decision the agent made, who made it, whether JEV verified it, and the reason on record." />

      <section className="card audit-tools" aria-label="Filter decisions">
        <div className="audit-filters">
          <Segmented legend="Decided by" name="by" options={BY} value={decidedBy} onChange={pick(setDecidedBy)} />
          <Segmented legend="Verification" name="verified" options={VERIFIED} value={verified} onChange={pick(setVerified)} />
          <div className="field">
            <label htmlFor="audit-stage">Stage</label>
            <select id="audit-stage" value={stage} onChange={(e) => pick(setStage)(e.target.value)}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="audit-foot">
          <p className="toolbar-count" aria-live="polite">
            {load.data ? plural(items.length, "decision") : "Loading"}
          </p>
          <button type="button" className="btn-primary" onClick={exportJson} disabled={!load.data || items.length === 0}>
            <Glyph name="download" />
            Export JSON
          </button>
        </div>
      </section>

      {load.error && !load.data ? <LoadError message={load.error} onRetry={load.reload} /> : null}
      {!load.data && !load.error ? <SkeletonRows rows={6} label="Loading decisions" /> : null}
      {load.data && items.length === 0 ? (
        <Empty
          title="No decisions match"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDecidedBy("");
                setStage("");
                setVerified("");
              }}
            >
              Clear filters
            </button>
          }
        >
          No routing decision fits all three filters.
        </Empty>
      ) : null}
      {items.length > 0 ? (
        <div className="list audit-table" role="table" aria-label="Routing decisions" aria-busy={load.loading ? true : undefined}>
          <div className="audit-head" role="row">
            <span role="columnheader">Applicant</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader">Decided by</span>
            <span role="columnheader">Verification</span>
            <span role="columnheader" className="num-col">
              Confidence
            </span>
            <span role="columnheader">Reason</span>
          </div>
          {visible.map((d) => (
            <AuditRow d={d} key={d.id} />
          ))}
        </div>
      ) : null}
      {items.length > visible.length ? (
        <div className="more">
          <p className="toolbar-count">
            Showing {visible.length} of {items.length}. Export includes all {items.length}.
          </p>
          <button type="button" className="btn-secondary" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, items.length - visible.length)} more
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AuditRow({ d }: { d: Decision }) {
  return (
    <div className="audit-row" role="row">
      <span className="audit-who" role="cell">
        <a className="rec-title link-quiet" href={`#/app/${d.appId}`}>
          {d.name ?? d.appId}
        </a>
        <span className="rec-meta num">{d.appId}</span>
        <span className="rec-meta num nowrap">{fmtDayTime(d.at)} WIB</span>
      </span>
      <span className="audit-stage" role="cell">
        <span className="audit-label">Stage </span>
        {STAGE_LABEL[d.stage] ?? d.stage}: {decisionLabel(d.decision)}
      </span>
      <span className="audit-by" role="cell">
        <Badge>{DECIDED_BY_LABEL[d.decidedBy] ?? d.decidedBy}</Badge>
      </span>
      <span className="audit-stamp" role="cell">
        <StampBadge verified={d.verified} stamp={d.stamp} />
      </span>
      <span className="audit-conf num num-col" role="cell">
        <span className="audit-label">Confidence </span>
        {confidence(d.confidence)}
      </span>
      <span className="audit-reason" role="cell">
        <Linkify text={d.reason} />
        {d.ruleHits.length ? (
          <span className="tokens">
            {d.ruleHits.map((h) => (
              <span className="token" key={h}>
                {h}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function Segmented({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { v: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <span className="field-label" id={`seg-${name}`}>
        {legend}
      </span>
      <div className="seg" role="group" aria-labelledby={`seg-${name}`}>
        {options.map((o) => (
          <button key={o.v || "all"} type="button" className="btn-secondary seg-item" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
