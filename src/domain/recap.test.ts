import { describe, expect, it } from 'vitest'
import { monthRecap, recapMessage } from './recap.ts'
import type { Delivery, SoaStatement } from './types.ts'

const NNBSP = '\u202F'

function delivery(id: string, deliveryDate: string, bottlesTotal: number, bottlesF1: number, unitPriceCentsApplied = 24_000): Delivery {
  return { id, deliveryDate, bottlesTotal, bottlesF1, unitPriceCentsApplied, documentPath: null, note: null }
}

const DELIVERIES = [
  delivery('d1', '2026-09-20', 3, 2), // septembre : 1 bonbonne F2
  delivery('d2', '2026-10-02', 4, 2), // octobre : 2
  delivery('d3', '2026-10-16', 3, 2), // octobre : 1
  delivery('d4', '2026-11-03', 2, 0, 25_000), // novembre : 2 à Rs 250
]

const SOAS: SoaStatement[] = [
  { id: 's9', month: '2026-09', totalBilledCents: 74_400, varianceCents: 2_400, varianceTreatment: 'impute_to_f2', documentPath: null, note: null },
]

describe('message récapitulatif', () => {
  it('reprend le mois, le solde antérieur et le total à régler', () => {
    const recap = monthRecap('2026-10', { deliveries: DELIVERIES, soas: SOAS, repayments: [] })
    expect(recap).toMatchObject({
      bottles: 3,
      deliveriesCents: 72_000,
      adjustmentCents: 0,
      monthCents: 72_000,
      previousBalanceCents: 26_400, // septembre : 24 000 + ajustement 2 400
      totalCents: 98_400,
    })
    expect(recapMessage(recap)).toBe(
      'Bonjour, récap eau d’octobre 2026 : 3 bonbonnes × Rs\u00A0240,00 = Rs\u00A0720,00. ' +
        'Solde antérieur : Rs\u00A0264,00. Total à régler : Rs\u00A0984,00. Merci !',
    )
  })

  it('n’affiche pas le solde antérieur s’il est nul', () => {
    const recap = monthRecap('2026-10', { deliveries: DELIVERIES, soas: SOAS, repayments: [{ amountCents: 26_400 }] })
    expect(recap.previousBalanceCents).toBe(0)
    const message = recapMessage(recap)
    expect(message).not.toContain('Solde antérieur')
    expect(message).toContain(`Total à régler : Rs\u00A0720,00. Merci !`)
  })

  it('les remboursements réduisent le total, une avance est annoncée comme telle', () => {
    const recap = monthRecap('2026-10', { deliveries: DELIVERIES, soas: SOAS, repayments: [{ amountCents: 100_000 }] })
    expect(recap.totalCents).toBe(-1_600)
    expect(recapMessage(recap)).toContain(`Rien à régler : vous avez une avance de Rs\u00A016,00.`)
  })

  it('détaille plusieurs prix dans le mois et l’ajustement du relevé', () => {
    const deliveries = [...DELIVERIES, delivery('d5', '2026-11-20', 2, 1, 24_000)]
    const soas: SoaStatement[] = [
      ...SOAS,
      { id: 's11', month: '2026-11', totalBilledCents: 0, varianceCents: -1_001, varianceTreatment: 'split_50_50', documentPath: null, note: null },
    ]
    const message = recapMessage(monthRecap('2026-11', { deliveries, soas, repayments: [] }))
    expect(message).toContain(`1 bonbonne × Rs\u00A0240,00 = Rs\u00A0240,00 ; 2 bonbonnes × Rs\u00A0250,00 = Rs\u00A0500,00, soit Rs\u00A0740,00.`)
    expect(message).toContain(`Ajustement selon le relevé Odezil : −Rs\u00A05,00.`)
    expect(message.startsWith('Bonjour, récap eau de novembre 2026 :')).toBe(true)
  })

  it('un mois sans bonbonne pour le Foyer 2', () => {
    const recap = monthRecap('2026-12', { deliveries: DELIVERIES, soas: SOAS, repayments: [] })
    expect(recap.bottles).toBe(0)
    expect(recapMessage(recap)).toMatch(/^Bonjour, récap eau de décembre 2026 : aucune bonbonne pour vous ce mois-ci\./)
  })

  it('les milliers sont séparés par une espace fine insécable', () => {
    const big = [delivery('d9', '2027-01-10', 60, 0)]
    expect(recapMessage(monthRecap('2027-01', { deliveries: big, soas: [], repayments: [] }))).toContain(`Rs\u00A014${NNBSP}400,00`)
  })
})
