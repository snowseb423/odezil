import { describe, expect, it } from "vitest";
import {
  adjustmentsForB,
  balanceB,
  computeVariance,
  deliveryShareA,
  deliveryShareB,
  deliveryTotal,
  monthExpectedTotal,
  monthlySummaries,
  priceInEffect,
  resolveVarianceTreatment,
  varianceImpactOnA,
  varianceImpactOnB,
  type Delivery,
  type PriceSetting,
  type SoaStatement,
} from "@/lib/calculations";

const RS_240 = 24_000;

function delivery(deliveryDate: string, bottlesA: number, bottlesB: number, price = RS_240): Delivery {
  return { deliveryDate, bottlesA, bottlesB, unitPriceCentsApplied: price };
}

describe("calcul par livraison", () => {
  it("part de B = bottles_b × prix appliqué", () => {
    expect(deliveryShareB(delivery("2026-09-02", 2, 3))).toBe(72_000);
  });

  it("part de A = bottles_a × prix appliqué", () => {
    expect(deliveryShareA(delivery("2026-09-02", 2, 3))).toBe(48_000);
  });

  it("total = (A + B) × prix appliqué", () => {
    expect(deliveryTotal(delivery("2026-09-02", 2, 3))).toBe(120_000);
  });

  it("part nulle quand le foyer n'a rien reçu", () => {
    expect(deliveryShareB(delivery("2026-09-02", 4, 0))).toBe(0);
    expect(deliveryShareA(delivery("2026-09-02", 0, 4))).toBe(0);
  });

  it("refuse les valeurs non entières ou négatives", () => {
    expect(() => deliveryShareB({ bottlesB: 1.5, unitPriceCentsApplied: RS_240 })).toThrow();
    expect(() => deliveryShareB({ bottlesB: -1, unitPriceCentsApplied: RS_240 })).toThrow();
    expect(() => deliveryShareB({ bottlesB: 1, unitPriceCentsApplied: 240.5 })).toThrow();
  });
});

describe("prix en vigueur selon la date d'effet", () => {
  const prices: PriceSetting[] = [
    { unitPriceCents: RS_240, effectiveFrom: "2000-01-01" },
    { unitPriceCents: 25_000, effectiveFrom: "2026-11-01" },
    { unitPriceCents: 26_050, effectiveFrom: "2027-03-15" },
  ];

  it("veille, jour même et lendemain d'un changement", () => {
    expect(priceInEffect(prices, "2026-10-31")).toBe(RS_240);
    expect(priceInEffect(prices, "2026-11-01")).toBe(25_000);
    expect(priceInEffect(prices, "2026-11-02")).toBe(25_000);
    expect(priceInEffect(prices, "2027-03-15")).toBe(26_050);
  });

  it("ne dépend pas de l'ordre de la liste", () => {
    expect(priceInEffect([...prices].reverse(), "2027-01-01")).toBe(25_000);
  });

  it("null avant le premier prix", () => {
    expect(priceInEffect(prices, "1999-12-31")).toBeNull();
    expect(priceInEffect([], "2026-01-01")).toBeNull();
  });

  it("un changement de prix n'altère pas les livraisons passées", () => {
    const before = delivery("2026-10-20", 2, 2, priceInEffect(prices, "2026-10-20")!);
    const after = delivery("2026-11-03", 2, 2, priceInEffect(prices, "2026-11-03")!);
    // Le prix est figé dans la livraison : seul unitPriceCentsApplied compte.
    expect(deliveryShareB(before)).toBe(48_000);
    expect(deliveryShareB(after)).toBe(50_000);
    const deliveries = [before, after];
    expect(monthExpectedTotal(deliveries, "2026-10")).toBe(96_000);
    expect(monthExpectedTotal(deliveries, "2026-11")).toBe(100_000);
  });
});

describe("total attendu d'un mois", () => {
  const deliveries = [
    delivery("2026-08-31", 1, 1),
    delivery("2026-09-01", 2, 3),
    delivery("2026-09-15", 1, 2),
    delivery("2026-09-30", 0, 1, 25_000),
    delivery("2026-10-01", 5, 5),
  ];

  it("additionne seulement les livraisons du mois civil", () => {
    expect(monthExpectedTotal(deliveries, "2026-09")).toBe(5 * RS_240 + 3 * RS_240 + 25_000);
  });

  it("vaut 0 pour un mois sans livraison", () => {
    expect(monthExpectedTotal(deliveries, "2026-07")).toBe(0);
  });
});

