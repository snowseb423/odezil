// Toutes les règles de calcul d'EauPartagée, en fonctions pures :
// attribution d'une livraison entre les deux foyers, prix, montants,
// rapprochement SOA et solde du Foyer 2. Elles sont identiques aux règles
// appliquées par la base (prix figé, colonne f2_adjustment_cents,
// get_shared_view) : tests/sql/parity.test.ts le vérifie.
// Montants en centimes entiers, jours calculés à l'heure de Maurice.
import { diffDays, mauritiusDateOf, monthOf } from './dates.ts'
import type { Cents, Delivery, IsoDate, IsoMonth, Price, Replacement, Repayment, SoaStatement, VarianceTreatment } from './types.ts'

// ---------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------

type PriceLike = Pick<Price, 'unitPriceCents' | 'effectiveFrom'>

/** Prix en vigueur à une date : le plus récent dont la date d'effet est ≤ date. */
export function priceAt(date: IsoDate, prices: readonly PriceLike[]): Cents | null {
  let best: PriceLike | null = null
  for (const price of prices) {
    if (price.effectiveFrom <= date && (!best || price.effectiveFrom > best.effectiveFrom)) best = price
  }
  return best ? best.unitPriceCents : null
}

/**
 * Prix d'une livraison après création ou modification : figé à la
 * création, réévalué seulement si la date de livraison change.
 */
export function priceForDelivery(
  existing: Pick<Delivery, 'deliveryDate' | 'unitPriceCentsApplied'> | null | undefined,
  deliveryDate: IsoDate,
  prices: readonly PriceLike[],
): Cents | null {
  if (existing && existing.deliveryDate === deliveryDate) return existing.unitPriceCentsApplied
  return priceAt(deliveryDate, prices)
}

// ---------------------------------------------------------------------
// Livraisons
// ---------------------------------------------------------------------

type DeliveryCounts = Pick<Delivery, 'bottlesTotal' | 'bottlesF1'>
type DeliveryAmounts = DeliveryCounts & Pick<Delivery, 'unitPriceCentsApplied'>

/** Bonbonnes du Foyer 2 : la différence, jamais saisie. */
export function bottlesF2(delivery: DeliveryCounts): number {
  return delivery.bottlesTotal - delivery.bottlesF1
}

/** Montant dû par le Foyer 2 pour une livraison. */
export function deliveryF2Cents(delivery: DeliveryAmounts): Cents {
  return bottlesF2(delivery) * delivery.unitPriceCentsApplied
}

/** Part du Foyer 1 dans une livraison. */
export function deliveryF1Cents(delivery: DeliveryAmounts): Cents {
  return delivery.bottlesF1 * delivery.unitPriceCentsApplied
}

/** Montant total facturé par Odezil pour une livraison. */
export function deliveryTotalCents(delivery: Pick<Delivery, 'bottlesTotal' | 'unitPriceCentsApplied'>): Cents {
  return delivery.bottlesTotal * delivery.unitPriceCentsApplied
}

/** Date de la livraison la plus récente, hors `excludeId`. */
export function latestDeliveryDate(deliveries: readonly Pick<Delivery, 'id' | 'deliveryDate'>[], excludeId?: string | null): IsoDate | null {
  let latest: IsoDate | null = null
  for (const delivery of deliveries) {
    if (delivery.id !== excludeId && (latest === null || delivery.deliveryDate > latest)) latest = delivery.deliveryDate
  }
  return latest
}

// ---------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------

type ReplacementLike = Pick<Replacement, 'id' | 'replacedAt' | 'deliveryId'>

