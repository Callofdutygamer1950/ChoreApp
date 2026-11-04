// Checks the chore schedule rules. Run: npm run test:schedule
import { dueInfo, scheduleSummary, type Schedule } from '../supabase/functions/_shared/schedule.ts';

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     expected ${JSON.stringify(expected)}\n     got      ${JSON.stringify(actual)}`}`);
}
const due = (s: Schedule, last: string | null, today: string, times = last ? 1 : 0) => dueInfo(s, last, times, today);

// 2027-01-01 is a Friday.
const fridays: Schedule = { kind: 'repeat', freq: 'week', every: 1, start: '2027-01-01', weekdays: [5] };
check('weekly Fri, never done -> first Friday', due(fridays, null, '2026-12-30').due, '2027-01-01');
check('weekly Fri, done on Fri -> next Fri', due(fridays, '2027-01-08', '2027-01-08').due, '2027-01-15');
check('weekly Fri, done Thu (early) -> Fri after', due(fridays, '2027-01-07', '2027-01-07').due, '2027-01-15');
check('weekly Fri, done Sat (late) -> coming Fri', due(fridays, '2027-01-09', '2027-01-09').due, '2027-01-15');
check('weekly Fri, done Tue (early, nearer next) -> covers next Fri', due(fridays, '2027-01-12', '2027-01-12').due, '2027-01-22');
check('weekly Fri, done Mon (nearer last Fri) -> coming Fri', due(fridays, '2027-01-11', '2027-01-11').due, '2027-01-15');

const biweekly: Schedule = { kind: 'repeat', freq: 'week', every: 2, start: '2027-01-01', weekdays: [1, 5] };
check('every 2 weeks Mon+Fri, never done', due(biweekly, null, '2027-01-01').due, '2027-01-01');
check('every 2 weeks Mon+Fri, done Fri wk0 -> Mon wk2', due(biweekly, '2027-01-01', '2027-01-01').due, '2027-01-11');
check('every 2 weeks Mon+Fri, done Mon wk2 -> Fri wk2', due(biweekly, '2027-01-11', '2027-01-11').due, '2027-01-15');

const daily: Schedule = { kind: 'repeat', freq: 'day', every: 1, start: '2027-01-01' };
check('daily, done today -> tomorrow', due(daily, '2027-01-05', '2027-01-05').due, '2027-01-06');
check('daily, done 3 days ago -> overdue (2 days ago)', due(daily, '2027-01-02', '2027-01-05').due, '2027-01-03');

const firstFri: Schedule = { kind: 'repeat', freq: 'month', every: 1, start: '2027-01-01', monthly: 'nth' };
check('monthly first Friday -> Feb 5', due(firstFri, '2027-01-01', '2027-01-01').due, '2027-02-05');
const lastFri: Schedule = { kind: 'repeat', freq: 'month', every: 1, start: '2027-01-29', monthly: 'last' };
check('monthly last Friday -> Feb 26', due(lastFri, '2027-01-29', '2027-01-29').due, '2027-02-26');
const day31: Schedule = { kind: 'repeat', freq: 'month', every: 1, start: '2027-01-31', monthly: 'day' };
check('monthly on day 31 -> Feb 28 in February', due(day31, '2027-01-31', '2027-01-31').due, '2027-02-28');
const yearly: Schedule = { kind: 'repeat', freq: 'year', every: 1, start: '2027-01-01' };
check('annually -> next Jan 1', due(yearly, '2027-01-01', '2027-01-01').due, '2028-01-01');
const weekdays: Schedule = { kind: 'repeat', freq: 'week', every: 1, start: '2027-01-01', weekdays: [1, 2, 3, 4, 5] };
check('every weekday, done Fri -> Mon', due(weekdays, '2027-01-08', '2027-01-08').due, '2027-01-11');

const endsOn: Schedule = { ...fridays, ends: { type: 'on', date: '2027-01-15' } } as Schedule;
check('ends on Jan 15, done Jan 8 -> Jan 15 still due', due(endsOn, '2027-01-08', '2027-01-08'), { due: '2027-01-15', finished: false });
check('ends on Jan 15, done Jan 15 -> finished', due(endsOn, '2027-01-15', '2027-01-15'), { due: null, finished: true });
const endsCount: Schedule = { ...fridays, ends: { type: 'count', count: 3 } } as Schedule;
check('ends after 3 times, done 2 -> not finished', due(endsCount, '2027-01-08', '2027-01-08', 2).finished, false);
check('ends after 3 times, done 3 -> finished', due(endsCount, '2027-01-15', '2027-01-15', 3).finished, true);

const once: Schedule = { kind: 'once', date: '2027-01-10' };
check('one-time, not done', due(once, null, '2027-01-05'), { due: '2027-01-10', finished: false });
check('one-time, done -> finished', due(once, '2027-01-06', '2027-01-06').finished, true);

const after: Schedule = { kind: 'after', days: 3 };
check('3 days after done', due(after, '2027-01-05', '2027-01-05').due, '2027-01-08');
check('after, never done -> null (Never done)', due(after, null, '2027-01-05'), { due: null, finished: false });
check('done before a schedule start counts as never done', due(fridays, '2026-12-01', '2026-12-30').due, '2027-01-01');

check('summary weekly', scheduleSummary(fridays), 'Weekly on Friday');
check('summary biweekly', scheduleSummary(biweekly), 'Every 2 weeks on Mon, Fri');
check('summary first Fri', scheduleSummary(firstFri), 'Monthly on the first Friday');
check('summary ends', scheduleSummary(endsOn), 'Weekly on Friday, until Jan 15');
check('summary count', scheduleSummary(endsCount), 'Weekly on Friday, 3 times');
check('summary after', scheduleSummary(after), '3 days after last done');
check('summary after 1 wk', scheduleSummary({ kind: 'after', days: 7 }), '1 week after last done');
check('summary weekdays', scheduleSummary(weekdays), 'Every weekday');

console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
process.exit(failed ? 1 : 0);
