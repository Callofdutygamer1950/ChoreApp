import { addDays, toDateStr } from './dates';
import { nearestOccurrence, occurrencesBetween, scheduleOf } from './schedule';
import type { ChoreState } from './status';
import type { Chore, Completion } from './types';

export type PlanKind = 'due' | 'overdue' | 'missed';

export interface PlanItem {
  chore: Chore;
  kind: PlanKind;
}

/**
 * Chores expected on each day from `from` to `to`:
 * - today and later: when each chore is next due (calendar schedules also show every later
 *   scheduled day; "after last done" and one-time chores show only their next due date)
 * - today also lists anything overdue
 * - past days: scheduled days nobody covered ("missed")
 */
export function planDays(
  chores: Chore[], states: ChoreState[], completions: Completion[],
  from: string, to: string, today: string,
): Map<string, PlanItem[]> {
  const plan = new Map<string, PlanItem[]>();
  const add = (day: string, item: PlanItem) => {
    if (day < from || day > to) return;
    const list = plan.get(day);
    if (list) list.push(item);
    else plan.set(day, [item]);
  };
  const stateById = new Map(states.map((s) => [s.chore.id, s]));
  const byChore = new Map<string, Completion[]>();
  for (const c of completions) {
    const list = byChore.get(c.chore_id);
    if (list) list.push(c);
    else byChore.set(c.chore_id, [c]);
  }

  for (const chore of chores) {
    if (chore.archived) continue;
    const s = scheduleOf(chore);
    const state = stateById.get(chore.id); // missing = finished
    const done = byChore.get(chore.id) ?? [];

    // ----- Today and the future -----
    if (state) {
      if (state.due === null || state.due < today) {
        if (today >= from && today <= to) add(today, { chore, kind: state.due === null ? 'due' : 'overdue' });
      } else {
        add(state.due, { chore, kind: 'due' });
      }
      if (s.kind === 'repeat') {
        const after = state.due && state.due >= today ? addDays(state.due, 1) : addDays(today, 1);
        for (const d of occurrencesBetween(s, after > from ? after : from, to)) add(d, { chore, kind: 'due' });
      }
    }

    // ----- Past days: missed -----
    if (from >= today) continue;
    const pastEnd = addDays(today, -1) < to ? addDays(today, -1) : to;
    const createdDay = toDateStr(new Date(chore.created_at));

    if (s.kind === 'repeat') {
      const covered = new Set(done.map((c) => nearestOccurrence(s, c.done_on)).filter(Boolean) as string[]);
      // Days skipped with "Skip to next time" / snooze aren't missed.
      const skipFrom = chore.snoozed_at ? toDateStr(new Date(chore.snoozed_at)) : null;
      const skipTo = chore.snoozed_until;
      const start = createdDay > from ? createdDay : from;
      for (const d of occurrencesBetween(s, start, pastEnd)) {
        if (covered.has(d)) continue;
        if (skipFrom && skipTo && d >= skipFrom && d < skipTo) continue;
        add(d, { chore, kind: 'missed' });
      }
    } else if (state?.due && state.due < today && state.due >= createdDay && !state.snoozed) {
      // One-time and "after last done" chores: their (single) due date passed without it being done.
      add(state.due, { chore, kind: 'missed' });
    }
  }
  return plan;
}
