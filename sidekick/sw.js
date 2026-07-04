// SideKick Service Worker
// Scope: /sidekick/

const CACHE_NAME = 'sidekick-v2';

// Files to cache on install — the core app shell
const PRECACHE = [
  '/sidekick/',
  '/sidekick/index.html',
  '/sidekick/manifest.json',
  '/sidekick/icon-192.png',
  '/sidekick/icon-512.png',
];

// External Firebase/CDN URLs we do NOT cache — they must always be live
const NEVER_CACHE = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
];

// ── INSTALL ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always go to network for Firebase and external APIs
  const isLiveOnly = NEVER_CACHE.some(domain => url.includes(domain));
  if (isLiveOnly) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Network-first: try network, fall back to cache if offline
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.destination === 'document') {
            return caches.match('/sidekick/index.html');
          }
        });
      })
  );
});
