import { useMemo, useState } from 'react';
import { Icon, Sheet } from './ui';
import * as api from '../lib/api';
import { addDays, formatDay } from '../lib/dates';
import { nextDueAfterSkip, scheduleOf, scheduleSummary } from '../lib/schedule';
import { statusText, turnCounts, type ChoreState } from '../lib/status';
import { errorMessage } from '../lib/storage';
import type { Completion, Member, Room, TurnAdjustment } from '../lib/types';

/** Tap a chore: its status, whose turn, snooze/skip, and full history. */
export function ChoreDetailSheet(props: {
  state: ChoreState;
  completions: Completion[];
  adjustments: TurnAdjustment[];
  members: Member[];
  rooms: Room[];
  colors: Map<string, string>;
  meId: string;
  today: string;
  locked: boolean;
  onDone: () => void;
  onEdit: () => void;
  onEditEntry: (c: Completion) => void;
  onClose: () => void;
  onSaved: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const { state, today } = props;
  const { chore } = state;
  const schedule = scheduleOf(chore);
  const status = statusText(state);
  const names = new Map(props.members.map((m) => [m.id, m.name]));
  const room = props.rooms.find((r) => r.id === chore.room_id);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [pickDay, setPickDay] = useState(addDays(today, 2));
  const [busy, setBusy] = useState(false);

  const history = useMemo(
    () => props.completions
      .filter((c) => c.chore_id === chore.id)
      .sort((a, b) => b.done_on.localeCompare(a.done_on) || b.created_at.localeCompare(a.created_at)),
    [props.completions, chore.id],
  );

  const rotation = (chore.rotation ?? []).filter((id) => props.members.some((m) => m.id === id && !m.archived));
  const counts = turnCounts(chore, props.completions, props.adjustments);
  const skipTo = nextDueAfterSkip(schedule, state.due, today);
  const tomorrow = addDays(today, 1);
  const snoozeActive = state.snoozed;

  async function snooze(until: string | null, message: string) {
    setBusy(true);
    try {
      await api.snoozeChore(chore.id, until);
      props.notify(message);
      props.onSaved();
      props.onClose();
    } catch (e) {
      props.notify(errorMessage(e), true);
      setBusy(false);
    }
  }

  const dayLabel = (d: string) => formatDay(d, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <Sheet title={chore.name} onClose={props.onClose}>
      <div className="detail">
        <div className="detail-meta">
          {room && <span className="room-tag">{room.name}</span>}
          <span className="muted">{scheduleSummary(schedule)}</span>
        </div>
        <div className={`chore-status tone-${status.tone}`}>{status.text}</div>
        {state.turn && (
          <div className="turn-line">
            {state.turn === props.meId ? <strong>Your turn</strong> : <>Up next: <strong>{names.get(state.turn)}</strong></>}
          </div>
        )}

        <div className="detail-actions">
          <button className="btn primary" disabled={props.locked} onClick={() => { props.onDone(); props.onClose(); }}>
            <Icon name="check" size={18} /> Done
          </button>
          <button className="btn" onClick={() => setSnoozeOpen((v) => !v)} aria-expanded={snoozeOpen}>Snooze</button>
          <button className="btn" onClick={props.onEdit}>Edit</button>
        </div>

        {snoozeOpen && (
          <div className="snooze-panel">
            <button className="btn" disabled={busy || (state.due !== null && state.due >= tomorrow)}
              onClick={() => snooze(tomorrow, `${chore.name} snoozed until tomorrow`)}>
              Tomorrow
            </button>
            {skipTo && (
              <button className="btn" disabled={busy}
                onClick={() => snooze(skipTo, `Skipped to ${dayLabel(skipTo)}`)}>
                Skip to next time ({dayLabel(skipTo)})
              </button>
            )}
            <div className="row">
              <input type="date" value={pickDay} min={tomorrow} onChange={(e) => setPickDay(e.target.value)}
                aria-label="Snooze until" />
              <button className="btn" disabled={busy || !pickDay || pickDay < tomorrow}
                onClick={() => snooze(pickDay, `Snoozed until ${dayLabel(pickDay)}`)}>
                Snooze to this day
              </button>
            </div>
            {snoozeActive && (
              <button className="btn ghost danger-text" disabled={busy} onClick={() => snooze(null, 'Snooze cancelled')}>
                Cancel snooze
              </button>
            )}
          </div>
        )}

        {rotation.length > 0 && (
          <section>
            <h3 className="section-title">Turns</h3>
            <div className="card rows">
              {rotation.map((id) => {
                const c = counts.get(id) ?? { done: 0, extra: 0 };
                return (
                  <div key={id} className="row-item">
                    <span><i className="dot" style={{ background: props.colors.get(id) }} /> {names.get(id)}
                      {state.turn === id && <span className="turn-badge">Up next</span>}</span>
                    <span className="muted">{c.done + c.extra} {c.done + c.extra === 1 ? 'time' : 'times'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h3 className="section-title">History <span className="muted-count">{history.length}</span></h3>
          {history.length === 0 && <p className="muted">Not done yet.</p>}
          <ul className="entry-list">
            {history.slice(0, 50).map((e) => (
              <li key={e.id}>
                <button className="entry" onClick={() => props.onEditEntry(e)}>
                  <i className="dot" style={{ background: (e.member_id && props.colors.get(e.member_id)) || 'var(--muted)' }} />
                  <span className="entry-text">
                    <span className="entry-chore">{formatDay(e.done_on, { weekday: 'short', month: 'short', day: 'numeric', year: e.done_on.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })}</span>
                    <span className="entry-who">{(e.member_id && names.get(e.member_id)) || 'Someone'}</span>
                    {e.note && <span className="entry-note">“{e.note}”</span>}
                  </span>
                  <span className="entry-edit">Edit</span>
                </button>
              </li>
            ))}
          </ul>
          {history.length > 50 && <p className="muted fine">Showing the latest 50. Older entries are on the calendar.</p>}
        </section>
      </div>
    </Sheet>
  );
}
