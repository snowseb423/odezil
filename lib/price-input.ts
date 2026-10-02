import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseRsToCents } from "@/lib/money";

/** Validation d'un nouveau prix unitaire avec sa date d'effet. */
export const priceInputSchema = z.object({
  unitPrice: z.string().transform((value, context) => {
    const cents = parseRsToCents(value);
    if (cents === null || cents <= 0) {
      context.addIssue({ code: "custom", message: "Prix invalide (ex. 240,00)" });
      return z.NEVER;
    }
    return cents;
  }),
  effectiveFrom: z.string().refine(isIsoDate, "Date d'effet invalide"),
});
