// Attribution côté base : save_delivery() est atomique et idempotente, un
// remplacement rattaché est verrouillé, l'invariant bottles_f1 = nombre de
// rattachés est vérifié au commit quel que soit le chemin d'écriture, et le
// prix appliqué est figé.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, type Row, type TestDb, createTestDb, errorCode } from './harness.ts'

const D1 = 'd1000000-0000-4000-8000-000000000001'
const D2 = 'd2000000-0000-4000-8000-000000000002'
const D3 = 'd3000000-0000-4000-8000-000000000003'
const R1 = 'a1000000-0000-4000-8000-000000000001' // 1er oct., 12 h à Maurice
const R2 = 'a2000000-0000-4000-8000-000000000002' // 5 oct.
const R3 = 'a3000000-0000-4000-8000-000000000003' // 14 oct. 21 h 30 UTC = 15 oct. 1 h 30 à Maurice
const R4 = 'a4000000-0000-4000-8000-000000000004' // 14 oct. 19 h 59 UTC = 14 oct. 23 h 59 à Maurice
const UNKNOWN = 'aff00000-0000-4000-8000-0000000000ff'

let t: TestDb

const asAdmin = <T>(fn: () => Promise<T>) => t.as(ADMIN, fn)

function saveDelivery(id: string, date: string, total: number, ids: string[], note: string | null = null) {
  return asAdmin(async () => {
    const [row] = await t.rows(`select public.save_delivery($1::jsonb, $2::uuid[]) as d`, [
      JSON.stringify({ id, delivery_date: date, bottles_total: total, note }),
      ids,
    ])
    return row?.d as Row
  })
}

async function delivery(id: string) {
  const [row] = await t.rows(
    `select delivery_date::text as date, bottles_total, bottles_f1, bottles_f2, unit_price_cents_applied as price
     from public.deliveries where id = $1`,
    [id],
  )
  return row
}

async function attachedTo(id: string) {
  return (await t.rows(`select id from public.replacements where delivery_id = $1 order by replaced_at`, [id])).map((r) => r.id)
}

beforeAll(async () => {
  t = await createTestDb('strict')
  await asAdmin(() =>
    t.rows(
      `insert into public.replacements (id, replaced_at) values
         ($1, '2026-10-01T08:00:00Z'), ($2, '2026-10-05T08:00:00Z'),
         ($3, '2026-10-14T21:30:00Z'), ($4, '2026-10-14T19:59:00Z')`,
      [R1, R2, R3, R4],
    ),
  )
})

afterAll(async () => {
  await t.close()
})

describe('jour d’un remplacement à Maurice', () => {
  it('compte le jour de Maurice, pas celui d’UTC', async () => {
    const days = await t.rows(`select id, replaced_on::text as day from public.replacements where id in ($1, $2)`, [R3, R4])
    expect(Object.fromEntries(days.map((d) => [d.id, d.day]))).toEqual({ [R3]: '2026-10-15', [R4]: '2026-10-14' })
  })
})

