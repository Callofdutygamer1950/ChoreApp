// The schedule logic lives with the Supabase functions so the reminder job uses the exact same rules.
export * from '../../supabase/functions/_shared/schedule';

import type { Schedule } from '../../supabase/functions/_shared/schedule';
import type { Chore } from './types';

/** A chore's schedule; chores saved before schedules existed repeat N days after last done. */
export function scheduleOf(chore: Chore): Schedule {
  return chore.schedule ?? { kind: 'after', days: chore.interval_days };
}
