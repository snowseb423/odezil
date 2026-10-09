import type { ReactNode } from 'react'
import type { DeliveryEditPreview } from '../domain/calculations.ts'
import { allocationWarningMessage } from '../domain/calculations.ts'
import { formatDate, formatRs } from '../domain/format.ts'
import { Notice } from '../ui/controls.tsx'

/** Repère d'un foyer : teinte froide ET libellé, jamais la couleur seule. */
export function FoyerTag({ foyer, children }: { foyer: 1 | 2; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold ${
        foyer === 1 ? 'bg-foyer-1-soft text-foyer-1-ink' : 'bg-foyer-2-soft text-foyer-2-ink'
      }`}
    >
      <span className={`size-2.5 rounded-full ${foyer === 1 ? 'bg-foyer-1' : 'bg-foyer-2'}`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** Répartition d'une livraison : Foyer 1 / Foyer 2. */
export function SplitTags({ f1, f2 }: { f1: number; f2: number }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <FoyerTag foyer={1}>Foyer 1 : {f1}</FoyerTag>
      <FoyerTag foyer={2}>Foyer 2 : {f2}</FoyerTag>
    </span>
  )
}

/** Ligne libellé / valeur d'un récapitulatif chiffré. */
export function FigureRow({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex min-h-10 items-baseline justify-between gap-3">
      <dt className="text-[0.9375rem] text-text-muted">{label}</dt>
      <dd className={`num text-right ${strong ? 'font-display text-lg font-extrabold text-text' : 'font-bold text-text'}`}>{value}</dd>
    </div>
  )
}

/** Aperçu automatique de la répartition, avec les avertissements de la règle d'attribution. */
export function AllocationPreview({ preview }: { preview: DeliveryEditPreview }) {
  const { after, before, allocation } = preview
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="flex flex-wrap items-center gap-2 text-[1.0625rem] text-text">
          <FoyerTag foyer={1}>Foyer 1</FoyerTag>
          <span className="num font-bold">{after.bottlesF1}</span>
          <span className="text-text-muted">(enregistrés)</span>
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[1.0625rem] text-text">
          <FoyerTag foyer={2}>Foyer 2</FoyerTag>
          <span className="num">
            {after.bottlesTotal} − {after.bottlesF1} = <strong>{after.bottlesF2}</strong> × {formatRs(after.unitPriceCents)} ={' '}
            <strong className="font-display text-xl">{formatRs(after.f2Cents)}</strong>
          </span>
        </p>
        {before && preview.changed ? (
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[0.9375rem] text-text">
            Montant du Foyer 2 : <span className="num">{formatRs(before.f2Cents)}</span> →{' '}
            <strong className="num">{formatRs(after.f2Cents)}</strong>
            <span className="block text-sm text-text-muted">
              Avant : Foyer 1 {before.bottlesF1} / Foyer 2 {before.bottlesF2} sur {before.bottlesTotal}
            </span>
          </p>
        ) : null}
      </div>
      {allocation.warnings.map((warning) => (
        <Notice key={warning.kind} tone="warning">
          {allocationWarningMessage(warning, formatDate)}
        </Notice>
      ))}
    </div>
  )
}
