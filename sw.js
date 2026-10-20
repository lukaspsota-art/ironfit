// Offline support. All app files are precached together under one VERSION and served cache-first,
// so a page never mixes modules from two releases. Bump VERSION on every deploy: the browser then
// installs the new set in the background and the next launch uses it.
// The HTML page itself is network-first (fresh when online), falling back to the cache when offline.
const VERSION = 'ironfit-v5';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/anim.js',
  'js/stats.js',
  'js/planner.js',
  'js/store.js',
  'js/data/exercises.js',
  'js/data/parts.js',
  'js/data/ex-push.js',
  'js/data/ex-pull.js',
  'js/data/ex-legs.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !font) return;

  if (req.mode === 'navigate') {
    const network = fetch(req);
    // clone before respondWith can consume the body (this then() is registered first)
    const copy = network.then((res) => (res.ok ? res.clone() : null));
    e.waitUntil(copy.then((c) => c && caches.open(VERSION).then((cache) => cache.put('index.html', c))).catch(() => {}));
    e.respondWith(Promise.race([network, timeout(4000)]).catch(async () => (await caches.match('index.html')) || network));
    return;
  }

  // assets + fonts: cache-first; anything not precached is fetched once and stored
  const res = caches.match(req, { ignoreSearch: !font }).then((hit) => hit || fetch(req).then(async (r) => {
    if (r.ok || r.type === 'opaque') await (await caches.open(VERSION)).put(req, r.clone());
    return r;
  }));
  e.respondWith(res);
  e.waitUntil(res.catch(() => {}));
});
