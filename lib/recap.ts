/**
 * Message récapitulatif mensuel pour le foyer Cardinal (prêt pour WhatsApp).
 *
 * Pour un mois M :
 * - montant du mois = parts B des livraisons de M + ajustement d'écart du SOA de M ;
 * - total à régler = toutes les charges jusqu'à la fin de M − tous les remboursements reçus ;
 * - solde antérieur = total à régler − montant du mois (affiché seulement s'il est non nul).
 */
import {
  balanceB,
  deliveryShareB,
  varianceImpactOnB,
  type Delivery,
  type Repayment,
  type SoaStatement,
} from "@/lib/calculations";
import { formatMonthFr, monthKeyOf } from "@/lib/dates";
import { formatRs, formatRsSigned, sumCents } from "@/lib/money";

export type RecapPriceLine = { bottles: number; unitPriceCents: number; amountCents: number };

export type Recap = {
  month: string;
  /** Lignes par prix unitaire (plusieurs si le prix a changé dans le mois). */
  lines: RecapPriceLine[];
  bottlesB: number;
  deliveriesAmountCents: number;
  adjustmentCents: number;
  monthAmountCents: number;
  previousBalanceCents: number;
  totalDueCents: number;
  text: string;
};

function bottlesLabel(count: number): string {
  return `${count} bonbonne${count > 1 ? "s" : ""}`;
}

export function buildRecap(
  month: string,
  data: {
    deliveries: readonly Delivery[];
    soas: readonly SoaStatement[];
    repayments: readonly Repayment[];
  },
): Recap {
  const monthDeliveries = data.deliveries.filter((d) => monthKeyOf(d.deliveryDate) === month && d.bottlesB > 0);

  const byPrice = new Map<number, number>();
  for (const delivery of monthDeliveries) {
    byPrice.set(delivery.unitPriceCentsApplied, (byPrice.get(delivery.unitPriceCentsApplied) ?? 0) + delivery.bottlesB);
  }
  const lines: RecapPriceLine[] = [...byPrice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([unitPriceCents, bottles]) => ({ bottles, unitPriceCents, amountCents: bottles * unitPriceCents }));

  const bottlesB = sumCents(lines.map((line) => line.bottles));
  const deliveriesAmountCents = sumCents(monthDeliveries.map(deliveryShareB));

  const soa = data.soas.find((s) => s.month === month);
  const adjustmentCents = soa ? varianceImpactOnB(soa.varianceCents, soa.varianceTreatment) : 0;
  const monthAmountCents = deliveriesAmountCents + adjustmentCents;

  const totalDueCents = balanceB({
    deliveries: data.deliveries.filter((d) => monthKeyOf(d.deliveryDate) <= month),
    adjustments: data.soas
      .filter((s) => s.month <= month)
      .map((s) => ({ amountCents: varianceImpactOnB(s.varianceCents, s.varianceTreatment) })),
    repayments: data.repayments,
  });
  const previousBalanceCents = totalDueCents - monthAmountCents;

  const parts: string[] = [];
  const consumption =
    lines.length === 0
      ? `aucune bonbonne`
      : `${lines
          .map((line) => `${bottlesLabel(line.bottles)} × ${formatRs(line.unitPriceCents)}`)
          .join(" + ")} = ${formatRs(deliveriesAmountCents)}`;
  parts.push(`Bonjour, récap eau de ${formatMonthFr(month)} : ${consumption}.`);

  if (adjustmentCents !== 0) {
    parts.push(`Ajustement (relevé Odezil) : ${formatRsSigned(adjustmentCents)}.`);
  }
  if (previousBalanceCents > 0) {
    parts.push(`Solde antérieur : ${formatRs(previousBalanceCents)}.`);
  } else if (previousBalanceCents < 0) {
    parts.push(`Crédit antérieur : ${formatRs(-previousBalanceCents)}.`);
  }

  if (totalDueCents > 0) {
    parts.push(`Total à régler : ${formatRs(totalDueCents)}.`);
  } else if (totalDueCents < 0) {
    parts.push(`Crédit en votre faveur : ${formatRs(-totalDueCents)}.`);
  } else {
    parts.push("Rien à régler.");
  }
  parts.push("Merci !");

  return {
    month,
    lines,
    bottlesB,
    deliveriesAmountCents,
    adjustmentCents,
    monthAmountCents,
    previousBalanceCents,
    totalDueCents,
    text: parts.join(" "),
  };
}
