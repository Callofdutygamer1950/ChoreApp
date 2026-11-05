import { useState } from 'react';
import { agoLabel, diffDays } from '../lib/dates';
import { scheduleOf, scheduleSummary } from '../lib/schedule';
import { needsDoing, statusText, type ChoreState } from '../lib/status';
import { getItem, setItem } from '../lib/storage';
import type { Member, Room } from '../lib/types';
import { Icon } from '../components/ui';

const FILTER_KEY = 'chores.filter';

export function ChoresTab(props: {
  states: ChoreState[];
  members: Member[];
  rooms: Room[];
  meId: string;
  today: string;
  onDone: (s: ChoreState) => void;
  onOpen: (s: ChoreState) => void;
  onAddChore: () => void;
  /** Chores that were just marked done and can't be marked again yet. */
  locked: Map<string, number>;
}) {
  const names = new Map(props.members.map((m) => [m.id, m.name]));
  const roomNames = new Map(props.rooms.map((r) => [r.id, r.name]));
  const [filter, setFilterState] = useState(() => getItem(FILTER_KEY) ?? 'all');
  const setFilter = (f: string) => {
    setFilterState(f);
    setItem(FILTER_KEY, f);
  };

  const hasTurns = props.states.some((s) => s.turn);
  const usedRooms = props.rooms.filter((r) => props.states.some((s) => s.chore.room_id === r.id));
  // A remembered filter for a room that no longer has chores falls back to All.
  const active = filter === 'mine' ? (hasTurns ? 'mine' : 'all')
    : filter !== 'all' && !usedRooms.some((r) => r.id === filter) ? 'all' : filter;
  const states = props.states.filter((s) =>
    active === 'all' ? true : active === 'mine' ? s.turn === props.meId : s.chore.room_id === active);
  const showChips = hasTurns || usedRooms.length > 0;

  if (props.states.length === 0) {
    return (
      <div className="empty">
        <p>No chores on the list.</p>
        <button className="btn primary" onClick={props.onAddChore}>Add a chore</button>
      </div>
    );
  }

  const todo = states.filter(needsDoing);
  const later = states.filter((s) => !needsDoing(s));

  const row = (s: ChoreState) => {
    const status = statusText(s);
    const doneToday = s.last?.done_on === props.today;
    const who = s.last?.member_id ? names.get(s.last.member_id) : null;
    const room = s.chore.room_id ? roomNames.get(s.chore.room_id) : null;
    return (
      <li key={s.chore.id} className="chore">
        <button className="chore-main" onClick={() => props.onOpen(s)} aria-label={`${s.chore.name} details`}>
          <div className="chore-name">
            {s.chore.name}
            {room && active !== s.chore.room_id && <span className="room-tag">{room}</span>}
          </div>
          <div className={`chore-status tone-${status.tone}`}>
            {status.text}
            {s.turn && (
              <span className={`turn-pill${s.turn === props.meId ? ' mine' : ''}`}>
                {s.turn === props.meId ? 'Your turn' : `${names.get(s.turn)}'s turn`}
              </span>
            )}
          </div>
          <div className="chore-meta">
            {s.last
              ? <>Last done {agoLabel(diffDays(props.today, s.last.done_on))}{who ? ` by ${who}` : ''}</>
              : scheduleSummary(scheduleOf(s.chore))}
            {s.last?.note && <span className="chore-note"> · “{s.last.note}”</span>}
          </div>
        </button>
        <button className={`done-btn${doneToday ? ' is-done' : ''}${props.locked.has(s.chore.id) ? ' is-locked' : ''}`}
          onClick={() => props.onDone(s)} aria-label={`Mark ${s.chore.name} done`}
          aria-disabled={props.locked.has(s.chore.id)}>
          <Icon name="check" size={20} />
          <span>Done</span>
        </button>
      </li>
    );
  };

  return (
    <div className="chores">
      {showChips && (
        <div className="filter-chips" role="tablist" aria-label="Filter chores">
          <button role="tab" aria-selected={active === 'all'} className={active === 'all' ? 'on' : ''}
            onClick={() => setFilter('all')}>All</button>
          {hasTurns && (
            <button role="tab" aria-selected={active === 'mine'} className={active === 'mine' ? 'on' : ''}
              onClick={() => setFilter('mine')}>My turn</button>
          )}
          {usedRooms.map((r) => (
            <button key={r.id} role="tab" aria-selected={active === r.id} className={active === r.id ? 'on' : ''}
              onClick={() => setFilter(r.id)}>{r.name}</button>
          ))}
        </div>
      )}
      {todo.length > 0 && (
        <section>
          <h3 className="section-title">Needs doing <span className="count">{todo.length}</span></h3>
          <ul className="chore-list">{todo.map(row)}</ul>
        </section>
      )}
      {todo.length === 0 && <div className="all-clear"><Icon name="check" /> All caught up</div>}
      {later.length > 0 && (
        <section>
          <h3 className="section-title">Coming up</h3>
          <ul className="chore-list">{later.map(row)}</ul>
        </section>
      )}
      <button className="btn ghost add-chore" onClick={props.onAddChore}>
        <Icon name="plus" size={18} /> Add chore
      </button>
    </div>
  );
}
