import { describe, expect, it } from 'vitest'
import {
  allocateDelivery,
  allocationWarningMessage,
  balanceF2,
  bottlesF2,
  consumptionByMonth,
  deliveryF2Cents,
  expectedMonthCents,
  f2Adjustment,
  isLocked,
  monthVarianceCents,
  previewDelivery,
  priceAt,
  priceForDelivery,
  summarizeMonth,
  summarizeMonths,
  weeklyAverage,
} from './calculations.ts'
import type { Delivery, Price, Replacement, SoaStatement, VarianceTreatment } from './types.ts'

const PRICES: Price[] = [
  { id: 'p1', unitPriceCents: 24_000, effectiveFrom: '2000-01-01' },
  { id: 'p2', unitPriceCents: 25_000, effectiveFrom: '2026-11-01' },
]

/** Remplacement à une heure de Maurice donnée (« 2026-10-03 08:00 »). */
function rep(id: string, mauritius: string, deliveryId: string | null = null): Replacement {
  const [date, time] = mauritius.split(' ') as [string, string]
  return { id, replacedAt: new Date(`${date}T${time}:00+04:00`).toISOString(), note: null, deliveryId }
}

function delivery(partial: Partial<Delivery> & Pick<Delivery, 'id' | 'deliveryDate' | 'bottlesTotal' | 'bottlesF1'>): Delivery {
  return { unitPriceCentsApplied: 24_000, documentPath: null, note: null, ...partial }
}

function soa(month: string, totalBilledCents: number, varianceCents: number, varianceTreatment: VarianceTreatment = 'pending'): SoaStatement {
  return { id: `soa-${month}`, month, totalBilledCents, varianceCents, varianceTreatment, documentPath: null, note: null }
}

describe('prix avec date d’effet', () => {
  it('applique le prix le plus récent dont la date d’effet est passée', () => {
    expect(priceAt('2026-10-31', PRICES)).toBe(24_000)
    expect(priceAt('2026-11-01', PRICES)).toBe(25_000)
    expect(priceAt('1999-12-31', PRICES)).toBeNull()
    expect(priceAt('2026-10-31', [...PRICES].reverse())).toBe(24_000)
  })

  it('un changement de prix n’altère pas une livraison existante, sauf si sa date change', () => {
    const existing = delivery({ id: 'd', deliveryDate: '2026-10-14', bottlesTotal: 4, bottlesF1: 1 })
    const pricesAfterChange: Price[] = [{ id: 'p1', unitPriceCents: 30_000, effectiveFrom: '2000-01-01' }]
    expect(priceForDelivery(existing, '2026-10-14', pricesAfterChange)).toBe(24_000)
    expect(deliveryF2Cents(existing)).toBe(72_000)
    expect(priceForDelivery(existing, '2026-11-03', PRICES)).toBe(25_000)
    expect(priceForDelivery(null, '2026-11-03', PRICES)).toBe(25_000)
  })
})

