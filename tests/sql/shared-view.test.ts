// Page du Foyer 2 : get_shared_view() renvoie null pour un lien inconnu ou
// révoqué, et sinon UNIQUEMENT les données du Foyer 2. Aucune donnée du
// Foyer 1 : ni total livré, ni bottles_f1, ni remplacements, ni notes,
// ni documents, ni écart brut.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, MALLORY, MODES, type Row, type TestDb, createTestDb, errorCode, sha256Hex } from './harness.ts'

const TOKEN = 'k3J9xQ2mV7pL0sN4tR8wY1zA6bC5dE3fG2hJ9kL0mN8'
const OLD_TOKEN = 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7Mm6'

const D_SHARED = 'e1000000-0000-4000-8000-000000000001'
const D_F1_ONLY = 'e2000000-0000-4000-8000-000000000002'
const D_NOVEMBER = 'e3000000-0000-4000-8000-000000000003'

/** Toutes les clés présentes dans une valeur JSON, à toute profondeur. */
function keysDeep(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, keys))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      keysDeep(child, keys)
    }
  }
  return keys
}

const withoutTimestamp = (value: unknown) => ({ ...(value as Row), generated_at: null })

describe.each(MODES)('get_shared_view (%s)', (mode) => {
  let t: TestDb

  async function view(token: string, user: typeof ADMIN | 'anon' = 'anon'): Promise<Row | null> {
    const [row] = await t.as(user, () => t.rows('select public.get_shared_view($1) as v', [token]))
    return (row?.v as Row | null) ?? null
  }

  beforeAll(async () => {
    t = await createTestDb(mode)
    await t.exec(`
      insert into public.price_settings (id, unit_price_cents, effective_from)
        values ('f0000000-0000-4000-8000-000000000001', 25000, '2026-11-01');
      insert into public.deliveries (id, delivery_date, bottles_total, bottles_f1, note, document_path) values
        ('${D_SHARED}', '2026-10-14', 5, 2, 'NOTE-SECRETE-F1', 'deliveries/${D_SHARED}/a0000000-0000-4000-8000-0000000000aa.jpg'),
        ('${D_F1_ONLY}', '2026-10-20', 2, 2, null, null),
        ('${D_NOVEMBER}', '2026-11-03', 1, 0, null, null);
      insert into public.replacements (id, replaced_at, note, delivery_id) values
        ('b1000000-0000-4000-8000-000000000001', '2026-10-02T08:00:00Z', 'REMPLACEMENT-SECRET', '${D_SHARED}'),
        ('b2000000-0000-4000-8000-000000000002', '2026-10-03T08:00:00Z', null, '${D_SHARED}'),
        ('b3000000-0000-4000-8000-000000000003', '2026-10-18T08:00:00Z', null, '${D_F1_ONLY}'),
        ('b4000000-0000-4000-8000-000000000004', '2026-10-19T08:00:00Z', null, '${D_F1_ONLY}'),
        ('b5000000-0000-4000-8000-000000000005', '2026-11-04T08:00:00Z', null, null);
      insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment, note) values
        ('c1000000-0000-4000-8000-000000000001', '2026-10-01', 169001, 1001, 'split_50_50', 'SOA-NOTE-SECRETE'),
        ('c2000000-0000-4000-8000-000000000002', '2026-09-01', 4800, 4800, 'impute_to_f1', null);
      insert into public.repayments (id, repayment_date, amount_cents, note) values
        ('a1000000-0000-4000-8000-000000000001', '2026-10-25', 50000, 'REMBOURSEMENT-NOTE'),
        ('a2000000-0000-4000-8000-000000000002', '2026-11-05', 10000, null);
      insert into public.share_links (id, token_hash, revoked_at) values
        ('d1000000-0000-4000-8000-000000000001', '${sha256Hex(OLD_TOKEN)}', now()),
        ('d2000000-0000-4000-8000-000000000002', '${sha256Hex(TOKEN)}', null);
    `)
  })

  afterAll(async () => {
    await t.close()
  })

  it('anon obtient les données du Foyer 2 avec un lien valide', async () => {
    const data = await view(TOKEN)
    expect(data).not.toBeNull()
    expect(data?.deliveries).toEqual([
      { date: '2026-11-03', bottles: 1, unit_price_cents: 25000, amount_cents: 25000 },
      { date: '2026-10-14', bottles: 3, unit_price_cents: 24000, amount_cents: 72000 },
    ])
    expect(data?.months).toEqual([
      { month: '2026-11', deliveries_cents: 25000, adjustment_cents: 0, total_cents: 25000 },
      { month: '2026-10', deliveries_cents: 72000, adjustment_cents: 500, total_cents: 72500 },
    ])
    expect(data?.repayments).toEqual([
      { date: '2026-11-05', amount_cents: 10000 },
      { date: '2026-10-25', amount_cents: 50000 },
    ])
    // 25 000 + 72 000 + 500 − 60 000
    expect(data?.balance_cents).toBe(37500)
    expect(typeof data?.generated_at).toBe('string')
  })

  it('ne contient que les clés autorisées, à toute profondeur', async () => {
    const data = await view(TOKEN)
    expect([...keysDeep(data)].sort()).toEqual(
      [
        'adjustment_cents',
        'amount_cents',
        'balance_cents',
        'bottles',
        'date',
        'deliveries',
        'deliveries_cents',
        'generated_at',
        'month',
        'months',
        'repayments',
        'total_cents',
        'unit_price_cents',
      ].sort(),
    )
  })

  it('ne laisse rien fuiter du Foyer 1', async () => {
    const json = JSON.stringify(await view(TOKEN))
    for (const secret of [
      'bottles_total',
      'bottles_f1',
      'replacement',
      'variance',
      'note',
      'document',
      'NOTE-SECRETE-F1',
      'REMPLACEMENT-SECRET',
      'SOA-NOTE-SECRETE',
      'REMBOURSEMENT-NOTE',
      'deliveries/',
      '169001', // total SOA
      '1001', // écart brut
      '2026-10-20', // livraison propre au Foyer 1
      '2026-09', // mois dont l'écart est imputé au Foyer 1
    ]) {
      expect(json).not.toContain(secret)
    }
  })

  it.each([
    ['inconnu', 'Aa1Bb2Cc3Dd4Ee5Ff6Gg7Hh8Ii9Jj0Kk1Ll2Mm3Nn4'],
    ['révoqué', OLD_TOKEN],
    ['trop court', 'abc'],
    ['caractères invalides', `${TOKEN.slice(0, 40)}' or '1'='1`],
    ['vide', ''],
  ])('lien %s → null', async (_label, token) => {
    expect(await view(token)).toBeNull()
  })

  it('un compte connecté non autorisé n’obtient rien de plus', async () => {
    const [row] = await t.as(MALLORY, () => t.rows('select public.get_shared_view($1) as v', [TOKEN]))
    expect(withoutTimestamp(row?.v)).toEqual(withoutTimestamp(await view(TOKEN)))
    expect(await t.as(MALLORY, () => errorCode(t.rows('select * from public.deliveries')))).toBeUndefined()
    expect(await t.as(MALLORY, () => t.rows('select * from public.deliveries'))).toEqual([])
  })

  it('régénérer le lien révoque l’ancien ; révoquer coupe l’accès', async () => {
    const NEXT = 'Nn1Mm2Ll3Kk4Jj5Hh6Gg7Ff8Ee9Dd0Cc1Bb2Aa3Zz4'
    const [created] = await t.as(ADMIN, () =>
      t.rows('select public.rotate_share_link($1, $2) as r', ['d3000000-0000-4000-8000-000000000003', sha256Hex(NEXT)]),
    )
    expect(created?.r).toMatchObject({ id: 'd3000000-0000-4000-8000-000000000003' })
    expect(await view(TOKEN)).toBeNull()
    expect(await view(NEXT)).not.toBeNull()
    const active = await t.rows('select id from public.share_links where revoked_at is null')
    expect(active).toEqual([{ id: 'd3000000-0000-4000-8000-000000000003' }])

    const [revoked] = await t.as(ADMIN, () => t.rows('select public.revoke_share_links() as n'))
    expect(revoked?.n).toBe(1)
    expect(await view(NEXT)).toBeNull()
  })

  it('un deuxième lien actif est impossible, même en écrivant directement', async () => {
    await t.as(ADMIN, async () => {
      await t.rows(`insert into public.share_links (id, token_hash) values ('d4000000-0000-4000-8000-000000000004', repeat('d', 64))`)
      expect(
        await errorCode(
          t.rows(`insert into public.share_links (id, token_hash) values ('d5000000-0000-4000-8000-000000000005', repeat('e', 64))`),
        ),
      ).toBe('23505')
    })
  })
})
