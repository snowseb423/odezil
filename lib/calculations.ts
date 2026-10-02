/**
 * Règles de calcul de l'application, en fonctions pures (aucun accès réseau ni
 * base). Montants en centimes entiers ; dates `YYYY-MM-DD`, mois `YYYY-MM`.
 * Foyer A = Macoua (admin), foyer B = Cardinal.
 *
 * Ce module est la seule implémentation de ces règles : l'écran admin, la page
 * Cardinal, le message récapitulatif et l'export CSV l'utilisent tous.
 */
import { monthKeyOf } from "./dates";
import { assertCents, sumCents } from "./money";

export const VARIANCE_TREATMENTS = ["pending", "impute_to_a", "impute_to_b", "split_50_50"] as const;
export type VarianceTreatment = (typeof VARIANCE_TREATMENTS)[number];

export type PriceSetting = {
  unitPriceCents: number;
  /** `YYYY-MM-DD` */
  effectiveFrom: string;
};

export type Delivery = {
  /** `YYYY-MM-DD` */
  deliveryDate: string;
  bottlesA: number;
  bottlesB: number;
  /** Prix figé à la création d'après le prix en vigueur à deliveryDate. */
  unitPriceCentsApplied: number;
};

export type SoaStatement = {
  /** `YYYY-MM` */
  month: string;
  totalBilledCents: number;
  /** Écart figé à l'enregistrement : total SOA − total attendu. */
  varianceCents: number;
  varianceTreatment: VarianceTreatment;
};

export type Repayment = {
  /** `YYYY-MM-DD` */
  repaymentDate: string;
  amountCents: number;
};

/** Ajustement d'écart SOA imputé au foyer B (ligne « Ajustement »). */
export type Adjustment = {
  /** `YYYY-MM` */
  month: string;
  amountCents: number;
};

