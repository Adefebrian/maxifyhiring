// Shared product parts: badge, notice, due line, skeleton, empty state, page
// header, and the async loader every screen uses. Styles in styles.css.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { State } from "./api";
import { due, STATE_TONE, stateLabel, type Tone } from "./format";
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

export function StampBadge({ verified, stamp }: { verified: boolean; stamp: string | null }) {
  if (!verified || stamp) {
    return (
      <Badge tone="warning" icon="warning">
        {stamp ?? "UNVERIFIED BY JEV"}
      </Badge>
    );
  }
  return (
    <Badge tone="success" icon="check">
      Verified
    </Badge>
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
    <span className="due" data-overdue={d.overdue ? "" : undefined}>
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
