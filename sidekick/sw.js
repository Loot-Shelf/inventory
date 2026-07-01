// SideKick Service Worker
// Handles offline caching and PWA install experience

const CACHE_NAME = 'sidekick-v1';

// Files to cache on install — the core app shell
const PRECACHE = [
  '/sidekick.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// External Firebase/CDN URLs we do NOT cache — they must be live
const NEVER_CACHE = [
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseapp.com',
];

// ── INSTALL ──────────────────────────────────
// Pre-cache the app shell when the SW first installs
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE);
    }).then(() => {
      // Activate immediately without waiting for old tabs to close
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ─────────────────────────────────
// Clean up any old caches from previous versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────
// Network-first for Firebase/live data, cache-first for app shell
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

  // Network-first strategy:
  // Try network, fall back to cache if offline
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // If we got a good response, update the cache
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Network failed — serve from cache (offline mode)
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // If the main HTML is requested and we're offline, serve sidekick.html
          if (event.request.destination === 'document') {
            return caches.match('/sidekick.html');
          }
        });
      })
  );
});
