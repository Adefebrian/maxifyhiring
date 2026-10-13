// The human decision form: one allowed action, who decides, and a required
// reason that lands in the audit log. Used in the application detail card
// and in the Decisions sheet. The API's own error (400, 404, 409) shows
// inline; the helper slot is reserved so validation never moves the layout.
import { useId, useState, type FormEvent } from "react";
import type { Api, AppSummary, HumanAction } from "./api";
import { ApiError } from "./api";
import { ACTION_LABEL, isPersonDecider, owner } from "./format";
import { Notice } from "./parts";

const DECIDERS = ["recruiter:Rina", "hm:Dimas", "hm:Maya", "hm:Sari"];

export interface DecideResult {
  idempotent: boolean;
  app: AppSummary;
  action: HumanAction;
}

export function DecideForm({
  api,
  appId,
  appOwner,
  actions,
  onDone,
  onCancel,
}: {
  api: Api;
  appId: string;
  appOwner: string;
  actions: HumanAction[];
  onDone: (r: DecideResult) => void;
  onCancel?: () => void;
}) {
  const uid = useId();
  const deciders = isPersonDecider(appOwner) && !DECIDERS.includes(appOwner) ? [appOwner, ...DECIDERS] : DECIDERS;
  const [action, setAction] = useState<HumanAction>(actions[0] ?? "hold");
  const [actor, setActor] = useState(isPersonDecider(appOwner) ? appOwner : DECIDERS[0]!);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = reason.trim().length < 5;
  const showShort = touched && short;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (short) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.decide(appId, { action, reason: reason.trim(), actor });
      onDone({ ...r, action });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "The decision was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="decide-form" onSubmit={submit} noValidate>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${uid}a`}>Action</label>
          <select id={`${uid}a`} value={action} onChange={(e) => setAction(e.target.value as HumanAction)} disabled={busy}>
            {actions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
          <p className="field-hint">Only the routes this state allows.</p>
        </div>
        <div className="field">
          <label htmlFor={`${uid}w`}>Decide as</label>
          <select id={`${uid}w`} value={actor} onChange={(e) => setActor(e.target.value)} disabled={busy}>
            {deciders.map((d) => (
              <option key={d} value={d}>
                {owner(d)}
              </option>
            ))}
          </select>
          <p className="field-hint">Signed on the audit log.</p>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${uid}r`}>Reason</label>
        <textarea
          id={`${uid}r`}
          value={reason}
          required
          minLength={5}
          rows={3}
          disabled={busy}
          aria-invalid={showShort ? true : undefined}
          aria-describedby={`${uid}h`}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        <p className="field-hint" id={`${uid}h`} data-tone={showShort ? "danger" : undefined}>
          {showShort ? "Write at least 5 characters so the next reader knows why." : "Required. At least 5 characters."}
        </p>
      </div>
      {error ? (
        <Notice tone="danger" title="Decision not recorded">
          {error}
        </Notice>
      ) : null}
      <div className="form-actions">
        {onCancel ? (
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn-primary" aria-busy={busy ? true : undefined}>
          Record decision
        </button>
      </div>
    </form>
  );
}
