/**
 * Export CSV pour tableur français : séparateur « ; », virgule décimale,
 * fins de ligne CRLF et BOM UTF-8 (accents corrects dans Excel).
 */
import {
  deliveryShareA,
  deliveryShareB,
  deliveryTotal,
  type Delivery,
  type MonthSummary,
} from "@/lib/calculations";
import { formatDateShortFr, monthKeyOf } from "@/lib/dates";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "@/lib/households";
import { MONTH_STATUS_LABELS, TREATMENT_SHORT_LABELS } from "@/lib/labels";
import { formatCentsDecimal } from "@/lib/money";

const BOM = "﻿";
const SEPARATOR = ";";

type Cell = string | number | null;

/** Neutralise les formules (=, +, -, @…) dans les champs texte libres. */
export function sanitizeText(value: string | null): string {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function escapeCell(cell: Cell): string {
  const text = cell === null ? "" : String(cell);
  return /[";\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((row) => row.map(escapeCell).join(SEPARATOR)).join("\r\n") + "\r\n";
}

export type CsvDelivery = Delivery & { photoPath: string | null; note: string | null };

/** Une ligne par livraison, de la plus ancienne à la plus récente. */
export function deliveriesCsv(deliveries: readonly CsvDelivery[]): string {
  const sorted = [...deliveries].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  return toCsv([
    [
      "Date",
      "Mois",
      `Bonbonnes ${HOUSEHOLD_A}`,
      `Bonbonnes ${HOUSEHOLD_B}`,
      "Prix unitaire (Rs)",
      `Montant ${HOUSEHOLD_A} (Rs)`,
      `Montant ${HOUSEHOLD_B} (Rs)`,
      "Total (Rs)",
      "Photo",
      "Note",
    ],
    ...sorted.map((d) => [
      formatDateShortFr(d.deliveryDate),
      monthKeyOf(d.deliveryDate),
      d.bottlesA,
      d.bottlesB,
      formatCentsDecimal(d.unitPriceCentsApplied),
      formatCentsDecimal(deliveryShareA(d)),
      formatCentsDecimal(deliveryShareB(d)),
      formatCentsDecimal(deliveryTotal(d)),
      d.photoPath ? "oui" : "non",
      sanitizeText(d.note),
    ]),
  ]);
}

/** Une ligne par mois : totaux, rapprochement SOA et statut. */
export function monthsCsv(summaries: readonly MonthSummary[]): string {
  const sorted = [...summaries].sort((a, b) => a.month.localeCompare(b.month));
  return toCsv([
    [
      "Mois",
      `Bonbonnes ${HOUSEHOLD_A}`,
      `Bonbonnes ${HOUSEHOLD_B}`,
      `Montant ${HOUSEHOLD_A} (Rs)`,
      `Montant ${HOUSEHOLD_B} (Rs)`,
      "Total attendu (Rs)",
      "Total SOA (Rs)",
      "Écart enregistré (Rs)",
      "Écart actuel (Rs)",
      "Traitement de l'écart",
      `Ajustement ${HOUSEHOLD_B} (Rs)`,
      `Montant du mois ${HOUSEHOLD_B} (Rs)`,
      "Statut",
    ],
    ...sorted.map((s) => [
      s.month,
      s.bottlesA,
      s.bottlesB,
      formatCentsDecimal(s.totalA),
      formatCentsDecimal(s.totalB),
      formatCentsDecimal(s.expectedTotal),
      s.soa ? formatCentsDecimal(s.soa.totalBilledCents) : "",
      s.soa ? formatCentsDecimal(s.soa.varianceCents) : "",
      s.soa ? formatCentsDecimal(s.soa.currentVarianceCents) : "",
      s.soa && s.soa.varianceCents !== 0 ? TREATMENT_SHORT_LABELS[s.soa.varianceTreatment] : "",
      formatCentsDecimal(s.soa?.impactB ?? 0),
      formatCentsDecimal(s.amountB),
      MONTH_STATUS_LABELS[s.status] + (s.soa?.stale ? " (écart à recalculer)" : ""),
    ]),
  ]);
}
