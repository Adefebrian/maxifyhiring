// Interview slot search. Pure: no database, no clock of its own.
//
// Slots sit on a fixed WIB (UTC+7, no DST) grid, 60 minutes each with at
// least 15 minutes between them, Monday to Friday. Because every interview
// starts on the grid, two interviews overlap exactly when they share an
// interviewer and a start, which a unique index can enforce.

export type Interval = { start: string; end: string };
export type Interviewer = { id: string; name: string; roleCodes: string[] };
export type Busy = Interval & { interviewerId: string };
export type Booking = { interviewerId: string; start: string };
export type SlotPick = { interviewerId: string; start: string; end: string };

const WIB_OFFSET_MIN = 7 * 60;
/** Grid start times in WIB minutes after midnight: 09:00 10:15 11:30 13:30 14:45 16:00. */
export const GRID = [540, 615, 690, 810, 885, 960] as const;
export const SLOT_MIN = 60;
export const LEAD_HOURS = 24;
export const HORIZON_WORKDAYS = 10;

/** All grid slots from `now + lead` across the next N working days (WIB). */
export function gridSlots(now: Date, workdays = HORIZON_WORKDAYS, leadHours = LEAD_HOURS): Interval[] {
  const earliest = now.getTime() + leadHours * 3_600_000;
  const out: Interval[] = [];
  // Midnight WIB of the current WIB day, expressed in UTC ms.
  const wibNow = now.getTime() + WIB_OFFSET_MIN * 60_000;
  let dayStart = Math.floor(wibNow / 86_400_000) * 86_400_000 - WIB_OFFSET_MIN * 60_000;
  let counted = 0;
  while (counted < workdays) {
    const weekday = new Date(dayStart + WIB_OFFSET_MIN * 60_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      for (const m of GRID) {
        const s = dayStart + m * 60_000;
        if (s >= earliest) out.push({ start: new Date(s).toISOString(), end: new Date(s + SLOT_MIN * 60_000).toISOString() });
      }
      counted++;
    }
    dayStart += 86_400_000;
  }
  return out;
}

const overlaps = (a: Interval, b: Interval) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
const within = (slot: Interval, win: Interval) => Date.parse(slot.start) >= Date.parse(win.start) && Date.parse(slot.end) <= Date.parse(win.end);

/**
 * Earliest slot where a qualified interviewer is free and the candidate is
 * available. Ties go to the interviewer with fewer bookings. Returns null when
 * nothing fits inside the horizon.
 */
export function findSlot(input: {
  now: Date;
  roleCode: string;
  availability: Interval[];
  interviewers: Interviewer[];
  busy: Busy[];
  booked: Booking[];
}): SlotPick | null {
  const panel = input.interviewers.filter((i) => i.roleCodes.includes(input.roleCode));
  if (!panel.length) return null;
  const load = new Map<string, number>();
  for (const b of input.booked) load.set(b.interviewerId, (load.get(b.interviewerId) ?? 0) + 1);
  const taken = new Set(input.booked.map((b) => `${b.interviewerId}|${b.start}`));
  const ordered = [...panel].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));

  for (const slot of gridSlots(input.now)) {
    if (input.availability.length && !input.availability.some((w) => within(slot, w))) continue;
    for (const iv of ordered) {
      if (taken.has(`${iv.id}|${slot.start}`)) continue;
      if (input.busy.some((b) => b.interviewerId === iv.id && overlaps(b, slot))) continue;
      return { interviewerId: iv.id, start: slot.start, end: slot.end };
    }
  }
  return null;
}