describe('save_delivery()', () => {
  it('crée la livraison et rattache les remplacements donnés', async () => {
    const saved = await saveDelivery(D1, '2026-10-14', 5, [R1, R2, R4])
    expect(saved).toMatchObject({ id: D1, bottles_total: 5, bottles_f1: 3, bottles_f2: 2, unit_price_cents_applied: 24000 })
    expect(await attachedTo(D1)).toEqual([R1, R2, R4])
  })

  it('est idempotente : rejouer le même appel ne change rien', async () => {
    await saveDelivery(D1, '2026-10-14', 5, [R1, R2, R4])
    await saveDelivery(D1, '2026-10-14', 5, [R1, R2, R4])
    expect(await delivery(D1)).toEqual({ date: '2026-10-14', bottles_total: 5, bottles_f1: 3, bottles_f2: 2, price: 24000 })
    expect(await attachedTo(D1)).toEqual([R1, R2, R4])
    const [count] = await t.rows(`select count(*)::int as n from public.deliveries`)
    expect(count?.n).toBe(1)
  })

  it('refuse un remplacement postérieur (jour à Maurice) sans rien créer', async () => {
    expect(await asAdmin(() => errorCode(saveDelivery(D2, '2026-10-14', 2, [R3])))).toBe('23514')
    expect(await delivery(D2)).toBeUndefined()
    const [row] = await t.rows(`select delivery_id from public.replacements where id = $1`, [R3])
    expect(row?.delivery_id).toBeNull()
  })

  it('refuse un remplacement inconnu, déjà rattaché ailleurs ou en double', async () => {
    expect(await errorCode(saveDelivery(D2, '2026-10-20', 2, [UNKNOWN]))).toBe('23503')
    expect(await errorCode(saveDelivery(D2, '2026-10-20', 2, [R1]))).toBe('23505')
    expect(await errorCode(saveDelivery(D2, '2026-10-20', 3, [R3, R3]))).toBe('22023')
    expect(await errorCode(saveDelivery(D2, '2026-10-20', 2, [R3, R1]))).toBe('23505')
    expect(await delivery(D2)).toBeUndefined()
  })

  it('refuse plus de remplacements que de bonbonnes livrées', async () => {
    expect(await errorCode(saveDelivery(D2, '2026-10-20', 1, [R3, R2]))).not.toBeUndefined()
    expect(await delivery(D2)).toBeUndefined()
  })

  it('recalcule : détache ce qui n’est plus dans la liste, sans toucher aux autres livraisons', async () => {
    await saveDelivery(D2, '2026-10-20', 2, [R3])
    await saveDelivery(D1, '2026-10-14', 4, [R1])
    expect(await delivery(D1)).toMatchObject({ bottles_total: 4, bottles_f1: 1, bottles_f2: 3 })
    expect(await attachedTo(D1)).toEqual([R1])
    expect(await attachedTo(D2)).toEqual([R3])
    const pending = await t.rows(`select id from public.replacements where delivery_id is null order by replaced_at`)
    expect(pending.map((r) => r.id)).toEqual([R2, R4])
  })

  it('un échec au milieu d’un recalcul laisse la livraison intacte', async () => {
    expect(await errorCode(saveDelivery(D1, '2026-10-14', 4, [R1, UNKNOWN]))).toBe('23503')
    expect(await delivery(D1)).toMatchObject({ bottles_total: 4, bottles_f1: 1 })
    expect(await attachedTo(D1)).toEqual([R1])
  })

  it('accepte une livraison sans remplacement du Foyer 1', async () => {
    const saved = await saveDelivery(D3, '2026-10-02', 2, [])
    expect(saved).toMatchObject({ bottles_f1: 0, bottles_f2: 2 })
  })
})

describe('verrou des remplacements rattachés', () => {
  it('ni suppression ni modification d’un remplacement rattaché', async () => {
    await asAdmin(async () => {
      expect(await errorCode(t.rows(`delete from public.replacements where id = $1`, [R1]))).toBe('23514')
      expect(await errorCode(t.rows(`update public.replacements set note = 'x' where id = $1`, [R1]))).toBe('23514')
      expect(
        await errorCode(t.rows(`update public.replacements set replaced_at = '2026-10-02T08:00:00Z' where id = $1`, [R1])),
      ).toBe('23514')
    })
  })

  it('un remplacement en attente reste modifiable', async () => {
    await asAdmin(() => t.rows(`update public.replacements set note = 'oubli' where id = $1`, [R2]))
    const [row] = await t.rows(`select note from public.replacements where id = $1`, [R2])
    expect(row?.note).toBe('oubli')
  })

  it('supprimer la livraison remet ses remplacements en attente', async () => {
    await asAdmin(() => t.rows(`delete from public.deliveries where id = $1`, [D2]))
    const [row] = await t.rows(`select delivery_id from public.replacements where id = $1`, [R3])
    expect(row?.delivery_id).toBeNull()
  })
})

describe('invariant vérifié au commit', () => {
  it('rattacher directement sans mettre à jour bottles_f1 échoue', async () => {
    const code = await asAdmin(() =>
      errorCode(t.exec(`begin; update public.replacements set delivery_id = '${D1}' where id = '${R2}'; commit;`)),
    )
    expect(code).toBe('23514')
    await t.exec('rollback').catch(() => undefined)
    expect(await attachedTo(D1)).toEqual([R1])
  })

  it('modifier bottles_f1 à la main échoue', async () => {
    const code = await asAdmin(() =>
      errorCode(t.exec(`begin; update public.deliveries set bottles_f1 = 3 where id = '${D1}'; commit;`)),
    )
    expect(code).toBe('23514')
    await t.exec('rollback').catch(() => undefined)
    expect(await delivery(D1)).toMatchObject({ bottles_f1: 1 })
  })

  it('reculer la date de livraison avant un remplacement rattaché échoue', async () => {
    const code = await asAdmin(() =>
      errorCode(t.exec(`begin; update public.deliveries set delivery_date = '2026-09-30' where id = '${D1}'; commit;`)),
    )
    expect(code).toBe('23514')
    await t.exec('rollback').catch(() => undefined)
  })
})

