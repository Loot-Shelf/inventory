const CACHE = 'gameroom-v1';
const ASSETS = [
  './sidekick.html',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for Firebase, cache first for app shell
  if (e.request.url.includes('firebaseio') || e.request.url.includes('googleapis')) {
    return; // Let Firebase handle its own requests
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
