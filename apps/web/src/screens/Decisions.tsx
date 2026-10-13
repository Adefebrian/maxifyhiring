// Screen 4, Decisions. Concepts (ui.region_gate):
//   queue  rows  every application waiting on a person, oldest due first, one Decide per row
//   sheet  card  the decide dialog: action, signer, required reason, API error inline
//                (bottom sheet below 640px, centred dialog from 640px, native <dialog>)
import { useEffect, useMemo, useRef, useState } from "react";
import type { Api, QueueItem } from "../api";
import { DecideForm, type DecideResult } from "../DecideForm";
import { ACTION_LABEL, owner, plural, roleOf, stateLabel } from "../format";
import { Glyph } from "../icons";
import { Due, Empty, KeepIds, LoadError, Notice, PageHeader, SkeletonRows, StateBadge, useLoad } from "../parts";

export function Decisions({ api, now, onChanged }: { api: Api; now: string | null; onChanged: () => void }) {
  const load = useLoad(() => api.queue(), "queue");
  const [open, setOpen] = useState<QueueItem | null>(null);
  const [done, setDone] = useState<(DecideResult & { name: string }) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const items = useMemo(
    () => [...(load.data?.items ?? [])].sort((a, b) => (a.nextActionDue ?? "~").localeCompare(b.nextActionDue ?? "~")),
    [load.data],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);

  function close() {
    setOpen(null);
    openerRef.current?.focus();
  }

  function decided(r: DecideResult) {
    setDone({ ...r, name: open?.name ?? r.app.name });
    setOpen(null);
    load.reload();
    onChanged();
  }

  return (
    <div className="page">
      <PageHeader
        title="Decisions"
        line={load.data ? `${plural(items.length, "application")} ${items.length === 1 ? "waits" : "wait"} on a person. The agent routed each one here instead of guessing.` : "Loading the human queue."}
      />

      {done ? (
        <Notice tone="success" title={done.idempotent ? "Already recorded" : "Decision recorded"}>
          {done.name}: {ACTION_LABEL[done.action].toLowerCase()}. Now {stateLabel(done.app.state).toLowerCase()}, owned by {owner(done.app.owner)}.
        </Notice>
      ) : null}
      {load.error && !load.data ? <LoadError message={load.error} onRetry={load.reload} /> : null}

      {!load.data && !load.error ? <SkeletonRows rows={5} label="Loading the queue" /> : null}
      {load.data && items.length === 0 ? (
        <Empty title="Nobody is waiting on a person">Every application is with the agent or closed. New borderline cases land here.</Empty>
      ) : null}
      {items.length > 0 ? (
        <ul className="list queue">
          {items.map((a) => (
            <li className="queue-row" key={a.id}>
              <div className="queue-main">
                <div className="queue-title">
                  <a className="rec-title link-quiet" href={`#/app/${a.id}`}>
                    {a.name}
                  </a>
                  <StateBadge state={a.state} />
                </div>
                <p className="row-meta">
                  {roleOf(a)}, <span className="nowrap">{a.id}</span>, owned by {owner(a.owner)}
                </p>
                <p className="queue-next">
                  <KeepIds text={a.nextAction} />
                </p>
                <Due iso={a.nextActionDue} now={now} />
              </div>
              <div className="queue-act">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={(e) => {
                    openerRef.current = e.currentTarget;
                    setDone(null);
                    setOpen(a);
                  }}
                  aria-label={`Decide on ${a.name}`}
                >
                  Decide
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={dialogRef}
        className="sheet"
        aria-labelledby="sheet-title"
        onClose={() => {
          if (open) close();
        }}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        {open ? (
          <div className="sheet-inner">
            <div className="sheet-head">
              <div className="sheet-head-text">
                <h2 id="sheet-title">Decide on {open.name}</h2>
                <p className="card-line">
                  {roleOf(open)}, {stateLabel(open.state).toLowerCase()}. {open.nextAction}
                </p>
              </div>
              <button type="button" className="btn-ghost icon-only" aria-label="Close" onClick={close}>
                <Glyph name="close" />
              </button>
            </div>
            <DecideForm key={open.id} api={api} appId={open.id} appOwner={open.owner} actions={open.actions} onDone={decided} onCancel={close} />
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
