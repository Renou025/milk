/* milk PWA service worker v12 - 预缓存全站资源（含 auto-backup / compress-image / addons / muse） */
const CACHE = 'milk-pwa-v12';
const ASSETS = [
  '.',
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'auto-backup.js',
  'compress-image.js',
  'addons.js',
  'muse.js',
  'css/styles.css',
  'js/app.js',
  'js/backup-engine.js',
  'js/config.js',
  'js/core.js',
  'js/data.js',
  'js/features.js',
  'js/games.js',
  'js/listeners.js',
  'js/onboarding.js',
  'js/state.js',
  'js/utils.js',
  'js/features/call.js',
  'js/features/envelope.js',
  'js/features/group-chat.js',
  'js/features/mood.js',
  'js/features/reply-library.js',
  'js/features/theme-editor.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
    )
  );
});
