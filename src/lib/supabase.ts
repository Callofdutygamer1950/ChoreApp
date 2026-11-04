import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
);

let sessionPromise: Promise<void> | null = null;

/** Each phone gets its own anonymous login the first time; it's remembered after that. */
export function ensureSession(): Promise<void> {
  sessionPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  })().catch((e) => {
    sessionPromise = null; // allow a retry
    throw e;
  });
  return sessionPromise;
}
