// Routeur minimal sur l'API History (repris de Presence) : chemins lisibles,
// aucune dépendance. Le fragment et la requête restent libres pour le
// retour de Supabase (/auth/callback?code=…) et les liens de partage.
import { useCallback, useSyncExternalStore } from 'react'

export type TabRoute = 'home' | 'journal' | 'deliveries' | 'months' | 'balance'
export type AppRoute = TabRoute | 'settings'

export type Route =
  | { name: AppRoute }
  | { name: 'authCallback' }
  /** Page en lecture seule du Foyer 2. */
  | { name: 'share'; token: string }

export const ROUTE_PATHS: Record<AppRoute | 'authCallback', string> = {
  home: '/',
  journal: '/journal',
  deliveries: '/livraisons',
  months: '/mois',
  balance: '/solde',
  settings: '/reglages',
  authCallback: '/auth/callback',
}

const NAVIGATE_EVENT = 'eaupartagee:navigate'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const share = /^\/p\/([^/]+)$/.exec(path)
  if (share) return { name: 'share', token: safeDecode(share[1]!) }
  const match = (Object.entries(ROUTE_PATHS) as [AppRoute | 'authCallback', string][]).find(([, p]) => p === path)
  return { name: match ? match[0] : 'home' }
}

export function isShareRoute(pathname: string): boolean {
  return routeFromPath(pathname).name === 'share'
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback)
  window.addEventListener(NAVIGATE_EVENT, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(NAVIGATE_EVENT, callback)
  }
}

/** Navigue vers un chemin de l'app (« /livraisons?id=… »). */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const current = `${window.location.pathname}${window.location.search}`
  if (current !== to) {
    if (options.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    window.dispatchEvent(new Event(NAVIGATE_EVENT))
  }
  window.scrollTo({ top: 0 })
}

/** Chemin et requête courants, mis à jour à chaque navigation. */
export function useLocation(): { route: Route; params: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => `${window.location.pathname}${window.location.search}`)
  const url = new URL(href, 'https://app.invalid')
  return { route: routeFromPath(url.pathname), params: url.searchParams }
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => void {
  return useCallback((to: string, options?: { replace?: boolean }) => navigate(to, options), [])
}
