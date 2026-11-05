import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api';
import { turnCounts } from '../lib/status';
import { errorMessage } from '../lib/storage';
import type { Chore, Completion, Member, TurnAdjustment } from '../lib/types';

const pinOk = (p: string) => /^[0-9]{4}$/.test(p);

/** PIN-protected: see each person's turn counts and adjust them (e.g. bring a newcomer up to speed). */
export function AdminPanel(props: {
  chores: Chore[];
  members: Member[];
  completions: Completion[];
  adjustments: TurnAdjustment[];
  colors: Map<string, string>;
  reload: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState<string | null>(null); // set once unlocked (kept only in memory)
  const [entry, setEntry] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    api.hasAdminPin().then(setHasPin).catch(() => setHasPin(false));
  }, []);

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      props.notify(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }

  function createPin(e: FormEvent) {
    e.preventDefault();
    if (!pinOk(entry) || entry !== confirmPin) return;
    attempt(async () => {
      await api.setAdminPin('', entry);
      setHasPin(true);
      setPin(entry);
      setEntry('');
      setConfirmPin('');
      props.notify('Admin PIN set');
    });
  }

  function unlock(e: FormEvent) {
    e.preventDefault();
    if (!pinOk(entry)) return;
    attempt(async () => {
      await api.checkAdminPin(entry);
      setPin(entry);
      setEntry('');
    });
  }

  function changePin(e: FormEvent) {
    e.preventDefault();
    if (!pin || !pinOk(entry) || entry !== confirmPin) return;
    attempt(async () => {
      await api.setAdminPin(pin, entry);
      setPin(entry);
      setEntry('');
      setConfirmPin('');
      setChanging(false);
      props.notify('Admin PIN changed');
    });
  }

  const pinInput = (value: string, set: (v: string) => void, label: string, autoFocus = false) => (
    <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4}
      pattern="[0-9]*" value={value} aria-label={label} placeholder={label} autoFocus={autoFocus}
      onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  );

  if (hasPin === null) return <p className="muted small-pad">Loading…</p>;

  if (!hasPin) {
    return (
      <form className="form small-pad" onSubmit={createPin}>
        <p className="hint">Set a 4-digit PIN. Anyone who knows it can adjust turn counts.</p>
        <div className="row">
          {pinInput(entry, setEntry, 'New PIN')}
          {pinInput(confirmPin, setConfirmPin, 'Repeat PIN')}
        </div>
        {confirmPin.length === 4 && entry !== confirmPin && <span className="error-text hint">The PINs don't match.</span>}
        <button className="btn primary" disabled={busy || !pinOk(entry) || entry !== confirmPin}>Set PIN</button>
      </form>
    );
  }

  if (!pin) {
    return (
      <form className="form small-pad" onSubmit={unlock}>
        <div className="row">
          {pinInput(entry, setEntry, 'Admin PIN', true)}
          <button className="btn primary" disabled={busy || !pinOk(entry)}>Unlock</button>
        </div>
      </form>
    );
  }

  const active = new Set(props.members.filter((m) => !m.archived).map((m) => m.id));
  const names = new Map(props.members.map((m) => [m.id, m.name]));
  const withTurns = props.chores.filter((c) => !c.archived && (c.rotation ?? []).some((id) => active.has(id)));

  return (
    <div className="admin small-pad">
      <p className="hint">
        Turn counts decide whose turn it is (lowest goes next). Change a count to bring a newcomer up to
        everyone else. The real history isn't changed.
      </p>
      {withTurns.length === 0 && <p className="muted">No chores use whose-turn yet. Turn it on in a chore's editor.</p>}
      {withTurns.map((chore) => {
        const counts = turnCounts(chore, props.completions, props.adjustments);
        return (
          <div key={chore.id} className="admin-chore">
            <div className="admin-chore-name">{chore.name}</div>
            {chore.rotation.filter((id) => active.has(id)).map((id) => {
              const c = counts.get(id) ?? { done: 0, extra: 0 };
              return (
                <CountRow key={`${id}-${c.done + c.extra}`} name={names.get(id) ?? '?'} color={props.colors.get(id)}
                  done={c.done} total={c.done + c.extra} busy={busy}
                  onSave={(n) => attempt(async () => {
                    await api.setTurnCount(pin, chore.id, id, n);
                    props.notify(`${names.get(id)} now counts as ${n} for ${chore.name}`);
                    props.reload();
                  })} />
              );
            })}
          </div>
        );
      })}

      {changing ? (
        <form className="form" onSubmit={changePin}>
          <div className="row">
            {pinInput(entry, setEntry, 'New PIN', true)}
            {pinInput(confirmPin, setConfirmPin, 'Repeat PIN')}
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setChanging(false)}>Cancel</button>
            <button className="btn primary" disabled={busy || !pinOk(entry) || entry !== confirmPin}>Change PIN</button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <button className="btn small" onClick={() => setChanging(true)}>Change PIN</button>
          <button className="btn small" onClick={() => setPin(null)}>Lock</button>
        </div>
      )}
    </div>
  );
}

function CountRow(props: {
  name: string; color?: string; done: number; total: number; busy: boolean; onSave: (n: number) => void;
}) {
  const [value, setValue] = useState(String(props.total));
  const n = Math.floor(Number(value));
  const changed = value !== '' && n !== props.total;
  return (
    <div className="count-row">
      <span className="count-name"><i className="dot" style={{ background: props.color }} /> {props.name}</span>
      <span className="muted count-real">{props.done} done</span>
      <input type="number" inputMode="numeric" min={0} value={value} aria-label={`Count for ${props.name}`}
        onChange={(e) => setValue(e.target.value)} />
      <button className="btn small" disabled={props.busy || !changed || !(n >= 0)} onClick={() => props.onSave(n)}>Save</button>
    </div>
  );
}
