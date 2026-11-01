// Offline cache. Bump VERSION when any file changes so phones pick up the update.
const VERSION = 'v4';
const FILES = ['./', 'index.html', 'app.js', 'template.pdf', 'vendor/pdf-lib.min.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first so updates show up straight away; fall back to the cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const same = new URL(e.request.url).origin === location.origin;
  // no-cache: always check the server, so the browser's HTTP cache can't serve a stale mix of files.
  e.respondWith(fetch(same ? new Request(e.request.url, { cache: 'no-cache' }) : e.request).then((r) => {
    if (r.ok && same) {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
