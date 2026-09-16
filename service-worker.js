const CACHE = "quality96-v12";
const LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./assets/hrsd-logo.png",
  "./assets/national-day-96-logo.webp"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(LOCAL_ASSETS)).then(() => self.skipWaiting()));
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
