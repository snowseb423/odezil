// Isolation : seul l'administrateur (is_admin) lit et écrit les données,
// le bucket et les RPC. Un compte Google quelconque, une session ouverte
// par mot de passe, une adresse non confirmée ou le rôle anon ne voient
// rien et ne peuvent rien écrire, même en appelant l'API directement.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADMIN,
  ADMIN_OTP,
  ADMIN_PASSWORD,
  IMPOSTOR,
  MALLORY,
  MODES,
  type Row,
  type TestDb,
  type TestUser,
  UNCONFIRMED,
  createTestDb,
  errorCode,
} from './harness.ts'

const DELIVERY = '11111111-1111-4111-8111-111111111111'
const PENDING = '22222222-2222-4222-8222-222222222222'
const ATTACHED = '33333333-3333-4333-8333-333333333333'
const NEW_ID = '44444444-4444-4444-8444-444444444444'
const DOC = '55555555-5555-4555-8555-555555555555'

const TABLES = ['price_settings', 'deliveries', 'replacements', 'soa_statements', 'repayments', 'share_links', 'admin_allowlist']

const DENIED_USERS: [string, TestUser | 'anon'][] = [
  ['anon', 'anon'],
  ['compte Google hors liste', MALLORY],
  ['session par mot de passe', ADMIN_PASSWORD],
  ['adresse non confirmée', UNCONFIRMED],
  ['JWT à l’email de l’admin pour un autre compte', IMPOSTOR],
]

