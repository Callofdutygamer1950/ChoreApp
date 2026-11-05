import { useEffect, useState } from 'react';
import * as api from '../lib/api';
import { hourLabel } from '../lib/dates';
import { scheduleOf, scheduleSummary } from '../lib/schedule';
import * as push from '../lib/push';
import { errorMessage } from '../lib/storage';
import type { Chore, Completion, Household, Member, Room, TurnAdjustment } from '../lib/types';
import { Icon, memberColors } from '../components/ui';
import { AdminPanel } from '../components/AdminPanel';

export function SettingsTab(props: {
  household: Household;
  members: Member[];
  chores: Chore[];
  /** Chores that are done for good (one-time and done, or ended). */
  finishedIds: Set<string>;
  me: Member;
  rooms: Room[];
  completions: Completion[];
  adjustments: TurnAdjustment[];
  onSwitchPerson: () => void;
  onEditChore: (c: Chore | null) => void;
  onEditMember: (m: Member | null) => void;
  onLeft: () => Promise<void>;
  reload: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const { household } = props;
  const chores = props.chores.filter((c) => !c.archived);
  const people = props.members.filter((m) => !m.archived);
  const colors = memberColors(props.members);
  const [aptName, setAptName] = useState(household.name);
  useEffect(() => setAptName(household.name), [household.name]);

  const [adminOpen, setAdminOpen] = useState(false);

  async function addRoom() {
    const name = prompt('New room name (e.g. Kitchen)')?.trim();
    if (!name) return;
    try {
      await api.addRoom(household.id, name.slice(0, 40));
      props.reload();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  async function editRoom(room: Room) {
    const name = prompt(`Rename "${room.name}" (leave empty to delete the room)`, room.name);
    if (name === null) return;
    try {
      if (name.trim()) {
        if (name.trim() !== room.name) await api.renameRoom(room.id, name.trim().slice(0, 40));
      } else if (confirm(`Delete the room "${room.name}"? Its chores stay, just without a room.`)) {
        await api.deleteRoom(room.id);
      } else {
        return;
      }
      props.reload();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  const choreRow = (c: Chore) => (
    <button key={c.id} className="row-item tap" onClick={() => props.onEditChore(c)}>
      <span>{c.name}</span>
      <span className="muted row-detail">{scheduleSummary(scheduleOf(c))}</span>
    </button>
  );

  const joinLink =`${location.origin}${location.pathname}?join=${household.join_code}`;

  async function share() {
    const text = `Join our apartment on Chores with code ${household.join_code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Chores', text, url: joinLink });
        return;
      }
      await navigator.clipboard.writeText(`${text}: ${joinLink}`);
      props.notify('Invite copied');
    } catch {
      // Share sheet dismissed — nothing to do.
    }
  }

  async function saveName() {
    const name = aptName.trim();
    if (!name || name === household.name) return setAptName(household.name);
    try {
      await api.renameHousehold(household.id, name);
      props.notify('Apartment renamed');
      props.reload();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  async function leave() {
    if (!confirm('Leave this apartment on this phone? Nothing is deleted. You can rejoin later with the join code.')) return;
    try {
      await push.disableReminders().catch(() => {});
      await api.leaveHousehold();
      await props.onLeft();
    } catch (e) {
      props.notify(errorMessage(e), true);
    }
  }

  return (
    <div className="settings">
      <section>
        <h3 className="section-title">You</h3>
        <div className="card rows">
          <div className="row-item">
            <span><i className="dot" style={{ background: colors.get(props.me.id) }} /> {props.me.name}</span>
            <button className="btn small" onClick={props.onSwitchPerson}>Switch person</button>
          </div>
          <button className="row-item tap add" onClick={() => props.onEditMember(props.me)}>
            <span>Change my name or color</span>
          </button>
        </div>
      </section>

      <section>
        <h3 className="section-title">Chores</h3>
        <div className="card rows">
          {chores.filter((c) => !props.finishedIds.has(c.id)).map(choreRow)}
          <button className="row-item tap add" onClick={() => props.onEditChore(null)}>
            <span><Icon name="plus" size={18} /> Add chore</span>
          </button>
        </div>
      </section>

      {chores.some((c) => props.finishedIds.has(c.id)) && (
        <section>
          <h3 className="section-title">Finished chores</h3>
          <div className="card rows">{chores.filter((c) => props.finishedIds.has(c.id)).map(choreRow)}</div>
          <p className="muted fine">One-time chores that are done, and repeats that have ended. To bring one back, delete its entry on the calendar or change how it repeats.</p>
        </section>
      )}

      <section>
        <h3 className="section-title">People</h3>
        <div className="card rows">
          {people.map((m) => (
            <button key={m.id} className="row-item tap" onClick={() => props.onEditMember(m)}>
              <span><i className="dot" style={{ background: colors.get(m.id) }} /> {m.name}</span>
              {m.id === props.me.id && <span className="muted">You</span>}
            </button>
          ))}
          <button className="row-item tap add" onClick={() => props.onEditMember(null)}>
            <span><Icon name="plus" size={18} /> Add person</span>
          </button>
        </div>
      </section>

      <section>
        <h3 className="section-title">Rooms</h3>
        <div className="card rows">
          {props.rooms.map((r) => (
            <button key={r.id} className="row-item tap" onClick={() => editRoom(r)}>
              <span>{r.name}</span>
              <span className="muted">
                {(() => { const n = chores.filter((c) => c.room_id === r.id).length; return `${n} chore${n === 1 ? "" : "s"}`; })()}
              </span>
            </button>
          ))}
          <button className="row-item tap add" onClick={addRoom}>
            <span><Icon name="plus" size={18} /> Add room</span>
          </button>
        </div>
      </section>

      <Reminders notify={props.notify} />

      <section>
        <h3 className="section-title">Admin</h3>
        <div className="card rows">
          <button className="row-item tap" onClick={() => setAdminOpen((v) => !v)} aria-expanded={adminOpen}>
            <span>Turn counts</span>
            <span className="muted">{adminOpen ? 'Hide' : 'PIN required'}</span>
          </button>
          {adminOpen && (
            <AdminPanel chores={props.chores} members={props.members} completions={props.completions}
              adjustments={props.adjustments} colors={colors} reload={props.reload} notify={props.notify} />
          )}
        </div>
      </section>

      <section>
        <h3 className="section-title">Apartment</h3>
        <div className="card rows">
          <label className="row-item">
            <span>Name</span>
            <input className="inline-input" value={aptName} maxLength={60}
              onChange={(e) => setAptName(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <div className="row-item">
            <span>Join code <strong className="code">{household.join_code}</strong></span>
            <button className="btn small" onClick={share}>Invite</button>
          </div>
        </div>
        <button className="btn ghost danger-text full" onClick={leave}>Leave apartment on this phone</button>
      </section>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function Reminders({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const support = push.pushSupport();
  const [hour, setHour] = useState<number | null>(null); // null = off
  const [loading, setLoading] = useState(support === 'ok');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== 'ok') return;
    push.currentReminder()
      .then(setHour)
      .catch(() => setHour(null))
      .finally(() => setLoading(false));
  }, [support]);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        await push.enableReminders(hour ?? 18);
        setHour(hour ?? 18);
        notify('Reminders on');
      } else {
        await push.disableReminders();
        setHour(null);
        notify('Reminders off');
      }
    } catch (e) {
      notify(errorMessage(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function changeHour(h: number) {
    const prev = hour;
    setHour(h);
    try {
      await push.setReminderHour(h);
    } catch (e) {
      setHour(prev);
      notify(errorMessage(e), true);
    }
  }

  let body;
  if (support === 'not-configured') {
    body = <p className="muted small-pad">Reminders aren't set up on the server yet.</p>;
  } else if (support === 'needs-install') {
    body = <p className="muted small-pad">On iPhone, add this app to your Home Screen (Share → Add to Home Screen) and open it from there to turn on reminders.</p>;
  } else if (support === 'unsupported') {
    body = <p className="muted small-pad">This browser doesn't support notifications.</p>;
  } else {
    body = (
      <>
        <label className="row-item">
          <span>Daily reminder for overdue chores</span>
          <input type="checkbox" className="switch" checked={hour !== null} disabled={loading || busy}
            onChange={(e) => toggle(e.target.checked)} />
        </label>
        {hour !== null && (
          <label className="row-item">
            <span>Time</span>
            <select value={hour} onChange={(e) => changeHour(Number(e.target.value))}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </label>
        )}
      </>
    );
  }

  return (
    <section>
      <h3 className="section-title">Reminders</h3>
      <div className="card rows">{body}</div>
      {support === 'ok' && <p className="muted fine">This setting only applies to this phone.</p>}
    </section>
  );
}
