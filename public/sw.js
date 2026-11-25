const CACHE_NAME = 'zaka-plus-v11';
const APP_CACHE_PREFIX = 'zaka-plus-';
const APP_SHELL = [
  '/manifest.json?v=5',
  '/logo.png?v=6',
  '/pwa-192x192.png?v=5',
  '/pwa-512x512.png?v=5',
  '/apple-touch-icon.png?v=5',
  '/favicon-32x32.png?v=5',
  '/favicon.ico?v=5'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(APP_CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/__/')
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/@')
    || url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' })).then((response) => {
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('text/html')) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)));
        }
        return response;
      }).catch(async () => (await caches.match('/index.html')) || Response.error())
    );
    return;
  }

  // Network-first for unhashed source files (/src/*) so module updates never go stale.
  if (
    url.pathname.startsWith('/src/')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.jsx')
    || url.pathname.endsWith('.css')
  ) {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  if (
    url.pathname === '/manifest.json'
    || url.pathname === '/manifest.webmanifest'
    || url.pathname.endsWith('.png')
    || url.pathname.endsWith('.ico')
    || url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      }))
    );
  }
});
