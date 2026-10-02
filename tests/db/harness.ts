import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const STUBS = readFileSync(join(HERE, "supabase-stubs.sql"), "utf8");

export type JwtClaims = {
  sub?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
};

export type ApiRole = "anon" | "authenticated" | "service_role";

export type TestDb = {
  /** Connexion superutilisateur (équivalent du propriétaire des tables). */
  db: PGlite;
  /**
   * Exécute `fn` dans une transaction en tant que `role`, avec les claims JWT
   * fournis, exactement comme PostgREST le fait pour une requête de l'API.
   */
  as<T>(role: ApiRole, claims: JwtClaims | null, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Comme `as`, mais renvoie l'erreur au lieu de la lever. */
  attempt<T>(
    role: ApiRole,
    claims: JwtClaims | null,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }>;
  close(): Promise<void>;
};

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Mode strict : imite un projet Supabase créé avec « Automatically expose new
 * tables » décoché (aucun droit par défaut pour anon, authenticated et
 * service_role). Les migrations doivent fonctionner dans les deux modes.
 */
const STRICT_DEFAULT_PRIVILEGES = `
  alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
  alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role, public;
  alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;
`;

export type TestDbOptions = { strict?: boolean };

/** Base PGlite neuve : stubs Supabase puis toutes les migrations, dans l'ordre. */
export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(STUBS);
  if (options.strict) {
    await db.exec(STRICT_DEFAULT_PRIVILEGES);
  }
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Échec de la migration ${file}: ${(error as Error).message}`);
    }
  }

  async function as<T>(
    role: ApiRole,
    claims: JwtClaims | null,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      const fullClaims = claims ? { role, ...claims } : { role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(fullClaims),
      ]);
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
  }

  async function attempt<T>(
    role: ApiRole,
    claims: JwtClaims | null,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
    try {
      return { ok: true, value: await as(role, claims, fn) };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  return { db, as, attempt, close: () => db.close() };
}

export const ADMIN = {
  id: "00000000-0000-4000-8000-00000000000a",
  email: "admin@example.com",
} as const;

export const INTRUDER = {
  id: "00000000-0000-4000-8000-0000000000e1",
  email: "intrus@gmail.com",
} as const;

/** Adresse allowlistée mais jamais confirmée (inscription non vérifiée). */
export const UNCONFIRMED = {
  id: "00000000-0000-4000-8000-0000000000c2",
  email: "admin2@example.com",
} as const;

/** Crée les utilisateurs de test et l'allowlist (en superutilisateur). */
export async function seedUsers(db: PGlite): Promise<void> {
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values
       ($1, $2, now()), ($3, $4, now()), ($5, $6, null)`,
    [ADMIN.id, "Admin@Example.com", INTRUDER.id, INTRUDER.email, UNCONFIRMED.id, UNCONFIRMED.email],
  );
  await db.query(`insert into public.admin_allowlist (email) values ($1), ($2)`, [
    ADMIN.email,
    UNCONFIRMED.email,
  ]);
}

export const adminClaims: JwtClaims = { sub: ADMIN.id, email: ADMIN.email };
export const intruderClaims: JwtClaims = { sub: INTRUDER.id, email: INTRUDER.email };
