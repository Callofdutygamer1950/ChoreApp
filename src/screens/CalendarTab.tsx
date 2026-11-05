import { useMemo, useState } from 'react';
import { formatDay } from '../lib/dates';
import { planDays, type PlanItem } from '../lib/calendarPlan';
import type { ChoreState } from '../lib/status';
import type { Chore, Completion, Member, Room } from '../lib/types';
import { Icon, memberColors } from '../components/ui';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const pad = (n: number) => String(n).padStart(2, '0');
const KIND_LABEL: Record<PlanItem['kind'], string> = { due: 'Due', overdue: 'Overdue', missed: 'Missed' };

export function CalendarTab(props: {
  completions: Completion[];
  chores: Chore[];
  states: ChoreState[];
  members: Member[];
  rooms: Room[];
  meId: string;
  today: string;
  onEdit: (c: Completion) => void;
  onLog: (date: string) => void;
  onOpenChore: (choreId: string) => void;
}) {
  const [month, setMonth] = useState(() => props.today.slice(0, 7)); // "YYYY-MM"
  const [selected, setSelected] = useState(props.today);

  const colors = useMemo(() => memberColors(props.members), [props.members]);
  const choreNames = useMemo(() => new Map(props.chores.map((c) => [c.id, c.name])), [props.chores]);
  const memberNames = useMemo(() => new Map(props.members.map((m) => [m.id, m.name])), [props.members]);
  const roomNames = useMemo(() => new Map(props.rooms.map((r) => [r.id, r.name])), [props.rooms]);
  const turnByChore = useMemo(() => new Map(props.states.map((s) => [s.chore.id, s.turn])), [props.states]);

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
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${pad(daysInMonth)}`;
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${pad(i + 1)}`),
  ];
  while (cells.length % 7) cells.push(null);

  const plan = useMemo(
    () => planDays(props.chores, props.states, props.completions, monthStart, monthEnd, props.today),
    [props.chores, props.states, props.completions, monthStart, monthEnd, props.today],
  );

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const goToday = () => {
    setMonth(props.today.slice(0, 7));
    setSelected(props.today);
  };

  const dayEntries = byDay.get(selected) ?? [];
  const dayPlan = (plan.get(selected) ?? []).sort((a, b) =>
    order(a.kind) - order(b.kind) || a.chore.name.localeCompare(b.chore.name));
  const activeMembers = props.members.filter((mm) => !mm.archived);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="left" /></button>
        <div className="cal-title">{formatDay(monthStart, { month: 'long', year: 'numeric' })}</div>
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
          const planned = plan.get(day) ?? [];
          const missed = planned.filter((p) => p.kind === 'missed');
          const due = planned.filter((p) => p.kind !== 'missed');
          const marks = [
            ...missed.map((p) => <i key={`m${p.chore.id}`} className="ring missed" />),
            ...due.map((p) => <i key={`d${p.chore.id}`} className="ring" />),
            ...entries.map((e) => (
              <i key={e.id} style={{ background: (e.member_id && colors.get(e.member_id)) || 'var(--muted)' }} />
            )),
          ];
          const cls = ['cal-cell', day === props.today && 'is-today', day === selected && 'is-selected',
            day > props.today && 'is-future'].filter(Boolean).join(' ');
          const parts = [
            entries.length && `${entries.length} done`, due.length && `${due.length} due`, missed.length && `${missed.length} missed`,
          ].filter(Boolean).join(', ');
          return (
            <button key={i} className={cls} onClick={() => setSelected(day)}
              aria-label={`${formatDay(day, { month: 'long', day: 'numeric' })}${parts ? `, ${parts}` : ''}`}>
              <span className="cal-num">{Number(day.slice(8))}</span>
              <span className="cal-dots">
                {marks.slice(0, 4)}
                {marks.length > 4 && <b>+</b>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="legend">
        <span><i className="ring" />Due</span>
        <span><i className="ring missed" />Missed</span>
        {activeMembers.length > 1
          ? activeMembers.map((mm) => <span key={mm.id}><i style={{ background: colors.get(mm.id) }} />{mm.name}</span>)
          : <span><i style={{ background: 'var(--accent)' }} />Logged</span>}
      </div>

      <section className="day-panel">
        <h3 className="section-title">
          {selected === props.today ? 'Today' : formatDay(selected, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h3>

        {dayPlan.length > 0 && (
          <ul className="entry-list">
            {dayPlan.map((p) => {
              const turn = p.kind !== 'missed' ? turnByChore.get(p.chore.id) : null;
              const room = p.chore.room_id ? roomNames.get(p.chore.room_id) : null;
              return (
                <li key={`${p.kind}-${p.chore.id}`}>
                  <button className={`entry plan-${p.kind}`} onClick={() => props.onOpenChore(p.chore.id)}>
                    <i className={`ring ${p.kind === 'missed' ? 'missed' : ''}`} />
                    <span className="entry-text">
                      <span className="entry-chore">{p.chore.name}{room && <span className="room-tag">{room}</span>}</span>
                      <span className="entry-who">
                        <span className={`plan-label ${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                        {turn && ` · ${turn === props.meId ? 'Your turn' : `${memberNames.get(turn)}'s turn`}`}
                      </span>
                    </span>
                    <span className="entry-edit">Open</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {dayEntries.length > 0 && (
          <>
            <h4 className="logged-label">Logged</h4>
            <ul className="entry-list logged">
              {dayEntries.map((e) => (
                <li key={e.id}>
                  <button className="entry" onClick={() => props.onEdit(e)}>
                    <i className="dot" style={{ background: (e.member_id && colors.get(e.member_id)) || 'var(--muted)' }} />
                    <span className="entry-text">
                      <span className="entry-chore"><Icon name="check" size={14} /> {choreNames.get(e.chore_id) ?? 'Deleted chore'}</span>
                      <span className="entry-who">{(e.member_id && memberNames.get(e.member_id)) || 'Someone'}</span>
                      {e.note && <span className="entry-note">“{e.note}”</span>}
                    </span>
                    <span className="entry-edit">Edit</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {dayPlan.length === 0 && dayEntries.length === 0 && (
          <p className="muted">{selected > props.today ? 'Nothing due.' : 'Nothing logged.'}</p>
        )}

        {selected <= props.today && (
          <button className="btn ghost" onClick={() => props.onLog(selected)}>
            <Icon name="plus" size={18} /> Log a chore on this day
          </button>
        )}
      </section>
    </div>
  );
}

const order = (k: PlanItem['kind']) => (k === 'overdue' ? 0 : k === 'missed' ? 1 : 2);
