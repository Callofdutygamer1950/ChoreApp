import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHousehold } from './useHousehold';
import * as api from './lib/api';
import { shareInvite } from './lib/invite';
import { todayStr } from './lib/dates';
import { choreStates, finishedChoreIds, type ChoreState } from './lib/status';
import { errorMessage, getItem, removeItem, setItem, uuid } from './lib/storage';
import type { Chore, Completion, Member } from './lib/types';
import { Icon, memberColors, nextDefaultColor, Toast, type ToastData } from './components/ui';
import { EntrySheet, MemberSheet } from './components/sheets';
import { ChoreSheet } from './components/ChoreSheet';
import { ChoreDetailSheet } from './components/ChoreDetailSheet';
import { HouseTab } from './screens/HouseTab';
import { PickMember, Welcome } from './screens/Onboarding';
import { ChoresTab } from './screens/ChoresTab';
import { CalendarTab } from './screens/CalendarTab';
import { SettingsTab } from './screens/SettingsTab';

type Tab = 'chores' | 'calendar' | 'house' | 'settings';
type Sheet =
  | { kind: 'entry'; entry: Completion | null; date?: string }
  | { kind: 'chore'; chore: Chore | null }
  | { kind: 'detail'; choreId: string }
  | { kind: 'member'; member: Member | null };

/** Which person this phone belongs to, remembered per apartment. */
function useStoredMember(householdId: string | undefined) {
  const key = householdId ? `chores.member.${householdId}` : null;
  const [version, setVersion] = useState(0);
  const value = useMemo(() => (key ? getItem(key) : null), [key, version]);
  const set = useCallback((id: string | null) => {
    if (!key) return;
    if (id) setItem(key, id);
    else removeItem(key);
    setVersion((v) => v + 1);
  }, [key]);
  return [value, set] as const;
}

