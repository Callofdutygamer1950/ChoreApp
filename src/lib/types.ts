import type { Schedule } from '../../supabase/functions/_shared/schedule';

export interface Household {
  id: string;
  name: string;
  join_code: string;
}

export interface Member {
  id: string;
  household_id: string;
  name: string;
  /** Picked color like "#2f80ed", or null to use the default. */
  color: string | null;
  archived: boolean;
  created_at: string;
}

export interface Chore {
  id: string;
  household_id: string;
  name: string;
  interval_days: number;
  /** Repeat rule; null on chores saved before schedules existed (see scheduleOf). */
  schedule: Schedule | null;
  archived: boolean;
  created_at: string;
}

export interface Completion {
  id: string;
  household_id: string;
  chore_id: string;
  member_id: string | null;
  /** Local calendar day, YYYY-MM-DD */
  done_on: string;
  note: string | null;
  created_at: string;
}
