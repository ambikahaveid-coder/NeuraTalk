const CACHE_NAME = 'neuratalk-v1';
const STATIC_CACHE = 'neuratalk-static-v1';
const DYNAMIC_CACHE = 'neuratalk-dynamic-v1';

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png'
];

const CACHE_STRATEGIES = {
  cacheFirst: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  networkFirst: ['/api/'],
  staleWhileRevalidate: ['.js', '.css', '.png', '.jpg', '.svg']
};

self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  if (url.pathname === '/sw.js' || url.pathname.includes('hot-update')) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (CACHE_STRATEGIES.cacheFirst.some(domain => url.hostname.includes(domain))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      const cache = caches.open(DYNAMIC_CACHE);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

self.addEventListener('push', (event) => {
  let data = { type: 'generic', title: 'NeuraTalk', body: 'New notification' };

  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch (e) { data.body = event.data.text(); }
  }

  // Incoming call — show with Answer + Reject buttons
  if (data.type === 'incoming_call') {
    const callerName = data.callerName || data.callerId || 'Unknown';
    const callType = data.callType === 'video' ? '📹 Video' : '📞 Voice';
    const options = {
      body: `${callType} call — tap to answer`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: `incoming-call-${data.callId}`,
      renotify: true,
      requireInteraction: true,          // stays on screen until user acts
      data: { callId: data.callId, url: `/calls/c2c?incoming=1` },
      actions: [
        { action: 'answer', title: '✅ Answer' },
        { action: 'reject', title: '❌ Reject' },
      ],
    };
    event.waitUntil(self.registration.showNotification(`📲 ${callerName}`, options));
    return;
  }

  // Generic notification
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};

  if (event.action === 'reject') {
    // Tell the app to reject this call if it's running
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          client.postMessage({ type: 'REJECT_INCOMING_CALL', callId: notifData.callId });
        }
      })
    );
    return;
  }

  const urlToOpen = notifData.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If app is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'INCOMING_CALL_ANSWER', callId: notifData.callId });
          return client.navigate(urlToOpen).then(() => client.focus());
        }
      }
      // App not open — open it
      return clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting and activate new service worker');
    self.skipWaiting().then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach(client => {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    });
  }
});
