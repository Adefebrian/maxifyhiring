// Screen 3, Schedule. Concepts (ui.region_gate):
//   clock  card             the sim clock and the controls that move it
//   week   card             each interviewer's working week: busy blocks and booked interviews (DataTable
//                            from 640px; a day picker plus a day agenda below 640px)
//   lists  divided-section  upcoming, done, and no-show interviews
import { useMemo, useState } from "react";
import type { Api, Interview, Schedule as ScheduleData } from "../api";
import { fmtDay, fmtDayTime, fmtTime, isWeekend, plural, wibDate } from "../format";
import { Glyph } from "../icons";
import { Badge, LoadError, Notice, SkeletonRows, useLoad } from "../parts";

const STEPS = [
  { hours: 1, label: "+1 hour" },
  { hours: 24, label: "+1 day" },
  { hours: 168, label: "+1 week" },
];

const DAY = 86_400_000;

function dayStart(key: string): number {
  return Date.parse(`${key}T00:00:00+07:00`);
}

/** Five working days (WIB) from the sim clock's date, shifted by whole weeks. */
function workDays(now: string, weekOffset: number): string[] {
  let t = dayStart(wibDate(now)) + weekOffset * 7 * DAY;
  const out: string[] = [];
  while (out.length < 5) {
    const iso = new Date(t + 12 * 3_600_000).toISOString();
    if (!isWeekend(iso)) out.push(wibDate(iso));
    t += DAY;
  }
  return out;
}

