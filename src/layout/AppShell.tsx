import { CalendarRange, Droplet, ListChecks, Settings2, Truck, Wallet } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useSyncState } from '../data/DataProvider.tsx'
import { ROUTE_PATHS, type TabRoute, navigate, useLocation } from '../lib/router.ts'
import { SyncPill } from './SyncPill.tsx'

const NAV: { route: TabRoute; label: string; icon: typeof Droplet }[] = [
  { route: 'home', label: 'Accueil', icon: Droplet },
  { route: 'journal', label: 'Journal', icon: ListChecks },
  { route: 'deliveries', label: 'Livraisons', icon: Truck },
  { route: 'months', label: 'Mois', icon: CalendarRange },
  { route: 'balance', label: 'Solde', icon: Wallet },
]

function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [threshold])
  return scrolled
}

/** Lien interne : navigation sans rechargement (modificateurs : comportement du navigateur). */
export function AppLink({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode } & Record<string, unknown>) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}

/**
 * Structure commune (reprise de Presence) : bandeau primary sous la barre
 * d'état iOS, feuille claire qui le recouvre, navigation au pouce.
 */
export function AppShell({ title, hero, children }: { title: ReactNode; hero?: ReactNode; children: ReactNode }) {
  const scrolled = useScrolled()
  const sync = useSyncState()
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={`fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] text-header-ink transition-[background-color,box-shadow] duration-200 ${
          scrolled ? 'bg-header shadow-[0_8px_24px_-16px_rgb(15_34_51/0.6)]' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
          <h1 className="min-w-0 flex-1 truncate font-display text-[1.375rem] font-bold leading-tight">{title}</h1>
          <SyncPill />
          <AppLink
            to={ROUTE_PATHS.settings}
            aria-label="Réglages"
            className="grid size-11 shrink-0 place-items-center rounded-full text-header-ink hover:bg-surface/15"
          >
            <Settings2 size={22} aria-hidden="true" />
          </AppLink>
        </div>
        {!sync.online ? (
          <p className="bg-text/25 px-4 py-1 text-center text-[0.8125rem] font-bold text-header-ink" data-testid="offline-banner">
            Hors ligne : les saisies partiront au retour du réseau
          </p>
        ) : null}
      </header>

      <div className="band">
        <div className={sync.online ? 'h-[calc(env(safe-area-inset-top)+3.5rem)]' : 'h-[calc(env(safe-area-inset-top)+5rem)]'} aria-hidden="true" />
        {hero ? <div className="mx-auto w-full max-w-xl px-4 pb-3">{hero}</div> : null}
        <div className="h-9" aria-hidden="true" />
      </div>

      <main className="relative z-10 -mt-7 flex-1 rounded-t-[1.75rem] bg-bg">
        <div className="mx-auto w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] pt-5">{children}</div>
      </main>

      <BottomNav />
    </div>
  )
}

function BottomNav() {
  const { route } = useLocation()
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {NAV.map(({ route: target, label, icon: Icon }) => {
          const active = route.name === target
          return (
            <li key={target}>
              <AppLink
                to={ROUTE_PATHS[target]}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 pt-1.5 pb-1 text-[0.75rem] font-bold"
              >
                <span
                  className={`grid h-8 w-12 place-items-center rounded-full transition-colors ${
                    active ? 'bg-primary-soft text-primary' : 'text-text-muted'
                  }`}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                </span>
                <span className={active ? 'text-primary' : 'text-text-muted'}>{label}</span>
              </AppLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
