import { useMemo, useState } from 'react';
import { formatDay } from '../lib/dates';
import type { Chore, Completion, Member } from '../lib/types';
import { Icon, memberColors } from '../components/ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');

export function CalendarTab(props: {
  completions: Completion[];
  chores: Chore[];
  members: Member[];
  today: string;
  onEdit: (c: Completion) => void;
  onLog: (date: string) => void;
}) {
  const [month, setMonth] = useState(() => props.today.slice(0, 7)); // "YYYY-MM"
  const [selected, setSelected] = useState(props.today);

  const colors = useMemo(() => memberColors(props.members), [props.members]);
  const choreNames = useMemo(() => new Map(props.chores.map((c) => [c.id, c.name])), [props.chores]);
  const memberNames = useMemo(() => new Map(props.members.map((m) => [m.id, m.name])), [props.members]);

  const byDay = useMemo(() => {
    const map = new Map<string, Completion[]>();
    for (const c of props.completions) {
      const list = map.get(c.done_on);
      if (list) list.push(c);
      else map.set(c.done_on, [c]);
    }
    for (const list of map.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return map;
  }, [props.completions]);

  const [y, m] = month.split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const goToday = () => {
    setMonth(props.today.slice(0, 7));
    setSelected(props.today);
  };

  const dayEntries = byDay.get(selected) ?? [];
  const activeMembers = props.members.filter((mm) => !mm.archived);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="left" /></button>
        <div className="cal-title">{formatDay(`${month}-01`, { month: 'long', year: 'numeric' })}</div>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month"><Icon name="right" /></button>
        {(month !== props.today.slice(0, 7) || selected !== props.today) && (
          <button className="btn small" onClick={goToday}>Today</button>
        )}
      </div>

      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((d, i) => <div key={i} className="cal-weekday">{d}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="cal-cell empty" />;
          const entries = byDay.get(day) ?? [];
          const cls = ['cal-cell', day === props.today && 'is-today', day === selected && 'is-selected',
            day > props.today && 'is-future'].filter(Boolean).join(' ');
          return (
            <button key={i} className={cls} onClick={() => setSelected(day)}
              aria-label={`${formatDay(day, { month: 'long', day: 'numeric' })}, ${entries.length} done`}>
              <span className="cal-num">{Number(day.slice(8))}</span>
              <span className="cal-dots">
                {entries.slice(0, 4).map((e) => (
                  <i key={e.id} style={{ background: (e.member_id && colors.get(e.member_id)) || 'var(--muted)' }} />
                ))}
                {entries.length > 4 && <b>+</b>}
              </span>
            </button>
          );
        })}
      </div>

      {activeMembers.length > 1 && (
        <div className="legend">
          {activeMembers.map((mm) => (
            <span key={mm.id}><i style={{ background: colors.get(mm.id) }} />{mm.name}</span>
          ))}
        </div>
      )}

      <section className="day-panel">
        <h3 className="section-title">
          {selected === props.today ? 'Today' : formatDay(selected, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h3>
        {dayEntries.length === 0 && <p className="muted">Nothing logged{selected > props.today ? ' yet' : ''}.</p>}
        <ul className="entry-list">
          {dayEntries.map((e) => (
            <li key={e.id}>
              <button className="entry" onClick={() => props.onEdit(e)}>
                <i className="dot" style={{ background: (e.member_id && colors.get(e.member_id)) || 'var(--muted)' }} />
                <span className="entry-text">
                  <span className="entry-chore">{choreNames.get(e.chore_id) ?? 'Deleted chore'}</span>
                  <span className="entry-who">{(e.member_id && memberNames.get(e.member_id)) || 'Someone'}</span>
                  {e.note && <span className="entry-note">“{e.note}”</span>}
                </span>
                <span className="entry-edit">Edit</span>
              </button>
            </li>
          ))}
        </ul>
        {selected <= props.today && (
          <button className="btn ghost" onClick={() => props.onLog(selected)}>
            <Icon name="plus" size={18} /> Log a chore on this day
          </button>
        )}
      </section>
    </div>
  );
}
