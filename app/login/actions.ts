"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { normalizeEmail } from "@/lib/auth-rules";
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
  | { status: "sent"; message: string }
  | { status: "invalid"; message: string };

const MagicLinkSchema = z.object({ email: z.email() });

const MAGIC_LINK_SENT_MESSAGE =
  "Si cette adresse est autorisée, un lien de connexion vient d'être envoyé. Il expire rapidement et ne sert qu'une fois.";

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

  return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
}
