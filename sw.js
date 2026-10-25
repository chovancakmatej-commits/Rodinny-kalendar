// Network first so updates show up right away; cached copy keeps the screen working offline
const CACHE = 'kalendar-v2';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Calendar data is requested with a cache-busting query; store it under one key
  const url = new URL(e.request.url); url.search = '';
  const cacheKey = url.toString();
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(cacheKey, c)); }
    return r;
  }).catch(() => caches.match(cacheKey)));
});
