import { supabase } from './supabase';
import type { Chore, Completion, Household, Member } from './types';

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
  const [members, chores, completions] = await Promise.all([
    supabase.from('members').select('*').eq('household_id', householdId).order('created_at').then(check),
    supabase.from('chores').select('*').eq('household_id', householdId).order('created_at').then(check),
    fetchAllCompletions(householdId),
  ]);
  return { members: members as Member[], chores: chores as Chore[], completions };
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

export async function addMember(householdId: string, name: string): Promise<Member> {
  return check(await supabase.from('members').insert({ household_id: householdId, name }).select().single()) as Member;
}
export async function updateMember(id: string, patch: Partial<Pick<Member, 'name' | 'archived'>>) {
  check(await supabase.from('members').update(patch).eq('id', id));
}

export async function addChore(householdId: string, name: string, intervalDays: number) {
  check(await supabase.from('chores').insert({ household_id: householdId, name, interval_days: intervalDays }));
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
