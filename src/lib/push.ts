import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushSupport = 'ok' | 'not-configured' | 'needs-install' | 'unsupported';

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'not-configured';
  // iPhones only allow web notifications for apps added to the Home Screen.
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  return 'ok';
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function save(sub: PushSubscription, hour: number) {
  const keys = sub.toJSON().keys ?? {};
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh ?? '',
    p_auth: keys.auth ?? '',
    p_hour: hour,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (error) throw new Error(error.message);
}

/** Current reminder hour for this phone, or null if reminders are off. */
export async function currentReminder(): Promise<number | null> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return null;
  const { data } = await supabase
    .from('push_subscriptions')
    .select('reminder_hour')
    .eq('endpoint', sub.endpoint)
    .maybeSingle();
  if (data) return data.reminder_hour as number;
  // The phone is subscribed but the server lost track (e.g. rejoined): re-register at 6 PM.
  await save(sub, 18);
  return 18;
}

export async function enableReminders(hour: number) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for this app in your phone settings, then try again.');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY!) }));
  await save(sub, hour);
}

export async function setReminderHour(hour: number) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await save(sub, hour);
}

export async function disableReminders() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
