const CACHE_NAME = 'building-innovation-v2';
const STATIC_CACHE = 'static-v2';
const IMAGE_CACHE = 'images-v2';

const staticAssets = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(staticAssets))
      .catch((err) => console.log('Cache install error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Handle API requests - network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => response)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Handle images - cache first with network fallback
  if (request.destination === 'image' || url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Static assets - stale while revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, STATIC_CACHE, IMAGE_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => !currentCaches.includes(name))
          .map(name => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});
