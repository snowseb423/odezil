import type { MonthStatus, VarianceTreatment } from "@/lib/calculations";
import { HOUSEHOLD_A, HOUSEHOLD_B } from "@/lib/households";

export const TREATMENT_LABELS: Record<VarianceTreatment, string> = {
  pending: "En attente (décider plus tard)",
  impute_to_a: `À la charge du ${HOUSEHOLD_A}`,
  impute_to_b: `À la charge du ${HOUSEHOLD_B}`,
  split_50_50: "Partagé 50/50",
};

export const TREATMENT_SHORT_LABELS: Record<VarianceTreatment, string> = {
  pending: "en attente",
  impute_to_a: `imputé au ${HOUSEHOLD_A}`,
  impute_to_b: `imputé au ${HOUSEHOLD_B}`,
  split_50_50: "partagé 50/50",
};

export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = {
  no_soa: "SOA non saisi",
  reconciled: "Rapproché",
  variance_pending: "Écart en attente",
  variance_treated: "Écart traité",
};
