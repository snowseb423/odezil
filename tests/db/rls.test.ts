import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN,
  INTRUDER,
  UNCONFIRMED,
  adminClaims,
  createTestDb,
  intruderClaims,
  seedUsers,
  type ApiRole,
  type JwtClaims,
  type TestDb,
} from "./harness";

// Isolation (b) : une session authentifiée dont l'email n'est PAS dans
// admin_allowlist (cas de n'importe quel compte Google) ne peut ni lire ni
// écrire aucune table ni le bucket, même en appelant l'API directement.
// Toute la suite tourne avec les droits par défaut de Supabase (tout accordé
// à l'API) et en mode strict (aucun droit par défaut).

const DATA_TABLES = [
  "price_settings",
  "deliveries",
  "soa_statements",
  "repayments",
  "share_links",
] as const;
const ALL_TABLES = ["admin_allowlist", ...DATA_TABLES] as const;

const VALID_INSERTS: Record<(typeof ALL_TABLES)[number], string> = {
  admin_allowlist: `insert into public.admin_allowlist (email) values ('pirate@gmail.com')`,
  price_settings: `insert into public.price_settings (unit_price_cents, effective_from) values (1, '2030-01-01')`,
  deliveries: `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ('2026-09-15', 1, 1, 1)`,
  soa_statements: `insert into public.soa_statements (month, total_billed_cents, variance_cents) values ('2030-01-01', 1, 0)`,
  repayments: `insert into public.repayments (repayment_date, amount_cents) values ('2026-09-20', 100)`,
  share_links: `insert into public.share_links (token_hash) values ('${"b".repeat(64)}')`,
};

/** Refus attendus : RLS, droit manquant, ou trigger de prix (qui ne voit aucun prix). */
const DENIED = /row-level security|permission denied|Aucun prix unitaire/;

