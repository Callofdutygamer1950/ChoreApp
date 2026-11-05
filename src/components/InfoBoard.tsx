import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { Icon, Sheet } from './ui';
import * as api from '../lib/api';
import { errorMessage } from '../lib/storage';
import type { InfoCard } from '../lib/types';

// Links, emails and phone numbers in card text become tappable.
const TOKEN = /(https?:\/\/[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+?\(?\d[\d\s().-]{6,}\d)/g;

/** Looks like a phone number: 7-15 digits, written with + or separators, and not a date. */
function isPhone(s: string): boolean {
  const digits = s.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) return false;
  return s.startsWith('+') || /[\s().-]/.test(s);
}

function linkify(text: string): ReactNode {
  const parts = text.split(TOKEN);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
    if (/^https?:\/\//.test(part)) {
      const clean = part.replace(/[.,!?)]+$/, '');
      return <Fragment key={i}><a href={clean} target="_blank" rel="noopener noreferrer">{clean}</a>{part.slice(clean.length)}</Fragment>;
    }
    if (part.includes('@')) return <a key={i} href={`mailto:${part}`}>{part}</a>;
    if (!isPhone(part)) return <Fragment key={i}>{part}</Fragment>;
    return <a key={i} href={`tel:${part.replace(/[^\d+]/g, '')}`}>{part}</a>;
  });
}

/** Shared house info: Wi-Fi, landlord, trash day… */
export function InfoBoard(props: {
  householdId: string;
  cards: InfoCard[];
  reload: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [editing, setEditing] = useState<InfoCard | 'new' | null>(null);
  const [arranging, setArranging] = useState(false);
  const cards = [...props.cards].sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));

  async function copy(card: InfoCard) {
    try {
      await navigator.clipboard.writeText(card.body);
      props.notify(`Copied ${card.title}`);
    } catch {
      props.notify("Couldn't copy on this device", true);
    }
  }

  async function move(index: number, delta: number) {
    if (!cards[index + delta]) return;
    try {
      // Give every card a clean position, then swap the two.
      const order = cards.map((c) => c.id);
      [order[index], order[index + delta]] = [order[index + delta], order[index]];
      await Promise.all(order.map((id, i) => {
        const c = cards.find((x) => x.id === id)!;
        return c.sort === i ? null : api.saveInfoCard(id, { sort: i });
      }));
      props.reload();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  return (
    <div className="info-board">
      <div className="recipe-actions">
        <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" size={18} /> Add card</button>
        {cards.length > 1 && (
          <button className="btn" onClick={() => setArranging((v) => !v)}>{arranging ? 'Done' : 'Reorder'}</button>
        )}
      </div>

      {cards.length === 0 && (
        <p className="empty-small muted">
          Keep the stuff everyone needs in one place: Wi-Fi, landlord contact, trash day, door codes.
        </p>
      )}

      <ul className="info-list">
        {cards.map((card, i) => (
          <li key={card.id} className="info-card">
            <div className="info-head">
              <h3>{card.title}</h3>
              {arranging ? (
                <span className="info-move">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${card.title} up`}>
                    <Icon name="up" size={18} />
                  </button>
                  <button className="icon-btn" disabled={i === cards.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${card.title} down`}>
                    <Icon name="down" size={18} />
                  </button>
                </span>
              ) : (
                <span className="info-tools">
                  {card.body && <button className="btn small" onClick={() => copy(card)}>Copy</button>}
                  <button className="btn small" onClick={() => setEditing(card)}>Edit</button>
                </span>
              )}
            </div>
            {card.body && <div className="info-body">{linkify(card.body)}</div>}
          </li>
        ))}
      </ul>

      {editing && (
        <InfoCardSheet card={editing === 'new' ? null : editing} householdId={props.householdId}
          nextSort={cards.length ? Math.max(...cards.map((c) => c.sort)) + 1 : 0}
          onClose={() => setEditing(null)} onSaved={props.reload} notify={props.notify} />
      )}
    </div>
  );
}

function InfoCardSheet(props: {
  card: InfoCard | null;
  householdId: string;
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [title, setTitle] = useState(props.card?.title ?? '');
  const [body, setBody] = useState(props.card?.body ?? '');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await action();
      props.notify(message);
      props.onSaved();
      props.onClose();
    } catch (e) {
      props.notify(errorMessage(e), true);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const t = title.trim().slice(0, 80);
    const b = body.trim().slice(0, 4000);
    if (props.card) run(() => api.saveInfoCard(props.card!.id, { title: t, body: b }), 'Saved');
    else run(() => api.addInfoCard(props.householdId, t, b, props.nextSort), 'Card added');
  }

  return (
    <Sheet title={props.card ? 'Edit card' : 'New card'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Title
          <input value={title} maxLength={80} placeholder="e.g. Wi-Fi" autoFocus={!props.card}
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Details
          <textarea rows={5} value={body} maxLength={4000} placeholder={'Network: Apt4B\nPassword: …'}
            onChange={(e) => setBody(e.target.value)} />
          <span className="hint">Phone numbers, emails and links become tappable.</span>
        </label>
        <div className="form-actions">
          {props.card && (
            <button type="button" className="btn danger-text" disabled={busy}
              onClick={() => confirm(`Delete "${props.card!.title}"?`) && run(() => api.deleteInfoCard(props.card!.id), 'Card deleted')}>
              Delete
            </button>
          )}
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
