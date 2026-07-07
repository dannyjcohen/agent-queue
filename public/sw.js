// Agent Queue — Service Worker
// Handles web push notifications and notification click routing.
// Keep this file minimal: no caching strategy needed for this app
// (it's a live-data UI, stale caches cause confusion).

self.addEventListener('install', () => {
  // Skip waiting so the new SW activates immediately on update.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all open clients so push events are handled by this SW version.
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// Push event — fired when the server sends a push message.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = { title: 'Agent Queue', body: 'Claude is waiting for input.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  const title = data.title || 'Agent Queue';
  const options = {
    body: data.body || 'Claude is waiting for input.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'agent-queue-waiting',
    // Replace previous notification with same tag so you don't stack up
    renotify: true,
    data: {
      url: data.url || '/waiting',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification click — open or focus /waiting tab.
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/waiting';
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // If a /waiting tab is already open, focus it.
        for (const client of clients) {
          if (client.url === absoluteUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow(absoluteUrl);
        }
      })
  );
});
