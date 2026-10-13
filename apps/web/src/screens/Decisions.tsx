// Screen 4, Decisions. Concepts (ui.region_gate):
//   queue  rows  every case waiting on a person, grouped by why it waits (possible
//                duplicate, borderline route, no slot, awaiting decision, rejection
//                notice); each row carries the agent's ruling so the person decides
//                with context. From 1024 a fixed grid: applicant | ruling | due | Decide.
//   sheet  card  the decide dialog: the same ruling card, the duplicate compare when
//                there is a match, then action, signer, required reason, API error inline
//                (bottom sheet below 640px, centred dialog from 640px, native <dialog>)
import { useEffect, useMemo, useRef, useState } from "react";
import type { Api, Detail, QueueItem } from "../api";
import { DecideForm, type DecideResult } from "../DecideForm";
import { ACTION_LABEL, dueKey, owner, plural, QUEUE_GROUP_LABEL, QUEUE_GROUP_ORDER, queueGroup, roleOf, stateLabel, type QueueGroup } from "../format";
import { Glyph } from "../icons";
import { Compare, Due, Empty, KeepIds, LoadError, Notice, PageHeader, RulingSummary, SkeletonRows, useLoad } from "../parts";

export function Decisions({ api, now, onChanged }: { api: Api; now: string | null; onChanged: () => void }) {
  const load = useLoad(() => api.queue(), "queue");
  const [open, setOpen] = useState<QueueItem | null>(null);
  const [done, setDone] = useState<(DecideResult & { name: string }) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const items = load.data?.items ?? [];
  const groups = useMemo(() => {
    const by = new Map<QueueGroup, QueueItem[]>();
    for (const a of load.data?.items ?? []) {
      const g = queueGroup(a);
      by.set(g, [...(by.get(g) ?? []), a]);
    }
    return QUEUE_GROUP_ORDER.filter((g) => by.has(g)).map((g) => {
      const list = by.get(g)!.sort((a, b) => dueKey(a.nextActionDue) - dueKey(b.nextActionDue));
      const shared = list.every((a) => a.nextAction === list[0]!.nextAction) ? list[0]!.nextAction : null;
      return { key: g, items: list, shared };
    });
  }, [load.data]);

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
    <div className="page page-queue">
      <PageHeader
        title="Decisions"
        line={load.data ? `${plural(items.length, "application")} ${items.length === 1 ? "waits" : "wait"} on a person. Each one carries the agent's ruling and why it stopped.` : "Loading the human queue."}
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

      <div className="groups">
        {groups.map((g) => (
          <section className="group" key={g.key} aria-labelledby={`q-${g.key}`}>
            <div className="group-head">
              <h2 className="group-title" id={`q-${g.key}`}>
                {QUEUE_GROUP_LABEL[g.key]}
                <span className="group-count num">{g.items.length}</span>
              </h2>
              {g.shared ? <p className="band-line">{g.shared}</p> : null}
            </div>
            <ul className="list queue">
              {g.items.map((a) => (
                <li className="queue-row" key={a.id}>
                  <div className="queue-who">
                    <a className="rec-title link-quiet" href={`#/app/${a.id}`}>
                      {a.name}
                    </a>
                    <span className="rec-meta">
                      {roleOf(a)}, <span className="nowrap">{a.id}</span>
                    </span>
                    <span className="rec-meta">{owner(a.owner)}</span>
                    {!g.shared ? (
                      <span className="queue-next">
                        <KeepIds text={a.nextAction} />
                      </span>
                    ) : null}
                  </div>
                  <div className="queue-ruling">{a.ruling ? <RulingSummary r={a.ruling} clamp /> : <span className="rec-meta">No agent ruling on record.</span>}</div>
                  <div className="queue-due">
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
          </section>
        ))}
      </div>

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
        {open ? <SheetBody api={api} item={open} onDone={decided} onClose={close} /> : null}
      </dialog>
    </div>
  );
}

function SheetBody({ api, item, onDone, onClose }: { api: Api; item: QueueItem; onDone: (r: DecideResult) => void; onClose: () => void }) {
  // The full case (phone and the duplicate match) loads behind the summary we already have.
  const detail = useLoad<Detail>(() => api.application(item.id), item.id);
  const match = detail.data?.match ?? item.match ?? null;
  const self = detail.data?.app ?? item;
  return (
    <div className="sheet-inner">
      <div className="sheet-head">
        <div className="sheet-head-text">
          <h2 id="sheet-title">Decide on {item.name}</h2>
          <p className="card-line">
            {roleOf(item)}, {stateLabel(item.state).toLowerCase()}. {item.nextAction}
          </p>
        </div>
        <button type="button" className="btn-ghost icon-only" aria-label="Close" onClick={onClose}>
          <Glyph name="close" />
        </button>
      </div>
      {item.ruling ? (
        <div className="sheet-block">
          <p className="decide-sub">Agent ruling</p>
          <RulingSummary r={item.ruling} />
        </div>
      ) : null}
      {match ? (
        <div className="sheet-block">
          <p className="decide-sub">Possible duplicate</p>
          <Compare self={self} match={match} />
        </div>
      ) : null}
      <DecideForm key={item.id} api={api} appId={item.id} appOwner={item.owner} actions={item.actions} onDone={onDone} onCancel={onClose} />
    </div>
  );
}
