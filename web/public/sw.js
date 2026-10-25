// SIMUB · service worker: recibe los avisos del servidor y los muestra.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'SIMUB', {
    body: d.cuerpo || '',
    icon: 'icon-192.png',
    badge: 'favicon.png',
    tag: d.etiqueta || 'simub',
    renotify: true,
    data: { url: d.url || '#/mis' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data.url, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    for (const v of ventanas) { if (v.url.startsWith(self.registration.scope)) { v.navigate(destino); return v.focus(); } }
    return self.clients.openWindow(destino);
  }));
});