describe("écart SOA", () => {
  it("positif quand Odezil facture plus que les livraisons saisies", () => {
    expect(computeVariance(150_000, 144_000)).toBe(6_000);
  });

  it("négatif quand Odezil facture moins", () => {
    expect(computeVariance(120_000, 144_000)).toBe(-24_000);
  });

  it("nul quand tout concorde", () => {
    expect(computeVariance(144_000, 144_000)).toBe(0);
  });
});

describe("traitements de l'écart", () => {
  it.each([
    ["impute_to_b", 24_000, 24_000, 0],
    ["impute_to_a", 24_000, 0, 24_000],
    ["split_50_50", 24_000, 12_000, 12_000],
    ["pending", 24_000, 0, 0],
    ["impute_to_b", -24_000, -24_000, 0],
    ["impute_to_a", -24_000, 0, -24_000],
    ["split_50_50", -24_000, -12_000, -12_000],
    ["pending", -24_000, 0, 0],
  ] as const)("%s sur un écart de %i → B %i, A %i", (treatment, variance, expectedB, expectedA) => {
    expect(varianceImpactOnB(variance, treatment)).toBe(expectedB);
    expect(varianceImpactOnA(variance, treatment)).toBe(expectedA);
  });

  it("50/50 d'un écart impair : B a la moitié tronquée, le centime reste au Macoua", () => {
    expect(varianceImpactOnB(101, "split_50_50")).toBe(50);
    expect(varianceImpactOnA(101, "split_50_50")).toBe(51);
    expect(varianceImpactOnB(-101, "split_50_50")).toBe(-50);
    expect(varianceImpactOnA(-101, "split_50_50")).toBe(-51);
    expect(Object.is(varianceImpactOnB(-1, "split_50_50"), 0)).toBe(true);
    expect(varianceImpactOnB(1, "split_50_50")).toBe(0);
  });

  it("50/50 : les deux parts reconstituent toujours l'écart exact", () => {
    for (let v = -1001; v <= 1001; v += 1) {
      expect(varianceImpactOnA(v, "split_50_50") + varianceImpactOnB(v, "split_50_50")).toBe(v);
    }
  });

  it("ne garde que les ajustements non nuls imputés à B", () => {
    const soas: SoaStatement[] = [
      { month: "2026-07", totalBilledCents: 0, varianceCents: 500, varianceTreatment: "impute_to_a" },
      { month: "2026-08", totalBilledCents: 0, varianceCents: 500, varianceTreatment: "pending" },
      { month: "2026-09", totalBilledCents: 0, varianceCents: 500, varianceTreatment: "split_50_50" },
      { month: "2026-10", totalBilledCents: 0, varianceCents: -300, varianceTreatment: "impute_to_b" },
      { month: "2026-11", totalBilledCents: 0, varianceCents: 0, varianceTreatment: "impute_to_b" },
    ];
    expect(adjustmentsForB(soas)).toEqual([
      { month: "2026-09", amountCents: 250 },
      { month: "2026-10", amountCents: -300 },
    ]);
  });
});

describe("validation du traitement d'écart", () => {
  it("écart nul : aucun choix requis", () => {
    expect(resolveVarianceTreatment(0, null)).toEqual({ ok: true, treatment: "pending" });
    expect(resolveVarianceTreatment(0, "impute_to_b")).toEqual({ ok: true, treatment: "pending" });
  });

  it("écart non nul : bloque sans choix", () => {
    expect(resolveVarianceTreatment(100, null).ok).toBe(false);
    expect(resolveVarianceTreatment(-100, undefined).ok).toBe(false);
  });

  it("écart non nul : « pending » explicite accepté", () => {
    expect(resolveVarianceTreatment(100, "pending")).toEqual({ ok: true, treatment: "pending" });
    expect(resolveVarianceTreatment(-5, "split_50_50")).toEqual({ ok: true, treatment: "split_50_50" });
  });
});

