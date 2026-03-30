const CACHE_NAME = 'moneymanager-v4';

// Solo risorse locali durante install - le CDN vengono cachate al primo accesso
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Non intercettare le API calls Supabase - devono sempre andare in rete
  if (url.hostname.includes('supabase.co') ||
      url.pathname.includes('/rest/') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/storage/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          console.log('[SW] Cache hit:', event.request.url);

          // Stale-while-revalidate solo per risorse locali
          if (url.hostname === self.location.hostname) {
            fetch(event.request).then(response => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
              }
            }).catch(() => {});
          }

          return cachedResponse;
        }

        // Cache miss - vai in rete e cacha il risultato
        console.log('[SW] Fetching:', event.request.url);
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          // Cacha risorse locali e CDN noti
          const shouldCache =
            url.hostname === self.location.hostname ||
            url.hostname.includes('tailwindcss.com') ||
            url.hostname.includes('jsdelivr.net');

          if (shouldCache) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }

          return response;
        }).catch(() => {
          // Offline e non in cache: restituisce index.html per navigazione
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
