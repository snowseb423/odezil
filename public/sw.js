// EauPartagée — service worker minimal.
// Il rend l'application installable. Volontairement, il ne met rien en cache
// (ni pages, ni données, ni la page Cardinal) : pas de mode hors-ligne, chaque
// requête passe par le réseau et par les contrôles d'accès du serveur.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Nettoie d'éventuels caches laissés par une version précédente.
      for (const key of await caches.keys()) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
