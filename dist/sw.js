// BuildingApp Service Worker v5
// Network-First for HTML, Cache-First for assets, bulletproof clone handling
const CACHE_NAME = 'building-ai-cache-v7';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ── Install: pre-cache core shell ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll can fail if network is down during install — that's ok
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache failed (non-fatal):', err);
      });
    })
  );
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: smart routing ──────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Never intercept API calls, products data, or product images — let them go straight to the server
  if (request.url.includes('/api/') || request.url.includes('/data/') || request.url.includes('/products/')) return;

  // Only intercept same-origin requests
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isHtmlRequest =
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname === '/' ||
    url.pathname === '/index.html';

  if (isHtmlRequest) {
    // ── Network-First for HTML: always get latest app shell ──────────────────
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Clone BEFORE doing anything with the response
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline: serve cached shell
          return caches.match('/index.html').then(
            (cached) => cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } })
          );
        })
    );
  } else {
    // ── Cache-First for static assets (JS, CSS, images) ─────────────────────
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || !networkResponse.ok) return networkResponse;

            // Do NOT cache if server returned an HTML fallback for a JS/CSS path
            const ct = networkResponse.headers.get('content-type') || '';
            if (ct.includes('text/html')) return networkResponse;

            // Clone BEFORE returning
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return networkResponse;
          })
          .catch(() => {
            // Return whatever we have, or a 404
            return cached || new Response('Not found', { status: 404 });
          });
      })
    );
  }
});
