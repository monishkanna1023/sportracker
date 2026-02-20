"use strict";

const CACHE_VERSION = "ipl-predictor-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./app-legacy.js",
  "./firebase-config.js",
  "./manifest.json",
  "./assets/CSK.png",
  "./assets/DC.png",
  "./assets/GT.png",
  "./assets/KKR.png",
  "./assets/LSG.png",
  "./assets/MI.png",
  "./assets/PBKS.png",
  "./assets/RR.png",
  "./assets/RCB.png",
  "./assets/SRH.png",
  "./icons/favicon-32.png",
  "./icons/favicon-ipl.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (!isSameOrigin) {
    return;
  }

  // Navigation: network-first with offline fallback to cached app shell.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("./index.html");
          return cached || caches.match("./");
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
