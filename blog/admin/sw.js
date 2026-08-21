/* Service worker for the /admin/ app.
 *
 * Goal: instant repeat + offline loads of the static shell on iOS, without ever
 * caching the GitHub API, the auth endpoints, or stale application code.
 *
 * Strategy:
 *   - /admin/vendor/*  → cache-first. Their URLs are content-fingerprinted, so
 *     a cached response is already immutable and needs no background request.
 *   - the page itself + admin application JS/CSS → network-first.
 *     Online is always fresh (a deploy shows up immediately); the cached copy is
 *     only an offline fallback.
 *   - everything else (GitHub API, same-origin /api/* auth, any cross-origin) is
 *     not handled at all and goes straight to the network.
 *
 * The registration URL carries an automatic bundle hash. Any admin asset
 * change therefore activates a fresh worker and removes obsolete caches.
 */
const VERSION = `admin-${new URL(self.location.href).searchParams.get("v") || "development"}`;
const SHELL_CACHE = `${VERSION}-shell`;
const VENDOR_CACHE = `${VERSION}-vendor`;

self.addEventListener("install", () => {
  // Take over as soon as possible; we cache lazily on first fetch.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only ever manage same-origin /admin/* requests. The GitHub API is
  // cross-origin and the auth/proxy lives under /api/ — both must hit the
  // network untouched so data and sessions are never served stale.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/admin/")) return;

  // Cache-first for fingerprinted immutable vendor bundles.
  if (url.pathname.includes("/admin/vendor/")) {
    event.respondWith((async () => {
      const cache = await caches.open(VENDOR_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response?.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // Network-first for the shell: fresh when online, cache as offline fallback.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const page = (await cache.match("/admin/")) || (await cache.match("/admin/index.html"));
        if (page) return page;
      }
      throw error;
    }
  })());
});
