// Chore repeat schedules: shared by the app (src/lib/schedule.ts re-exports this)
// and by the reminder Edge Function, so both agree on when a chore is due.
// No imports on purpose: it must run unchanged in the browser and in Deno.

export type Ends =
  | { type: 'never' }
  | { type: 'on'; date: string } // last day the chore can be due (YYYY-MM-DD)
  | { type: 'count'; count: number }; // stop after it has been done this many times

export type Freq = 'day' | 'week' | 'month' | 'year';

export type Schedule =
  /** Due N days after it was last done (the original mode). */
  | { kind: 'after'; days: number; ends?: Ends }
  /** One-time chore, due on `date`; finished once done. */
  | { kind: 'once'; date: string }
  /** Fixed calendar schedule, like Google Calendar. */
  | {
      kind: 'repeat';
      freq: Freq;
      every: number;
      start: string;
      /** For weekly: 0 = Sunday ... 6 = Saturday. */
      weekdays?: number[];
      /** For monthly: same day number as start, same nth weekday, or last such weekday. */
      monthly?: 'day' | 'nth' | 'last';
      ends?: Ends;
    };

// ---------- Day math (whole days since 1970-01-01, UTC-based so DST never matters) ----------

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export function toNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
export function toStr(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function parts(n: number) {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), wd: d.getUTCDay() };
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export const weekdayOf = (s: string) => parts(toNum(s)).wd;
/** 1-5: which occurrence of its weekday this date is within its month. */
export const nthOf = (s: string) => Math.ceil(parts(toNum(s)).day / 7);
export const isLastWeekdayOfMonth = (s: string) => {
  const p = parts(toNum(s));
  return p.day > daysInMonth(p.y, p.m) - 7;
};

// ---------- Occurrences of a 'repeat' schedule ----------

type Repeat = Extract<Schedule, { kind: 'repeat' }>;

function isOccurrence(s: Repeat, n: number): boolean {
  const start = toNum(s.start);
  if (n < start) return false;
  if (s.ends?.type === 'on' && n > toNum(s.ends.date)) return false;
  const every = Math.max(1, s.every);
  const p = parts(n);
  const p0 = parts(start);

  switch (s.freq) {
    case 'day':
      return (n - start) % every === 0;
    case 'week': {
      const days = s.weekdays?.length ? s.weekdays : [p0.wd];
      if (!days.includes(p.wd)) return false;
      const weeks = Math.floor((n - p.wd - (start - p0.wd)) / 7); // Sunday-based weeks since start's week
      return weeks % every === 0;
    }
    case 'month': {
      const months = (p.y - p0.y) * 12 + (p.m - p0.m);
      if (months % every !== 0) return false;
      const dim = daysInMonth(p.y, p.m);
      const by = s.monthly ?? 'day';
      if (by === 'day') return p.day === Math.min(p0.day, dim); // 31st becomes the last day in short months
      if (p.wd !== p0.wd) return false;
      if (by === 'last') return p.day > dim - 7;
      return Math.ceil(p.day / 7) === Math.min(4, Math.ceil(p0.day / 7));
    }
    case 'year': {
      if ((p.y - p0.y) % every !== 0 || p.m !== p0.m) return false;
      return p.day === Math.min(p0.day, daysInMonth(p.y, p.m)); // Feb 29 becomes Feb 28
    }
  }
}

/** Longest possible gap between two occurrences, used to bound searches. */
function span(s: Repeat): number {
  const every = Math.max(1, s.every);
  switch (s.freq) {
    case 'day': return every;
    case 'week': return 7 * every;
    case 'month': return 31 * every + 7;
    case 'year': return 366 * every + 1;
  }
}

/** First occurrence on or after day n, or null if the schedule has ended. */
function nextOccurrence(s: Repeat, n: number): number | null {
  const from = Math.max(n, toNum(s.start));
  const limit = from + span(s) + 7;
  for (let d = from; d <= limit; d++) {
    if (s.ends?.type === 'on' && d > toNum(s.ends.date)) return null;
    if (isOccurrence(s, d)) return d;
  }
  return null;
}

/** Last occurrence on or before day n, or null if there is none. */
function prevOccurrence(s: Repeat, n: number): number | null {
  const start = toNum(s.start);
  const limit = Math.max(start, n - span(s) - 7);
  for (let d = n; d >= limit; d--) if (isOccurrence(s, d)) return d;
  return null;
}

// ---------- Due date ----------

export interface Due {
  /** Day the chore is next due (YYYY-MM-DD), or null for an "after last done" chore that was never done. */
  due: string | null;
  /** No more occurrences: a one-time chore that's done, or a repeat that has ended. */
  finished: boolean;
}

/**
 * When is this chore next due?
 * For calendar schedules, each completion counts toward the nearest scheduled day:
 * done Thursday covers Friday; done Saturday covers the Friday just missed.
 */
export function dueInfo(s: Schedule, lastDone: string | null, timesDone: number, today: string): Due {
  if (s.kind === 'once') return { due: s.date, finished: timesDone > 0 };

  if (s.ends?.type === 'count' && timesDone >= s.ends.count) return { due: null, finished: true };

  if (s.kind === 'after') {
    const due = lastDone ? toStr(toNum(lastDone) + Math.max(1, s.days)) : null;
    const end = s.ends?.type === 'on' ? s.ends.date : null;
    const finished = end !== null && (due ? due > end : today > end);
    return { due: finished ? null : due, finished };
  }

  let next: number | null;
  if (!lastDone || lastDone < s.start) {
    next = nextOccurrence(s, toNum(s.start));
  } else {
    const l = toNum(lastDone);
    const before = prevOccurrence(s, l);
    const after = nextOccurrence(s, l);
    let covered: number | null;
    if (before === null) covered = after;
    else if (after === null) covered = before;
    else covered = l - before < after - l ? before : after; // a tie counts as done early
    next = covered === null ? null : nextOccurrence(s, covered + 1);
  }
  return next === null ? { due: null, finished: true } : { due: toStr(next), finished: false };
}