describe("solde de B", () => {
  const deliveries = [delivery("2026-09-02", 2, 3), delivery("2026-09-16", 1, 2), delivery("2026-10-01", 2, 2)];
  // Parts B : 72 000 + 48 000 + 48 000 = 168 000

  it("sans remboursement ni écart", () => {
    expect(balanceB({ deliveries, adjustments: [], repayments: [] })).toBe(168_000);
  });

  it("après remboursements partiels", () => {
    const repayments = [
      { amountCents: 50_000 },
      { amountCents: 33_333 },
    ];
    expect(balanceB({ deliveries, adjustments: [], repayments })).toBe(84_667);
  });

  it("après un remboursement groupé couvrant plusieurs mois", () => {
    expect(balanceB({ deliveries, adjustments: [], repayments: [{ amountCents: 168_000 }] })).toBe(0);
  });

  it("remboursement supérieur au dû : crédit (solde négatif)", () => {
    expect(balanceB({ deliveries, adjustments: [], repayments: [{ amountCents: 200_000 }] })).toBe(-32_000);
  });

  it("intègre les ajustements d'écart (positifs et négatifs)", () => {
    const soas: SoaStatement[] = [
      { month: "2026-09", totalBilledCents: 0, varianceCents: 1_001, varianceTreatment: "split_50_50" },
      { month: "2026-10", totalBilledCents: 0, varianceCents: -2_000, varianceTreatment: "impute_to_b" },
      { month: "2026-11", totalBilledCents: 0, varianceCents: 9_999, varianceTreatment: "impute_to_a" },
      { month: "2026-12", totalBilledCents: 0, varianceCents: 9_999, varianceTreatment: "pending" },
    ];
    const adjustments = adjustmentsForB(soas);
    expect(balanceB({ deliveries, adjustments, repayments: [{ amountCents: 100_000 }] })).toBe(
      168_000 + 500 - 2_000 - 100_000,
    );
  });

  it("reste exact au centime (pas d'erreur de flottant)", () => {
    const many = Array.from({ length: 1000 }, (_, i) => delivery("2026-01-01", 0, 1, 1_999 + (i % 3)));
    const repayments = Array.from({ length: 10 }, () => ({ amountCents: 10 }));
    const expected = many.reduce((sum, d) => sum + d.unitPriceCentsApplied, 0) - 100;
    expect(balanceB({ deliveries: many, adjustments: [], repayments })).toBe(expected);
  });

  it("refuse un remboursement nul ou non entier", () => {
    expect(() => balanceB({ deliveries, adjustments: [], repayments: [{ amountCents: 0 }] })).toThrow();
    expect(() => balanceB({ deliveries, adjustments: [], repayments: [{ amountCents: 10.5 }] })).toThrow();
  });
});

describe("résumés mensuels", () => {
  const deliveries = [
    delivery("2026-08-05", 2, 2),
    delivery("2026-09-02", 2, 3),
    delivery("2026-09-16", 1, 2),
    delivery("2026-10-01", 1, 0),
  ];
  const soas: SoaStatement[] = [
    // Août : concorde.
    { month: "2026-08", totalBilledCents: 96_000, varianceCents: 0, varianceTreatment: "pending" },
    // Septembre : 1 bonbonne facturée en trop, partagée.
    { month: "2026-09", totalBilledCents: 216_000, varianceCents: 24_000, varianceTreatment: "split_50_50" },
    // Novembre : SOA sans livraison saisie, écart en attente.
    { month: "2026-11", totalBilledCents: 24_000, varianceCents: 24_000, varianceTreatment: "pending" },
  ];
  const summaries = monthlySummaries(deliveries, soas);

  it("trie du plus récent au plus ancien et inclut les mois avec seulement un SOA", () => {
    expect(summaries.map((s) => s.month)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08"]);
  });

  it("calcule totaux, écart et statut", () => {
    const september = summaries.find((s) => s.month === "2026-09")!;
    expect(september.bottlesA).toBe(3);
    expect(september.bottlesB).toBe(5);
    expect(september.totalA).toBe(72_000);
    expect(september.totalB).toBe(120_000);
    expect(september.expectedTotal).toBe(192_000);
    expect(september.soa).toMatchObject({
      varianceCents: 24_000,
      currentVarianceCents: 24_000,
      stale: false,
      impactA: 12_000,
      impactB: 12_000,
    });
    expect(september.status).toBe("variance_treated");
    expect(september.amountB).toBe(132_000);

    expect(summaries.find((s) => s.month === "2026-08")!.status).toBe("reconciled");
    expect(summaries.find((s) => s.month === "2026-10")!.status).toBe("no_soa");
    expect(summaries.find((s) => s.month === "2026-11")!.status).toBe("variance_pending");
  });

  it("signale un écart figé devenu obsolète après ajout d'une livraison", () => {
    const updated = monthlySummaries([...deliveries, delivery("2026-08-20", 1, 0)], soas);
    const august = updated.find((s) => s.month === "2026-08")!;
    expect(august.soa?.varianceCents).toBe(0);
    expect(august.soa?.currentVarianceCents).toBe(-24_000);
    expect(august.soa?.stale).toBe(true);
  });

  it("le solde se retrouve en additionnant les montants mensuels de B", () => {
    const total = summaries.reduce((sum, s) => sum + s.amountB, 0);
    expect(total).toBe(balanceB({ deliveries, adjustments: adjustmentsForB(soas), repayments: [] }));
  });
});
