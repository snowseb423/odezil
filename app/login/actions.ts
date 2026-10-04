"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { isAuthorizedAdmin, normalizeEmail } from "@/lib/auth-rules";
import { adminEmail, loginConfigurationProblems, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import { requestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/** Connexion principale : Google OAuth (flux PKCE via @supabase/ssr). */
export async function signInWithGoogle(): Promise<void> {
  if (loginConfigurationProblems().length > 0) {
    redirect("/login?error=config");
  }
  const supabase = await createClient();
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    redirect("/login?error=auth");
  }
  redirect(data.url);
}

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; message: string; email: string }
  | { status: "invalid"; message: string };

const MagicLinkSchema = z.object({ email: z.email() });

const MAGIC_LINK_SENT_MESSAGE =
  "Si cette adresse est autorisée, un email de connexion vient d'être envoyé. Saisissez le code qu'il contient ci-dessous : il expire rapidement et ne sert qu'une fois.";

/**
 * Secours : lien magique par email, envoyé seulement à ADMIN_EMAIL et pour un
 * compte existant (créé par `npm run seed:admin` ou une première connexion Google).
 *
 * Pas d'énumération de l'adresse admin : la réponse est identique pour toutes
 * les adresses, aucun cookie n'est posé (client sans stockage, flux à
 * token_hash du modèle d'email du README) et l'envoi a lieu après la réponse
 * (`after`), sans écart de temps mesurable.
 */
export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = MagicLinkSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) {
    return { status: "invalid", message: "Adresse email invalide." };
  }

  if (loginConfigurationProblems().length > 0) {
    return { status: "invalid", message: "Configuration du serveur incomplète : connexion impossible pour le moment." };
  }

  const admin = adminEmail();
  const origin = await requestOrigin();
  if (normalizeEmail(parsed.data.email) === admin) {
    after(async () => {
      const supabase = createStatelessClient(supabaseUrl(), supabaseAnonKey(), {
        auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await supabase.auth.signInWithOtp({
        email: admin,
        options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
      });
      if (error) {
        console.error("Envoi du lien magique impossible :", error.message);
      }
    });
  }

  return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE, email: normalizeEmail(parsed.data.email) };
}

export type LoginCodeState = { status: "idle" } | { status: "invalid"; message: string };

const LoginCodeSchema = z.object({
  email: z.email(),
  // Longueur réglable dans Supabase (6 chiffres par défaut, jusqu'à 10).
  code: z.string().regex(/^\d{6,10}$/),
});

const LOGIN_CODE_INVALID_MESSAGE = "Code incorrect ou expiré. Vérifiez l'email reçu, ou demandez un nouveau code.";

/**
 * Connexion par le code à usage unique du même email que le lien magique.
 * Tout se passe dans l'application : indispensable pour l'app installée sur
 * l'écran d'accueil d'un iPhone, dont les cookies ne sont partagés ni avec
 * Safari (lien ouvert depuis Mail) ni avec la vue Safari qu'iOS ouvre pour
 * Google (session perdue à la fermeture de l'app).
 *
 * Même réponse pour une adresse non autorisée et un code faux. Après
 * vérification, mêmes contrôles que /auth/callback.
 */
export async function verifyLoginCode(_previous: LoginCodeState, formData: FormData): Promise<LoginCodeState> {
  const parsed = LoginCodeSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    code: String(formData.get("code") ?? "").replace(/\s+/g, ""),
  });
  if (!parsed.success) {
    return { status: "invalid", message: LOGIN_CODE_INVALID_MESSAGE };
  }

  if (loginConfigurationProblems().length > 0) {
    return { status: "invalid", message: "Configuration du serveur incomplète : connexion impossible pour le moment." };
  }

  const admin = adminEmail();
  if (normalizeEmail(parsed.data.email) !== admin) {
    return { status: "invalid", message: LOGIN_CODE_INVALID_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: admin, token: parsed.data.code, type: "email" });
  if (error) {
    return { status: "invalid", message: LOGIN_CODE_INVALID_MESSAGE };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: claims } = await supabase.auth.getClaims();
  if (!isAuthorizedAdmin(user, admin, claims?.claims.amr)) {
    await supabase.auth.signOut();
    redirect("/login?error=unauthorized");
  }

  redirect("/");
}
