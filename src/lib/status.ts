import type { Chore, Completion, Member, TurnAdjustment } from './types';
import { diffDays, plural } from './dates';
import { applySnooze, dueInfo, scheduleOf } from './schedule';

export interface ChoreState {
  chore: Chore;
  last: Completion | null;
  /** Days until due (negative = overdue). null = never done (for "after last done" chores). */
  dueIn: number | null;
  /** Day it's next due, if known. */
  due: string | null;
  /** Pushed out by a snooze or skip. */
  snoozed: boolean;
  /** Member whose turn it is, if the chore has a rotation. */
  turn: string | null;
}

export type Tone = 'overdue' | 'today' | 'soon' | 'ok';

/** Most recent completion for each chore. */
export function latestByChore(completions: Completion[]): Map<string, Completion> {
  const map = new Map<string, Completion>();
  for (const c of completions) {
    const prev = map.get(c.chore_id);
    if (!prev || c.done_on > prev.done_on || (c.done_on === prev.done_on && c.created_at > prev.created_at)) {
      map.set(c.chore_id, c);
    }
  }
  return map;
}

/** Latest time any entry for each chore was recorded (for telling whether a snooze still applies). */
function lastRecordedByChore(completions: Completion[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of completions) {
    const prev = map.get(c.chore_id);
    if (!prev || Date.parse(c.created_at) > Date.parse(prev)) map.set(c.chore_id, c.created_at);
  }
  return map;
}

function countByChore(completions: Completion[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of completions) map.set(c.chore_id, (map.get(c.chore_id) ?? 0) + 1);
  return map;
}

/** Turn counts for one chore: completions by each person, plus any admin adjustment. */
export function turnCounts(chore: Chore, completions: Completion[], adjustments: TurnAdjustment[]) {
  const counts = new Map<string, { done: number; extra: number }>();
  const get = (id: string) => {
    let v = counts.get(id);
    if (!v) counts.set(id, (v = { done: 0, extra: 0 }));
    return v;
  };
  for (const c of completions) if (c.chore_id === chore.id && c.member_id) get(c.member_id).done++;
  for (const a of adjustments) if (a.chore_id === chore.id) get(a.member_id).extra = a.extra;
  return counts;
}

/**
 * Whose turn it is: the person in the rotation with the lowest count (completions + admin
 * adjustment), never the person who did it last. Ties go in rotation order, starting after
 * the last person who did it.
 */
export function whoseTurn(
  chore: Chore, completions: Completion[], adjustments: TurnAdjustment[], activeIds: Set<string>,
  last: Completion | null,
): string | null {
  const rotation = (chore.rotation ?? []).filter((id) => activeIds.has(id));
  if (rotation.length === 0) return null;
  if (rotation.length === 1) return rotation[0];

  const counts = turnCounts(chore, completions, adjustments);
  const lastIdx = last?.member_id ? rotation.indexOf(last.member_id) : -1;
  // Rotation order starting just after whoever did it last.
  const ordered = rotation.map((_, i) => rotation[(lastIdx + 1 + i) % rotation.length]);
  const candidates = ordered.filter((id) => id !== last?.member_id);
  const total = (id: string) => {
    const c = counts.get(id);
    return c ? c.done + c.extra : 0;
  };
  return candidates.reduce((best, id) => (total(id) < total(best) ? id : best), candidates[0]);
}

export interface Context {
  completions: Completion[];
  adjustments: TurnAdjustment[];
  members: Member[];
  today: string;
}

function stateFor(chore: Chore, ctx: Context, maps: ReturnType<typeof buildMaps>) {
  const last = maps.latest.get(chore.id) ?? null;
  const base = dueInfo(scheduleOf(chore), last?.done_on ?? null, maps.counts.get(chore.id) ?? 0, ctx.today);
  const info = applySnooze(base, { until: chore.snoozed_until, at: chore.snoozed_at }, maps.recorded.get(chore.id) ?? null);
  return { last, info };
}

function buildMaps(ctx: Context) {
  return {
    latest: latestByChore(ctx.completions),
    recorded: lastRecordedByChore(ctx.completions),
    counts: countByChore(ctx.completions),
    active: new Set(ctx.members.filter((m) => !m.archived).map((m) => m.id)),
  };
}

/**
 * Active chores with their due status, most urgent first.
 * Chores whose schedule is finished (one-time and done, or ended) are left out.
 */
export function choreStates(chores: Chore[], ctx: Context): ChoreState[] {
  const maps = buildMaps(ctx);
  const out: ChoreState[] = [];
  for (const chore of chores) {
    if (chore.archived) continue;
    const { last, info } = stateFor(chore, ctx, maps);
    if (info.finished) continue;
    out.push({
      chore, last, due: info.due, snoozed: info.snoozed,
      dueIn: info.due ? diffDays(info.due, ctx.today) : null,
      turn: whoseTurn(chore, ctx.completions, ctx.adjustments, maps.active, last),
    });
  }
  return out.sort((a, b) => {
    const av = a.dueIn ?? -Infinity;
    const bv = b.dueIn ?? -Infinity;
    return av - bv || a.chore.name.localeCompare(b.chore.name);
  });
}

/** IDs of chores that are finished (shown separately in Settings). */
export function finishedChoreIds(chores: Chore[], ctx: Context): Set<string> {
  const maps = buildMaps(ctx);
  return new Set(chores.filter((c) => !c.archived && stateFor(c, ctx, maps).info.finished).map((c) => c.id));
}

export const needsDoing = (s: ChoreState) => s.dueIn === null || s.dueIn <= 0;

export function statusText(s: ChoreState): { text: string; tone: Tone } {
  if (s.dueIn === null) return { text: 'Never done', tone: 'today' };
  if (s.dueIn < 0) return { text: `Overdue by ${plural(-s.dueIn, 'day')}`, tone: 'overdue' };
  if (s.dueIn === 0) return { text: s.snoozed ? 'Snoozed until today' : 'Due today', tone: 'today' };
  if (s.snoozed) {
    const day = new Date(`${s.due}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return { text: `Snoozed until ${s.dueIn === 1 ? 'tomorrow' : day}`, tone: 'ok' };
  }
  if (s.dueIn === 1) return { text: 'Due tomorrow', tone: 'soon' };
  return { text: `Due in ${s.dueIn} days`, tone: 'ok' };
}
