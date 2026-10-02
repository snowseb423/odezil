import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

/** Chemin d'une photo de bon dans le bucket : `AAAA/<uuid>.<ext>`. */
export const PHOTO_PATH_PATTERN = /^\d{4}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|heic|heif)$/;

export const PHOTO_BUCKET = "bons-livraison";

export const MAX_BOTTLES = 99;
export const MAX_NOTE_LENGTH = 500;

const bottles = z
  .number({ error: "Nombre de bonbonnes invalide" })
  .int("Nombre de bonbonnes invalide")
  .min(0, "Nombre de bonbonnes invalide")
  .max(MAX_BOTTLES, `Au plus ${MAX_BOTTLES} bonbonnes`);

/** Validation serveur d'une nouvelle livraison (le prix est fixé par la base). */
export function deliveryInputSchema(today: string) {
  return z
    .object({
      deliveryDate: z
        .string()
        .refine(isIsoDate, "Date invalide")
        .refine((date) => date <= today, "La date de livraison ne peut pas être dans le futur"),
      bottlesA: bottles,
      bottlesB: bottles,
      note: z
        .string()
        .trim()
        .max(MAX_NOTE_LENGTH, `Note limitée à ${MAX_NOTE_LENGTH} caractères`)
        .transform((note) => (note === "" ? null : note))
        .nullable()
        .default(null),
      photoPath: z.string().regex(PHOTO_PATH_PATTERN, "Photo invalide").nullable().default(null),
    })
    .refine((input) => input.bottlesA + input.bottlesB > 0, {
      message: "Indiquez au moins une bonbonne",
      path: ["bottlesB"],
    });
}

export type DeliveryInput = z.input<ReturnType<typeof deliveryInputSchema>>;
