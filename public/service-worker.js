const LEGACY_CACHE_PREFIX = 'zaka-plus-shell-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(LEGACY_CACHE_PREFIX))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.registration.unregister().catch(() => false))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/__/') || url.pathname.startsWith('/api/')) {
    return;
  }
});
