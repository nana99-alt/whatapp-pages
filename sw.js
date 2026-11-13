const CACHE_NAME = "whatapp-shell-v12";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(async (cached) => {
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }
      throw error;
    }
  }));
});
self.addEventListener("push", (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data.json(); } catch { payload = { title: "Panggilan masuk", body: "Ada panggilan WhatApp." }; }
    await self.registration.showNotification(payload.title || "Panggilan masuk", {
      body: payload.body || "Ada panggilan WhatApp.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: `whatapp-call-${payload.signalId || Date.now()}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [900, 450, 900, 450, 900],
      timestamp: Date.now(),
      data: { url: payload.url || "./", signalId: payload.signalId || "", callId: payload.callId || "" },
      actions: [{ action: "open-call", title: "Buka panggilan" }]
    });
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    const signalId = data.signalId || "";
    const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clientList.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if (signalId) existing.postMessage({ type: "WHATAPP_OPEN_INCOMING_CALL", signalId });
      return;
    }
    const target = new URL(data.url || "./", self.location.origin);
    if (signalId) target.searchParams.set("incoming_call", signalId);
    await self.clients.openWindow(target.href);
  })());
});
