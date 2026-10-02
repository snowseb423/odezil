/**
 * Relevé du foyer Cardinal, construit uniquement à partir des données
 * renvoyées par la RPC share_snapshot (aucune donnée du Macoua).
 */
import { z } from "zod";
import { balanceB, deliveryShareB } from "@/lib/calculations";
import { isIsoDate, isMonthKey, monthKeyOf } from "@/lib/dates";
import { sumCents } from "@/lib/money";

const cents = z.number().int();

/**
 * Schéma de la réponse de share_snapshot. `z.object` ne garde que les champs
 * listés : même si la RPC renvoyait un champ de trop, il n'atteindrait pas la page.
 */
const SnapshotSchema = z.object({
  deliveries: z.array(
    z.object({
      date: z.string().refine(isIsoDate),
      bottles: z.number().int().positive(),
      unit_price_cents: cents.positive(),
    }),
  ),
  adjustments: z.array(z.object({ month: z.string().refine(isMonthKey), amount_cents: cents })),
  repayments: z.array(z.object({ date: z.string().refine(isIsoDate), amount_cents: cents.positive() })),
});

export type CardinalView = {
  deliveries: Array<{ date: string; bottles: number; unitPriceCents: number }>;
  adjustments: Array<{ month: string; amountCents: number }>;
  repayments: Array<{ date: string; amountCents: number }>;
};

/** Valide et normalise la réponse de la RPC. `null` si token invalide/révoqué. */
export function parseSnapshot(raw: unknown): CardinalView | null {
  if (raw === null || raw === undefined) return null;
  const snapshot = SnapshotSchema.parse(raw);
  return {
    deliveries: snapshot.deliveries.map((d) => ({ date: d.date, bottles: d.bottles, unitPriceCents: d.unit_price_cents })),
    adjustments: snapshot.adjustments.map((a) => ({ month: a.month, amountCents: a.amount_cents })),
    repayments: snapshot.repayments.map((r) => ({ date: r.date, amountCents: r.amount_cents })),
  };
}

export type CardinalMonth = {
  month: string;
  deliveries: Array<{ date: string; bottles: number; unitPriceCents: number; amountCents: number }>;
  bottles: number;
  adjustmentCents: number;
  totalCents: number;
};

export type CardinalStatement = {
  balanceCents: number;
  months: CardinalMonth[];
  repayments: Array<{ date: string; amountCents: number }>;
  totalRepaidCents: number;
};

export function buildCardinalStatement(view: CardinalView): CardinalStatement {
  const months = new Map<string, CardinalMonth>();
  const monthEntry = (month: string): CardinalMonth => {
    let entry = months.get(month);
    if (!entry) {
      entry = { month, deliveries: [], bottles: 0, adjustmentCents: 0, totalCents: 0 };
      months.set(month, entry);
    }
    return entry;
  };

  for (const delivery of view.deliveries) {
    const amountCents = deliveryShareB({ bottlesB: delivery.bottles, unitPriceCentsApplied: delivery.unitPriceCents });
    const entry = monthEntry(monthKeyOf(delivery.date));
    entry.deliveries.push({ ...delivery, amountCents });
    entry.bottles += delivery.bottles;
    entry.totalCents += amountCents;
  }
  for (const adjustment of view.adjustments) {
    const entry = monthEntry(adjustment.month);
    entry.adjustmentCents += adjustment.amountCents;
    entry.totalCents += adjustment.amountCents;
  }

  const balanceCents = balanceB({
    deliveries: view.deliveries.map((d) => ({ bottlesB: d.bottles, unitPriceCentsApplied: d.unitPriceCents })),
    adjustments: view.adjustments,
    repayments: view.repayments,
  });

  return {
    balanceCents,
    months: [...months.values()]
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((m) => ({ ...m, deliveries: m.deliveries.sort((a, b) => a.date.localeCompare(b.date)) })),
    repayments: [...view.repayments].sort((a, b) => b.date.localeCompare(a.date)),
    totalRepaidCents: sumCents(view.repayments.map((r) => r.amountCents)),
  };
}
