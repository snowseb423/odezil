// Données de la page du Foyer 2, telles que renvoyées par la RPC
// get_shared_view (uniquement ses données), et leur lecture défensive.
import type { Cents, IsoDate, IsoMonth } from '../domain/types.ts'

export interface SharedDelivery {
  date: IsoDate
  bottles: number
  unitPriceCents: Cents
  amountCents: Cents
}

export interface SharedMonth {
  month: IsoMonth
  deliveriesCents: Cents
  adjustmentCents: Cents
  totalCents: Cents
}

export interface SharedView {
  generatedAt: string
  deliveries: SharedDelivery[]
  months: SharedMonth[]
  repayments: { date: IsoDate; amountCents: Cents }[]
  balanceCents: Cents
}

type Json = Record<string, unknown>

const int = (value: unknown): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : [])

/** Réponse de la RPC → données affichées (null : lien invalide ou révoqué). */
export function parseSharedView(raw: unknown): SharedView | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Json
  return {
    generatedAt: text(data.generated_at),
    deliveries: list(data.deliveries).map((d) => ({
      date: text(d.date).slice(0, 10),
      bottles: int(d.bottles),
      unitPriceCents: int(d.unit_price_cents),
      amountCents: int(d.amount_cents),
    })),
    months: list(data.months).map((m) => ({
      month: text(m.month).slice(0, 7),
      deliveriesCents: int(m.deliveries_cents),
      adjustmentCents: int(m.adjustment_cents),
      totalCents: int(m.total_cents),
    })),
    repayments: list(data.repayments).map((r) => ({ date: text(r.date).slice(0, 10), amountCents: int(r.amount_cents) })),
    balanceCents: int(data.balance_cents),
  }
}
