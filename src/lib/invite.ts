import type { Household } from './types';

/** Link that opens the app with the apartment's join code already filled in. */
export function inviteLink(household: Household): string {
  return `${location.origin}${location.pathname}?join=${household.join_code}`;
}

/**
 * Opens the phone's share sheet (Messages, WhatsApp, …) with an invite, or copies it
 * where sharing isn't available. Returns what happened so the caller can say so.
 */
export async function shareInvite(household: Household): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const link = inviteLink(household);
  const text = `Join "${household.name}" on Chores! Tap the link, or enter code ${household.join_code}.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Join our apartment on Chores', text, url: link });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Some browsers refuse to share; fall through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${link}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
