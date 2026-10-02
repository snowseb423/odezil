import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CardinalStatementView } from "@/components/cardinal-statement-view";
import { varianceImpactOnB } from "@/lib/calculations";
import { buildCardinalStatement } from "@/lib/cardinal-statement";
import { loadCardinalView } from "@/lib/data/cardinal";
import { generateShareToken, hashShareToken } from "@/lib/share-token";
import { adminClaims, createTestDb, intruderClaims, seedUsers, type TestDb } from "./harness";

// Isolation (a) : la page partagée ne renvoie aucune donnée du Macoua ni
// aucune photo. On remplit la base de valeurs « sentinelles » propres au
// Macoua et on vérifie qu'elles n'apparaissent ni dans la réponse de la RPC,
// ni dans le HTML rendu.

const PEPPER = "pepper-de-test-suffisamment-long-0123456789";
const SENTINELS = {
  bottlesA: 977, // bonbonnes du Macoua
  photo: "SECRET-PHOTO-MACOUA",
  deliveryNote: "NOTE-SECRETE-LIVRAISON",
  soaNote: "NOTE-SECRETE-SOA",
  repaymentNote: "NOTE-SECRETE-REMBOURSEMENT",
  soaTotal: 9_876_543, // total SOA brut
  varianceToA: 31_337, // écart imputé au Macoua
  splitVariance: 1_001, // écart brut 50/50 (seule la part B, 500, doit apparaître)
};

let t: TestDb;
let token: string;

async function snapshot(tokenHash: string): Promise<unknown> {
  const { rows } = await t.as("service_role", null, (tx) =>
    tx.query<{ s: unknown }>("select public.share_snapshot($1) as s", [tokenHash]),
  );
  return rows[0]!.s;
}

const rpc = (tokenHash: string) => snapshot(tokenHash);

beforeAll(async () => {
  t = await createTestDb();
  await seedUsers(t.db);
  token = generateShareToken();
  await t.db.query(
    `insert into public.deliveries (delivery_date, bottles_a, bottles_b, unit_price_cents_applied, photo_path, note) values
       ('2026-08-05', $1, 2, 0, $2, $3),
       ('2026-09-02', $1, 3, 0, null, null),
       ('2026-09-20', 4, 0, 0, null, null)`,
    [SENTINELS.bottlesA, `2026/${SENTINELS.photo}.jpg`, SENTINELS.deliveryNote],
  );
  await t.db.query(
    `insert into public.soa_statements (month, total_billed_cents, variance_cents, variance_treatment, note) values
       ('2026-07-01', $1, $2, 'impute_to_a', $3),
       ('2026-08-01', $1, $4, 'split_50_50', null),
       ('2026-09-01', $1, -24000, 'impute_to_b', null),
       ('2026-10-01', $1, 777, 'pending', null)`,
    [SENTINELS.soaTotal, SENTINELS.varianceToA, SENTINELS.soaNote, SENTINELS.splitVariance],
  );
  await t.db.query(
    `insert into public.repayments (repayment_date, amount_cents, note) values ('2026-09-10', 50000, $1)`,
    [SENTINELS.repaymentNote],
  );
  await t.db.query(`insert into public.share_links (token_hash) values ($1)`, [hashShareToken(token, PEPPER)]);
  await t.db.exec(
    `insert into storage.objects (bucket_id, name) values ('bons-livraison', '2026/${SENTINELS.photo}.jpg')`,
  );
});

afterAll(async () => {
  await t.close();
});

function expectNoSentinel(text: string) {
  for (const [name, value] of Object.entries(SENTINELS)) {
    expect(text, `fuite de ${name}`).not.toContain(String(value));
  }
  expect(text).not.toMatch(/photo|note|bottles_a|total_billed|variance/i);
}

