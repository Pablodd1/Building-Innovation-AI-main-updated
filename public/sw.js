const CACHE_NAME = 'building-ai-cache-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force active service worker to update immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Direct clients to take control immediately without reload
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Let browser handle API calls directly, only cache static files
  if (event.request.url.includes('/api/')) {
    return;
  }

  const url = new URL(event.request.url);
  const isHtmlPage = url.pathname === '/' || url.pathname === '/index.html';

  if (isHtmlPage) {
    // Network-First strategy for HTML pages to ensure updates are served instantly
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Serve offline fallback copy from cache
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-First strategy for other static assets (images, manifests, bundled JS/CSS)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const contentType = response.headers.get('content-type');
          // Do not cache SPA HTML fallbacks under asset file names
          if (contentType && contentType.includes('text/html')) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      })
    );
  }
});
