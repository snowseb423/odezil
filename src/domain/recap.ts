// Message récapitulatif mensuel pour le Foyer 2 (prêt pour WhatsApp),
// fondé uniquement sur ses bonbonnes, ses ajustements et ses remboursements.
import { bottlesF2, deliveriesOfMonth, f2Adjustment } from './calculations.ts'
import { firstDayOfMonth } from './dates.ts'
import { formatMonth, formatRs, plural } from './format.ts'
import type { Cents, Delivery, IsoMonth, Repayment, SoaStatement } from './types.ts'

export interface RecapLine {
  bottles: number
  unitPriceCents: Cents
  amountCents: Cents
}

export interface MonthRecap {
  month: IsoMonth
  /** Bonbonnes du Foyer 2 regroupées par prix unitaire. */
  lines: RecapLine[]
  bottles: number
  deliveriesCents: Cents
  /** Écart SOA imputé au Foyer 2 pour ce mois. */
  adjustmentCents: Cents
  /** Montant du mois : livraisons + ajustement. */
  monthCents: Cents
  /** Charges des mois précédents − tous les remboursements reçus. */
  previousBalanceCents: Cents
  /** Total à régler = solde antérieur + montant du mois. */
  totalCents: Cents
}

type RecapDelivery = Pick<Delivery, 'deliveryDate' | 'bottlesTotal' | 'bottlesF1' | 'unitPriceCentsApplied'>
type RecapSoa = Pick<SoaStatement, 'month' | 'varianceCents' | 'varianceTreatment'>

export function monthRecap(
  month: IsoMonth,
  data: { deliveries: readonly RecapDelivery[]; soas: readonly RecapSoa[]; repayments: readonly Pick<Repayment, 'amountCents'>[] },
): MonthRecap {
  const byPrice = new Map<Cents, number>()
  for (const delivery of deliveriesOfMonth(data.deliveries, month)) {
    const bottles = bottlesF2(delivery)
    if (bottles > 0) byPrice.set(delivery.unitPriceCentsApplied, (byPrice.get(delivery.unitPriceCentsApplied) ?? 0) + bottles)
  }
  const lines = [...byPrice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([unitPriceCents, bottles]) => ({ bottles, unitPriceCents, amountCents: bottles * unitPriceCents }))
  const deliveriesCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const adjustmentCents = data.soas
    .filter((soa) => soa.month === month)
    .reduce((sum, soa) => sum + f2Adjustment(soa.varianceCents, soa.varianceTreatment), 0)

  const start = firstDayOfMonth(month)
  const earlierCharges = data.deliveries
    .filter((d) => d.deliveryDate < start)
    .reduce((sum, d) => sum + bottlesF2(d) * d.unitPriceCentsApplied, 0)
  const earlierAdjustments = data.soas
    .filter((soa) => soa.month < month)
    .reduce((sum, soa) => sum + f2Adjustment(soa.varianceCents, soa.varianceTreatment), 0)
  const repaid = data.repayments.reduce((sum, r) => sum + r.amountCents, 0)
  const previousBalanceCents = earlierCharges + earlierAdjustments - repaid
  const monthCents = deliveriesCents + adjustmentCents

  return {
    month,
    lines,
    bottles: lines.reduce((sum, line) => sum + line.bottles, 0),
    deliveriesCents,
    adjustmentCents,
    monthCents,
    previousBalanceCents,
    totalCents: previousBalanceCents + monthCents,
  }
}

/** « d’octobre 2026 », « de mars 2027 » (élision devant une voyelle). */
function ofMonth(month: IsoMonth): string {
  const label = formatMonth(month)
  return /^[aeiouyéè]/i.test(label) ? `d’${label}` : `de ${label}`
}

function describeLine(l: RecapLine): string {
  return `${plural(l.bottles, 'bonbonne')} × ${formatRs(l.unitPriceCents)} = ${formatRs(l.amountCents)}`
}

/**
 * Texte prêt à copier, par exemple :
 * « Bonjour, récap eau d’octobre 2026 : 3 bonbonnes × Rs 240,00 = Rs 720,00.
 *   Solde antérieur : Rs 240,00. Total à régler : Rs 960,00. Merci ! »
 * Le solde antérieur n'apparaît que s'il est non nul.
 */
export function recapMessage(recap: MonthRecap): string {
  const parts: string[] = []
  if (recap.lines.length === 0) {
    parts.push(`Bonjour, récap eau ${ofMonth(recap.month)} : aucune bonbonne pour vous ce mois-ci.`)
  } else if (recap.lines.length === 1) {
    parts.push(`Bonjour, récap eau ${ofMonth(recap.month)} : ${describeLine(recap.lines[0]!)}.`)
  } else {
    parts.push(`Bonjour, récap eau ${ofMonth(recap.month)} : ${recap.lines.map(describeLine).join(' ; ')}, soit ${formatRs(recap.deliveriesCents)}.`)
  }
  if (recap.adjustmentCents !== 0) {
    parts.push(`Ajustement selon le relevé Odezil : ${formatRs(recap.adjustmentCents, { signed: true })}.`)
  }
  if (recap.previousBalanceCents !== 0) {
    parts.push(`Solde antérieur : ${formatRs(recap.previousBalanceCents)}.`)
  }
  if (recap.totalCents >= 0) {
    parts.push(`Total à régler : ${formatRs(recap.totalCents)}.`)
  } else {
    parts.push(`Rien à régler : vous avez une avance de ${formatRs(-recap.totalCents)}.`)
  }
  parts.push('Merci !')
  return parts.join(' ')
}
