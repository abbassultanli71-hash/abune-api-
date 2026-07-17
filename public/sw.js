// ─── Service Worker: Abunəm Push Notifications + Cancel Subscription Action ───

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming push messages (from server-sent push in future)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch (e) { data = { body: event.data.text() }; }
  }

  const title = data.title || 'Abunəm';
  const options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [100, 50, 100],
    actions: data.abunelikId ? [
      { action: 'cancel_sub', title: 'Abunəliyi Ləğv Et ❌' },
      { action: 'dismiss',    title: 'Bağla' }
    ] : [],
    data: {
      abunelikId: data.abunelikId || null,
      token:      data.token      || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification Click Handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // ── "Cancel Subscription" action button clicked ────────────────────────────
  if (event.action === 'cancel_sub') {
    const { abunelikId, token } = event.notification.data || {};

    if (abunelikId && token) {
      event.waitUntil(
        fetch(`/api/abunelikler/${abunelikId}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        })
        .then(async (res) => {
          if (res.ok) {
            // ✅ Success notification
            await self.registration.showNotification('Abunəlik Ləğv Edildi ✅', {
              body: 'Abunəliyiniz uğurla sistemdən silindi.',
              icon: '/favicon.ico',
              badge: '/favicon.ico',
              vibrate: [200, 100, 200]
            });

            // 🔄 Tell all open app tabs to refresh their data
            const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
            clientList.forEach(client => {
              client.postMessage({ action: 'refresh_data' });
            });
          } else {
            await self.registration.showNotification('Xəta Baş Verdi ⚠️', {
              body: 'Abunəliyi ləğv etmək mümkün olmadı. Tətbiqi açıb yenidən cəhd edin.',
              icon: '/favicon.ico'
            });
          }
        })
        .catch(async () => {
          await self.registration.showNotification('Bağlantı Xətası 📡', {
            body: 'İnternet bağlantısı yoxdur. Tətbiqi açıb yenidən cəhd edin.',
            icon: '/favicon.ico'
          });
        })
      );
      return;
    }
  }

  // ── "Dismiss" action or bare notification tap ──────────────────────────────
  // Find an already-open /app tab and focus it; otherwise open /app fresh
  const APP_URL = '/app';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Look for a tab that is already on the /app page
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.pathname === APP_URL || url.pathname.startsWith(APP_URL)) {
          return client.focus();
        }
      }
      // No /app tab open — open a fresh one
      return clients.openWindow(APP_URL);
    })
  );
});