describe("RPC share_snapshot", () => {
  it("ne renvoie que les champs autorisés", async () => {
    const raw = (await snapshot(hashShareToken(token, PEPPER))) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.keys(raw).sort()).toEqual(["adjustments", "deliveries", "repayments"]);
    for (const row of raw.deliveries!) expect(Object.keys(row).sort()).toEqual(["bottles", "date", "unit_price_cents"]);
    for (const row of raw.adjustments!) expect(Object.keys(row).sort()).toEqual(["amount_cents", "month"]);
    for (const row of raw.repayments!) expect(Object.keys(row).sort()).toEqual(["amount_cents", "date"]);
  });

  it("ne contient aucune donnée du Macoua ni photo ni note", async () => {
    expectNoSentinel(JSON.stringify(await snapshot(hashShareToken(token, PEPPER))));
  });

  it("contient les données du Cardinal attendues", async () => {
    const raw = await snapshot(hashShareToken(token, PEPPER));
    expect(raw).toEqual({
      deliveries: [
        { date: "2026-08-05", bottles: 2, unit_price_cents: 24000 },
        { date: "2026-09-02", bottles: 3, unit_price_cents: 24000 },
      ],
      adjustments: [
        { month: "2026-08", amount_cents: 500 },
        { month: "2026-09", amount_cents: -24000 },
      ],
      repayments: [{ date: "2026-09-10", amount_cents: 50000 }],
    });
  });

  it("token inconnu ou révoqué : null", async () => {
    expect(await snapshot(hashShareToken(generateShareToken(), PEPPER))).toBeNull();
    expect(await snapshot(hashShareToken(token, "autre-pepper-0123456789-0123456789"))).toBeNull();

    const revoked = generateShareToken();
    await t.db.query(`insert into public.share_links (token_hash, revoked_at) values ($1, now())`, [
      hashShareToken(revoked, PEPPER),
    ]);
    expect(await snapshot(hashShareToken(revoked, PEPPER))).toBeNull();
  });

  it("n'est exécutable ni par anon, ni par un compte authentifié (même l'admin)", async () => {
    const hash = hashShareToken(token, PEPPER);
    for (const [role, claims] of [
      ["anon", null],
      ["authenticated", intruderClaims],
      ["authenticated", adminClaims],
    ] as const) {
      const result = await t.attempt(role, claims, (tx) => tx.query("select public.share_snapshot($1)", [hash]));
      expect(result.ok, `${role} ${claims?.email ?? ""}`).toBe(false);
      if (!result.ok) expect(result.error.message).toMatch(/permission denied/);
    }
  });

  it("part 50/50 : la division SQL concorde avec varianceImpactOnB()", async () => {
    const { rows } = await t.db.query<{ v: number; half: number }>(
      `select v, v / 2 as half from generate_series(-1001, 1001) as v`,
    );
    for (const { v, half } of rows) {
      expect(half, String(v)).toBe(varianceImpactOnB(v, "split_50_50"));
    }
  });
});

describe("page Cardinal", () => {
  it("le HTML rendu ne contient aucune donnée du Macoua ni photo", async () => {
    const view = await loadCardinalView(token, rpc, PEPPER);
    expect(view).not.toBeNull();
    const html = renderToStaticMarkup(<CardinalStatementView statement={buildCardinalStatement(view!)} />);
    expectNoSentinel(html);
    expect(html).not.toMatch(/<img|<a |<form|<script|<button|<input/);
  });

  it("affiche livraisons, totaux mensuels, ajustements, remboursements et solde", async () => {
    const view = await loadCardinalView(token, rpc, PEPPER);
    const statement = buildCardinalStatement(view!);
    // 5 bonbonnes × 240 + 5,00 − 240,00 − 500,00 de remboursement
    expect(statement.balanceCents).toBe(120_000 + 500 - 24_000 - 50_000);
    const html = renderToStaticMarkup(<CardinalStatementView statement={statement} />).replaceAll(" ", " ");
    expect(html).toContain("Solde à régler");
    expect(html).toContain("Rs 465,00");
    expect(html).toContain("Septembre 2026");
    expect(html).toContain("2 septembre 2026 · 3 bonbonnes × Rs 240,00");
    expect(html).toContain("Ajustement (relevé Odezil)");
    expect(html).toContain("+Rs 5,00");
    expect(html).toContain("-Rs 240,00");
    expect(html).toContain("Remboursements reçus");
    expect(html).toContain("Rs 500,00");
  });

  it("token mal formé : null, sans même interroger la base", async () => {
    const spy = vi.fn(rpc);
    for (const bad of ["", "abc", `${token}x`, "../../etc/passwd", token.replace(/./, "!")]) {
      expect(await loadCardinalView(bad, spy, PEPPER)).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("token révoqué ou inconnu : null (→ 404)", async () => {
    expect(await loadCardinalView(generateShareToken(), rpc, PEPPER)).toBeNull();
  });
});

describe("route /p/[token]", () => {
  it("token invalide : notFound() (404 générique)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data/cardinal", () => ({ getCardinalView: async () => null }));
    const { default: CardinalPage } = await import("@/app/p/[token]/page");
    await expect(CardinalPage({ params: Promise.resolve({ token: "x" }) } as never)).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    vi.doUnmock("@/lib/data/cardinal");
  });

  it("déclare noindex, no-referrer et rendu dynamique", async () => {
    vi.resetModules();
    const page = await import("@/app/p/[token]/page");
    expect(page.dynamic).toBe("force-dynamic");
    expect(page.metadata.robots).toMatchObject({ index: false, follow: false });
    expect(page.metadata.referrer).toBe("no-referrer");
  });

  it("en-têtes HTTP : no-store, noindex, no-referrer", async () => {
    const { default: config } = await import("@/next.config");
    const rules = await config.headers!();
    const rule = rules.find((r) => r.source === "/p/:path*");
    const headers = Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["X-Robots-Tag"]).toContain("noindex");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    // La règle /p doit venir après la règle globale pour l'emporter.
    expect(rules.findIndex((r) => r.source === "/p/:path*")).toBeGreaterThan(rules.findIndex((r) => r.source === "/:path*"));
  });

  it("le proxy (session Supabase) ne s'exécute pas sur /p/", async () => {
    const { config } = await import("@/proxy");
    expect(new RegExp(`^${config.matcher[0]!}$`).test(`/p/${token}`)).toBe(false);
  });
});
