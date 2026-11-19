/* Skyhold Isles service worker. Generated into dist/sw.js at build time (see vite.config.ts):
 * The version below is a hash of every shipped file, so each deploy produces a new worker (and a
 * new cache); CORE / EXTRA are the files kept for offline play (CORE must cache, EXTRA is best effort).
 *
 * Update flow: a new worker installs and then WAITS. The page shows a "Reload" prompt; when the
 * player accepts, the page posts SKIP_WAITING, the worker takes over and the page reloads. Nothing
 * swaps underneath a running game. */
const VERSION = '__SW_VERSION__';
const CORE = __SW_CORE__;
const EXTRA = __SW_EXTRA__;
const CACHE = 'skyhold-' + VERSION;
const NAV_TIMEOUT_MS = 4000;
// Some hosts / dev servers send `Vary: Origin`; cached entries were stored without an Origin header.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(CORE);
      // Models / icons are nice-to-have: one failing file must not abort the install.
      await Promise.allSettled(EXTRA.map((url) => cache.add(url)));
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('skyhold-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function networkFirstNavigation(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () =>
      caches.match('/index.html', MATCH).then((hit) => hit || caches.match('/', MATCH));
    const timer = setTimeout(() => {
      fallback().then((hit) => {
        if (hit && !settled) {
          settled = true;
          resolve(hit);
        }
      });
    }, NAV_TIMEOUT_MS);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        // Only the 3D game's own page refreshes the offline shell; other pages (2d.html) must never
        // overwrite it.
        const path = new URL(request.url).pathname;
        // The site root now redirects to the 2D game: a redirected response is 2d.html, not the 3D shell.
        if (res.ok && !res.redirected && (path === '/' || path === '/index.html')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
        }
        resolve(res);
      })
      .catch(() => {
        clearTimeout(timer);
        if (settled) return;
        fallback().then((hit) => {
          settled = true;
          resolve(hit || Response.error());
        });
      });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;
  // The 2D build lives on the same origin but is not part of the offline 3D game: let its page,
  // manifest and art go straight to the network (cache-first would pin a stale manifest forever).
  if (url.pathname === '/2d.html' || url.pathname.startsWith('/art2d/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Hashed assets, models, icons: cache first, fill the cache on a miss.
  event.respondWith(
    caches.match(request, MATCH).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
