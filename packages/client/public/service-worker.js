self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* use the safe fallback */ }
  const title = typeof data.title === 'string' ? data.title : "It's your turn";
  const options = {
    body: typeof data.body === 'string' ? data.body : 'A game is waiting for your move.',
    tag: typeof data.tag === 'string' ? data.tag : 'tabletop-turn',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = event.notification.data && event.notification.data.url;
  const target = new URL(typeof requested === 'string' ? requested : '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) {
        client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  }));
});
