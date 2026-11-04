import { agoLabel, diffDays } from '../lib/dates';
import { scheduleOf, scheduleSummary } from '../lib/schedule';
import { needsDoing, statusText, type ChoreState } from '../lib/status';
import type { Member } from '../lib/types';
import { Icon } from '../components/ui';

export function ChoresTab(props: {
  states: ChoreState[];
  members: Member[];
  today: string;
  onDone: (s: ChoreState) => void;
  onAddChore: () => void;
  /** Chores that were just marked done and can't be marked again yet. */
  locked: Map<string, number>;
}) {
  const { states } = props;
  const names = new Map(props.members.map((m) => [m.id, m.name]));

  if (states.length === 0) {
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
    return (
      <li key={s.chore.id} className="chore">
        <div className="chore-main">
          <div className="chore-name">{s.chore.name}</div>
          <div className={`chore-status tone-${status.tone}`}>{status.text}</div>
          <div className="chore-meta">
            {s.last
              ? <>Last done {agoLabel(diffDays(props.today, s.last.done_on))}{who ? ` by ${who}` : ''}</>
              : scheduleSummary(scheduleOf(s.chore))}
            {s.last?.note && <span className="chore-note"> · “{s.last.note}”</span>}
          </div>
        </div>
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
