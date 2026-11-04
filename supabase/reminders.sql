-- Run this in the Supabase SQL Editor AFTER deploying the send-reminders function.
-- Replace PASTE_CRON_SECRET_HERE with the CRON_SECRET value from the .env.secrets file.
-- It calls the reminder function at the top of every hour.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'chore-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://bhvpkternndtyvvuwqda.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE_CRON_SECRET_HERE'),
    body := '{}'::jsonb
  );
  $$
);

-- To stop reminders later:  select cron.unschedule('chore-reminders');