export function Schedule({ api, onChanged }: { api: Api; onChanged: () => void }) {
  const load = useLoad<ScheduleData>(() => api.schedule(), "schedule");
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "danger"; title: string; text: string } | null>(null);
  const [week, setWeek] = useState(0);

  async function advance(hours: number, label: string) {
    setBusy(hours);
    try {
      const r = await api.advance(hours);
      setResult({
        tone: "success",
        title: `Clock moved ${label.replace("+", "")}`,
        text: `Now ${fmtDayTime(r.now)} WIB. ${plural(r.done.length, "interview")} marked done, ${plural(r.noShows.length, "no-show", "no-shows")}.`,
      });
      setWeek(0);
      load.reload();
      onChanged();
    } catch (e) {
      setResult({ tone: "danger", title: "Clock did not move", text: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(null);
    }
  }

  const data = load.data;
  const days = useMemo(() => (data ? workDays(data.now, week) : []), [data, week]);

  const groups = useMemo(() => {
    const iv = [...(data?.interviews ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    return [
      { key: "scheduled", title: "Upcoming", empty: "No interview is booked.", items: iv.filter((i) => i.status === "scheduled") },
      { key: "done", title: "Done", empty: "None yet. Move the clock past an interview to see it here.", items: iv.filter((i) => i.status === "done") },
      { key: "no_show", title: "No-show", empty: "No candidate has missed an interview.", items: iv.filter((i) => i.status === "no_show") },
    ];
  }, [data]);

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head-text">
          <h1>Schedule</h1>
          <p className="page-line">Interviews run on a simulated clock. Move it forward to finish interviews and surface no-shows.</p>
        </div>
      </header>

      {load.error && !data ? <LoadError message={load.error} onRetry={load.reload} /> : null}

      <section className="card clock-card" aria-labelledby="clock-title">
        <div className="clock-read">
          <h2 id="clock-title" className="clock-label">
            Sim clock
          </h2>
          <p className="clock-value num">{data ? `${fmtDayTime(data.now)} WIB` : <span className="skel skel-clock" />}</p>
        </div>
        <div className="clock-steps" role="group" aria-label="Advance the clock">
          {STEPS.map((s) => (
            <button
              key={s.hours}
              type="button"
              className="btn-secondary"
              onClick={() => advance(s.hours, s.label)}
              disabled={busy !== null && busy !== s.hours}
              aria-busy={busy === s.hours ? true : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {result ? (
        <Notice tone={result.tone} title={result.title}>
          {result.text}
        </Notice>
      ) : null}

      <section className="card week-card" aria-labelledby="week-title">
        <div className="week-head">
          <h2 id="week-title">Interviewer week</h2>
          <div className="week-nav">
            <button type="button" className="btn-secondary icon-only" aria-label="Previous week" onClick={() => setWeek((w) => w - 1)} disabled={week <= 0}>
              <Glyph name="back" />
            </button>
            <p className="week-range num">{days.length ? `${fmtDay(`${days[0]}T05:00:00Z`)} to ${fmtDay(`${days[4]}T05:00:00Z`)}` : " "}</p>
            <button type="button" className="btn-secondary icon-only" aria-label="Next week" onClick={() => setWeek((w) => w + 1)} disabled={week >= 2}>
              <Glyph name="next" />
            </button>
          </div>
        </div>
        {!data ? (
          <SkeletonRows rows={6} label="Loading the week" />
        ) : (
          <>
          <Agenda data={data} days={days} />
          <div className="scroll-x week-scroll week-wide" tabIndex={0} aria-label="Interviewer week">
            <table className="table week-table">
              <thead>
                <tr>
                  <th scope="col">Interviewer</th>
                  {days.map((d) => (
                    <th scope="col" key={d}>
                      {fmtDay(`${d}T05:00:00Z`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.interviewers.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <span className="cell-title">{p.name}</span>
                      <span className="cell-meta">{p.roleCodes.join(", ")}</span>
                    </th>
                    {days.map((d) => {
                      const s = dayStart(d);
                      const e = s + DAY;
                      const blocks = p.busy.filter((b) => Date.parse(b.start) < e && Date.parse(b.end) > s);
                      const ivs = data.interviews.filter((i) => i.interviewerId === p.id && wibDate(i.start) === d);
                      return (
                        <td key={d}>
                          {blocks.length === 0 && ivs.length === 0 ? <span className="cell-free">Free</span> : null}
                          <div className="slots">
                            {blocks.map((b, i) => (
                              <span className="slot" data-kind="busy" key={`b${i}`}>
                                <span className="slot-label">{b.label}</span>
                                <span className="slot-time num">Busy, {blockTime(b.start, b.end, s, e)}</span>
                              </span>
                            ))}
                            {ivs.map((i) => (
                              <a className="slot" data-kind="interview" data-status={i.status} key={i.id} href={`#/app/${i.appId}`}>
                                <span className="slot-label">{i.name ?? i.appId}</span>
                                <span className="slot-time num">
                                  Interview, {fmtTime(i.start)}
                                  {i.status === "done" ? ", done" : i.status === "no_show" ? ", no-show" : ""}
                                </span>
                              </a>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <section className="band band-stack" aria-label="Interviews by status">
        {groups.map((g) => (
          <div className="sub-band" key={g.key}>
            <h2>
              {g.title}
              <span className="group-count num">{data ? g.items.length : ""}</span>
            </h2>
            {!data ? (
              <SkeletonRows rows={2} label={`Loading ${g.title}`} />
            ) : g.items.length === 0 ? (
              <p className="band-empty">{g.empty}</p>
            ) : (
              <ul className="list">
                {g.items.map((i) => (
                  <InterviewRow iv={i} key={i.id} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

interface AgendaRow {
  key: string;
  start: number;
  time: string;
  title: string;
  who: string;
  href?: string;
  status: "busy" | "scheduled" | "done" | "no_show";
}

const STATUS_LABEL: Record<AgendaRow["status"], string> = { busy: "Busy", scheduled: "Interview", done: "Done", no_show: "No-show" };

/** Below 640px the week becomes a day agenda: a day picker, then one row per
 * interview or busy block (time, candidate or block, interviewer, status). */
function Agenda({ data, days }: { data: ScheduleData; days: string[] }) {
  const firstWithInterviews = days.find((d) => data.interviews.some((i) => wibDate(i.start) === d)) ?? days[0] ?? "";
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && days.includes(picked) ? picked : firstWithInterviews;
  const s = dayStart(day);
  const e = s + DAY;
  const rows: AgendaRow[] = [];
  for (const p of data.interviewers) {
    for (const b of p.busy) {
      if (Date.parse(b.start) < e && Date.parse(b.end) > s) {
        rows.push({ key: `b-${p.id}-${b.start}`, start: Math.max(Date.parse(b.start), s), time: capFirst(blockTime(b.start, b.end, s, e)), title: b.label, who: p.name, status: "busy" });
      }
    }
  }
  for (const i of data.interviews) {
    if (wibDate(i.start) !== day) continue;
    rows.push({ key: `i-${i.id}`, start: Date.parse(i.start), time: `${fmtTime(i.start)} to ${fmtTime(i.end)}`, title: i.name ?? i.appId, who: i.interviewerName, href: `#/app/${i.appId}`, status: i.status });
  }
  rows.sort((a, b) => a.start - b.start || a.who.localeCompare(b.who));
  return (
    <div className="agenda">
      <div className="day-picker" role="group" aria-label="Pick a day">
        {days.map((d) => {
          const label = fmtDay(`${d}T05:00:00Z`);
          const [wd, dn] = label.split(" ");
          return (
            <button key={d} type="button" className="btn-secondary day-btn" aria-pressed={d === day} aria-label={label} onClick={() => setPicked(d)}>
              <span className="day-wd">{wd}</span>
              <span className="day-dn num">{dn}</span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="band-empty">Nothing booked on {fmtDay(`${day}T05:00:00Z`)}. Every interviewer is free.</p>
      ) : (
        <ul className="list">
          {rows.map((r) => {
            const body = (
              <>
                <span className="log-time">{r.time}</span>
                <span className="row-main">
                  <span className="row-title">{r.title}</span>
                  <span className="row-meta">{r.status === "busy" ? `${r.who} is busy` : `with ${r.who}`}</span>
                </span>
                <Badge tone={r.status === "done" ? "success" : r.status === "no_show" ? "danger" : "neutral"}>{STATUS_LABEL[r.status]}</Badge>
              </>
            );
            return (
              <li key={r.key}>
                {r.href ? (
                  <a className="row agenda-row row-link" href={r.href}>
                    {body}
                  </a>
                ) : (
                  <div className="row agenda-row">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function capFirst(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function blockTime(start: string, end: string, dayS: number, dayE: number): string {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (s <= dayS && e >= dayE) return "All day";
  const from = s < dayS ? "start of day" : fmtTime(start);
  const to = e > dayE ? "end of day" : fmtTime(end);
  return `${from} to ${to}`;
}

function InterviewRow({ iv }: { iv: Interview }) {
  return (
    <li>
      <a className="row row-link" href={`#/app/${iv.appId}`}>
        <span className="row-main">
          <span className="row-title">{iv.name ?? iv.appId}</span>
          <span className="row-meta num">
            {fmtDayTime(iv.start)} to {fmtTime(iv.end)} WIB with {iv.interviewerName}
            {iv.attempt > 1 ? `, attempt ${iv.attempt}` : ""}
          </span>
        </span>
        <Glyph name="next" />
      </a>
    </li>
  );
}
