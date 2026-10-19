// Service worker : met en cache la coque de l'application (lancement instantané, même si
// Termux est arrêté). Les appels à l'API ne sont JAMAIS mis en cache.
const CACHE = 'mmi-v1.4.0-mqtt';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/css/app.css', 'assets/js/esp.js', 'assets/js/app.js',
  'assets/img/maison.jpg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return; // réseau direct
  // Réseau d'abord (toujours à jour), cache en secours
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
});
