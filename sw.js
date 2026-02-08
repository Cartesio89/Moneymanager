const CACHE_NAME = 'moneymanager-v3';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching files');
        return cache.addAll(urlsToCache);
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
  // Solo cacha GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          console.log('[SW] Cache hit:', event.request.url);
          return response;
        }
        
        console.log('[SW] Fetching:', event.request.url);
        return fetch(event.request).then(response => {
          // Solo cacha risposte valide
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          // Clona la risposta
          const responseToCache = response.clone();
          
          // Cacha solo se è del nostro dominio o CDN noti
          const url = event.request.url;
          if (url.includes('github.io') || 
              url.includes('tailwindcss.com') || 
              url.includes('supabase')) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }

          return response;
        }).catch(() => {
          // Se offline e non in cache, mostra l'index.html
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