describe('attribution d’une livraison', () => {
  const journal = [rep('a', '2026-10-01 08:00'), rep('b', '2026-10-05 19:30'), rep('c', '2026-10-09 07:15')]

  it('cas nominal : Foyer 1 = remplacements enregistrés, Foyer 2 = la différence', () => {
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 5, replacements: journal })
    expect(result).toEqual({
      bottlesF1: 3,
      bottlesF2: 2,
      attachedIds: ['a', 'b', 'c'],
      carriedOverIds: [],
      warnings: [],
      requiresConfirmation: false,
    })
  })

  it('aucun remplacement enregistré : tout au Foyer 2, confirmation requise', () => {
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 4, replacements: [] })
    expect(result).toMatchObject({ bottlesF1: 0, bottlesF2: 4, attachedIds: [], requiresConfirmation: true })
    expect(result.warnings).toEqual([{ kind: 'none_recorded' }])
    expect(allocationWarningMessage(result.warnings[0]!)).toBe(
      'Aucun remplacement enregistré pour le Foyer 1 : toutes les bonbonnes seront attribuées au Foyer 2.',
    )
  })

  it('excédent : les plus anciens sont rattachés, le reste est reporté avec un avertissement', () => {
    const many = [rep('e', '2026-10-12 09:00'), ...journal, rep('d', '2026-10-11 09:00')]
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 3, replacements: many })
    expect(result).toMatchObject({ bottlesF1: 3, bottlesF2: 0, attachedIds: ['a', 'b', 'c'], carriedOverIds: ['d', 'e'] })
    expect(result.warnings).toEqual([{ kind: 'carried_over', count: 2 }])
    expect(allocationWarningMessage(result.warnings[0]!)).toBe(
      '2 remplacements reportés : plus de remplacements enregistrés que de bonbonnes livrées, vérifie tes saisies.',
    )
    expect(allocationWarningMessage({ kind: 'carried_over', count: 1 })).toMatch(/^1 remplacement reporté :/)
  })

  it('un remplacement du jour même de la livraison est compté', () => {
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 2, replacements: [rep('x', '2026-10-14 23:59')] })
    expect(result.attachedIds).toEqual(['x'])
  })

  it('frontière de fuseau : 01 h 00 à Maurice compte pour ce jour, pas pour la veille (UTC)', () => {
    // 2026-10-15 01:00 à Maurice = 2026-10-14 21:00 UTC
    const late = rep('late', '2026-10-15 01:00')
    expect(late.replacedAt).toBe('2026-10-14T21:00:00.000Z')
    expect(allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 2, replacements: [late] }).attachedIds).toEqual([])
    expect(allocateDelivery({ deliveryDate: '2026-10-15', bottlesTotal: 2, replacements: [late] }).attachedIds).toEqual(['late'])
  })

  it('ignore les remplacements postérieurs et ceux déjà rattachés à une autre livraison', () => {
    const replacements = [rep('old', '2026-10-01 08:00', 'other'), rep('mine', '2026-10-02 08:00'), rep('next', '2026-10-20 08:00')]
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 3, replacements })
    expect(result).toMatchObject({ bottlesF1: 1, attachedIds: ['mine'], carriedOverIds: [] })
  })

  it('départage deux remplacements simultanés par identifiant', () => {
    const replacements = [rep('z', '2026-10-01 08:00'), rep('y', '2026-10-01 08:00')]
    expect(allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 1, replacements }).attachedIds).toEqual(['y'])
  })

  it('avertit si la date est antérieure à la dernière livraison enregistrée', () => {
    const result = allocateDelivery({ deliveryDate: '2026-10-10', bottlesTotal: 2, replacements: journal, lastDeliveryDate: '2026-10-14' })
    expect(result.warnings).toContainEqual({ kind: 'earlier_than_last', lastDate: '2026-10-14' })
    expect(result.attachedIds).toEqual(['a', 'b', 'c'].slice(0, 2))
  })

  it('refuse un total nul ou non entier', () => {
    expect(() => allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 0, replacements: [] })).toThrow(RangeError)
    expect(() => allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 1.5, replacements: [] })).toThrow(RangeError)
  })

  it('un remplacement rattaché est verrouillé', () => {
    expect(isLocked(rep('a', '2026-10-01 08:00', 'd1'))).toBe(true)
    expect(isLocked(rep('a', '2026-10-01 08:00'))).toBe(false)
  })
})

