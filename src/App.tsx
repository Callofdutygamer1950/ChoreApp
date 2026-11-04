import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHousehold } from './useHousehold';
import * as api from './lib/api';
import { todayStr } from './lib/dates';
import { choreStates, type ChoreState } from './lib/status';
import { errorMessage, getItem, removeItem, setItem, uuid } from './lib/storage';
import type { Chore, Completion, Member } from './lib/types';
import { Icon, Toast, type ToastData } from './components/ui';
import { ChoreSheet, EntrySheet, MemberSheet } from './components/sheets';
import { PickMember, Welcome } from './screens/Onboarding';
import { ChoresTab } from './screens/ChoresTab';
import { CalendarTab } from './screens/CalendarTab';
import { SettingsTab } from './screens/SettingsTab';

type Tab = 'chores' | 'calendar' | 'settings';
type Sheet =
  | { kind: 'entry'; entry: Completion | null; date?: string }
  | { kind: 'chore'; chore: Chore | null }
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

const TAB_TITLES: Record<Tab, string> = { chores: 'Chores', calendar: 'Calendar', settings: 'Settings' };

export default function App() {
  const hh = useHousehold();
  const { household, members, chores, completions } = hh;
  const [memberId, setMemberId] = useStoredMember(household?.id);
  const [tab, setTab] = useState<Tab>('chores');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const today = useToday();

  const states = useMemo(() => choreStates(chores, completions, today), [chores, completions, today]);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const me = members.find((m) => m.id === memberId && !m.archived);

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

  function markDone(s: ChoreState) {
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
    const saving = api.addCompletion(row).catch((e) => {
      hh.setCompletions((prev) => prev.filter((c) => c.id !== entry.id));
      notify(`Couldn't save: ${errorMessage(e)}`, true);
      throw e;
    });
    setToast({
      text: `${s.chore.name} done`,
      actions: [
        { label: 'Add note', run: () => setSheet({ kind: 'entry', entry }) },
        {
          label: 'Undo',
          run: async () => {
            hh.setCompletions((prev) => prev.filter((c) => c.id !== entry.id));
            try {
              await saving;
              await api.deleteCompletion(entry.id);
            } catch (e) {
              notify(`Couldn't undo: ${errorMessage(e)}`, true);
              hh.reload();
            }
          },
        },
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
        <button className="me-chip" onClick={() => setTab('settings')}>{me.name}</button>
      </header>

      <main className="content">
        {tab === 'chores' && (
          <ChoresTab states={states} members={members} today={today} onDone={markDone}
            onAddChore={() => setSheet({ kind: 'chore', chore: null })} />
        )}
        {tab === 'calendar' && (
          <CalendarTab completions={completions} chores={chores} members={members} today={today}
            onEdit={(entry) => setSheet({ kind: 'entry', entry })}
            onLog={(date) => setSheet({ kind: 'entry', entry: null, date })} />
        )}
        {tab === 'settings' && (
          <SettingsTab household={household} members={members} chores={chores} me={me}
            onSwitchPerson={() => setMemberId(null)}
            onEditChore={(chore) => setSheet({ kind: 'chore', chore })}
            onEditMember={(member) => setSheet({ kind: 'member', member })}
            onLeft={hh.refreshHousehold} reload={hh.reload} notify={notify} />
        )}
      </main>

      <nav className="tabbar">
        {(['chores', 'calendar', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}>
            <Icon name={t === 'chores' ? 'list' : t} />
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
        <ChoreSheet chore={sheet.chore} householdId={household.id}
          onClose={closeSheet} onSaved={hh.reload} notify={notify} />
      )}
      {sheet?.kind === 'member' && (
        <MemberSheet member={sheet.member} householdId={household.id}
          onClose={closeSheet} onSaved={hh.reload} notify={notify} />
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
