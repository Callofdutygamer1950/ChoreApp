import { supabase } from './supabase';
import type { Chore, Completion, Household, InfoCard, Member, Recipe, Room, ShoppingItem, TurnAdjustment } from './types';
import { approxIntervalDays, type Schedule } from './schedule';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function fetchHousehold(): Promise<Household | null> {
  // Row-level security only ever returns this phone's apartment.
  return check(await supabase.from('households').select('id,name,join_code').maybeSingle());
}

/** Supabase returns at most 1000 rows per request, so page through completions. */
async function fetchAllCompletions(householdId: string): Promise<Completion[]> {
  const pageSize = 1000;
  const all: Completion[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = check(
      await supabase
        .from('completions')
        .select('*')
        .eq('household_id', householdId)
        .order('done_on', { ascending: false })
        .order('id')
        .range(from, from + pageSize - 1),
    ) as Completion[];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export async function fetchData(householdId: string) {
  const q = (table: string, order = 'created_at') =>
    supabase.from(table).select('*').eq('household_id', householdId).order(order).then(check);
  const [members, chores, completions, rooms, adjustments, shopping, recipes, info] = await Promise.all([
    q('members'), q('chores'), fetchAllCompletions(householdId), q('rooms', 'name'),
    supabase.from('turn_adjustments').select('*').eq('household_id', householdId).then(check),
    q('shopping_items'), q('recipes', 'title'), q('house_info', 'sort'),
  ]);
  return {
    members: members as Member[], chores: chores as Chore[], completions,
    rooms: rooms as Room[], adjustments: adjustments as TurnAdjustment[],
    shopping: shopping as ShoppingItem[], recipes: recipes as Recipe[], info: info as InfoCard[],
  };
}

export async function createHousehold(name: string): Promise<Household> {
  return check(await supabase.rpc('create_household', { p_name: name }));
}
export async function joinHousehold(code: string): Promise<Household> {
  return check(await supabase.rpc('join_household', { p_code: code }));
}
export async function leaveHousehold() {
  check(await supabase.rpc('leave_household'));
}
export async function renameHousehold(id: string, name: string) {
  check(await supabase.from('households').update({ name }).eq('id', id));
}

export async function addMember(householdId: string, name: string, color: string | null = null): Promise<Member> {
  const row: { household_id: string; name: string; color?: string } = { household_id: householdId, name };
  if (color) row.color = color;
  return check(await supabase.from('members').insert(row).select().single()) as Member;
}
export async function updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'archived' | 'color' | 'away_until'>>) {
  check(await supabase.from('members').update(patch).eq('id', id));
}

export interface ChoreFields {
  name: string;
  schedule: Schedule;
  room_id: string | null;
  rotation: string[];
}
const choreRow = (f: ChoreFields) => ({ ...f, interval_days: approxIntervalDays(f.schedule) });

export async function addChore(householdId: string, fields: ChoreFields) {
  check(await supabase.from('chores').insert({ household_id: householdId, ...choreRow(fields) }));
}
export async function saveChore(id: string, fields: ChoreFields) {
  check(await supabase.from('chores').update(choreRow(fields)).eq('id', id));
}
/** Push the chore's due date out to `until` (null clears the snooze). */
export async function snoozeChore(id: string, until: string | null) {
  check(await supabase.from('chores')
    .update({ snoozed_until: until, snoozed_at: until ? new Date().toISOString() : null })
    .eq('id', id));
}
export async function updateChore(id: string, patch: Partial<Pick<Chore, 'name' | 'interval_days' | 'archived'>>) {
  check(await supabase.from('chores').update(patch).eq('id', id));
}

export async function addCompletion(c: Omit<Completion, 'created_at'>) {
  check(await supabase.from('completions').insert(c));
}
export async function updateCompletion(
  id: string,
  patch: Partial<Pick<Completion, 'chore_id' | 'member_id' | 'done_on' | 'note'>>,
) {
  check(await supabase.from('completions').update(patch).eq('id', id));
}
export async function deleteCompletion(id: string) {
  check(await supabase.from('completions').delete().eq('id', id));
}

// ---------- Rooms ----------
export async function addRoom(householdId: string, name: string): Promise<Room> {
  return check(await supabase.from('rooms').insert({ household_id: householdId, name }).select().single()) as Room;
}
export async function renameRoom(id: string, name: string) {
  check(await supabase.from('rooms').update({ name }).eq('id', id));
}
export async function deleteRoom(id: string) {
  check(await supabase.from('rooms').delete().eq('id', id));
}

// ---------- Admin (PIN-protected; these functions return an error message or null) ----------
async function rpcMessage(fn: string, args: Record<string, unknown>) {
  const message = check(await supabase.rpc(fn, args)) as string | null;
  if (message) throw new Error(message);
}
export async function hasAdminPin(): Promise<boolean> {
  return Boolean(check(await supabase.rpc('has_admin_pin')));
}
export const checkAdminPin = (pin: string) => rpcMessage('check_admin_pin', { p_pin: pin });
export const setAdminPin = (current: string, next: string) =>
  rpcMessage('set_admin_pin', { p_current: current, p_new: next });
export const setTurnCount = (pin: string, choreId: string, memberId: string, count: number) =>
  rpcMessage('set_turn_count', { p_pin: pin, p_chore: choreId, p_member: memberId, p_count: count });

// ---------- Shopping list ----------
export async function addShoppingItems(householdId: string, names: string[], addedBy: string) {
  const rows = names.map((name) => ({ household_id: householdId, name, added_by: addedBy }));
  if (rows.length) check(await supabase.from('shopping_items').insert(rows));
}
export async function setShoppingDone(id: string, done: boolean) {
  check(await supabase.from('shopping_items')
    .update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id));
}
export async function deleteShoppingItem(id: string) {
  check(await supabase.from('shopping_items').delete().eq('id', id));
}
export async function clearBought(householdId: string) {
  check(await supabase.from('shopping_items').delete().eq('household_id', householdId).eq('done', true));
}

