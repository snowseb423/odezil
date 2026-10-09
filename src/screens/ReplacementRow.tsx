import { CloudUpload, Lock } from 'lucide-react'
import type { EffectiveDelivery, EffectiveReplacement } from '../data/ops.ts'
import { mauritiusDateOf } from '../domain/dates.ts'
import { formatDateShort, formatTime } from '../domain/format.ts'
import { AppLink } from '../layout/AppShell.tsx'

/** Statut d'un remplacement : en attente de livraison, ou verrouillé sur sa livraison. */
export function ReplacementStatus({ replacement, delivery }: { replacement: EffectiveReplacement; delivery?: EffectiveDelivery }) {
  if (!replacement.deliveryId) {
    return <span className="inline-flex rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-bold text-text-muted">En attente de livraison</span>
  }
  return (
    <AppLink
      to={`/livraisons?id=${replacement.deliveryId}`}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-foyer-1-soft px-2.5 text-sm font-bold text-foyer-1-ink underline-offset-2 hover:underline"
    >
      <Lock size={14} aria-hidden="true" />
      {delivery ? `Livraison du ${formatDateShort(delivery.deliveryDate)}` : 'Rattaché à une livraison'}
    </AppLink>
  )
}

export function ReplacementRow({
  replacement,
  delivery,
  showDate = true,
  onSelect,
}: {
  replacement: EffectiveReplacement
  delivery?: EffectiveDelivery
  showDate?: boolean
  /** Modification possible (remplacement en attente uniquement). */
  onSelect?: () => void
}) {
  const editable = Boolean(onSelect) && !replacement.deliveryId
  const details = (
    <>
      <span className="num min-w-14 pt-0.5 font-display text-lg font-bold text-text">{formatTime(replacement.replacedAt)}</span>
      <span className="min-w-0 flex-1">
        {showDate ? <span className="block text-[0.9375rem] font-bold text-text">{formatDateShort(mauritiusDateOf(replacement.replacedAt))}</span> : null}
        {replacement.note ? <span className="block break-words text-[0.9375rem] text-text-muted">{replacement.note}</span> : null}
      </span>
      {replacement.pending ? <CloudUpload size={18} className="mt-1 shrink-0 text-warning-ink" aria-label="En attente de synchronisation" /> : null}
    </>
  )
  return (
    <li className="px-4 py-3">
      {editable ? (
        <button type="button" onClick={onSelect} className="flex min-h-11 w-full items-start gap-3 text-left" aria-label="Modifier ce remplacement">
          {details}
        </button>
      ) : (
        <div className="flex min-h-11 items-start gap-3">{details}</div>
      )}
      <div className="mt-1.5 pl-[4.25rem]">
        <ReplacementStatus replacement={replacement} delivery={delivery} />
      </div>
    </li>
  )
}
