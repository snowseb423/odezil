// Banc de test SQL : exécute les vraies migrations Supabase dans PGlite
// (Postgres compilé en WebAssembly) par-dessus un bouchon de
// l'environnement Supabase, dans deux configurations :
// - « défaut Supabase » : les rôles de l'API reçoivent par défaut tous les
//   droits sur les objets créés dans public (comportement historique) ;
// - « strict » : aucun droit par défaut (API non exposée automatiquement).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

export const MIGRATIONS = readdirSync(join(root, 'supabase/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: read(join('supabase/migrations', file)) }))

export type Mode = 'défaut Supabase' | 'strict'
export const MODES: Mode[] = ['défaut Supabase', 'strict']

export interface TestUser {
  id: string
  email: string
  /** Méthode d'authentification de la session (claim amr). */
  amr?: 'oauth' | 'otp' | 'password'
}

export const ADMIN: TestUser = { id: '00000000-0000-4000-8000-0000000000a1', email: 'admin@example.com', amr: 'oauth' }
/** Même compte que l'admin, session ouverte par lien magique / code. */
export const ADMIN_OTP: TestUser = { ...ADMIN, amr: 'otp' }
/** Même compte que l'admin, session ouverte par mot de passe : refusée. */
export const ADMIN_PASSWORD: TestUser = { ...ADMIN, amr: 'password' }
/** Compte Google quelconque (hors liste). */
export const MALLORY: TestUser = { id: '00000000-0000-4000-8000-0000000000ff', email: 'mallory@example.com', amr: 'oauth' }
/** Adresse autorisée mais jamais confirmée. */
export const UNCONFIRMED: TestUser = { id: '00000000-0000-4000-8000-0000000000b2', email: 'second@example.com', amr: 'oauth' }
/** JWT portant l'email de l'admin pour un autre compte. */
export const IMPOSTOR: TestUser = { id: MALLORY.id, email: ADMIN.email, amr: 'oauth' }

export type Row = Record<string, unknown>

export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export interface TestDb {
  db: PGlite
  /** Requête en superutilisateur (préparation des données). */
  rows(sql: string, params?: unknown[]): Promise<Row[]>
  /** Plusieurs instructions SQL d'un coup, sans paramètres. */
  exec(sql: string): Promise<void>
  /** Exécute `fn` avec le rôle anon, ou authenticated et le JWT de `user`. */
  as<T>(user: TestUser | 'anon', fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Code SQLSTATE de l'erreur levée par `promise`, ou undefined si elle réussit. */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
  return undefined
}

export async function createTestDb(mode: Mode): Promise<TestDb> {
  const db = new PGlite()
  await db.exec(read('tests/sql/supabase-stub.sql'))
  if (mode === 'défaut Supabase') {
    await db.exec(`
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `)
  }
  // Comptes existants avant l'installation de la garde d'inscription.
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values
       ($1, $2, now()), ($3, $4, now()), ($5, $6, null)`,
    [ADMIN.id, ADMIN.email, MALLORY.id, MALLORY.email, UNCONFIRMED.id, UNCONFIRMED.email],
  )
  for (const migration of MIGRATIONS) {
    try {
      await db.exec(migration.sql)
    } catch (error) {
      throw new Error(`Migration ${migration.file} : ${(error as Error).message}`, { cause: error })
    }
  }
  await db.query(`insert into public.admin_allowlist (email) values ($1), ($2)`, [ADMIN.email, UNCONFIRMED.email])

  const rows = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows

  async function as<T>(user: TestUser | 'anon', fn: () => Promise<T>): Promise<T> {
    const role = user === 'anon' ? 'anon' : 'authenticated'
    const claims =
      user === 'anon'
        ? { role }
        : { sub: user.id, email: user.email, role, amr: [{ method: user.amr ?? 'oauth', timestamp: 1_760_000_000 }] }
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
      await db.query(`select set_config('request.jwt.claims', '', false)`)
    }
  }

  const exec = async (sql: string) => {
    await db.exec(sql)
  }

  return { db, rows, exec, as, close: () => db.close() }
}
