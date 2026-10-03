import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { adminEmail, loginConfigurationProblems } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/lib/auth-rules";

/**
 * Garde d'accès admin, à appeler dans le layout admin ET au début de chaque
 * Server Action (le proxy seul ne suffit jamais) :
 * - pas de session → /login ;
 * - session d'un autre compte (ex. un compte Google quelconque) → déconnexion
 *   et /login?error=unauthorized ;
 * - configuration du serveur incomplète → /login?error=config (échec fermé).
 * Renvoie un client Supabase lié à la session (soumis au RLS is_admin()).
 */
export const requireAdmin = cache(async () => {
  // Toujours au moment de la requête : sans cela, le contrôle de configuration
  // ci-dessous (qui n'utilise ni cookies ni en-têtes) pourrait être figé au
  // build dans une page statique.
  await connection();

  const problems = loginConfigurationProblems();
  if (problems.length > 0) {
    console.error(`Accès refusé, configuration incomplète : ${problems.map((p) => p.message).join(" ; ")}`);
    redirect("/login?error=config");
  }

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