describe('recalcul et modification d’une livraison', () => {
  const existing = delivery({ id: 'd1', deliveryDate: '2026-10-14', bottlesTotal: 5, bottlesF1: 2 })
  const replacements = [
    rep('a', '2026-10-01 08:00', 'd1'),
    rep('b', '2026-10-05 08:00', 'd1'),
    rep('c', '2026-10-12 08:00'), // enregistré après coup (oubli)
    rep('later', '2026-10-20 08:00'),
  ]

  it('recalculer reprend les remplacements de la livraison et les oublis, aperçu avant/après', () => {
    const preview = previewDelivery({ existing, deliveryDate: '2026-10-14', bottlesTotal: 5, replacements, deliveries: [existing], prices: PRICES })
    expect(preview?.allocation.attachedIds).toEqual(['a', 'b', 'c'])
    expect(preview?.before).toEqual({ bottlesTotal: 5, bottlesF1: 2, bottlesF2: 3, unitPriceCents: 24_000, f2Cents: 72_000 })
    expect(preview?.after).toEqual({ bottlesTotal: 5, bottlesF1: 3, bottlesF2: 2, unitPriceCents: 24_000, f2Cents: 48_000 })
    expect(preview?.changed).toBe(true)
  })

  it('réduire le total libère les remplacements les plus récents', () => {
    const preview = previewDelivery({ existing, deliveryDate: '2026-10-14', bottlesTotal: 1, replacements, deliveries: [existing], prices: PRICES })
    expect(preview?.allocation).toMatchObject({ attachedIds: ['a'], carriedOverIds: ['b', 'c'] })
    expect(preview?.after.f2Cents).toBe(0)
  })

  it('changer la date réévalue le prix et les candidats', () => {
    const preview = previewDelivery({ existing, deliveryDate: '2026-11-02', bottlesTotal: 5, replacements, deliveries: [existing], prices: PRICES })
    expect(preview?.allocation.attachedIds).toEqual(['a', 'b', 'c', 'later'])
    expect(preview?.after).toMatchObject({ bottlesF2: 1, unitPriceCents: 25_000, f2Cents: 25_000 })
  })

  it('sans changement, l’aperçu le signale', () => {
    const stable = [rep('a', '2026-10-01 08:00', 'd1'), rep('b', '2026-10-05 08:00', 'd1')]
    const preview = previewDelivery({ existing, deliveryDate: '2026-10-14', bottlesTotal: 5, replacements: stable, deliveries: [existing], prices: PRICES })
    expect(preview?.changed).toBe(false)
  })

  it('une nouvelle livraison n’a pas d’état « avant » ; sans prix en vigueur, pas d’aperçu', () => {
    const preview = previewDelivery({ deliveryDate: '2026-10-21', bottlesTotal: 2, replacements, deliveries: [existing], prices: PRICES })
    expect(preview?.before).toBeNull()
    expect(preview?.allocation.attachedIds).toEqual(['c', 'later'])
    expect(previewDelivery({ deliveryDate: '1999-01-01', bottlesTotal: 2, replacements, deliveries: [], prices: PRICES })).toBeNull()
  })

  it('après suppression d’une livraison, ses remplacements (repassés en attente) sont de nouveau candidats', () => {
    const afterDelete = replacements.map((r) => (r.deliveryId === 'd1' ? { ...r, deliveryId: null } : r))
    const result = allocateDelivery({ deliveryDate: '2026-10-14', bottlesTotal: 4, replacements: afterDelete })
    expect(result.attachedIds).toEqual(['a', 'b', 'c'])
  })
})

describe('total attendu et écart SOA', () => {
  const deliveries = [
    delivery({ id: 'd1', deliveryDate: '2026-10-02', bottlesTotal: 4, bottlesF1: 2 }),
    delivery({ id: 'd2', deliveryDate: '2026-10-16', bottlesTotal: 5, bottlesF1: 3 }),
    delivery({ id: 'd3', deliveryDate: '2026-11-02', bottlesTotal: 3, bottlesF1: 1, unitPriceCentsApplied: 25_000 }),
  ]

  it('total attendu = Σ bottles_total × prix appliqué des livraisons du mois', () => {
    expect(expectedMonthCents(deliveries, '2026-10')).toBe(216_000)
    expect(expectedMonthCents(deliveries, '2026-11')).toBe(75_000)
    expect(expectedMonthCents(deliveries, '2026-12')).toBe(0)
  })

  it.each([
    ['nul', 216_000, 0, 'reconciled'],
    ['positif', 240_000, 24_000, 'to_treat'],
    ['négatif', 192_000, -24_000, 'to_treat'],
  ] as const)('écart %s', (_label, billed, variance, status) => {
    expect(monthVarianceCents(billed, 216_000)).toBe(variance)
    const summary = summarizeMonth('2026-10', deliveries, soa('2026-10', billed, variance))
    expect(summary).toMatchObject({ expectedCents: 216_000, varianceCents: variance, currentVarianceCents: variance, status })
  })

  it('récapitule le mois : répartition et montants par foyer', () => {
    const summary = summarizeMonth('2026-10', deliveries, null)
    expect(summary).toMatchObject({ bottlesTotal: 9, bottlesF1: 5, bottlesF2: 4, f1Cents: 120_000, f2Cents: 96_000, status: 'no_soa' })
    expect(summary.deliveries.map((d) => d.id)).toEqual(['d1', 'd2'])
  })

  it('signale un SOA dont les livraisons ont changé depuis le rapprochement', () => {
    const summary = summarizeMonth('2026-10', deliveries, soa('2026-10', 240_000, 0))
    expect(summary.status).toBe('stale')
    expect(summary.currentVarianceCents).toBe(24_000)
  })

  it('liste les mois du plus récent au plus ancien, y compris un mois avec SOA seul', () => {
    const months = summarizeMonths(deliveries, [soa('2026-09', 0, 0)])
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-10', '2026-09'])
  })
})

