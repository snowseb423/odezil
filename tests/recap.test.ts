import { describe, expect, it } from "vitest";
import type { Delivery, Repayment, SoaStatement } from "@/lib/calculations";
import { buildRecap } from "@/lib/recap";

const NBSP = " ";
const rs = (text: string) => text.replaceAll("Rs ", `Rs${NBSP}`).replace(/(\d) (\d{3})/g, `$1${NBSP}$2`);

function delivery(deliveryDate: string, bottlesA: number, bottlesB: number, price = 24_000): Delivery {
  return { deliveryDate, bottlesA, bottlesB, unitPriceCentsApplied: price };
}

describe("message récapitulatif", () => {
  it("format du cahier des charges, sans solde antérieur", () => {
    const recap = buildRecap("2026-09", {
      deliveries: [delivery("2026-09-02", 2, 3), delivery("2026-09-16", 1, 3)],
      soas: [],
      repayments: [],
    });
    expect(recap.text).toBe(
      rs("Bonjour, récap eau de septembre 2026 : 6 bonbonnes × Rs 240,00 = Rs 1 440,00. Total à régler : Rs 1 440,00. Merci !"),
    );
    expect(recap.previousBalanceCents).toBe(0);
  });

  it("affiche le solde antérieur non nul", () => {
    const recap = buildRecap("2026-09", {
      deliveries: [delivery("2026-08-05", 2, 2), delivery("2026-09-02", 2, 1)],
      soas: [],
      repayments: [{ repaymentDate: "2026-08-20", amountCents: 20_000 }],
    });
    // Août : 48 000 dû, 20 000 remboursés → 28 000 antérieurs.
    expect(recap.text).toBe(
      rs(
        "Bonjour, récap eau de septembre 2026 : 1 bonbonne × Rs 240,00 = Rs 240,00. Solde antérieur : Rs 280,00. Total à régler : Rs 520,00. Merci !",
      ),
    );
  });

  it("crédit antérieur et total nul ou en faveur du Cardinal", () => {
    const repayments: Repayment[] = [{ repaymentDate: "2026-08-30", amountCents: 100_000 }];
    const recap = buildRecap("2026-09", {
      deliveries: [delivery("2026-08-05", 0, 2), delivery("2026-09-02", 0, 1)],
      soas: [],
      repayments,
    });
    expect(recap.previousBalanceCents).toBe(-52_000);
    expect(recap.text).toContain(rs("Crédit antérieur : Rs 520,00."));
    expect(recap.text).toContain(rs("Crédit en votre faveur : Rs 280,00."));

    const settled = buildRecap("2026-09", {
      deliveries: [delivery("2026-09-02", 0, 1)],
      soas: [],
      repayments: [{ repaymentDate: "2026-09-10", amountCents: 24_000 }],
    });
    expect(settled.text).toContain("Rien à régler.");
  });

  it("une ligne par prix quand le prix change dans le mois", () => {
    const recap = buildRecap("2026-11", {
      deliveries: [delivery("2026-11-02", 1, 2), delivery("2026-11-20", 1, 3, 25_000)],
      soas: [],
      repayments: [],
    });
    expect(recap.lines).toEqual([
      { bottles: 2, unitPriceCents: 24_000, amountCents: 48_000 },
      { bottles: 3, unitPriceCents: 25_000, amountCents: 75_000 },
    ]);
    expect(recap.text).toContain(rs("2 bonbonnes × Rs 240,00 + 3 bonbonnes × Rs 250,00 = Rs 1 230,00."));
  });

  it("inclut l'ajustement d'écart du mois imputé au Cardinal", () => {
    const soas: SoaStatement[] = [
      { month: "2026-09", totalBilledCents: 0, varianceCents: 24_001, varianceTreatment: "split_50_50" },
    ];
    const recap = buildRecap("2026-09", { deliveries: [delivery("2026-09-02", 1, 1)], soas, repayments: [] });
    expect(recap.adjustmentCents).toBe(12_000);
    expect(recap.monthAmountCents).toBe(36_000);
    expect(recap.text).toContain(rs("Ajustement (relevé Odezil) : +Rs 120,00."));
    expect(recap.text).toContain(rs("Total à régler : Rs 360,00."));
  });

  it("ignore les livraisons et écarts postérieurs au mois", () => {
    const recap = buildRecap("2026-09", {
      deliveries: [delivery("2026-09-02", 1, 1), delivery("2026-10-01", 5, 5)],
      soas: [{ month: "2026-10", totalBilledCents: 0, varianceCents: 50_000, varianceTreatment: "impute_to_b" }],
      repayments: [],
    });
    expect(recap.totalDueCents).toBe(24_000);
  });

  it("tient compte de tous les remboursements reçus, même groupés après le mois", () => {
    const recap = buildRecap("2026-09", {
      deliveries: [delivery("2026-08-05", 0, 2), delivery("2026-09-02", 0, 2)],
      soas: [],
      repayments: [{ repaymentDate: "2026-10-01", amountCents: 48_000 }],
    });
    expect(recap.totalDueCents).toBe(48_000);
    expect(recap.previousBalanceCents).toBe(0);
    expect(recap.text).not.toContain("antérieur");
  });

  it("élide « de » devant un mois commençant par une voyelle", () => {
    expect(buildRecap("2026-08", { deliveries: [], soas: [], repayments: [] }).text).toBe(
      "Bonjour, récap eau d'août 2026 : aucune bonbonne. Rien à régler. Merci !",
    );
    expect(buildRecap("2026-04", { deliveries: [], soas: [], repayments: [] }).text).toContain("récap eau d'avril 2026");
    expect(buildRecap("2026-10", { deliveries: [], soas: [], repayments: [] }).text).toContain("récap eau d'octobre 2026");
  });

  it("mois sans livraison pour le Cardinal", () => {
    const recap = buildRecap("2026-09", { deliveries: [delivery("2026-09-02", 3, 0)], soas: [], repayments: [] });
    expect(recap.text).toBe("Bonjour, récap eau de septembre 2026 : aucune bonbonne. Rien à régler. Merci !");
  });
});
