import { useState, type FormEvent } from 'react';
import * as api from '../lib/api';
import { isIOS, isStandalone } from '../lib/push';
import { errorMessage } from '../lib/storage';
import type { Household, Member } from '../lib/types';

function initialCode(): string {
  try {
    return new URLSearchParams(location.search).get('join')?.toUpperCase() ?? '';
  } catch {
    return '';
  }
}

/** First screen on a new phone: join an apartment with its code, or start one. */
export function Welcome({ onJoined }: { onJoined: () => Promise<void> }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (location.search) history.replaceState(null, '', location.pathname);
      await onJoined();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) run(() => api.joinHousehold(code));
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) run(() => api.createHousehold(name.trim()));
  };

  return (
    <div className="onboard">
      <img src="icons/icon-192.png" alt="" width={72} height={72} className="logo" />
      <h1>Chores</h1>
      <p className="muted center">Who did what, and when, for your apartment.</p>

      {isIOS() && !isStandalone() && (
        <div className="callout">
          <strong>On iPhone:</strong> add this to your Home Screen first (Share button → Add to Home Screen), then
          open it from there and join. Otherwise you'll have to join twice.
        </div>
      )}

      <form className="card form" onSubmit={join}>
        <h2>Join your apartment</h2>
        <label>
          Join code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123"
            autoCapitalize="characters" autoComplete="off" maxLength={8} className="code-input" />
        </label>
        <button className="btn primary" disabled={busy || !code.trim()}>Join</button>
      </form>

      <div className="divider"><span>or</span></div>

      <form className="card form" onSubmit={create}>
        <h2>Start a new apartment</h2>
        <label>
          Apartment name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Apartment 4B" maxLength={60} />
        </label>
        <button className="btn" disabled={busy || !name.trim()}>Create</button>
      </form>

      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

/** After joining: pick which person you are (or add yourself). Remembered on this phone. */
export function PickMember(props: {
  household: Household;
  members: Member[];
  onPick: (id: string) => void;
  onAdded: () => Promise<void>;
}) {
  const active = props.members.filter((m) => !m.archived);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api.addMember(props.household.id, trimmed);
      await props.onAdded();
      props.onPick(m.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="onboard">
      <h1>Who are you?</h1>
      <p className="muted center">{props.household.name}</p>

      {active.length === 0 && (
        <div className="callout">
          Your apartment's join code is <strong className="code">{props.household.join_code}</strong>.
          Send it to your roommates so they can join. You can find it later in Settings.
        </div>
      )}

      {active.length > 0 && (
        <div className="card pick-list">
          {active.map((m) => (
            <button key={m.id} className="pick" onClick={() => props.onPick(m.id)}>{m.name}</button>
          ))}
        </div>
      )}

      <form className="card form" onSubmit={add}>
        <h2>{active.length ? "I'm not listed" : 'Add your name'}</h2>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" />
        </label>
        <button className="btn primary" disabled={busy || !name.trim()}>That's me</button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}
