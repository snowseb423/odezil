// Conversion entre les lignes Supabase (snake_case) et les types du domaine.
import { VARIANCE_TREATMENTS, type Delivery, type Price, type Replacement, type Repayment, type SoaStatement, type VarianceTreatment } from '../domain/types.ts'
import type { ShareLink } from './db.ts'

export type Json = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))
const nullableText = (value: unknown): string | null => (value == null || value === '' ? null : String(value))
const int = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}
/** Horodatage normalisé en ISO UTC (« 2026-10-14T21:30:00.000Z »). */
const timestamp = (value: unknown): string => {
  const moment = new Date(text(value))
  return Number.isNaN(moment.getTime()) ? text(value) : moment.toISOString()
}
const isoDate = (value: unknown): string => text(value).slice(0, 10)

export function toPrice(row: Json): Price {
  return { id: text(row.id), unitPriceCents: int(row.unit_price_cents), effectiveFrom: isoDate(row.effective_from) }
}

export function toReplacement(row: Json): Replacement {
  return { id: text(row.id), replacedAt: timestamp(row.replaced_at), note: nullableText(row.note), deliveryId: nullableText(row.delivery_id) }
}

export function toDelivery(row: Json): Delivery {
  return {
    id: text(row.id),
    deliveryDate: isoDate(row.delivery_date),
    bottlesTotal: int(row.bottles_total),
    bottlesF1: int(row.bottles_f1),
    unitPriceCentsApplied: int(row.unit_price_cents_applied),
    documentPath: nullableText(row.document_path),
    note: nullableText(row.note),
  }
}

function treatment(value: unknown): VarianceTreatment {
  return (VARIANCE_TREATMENTS as readonly string[]).includes(text(value)) ? (text(value) as VarianceTreatment) : 'pending'
}

export function toSoa(row: Json): SoaStatement {
  return {
    id: text(row.id),
    month: text(row.month).slice(0, 7),
    totalBilledCents: int(row.total_billed_cents),
    varianceCents: int(row.variance_cents),
    varianceTreatment: treatment(row.variance_treatment),
    documentPath: nullableText(row.document_path),
    note: nullableText(row.note),
  }
}

export function toRepayment(row: Json): Repayment {
  return { id: text(row.id), repaymentDate: isoDate(row.repayment_date), amountCents: int(row.amount_cents), note: nullableText(row.note) }
}

export function toShareLink(row: Json): ShareLink {
  return { id: text(row.id), createdAt: timestamp(row.created_at) }
}

// ---- Domaine → colonnes ----

export function replacementColumns(r: Pick<Replacement, 'id' | 'replacedAt' | 'note'>): Json {
  return { id: r.id, replaced_at: r.replacedAt, note: r.note }
}

export function deliveryPayload(d: Pick<Delivery, 'id' | 'deliveryDate' | 'bottlesTotal' | 'note'>): Json {
  return { id: d.id, delivery_date: d.deliveryDate, bottles_total: d.bottlesTotal, note: d.note }
}

export function soaColumns(s: Omit<SoaStatement, 'documentPath'>): Json {
  return {
    id: s.id,
    month: `${s.month}-01`,
    total_billed_cents: s.totalBilledCents,
    variance_cents: s.varianceCents,
    variance_treatment: s.varianceTreatment,
    note: s.note,
  }
}

export function repaymentColumns(r: Repayment): Json {
  return { id: r.id, repayment_date: r.repaymentDate, amount_cents: r.amountCents, note: r.note }
}

export function priceColumns(p: Price): Json {
  return { id: p.id, unit_price_cents: p.unitPriceCents, effective_from: p.effectiveFrom }
}
