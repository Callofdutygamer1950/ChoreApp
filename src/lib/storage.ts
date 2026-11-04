// localStorage can be missing or throw (private mode, cleared data), so every access is guarded.
export function getItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function setItem(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
export function removeItem(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for non-secure contexts (e.g. testing over plain http on the LAN).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