/** Re-renders at midnight so "due today" stays correct if the app is left open. */
function useToday() {
  const [today, setToday] = useState(todayStr);
  useEffect(() => {
    const t = setInterval(() => setToday((prev) => (prev === todayStr() ? prev : todayStr())), 30_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

const COOLDOWN_MS = 2 * 60_000;

const TAB_TITLES: Record<Tab, string> = { chores: 'Chores', calendar: 'Calendar', house: 'House', settings: 'Settings' };
const TAB_ICONS: Record<Tab, string> = { chores: 'list', calendar: 'calendar', house: 'home', settings: 'settings' };

export default function App() {
  const hh = useHousehold();
  const { household, members, chores, completions, rooms, adjustments } = hh;
  const [memberId, setMemberId] = useStoredMember(household?.id);
  const [tab, setTab] = useState<Tab>('chores');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const today = useToday();

  const ctx = useMemo(() => ({ completions, adjustments, members, today }), [completions, adjustments, members, today]);
  const states = useMemo(() => choreStates(chores, ctx), [chores, ctx]);
  const finishedIds = useMemo(() => finishedChoreIds(chores, ctx), [chores, ctx]);
  const colors = useMemo(() => memberColors(members), [members]);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const me = members.find((m) => m.id === memberId && !m.archived);

  // A chore marked done today is locked for 2 minutes (deleting/undoing the entry unlocks it).
  const [now, setNow] = useState(() => Date.now());
  const locks = useMemo(() => {
    const t = Math.max(now, Date.now());
    const map = new Map<string, number>();
    for (const c of completions) {
      if (c.done_on !== today) continue;
      const until = Date.parse(c.created_at) + COOLDOWN_MS;
      if (until > t) map.set(c.chore_id, Math.max(map.get(c.chore_id) ?? 0, until));
    }
    return map;
  }, [completions, today, now]);
  useEffect(() => {
    if (locks.size === 0) return;
    const next = Math.min(...locks.values());
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()) + 100);
    return () => clearTimeout(timer);
  }, [locks]);

  if (hh.phase === 'loading') {
    return <div className="splash"><img src="icons/icon-192.png" alt="" width={64} height={64} /></div>;
  }

  if (hh.phase === 'error') {
    const anonOff = /anonymous/i.test(hh.error ?? '');
    return (
      <div className="onboard">
        <h1>Can't connect</h1>
        <p className="error-text">{hh.error}</p>
        {anonOff && (
          <p className="muted">
            In the Supabase dashboard, go to Authentication → Sign In / Providers and turn on
            "Allow anonymous sign-ins".
          </p>
        )}
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }

  if (hh.phase === 'no-household' || !household) {
    return <Welcome onJoined={hh.refreshHousehold} />;
  }

  if (!me) {
    return <PickMember household={household} members={members} onPick={setMemberId} onAdded={hh.reload} />;
  }

  function undoEntry(entry: Completion, saving: Promise<boolean> = Promise.resolve(true)) {
    hh.setCompletions((prev) => prev.filter((c) => c.id !== entry.id));
    (async () => {
      try {
        if (!(await saving)) return; // never saved, nothing to delete
        await api.deleteCompletion(entry.id);
      } catch (e) {
        notify(`Couldn't undo: ${errorMessage(e)}`, true);
        hh.reload();
      }
    })();
  }

  async function invite() {
    const result = await shareInvite(household!);
    if (result === 'copied') notify('Invite link copied. Paste it in a message.');
    if (result === 'failed') notify(`Couldn't share. The code is ${household!.join_code}`, true);
  }

  function markDone(s: ChoreState) {
    const lockedUntil = locks.get(s.chore.id);
    if (lockedUntil) {
      const secs = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
      const wait = secs > 60 ? `${Math.ceil(secs / 60)} min` : `${secs} sec`;
      const recent = completions
        .filter((c) => c.chore_id === s.chore.id && c.done_on === today)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      setToast({
        text: `Just marked done. Try again in ${wait}.`,
        actions: recent ? [{ label: 'Undo', run: () => undoEntry(recent) }] : [],
      });
      return;
    }
    setNow(Date.now());
    const entry: Completion = {
      id: uuid(),
      household_id: household!.id,
      chore_id: s.chore.id,
      member_id: me!.id,
      done_on: today,
      note: null,
      created_at: new Date().toISOString(),
    };
    hh.setCompletions((prev) => [entry, ...prev]);
    const { created_at: _, ...row } = entry;
    const saving = api.addCompletion(row).then(
      () => true,
      (e) => {
        hh.setCompletions((prev) => prev.filter((c) => c.id !== entry.id));
        notify(`Couldn't save: ${errorMessage(e)}`, true);
        return false;
      },
    );
    setToast({
      text: `${s.chore.name} done`,
      actions: [
        { label: 'Add note', run: () => setSheet({ kind: 'entry', entry }) },
        { label: 'Undo', run: () => undoEntry(entry, saving) },
      ],
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{TAB_TITLES[tab]}</h1>
          <div className="subtitle">{household.name}</div>
        </div>
        <div className="topbar-actions">
          <button className="invite-btn" onClick={invite} aria-label="Invite roommates">
            <Icon name="invite" size={18} /> <span>Invite</span>
          </button>
          <button className="me-chip" onClick={() => setTab('settings')}>{me.name}</button>
        </div>
      </header>

      <main className="content">
        {tab === 'chores' && (
          <ChoresTab states={states} members={members} rooms={rooms} meId={me.id} today={today} onDone={markDone} locked={locks}
            onOpen={(st) => setSheet({ kind: 'detail', choreId: st.chore.id })}
            onAddChore={() => setSheet({ kind: 'chore', chore: null })} />
        )}
        {tab === 'calendar' && (
          <CalendarTab completions={completions} chores={chores} states={states} members={members} rooms={rooms}
            meId={me.id} today={today} onOpenChore={(choreId) => setSheet({ kind: 'detail', choreId })}
            onEdit={(entry) => setSheet({ kind: 'entry', entry })}
            onLog={(date) => setSheet({ kind: 'entry', entry: null, date })} />
        )}
        {tab === 'house' && (
          <HouseTab householdId={household.id} shopping={hh.shopping} setShopping={hh.setShopping}
            recipes={hh.recipes} info={hh.info} members={members} chores={chores} completions={completions}
            colors={colors} today={today} meId={me.id} reload={hh.reload} notify={notify} />
        )}
        {tab === 'settings' && (
          <SettingsTab household={household} members={members} chores={chores} me={me} finishedIds={finishedIds}
            rooms={rooms} completions={completions} adjustments={adjustments}
            onSwitchPerson={() => setMemberId(null)}
            onEditChore={(chore) => setSheet({ kind: 'chore', chore })}
            onEditMember={(member) => setSheet({ kind: 'member', member })}
            onLeft={hh.refreshHousehold} reload={hh.reload} notify={notify} />
        )}
      </main>

      <nav className="tabbar">
        {(['chores', 'calendar', 'house', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}>
            <Icon name={TAB_ICONS[t]} />
            <span>{TAB_TITLES[t]}</span>
          </button>
        ))}
      </nav>

      {sheet?.kind === 'entry' && (
        <EntrySheet key={sheet.entry?.id ?? 'new'} entry={sheet.entry} defaultDate={sheet.date}
          householdId={household.id} chores={chores} members={members} meId={me.id}
          onClose={closeSheet} onSaved={hh.reload} notify={notify} />
      )}
      {sheet?.kind === 'chore' && (
        <ChoreSheet chore={sheet.chore} householdId={household.id} rooms={rooms} members={members} colors={colors}
          onClose={closeSheet} onSaved={hh.reload} notify={notify} />
      )}
      {sheet?.kind === 'detail' && (() => {
        const st = states.find((x) => x.chore.id === sheet.choreId);
        if (!st) return null; // finished or deleted while open
        return (
          <ChoreDetailSheet state={st} completions={completions} adjustments={adjustments} members={members}
            rooms={rooms} colors={colors} meId={me.id} today={today} locked={locks.has(st.chore.id)}
            onDone={() => markDone(st)} onEdit={() => setSheet({ kind: 'chore', chore: st.chore })}
            onEditEntry={(entry) => setSheet({ kind: 'entry', entry })}
            onClose={closeSheet} onSaved={hh.reload} notify={notify} />
        );
      })()}
      {sheet?.kind === 'member' && (
        <MemberSheet member={sheet.member} householdId={household.id}
          currentColor={sheet.member ? memberColors(members).get(sheet.member.id)! : nextDefaultColor(members)}
          onClose={closeSheet} onSaved={hh.reload} notify={notify} />
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
