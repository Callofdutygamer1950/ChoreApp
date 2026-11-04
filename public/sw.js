// Service worker: makes the app installable and shows reminder notifications.
// (No offline caching: the app needs the shared database to be useful.)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Chores', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'chore-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if ('focus' in w) return w.focus();
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
