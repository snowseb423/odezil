import { addMonths, isMonthKey } from "@/lib/dates";

/** Mois `?mois=YYYY-MM` valide et non futur, sinon `fallback`. */
export function monthParam(value: string | string[] | undefined, maxMonth: string, fallback: string): string {
  const month = Array.isArray(value) ? value[0] : value;
  if (month && isMonthKey(month) && month <= maxMonth) return month;
  return fallback;
}

/** Mois précédent le mois courant (SOA reçu en début de mois suivant). */
export function previousMonth(currentMonth: string): string {
  return addMonths(currentMonth, -1);
}