// ---------- Recipes ----------
export type RecipeFields = Pick<Recipe, 'title' | 'servings' | 'ingredients' | 'steps' | 'notes' | 'source_url'>;
export async function addRecipe(householdId: string, fields: RecipeFields, addedBy: string): Promise<Recipe> {
  return check(await supabase.from('recipes')
    .insert({ household_id: householdId, added_by: addedBy, ...fields }).select().single()) as Recipe;
}
export async function saveRecipe(id: string, fields: RecipeFields) {
  check(await supabase.from('recipes').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id));
}
export async function deleteRecipe(id: string) {
  check(await supabase.from('recipes').delete().eq('id', id));
}
/** Reads a recipe from a web page (via the import-recipe server function). */
export async function importRecipe(url: string): Promise<RecipeFields> {
  const { data, error } = await supabase.functions.invoke('import-recipe', { body: { url } });
  if (error) {
    // The function sends a readable message in its JSON body.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? "Couldn't reach the recipe importer. Is the import-recipe function deployed?");
  }
  return data as RecipeFields;
}
/** Adds one item with a client-made id, so it can be checked off before the server replies. */
export async function addShoppingItem(item: Pick<ShoppingItem, 'id' | 'household_id' | 'name' | 'added_by'>) {
  check(await supabase.from('shopping_items').insert(item));
}

// ---------- House info board ----------
export async function addInfoCard(householdId: string, title: string, body: string, sort: number) {
  check(await supabase.from('house_info').insert({ household_id: householdId, title, body, sort }));
}
export async function saveInfoCard(id: string, patch: Partial<Pick<InfoCard, 'title' | 'body' | 'sort'>>) {
  check(await supabase.from('house_info').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
}
export async function deleteInfoCard(id: string) {
  check(await supabase.from('house_info').delete().eq('id', id));
}
