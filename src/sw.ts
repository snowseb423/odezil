/// <reference lib="webworker" />
// Service worker (Workbox, stratégie injectManifest) :
// - precache de l'app shell (HTML, JS, CSS, polices, icônes) ;
// - toutes les navigations (y compris /p/… et /auth/callback) servent
//   index.html précaché, page de repli hors ligne en dernier recours ;
// - AUCUNE route d'exécution : les requêtes Supabase (REST, RPC dont la
//   page partagée, Storage, Auth) partent toujours au réseau et ne sont
//   jamais mises en cache. La copie hors ligne des données est Dexie.
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

// ---- App shell ----
const shell = createHandlerBoundToURL('index.html')
registerRoute(
  new NavigationRoute(async (options) => {
    try {
      return await shell(options)
    } catch {
      return (await matchPrecache('offline.html')) ?? Response.error()
    }
  }),
)

// ---- Messages de la page ----
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
