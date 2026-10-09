import { ArrowRight, Check, Droplet, Truck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { deleteReplacementOp, recordReplacementOp } from '../data/commands.ts'
import type { AppData } from '../data/mirror.ts'
import { balanceF2, pendingReplacements } from '../domain/calculations.ts'
import { formatDate, formatRs, formatTime, plural } from '../domain/format.ts'
import { AppLink, AppShell } from '../layout/AppShell.tsx'
import { navigate } from '../lib/router.ts'
import { Button, Card, SectionTitle } from '../ui/controls.tsx'
import { ReplacementRow } from './ReplacementRow.tsx'
import { useCommit } from './useCommit.ts'

/** Durée du verrouillage après un appui (protection contre les doubles appuis). */
const LOCK_MS = 2_000

export function HomeScreen({ data }: { data: AppData }) {
  const commit = useCommit()
  const [locked, setLocked] = useState(false)
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  })

  const pending = pendingReplacements(data.replacements)
  const lastDelivery = data.deliveries[0] ?? null
  const balance = balanceF2(data)
  const deliveries = new Map(data.deliveries.map((d) => [d.id, d]))
  const recent = data.replacements.slice(0, 5)

  async function record() {
    if (locked) return
    setLocked(true)
    window.setTimeout(() => setLocked(false), LOCK_MS)
    const op = recordReplacementOp()
    const id = op.replacement.id
    navigator.vibrate?.(15)
    await commit(() => op, {
      message: `Bonbonne remplacée à ${formatTime(op.replacement.replacedAt)}`,
      undo: () => {
        const current = dataRef.current.replacements.find((r) => r.id === id)
        return current ? deleteReplacementOp(current) : { kind: 'replacement.delete', id }
      },
    })
  }

  const hero = (
    <div className="pt-1">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">Depuis la dernière livraison</p>
      <p className="mt-1 flex items-baseline gap-3 font-display font-extrabold leading-none tracking-tight">
        <span className="num text-[4rem]" data-testid="pending-count">
          {pending.length}
        </span>
        <span className="text-xl">{pending.length >= 2 ? 'remplacements' : 'remplacement'}</span>
      </p>
      <p className="mt-2 text-[0.9375rem] text-header-ink-2">
        {lastDelivery ? `Dernière livraison : ${formatDate(lastDelivery.deliveryDate)}` : 'Aucune livraison enregistrée'}
      </p>
    </div>
  )

  return (
    <AppShell title="EauPartagée" hero={hero}>
      <button
        type="button"
        onClick={() => void record()}
        disabled={locked}
        aria-live="polite"
        className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-[2rem] bg-primary px-6 text-on-primary shadow-card transition-[transform,background-color] hover:bg-primary-hover active:scale-[0.98] disabled:bg-primary-hover"
      >
        {locked ? <Check size={48} strokeWidth={2.6} aria-hidden="true" /> : <Droplet size={48} strokeWidth={2.2} aria-hidden="true" />}
        <span className="font-display text-[1.75rem] font-extrabold leading-tight">{locked ? 'Enregistré' : 'Bonbonne remplacée'}</span>
        <span className="text-[0.9375rem] font-bold opacity-90">Un appui par bonbonne vide remplacée sur ma fontaine</span>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <AppLink to="/solde" className="block rounded-3xl border border-border bg-surface p-4 shadow-card">
          <span className="block text-sm font-bold text-foyer-2-ink">Solde Foyer 2</span>
          <span className="num mt-1 block font-display text-xl font-extrabold text-text">{formatRs(balance.balanceCents)}</span>
          <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-primary">
            Détail <ArrowRight size={14} aria-hidden="true" />
          </span>
        </AppLink>
        <Button variant="secondary" className="h-full min-h-24 flex-col rounded-3xl text-base" onClick={() => navigate('/livraisons?nouvelle=1')}>
          <Truck size={26} aria-hidden="true" />
          Nouvelle livraison
        </Button>
      </div>

      <SectionTitle
        action={
          <AppLink to="/journal" className="min-h-11 content-center text-[0.9375rem] font-bold text-primary">
            Tout le journal
          </AppLink>
        }
      >
        Derniers remplacements
      </SectionTitle>
      {recent.length === 0 ? (
        <Card>
          <p className="text-[0.9375rem] text-text-muted">
            Aucun remplacement enregistré. Touchez « Bonbonne remplacée » à chaque bonbonne vide remplacée sur votre fontaine.
          </p>
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-border">
            {recent.map((replacement) => (
              <ReplacementRow
                key={replacement.id}
                replacement={replacement}
                delivery={replacement.deliveryId ? deliveries.get(replacement.deliveryId) : undefined}
              />
            ))}
          </ul>
        </Card>
      )}
      {pending.length > 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {plural(pending.length, 'remplacement')} en attente : {pending.length >= 2 ? 'ils seront attribués' : 'il sera attribué'} au Foyer 1
          à la prochaine livraison.
        </p>
      ) : null}
    </AppShell>
  )
}
