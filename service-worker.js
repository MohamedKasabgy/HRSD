const CACHE = "quality96-v13";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("./")).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (new URL(event.request.url).origin === self.location.origin) {
      const clone = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, clone));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
