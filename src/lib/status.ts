import type { Chore, Completion } from './types';
import { diffDays, plural } from './dates';
import { dueInfo, scheduleOf } from './schedule';

export interface ChoreState {
  chore: Chore;
  last: Completion | null;
  /** Days until due (negative = overdue). null = never done (for "after last done" chores). */
  dueIn: number | null;
  /** Day it's next due, if known. */
  due: string | null;
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

function countByChore(completions: Completion[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of completions) map.set(c.chore_id, (map.get(c.chore_id) ?? 0) + 1);
  return map;
}

/**
 * Active chores with their due status, most urgent first.
 * Chores whose schedule is finished (one-time and done, or ended) are left out.
 */
export function choreStates(chores: Chore[], completions: Completion[], today: string): ChoreState[] {
  const latest = latestByChore(completions);
  const counts = countByChore(completions);
  const out: ChoreState[] = [];
  for (const chore of chores) {
    if (chore.archived) continue;
    const last = latest.get(chore.id) ?? null;
    const info = dueInfo(scheduleOf(chore), last?.done_on ?? null, counts.get(chore.id) ?? 0, today);
    if (info.finished) continue;
    out.push({ chore, last, due: info.due, dueIn: info.due ? diffDays(info.due, today) : null });
  }
  return out.sort((a, b) => {
    const av = a.dueIn ?? -Infinity;
    const bv = b.dueIn ?? -Infinity;
    return av - bv || a.chore.name.localeCompare(b.chore.name);
  });
}

/** IDs of chores that are finished (shown separately in Settings). */
export function finishedChoreIds(chores: Chore[], completions: Completion[], today: string): Set<string> {
  const latest = latestByChore(completions);
  const counts = countByChore(completions);
  return new Set(
    chores
      .filter((c) => !c.archived && dueInfo(scheduleOf(c), latest.get(c.id)?.done_on ?? null, counts.get(c.id) ?? 0, today).finished)
      .map((c) => c.id),
  );
}

export const needsDoing = (s: ChoreState) => s.dueIn === null || s.dueIn <= 0;

export function statusText(s: ChoreState): { text: string; tone: Tone } {
  if (s.dueIn === null) return { text: 'Never done', tone: 'today' };
  if (s.dueIn < 0) return { text: `Overdue by ${plural(-s.dueIn, 'day')}`, tone: 'overdue' };
  if (s.dueIn === 0) return { text: 'Due today', tone: 'today' };
  if (s.dueIn === 1) return { text: 'Due tomorrow', tone: 'soon' };
  return { text: `Due in ${s.dueIn} days`, tone: 'ok' };
}
