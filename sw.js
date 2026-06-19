const CACHE_NAME = "media-compressor-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/jszip/jszip.min.js",
  "./vendor/ffmpeg/index.js",
  "./vendor/ffmpeg/classes.js",
  "./vendor/ffmpeg/const.js",
  "./vendor/ffmpeg/errors.js",
  "./vendor/ffmpeg/types.js",
  "./vendor/ffmpeg/utils.js",
  "./vendor/ffmpeg/worker.js",
  "./vendor/ffmpeg-util/index.js",
  "./vendor/ffmpeg-util/const.js",
  "./vendor/ffmpeg-util/errors.js",
  "./vendor/ffmpeg-util/types.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
