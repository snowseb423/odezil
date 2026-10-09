import { describe, expect, it } from 'vitest'
import { summarizeMonths } from '../domain/calculations.ts'
import type { Delivery, SoaStatement } from '../domain/types.ts'
import { csvField, csvMoney, deliveriesCsv, monthsCsv } from './csv.ts'

const DELIVERIES: Delivery[] = [
  { id: 'd1', deliveryDate: '2026-09-15', bottlesTotal: 5, bottlesF1: 2, unitPriceCentsApplied: 24_000, documentPath: 'deliveries/d1/x.jpg', note: 'livreur ; en retard' },
  { id: 'd2', deliveryDate: '2026-10-02', bottlesTotal: 4, bottlesF1: 4, unitPriceCentsApplied: 24_000, documentPath: null, note: null },
]
const SOAS: SoaStatement[] = [
  { id: 's9', month: '2026-09', totalBilledCents: 121_001, varianceCents: 1_001, varianceTreatment: 'split_50_50', documentPath: null, note: null },
]

describe('export CSV', () => {
  it('formate les montants en centimes sans flottant', () => {
    expect(csvMoney(120_050)).toBe('1200,50')
    expect(csvMoney(-2_400)).toBe('-24,00')
    expect(csvMoney(5)).toBe('0,05')
  })

  it('échappe les champs contenant ; " ou un retour à la ligne', () => {
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('dit "oui"')).toBe('"dit ""oui"""')
    expect(csvField(null)).toBe('')
  })

  it('historique mensuel : BOM, séparateur « ; », une ligne par mois', () => {
    const csv = monthsCsv(summarizeMonths(DELIVERIES, SOAS))
    expect(csv.startsWith('﻿Mois;Livraisons;Bonbonnes livrées;Foyer 1;Foyer 2;')).toBe(true)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('2026-10;1;4;4;0;960,00;0,00;960,00;;;;0,00;SOA à saisir')
    expect(lines[2]).toBe('2026-09;1;5;2;3;480,00;720,00;1200,00;1210,01;10,01;Partagé 50/50;5,00;Écart traité')
  })

  it('détail des livraisons, du plus ancien au plus récent', () => {
    const lines = deliveriesCsv(DELIVERIES).trimEnd().split('\r\n')
    expect(lines[1]).toBe('2026-09-15;5;2;3;240,00;480,00;720,00;1200,00;oui;"livreur ; en retard"')
    expect(lines[2]).toBe('2026-10-02;4;4;0;240,00;960,00;0,00;960,00;non;')
  })
})