describe('traitement de l’écart pour le Foyer 2', () => {
  it.each([
    ['pending', 2_400, 0],
    ['impute_to_f1', 2_400, 0],
    ['impute_to_f2', 2_400, 2_400],
    ['impute_to_f2', -2_400, -2_400],
    ['split_50_50', 2_400, 1_200],
    ['split_50_50', 1_001, 500],
    ['split_50_50', -1_001, -500],
    ['split_50_50', -1, 0],
  ] as const)('%s, écart %i → %i', (treatment, variance, expected) => {
    const adjustment = f2Adjustment(variance, treatment)
    expect(adjustment).toBe(expected)
    expect(Object.is(adjustment, -0)).toBe(false)
    expect(Number.isInteger(adjustment)).toBe(true)
  })
})

describe('solde du Foyer 2', () => {
  const deliveries = [
    delivery({ id: 'd1', deliveryDate: '2026-10-02', bottlesTotal: 4, bottlesF1: 2 }), // F2 : 48 000
    delivery({ id: 'd2', deliveryDate: '2026-10-16', bottlesTotal: 5, bottlesF1: 3 }), // F2 : 48 000
    delivery({ id: 'd3', deliveryDate: '2026-10-30', bottlesTotal: 2, bottlesF1: 2 }), // F2 : 0
  ]

  it('somme des parts Foyer 2, plus les ajustements, moins les remboursements', () => {
    const balance = balanceF2({ deliveries, soas: [soa('2026-10', 265_001, 1_001, 'split_50_50')], repayments: [] })
    expect(balance).toEqual({ chargesCents: 96_000, adjustmentsCents: 500, repaymentsCents: 0, balanceCents: 96_500 })
    expect(bottlesF2(deliveries[2]!)).toBe(0)
  })

  it('reste juste après des remboursements partiels', () => {
    const repayments = [
      { amountCents: 30_000 },
      { amountCents: 10_050 },
    ]
    expect(balanceF2({ deliveries, soas: [], repayments }).balanceCents).toBe(55_950)
  })

  it('reste juste après un remboursement groupé qui couvre plusieurs mois, avance comprise', () => {
    const more = [...deliveries, delivery({ id: 'd4', deliveryDate: '2026-11-03', bottlesTotal: 3, bottlesF1: 0, unitPriceCentsApplied: 25_000 })]
    expect(balanceF2({ deliveries: more, soas: [], repayments: [{ amountCents: 171_000 }] }).balanceCents).toBe(0)
    expect(balanceF2({ deliveries: more, soas: [], repayments: [{ amountCents: 180_000 }] }).balanceCents).toBe(-9_000)
  })

  it('un ajustement négatif réduit le solde', () => {
    expect(balanceF2({ deliveries, soas: [soa('2026-10', 0, -4_800, 'impute_to_f2')], repayments: [] }).balanceCents).toBe(91_200)
  })
})

describe('consommation du Foyer 1', () => {
  const journal = [rep('a', '2026-10-01 08:00'), rep('b', '2026-10-31 23:30'), rep('c', '2026-11-01 00:30'), rep('d', '2026-11-05 10:00')]

  it('compte par mois à l’heure de Maurice', () => {
    expect(consumptionByMonth(journal)).toEqual([
      { month: '2026-11', count: 2 },
      { month: '2026-10', count: 2 },
    ])
  })

  it('calcule la moyenne par semaine depuis le premier remplacement', () => {
    // 4 remplacements du 1er octobre au 14 octobre... puis au 11 novembre : 42 jours = 6 semaines.
    expect(weeklyAverage(journal, '2026-11-11')).toBeCloseTo(4 / 6)
    expect(weeklyAverage([rep('a', '2026-11-10 08:00')], '2026-11-11')).toBe(1)
    expect(weeklyAverage([], '2026-11-11')).toBeNull()
  })
})
