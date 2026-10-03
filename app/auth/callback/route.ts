import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedAdmin } from "@/lib/auth-rules";
import { adminEmail, loginConfigurationProblems } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink"];

/**
 * Redirection relative (`Location: /…`) : le navigateur reste sur l'hôte qu'il
 * a demandé, où les cookies de session viennent d'être posés. `request.url`
 * peut porter un autre hôte derrière un proxy (ex. `localhost`).
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * Retour de connexion :
 * - `?code=…` : flux PKCE (Google OAuth, ou lien magique avec le modèle d'email par défaut) ;
 * - `?token_hash=…&type=email` : lien magique avec le modèle d'email personnalisé
 *   (fonctionne même si le lien est ouvert dans un autre navigateur).
 * Après l'échange, l'email doit être confirmé et égal à ADMIN_EMAIL (session
 * non ouverte par mot de passe), sinon déconnexion immédiate et « Accès non autorisé ».
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  // Configuration vérifiée AVANT d'utiliser le code (à usage unique) : sinon
  // l'échange réussit, la page plante, et la tentative suivante échoue.
  const problems = loginConfigurationProblems();
  if (problems.length > 0) {
    console.error(`Connexion impossible, configuration incomplète : ${problems.map((p) => p.message).join(" ; ")}`);
    return redirectTo("/login?error=config");
  }

  const supabase = await createClient();

  let exchangeError: unknown = null;
  if (code) {
    ({ error: exchangeError } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && EMAIL_OTP_TYPES.includes(type as EmailOtpType)) {
    ({ error: exchangeError } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    }));
  } else {
    // Refus côté Supabase Auth, sans code : inscriptions désactivées (README § 7)
    // ou hook « Before User Created » (message défini dans 20261002000400_auth_hook.sql).
    // Une annulation chez Google renvoie aussi error=access_denied : on ne se fie
    // donc pas à `error` seul.
    const refused =
      params.get("error_code") === "signup_disabled" || params.get("error_description") === "Accès non autorisé";
    return redirectTo(refused ? "/login?error=unauthorized" : "/login?error=auth");
  }

  if (exchangeError) {
    return redirectTo("/login?error=auth");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: claims } = await supabase.auth.getClaims();

  if (!isAuthorizedAdmin(user, adminEmail(), claims?.claims.amr)) {
    await supabase.auth.signOut();
    return redirectTo("/login?error=unauthorized");
  }

  return redirectTo("/");
}
