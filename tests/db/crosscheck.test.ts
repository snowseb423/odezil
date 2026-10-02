import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { priceInEffect, type PriceSetting } from "@/lib/calculations";
import { createTestDb, type TestDb } from "./harness";

// La recherche du prix en vigueur existe en SQL (trigger qui fige le prix) et
// en TS (aperçu en direct du formulaire). Les deux doivent toujours concorder.

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

describe("prix en vigueur : trigger SQL ≡ priceInEffect()", () => {
  it("donne le même prix pour chaque date", async () => {
    await t.db.exec(`
      insert into public.price_settings (unit_price_cents, effective_from) values
        (25000, '2026-03-01'), (24500, '2026-07-15'), (26000, '2027-01-01');
    `);
    const { rows } = await t.db.query<{ unit_price_cents: number; effective_from: string }>(
      `select unit_price_cents, effective_from::text from public.price_settings`,
    );
    const prices: PriceSetting[] = rows.map((r) => ({
      unitPriceCents: r.unit_price_cents,
      effectiveFrom: r.effective_from,
    }));

    const dates = [
      "2000-01-01",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-07-14",
      "2026-07-15",
      "2026-12-31",
      "2027-01-01",
      "2030-06-30",
    ];
    for (const date of dates) {
      const { rows: inserted } = await t.db.query<{ p: number }>(
        `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied)
         values ($1, 1, 1, 1) returning unit_price_cents_applied as p`,
        [date],
      );
      expect(inserted[0]!.p, date).toBe(priceInEffect(prices, date));
    }
  });
});
