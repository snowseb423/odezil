"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { shareTokenPepper } from "@/lib/env";
import { requestOrigin } from "@/lib/request-origin";
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
