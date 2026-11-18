// Einfacher Service Worker: App-Hülle offline verfügbar (Netzwerk zuerst, Cache als Rückfall).
const CACHE = 'bs-shell-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'js/app.js', 'js/store.js', 'js/icons.js', 'js/i18n.js', 'js/ui.js', 'js/games.js', 'js/players.js', 'js/badteam.js', 'js/video.js', 'js/sync.js', 'js/dropbox.js', 'js/config.js', 'js/tour.js', 'js/family.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