describe.each(MODES)('sécurité (%s)', (mode) => {
  let t: TestDb

  /** Lignes visibles, ou [] si l'accès est refusé (permission denied). */
  async function visible(user: TestUser | 'anon', sql: string, params: unknown[] = []): Promise<Row[]> {
    return t.as(user, async () => {
      try {
        return (await t.db.query<Row>(sql, params)).rows
      } catch (error) {
        if ((error as { code?: string }).code === '42501') return []
        throw error
      }
    })
  }

  beforeAll(async () => {
    t = await createTestDb(mode)
    await t.exec(`
      insert into public.deliveries (id, delivery_date, bottles_total, bottles_f1, note)
        values ('${DELIVERY}', '2026-10-14', 3, 1, 'note du foyer 1');
      insert into public.replacements (id, replaced_at, delivery_id) values
        ('${ATTACHED}', '2026-10-10T08:00:00Z', '${DELIVERY}'),
        ('${PENDING}', '2026-10-15T08:00:00Z', null);
      insert into public.soa_statements (id, month, total_billed_cents, variance_cents, variance_treatment)
        values ('${NEW_ID}', '2026-10-01', 72000, 0, 'pending');
      insert into public.repayments (id, repayment_date, amount_cents) values ('${DOC}', '2026-10-20', 48000);
      insert into public.share_links (id, token_hash) values ('${DOC}', repeat('a', 64));
      insert into storage.objects (bucket_id, name) values ('documents', 'deliveries/${DELIVERY}/${DOC}.jpg');
    `)
  })

  afterAll(async () => {
    await t.close()
  })

  describe('droits accordés', () => {
    it('anon et PUBLIC n’ont aucun droit sur les tables', async () => {
      const grants = await t.rows(
        `select table_name, privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('anon', 'PUBLIC')`,
      )
      expect(grants).toEqual([])
    })

    it('anon ne peut exécuter que get_shared_view', async () => {
      const functions = await t.rows(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
      )
      expect(functions.map((f) => f.proname)).toEqual(['get_shared_view'])
    })

    it('authenticated n’exécute que les fonctions de l’application', async () => {
      const functions = await t.rows(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
      )
      expect(functions.map((f) => f.proname)).toEqual([
        'get_shared_view',
        'is_admin',
        'price_at',
        'revoke_share_links',
        'rotate_share_link',
        'save_delivery',
      ])
    })

    it('admin_allowlist : aucun droit pour authenticated', async () => {
      const [row] = await t.rows(
        `select has_table_privilege('authenticated', 'public.admin_allowlist', 'select, insert, update, delete') as any`,
      )
      expect(row?.any).toBe(false)
    })

    it('le hash des liens n’est pas lisible, le prix appliqué pas écrivable', async () => {
      const [row] = await t.rows(`
        select has_column_privilege('authenticated', 'public.share_links', 'token_hash', 'select') as hash_select,
               has_column_privilege('authenticated', 'public.deliveries', 'unit_price_cents_applied', 'insert') as price_insert,
               has_column_privilege('authenticated', 'public.deliveries', 'unit_price_cents_applied', 'update') as price_update`)
      expect(row).toEqual({ hash_select: false, price_insert: false, price_update: false })
    })

    it('RLS activée sur toutes les tables de public', async () => {
      const tables = await t.rows(
        `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by 1`,
      )
      expect(tables.length).toBe(TABLES.length)
      expect(tables.every((table) => table.relrowsecurity === true)).toBe(true)
    })
  })

  describe('is_admin()', () => {
    it('vrai pour l’admin connecté par Google ou par lien magique', async () => {
      for (const user of [ADMIN, ADMIN_OTP]) {
        const [row] = await t.as(user, () => t.rows('select public.is_admin() as ok'))
        expect(row?.ok).toBe(true)
      }
    })

    it.each(DENIED_USERS.filter(([, user]) => user !== 'anon'))('faux : %s', async (_label, user) => {
      const [row] = await t.as(user, () => t.rows('select public.is_admin() as ok'))
      expect(row?.ok).toBe(false)
    })

    it('non exécutable par anon', async () => {
      expect(await t.as('anon', () => errorCode(t.rows('select public.is_admin()')))).toBe('42501')
    })
  })

  describe('garde d’inscription', () => {
    it('refuse la création d’un compte hors liste', async () => {
      expect(await errorCode(t.rows(`insert into auth.users (email) values ('intrus@example.com')`))).toBe('42501')
    })

    it('accepte l’adresse autorisée, quelle que soit la casse', async () => {
      await t.rows(`delete from auth.users where id = $1`, [UNCONFIRMED.id])
      await t.rows(`insert into auth.users (id, email) values ($1, ' Second@Example.COM')`, [UNCONFIRMED.id])
      const [row] = await t.rows(`select count(*)::int as n from auth.users where id = $1`, [UNCONFIRMED.id])
      expect(row?.n).toBe(1)
    })
  })

  describe.each(DENIED_USERS)('refusé : %s', (_label, user) => {
    it.each(TABLES)('ne voit rien dans %s', async (table) => {
      expect(await visible(user, `select * from public.${table}`)).toEqual([])
    })

    it('ne peut rien créer', async () => {
      const attempts = [
        `insert into public.replacements (id, replaced_at) values ('${NEW_ID}', now())`,
        `insert into public.repayments (id, repayment_date, amount_cents) values ('${NEW_ID}', '2026-10-01', 100)`,
        `insert into public.price_settings (id, unit_price_cents, effective_from) values ('${NEW_ID}', 1, '2030-01-01')`,
        `insert into public.share_links (id, token_hash) values ('${NEW_ID}', repeat('b', 64))`,
        `insert into public.admin_allowlist (email) values ('intrus@example.com')`,
      ]
      for (const sql of attempts) {
        expect(await t.as(user, () => errorCode(t.rows(sql)))).toBe('42501')
      }
    })

    it('ne peut rien modifier ni supprimer', async () => {
      await t.as(user, async () => {
        for (const sql of [
          `update public.deliveries set bottles_total = 99`,
          `update public.replacements set note = 'piraté'`,
          `delete from public.replacements`,
          `delete from public.deliveries`,
          `delete from public.repayments`,
          `update public.share_links set revoked_at = now()`,
        ]) {
          // Refus de droit (anon) ou aucune ligne visible (RLS).
          expect([undefined, '42501']).toContain(await errorCode(t.rows(sql)))
        }
      })
      const [counts] = await t.rows(`
        select (select count(*)::int from public.deliveries where bottles_total = 3) as deliveries,
               (select count(*)::int from public.replacements where note is null) as replacements,
               (select count(*)::int from public.repayments) as repayments,
               (select count(*)::int from public.share_links where revoked_at is null) as links`)
      expect(counts).toEqual({ deliveries: 1, replacements: 2, repayments: 1, links: 1 })
    })

    it('ne peut appeler aucune RPC d’écriture', async () => {
      for (const sql of [
        `select public.save_delivery('{"id":"${NEW_ID}","delivery_date":"2026-10-20","bottles_total":2}', array['${PENDING}']::uuid[])`,
        `select public.rotate_share_link('${NEW_ID}', repeat('c', 64))`,
        `select public.revoke_share_links()`,
      ]) {
        expect(await t.as(user, () => errorCode(t.rows(sql)))).toBe('42501')
      }
    })

    it('n’accède pas au bucket documents', async () => {
      expect(await visible(user, `select name from storage.objects`)).toEqual([])
      const code = await t.as(user, () =>
        errorCode(t.rows(`insert into storage.objects (bucket_id, name) values ('documents', 'deliveries/${DELIVERY}/x.jpg')`)),
      )
      expect(code).toBe('42501')
      await t.as(user, () => t.rows(`delete from storage.objects`).catch(() => []))
      const [row] = await t.rows(`select count(*)::int as n from storage.objects`)
      expect(row?.n).toBe(1)
    })
  })

  describe('administrateur', () => {
    it('lit toutes les tables sauf admin_allowlist', async () => {
      for (const table of TABLES.filter((name) => name !== 'admin_allowlist' && name !== 'share_links')) {
        expect((await visible(ADMIN, `select * from public.${table}`)).length).toBeGreaterThan(0)
      }
      expect(await visible(ADMIN, 'select * from public.admin_allowlist')).toEqual([])
      expect(await visible(ADMIN, 'select id, created_at, revoked_at from public.share_links')).toHaveLength(1)
    })

    it('enregistre un remplacement, le modifie puis le supprime', async () => {
      await t.as(ADMIN, async () => {
        await t.rows(`insert into public.replacements (id, replaced_at, note) values ('${NEW_ID}', '2026-10-16T05:00:00Z', 'oubli')`)
        await t.rows(
          `insert into public.replacements (id, replaced_at, note) values ('${NEW_ID}', '2026-10-16T06:00:00Z', null)
           on conflict (id) do update set id = excluded.id, replaced_at = excluded.replaced_at, note = excluded.note`,
        )
        const [row] = await t.rows(`select replaced_on::text as day, note from public.replacements where id = '${NEW_ID}'`)
        expect(row).toEqual({ day: '2026-10-16', note: null })
        await t.rows(`delete from public.replacements where id = '${NEW_ID}'`)
      })
    })

    it('dépose, lit et supprime un document dans les dossiers prévus seulement', async () => {
      await t.as(ADMIN, async () => {
        await t.rows(`insert into storage.objects (bucket_id, name) values ('documents', 'soa/2026-10/${NEW_ID}.pdf')`)
        expect(await t.rows(`select name from storage.objects order by name`)).toHaveLength(2)
        expect(
          await errorCode(t.rows(`insert into storage.objects (bucket_id, name) values ('documents', 'ailleurs/${NEW_ID}.pdf')`)),
        ).toBe('42501')
        await t.rows(`delete from storage.objects where name = 'soa/2026-10/${NEW_ID}.pdf'`)
      })
      const [bucket] = await t.rows(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'`)
      expect(bucket).toEqual({
        public: false,
        file_size_limit: 10485760,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      })
    })

    it('ne peut pas écrire le prix appliqué ni lire le hash d’un lien', async () => {
      await t.as(ADMIN, async () => {
        expect(await errorCode(t.rows(`update public.deliveries set unit_price_cents_applied = 1`))).toBe('42501')
        expect(await errorCode(t.rows(`select token_hash from public.share_links`))).toBe('42501')
      })
    })
  })
})
