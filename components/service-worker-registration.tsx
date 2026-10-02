"use client";

import { useEffect } from "react";

/** Enregistre le service worker (production uniquement) pour rendre l'app installable. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sans service worker, l'application fonctionne normalement.
    });
  }, []);
  return null;
}
