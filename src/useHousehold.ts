import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSession, supabase } from './lib/supabase';
import { fetchData, fetchHousehold } from './lib/api';
import { errorMessage } from './lib/storage';
import type { Chore, Completion, Household, Member, Recipe, Room, ShoppingItem, TurnAdjustment } from './lib/types';

export type Phase = 'loading' | 'error' | 'no-household' | 'ready';

/** Signs this phone in, finds its apartment, and keeps the data live across phones. */
export function useHousehold() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [adjustments, setAdjustments] = useState<TurnAdjustment[]>([]);
  const [shopping, setShopping] = useState<ShoppingItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const householdId = household?.id;
  const loadSeq = useRef(0);

  const loadData = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    const data = await fetchData(id);
    if (seq !== loadSeq.current) return; // a newer load already started
    setMembers(data.members);
    setChores(data.chores);
    setCompletions(data.completions);
    setRooms(data.rooms);
    setAdjustments(data.adjustments);
    setShopping(data.shopping);
    setRecipes(data.recipes);
  }, []);

  /** Re-checks which apartment this phone is in, then loads everything. */
  const refreshHousehold = useCallback(async () => {
    try {
      const h = await fetchHousehold();
      if (!h) {
        setHousehold(null);
        setPhase('no-household');
        return;
      }
      await loadData(h.id);
      setHousehold(h);
      setPhase('ready');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  }, [loadData]);

  const reload = useCallback(async () => {
    try {
      const h = await fetchHousehold();
      if (!h) {
        setHousehold(null);
        setPhase('no-household');
        return;
      }
      setHousehold(h);
      await loadData(h.id);
    } catch {
      // Offline or a blip: keep showing what we have; the next refresh catches up.
    }
  }, [loadData]);

  // Sign in (anonymously) on first launch, then load.
  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
      } catch (e) {
        setError(errorMessage(e));
        setPhase('error');
        return;
      }
      await refreshHousehold();
    })();
  }, [refreshHousehold]);

  // Live updates: any change on another phone triggers a quick reload here.
  useEffect(() => {
    if (!householdId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    };
    const filter = `household_id=eq.${householdId}`;
    const channel = supabase
      .channel(`household-${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chores', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completions', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turn_adjustments', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter }, schedule)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'shopping_items' }, schedule)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'recipes' }, schedule)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, schedule)
      // Deletes can't be filtered by apartment, so listen to all of them.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'completions' }, schedule)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, schedule)
      .subscribe();

    const onWake = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    // Safety net in case a live update is missed.
    const poll = setInterval(onWake, 60_000);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      supabase.removeChannel(channel);
    };
  }, [householdId, reload]);

  return {
    phase, error, household, members, chores, completions, rooms, adjustments, shopping, recipes,
    setCompletions, setShopping, reload, refreshHousehold,
  };
}

export type HouseholdData = ReturnType<typeof useHousehold>;
