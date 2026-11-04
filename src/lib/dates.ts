// All chore dates are plain calendar days ("YYYY-MM-DD") in the phone's local time.
// Day math is done on whole-day numbers so daylight-saving changes never shift a date.

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayStr = () => toDateStr(new Date());

export function dayNum(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNum(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const addDays = (s: string, n: number) => fromDayNum(dayNum(s) + n);
export const diffDays = (a: string, b: string) => dayNum(a) - dayNum(b);

export function formatDay(s: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(dayNum(s) * DAY_MS).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
}

export function agoLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function intervalLabel(n: number): string {
  if (n === 1) return 'Every day';
  if (n === 7) return 'Every week';
  if (n % 7 === 0) return `Every ${n / 7} weeks`;
  return `Every ${n} days`;
}

export function hourLabel(h: number): string {
  return new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export { plural };