/** Ordre d'attribution : les plus anciens d'abord, puis par identifiant (déterministe). */
export function compareReplacements(a: Pick<Replacement, 'id' | 'replacedAt'>, b: Pick<Replacement, 'id' | 'replacedAt'>): number {
  const byTime = Date.parse(a.replacedAt) - Date.parse(b.replacedAt)
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Un remplacement rattaché à une livraison est verrouillé. */
export function isLocked(replacement: Pick<Replacement, 'deliveryId'>): boolean {
  return replacement.deliveryId !== null
}

export type AllocationWarning =
  /** Plus de remplacements candidats que de bonbonnes livrées : l'excédent reste en attente. */
  | { kind: 'carried_over'; count: number }
  /** Aucun remplacement candidat : tout va au Foyer 2 (confirmation requise). */
  | { kind: 'none_recorded' }
  /** Date antérieure à la dernière livraison enregistrée. */
  | { kind: 'earlier_than_last'; lastDate: IsoDate }

export interface AllocationInput {
  deliveryDate: IsoDate
  /** Total des bonbonnes remplacées par Odezil (≥ 1). */
  bottlesTotal: number
  /** Tous les remplacements connus (le filtrage des candidats est fait ici). */
  replacements: readonly ReplacementLike[]
  /** Livraison recalculée : ses remplacements actuels redeviennent candidats. */
  deliveryId?: string | null
  /** Date de la dernière autre livraison enregistrée (avertissement). */
  lastDeliveryDate?: IsoDate | null
}

export interface Allocation {
  bottlesF1: number
  bottlesF2: number
  /** Remplacements rattachés à la livraison (les plus anciens d'abord). */
  attachedIds: string[]
  /** Candidats en excédent, qui restent en attente. */
  carriedOverIds: string[]
  warnings: AllocationWarning[]
  /** Validation à confirmer explicitement (aucun remplacement enregistré). */
  requiresConfirmation: boolean
}

/**
 * Règle d'attribution d'une livraison (date D, total T) :
 * 1. candidats = remplacements en attente (ou déjà rattachés à cette
 *    livraison lors d'un recalcul) dont le jour à Maurice est ≤ D ;
 * 2. Foyer 1 = n = min(candidats, T), les plus anciens d'abord ;
 * 3. Foyer 2 = T − n ;
 * 4. l'excédent de candidats reste en attente, avec un avertissement ;
 * 5. aucun candidat : confirmation explicite requise ;
 * 6. D antérieure à la dernière livraison : avertissement.
 */
export function allocateDelivery(input: AllocationInput): Allocation {
  if (!Number.isInteger(input.bottlesTotal) || input.bottlesTotal < 1) {
    throw new RangeError('Le total de bonbonnes doit être un entier positif.')
  }
  const own = input.deliveryId ?? null
  const candidates = input.replacements
    .filter((r) => (r.deliveryId === null || (own !== null && r.deliveryId === own)) && mauritiusDateOf(r.replacedAt) <= input.deliveryDate)
    .sort(compareReplacements)
  const bottlesF1 = Math.min(candidates.length, input.bottlesTotal)
  const attachedIds = candidates.slice(0, bottlesF1).map((r) => r.id)
  const carriedOverIds = candidates.slice(bottlesF1).map((r) => r.id)

  const warnings: AllocationWarning[] = []
  if (carriedOverIds.length > 0) warnings.push({ kind: 'carried_over', count: carriedOverIds.length })
  if (candidates.length === 0) warnings.push({ kind: 'none_recorded' })
  if (input.lastDeliveryDate && input.deliveryDate < input.lastDeliveryDate) {
    warnings.push({ kind: 'earlier_than_last', lastDate: input.lastDeliveryDate })
  }

  return {
    bottlesF1,
    bottlesF2: input.bottlesTotal - bottlesF1,
    attachedIds,
    carriedOverIds,
    warnings,
    requiresConfirmation: candidates.length === 0,
  }
}

/** Texte d'un avertissement d'attribution, tel qu'affiché. */
export function allocationWarningMessage(warning: AllocationWarning, formatDate: (date: IsoDate) => string = (d) => d): string {
  switch (warning.kind) {
    case 'carried_over': {
      const s = warning.count > 1 ? 's' : ''
      return `${warning.count} remplacement${s} reporté${s} : plus de remplacements enregistrés que de bonbonnes livrées, vérifie tes saisies.`
    }
    case 'none_recorded':
      return 'Aucun remplacement enregistré pour le Foyer 1 : toutes les bonbonnes seront attribuées au Foyer 2.'
    case 'earlier_than_last':
      return `Cette date est antérieure à la dernière livraison enregistrée (${formatDate(warning.lastDate)}) : la répartition se fait sur les remplacements restants.`
  }
}

export interface DeliveryFigures {
  bottlesTotal: number
  bottlesF1: number
  bottlesF2: number
  unitPriceCents: Cents
  f2Cents: Cents
}

export interface DeliveryEditPreview {
  before: DeliveryFigures | null
  after: DeliveryFigures
  allocation: Allocation
  /** Le montant ou la répartition change. */
  changed: boolean
}

/**
 * Aperçu d'une création, d'un recalcul ou d'une modification (date,
 * total) : répartition et montant du Foyer 2 avant et après.
 * Renvoie null si aucun prix n'est en vigueur à la date choisie.
 */
export function previewDelivery(input: {
  existing?: Delivery | null
  deliveryDate: IsoDate
  bottlesTotal: number
  replacements: readonly ReplacementLike[]
  deliveries: readonly Pick<Delivery, 'id' | 'deliveryDate'>[]
  prices: readonly PriceLike[]
}): DeliveryEditPreview | null {
  const existing = input.existing ?? null
  const unitPriceCents = priceForDelivery(existing, input.deliveryDate, input.prices)
  if (unitPriceCents === null) return null
  const allocation = allocateDelivery({
    deliveryDate: input.deliveryDate,
    bottlesTotal: input.bottlesTotal,
    replacements: input.replacements,
    deliveryId: existing?.id ?? null,
    lastDeliveryDate: latestDeliveryDate(input.deliveries, existing?.id),
  })
  const after: DeliveryFigures = {
    bottlesTotal: input.bottlesTotal,
    bottlesF1: allocation.bottlesF1,
    bottlesF2: allocation.bottlesF2,
    unitPriceCents,
    f2Cents: allocation.bottlesF2 * unitPriceCents,
  }
  const before: DeliveryFigures | null = existing
    ? {
        bottlesTotal: existing.bottlesTotal,
        bottlesF1: existing.bottlesF1,
        bottlesF2: bottlesF2(existing),
        unitPriceCents: existing.unitPriceCentsApplied,
        f2Cents: deliveryF2Cents(existing),
      }
    : null
  const changed =
    !before ||
    before.bottlesTotal !== after.bottlesTotal ||
    before.bottlesF1 !== after.bottlesF1 ||
    before.f2Cents !== after.f2Cents ||
    existing?.deliveryDate !== input.deliveryDate
  return { before, after, allocation, changed }
}

// ---------------------------------------------------------------------
// Rapprochement SOA
// ---------------------------------------------------------------------

export function deliveriesOfMonth<T extends Pick<Delivery, 'deliveryDate'>>(deliveries: readonly T[], month: IsoMonth): T[] {
  return deliveries.filter((d) => monthOf(d.deliveryDate) === month).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
}

/** Total attendu d'un mois : Σ (bottles_total × prix appliqué) des livraisons du mois. */
export function expectedMonthCents(deliveries: readonly Pick<Delivery, 'deliveryDate' | 'bottlesTotal' | 'unitPriceCentsApplied'>[], month: IsoMonth): Cents {
  return deliveriesOfMonth(deliveries, month).reduce((sum, d) => sum + deliveryTotalCents(d), 0)
}

/** Écart d'un mois : total SOA − total attendu (positif ou négatif). */
export function monthVarianceCents(totalBilledCents: Cents, expectedCents: Cents): Cents {
  return totalBilledCents - expectedCents
}

/**
 * Part de l'écart imputée au Foyer 2. Identique à la colonne générée
 * f2_adjustment_cents : moitié tronquée vers zéro pour un partage, le
 * reste revenant au Foyer 1.
 */
export function f2Adjustment(varianceCents: Cents, treatment: VarianceTreatment): Cents {
  switch (treatment) {
    case 'impute_to_f2':
      return varianceCents
    case 'split_50_50':
      // + 0 : évite le « −0 » de Math.trunc(−1 / 2).
      return Math.trunc(varianceCents / 2) + 0
    case 'impute_to_f1':
    case 'pending':
      return 0
  }
}

export type MonthStatus =
  /** Aucun SOA saisi pour ce mois. */
  | 'no_soa'
  /** SOA conforme au total attendu. */
  | 'reconciled'
  /** Écart non nul, traitement à choisir. */
  | 'to_treat'
  /** Écart non nul, traité. */
  | 'treated'
  /** Les livraisons du mois ont changé depuis le rapprochement. */
  | 'stale'

export interface MonthSummary<D extends Delivery = Delivery> {
  month: IsoMonth
  deliveries: D[]
  bottlesTotal: number
  bottlesF1: number
  bottlesF2: number
  expectedCents: Cents
  f1Cents: Cents
  f2Cents: Cents
  soa: SoaStatement | null
  /** Écart figé lors du rapprochement. */
  varianceCents: Cents | null
  /** Écart recalculé avec les livraisons actuelles. */
  currentVarianceCents: Cents | null
  f2AdjustmentCents: Cents
  status: MonthStatus
}

export function summarizeMonth<D extends Delivery>(month: IsoMonth, deliveries: readonly D[], soa: SoaStatement | null): MonthSummary<D> {
  const ofMonth = deliveriesOfMonth(deliveries, month)
  let bottlesTotal = 0
  let bottlesF1 = 0
  let expectedCents = 0
  let f1Cents = 0
  let f2Cents = 0
  for (const d of ofMonth) {
    bottlesTotal += d.bottlesTotal
    bottlesF1 += d.bottlesF1
    expectedCents += deliveryTotalCents(d)
    f1Cents += deliveryF1Cents(d)
    f2Cents += deliveryF2Cents(d)
  }
  const currentVarianceCents = soa ? monthVarianceCents(soa.totalBilledCents, expectedCents) : null
  let status: MonthStatus = 'no_soa'
  if (soa) {
    if (currentVarianceCents !== soa.varianceCents) status = 'stale'
    else if (soa.varianceCents === 0) status = 'reconciled'
    else status = soa.varianceTreatment === 'pending' ? 'to_treat' : 'treated'
  }
  return {
    month,
    deliveries: ofMonth,
    bottlesTotal,
    bottlesF1,
    bottlesF2: bottlesTotal - bottlesF1,
    expectedCents,
    f1Cents,
    f2Cents,
    soa,
    varianceCents: soa ? soa.varianceCents : null,
    currentVarianceCents,
    f2AdjustmentCents: soa ? f2Adjustment(soa.varianceCents, soa.varianceTreatment) : 0,
    status,
  }
}

/** Mois ayant au moins une livraison ou un SOA, du plus récent au plus ancien. */
export function summarizeMonths<D extends Delivery>(deliveries: readonly D[], soas: readonly SoaStatement[]): MonthSummary<D>[] {
  const months = new Set<IsoMonth>([...deliveries.map((d) => monthOf(d.deliveryDate)), ...soas.map((s) => s.month)])
  const byMonth = new Map(soas.map((s) => [s.month, s]))
  return [...months].sort().reverse().map((month) => summarizeMonth(month, deliveries, byMonth.get(month) ?? null))
}

// ---------------------------------------------------------------------
// Solde du Foyer 2
// ---------------------------------------------------------------------

export interface Balance {
  /** Σ des parts Foyer 2 des livraisons. */
  chargesCents: Cents
  /** Σ des écarts imputés au Foyer 2 (positifs ou négatifs). */
  adjustmentsCents: Cents
  /** Σ des remboursements reçus. */
  repaymentsCents: Cents
  /** Ce que le Foyer 2 doit encore (négatif : avance). */
  balanceCents: Cents
}

/** Solde du Foyer 2 = Σ parts Foyer 2 + Σ ajustements − Σ remboursements. */
export function balanceF2(data: {
  deliveries: readonly DeliveryAmounts[]
  soas: readonly Pick<SoaStatement, 'varianceCents' | 'varianceTreatment'>[]
  repayments: readonly Pick<Repayment, 'amountCents'>[]
}): Balance {
  const chargesCents = data.deliveries.reduce((sum, d) => sum + deliveryF2Cents(d), 0)
  const adjustmentsCents = data.soas.reduce((sum, s) => sum + f2Adjustment(s.varianceCents, s.varianceTreatment), 0)
  const repaymentsCents = data.repayments.reduce((sum, r) => sum + r.amountCents, 0)
  return { chargesCents, adjustmentsCents, repaymentsCents, balanceCents: chargesCents + adjustmentsCents - repaymentsCents }
}

// ---------------------------------------------------------------------
// Consommation du Foyer 1
// ---------------------------------------------------------------------

/** Remplacements en attente de livraison. */
export function pendingReplacements<R extends Pick<Replacement, 'deliveryId'>>(replacements: readonly R[]): R[] {
  return replacements.filter((r) => r.deliveryId === null)
}

/** Nombre de remplacements par mois (à l'heure de Maurice), du plus récent au plus ancien. */
export function consumptionByMonth(replacements: readonly Pick<Replacement, 'replacedAt'>[]): { month: IsoMonth; count: number }[] {
  const counts = new Map<IsoMonth, number>()
  for (const r of replacements) {
    const month = monthOf(mauritiusDateOf(r.replacedAt))
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, count]) => ({ month, count }))
}

/**
 * Moyenne hebdomadaire depuis le premier remplacement enregistré (jour
 * inclus) jusqu'à aujourd'hui ; au moins une semaine. Null sans données.
 */
export function weeklyAverage(replacements: readonly Pick<Replacement, 'replacedAt'>[], today: IsoDate): number | null {
  if (replacements.length === 0) return null
  let first: IsoDate = today
  for (const r of replacements) {
    const day = mauritiusDateOf(r.replacedAt)
    if (day < first) first = day
  }
  const days = Math.max(7, diffDays(first, today) + 1)
  return (replacements.length * 7) / days
}
