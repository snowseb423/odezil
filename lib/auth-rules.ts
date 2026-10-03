/**
 * Règle d'autorisation admin, pure et testée. N'importe quel compte Google
 * obtient une session Supabase : seule l'adresse ADMIN_EMAIL, confirmée, est
 * acceptée, et jamais pour une session ouverte par mot de passe (claim `amr`).
 */
export type AuthUserLike = {
  email?: string | null;
  email_confirmed_at?: string | null;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * @param amr claim `amr` du JWT de la session (via getClaims()), si disponible.
 *   Le RLS (is_admin()) applique de toute façon la même règle.
 */
export function isAuthorizedAdmin(
  user: AuthUserLike | null | undefined,
  adminEmail: string,
  amr?: unknown,
): boolean {
  if (!user?.email || !user.email_confirmed_at) return false;
  const expected = normalizeEmail(adminEmail);
  if (!expected) return false;
  if (usesForbiddenAuthMethod(amr)) return false;
  return normalizeEmail(user.email) === expected;
}

export const LOGIN_ERRORS = {
  unauthorized: "Accès non autorisé : ce compte ne peut pas utiliser l'application.",
  auth: "La connexion a échoué ou le lien a expiré. Réessayez.",
  config:
    "Configuration du serveur incomplète : la connexion est impossible. Complétez les variables d'environnement (sur Vercel), puis redéployez.",
} as const;

export type LoginError = keyof typeof LOGIN_ERRORS;

export function isLoginError(value: unknown): value is LoginError {
  return typeof value === "string" && Object.hasOwn(LOGIN_ERRORS, value);
}

/**
 * Méthodes d'authentification refusées pour l'admin (claim JWT `amr`).
 * L'admin ne se connecte que par Google ou par lien magique : une session
 * ouverte par mot de passe signale un compte pré-créé par un tiers sur son
 * adresse. Même règle que public.is_admin() côté base.
 */
const FORBIDDEN_AUTH_METHODS = new Set(["password", "anonymous"]);

export function usesForbiddenAuthMethod(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: unknown) => {
    const method =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && "method" in entry
          ? (entry as { method: unknown }).method
          : null;
    return typeof method === "string" && FORBIDDEN_AUTH_METHODS.has(method);
  });
}
