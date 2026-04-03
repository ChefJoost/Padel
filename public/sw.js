/* Service Worker — PadelPotje Push Notifications */

self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Alleen relatieve paden toestaan — voorkomt javascript:/data: URLs
  const rawUrl = event.notification.data?.url || '/';
  const url = rawUrl.startsWith('/') ? rawUrl : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
