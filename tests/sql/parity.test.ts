// Parité TypeScript / SQL : les montants affichés hors ligne (calculés par
// src/domain/calculations.ts) sont exactement ceux que calcule la base.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { balanceF2, f2Adjustment, priceAt } from '../../src/domain/calculations.ts'
import { mauritiusDateOf } from '../../src/domain/dates.ts'
import type { Delivery, Price, Repayment, SoaStatement, VarianceTreatment } from '../../src/domain/types.ts'
import { VARIANCE_TREATMENTS } from '../../src/domain/types.ts'
import { ADMIN, type TestDb, createTestDb, sha256Hex } from './harness.ts'

let t: TestDb

beforeAll(async () => {
  t = await createTestDb('strict')
})

afterAll(async () => {
  await t.close()
})

describe('parité TypeScript / SQL', () => {
  it('f2Adjustment() = colonne générée f2_adjustment_cents', async () => {
    const variances = [0, 1, -1, 2, -2, 3, -3, 1001, -1001, 2400, -2400, 24001, -24001, 99_999, -99_999]
    let month = 0
    for (const treatment of VARIANCE_TREATMENTS) {
      for (const variance of variances) {
        month += 1
        const year = 2000 + Math.floor(month / 12)
        const date = `${year}-${String((month % 12) + 1).padStart(2, '0')}-01`
        const [row] = await t.rows(
          `insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment)
           values (gen_random_uuid(), $1, 0, $2, $3) returning f2_adjustment_cents`,
          [date, variance, treatment],
        )
        expect(row?.f2_adjustment_cents, `${treatment} ${variance}`).toBe(f2Adjustment(variance, treatment as VarianceTreatment))
      }
    }
    await t.rows('delete from public.soa_statements')
  })

  it('priceAt() = price_at()', async () => {
    const prices: Price[] = [
      { id: 'a0000000-0000-4000-8000-000000000001', unitPriceCents: 24_000, effectiveFrom: '2000-01-01' },
      { id: 'a0000000-0000-4000-8000-000000000002', unitPriceCents: 25_000, effectiveFrom: '2026-11-01' },
      { id: 'a0000000-0000-4000-8000-000000000003', unitPriceCents: 26_050, effectiveFrom: '2027-03-15' },
    ]
    for (const price of prices.slice(1)) {
      await t.rows(`insert into public.price_settings (id, unit_price_cents, effective_from) values ($1, $2, $3)`, [
        price.id,
        price.unitPriceCents,
        price.effectiveFrom,
      ])
    }
    for (const date of ['1999-12-31', '2000-01-01', '2026-10-31', '2026-11-01', '2027-03-14', '2027-03-15', '2030-01-01']) {
      const [row] = await t.as(ADMIN, () => t.rows('select public.price_at($1) as price', [date]))
      expect(row?.price ?? null, date).toBe(priceAt(date, prices))
    }
  })

  it('mauritiusDateOf() = colonne générée replaced_on', async () => {
    const stamps = [
      '2026-10-14T19:59:59Z',
      '2026-10-14T20:00:00Z',
      '2026-10-14T21:00:00Z',
      '2026-12-31T19:30:00Z',
      '2026-12-31T20:30:00Z',
      '2027-02-28T20:00:00Z',
      '2028-02-28T20:00:00Z',
    ]
    for (const [index, stamp] of stamps.entries()) {
      const [row] = await t.rows(
        `insert into public.replacements (id, replaced_at) values ($1, $2) returning replaced_on::text as day`,
        [`b0000000-0000-4000-8000-${String(index).padStart(12, '0')}`, stamp],
      )
      expect(row?.day, stamp).toBe(mauritiusDateOf(stamp))
    }
    await t.rows('delete from public.replacements')
  })

  it('balanceF2() = solde de get_shared_view()', async () => {
    const deliveries: Delivery[] = [
      { id: 'c0000000-0000-4000-8000-000000000001', deliveryDate: '2026-10-02', bottlesTotal: 4, bottlesF1: 0, unitPriceCentsApplied: 24_000, documentPath: null, note: null },
      { id: 'c0000000-0000-4000-8000-000000000002', deliveryDate: '2026-10-16', bottlesTotal: 5, bottlesF1: 0, unitPriceCentsApplied: 24_000, documentPath: null, note: null },
      { id: 'c0000000-0000-4000-8000-000000000003', deliveryDate: '2026-11-03', bottlesTotal: 3, bottlesF1: 0, unitPriceCentsApplied: 25_000, documentPath: null, note: null },
    ]
    const soas: Pick<SoaStatement, 'month' | 'varianceCents' | 'varianceTreatment'>[] = [
      { month: '2026-10', varianceCents: -1_001, varianceTreatment: 'split_50_50' },
      { month: '2026-11', varianceCents: 2_400, varianceTreatment: 'impute_to_f2' },
      { month: '2026-12', varianceCents: 9_999, varianceTreatment: 'impute_to_f1' },
    ]
    const repayments: Pick<Repayment, 'repaymentDate' | 'amountCents'>[] = [
      { repaymentDate: '2026-10-20', amountCents: 30_050 },
      { repaymentDate: '2026-11-30', amountCents: 100_000 },
    ]
    for (const d of deliveries) {
      await t.rows(`insert into public.deliveries (id, delivery_date, bottles_total, bottles_f1) values ($1, $2, $3, $4)`, [
        d.id,
        d.deliveryDate,
        d.bottlesTotal,
        d.bottlesF1,
      ])
    }
    for (const s of soas) {
      await t.rows(
        `insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment)
         values (gen_random_uuid(), $1, 0, $2, $3)`,
        [`${s.month}-01`, s.varianceCents, s.varianceTreatment],
      )
    }
    for (const r of repayments) {
      await t.rows(`insert into public.repayments (id, repayment_date, amount_cents) values (gen_random_uuid(), $1, $2)`, [
        r.repaymentDate,
        r.amountCents,
      ])
    }
    const token = 'Pp1Oo2Ii3Uu4Yy5Tt6Rr7Ee8Zz9Aa0Qq1Ss2Dd3Ff4G'
    await t.rows(`insert into public.share_links (id, token_hash) values (gen_random_uuid(), $1)`, [sha256Hex(token)])

    // Les prix appliqués sont ceux figés par la base (price_settings du test précédent).
    const stored = await t.rows(`select unit_price_cents_applied as price from public.deliveries order by delivery_date`)
    expect(stored.map((r) => r.price)).toEqual(deliveries.map((d) => d.unitPriceCentsApplied))

    const [row] = await t.as('anon', () => t.rows('select public.get_shared_view($1) as v', [token]))
    const view = row?.v as { balance_cents: number }
    expect(view.balance_cents).toBe(balanceF2({ deliveries, soas, repayments }).balanceCents)
  })
})
