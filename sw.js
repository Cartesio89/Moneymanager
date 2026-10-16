// MoneyManager Service Worker v6
// - File dell'app: rete per prima (4s di timeout) con fallback sulla cache => dopo un deploy vedi subito la versione nuova, offline funziona comunque
// - Libreria Supabase (CDN): in cache (richiesta CORS, quindi davvero memorizzabile) => l'app parte anche offline
// - Chiamate a Supabase: mai intercettate
const CACHE_NAME = 'moneymanager-v7';
const LOCAL = ['./', './index.html', './app.css?v=7', './app.js?v=7', './manifest.json'];
const CDN = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(LOCAL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await Promise.all(CDN.map(async (u) => {
      try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); } catch (e) { /* riprova al primo uso */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (req.mode === 'navigate' ? ((await cache.match('./index.html')) || (await cache.match('./'))) : null);
    if (hit) return hit;
    throw err;
  }
}
async function cdnFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req.url, { mode: 'cors' });
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req)); return; }
  if (CDN.includes(req.url)) event.respondWith(cdnFirst(req));
});