function assertBottles(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} doit être un entier positif ou nul (reçu : ${String(value)})`);
  }
  return value;
}

/**
 * Prix en vigueur à une date : celui dont la date d'effet est la plus récente
 * tout en étant antérieure ou égale à `date`. `null` si aucun.
 * (Même règle que le trigger SQL deliveries_freeze_unit_price.)
 */
export function priceInEffect(prices: readonly PriceSetting[], date: string): number | null {
  let best: PriceSetting | null = null;
  for (const price of prices) {
    if (price.effectiveFrom <= date && (best === null || price.effectiveFrom > best.effectiveFrom)) {
      best = price;
    }
  }
  return best === null ? null : assertCents(best.unitPriceCents, "prix unitaire");
}

/** Montant dû par A pour une livraison = bottles_a × prix appliqué. */
export function deliveryShareA(delivery: Delivery): number {
  return assertCents(
    assertBottles(delivery.bottlesA, "bottlesA") * assertCents(delivery.unitPriceCentsApplied, "prix unitaire"),
  );
}

/** Montant dû par B pour une livraison = bottles_b × prix appliqué. */
export function deliveryShareB(delivery: Pick<Delivery, "bottlesB" | "unitPriceCentsApplied">): number {
  return assertCents(
    assertBottles(delivery.bottlesB, "bottlesB") * assertCents(delivery.unitPriceCentsApplied, "prix unitaire"),
  );
}

/** Coût total d'une livraison = (bottles_a + bottles_b) × prix appliqué. */
export function deliveryTotal(delivery: Delivery): number {
  return assertCents(deliveryShareA(delivery) + deliveryShareB(delivery));
}

export function deliveriesOfMonth<T extends Pick<Delivery, "deliveryDate">>(
  deliveries: readonly T[],
  month: string,
): T[] {
  return deliveries.filter((d) => monthKeyOf(d.deliveryDate) === month);
}

/** Total attendu d'un mois = Σ (bottles_a + bottles_b) × prix appliqué des livraisons du mois. */
export function monthExpectedTotal(deliveries: readonly Delivery[], month: string): number {
  return sumCents(deliveriesOfMonth(deliveries, month).map(deliveryTotal));
}

/** Écart = total SOA − total attendu (positif : Odezil a facturé plus que les livraisons saisies). */
export function computeVariance(totalBilledCents: number, expectedTotalCents: number): number {
  return assertCents(assertCents(totalBilledCents, "total SOA") - assertCents(expectedTotalCents, "total attendu"));
}

/**
 * Part de l'écart imputée à B :
 * - impute_to_b : 100 %
 * - split_50_50 : 50 %, tronqué vers zéro (le centime impair reste au Macoua)
 * - impute_to_a, pending : 0
 */
export function varianceImpactOnB(varianceCents: number, treatment: VarianceTreatment): number {
  assertCents(varianceCents, "écart");
  switch (treatment) {
    case "impute_to_b":
      return varianceCents;
    case "split_50_50":
      // `+ 0` évite de renvoyer -0 pour un écart de -1 centime.
      return Math.trunc(varianceCents / 2) + 0;
    case "impute_to_a":
    case "pending":
      return 0;
  }
}

/** Part de l'écart imputée à A (complément de celle de B, 0 si en attente). */
export function varianceImpactOnA(varianceCents: number, treatment: VarianceTreatment): number {
  if (treatment === "pending") return 0;
  return assertCents(varianceCents - varianceImpactOnB(varianceCents, treatment));
}

/** Ajustements non nuls imputés à B, un par SOA. */
export function adjustmentsForB(soas: readonly SoaStatement[]): Adjustment[] {
  return soas
    .map((soa) => ({ month: soa.month, amountCents: varianceImpactOnB(soa.varianceCents, soa.varianceTreatment) }))
    .filter((adjustment) => adjustment.amountCents !== 0);
}

export type BalanceInput = {
  deliveries: ReadonlyArray<Pick<Delivery, "bottlesB" | "unitPriceCentsApplied">>;
  adjustments: ReadonlyArray<Pick<Adjustment, "amountCents">>;
  repayments: ReadonlyArray<Pick<Repayment, "amountCents">>;
};

/**
 * Solde de B = Σ parts B des livraisons + Σ ajustements d'écart − Σ remboursements.
 * Positif : B doit ce montant à A. Négatif : B a un crédit.
 */
export function balanceB({ deliveries, adjustments, repayments }: BalanceInput): number {
  const owed = sumCents(deliveries.map(deliveryShareB));
  const adjusted = sumCents(adjustments.map((a) => a.amountCents));
  const repaid = sumCents(
    repayments.map((r) => {
      if (assertCents(r.amountCents, "remboursement") <= 0) {
        throw new RangeError("Un remboursement doit être strictement positif");
      }
      return r.amountCents;
    }),
  );
  return assertCents(owed + adjusted - repaid, "solde");
}

export type MonthStatus = "no_soa" | "reconciled" | "variance_pending" | "variance_treated";

export type MonthSummary<D extends Delivery = Delivery> = {
  /** `YYYY-MM` */
  month: string;
  deliveries: D[];
  bottlesA: number;
  bottlesB: number;
  totalA: number;
  totalB: number;
  /** Total attendu (A + B) d'après les livraisons saisies, recalculé. */
  expectedTotal: number;
  soa: null | {
    totalBilledCents: number;
    /** Écart figé lors de l'enregistrement du SOA. */
    varianceCents: number;
    /** Écart recalculé avec les livraisons actuelles. */
    currentVarianceCents: number;
    /** Vrai si des livraisons ont changé depuis l'enregistrement du SOA. */
    stale: boolean;
    varianceTreatment: VarianceTreatment;
    impactA: number;
    impactB: number;
  };
  status: MonthStatus;
  /** Montant du mois pour B : parts B des livraisons + ajustement d'écart imputé à B. */
  amountB: number;
};

/**
 * Résumé mois par mois (du plus récent au plus ancien) : livraisons, totaux,
 * rapprochement SOA et statut de l'écart.
 */
export function monthlySummaries<D extends Delivery>(
  deliveries: readonly D[],
  soas: readonly SoaStatement[],
): MonthSummary<D>[] {
  const months = new Set<string>();
  for (const d of deliveries) months.add(monthKeyOf(d.deliveryDate));
  for (const s of soas) months.add(s.month);

  const soaByMonth = new Map(soas.map((s) => [s.month, s]));

  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const monthDeliveries = deliveriesOfMonth(deliveries, month).sort(
        (a, b) => a.deliveryDate.localeCompare(b.deliveryDate),
      );
      const totalA = sumCents(monthDeliveries.map(deliveryShareA));
      const totalB = sumCents(monthDeliveries.map(deliveryShareB));
      const expectedTotal = assertCents(totalA + totalB);
      const statement = soaByMonth.get(month);

      let soa: MonthSummary<D>["soa"] = null;
      let status: MonthStatus = "no_soa";
      if (statement) {
        const currentVarianceCents = computeVariance(statement.totalBilledCents, expectedTotal);
        soa = {
          totalBilledCents: statement.totalBilledCents,
          varianceCents: statement.varianceCents,
          currentVarianceCents,
          stale: currentVarianceCents !== statement.varianceCents,
          varianceTreatment: statement.varianceTreatment,
          impactA: varianceImpactOnA(statement.varianceCents, statement.varianceTreatment),
          impactB: varianceImpactOnB(statement.varianceCents, statement.varianceTreatment),
        };
        if (statement.varianceCents === 0) status = "reconciled";
        else if (statement.varianceTreatment === "pending") status = "variance_pending";
        else status = "variance_treated";
      }

      return {
        month,
        deliveries: monthDeliveries,
        bottlesA: sumCents(monthDeliveries.map((d) => d.bottlesA)),
        bottlesB: sumCents(monthDeliveries.map((d) => d.bottlesB)),
        totalA,
        totalB,
        expectedTotal,
        soa,
        status,
        amountB: assertCents(totalB + (soa?.impactB ?? 0)),
      };
    });
}

/**
 * Valide le choix du traitement d'un écart SOA : obligatoire (y compris
 * « pending » choisi explicitement) dès que l'écart est non nul.
 * Écart nul : le traitement est sans effet, on enregistre « pending ».
 */
export function resolveVarianceTreatment(
  varianceCents: number,
  chosen: VarianceTreatment | null | undefined,
): { ok: true; treatment: VarianceTreatment } | { ok: false; error: string } {
  if (varianceCents === 0) return { ok: true, treatment: "pending" };
  if (!chosen) {
    return { ok: false, error: "L'écart est non nul : choisissez comment le traiter (ou « En attente »)." };
  }
  return { ok: true, treatment: chosen };
}
