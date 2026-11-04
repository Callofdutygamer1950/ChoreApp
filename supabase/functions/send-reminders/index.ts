// Supabase Edge Function: sends each phone a daily push notification listing chores that
// need doing. A pg_cron job calls this every hour (see supabase/reminders.sql); each phone
// is notified once per day, at the hour it picked, in its own time zone.
//
// Call with ?force=1 to send to every phone right now (for testing).

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

interface Sub {
  endpoint: string;
  household_id: string;
  p256dh: string;
  auth: string;
  reminder_hour: number;
  timezone: string;
  last_sent_on: string | null;
}

const DAY_MS = 86_400_000;
const dayNum = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

function localNow(timeZone: string, now: Date) {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'forbidden' }, 403);
  const force = new URL(req.url).searchParams.get('force') === '1';

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:chores@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: subs, error } = await db.from('push_subscriptions').select('*');
  if (error) return json({ error: error.message }, 500);

  // Chores + last-done dates, loaded once per apartment.
  const choreCache = new Map<string, Promise<{ name: string; interval: number; last: string | null }[]>>();
  const loadChores = (householdId: string) => {
    if (!choreCache.has(householdId)) {
      choreCache.set(householdId, (async () => {
        const { data: chores, error: e1 } = await db
          .from('chores').select('id,name,interval_days').eq('household_id', householdId).eq('archived', false);
        if (e1) throw e1;
        const ids = (chores ?? []).map((c) => c.id);
        const { data: last, error: e2 } = ids.length
          ? await db.from('chore_last_done').select('chore_id,last_done').in('chore_id', ids)
          : { data: [], error: null };
        if (e2) throw e2;
        const lastMap = new Map((last ?? []).map((r) => [r.chore_id as string, r.last_done as string]));
        return (chores ?? []).map((c) => ({ name: c.name, interval: c.interval_days, last: lastMap.get(c.id) ?? null }));
      })());
    }
    return choreCache.get(householdId)!;
  };

  const now = new Date();
  const result = { sent: 0, skipped: 0, removed: 0, failed: 0 };

  for (const sub of (subs ?? []) as Sub[]) {
    const local = localNow(sub.timezone, now);
    if (!force && (local.hour !== sub.reminder_hour || sub.last_sent_on === local.date)) {
      result.skipped++;
      continue;
    }

    let due: string[];
    try {
      const chores = await loadChores(sub.household_id);
      const today = dayNum(local.date);
      due = chores
        .filter((c) => c.last === null || dayNum(c.last) + c.interval <= today)
        .map((c) => c.name);
    } catch (e) {
      console.error('load failed', e);
      result.failed++;
      continue;
    }

    if (!force) {
      await db.from('push_subscriptions').update({ last_sent_on: local.date }).eq('endpoint', sub.endpoint);
    }

    let title: string;
    let body: string;
    if (due.length > 0) {
      title = due.length === 1 ? '1 chore needs doing' : `${due.length} chores need doing`;
      body = due.length <= 3 ? due.join(', ') : `${due.slice(0, 3).join(', ')} and ${due.length - 3} more`;
    } else if (force) {
      title = 'Reminders are working';
      body = 'Nothing needs doing right now.';
    } else {
      result.skipped++;
      continue; // nothing due: don't bother anyone
    }

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body }),
        { TTL: 6 * 3600 },
      );
      result.sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The phone unsubscribed or uninstalled the app.
        await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        result.removed++;
      } else {
        console.error('push failed', status, e);
        result.failed++;
      }
    }
  }

  return json(result);
});