describe('prix figé', () => {
  it('un nouveau prix ne change pas les livraisons existantes', async () => {
    await asAdmin(() =>
      t.rows(`insert into public.price_settings (id, unit_price_cents, effective_from) values ($1, 25000, '2026-11-01')`, [
        'b1000000-0000-4000-8000-000000000001',
      ]),
    )
    expect(await delivery(D1)).toMatchObject({ price: 24000 })
    const saved = await saveDelivery(D2, '2026-11-02', 1, [])
    expect(saved).toMatchObject({ unit_price_cents_applied: 25000 })
  })

  it('modifier un prix n’altère pas une livraison passée', async () => {
    await asAdmin(() => t.rows(`update public.price_settings set unit_price_cents = 26000 where effective_from = '2026-11-01'`))
    expect(await delivery(D2)).toMatchObject({ price: 25000 })
  })

  it('le prix n’est réévalué que si la date de livraison change', async () => {
    await saveDelivery(D2, '2026-11-02', 2, [])
    expect(await delivery(D2)).toMatchObject({ price: 25000, bottles_total: 2 })
    await saveDelivery(D2, '2026-11-03', 2, [])
    expect(await delivery(D2)).toMatchObject({ price: 26000 })
    await saveDelivery(D2, '2026-10-30', 2, [])
    expect(await delivery(D2)).toMatchObject({ price: 24000 })
  })

  it('le premier prix ne peut pas être supprimé, les suivants si', async () => {
    await asAdmin(async () => {
      expect(await errorCode(t.rows(`delete from public.price_settings where effective_from = '2000-01-01'`))).toBe('23514')
      await t.rows(`delete from public.price_settings where effective_from = '2026-11-01'`)
    })
    const prices = await t.rows(`select unit_price_cents from public.price_settings`)
    expect(prices).toEqual([{ unit_price_cents: 24000 }])
  })

  it('refuse une livraison sans prix en vigueur', async () => {
    expect(await errorCode(saveDelivery('d4000000-0000-4000-8000-000000000004', '1999-12-31', 1, []))).toBe('23514')
  })
})

describe('écart SOA imputé au Foyer 2 (colonne générée)', () => {
  it.each([
    ['pending', 1001, 0],
    ['impute_to_f1', 1001, 0],
    ['impute_to_f2', 1001, 1001],
    ['impute_to_f2', -2400, -2400],
    ['split_50_50', 1001, 500],
    ['split_50_50', -1001, -500],
    ['split_50_50', 24000, 12000],
  ])('%s, écart %i → %i', async (treatment, variance, expected) => {
    const [row] = await asAdmin(() =>
      t.rows(
        `insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment)
         values (gen_random_uuid(), $1, 0, $2, $3) returning f2_adjustment_cents`,
        ['2027-01-01', variance, treatment],
      ),
    )
    expect(row?.f2_adjustment_cents).toBe(expected)
    await t.rows(`delete from public.soa_statements`)
  })

  it('refuse un traitement inconnu et un mois qui ne commence pas le 1er', async () => {
    await asAdmin(async () => {
      expect(
        await errorCode(
          t.rows(`insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment)
                  values (gen_random_uuid(), '2026-10-01', 0, 0, 'autre')`),
        ),
      ).toBe('23514')
      expect(
        await errorCode(
          t.rows(`insert into public.soa_statements (id, month, total_billed_cents, variance_cents)
                  values (gen_random_uuid(), '2026-10-02', 0, 0)`),
        ),
      ).toBe('23514')
    })
  })

  it('le chemin du document doit correspondre au mois du SOA', async () => {
    await asAdmin(async () => {
      const id = 'c1000000-0000-4000-8000-000000000001'
      await t.rows(`insert into public.soa_statements (id, month, total_billed_cents, variance_cents) values ($1, '2026-10-01', 0, 0)`, [id])
      const doc = 'c2000000-0000-4000-8000-000000000002'
      expect(await errorCode(t.rows(`update public.soa_statements set document_path = $1 where id = $2`, [`soa/2026-09/${doc}.pdf`, id]))).toBe('23514')
      await t.rows(`update public.soa_statements set document_path = $1 where id = $2`, [`soa/2026-10/${doc}.pdf`, id])
      expect(
        await errorCode(t.rows(`update public.deliveries set document_path = $1 where id = $2`, [`deliveries/${D2}/${doc}.jpg`, D1])),
      ).toBe('23514')
      await t.rows(`update public.deliveries set document_path = $1 where id = $2`, [`deliveries/${D1}/${doc}.jpg`, D1])
    })
  })
})
