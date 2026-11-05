import { useMemo, useState } from 'react';
import { Icon } from './ui';
import { formatDay } from '../lib/dates';
import type { Chore, Completion, Member } from '../lib/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** How many chores each person did in a month. A fairness check, not a points system. */
export function MonthlySummary(props: {
  completions: Completion[];
  chores: Chore[];
  members: Member[];
  colors: Map<string, string>;
  today: string;
}) {
  const [month, setMonth] = useState(props.today.slice(0, 7));
  const [y, m] = month.split('-').map(Number);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  const data = useMemo(() => {
    const inMonth = props.completions.filter((c) => c.done_on.startsWith(month));
    const perPerson = new Map<string, number>();
    const perChore = new Map<string, Map<string, number>>();
    for (const c of inMonth) {
      const who = c.member_id ?? '';
      perPerson.set(who, (perPerson.get(who) ?? 0) + 1);
      let row = perChore.get(c.chore_id);
      if (!row) perChore.set(c.chore_id, (row = new Map()));
      row.set(who, (row.get(who) ?? 0) + 1);
    }
    return { total: inMonth.length, perPerson, perChore };
  }, [props.completions, month]);

  // Everyone active, plus anyone (e.g. who has since left) who did something this month.
  const people = props.members.filter((p) => !p.archived || data.perPerson.has(p.id));
  const rows = people
    .map((p) => ({ id: p.id, name: p.name, count: data.perPerson.get(p.id) ?? 0 }))
    .concat(data.perPerson.has('') ? [{ id: '', name: 'Someone', count: data.perPerson.get('')! }] : [])
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((r) => r.count));
  const choreName = new Map(props.chores.map((c) => [c.id, c.name]));
  const choreRows = [...data.perChore.entries()]
    .map(([id, byPerson]) => ({ id, name: choreName.get(id) ?? 'Deleted chore', byPerson, total: [...byPerson.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const isCurrent = month === props.today.slice(0, 7);

  return (
    <div className="summary-view">
      <div className="cal-head">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="left" /></button>
        <div className="cal-title">{formatDay(`${month}-01`, { month: 'long', year: 'numeric' })}</div>
        <button className="icon-btn" onClick={() => shift(1)} disabled={isCurrent} aria-label="Next month"><Icon name="right" /></button>
        {!isCurrent && <button className="btn small" onClick={() => setMonth(props.today.slice(0, 7))}>This month</button>}
      </div>

      <div className="card summary-card">
        <div className="summary-total">
          <strong>{data.total}</strong> {data.total === 1 ? 'chore' : 'chores'} done{isCurrent ? ' so far' : ''}
        </div>
        {rows.map((r) => (
          <div key={r.id || 'someone'} className="summary-row">
            <span className="summary-name"><i className="dot" style={{ background: props.colors.get(r.id) ?? 'var(--muted)' }} />{r.name}</span>
            <span className="summary-bar">
              <i style={{ width: `${(r.count / max) * 100}%`, background: props.colors.get(r.id) ?? 'var(--muted)' }} />
            </span>
            <span className="summary-count">{r.count}</span>
          </div>
        ))}
      </div>

      {choreRows.length > 0 && (
        <section>
          <h3 className="section-title">By chore</h3>
          <div className="card rows">
            {choreRows.map((c) => (
              <div key={c.id} className="row-item by-chore">
                <span className="by-chore-name">{c.name}</span>
                <span className="by-chore-people">
                  {[...c.byPerson.entries()].sort((a, b) => b[1] - a[1]).map(([who, n]) => (
                    <span key={who || 'someone'} className="by-chore-chip">
                      <i className="dot" style={{ background: props.colors.get(who) ?? 'var(--muted)' }} />{n}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {data.total === 0 && <p className="empty-small muted">Nothing logged this month{isCurrent ? ' yet' : ''}.</p>}
    </div>
  );
}