function suite(strict: boolean) {
  let t: TestDb;

  async function superCount(table: string): Promise<number> {
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
    return rows[0]!.n;
  }

  beforeAll(async () => {
    t = await createTestDb({ strict });
    await seedUsers(t.db);
    await t.db.exec(`
      insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied, photo_path, note)
        values ('2026-09-02', 2, 3, 0, 'deliveries/2026/secret.jpg', 'note admin');
      insert into public.soa_statements (month, total_billed_cents, variance_cents, variance_treatment)
        values ('2026-09-01', 120000, 0, 'pending');
      insert into public.repayments (repayment_date, amount_cents) values ('2026-09-10', 50000);
      insert into public.share_links (token_hash) values ('${"a".repeat(64)}');
      insert into storage.objects (bucket_id, name) values ('bons-livraison', 'deliveries/2026/secret.jpg');
    `);
  });

  afterAll(async () => {
    await t.close();
  });

  function describeNonAdmin(label: string, role: ApiRole, claims: JwtClaims | null) {
    describe(label, () => {
      it.each(DATA_TABLES)("ne lit aucune ligne de %s", async (table) => {
        const result = await t.attempt(role, claims, (tx) => tx.query(`select * from public.${table}`));
        if (result.ok) {
          expect(result.value.rows).toHaveLength(0);
        } else {
          expect(result.error.message).toMatch(/permission denied/);
        }
      });

      it("n'a aucun accès à admin_allowlist", async () => {
        const result = await t.attempt(role, claims, (tx) => tx.query(`select * from public.admin_allowlist`));
        expect(result.ok).toBe(false);
      });

      it.each(ALL_TABLES)("ne peut pas insérer dans %s", async (table) => {
        const before = await superCount(`public.${table}`);
        const result = await t.attempt(role, claims, (tx) => tx.query(VALID_INSERTS[table]));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toMatch(DENIED);
        }
        expect(await superCount(`public.${table}`)).toBe(before);
      });

      it("ne peut ni modifier ni supprimer de données", async () => {
        const statements = [
          `update public.soa_statements set variance_treatment = 'impute_to_b'`,
          `update public.share_links set revoked_at = now()`,
          `delete from public.deliveries`,
          `delete from public.repayments`,
          `delete from public.soa_statements`,
          `delete from public.price_settings`,
          `delete from public.share_links`,
        ];
        for (const sql of statements) {
          const result = await t.attempt(role, claims, (tx) => tx.query(sql));
          if (result.ok) {
            expect(result.value.affectedRows ?? 0, sql).toBe(0);
          } else {
            expect(result.error.message).toMatch(/permission denied/);
          }
        }
        expect(await superCount("public.deliveries")).toBeGreaterThan(0);
        expect(await superCount("public.repayments")).toBeGreaterThan(0);
        expect(await superCount("public.soa_statements")).toBeGreaterThan(0);
        expect(await superCount("public.price_settings")).toBeGreaterThan(0);
        const { rows } = await t.db.query<{ n: number }>(
          `select count(*)::int as n from public.share_links where revoked_at is null`,
        );
        expect(rows[0]!.n).toBe(1);
        const soa = await t.db.query<{ variance_treatment: string }>(
          `select variance_treatment from public.soa_statements`,
        );
        expect(soa.rows[0]!.variance_treatment).toBe("pending");
      });

      it("ne voit, ne dépose, ne modifie ni ne supprime aucune photo du bucket", async () => {
        const read = await t.attempt(role, claims, (tx) =>
          tx.query(`select * from storage.objects where bucket_id = 'bons-livraison'`),
        );
        if (read.ok) expect(read.value.rows).toHaveLength(0);

        const before = await superCount("storage.objects");
        const write = await t.attempt(role, claims, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name) values ('bons-livraison', 'pirate.jpg')`),
        );
        expect(write.ok).toBe(false);
        for (const sql of [
          `update storage.objects set name = 'pirate.jpg' where bucket_id = 'bons-livraison'`,
          `delete from storage.objects where bucket_id = 'bons-livraison'`,
          `update storage.buckets set public = true where id = 'bons-livraison'`,
        ]) {
          const result = await t.attempt(role, claims, (tx) => tx.query(sql));
          if (result.ok) expect(result.value.affectedRows ?? 0, sql).toBe(0);
        }
        expect(await superCount("storage.objects")).toBe(before);
        const { rows } = await t.db.query<{ name: string }>(
          `select name from storage.objects where bucket_id = 'bons-livraison' order by name limit 1`,
        );
        expect(rows[0]!.name).toBe("deliveries/2026/secret.jpg");
        const bucket = await t.db.query<{ public: boolean }>(`select public from storage.buckets where id = 'bons-livraison'`);
        expect(bucket.rows[0]!.public).toBe(false);
      });

      it("is_admin() n'est jamais vrai", async () => {
        const result = await t.attempt(role, claims, (tx) =>
          tx.query<{ ok: boolean }>(`select public.is_admin() as ok`),
        );
        if (result.ok) {
          expect(result.value.rows[0]!.ok).toBe(false);
        } else {
          expect(result.error.message).toMatch(/permission denied/);
        }
      });
    });
  }

  describeNonAdmin("anon (aucune session)", "anon", null);
  describeNonAdmin("compte Google non autorisé", "authenticated", intruderClaims);
  describeNonAdmin("JWT d'un intrus portant l'email de l'admin (uid ≠)", "authenticated", {
    sub: INTRUDER.id,
    email: ADMIN.email,
  });
  describeNonAdmin("email allowlisté mais non confirmé", "authenticated", {
    sub: UNCONFIRMED.id,
    email: UNCONFIRMED.email,
  });
  describeNonAdmin("JWT sans sub, avec l'email de l'admin", "authenticated", { email: ADMIN.email });
  describeNonAdmin("JWT de l'admin sans email", "authenticated", { sub: ADMIN.id });
  describeNonAdmin("session de l'admin ouverte par mot de passe (compte pré-créé)", "authenticated", {
    ...adminClaims,
    amr: [{ method: "password", timestamp: 1_700_000_000 }],
  });
  describeNonAdmin("session par mot de passe, amr au format RFC 8176", "authenticated", {
    ...adminClaims,
    amr: ["oauth", "password"],
  });

  describe("anon : aucun droit SQL", () => {
    it.each(ALL_TABLES)("permission refusée sur %s", async (table) => {
      const result = await t.attempt("anon", null, (tx) => tx.query(`select 1 from public.${table}`));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/permission denied/);
    });
  });

  describe("compte non autorisé : aucun oracle sur les dates de prix", () => {
    it("même erreur quelle que soit la date de livraison", async () => {
      const messages = new Set<string>();
      for (const date of ["1999-12-31", "2000-01-01", "2026-09-15"]) {
        const result = await t.attempt("authenticated", intruderClaims, (tx) =>
          tx.query(
            `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ($1, 1, 1, 1)`,
            [date],
          ),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) messages.add(result.error.message.replace(/\d{4}-\d{2}-\d{2}/, "<date>"));
      }
      expect(messages.size).toBe(1);
    });
  });

  describe("fonctions exposées à l'API", () => {
    it("anon ne peut exécuter aucune fonction de public", async () => {
      const { rows } = await t.db.query<{ fn: string }>(
        `select p.oid::regprocedure::text as fn
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
      );
      expect(rows).toEqual([]);
    });

    it("authenticated ne peut exécuter que is_admin()", async () => {
      const { rows } = await t.db.query<{ fn: string }>(
        `select p.oid::regprocedure::text as fn
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')`,
      );
      expect(rows.map((r) => r.fn)).toEqual(["is_admin()"]);
    });

    it("une future fonction créée par postgres n'est pas exécutable par anon", async () => {
      await t.db.exec(`create function public.__probe() returns int language sql as $$ select 1 $$`);
      const { rows } = await t.db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', 'public.__probe()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.__probe()', 'execute') as authenticated`,
      );
      await t.db.exec(`drop function public.__probe()`);
      expect(rows[0]).toEqual({ anon: false, authenticated: false });
    });
  });

  describe("service_role", () => {
    it("peut alimenter admin_allowlist (npm run seed:admin, idempotent)", async () => {
      for (let i = 0; i < 2; i += 1) {
        await t.as("service_role", null, (tx) =>
          tx.query(`insert into public.admin_allowlist (email) values ('seed@example.com') on conflict (email) do nothing`),
        );
      }
      const { rows } = await t.db.query<{ n: number }>(
        `select count(*)::int as n from public.admin_allowlist where email = 'seed@example.com'`,
      );
      expect(rows[0]!.n).toBe(1);
    });
  });

  describe("admin autorisé (contrôle positif)", () => {
    it("lit toutes les tables de données, même avec un email en majuscules dans le JWT", async () => {
      const claims = { sub: ADMIN.id, email: "ADMIN@EXAMPLE.COM" };
      for (const table of DATA_TABLES) {
        const { rows } = await t.as("authenticated", claims, (tx) => tx.query(`select * from public.${table}`));
        expect(rows.length, table).toBeGreaterThan(0);
      }
    });

    it("is_admin() est vrai pour une session Google ou lien magique", async () => {
      for (const amr of [undefined, [{ method: "oauth", timestamp: 1 }], [{ method: "otp", timestamp: 1 }], ["magiclink"]]) {
        const { rows } = await t.as("authenticated", { ...adminClaims, ...(amr ? { amr } : {}) }, (tx) =>
          tx.query<{ ok: boolean }>(`select public.is_admin() as ok`),
        );
        expect(rows[0]!.ok, JSON.stringify(amr)).toBe(true);
      }
    });

    it("peut écrire dans les tables autorisées", async () => {
      await t.as("authenticated", adminClaims, async (tx) => {
        await tx.query(
          `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ('2026-09-16', 1, 2, 1)`,
        );
        await tx.query(`insert into public.repayments (repayment_date, amount_cents) values ('2026-09-21', 1000)`);
        await tx.query(`update public.soa_statements set variance_treatment = 'split_50_50'`);
        await tx.query(`insert into public.price_settings (unit_price_cents, effective_from) values (25000, '2031-01-01')`);
        await tx.query(`delete from public.price_settings where effective_from = '2031-01-01'`);
        await tx.query(`update public.share_links set revoked_at = now() where revoked_at is null`);
        await tx.query(`insert into public.share_links (token_hash) values ('${"c".repeat(64)}')`);
      });
      const { rows } = await t.db.query<{ unit_price_cents_applied: number }>(
        `select unit_price_cents_applied from public.deliveries where delivery_date = '2026-09-16'`,
      );
      // Le prix envoyé (1) est ignoré : le trigger applique le prix en vigueur.
      expect(rows[0]!.unit_price_cents_applied).toBe(24000);
    });

    it("ne peut pas modifier une livraison (prix figé)", async () => {
      const result = await t.attempt("authenticated", adminClaims, (tx) =>
        tx.query(`update public.deliveries set unit_price_cents_applied = 1`),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/permission denied for table deliveries/);
    });

    it("ne peut modifier que revoked_at sur share_links", async () => {
      const result = await t.attempt("authenticated", adminClaims, (tx) =>
        tx.query(`update public.share_links set token_hash = '${"d".repeat(64)}' where revoked_at is null`),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/permission denied for table share_links/);
    });

    it("n'accède pas à admin_allowlist via l'API", async () => {
      const result = await t.attempt("authenticated", adminClaims, (tx) =>
        tx.query(`select * from public.admin_allowlist`),
      );
      expect(result.ok).toBe(false);
    });

    it("accède aux photos du bucket privé", async () => {
      const { rows } = await t.as("authenticated", adminClaims, async (tx) => {
        await tx.query(
          `insert into storage.objects (bucket_id, name) values ('bons-livraison', 'deliveries/2026/new.jpg')`,
        );
        return tx.query(`select name from storage.objects where bucket_id = 'bons-livraison'`);
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it("n'accède pas à un autre bucket", async () => {
      await t.db.exec(`
        insert into storage.buckets (id, name, public) values ('autre', 'autre', false) on conflict do nothing;
        insert into storage.objects (bucket_id, name) values ('autre', 'x.jpg') on conflict do nothing;
      `);
      const { rows } = await t.as("authenticated", adminClaims, (tx) =>
        tx.query(`select name from storage.objects where bucket_id = 'autre'`),
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe("bucket bons-livraison", () => {
    it("est privé", async () => {
      const { rows } = await t.db.query<{ public: boolean }>(
        `select public from storage.buckets where id = 'bons-livraison'`,
      );
      expect(rows[0]!.public).toBe(false);
    });
  });

  describe("RLS activé partout", () => {
    it("toutes les tables de public ont RLS", async () => {
      const { rows } = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(ALL_TABLES.length);
      for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
    });

    it("aucune politique ne cible anon ou public", async () => {
      const { rows } = await t.db.query<{ policyname: string; roles: string }>(
        `select policyname, roles::text as roles from pg_policies where schemaname in ('public', 'storage')`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.roles, row.policyname).toBe("{authenticated}");
      }
    });
  });

  describe("hook before-user-created (optionnel)", () => {
    async function callHook(email: string, provider: string) {
      const { rows } = await t.db.query<{ r: Record<string, unknown> }>(
        `select public.hook_before_user_created($1::jsonb) as r`,
        [JSON.stringify({ metadata: { name: "before-user-created" }, user: { email, app_metadata: { provider } } })],
      );
      return rows[0]!.r;
    }
    const REFUSED = { error: { http_code: 403, message: "Accès non autorisé" } };

    it("accepte l'adresse allowlistée via Google (insensible à la casse)", async () => {
      expect(await callHook("ADMIN@example.com", "google")).toEqual({});
    });

    it("refuse toute autre adresse Google", async () => {
      expect(await callHook(INTRUDER.email, "google")).toEqual(REFUSED);
      expect(await callHook("", "google")).toEqual(REFUSED);
    });

    it("refuse toute inscription par email, même sur l'adresse admin (pas de compte pré-créé)", async () => {
      expect(await callHook(ADMIN.email, "email")).toEqual(REFUSED);
      expect(await callHook(INTRUDER.email, "email")).toEqual(REFUSED);
    });

    it("est exécutable par supabase_auth_admin", async () => {
      const { rows } = await t.db.query<{ ok: boolean }>(
        `select has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute')
            and has_schema_privilege('supabase_auth_admin', 'public', 'usage') as ok`,
      );
      expect(rows[0]!.ok).toBe(true);
    });

    it("n'est pas exécutable par les rôles de l'API", async () => {
      for (const role of ["anon", "authenticated"] as const) {
        const result = await t.attempt(role, role === "anon" ? null : adminClaims, (tx) =>
          tx.query(`select public.hook_before_user_created('{}'::jsonb)`),
        );
        expect(result.ok, role).toBe(false);
      }
    });
  });
}

describe("droits par défaut de Supabase (tout accordé à l'API)", () => suite(false));
describe("projet strict (aucun droit par défaut)", () => suite(true));
