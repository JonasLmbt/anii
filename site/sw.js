/* Service Worker: macht Seiten, Daten und (auf Wunsch) Aufnahmen offline verfügbar.
   __VERSION__ und __PRECACHE__ setzt tools/build_site.py beim Bauen ein. */
"use strict";
const VERSION = "__VERSION__";
const SHELL = "anii-shell-" + VERSION;
const AUDIO = "anii-audio"; // bleibt über Versionen hinweg erhalten
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("anii-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;

  // Aufnahmen: aus dem Speicher, sonst laden und für später merken
  if (u.pathname.startsWith("/audio/")) {
    event.respondWith(
      caches.open(AUDIO).then((c) => c.match(u.pathname).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.status === 200) c.put(u.pathname, res.clone());
        return res;
      })))
    );
    return;
  }
  if (/^\/(telechargement|admin|api)(\/|$)/.test(u.pathname)) return; // Downloads, Editor und Konten nie aus dem Speicher

  event.respondWith(
    caches.open(SHELL).then(async (c) => {
      let path = u.pathname;
      if (req.mode === "navigate" && !path.endsWith("/") && !/\.[a-z0-9]+$/i.test(path)) path += "/";
      const hit = await c.match(path + u.search) || await c.match(path);
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === "navigate") {
          const lang = path.startsWith("/de/") ? "/de/" : "/fr/";
          return (await c.match(lang)) || Response.error();
        }
        throw err;
      }
    })
  );
});
