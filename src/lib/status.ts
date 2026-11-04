import type { Chore, Completion } from './types';
import { addDays, diffDays, plural } from './dates';

export interface ChoreState {
  chore: Chore;
  last: Completion | null;
  /** Days until due (negative = overdue). null = never done. */
  dueIn: number | null;
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

export function choreStates(chores: Chore[], completions: Completion[], today: string): ChoreState[] {
  const latest = latestByChore(completions);
  return chores
    .filter((c) => !c.archived)
    .map((chore) => {
      const last = latest.get(chore.id) ?? null;
      const dueIn = last ? diffDays(addDays(last.done_on, chore.interval_days), today) : null;
      return { chore, last, dueIn };
    })
    .sort((a, b) => {
      const av = a.dueIn ?? -Infinity;
      const bv = b.dueIn ?? -Infinity;
      return av - bv || a.chore.name.localeCompare(b.chore.name);
    });
}

export const needsDoing = (s: ChoreState) => s.dueIn === null || s.dueIn <= 0;

export function statusText(s: ChoreState): { text: string; tone: Tone } {
  if (s.dueIn === null) return { text: 'Never done', tone: 'today' };
  if (s.dueIn < 0) return { text: `Overdue by ${plural(-s.dueIn, 'day')}`, tone: 'overdue' };
  if (s.dueIn === 0) return { text: 'Due today', tone: 'today' };
  if (s.dueIn === 1) return { text: 'Due tomorrow', tone: 'soon' };
  return { text: `Due in ${s.dueIn} days`, tone: 'ok' };
}
