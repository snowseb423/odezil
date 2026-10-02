import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/lib/auth-rules";

/**
 * Garde d'accès admin, à appeler dans le layout admin ET au début de chaque
 * Server Action (le proxy seul ne suffit jamais) :
 * - pas de session → /login ;
 * - session d'un autre compte (ex. un compte Google quelconque) → déconnexion
 *   et /login?error=unauthorized.
 * Renvoie un client Supabase lié à la session (soumis au RLS is_admin()).
 */
export const requireAdmin = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: claims } = await supabase.auth.getClaims();
  if (!isAuthorizedAdmin(user, adminEmail(), claims?.claims.amr)) {
    await supabase.auth.signOut();
    redirect("/login?error=unauthorized");
  }

  return { supabase, user };
});
