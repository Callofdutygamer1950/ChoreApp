import { useState, type FormEvent } from 'react';
import { Sheet, SWATCHES } from './ui';
import * as api from '../lib/api';
import { formatDay, todayStr } from '../lib/dates';
import { errorMessage, uuid } from '../lib/storage';
import type { Chore, Completion, Member } from '../lib/types';

type Notify = (text: string, error?: boolean) => void;

/** Edit or delete a "done" entry, or log a new one (e.g. for an earlier day). */
export function EntrySheet(props: {
  entry: Completion | null;
  defaultDate?: string;
  householdId: string;
  chores: Chore[];
  members: Member[];
  meId: string;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const { entry, chores, members } = props;
  const activeChores = chores.filter((c) => !c.archived || c.id === entry?.chore_id);
  const people = members.filter((m) => !m.archived || m.id === entry?.member_id);
  const [choreId, setChoreId] = useState(entry?.chore_id ?? activeChores[0]?.id ?? '');
  const [memberId, setMemberId] = useState(entry ? entry.member_id ?? '' : props.meId);
  const [date, setDate] = useState(entry?.done_on ?? props.defaultDate ?? todayStr());
  const [note, setNote] = useState(entry?.note ?? '');
  const [busy, setBusy] = useState(false);
  const today = todayStr();

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await action();
      props.notify(done);
      props.onSaved();
      props.onClose();
    } catch (e) {
      props.notify(errorMessage(e), true);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!choreId || !date) return;
    const fields = { chore_id: choreId, member_id: memberId || null, done_on: date, note: note.trim() || null };
    if (entry) run(() => api.updateCompletion(entry.id, fields), 'Saved');
    else run(() => api.addCompletion({ id: uuid(), household_id: props.householdId, ...fields }), 'Logged');
  }

  function remove() {
    if (!entry || !confirm('Delete this entry? The chore will go back to its previous "last done" date.')) return;
    run(() => api.deleteCompletion(entry.id), 'Entry deleted');
  }

  if (!entry && activeChores.length === 0) {
    return (
      <Sheet title="Log a chore" onClose={props.onClose}>
        <p className="muted">Add a chore in Settings first.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title={entry ? 'Edit entry' : 'Log a chore'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Chore
          <select value={choreId} onChange={(e) => setChoreId(e.target.value)}>
            {activeChores.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Done by
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {entry && !entry.member_id && <option value="">Someone</option>}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} />
          {date && <span className="hint">{formatDay(date, { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
        </label>
        <label>
          <span>Note <span className="muted">(optional)</span></span>
          <textarea value={note} maxLength={280} rows={2} placeholder="e.g. Out of trash bags"
            onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="form-actions">
          {entry && <button type="button" className="btn danger-text" disabled={busy} onClick={remove}>Delete</button>}
          <button type="submit" className="btn primary" disabled={busy || date > today}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Add, rename, or remove a person. */
export function MemberSheet(props: {
  member: Member | null;
  /** The color this person shows in now (or the next default color for a new person). */
  currentColor: string;
  householdId: string;
  onClose: () => void;
  onSaved: () => void;
  notify: Notify;
}) {
  const { member } = props;
  const [name, setName] = useState(member?.name ?? '');
  const [color, setColor] = useState(props.currentColor);
  const [busy, setBusy] = useState(false);
  const isCustom = !SWATCHES.includes(color.toLowerCase());

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      props.notify(done);
      props.onSaved();
      props.onClose();
    } catch (e) {
      props.notify(errorMessage(e), true);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Only save a color when it was changed, so untouched people keep the automatic default.
    const changed = color.toLowerCase() !== props.currentColor.toLowerCase();
    const picked = changed ? color.toLowerCase() : null;
    if (member) {
      run(() => api.updateMember(member.id, picked ? { name: name.trim(), color: picked } : { name: name.trim() }), 'Saved');
    } else {
      run(() => api.addMember(props.householdId, name.trim(), picked), 'Person added');
    }
  }

  function remove() {
    if (!member || !confirm(`Remove ${member.name}? Their past entries stay on the calendar.`)) return;
    run(() => api.updateMember(member.id, { archived: true }), `${member.name} removed`);
  }

  return (
    <Sheet title={member ? 'Edit person' : 'Add person'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input value={name} maxLength={40} autoFocus={!member} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="swatches">
          <legend>Color</legend>
          {SWATCHES.map((c) => (
            <button key={c} type="button" className={`swatch${color.toLowerCase() === c ? ' selected' : ''}`}
              style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={color.toLowerCase() === c}
              onClick={() => setColor(c)} />
          ))}
          <label className={`swatch custom${isCustom ? ' selected' : ''}`} style={isCustom ? { background: color } : undefined}
            title="Custom color">
            <span aria-hidden="true">{isCustom ? '' : '+'}</span>
            <input type="color" value={color} aria-label="Custom color" onChange={(e) => setColor(e.target.value)} />
          </label>
        </fieldset>
        <div className="form-actions">
          {member && <button type="button" className="btn danger-text" disabled={busy} onClick={remove}>Remove</button>}
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
