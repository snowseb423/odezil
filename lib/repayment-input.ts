import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseRsToCents } from "@/lib/money";

export const MAX_REPAYMENT_NOTE_LENGTH = 500;

/** Validation serveur d'un remboursement reçu (partiel ou groupé). */
export function repaymentInputSchema(today: string) {
  return z.object({
    repaymentDate: z
      .string()
      .refine(isIsoDate, "Date invalide")
      .refine((date) => date <= today, "La date ne peut pas être dans le futur"),
    amount: z.string().transform((value, context) => {
      const cents = parseRsToCents(value);
      if (cents === null || cents <= 0) {
        context.addIssue({ code: "custom", message: "Montant invalide (ex. 1 200,00)" });
        return z.NEVER;
      }
      return cents;
    }),
    note: z
      .string()
      .trim()
      .max(MAX_REPAYMENT_NOTE_LENGTH, `Note limitée à ${MAX_REPAYMENT_NOTE_LENGTH} caractères`)
      .transform((note) => (note === "" ? null : note))
      .nullable()
      .default(null),
  });
}
