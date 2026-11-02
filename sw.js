const CACHE = 'voixtexte-v4';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'report.js', 'icon.svg', 'manifest.webmanifest',
  'vendor/docx-9.12.0.mjs', 'vendor/anthropic-sdk-0.135.0.mjs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Réseau d'abord, cache en secours (pour avoir les mises à jour sans rester bloqué).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
