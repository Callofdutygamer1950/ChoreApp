import { useState, type FormEvent } from 'react';
import { Sheet } from './ui';
import * as api from '../lib/api';
import { todayStr } from '../lib/dates';
import {
  isLastWeekdayOfMonth, monthDay, monthlyLabel, nthOf, scheduleOf, scheduleSummary, weekdayName, weekdayOf,
  type Ends, type Freq, type Schedule,
} from '../lib/schedule';
import { errorMessage } from '../lib/storage';
import type { Chore, Member, Room } from '../lib/types';

type Mode = 'once' | 'after' | 'repeat';
type Monthly = 'day' | 'nth' | 'last';
type Preset = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'after' | 'custom';

interface Form {
  mode: Mode;
  start: string; // due date for one-time chores, start date for repeats
  afterCount: string;
  afterUnit: 'days' | 'weeks';
  freq: Freq;
  every: string;
  weekdays: number[];
  monthly: Monthly;
  endsType: Ends['type'];
  endsDate: string;
  endsCount: string;
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const FREQ_UNITS: Record<Freq, [string, string]> = {
  day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'],
};

const defaultMonthly = (start: string): Monthly => (nthOf(start) >= 5 ? 'last' : 'nth');

function formFromSchedule(s: Schedule, today: string): Form {
  const base: Form = {
    mode: 'repeat', start: today, afterCount: '7', afterUnit: 'days', freq: 'week', every: '1',
    weekdays: [weekdayOf(today)], monthly: defaultMonthly(today), endsType: 'never', endsDate: '', endsCount: '10',
  };
  const ends = s.kind === 'once' ? undefined : s.ends;
  if (ends?.type === 'on') Object.assign(base, { endsType: 'on', endsDate: ends.date });
  if (ends?.type === 'count') Object.assign(base, { endsType: 'count', endsCount: String(ends.count) });
  if (s.kind === 'once') return { ...base, mode: 'once', start: s.date };
  if (s.kind === 'after') {
    const weeks = s.days % 7 === 0;
    return { ...base, mode: 'after', afterCount: String(weeks ? s.days / 7 : s.days), afterUnit: weeks ? 'weeks' : 'days' };
  }
  return {
    ...base, mode: 'repeat', start: s.start, freq: s.freq, every: String(s.every),
    weekdays: s.weekdays?.length ? [...s.weekdays] : [weekdayOf(s.start)],
    monthly: s.monthly ?? 'day',
  };
}

function presetOf(f: Form): Preset {
  if (f.mode === 'once') return 'once';
  if (f.mode === 'after') return 'after';
  if (f.every !== '1') return 'custom';
  const days = [...f.weekdays].sort().join();
  if (f.freq === 'day') return 'daily';
  if (f.freq === 'week' && days === String(weekdayOf(f.start))) return 'weekly';
  if (f.freq === 'week' && days === '1,2,3,4,5') return 'weekdays';
  if (f.freq === 'month' && f.monthly === defaultMonthly(f.start)) return 'monthly';
  if (f.freq === 'year') return 'yearly';
  return 'custom';
}

function applyPreset(f: Form, p: Preset): Form {
  const wd = weekdayOf(f.start);
  switch (p) {
    case 'once': return { ...f, mode: 'once' };
    case 'after': return { ...f, mode: 'after' };
    case 'daily': return { ...f, mode: 'repeat', freq: 'day', every: '1' };
    case 'weekly': return { ...f, mode: 'repeat', freq: 'week', every: '1', weekdays: [wd] };
    case 'weekdays': return { ...f, mode: 'repeat', freq: 'week', every: '1', weekdays: [1, 2, 3, 4, 5] };
    case 'monthly': return { ...f, mode: 'repeat', freq: 'month', every: '1', monthly: defaultMonthly(f.start) };
    case 'yearly': return { ...f, mode: 'repeat', freq: 'year', every: '1' };
    case 'custom': return f.mode === 'repeat' ? f : { ...f, mode: 'repeat', freq: 'week', every: '1', weekdays: [wd] };
  }
}

/** Turns the form into a schedule, or returns a message saying what's wrong. */
function buildSchedule(f: Form): Schedule | string {
  if (!f.start) return 'Pick a date.';
  if (f.mode === 'once') return { kind: 'once', date: f.start };

  let ends: Ends | undefined;
  if (f.endsType === 'on') {
    if (!f.endsDate) return 'Pick an end date.';
    if (f.mode === 'repeat' && f.endsDate < f.start) return 'The end date is before the start date.';
    ends = { type: 'on', date: f.endsDate };
  } else if (f.endsType === 'count') {
    const c = Math.floor(Number(f.endsCount));
    if (!(c >= 1 && c <= 999)) return 'Enter how many times (1–999).';
    ends = { type: 'count', count: c };
  }

  if (f.mode === 'after') {
    const n = Math.floor(Number(f.afterCount));
    const days = f.afterUnit === 'weeks' ? n * 7 : n;
    if (!(days >= 1 && days <= 365)) return 'Choose between 1 day and 52 weeks.';
    return { kind: 'after', days, ...(ends && { ends }) };
  }

  const every = Math.floor(Number(f.every));
  if (!(every >= 1 && every <= 99)) return 'Repeat every 1–99.';
  if (f.freq === 'week' && f.weekdays.length === 0) return 'Pick at least one day of the week.';
  return {
    kind: 'repeat', freq: f.freq, every, start: f.start,
    ...(f.freq === 'week' && { weekdays: [...f.weekdays].sort() }),
    ...(f.freq === 'month' && { monthly: f.monthly }),
    ...(ends && { ends }),
  };
}

/** Add or edit a chore and its repeat schedule (modeled on Google Calendar's). */
export function ChoreSheet(props: {
  chore: Chore | null;
  householdId: string;
  rooms: Room[];
  members: Member[];
  colors: Map<string, string>;
  onClose: () => void;
  onSaved: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const { chore } = props;
  const today = todayStr();
  const [name, setName] = useState(chore?.name ?? '');
  const [form, setForm] = useState<Form>(() =>
    formFromSchedule(chore ? scheduleOf(chore) : { kind: 'repeat', freq: 'week', every: 1, start: today }, today));
  const [showCustom, setShowCustom] = useState(() => presetOf(form) === 'custom');
  const [busy, setBusy] = useState(false);
  const [roomId, setRoomId] = useState(chore?.room_id ?? '');
  const activeMembers = props.members.filter((m) => !m.archived);
  const [rotation, setRotation] = useState<string[]>(
    () => (chore?.rotation ?? []).filter((id) => activeMembers.some((m) => m.id === id)));

  const preset = showCustom ? 'custom' : presetOf(form);
  const built = buildSchedule(form);
  const problem = typeof built === 'string' ? built : null;
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function choosePreset(p: Preset) {
    setShowCustom(p === 'custom');
    setForm((f) => applyPreset(f, p));
  }

  function changeStart(start: string) {
    if (!start) return update({ start });
    // Keep "Weekly on <day>" / "Monthly on the <nth day>" in step with the new date, like Google does.
    setForm((f) => {
      const p = showCustom ? 'custom' : presetOf(f);
      const next = { ...f, start };
      return p === 'weekly' || p === 'monthly' ? applyPreset(next, p) : next;
    });
  }

  function toggleWeekday(d: number) {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d],
    }));
  }

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
    if (!name.trim() || typeof built === 'string') return;
    const fields = { name: name.trim(), schedule: built, room_id: roomId || null, rotation };
    if (chore) run(() => api.saveChore(chore.id, fields), 'Chore saved');
    else run(() => api.addChore(props.householdId, fields), 'Chore added');
  }

  async function chooseRoom(value: string) {
    if (value !== '__new') return setRoomId(value);
    const roomName = prompt('New room name (e.g. Kitchen)')?.trim();
    if (!roomName) return;
    try {
      const room = await api.addRoom(props.householdId, roomName.slice(0, 40));
      setRoomId(room.id);
      props.onSaved();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  function toggleRotation(id: string) {
    setRotation((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  function remove() {
    if (!chore || !confirm(`Delete "${chore.name}"? It leaves the list, but past entries stay on the calendar.`)) return;
    run(() => api.updateChore(chore.id, { archived: true }), 'Chore deleted');
  }

  const start = form.start || today;
  const every = Number(form.every) || 1;
  const startWd = weekdayName(weekdayOf(start));

  return (
    <Sheet title={chore ? 'Edit chore' : 'New chore'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Name
          <input value={name} maxLength={60} placeholder="e.g. Take out trash" autoFocus={!chore}
            onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          Room
          <select value={roomId} onChange={(e) => chooseRoom(e.target.value)}>
            <option value="">No room</option>
            {props.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            <option value="__new">+ New room…</option>
          </select>
        </label>

        <label>
          Repeats
          <select value={preset} onChange={(e) => choosePreset(e.target.value as Preset)}>
            <option value="once">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly on {startWd}</option>
            <option value="monthly">Monthly {monthlyLabel(defaultMonthly(start), start)}</option>
            <option value="yearly">Annually on {monthDay(start)}</option>
            <option value="weekdays">Every weekday (Monday to Friday)</option>
            <option value="after">A set time after it's last done…</option>
            <option value="custom">Custom…</option>
          </select>
        </label>

        {form.mode === 'after' ? (
          <label>
            Due again
            <div className="row">
              <input type="number" inputMode="numeric" min={1} max={form.afterUnit === 'weeks' ? 52 : 365}
                value={form.afterCount} onChange={(e) => update({ afterCount: e.target.value })} />
              <select value={form.afterUnit} onChange={(e) => update({ afterUnit: e.target.value as 'days' | 'weeks' })}>
                <option value="days">{form.afterCount === '1' ? 'day' : 'days'} after it's done</option>
                <option value="weeks">{form.afterCount === '1' ? 'week' : 'weeks'} after it's done</option>
              </select>
            </div>
            <span className="hint">Good for chores without a fixed day, like cleaning the fridge.</span>
          </label>
        ) : (
          <label>
            {form.mode === 'once' ? 'Due on' : 'Starts'}
            <input type="date" value={form.start} required onChange={(e) => changeStart(e.target.value)} />
          </label>
        )}

        {form.mode === 'repeat' && preset === 'custom' && (
          <div className="custom-repeat">
            <div className="field-label">Repeat every</div>
            <div className="row">
              <input type="number" inputMode="numeric" min={1} max={99} value={form.every}
                onChange={(e) => update({ every: e.target.value })} />
              <select value={form.freq} onChange={(e) => {
                const freq = e.target.value as Freq;
                update(freq === 'month' ? { freq, monthly: form.monthly } : { freq });
              }}>
                {(Object.keys(FREQ_UNITS) as Freq[]).map((fq) => (
                  <option key={fq} value={fq}>{FREQ_UNITS[fq][every === 1 ? 0 : 1]}</option>
                ))}
              </select>
            </div>

            {form.freq === 'week' && (
              <>
                <div className="field-label">Repeat on</div>
                <div className="weekday-chips" role="group" aria-label="Days of the week">
                  {WEEKDAY_LETTERS.map((letter, d) => (
                    <button key={d} type="button" className={`chip${form.weekdays.includes(d) ? ' on' : ''}`}
                      aria-pressed={form.weekdays.includes(d)} aria-label={weekdayName(d)}
                      onClick={() => toggleWeekday(d)}>{letter}</button>
                  ))}
                </div>
              </>
            )}

            {form.freq === 'month' && (
              <select value={form.monthly} onChange={(e) => update({ monthly: e.target.value as Monthly })}
                aria-label="Which day of the month">
                <option value="day">{monthlyLabel('day', start)}</option>
                {nthOf(start) <= 4 && <option value="nth">{monthlyLabel('nth', start)}</option>}
                {nthOf(start) >= 4 && isLastWeekdayOfMonth(start) && <option value="last">{monthlyLabel('last', start)}</option>}
              </select>
            )}
          </div>
        )}

        {form.mode !== 'once' && (
          <fieldset className="ends">
            <legend>Ends</legend>
            <label className="radio">
              <input type="radio" name="ends" checked={form.endsType === 'never'} onChange={() => update({ endsType: 'never' })} />
              <span>Never</span>
            </label>
            <label className="radio">
              <input type="radio" name="ends" checked={form.endsType === 'on'} onChange={() => update({ endsType: 'on' })} />
              <span>On</span>
              <input type="date" value={form.endsDate} min={form.mode === 'repeat' ? form.start : undefined}
                disabled={form.endsType !== 'on'} onChange={(e) => update({ endsDate: e.target.value })} />
            </label>
            <label className="radio">
              <input type="radio" name="ends" checked={form.endsType === 'count'} onChange={() => update({ endsType: 'count' })} />
              <span>After</span>
              <input type="number" inputMode="numeric" min={1} max={999} value={form.endsCount} className="count-input"
                disabled={form.endsType !== 'count'} onChange={(e) => update({ endsCount: e.target.value })} />
              <span className="muted">times done</span>
            </label>
          </fieldset>
        )}

        <fieldset className="rotation">
          <legend>Whose turn <span className="muted">(optional)</span></legend>
          <p className="hint">
            Tap people in turn order. The turn goes to whoever has done it the least, never the same person twice in a row.
          </p>
          <div className="rotation-chips">
            {activeMembers.map((m) => {
              const pos = rotation.indexOf(m.id);
              return (
                <button key={m.id} type="button" className={`person-chip${pos >= 0 ? ' on' : ''}`}
                  aria-pressed={pos >= 0} onClick={() => toggleRotation(m.id)}>
                  {pos >= 0 ? <b>{pos + 1}</b> : <i style={{ background: props.colors.get(m.id) }} />}
                  {m.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <p className={`summary${problem ? ' error-text' : ''}`}>{problem ?? scheduleSummary(built as Schedule)}</p>

        <div className="form-actions">
          {chore && <button type="button" className="btn danger-text" disabled={busy} onClick={remove}>Delete</button>}
          <button type="submit" className="btn primary" disabled={busy || !name.trim() || !!problem}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
