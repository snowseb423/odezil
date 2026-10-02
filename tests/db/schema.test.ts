import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClaims, createTestDb, seedUsers, type TestDb } from "./harness";

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
  await seedUsers(t.db);
});

afterAll(async () => {
  await t.close();
});

async function insertDelivery(date: string, a = 1, b = 1): Promise<number> {
  const { rows } = await t.as("authenticated", adminClaims, (tx) =>
    tx.query<{ unit_price_cents_applied: number }>(
      `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied)
       values ($1, $2, $3, 999999) returning unit_price_cents_applied`,
      [date, a, b],
    ),
  );
  return rows[0]!.unit_price_cents_applied;
}

async function priceOf(date: string): Promise<number[]> {
  const { rows } = await t.db.query<{ p: number }>(
    `select unit_price_cents_applied as p from public.deliveries where delivery_date = $1 order by created_at`,
    [date],
  );
  return rows.map((r) => r.p);
}

describe("prix figé à la création d'une livraison", () => {
  it("applique le prix initial de Rs 240", async () => {
    expect(await insertDelivery("2026-01-10")).toBe(24000);
  });

  it("applique le nouveau prix à partir de sa date d'effet, sans toucher au passé", async () => {
    await t.as("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.price_settings (unit_price_cents, effective_from) values (25000, '2026-02-01')`),
    );
    expect(await insertDelivery("2026-01-31")).toBe(24000); // veille
    expect(await insertDelivery("2026-02-01")).toBe(25000); // jour même
    expect(await insertDelivery("2026-02-02")).toBe(25000); // lendemain
    expect(await priceOf("2026-01-10")).toEqual([24000]);
  });

  it("supprimer un prix n'altère pas les livraisons déjà saisies", async () => {
    await t.as("authenticated", adminClaims, (tx) =>
      tx.query(`delete from public.price_settings where effective_from = '2026-02-01'`),
    );
    expect(await priceOf("2026-02-01")).toEqual([25000]);
    expect(await insertDelivery("2026-02-03")).toBe(24000);
  });

  it("refuse une livraison sans prix en vigueur", async () => {
    const result = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(
        `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied)
         values ('1999-12-31', 1, 0, 1)`,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/Aucun prix unitaire en vigueur/);
  });

  it("refuse deux prix à la même date d'effet", async () => {
    const result = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.price_settings (unit_price_cents, effective_from) values (1, '2000-01-01')`),
    );
    expect(result.ok).toBe(false);
  });
});

describe("contraintes", () => {
  const cases: Array<[string, string]> = [
    ["aucune bonbonne", `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ('2026-03-01', 0, 0, 1)`],
    ["bonbonnes A négatives", `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ('2026-03-01', -1, 2, 1)`],
    ["bonbonnes B négatives", `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied) values ('2026-03-01', 2, -1, 1)`],
    ["prix nul", `insert into public.price_settings (unit_price_cents, effective_from) values (0, '2027-01-01')`],
    ["remboursement nul", `insert into public.repayments (repayment_date, amount_cents) values ('2026-03-01', 0)`],
    ["remboursement négatif", `insert into public.repayments (repayment_date, amount_cents) values ('2026-03-01', -5)`],
    ["SOA hors premier jour du mois", `insert into public.soa_statements (month, total_billed_cents, variance_cents) values ('2026-03-15', 100, 0)`],
    ["SOA négatif", `insert into public.soa_statements (month, total_billed_cents, variance_cents) values ('2026-04-01', -1, 0)`],
    ["traitement d'écart inconnu", `insert into public.soa_statements (month, total_billed_cents, variance_cents, variance_treatment) values ('2026-05-01', 1, 1, 'ignore')`],
    ["hash de token mal formé", `insert into public.share_links (token_hash) values ('pas-un-hash')`],
  ];

  it.each(cases)("refuse : %s", async (_label, sql) => {
    const result = await t.attempt("authenticated", adminClaims, (tx) => tx.query(sql));
    expect(result.ok).toBe(false);
  });

  it("un seul SOA par mois", async () => {
    await t.as("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.soa_statements (month, total_billed_cents, variance_cents) values ('2026-06-01', 1, 0)`),
    );
    const result = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.soa_statements (month, total_billed_cents, variance_cents) values ('2026-06-01', 2, 0)`),
    );
    expect(result.ok).toBe(false);
  });

  it("met à jour updated_at à la modification d'un SOA", async () => {
    // Insertion en superutilisateur avec une date ancienne (un INSERT ne
    // déclenche pas le trigger BEFORE UPDATE).
    await t.db.query(
      `insert into public.soa_statements (month, total_billed_cents, variance_cents, updated_at)
       values ('2026-07-01', 1, 0, '2000-01-01T00:00:00Z')`,
    );
    await t.as("authenticated", adminClaims, (tx) =>
      tx.query(`update public.soa_statements set total_billed_cents = 3 where month = '2026-07-01'`),
    );
    const { rows } = await t.db.query<{ updated_at: Date }>(
      `select updated_at from public.soa_statements where month = '2026-07-01'`,
    );
    expect(rows[0]!.updated_at.getTime()).toBeGreaterThan(Date.parse("2000-01-01T00:00:00Z"));
  });

  it("un seul lien de partage actif à la fois", async () => {
    await t.as("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.share_links (token_hash) values ('${"1".repeat(64)}')`),
    );
    const second = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(`insert into public.share_links (token_hash) values ('${"2".repeat(64)}')`),
    );
    expect(second.ok).toBe(false);

    // Révoquer puis régénérer fonctionne.
    await t.as("authenticated", adminClaims, async (tx) => {
      await tx.query(`update public.share_links set revoked_at = now() where revoked_at is null`);
      await tx.query(`insert into public.share_links (token_hash) values ('${"2".repeat(64)}')`);
    });
    const { rows } = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.share_links where revoked_at is null`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("une révocation est définitive", async () => {
    const result = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(`update public.share_links set revoked_at = null where token_hash = $1`, ["1".repeat(64)]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/ne peut pas être réactivé/);
    const changed = await t.attempt("authenticated", adminClaims, (tx) =>
      tx.query(`update public.share_links set revoked_at = now() where token_hash = $1`, ["1".repeat(64)]),
    );
    expect(changed.ok).toBe(false);
  });

  it("il reste toujours au moins un prix", async () => {
    const result = await t.attempt("authenticated", adminClaims, (tx) => tx.query(`delete from public.price_settings`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/dernier prix unitaire/);
    const { rows } = await t.db.query<{ n: number }>(`select count(*)::int as n from public.price_settings`);
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});
