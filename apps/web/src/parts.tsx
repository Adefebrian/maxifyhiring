// Shared product parts: badge, notice, due line, skeleton, empty state, page
// header, and the async loader every screen uses. Styles in styles.css.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Match, Ruling, State } from "./api";
import { confidence, due, fmtDayTime, leanedTo, sealLabel, sealOf, STATE_TONE, stateLabel, topHits, type SealInput, type Tone } from "./format";
import { Glyph, type GlyphName } from "./icons";

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: GlyphName; children: ReactNode }) {
  return (
    <span className="badge" data-tone={tone}>
      {icon ? <Glyph name={icon} size={16} /> : null}
      <span>{children}</span>
    </span>
  );
}

export function StateBadge({ state }: { state: State }) {
  return <Badge tone={STATE_TONE[state] ?? "neutral"}>{stateLabel(state)}</Badge>;
}

/** The decision seal: Rule (neutral), Verified by JEV (green), JEV abstained
 * under the confidence floor (neutral, with what it leaned to), Human
 * (neutral), UNVERIFIED BY JEV (amber). Green only ever means JEV verified
 * and acted. */
export function Seal({ d, withLean = true }: { d: SealInput; withLean?: boolean }) {
  const kind = sealOf(d);
  const tone: Tone = kind === "jev" ? "success" : kind === "unverified" ? "warning" : "neutral";
  const icon: GlyphName = kind === "jev" ? "check" : kind === "unverified" ? "warning" : kind === "abstained" || kind === "routed" ? "info" : kind === "human" ? "decide" : "rule";
  const lean = kind === "abstained" && withLean ? leanedTo(d) : null;
  return (
    <span className="seal-wrap">
      <span className="badge seal" data-tone={tone} data-seal={kind}>
        <Glyph name={icon} size={16} />
        <span>{sealLabel(d)}</span>
      </span>
      {lean ? <span className="seal-lean">Leaned to {lean.toLowerCase()}</span> : null}
    </span>
  );
}

/** The agent's last ruling in one block: seal and confidence, the reason on
 * one or two lines, and the top rule hits. */
export function RulingSummary({ r, clamp = false }: { r: Ruling; clamp?: boolean }) {
  const hits = topHits(r.ruleHits);
  return (
    <div className="ruling-sum">
      <div className="ruling-sum-head">
        <Seal d={r} />
        {sealOf(r) !== "abstained" && r.confidence !== null ? <span className="ruling-conf num">Confidence {confidence(r.confidence)}</span> : null}
      </div>
      <p className="ruling-sum-reason" data-clamp={clamp ? "" : undefined} title={clamp ? r.reason : undefined}>
        {r.reason}
      </p>
      {hits.length ? (
        <span className="tokens">
          {hits.map((h) => (
            <span className="token" key={h}>
              {h}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** One compare verdict: a match signal reads in warning ink with its icon. */
function Verdict({ hit, yes, no }: { hit: boolean; yes: string; no: string }) {
  return (
    <span className="verdict" data-hit={hit ? "" : undefined}>
      <Glyph name={hit ? "warning" : "check"} size={16} />
      {hit ? yes : no}
    </span>
  );
}

/** Side by side: this application against the earlier one it may duplicate. */
export function Compare({ self, match }: { self: { id: string; name: string; email: string; phone?: string | null; submittedAt: string }; match: Match }) {
  const rows: [string, string, string][] = [
    ["Name", self.name, match.name],
    ["Email", self.email, match.email],
    ["Phone", self.phone === undefined ? "Loading" : (self.phone ?? "Not given"), match.phone ?? "Not given"],
    ["Submitted", `${fmtDayTime(self.submittedAt)} WIB`, `${fmtDayTime(match.submittedAt)} WIB`],
  ];
  return (
    <div className="compare">
      <div className="compare-grid" role="table" aria-label={`${self.id} compared with ${match.id}`}>
        <div className="compare-row compare-head" role="row">
          <span role="columnheader" className="compare-label">
            Field
          </span>
          <span role="columnheader">
            This application, <span className="nowrap">{self.id}</span>
          </span>
          <span role="columnheader">
            Possible match,{" "}
            <a className="nowrap" href={`#/app/${match.id}`}>
              {match.id}
            </a>
          </span>
        </div>
        {rows.map(([label, a, b]) => (
          <div className="compare-row" role="row" key={label}>
            <span role="rowheader" className="compare-label">
              {label}
            </span>
            <span role="cell">{a}</span>
            <span role="cell">{b}</span>
          </div>
        ))}
      </div>
      <p className="compare-verdicts">
        <Verdict hit={match.sameEmail} yes="Same email" no="Different email" />
        <Verdict hit={match.samePhone} yes="Same phone" no="Different phone" />
        <Verdict hit={match.nameSimilarity >= 0.85} yes={`Name similarity ${Math.round(match.nameSimilarity * 100)}%`} no={`Name similarity ${Math.round(match.nameSimilarity * 100)}%`} />
      </p>
    </div>
  );
}

const NOTICE_ICON: Record<string, GlyphName> = { danger: "alert", warning: "warning", success: "check", info: "info" };

export function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: "danger" | "warning" | "success" | "info";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <span className="notice-icon">
        <Glyph name={NOTICE_ICON[tone] ?? "info"} />
      </span>
      <div className="notice-body">
        <p className="notice-title">{title}</p>
        {children ? <div className="notice-text">{children}</div> : null}
      </div>
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

/** Due against the sim clock. Overdue reads in danger with an icon and the word. */
export function Due({ iso, now }: { iso: string | null; now: string | null }) {
  const d = due(iso, now);
  if (!d) return <span className="due">No due time</span>;
  return (
    <span className="due" data-kind={d.kind} data-overdue={d.overdue ? "" : undefined}>
      {d.overdue ? <Glyph name="alert" size={16} /> : <Glyph name="clock" size={16} />}
      <span>
        {d.label}, <span className="due-at">{d.at} WIB</span>
      </span>
    </span>
  );
}

export function PageHeader({ title, line, actions }: { title: string; line?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {line ? <p className="page-line">{line}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Glyph name="info" size={24} />
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-text">{children}</p> : null}
      {action}
    </div>
  );
}

/** Skeleton rows matching the record row shape, so nothing shifts on load. */
export function SkeletonRows({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="list" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-row" key={i}>
          <span className="skel skel-title" />
          <span className="skel skel-meta" />
        </div>
      ))}
    </div>
  );
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` on mount and whenever `key` changes; keeps the last data while reloading. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    setLoading(true);
    loadRef
      .current()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Turns APP-001 style ids inside agent reasons into links to that case. */
export function Linkify({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /APP-\d{3,}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <a key={i} className="nowrap" href={`#/app/${m[0]}`}>
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Keeps APP-001 style ids on one line inside wrapping text (no links: for use inside a row link). */
export function KeepIds({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/APP-\d{3,}/g)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <span className="nowrap" key={i}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Could not load this view"
      action={
        <button type="button" className="btn-secondary" onClick={onRetry}>
          Try again
        </button>
      }
    >
      {message}
    </Notice>
  );
}
