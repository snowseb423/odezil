// Page en lecture seule du Foyer 2 (/p/:token). Chunk à part : pas de
// Dexie, pas de session (client anonyme sans persistance), rien n'est
// enregistré sur l'appareil. Les données viennent de la RPC
// get_shared_view, qui ne renvoie que celles du Foyer 2.
import { createClient } from '@supabase/supabase-js'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { capitalize, formatDateShort, formatMonth, formatRs, formatTimestamp, plural } from '../domain/format.ts'
import { env } from '../env.ts'
import { AppMark } from '../ui/AppMark.tsx'
import { Button, Card, SectionTitle } from '../ui/controls.tsx'
import { type SharedView, parseSharedView } from './sharedView.ts'

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'ready'; view: SharedView; fetchedAt: string; offline: boolean; error: boolean }
  | { status: 'unavailable'; offline: boolean }

/** Le token figure dans l'URL : aucun en-tête Referer ne doit le transporter. */
function protectToken(): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'referrer'
    document.head.append(meta)
  }
  meta.content = 'no-referrer'
}

/**
 * Manifest d'exécution : « Ajouter à l'écran d'accueil » rouvre cette page
 * (et non la connexion administrateur). Best effort selon le navigateur.
 */
function installManifest(): void {
  const href = window.location.href
  const manifest = {
    id: '/p/',
    name: 'Eau partagée — Foyer 2',
    short_name: 'Eau partagée',
    lang: 'fr',
    start_url: href,
    scope: href,
    display: 'standalone',
    theme_color: '#0369A1',
    background_color: '#F4F8FB',
    icons: [
      { src: `${window.location.origin}/pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${window.location.origin}/pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
    ],
  }
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.append(link)
  }
  link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`
  document.title = 'Eau partagée — Foyer 2'
}

export function SharedApp({ token }: { token: string }) {
  const client = useMemo(
    () =>
      createClient(env.supabaseUrl, env.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'eaupartagee-share' },
      }),
    [],
  )
  const [state, setState] = useState<State>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  // Pas de mise à jour d'état avant la réponse : appelable depuis un effet.
  const load = useCallback(async () => {
    try {
      const { data, error } = await client.rpc('get_shared_view', { p_token: token })
      if (error) throw new Error(error.message)
      const view = parseSharedView(data)
      setState(view ? { status: 'ready', view, fetchedAt: new Date().toISOString(), offline: false, error: false } : { status: 'invalid' })
    } catch {
      const offline = !navigator.onLine
      setState((previous) =>
        previous.status === 'ready' ? { ...previous, offline, error: !offline } : { status: 'unavailable', offline },
      )
    } finally {
      setRefreshing(false)
    }
  }, [client, token])

  useEffect(() => {
    protectToken()
    installManifest()
    // oxlint-disable-next-line react/set-state-in-effect -- l'état n'est mis à jour qu'après la réponse du réseau.
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [load])

  if (state.status === 'invalid') {
    return (
      <div className="band flex min-h-dvh flex-col justify-end gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <AppMark size={56} />
        <h1 className="font-display text-3xl font-extrabold">Lien invalide</h1>
        <p className="max-w-sm text-header-ink-2">Ce lien n’est pas (ou plus) valide. Demandez un nouveau lien.</p>
      </div>
    )
  }

  const view = state.status === 'ready' ? state.view : null
  const advance = (view?.balanceCents ?? 0) < 0

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="band px-4 pb-12 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
          <div className="flex items-center gap-3">
            <AppMark size={40} />
            <p className="font-display text-xl font-bold">Bonbonnes d’eau Odezil</p>
          </div>
          <p className="mt-3 text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">{advance ? 'Avance' : 'Solde à régler'}</p>
          <p className="num font-display text-[3.5rem] font-extrabold leading-none tracking-tight" data-testid="shared-balance">
            {view ? formatRs(Math.abs(view.balanceCents)) : '…'}
          </p>
          {view && view.balanceCents === 0 ? <p className="text-header-ink-2">Tout est réglé. Merci !</p> : null}
        </div>
      </div>

      <main className="relative z-10 -mt-7 flex-1 rounded-t-[1.75rem] bg-bg">
        <div className="mx-auto w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.9375rem] text-text-muted" aria-live="polite">
              {state.status === 'ready' ? `Dernière mise à jour : ${formatTimestamp(state.fetchedAt)}` : state.status === 'loading' ? 'Chargement…' : ''}
            </p>
            <Button
              variant="secondary"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true)
                void load()
              }}
            >
              <RefreshCw size={18} className={refreshing ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
              Actualiser
            </Button>
          </div>

          {(state.status === 'unavailable' || (state.status === 'ready' && (state.offline || state.error))) ? (
            <div role="status" className="mt-4 flex items-start gap-3 rounded-2xl bg-warning-soft p-3 text-[0.9375rem] text-warning-ink ring-1 ring-warning/40">
              <CloudOff size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p>
                {('offline' in state && state.offline) || !navigator.onLine
                  ? 'Pas de connexion internet : impossible d’actualiser. Réessayez une fois en ligne.'
                  : 'Le récapitulatif est momentanément indisponible. Réessayez dans un instant.'}
              </p>
            </div>
          ) : null}

          {view ? (
            <>
              <SectionTitle>Par mois</SectionTitle>
              {view.months.length === 0 ? (
                <Card>
                  <p className="text-text-muted">Rien à régler pour l’instant.</p>
                </Card>
              ) : (
                <Card padded={false}>
                  <ul className="divide-y divide-border">
                    {view.months.map((month) => (
                      <li key={month.month} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[1.0625rem] font-bold text-text">{capitalize(formatMonth(month.month))}</span>
                          <span className="num font-display text-lg font-extrabold text-text">{formatRs(month.totalCents)}</span>
                        </div>
                        {month.adjustmentCents !== 0 ? (
                          <p className="mt-1 flex justify-between gap-3 text-[0.9375rem] text-text-muted">
                            <span>Bonbonnes</span>
                            <span className="num">{formatRs(month.deliveriesCents)}</span>
                          </p>
                        ) : null}
                        {month.adjustmentCents !== 0 ? (
                          <p className="flex justify-between gap-3 text-[0.9375rem] text-text-muted">
                            <span>Ajustement (relevé Odezil)</span>
                            <span className="num">{formatRs(month.adjustmentCents, { signed: true })}</span>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <SectionTitle>Vos livraisons</SectionTitle>
              {view.deliveries.length === 0 ? (
                <Card>
                  <p className="text-text-muted">Aucune livraison pour le moment.</p>
                </Card>
              ) : (
                <Card padded={false}>
                  <ul className="divide-y divide-border">
                    {view.deliveries.map((delivery, index) => (
                      <li key={`${delivery.date}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
                        <span className="text-[1.0625rem] font-bold text-text">{capitalize(formatDateShort(delivery.date))}</span>
                        <span className="num text-[1.0625rem] text-text">
                          {plural(delivery.bottles, 'bonbonne')} × {formatRs(delivery.unitPriceCents)} = <strong>{formatRs(delivery.amountCents)}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <SectionTitle>Remboursements reçus</SectionTitle>
              {view.repayments.length === 0 ? (
                <Card>
                  <p className="text-text-muted">Aucun remboursement enregistré.</p>
                </Card>
              ) : (
                <Card padded={false}>
                  <ul className="divide-y divide-border">
                    {view.repayments.map((repayment, index) => (
                      <li key={`${repayment.date}-${index}`} className="flex items-baseline justify-between gap-3 px-4 py-3">
                        <span className="text-[1.0625rem] text-text">{capitalize(formatDateShort(repayment.date))}</span>
                        <span className="num text-[1.0625rem] font-bold text-success-ink">{formatRs(repayment.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}
