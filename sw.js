// sw.js — cache-first service worker so the app works fully offline after
// the first visit. Bump CACHE_VERSION whenever any cached asset changes;
// activate() deletes every cache that doesn't match the current version.
const CACHE_VERSION = "v1";
const CACHE_NAME = `block-blast-solver-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/pieces.js",
  "./js/board.js",
  "./js/solver.js",
  "./js/solver.worker.js",
  "./js/detector.js",
  "./js/ui.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache same-origin assets AND cross-origin ones (Google Fonts
          // CSS + woff2) so a later fully-offline visit can still render
          // them, not just the files listed in APP_SHELL.
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => cached);
    })
  );
});
