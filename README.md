# Chores

A small shared chore tracker for an apartment. Each chore has a repeat interval, and the list shows what's
overdue, who did it last, and when. A shared calendar shows every completion, and anyone can edit,
backdate, or undo entries. There are no points and no passwords: each phone joins the apartment once with a
6-character join code, and you pick your name.

It's an installable web app (PWA). It runs on iPhone and Android with no app store, and the data lives in
Supabase.

## Project layout

| Path | What it is |
| --- | --- |
| `src/` | The React app (screens in `src/screens`, data/logic in `src/lib`) |
| `public/sw.js` | Service worker: install support and reminder notifications |
| `supabase/schema.sql` | Database tables and security rules (already run) |
| `supabase/functions/send-reminders/` | Hourly job that sends "chores need doing" notifications |
| `supabase/reminders.sql` | Schedules that job (template; `reminders.secret.sql` is the filled-in private copy) |
| `.env` | Public settings baked into the app (Supabase URL, publishable key, push public key) |
| `.env.secrets` | **Private** push and cron keys. Git-ignored; never share it |

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try it on a phone on the same Wi-Fi, open the "Network" address Vite prints.
Installing and notifications only work once the app is hosted on https (see below).

## Setup checklist

1. ✅ Run `supabase/schema.sql` in the Supabase SQL Editor, then each file in `supabase/migrations/` in order.
2. ✅ Turn on **Authentication → Sign In / Providers → Allow anonymous sign-ins**.
3. ✅ **Deploy the functions** (done; repeat after changing them). This needs the Supabase CLI login, which opens your browser:

   ```bash
   npx supabase login
   npx supabase functions deploy send-reminders --remote=bhvpkternndtyvvuwqda --no-verify-jwt --use-api
   npx supabase functions deploy import-recipe --remote=bhvpkternndtyvvuwqda --no-verify-jwt --use-api
   npx supabase secrets set --env-file .env.secrets --remote=bhvpkternndtyvvuwqda
   ```

   ✅ Then paste `supabase/reminders.secret.sql` into the SQL Editor and click **Run**. This schedules the
   hourly check.
4. **Hosting:** the app is published at https://callofdutygamer1950.github.io/ChoreApp/ by
   `.github/workflows/deploy.yml` on every push to `main` (repo Settings → Pages → Source: GitHub Actions).
5. Set the push "contact" to the site URL (Apple requires a valid one):

   ```bash
   npx supabase secrets set VAPID_SUBJECT=https://callofdutygamer1950.github.io/ChoreApp/ --project-ref bhvpkternndtyvvuwqda
   ```

## Installing on phones

* **iPhone (Safari):** open the site → Share → **Add to Home Screen** → open it from the Home Screen,
  *then* enter the join code. The Home Screen app keeps its own storage, so joining in Safari first
  means joining twice. Reminders need iOS 16.4 or newer.
* **Android (Chrome):** open the site → menu ⋮ → **Install app** (or "Add to Home screen") → join.

Each person turns reminders on under **Settings → Reminders** and picks their own time (default 6 PM).
Reminders only go out on days when something is due or overdue.

## Testing reminders

Send a notification to every subscribed phone right now. Use the CRON_SECRET value from `.env.secrets`:

```bash
curl -X POST "https://bhvpkternndtyvvuwqda.supabase.co/functions/v1/send-reminders?force=1" -H "x-cron-secret: YOUR_CRON_SECRET"
```

## Removing an apartment

To delete an apartment and all its chores and history, run this in the SQL Editor with its join code:

```sql
delete from public.households where join_code = 'ABC123';
```

Any phone that was in it will show the join screen again.

## Recipe import

Works with most recipe sites (it reads the recipe data they publish for Google). Some big publishers, like Allrecipes, Simply Recipes and Serious Eats, block automated requests, and the app says so.
