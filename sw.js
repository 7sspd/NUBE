/**
 * Service Worker para NUBE Offline.
 *
 * Cachea el "app shell" (HTML, CSS, JS, manifest, iconos) en la primera carga,
 * de modo que la app funcione sin conexion despues de visitarla una vez.
 *
 * IMPORTANTE: NO se cachean datos del usuario. Los archivos del usuario viven
 * en IndexedDB, no en este cache.
 */
const CACHE_VERSION = 'nube-v2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo gestionamos GET de mismo origen.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Estrategia: cache-first con actualizacion en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // si no hay red, devolvemos el cache

      return cached || networkFetch;
    })
  );
});

// Permite forzar la actualizacion del SW desde la app.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