/** Rough days between repeats; stored in the old interval_days column for older app versions. */
export function approxIntervalDays(s: Schedule): number {
  if (s.kind === 'after') return s.days;
  if (s.kind === 'once') return 1;
  const per = { day: 1, week: s.weekdays && s.weekdays.length > 1 ? 7 / s.weekdays.length : 7, month: 30, year: 365 }[s.freq];
  return Math.min(365, Math.max(1, Math.round(per * Math.max(1, s.every))));
}

// ---------- Plain-English summary ----------

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

export const weekdayName = (wd: number) => WEEKDAY_NAMES[wd];
export const ordinal = (n: number) => ORDINALS[n - 1];
export function shortDate(s: string, withYear = false): string {
  const p = parts(toNum(s));
  return `${MONTHS[p.m].slice(0, 3)} ${p.day}${withYear ? `, ${p.y}` : ''}`;
}
export function monthDay(s: string): string {
  const p = parts(toNum(s));
  return `${MONTHS[p.m]} ${p.day}`;
}

export function monthlyLabel(by: 'day' | 'nth' | 'last', start: string): string {
  if (by === 'day') return `on day ${parts(toNum(start)).day}`;
  const wd = WEEKDAY_NAMES[weekdayOf(start)];
  return by === 'last' ? `on the last ${wd}` : `on the ${ORDINALS[Math.min(4, nthOf(start)) - 1]} ${wd}`;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function scheduleSummary(s: Schedule): string {
  if (s.kind === 'once') return `One time, ${shortDate(s.date)}`;
  let text: string;
  if (s.kind === 'after') {
    text = `${s.days % 7 === 0 ? count(s.days / 7, 'week') : count(s.days, 'day')} after last done`;
  } else {
    const every = Math.max(1, s.every);
    switch (s.freq) {
      case 'day':
        text = every === 1 ? 'Daily' : `Every ${every} days`;
        break;
      case 'week': {
        const days = [...(s.weekdays?.length ? s.weekdays : [weekdayOf(s.start)])].sort();
        const isWeekdays = days.join() === '1,2,3,4,5';
        const list = days.length === 1 ? WEEKDAY_NAMES[days[0]] : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
        if (every === 1) text = isWeekdays ? 'Every weekday' : days.length === 7 ? 'Every day of the week' : `Weekly on ${list}`;
        else text = `Every ${every} weeks on ${isWeekdays ? 'weekdays' : list}`;
        break;
      }
      case 'month':
        text = `${every === 1 ? 'Monthly' : `Every ${every} months`} ${monthlyLabel(s.monthly ?? 'day', s.start)}`;
        break;
      case 'year':
        text = `${every === 1 ? 'Annually' : `Every ${every} years`} on ${monthDay(s.start)}`;
        break;
    }
  }
  if (s.ends?.type === 'on') text += `, until ${shortDate(s.ends.date)}`;
  if (s.ends?.type === 'count') text += `, ${s.ends.count} ${s.ends.count === 1 ? 'time' : 'times'}`;
  return text;
}

// ---------- Snooze / skip ----------

export interface Snooze {
  until: string | null; // not due before this day
  at: string | null; // when the snooze was set (ISO timestamp)
}

/**
 * A snooze pushes the due date out, until someone marks the chore done after the snooze
 * was set. A snooze to a day before the normal due date has no effect.
 */
export function applySnooze(due: Due, snooze: Snooze, lastCreatedAt: string | null): Due & { snoozed: boolean } {
  const inactive = { ...due, snoozed: false };
  if (due.finished || !snooze.until || !snooze.at) return inactive;
  if (lastCreatedAt && Date.parse(lastCreatedAt) > Date.parse(snooze.at)) return inactive;
  if (due.due && snooze.until <= due.due) return inactive;
  return { due: snooze.until, finished: false, snoozed: true };
}

/** The next time it would be due after skipping the current one (null for one-time chores). */
export function nextDueAfterSkip(s: Schedule, currentDue: string | null, today: string): string | null {
  const base = Math.max(currentDue ? toNum(currentDue) : toNum(today), toNum(today));
  if (s.kind === 'once') return null;
  if (s.kind === 'after') return toStr(base + Math.max(1, s.days));
  const next = nextOccurrence(s, base + 1);
  return next === null ? null : toStr(next);
}

// ---------- Calendar helpers ----------

/** Scheduled days of a calendar schedule between from and to (inclusive). Empty for other kinds. */
export function occurrencesBetween(s: Schedule, from: string, to: string): string[] {
  if (s.kind !== 'repeat') return [];
  const out: string[] = [];
  const end = toNum(to);
  for (let d = Math.max(toNum(from), toNum(s.start)); d <= end; d++) {
    if (isOccurrence(s, d)) out.push(toStr(d));
  }
  return out;
}

/** The scheduled day a completion on `day` counts toward (nearest one; a tie counts as early). */
export function nearestOccurrence(s: Schedule, day: string): string | null {
  if (s.kind !== 'repeat' || day < s.start) return null;
  const l = toNum(day);
  const before = prevOccurrence(s, l);
  const after = nextOccurrence(s, l);
  const pick = before === null ? after : after === null ? before : l - before < after - l ? before : after;
  return pick === null ? null : toStr(pick);
}

// ---------- Away mode ----------

/** Someone is away until (not including) their back-on day. */
export const isAway = (awayUntil: string | null | undefined, today: string) => !!awayUntil && today < awayUntil;
