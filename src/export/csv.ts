// CSV pour Excel en français (repris de Presence) : séparateur « ; »,
// virgule décimale, BOM UTF-8 (accents correctement lus), fins de ligne CRLF.
import { type MonthStatus, type MonthSummary, bottlesF2, deliveryF1Cents, deliveryF2Cents, deliveryTotalCents } from '../domain/calculations.ts'
import type { Cents, Delivery, VarianceTreatment } from '../domain/types.ts'

export type Cell = string | number | null

const BOM = '﻿'

/** Centimes → « 1200,50 », « -24,00 » (sans séparateur de milliers). */
export function csvMoney(cents: Cents): string {
  const abs = Math.abs(Math.round(cents))
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

export function csvField(value: Cell): string {
  if (value === null) return ''
  const text = String(value)
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return BOM + rows.map((row) => row.map(csvField).join(';')).join('\r\n') + '\r\n'
}

const STATUS_LABELS: Record<MonthStatus, string> = {
  no_soa: 'SOA à saisir',
  reconciled: 'Rapproché',
  to_treat: 'Écart à traiter',
  treated: 'Écart traité',
  stale: 'Livraisons modifiées depuis le rapprochement',
}

const TREATMENT_LABELS: Record<VarianceTreatment, string> = {
  pending: 'En attente',
  impute_to_f1: 'Imputé au Foyer 1',
  impute_to_f2: 'Imputé au Foyer 2',
  split_50_50: 'Partagé 50/50',
}

export const MONTH_HEADERS = [
  'Mois',
  'Livraisons',
  'Bonbonnes livrées',
  'Foyer 1',
  'Foyer 2',
  'Part Foyer 1 (Rs)',
  'Part Foyer 2 (Rs)',
  'Total attendu (Rs)',
  'Total SOA (Rs)',
  'Écart (Rs)',
  'Traitement de l’écart',
  'Ajustement Foyer 2 (Rs)',
  'Statut',
] as const

/** Historique mensuel : une ligne par mois. */
export function monthsCsv(months: readonly MonthSummary[]): string {
  const rows: Cell[][] = months.map((m) => [
    m.month,
    m.deliveries.length,
    m.bottlesTotal,
    m.bottlesF1,
    m.bottlesF2,
    csvMoney(m.f1Cents),
    csvMoney(m.f2Cents),
    csvMoney(m.expectedCents),
    m.soa ? csvMoney(m.soa.totalBilledCents) : null,
    m.varianceCents === null ? null : csvMoney(m.varianceCents),
    m.soa && m.soa.varianceCents !== 0 ? TREATMENT_LABELS[m.soa.varianceTreatment] : null,
    csvMoney(m.f2AdjustmentCents),
    STATUS_LABELS[m.status],
  ])
  return toCsv([[...MONTH_HEADERS], ...rows])
}

export const DELIVERY_HEADERS = [
  'Date',
  'Bonbonnes livrées',
  'Foyer 1',
  'Foyer 2',
  'Prix unitaire (Rs)',
  'Part Foyer 1 (Rs)',
  'Part Foyer 2 (Rs)',
  'Total (Rs)',
  'Bon joint',
  'Note',
] as const

/** Détail des livraisons, de la plus ancienne à la plus récente. */
export function deliveriesCsv(deliveries: readonly Delivery[]): string {
  const rows: Cell[][] = [...deliveries]
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    .map((d) => [
      d.deliveryDate,
      d.bottlesTotal,
      d.bottlesF1,
      bottlesF2(d),
      csvMoney(d.unitPriceCentsApplied),
      csvMoney(deliveryF1Cents(d)),
      csvMoney(deliveryF2Cents(d)),
      csvMoney(deliveryTotalCents(d)),
      d.documentPath ? 'oui' : 'non',
      d.note,
    ])
  return toCsv([[...DELIVERY_HEADERS], ...rows])
}
