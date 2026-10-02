"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { todayIso } from "@/lib/dates";
import { PHOTO_BUCKET, deliveryInputSchema, type DeliveryInput } from "@/lib/delivery-input";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Enregistre une livraison. Le prix unitaire est figé par la base (trigger). */
export async function createDelivery(input: DeliveryInput): Promise<ActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = deliveryInputSchema(todayIso()).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const { deliveryDate, bottlesA, bottlesB, note, photoPath } = parsed.data;

  const { error } = await supabase.from("deliveries").insert({
    delivery_date: deliveryDate,
    bottles_a: bottlesA,
    bottles_b: bottlesB,
    note,
    photo_path: photoPath,
  });

  if (error) {
    if (photoPath) {
      await supabase.storage.from(PHOTO_BUCKET).remove([photoPath]);
    }
    return {
      ok: false,
      error: error.message.includes("Aucun prix unitaire")
        ? "Aucun prix unitaire n'est en vigueur à cette date (voir Réglages)."
        : "Enregistrement impossible. Réessayez.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/?ok=livraison");
}

const IdSchema = z.uuid();

/** Supprime une livraison (et sa photo). Les livraisons ne se modifient pas. */
export async function deleteDelivery(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = IdSchema.parse(formData.get("id"));

  const { data, error } = await supabase.from("deliveries").delete().eq("id", id).select("photo_path");
  if (error) {
    throw new Error("Suppression impossible");
  }
  const paths = (data ?? []).map((row) => row.photo_path).filter((path): path is string => Boolean(path));
  if (paths.length > 0) {
    await supabase.storage.from(PHOTO_BUCKET).remove(paths);
  }

  revalidatePath("/", "layout");
}
