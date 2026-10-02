"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { shareTokenPepper } from "@/lib/env";
import { requestOrigin } from "@/lib/request-origin";
import { priceInputSchema } from "@/lib/price-input";
import { generateShareToken, hashShareToken } from "@/lib/share-token";

export type ShareLinkState = { status: "idle" } | { status: "created"; url: string } | { status: "error"; message: string };

/**
 * Crée un nouveau lien Cardinal (l'ancien est révoqué). Le lien complet n'est
 * renvoyé qu'ici, une seule fois : seul son hash est stocké.
 */
export async function generateShareLink(): Promise<ShareLinkState> {
  const { supabase } = await requireAdmin();

  const token = generateShareToken();
  const tokenHash = hashShareToken(token, shareTokenPepper());

  const { error: revokeError } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .is("revoked_at", null);
  if (revokeError) {
    return { status: "error", message: "Impossible de révoquer l'ancien lien. Réessayez." };
  }

  const { error } = await supabase.from("share_links").insert({ token_hash: tokenHash });
  if (error) {
    return { status: "error", message: "Création du lien impossible. Réessayez." };
  }

  revalidatePath("/parametres");
  return { status: "created", url: `${await requestOrigin()}/p/${token}` };
}

/** Révoque le lien Cardinal actif : la page renvoie alors une 404. */
export async function revokeShareLink(): Promise<void> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .is("revoked_at", null);
  if (error) {
    throw new Error("Révocation impossible");
  }
  revalidatePath("/parametres");
}

/** Déconnexion de l'admin. */
export async function signOut(): Promise<void> {
  const { supabase } = await requireAdmin();
  await supabase.auth.signOut();
  redirect("/login");
}

export type PriceFormState = { error: string | null; saved: boolean };

/**
 * Ajoute un prix unitaire avec sa date d'effet. Les livraisons déjà saisies
 * gardent le prix figé lors de leur création.
 */
export async function addPrice(_previous: PriceFormState, formData: FormData): Promise<PriceFormState> {
  const { supabase } = await requireAdmin();
  const parsed = priceInputSchema.safeParse({
    unitPrice: String(formData.get("unitPrice") ?? ""),
    effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Saisie invalide", saved: false };
  }

  const { error } = await supabase.from("price_settings").insert({
    unit_price_cents: parsed.data.unitPrice,
    effective_from: parsed.data.effectiveFrom,
  });
  if (error) {
    return {
      error: error.code === "23505" ? "Un prix existe déjà à cette date d'effet." : "Enregistrement impossible. Réessayez.",
      saved: false,
    };
  }

  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

/** Supprime un prix (sauf le dernier). Sans effet sur les livraisons déjà saisies. */
export async function deletePrice(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().parse(formData.get("id"));

  const { count, error: countError } = await supabase.from("price_settings").select("id", { count: "exact", head: true });
  if (countError || (count ?? 0) <= 1) {
    throw new Error("Impossible de supprimer le seul prix enregistré");
  }

  const { error } = await supabase.from("price_settings").delete().eq("id", id);
  if (error) {
    throw new Error("Suppression impossible");
  }
  revalidatePath("/", "layout");
}
