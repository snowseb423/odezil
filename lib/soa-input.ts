import { z } from "zod";
import { VARIANCE_TREATMENTS } from "@/lib/calculations";
import { isMonthKey } from "@/lib/dates";
import { parseRsToCents } from "@/lib/money";

export const MAX_SOA_NOTE_LENGTH = 500;

/** Validation serveur d'un relevé SOA ; l'écart est recalculé côté serveur. */
export function soaInputSchema(currentMonth: string) {
  return z.object({
    month: z
      .string()
      .refine(isMonthKey, "Mois invalide")
      .refine((month) => month <= currentMonth, "Le mois ne peut pas être dans le futur"),
    totalBilled: z
      .string()
      .transform((value, context) => {
        const cents = parseRsToCents(value);
        if (cents === null) {
          context.addIssue({ code: "custom", message: "Montant du SOA invalide (ex. 1 200,00)" });
          return z.NEVER;
        }
        return cents;
      }),
    treatment: z.enum(VARIANCE_TREATMENTS).nullable().default(null),
    note: z
      .string()
      .trim()
      .max(MAX_SOA_NOTE_LENGTH, `Note limitée à ${MAX_SOA_NOTE_LENGTH} caractères`)
      .transform((note) => (note === "" ? null : note))
      .nullable()
      .default(null),
  });
}

export type SoaInput = z.input<ReturnType<typeof soaInputSchema>>;
