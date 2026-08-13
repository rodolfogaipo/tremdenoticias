'use strict';
/* Trem de Notícias — service worker
   - App shell: cache-first (funciona 100% offline após 1ª visita)
   - data/news.json: stale-while-revalidate (mostra cache na hora,
     atualiza em segundo plano quando há internet) */

const VERSION = 'v1';
const SHELL_CACHE = `tn-shell-${VERSION}`;
const DATA_CACHE = `tn-data-${VERSION}`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './img/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return url.pathname.endsWith('/data/news.json');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (isDataRequest(url)) {
    // stale-while-revalidate
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then(res => { if (res.ok) cache.put(event.request, res.clone()); return res; })
          .catch(() => null);
        return cached || (await network) || new Response(
          JSON.stringify({ items: [], generatedAt: null, error: 'offline-sem-cache' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // app shell: cache-first, fallback à rede
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        if (res.ok && (event.request.destination === '' || res.type === 'basic')) {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
