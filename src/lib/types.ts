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
  /** Away until (not including) this day — the day they're back. */
  away_until: string | null;
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
  room_id: string | null;
  /** Ordered member ids who take turns (empty = no rotation). */
  rotation: string[];
  /** Not due before this day, unless it's done after snoozed_at. */
  snoozed_until: string | null;
  snoozed_at: string | null;
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

export interface Room {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
}

/** Admin-set offset added to a person's completion count for whose-turn. */
export interface TurnAdjustment {
  chore_id: string;
  member_id: string;
  household_id: string;
  extra: number;
}

export interface ShoppingItem {
  id: string;
  household_id: string;
  name: string;
  done: boolean;
  added_by: string | null;
  created_at: string;
  done_at: string | null;
}

export interface Recipe {
  id: string;
  household_id: string;
  title: string;
  servings: string | null;
  ingredients: string[];
  steps: string | null;
  notes: string | null;
  source_url: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InfoCard {
  id: string;
  household_id: string;
  title: string;
  body: string;
  sort: number;
  created_at: string;
  updated_at: string;
}
