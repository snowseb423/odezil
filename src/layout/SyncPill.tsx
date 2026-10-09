import { CloudOff, RefreshCw, TriangleAlert, Wifi } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { useAppData, useEngine, useSyncState } from '../data/DataProvider.tsx'
import { describeOp } from '../data/ops.ts'
import type { SyncState } from '../data/sync.ts'
import { formatDate, formatTimestamp } from '../domain/format.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { Button, Notice } from '../ui/controls.tsx'

type Tone = 'ok' | 'pending' | 'offline' | 'error'

export function describeSync(sync: SyncState, pending: number): { short: string; long: string; tone: Tone } {
  const waiting = pending === 1 ? '1 en attente de synchronisation' : `${pending} en attente de synchronisation`
  if (sync.blocked) return { short: 'Erreur', long: `Envoi bloqué : ${sync.blocked.label}`, tone: 'error' }
  if (sync.authRequired) return { short: 'Session expirée', long: 'Session expirée : reconnectez-vous', tone: 'error' }
  if (!sync.online) {
    return pending
      ? { short: `${pending} en attente`, long: `Hors ligne, ${waiting}`, tone: 'offline' }
      : { short: 'Hors ligne', long: 'Hors ligne : les saisies partiront au retour du réseau', tone: 'offline' }
  }
  if (pending) return { short: `${pending} en attente`, long: `En ligne, ${waiting}`, tone: 'pending' }
  return { short: 'À jour', long: 'En ligne, tout est synchronisé', tone: 'ok' }
}

const PILL: Record<Tone, string> = {
  ok: 'bg-surface/15 text-header-ink ring-surface/25',
  pending: 'bg-warning-soft text-warning-ink ring-warning/40',
  offline: 'bg-warning-soft text-warning-ink ring-warning/40',
  error: 'bg-danger-soft text-danger-ink ring-danger/40',
}

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  pending: 'bg-warning motion-safe:animate-pulse',
  offline: 'bg-warning',
  error: 'bg-danger',
}

/** Badge de synchronisation de l'en-tête (« 2 en attente » en warning) et son détail. */
export function SyncPill() {
  const sync = useSyncState()
  const data = useAppData()
  const pending = data?.outbox.length ?? 0
  const [open, setOpen] = useState(false)
  const view = describeSync(sync, pending)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-bold ring-1 ${PILL[view.tone]}`}
        aria-label={`Synchronisation : ${view.long}`}
        aria-haspopup="dialog"
      >
        <span className={`size-2.5 rounded-full ${DOT[view.tone]}`} aria-hidden="true" />
        <span className="num">{view.short}</span>
      </button>
      <SyncSheet open={open} onClose={() => setOpen(false)} view={view} />
    </>
  )
}

function SyncSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: ReturnType<typeof describeSync> }) {
  const sync = useSyncState()
  const engine = useEngine()
  const data = useAppData()
  const { signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const Icon = view.tone === 'offline' ? CloudOff : view.tone === 'error' ? TriangleAlert : Wifi

  async function run(task: () => Promise<void>) {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Synchronisation" subtitle={view.long}>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <Icon size={22} className="shrink-0 text-text-muted" aria-hidden="true" />
        <p className="text-[0.9375rem] text-text">
          {sync.lastSyncAt ? `Dernière synchronisation : ${formatTimestamp(sync.lastSyncAt)}.` : 'Aucune synchronisation complète pour l’instant.'}
        </p>
      </div>

      {sync.blocked ? (
        <Notice tone="danger" className="mt-4">
          <p className="font-bold">Le serveur a refusé : {sync.blocked.label}</p>
          <p className="mt-1">{sync.blocked.message}</p>
          <p className="mt-1">Les saisies suivantes attendent. Réessayez, ou abandonnez cette saisie pour revenir à l’état du serveur.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void run(() => engine.retryBlocked())}>
              Réessayer
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void run(() => engine.discardBlocked())}>
              Abandonner cette saisie
            </Button>
          </div>
        </Notice>
      ) : null}

      {data && data.outbox.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 font-display text-base font-bold">En attente d’envoi</h3>
          <ol className="divide-y divide-border rounded-2xl border border-border">
            {data.outbox.slice(0, 12).map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-[0.9375rem]">
                {describeOp(entry.op, formatDate)}
                {entry.lastError ? <span className="block text-sm text-text-muted">Dernier essai : {entry.lastError}</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm text-text-muted">Envoyées dans l’ordre dès que le réseau revient, même si l’app a été fermée entre-temps.</p>
        </div>
      ) : null}

      {sync.lastError && !sync.authRequired ? <p className="mt-4 text-sm text-text-muted">{sync.lastError}</p> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {sync.authRequired ? (
          <Button variant="primary" onClick={() => void signOut()}>
            Se reconnecter
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !sync.online} onClick={() => void run(() => engine.sync())}>
            <RefreshCw size={18} className={busy ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            Synchroniser maintenant
          </Button>
        )}
      </div>
    </Sheet>
  )
}
