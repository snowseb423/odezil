/**
 * Accès paresseux aux variables d'environnement : rien n'est lu au chargement
 * des modules, pour que `next build` fonctionne sans secrets.
 *
 * Les variables NEXT_PUBLIC_* doivent être lues littéralement
 * (`process.env.NEXT_PUBLIC_X`) pour être injectées dans le bundle client.
 * Les autres ne sont jamais exposées au navigateur par Next.js.
 */

function required(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return trimmed;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Adresse de l'admin, normalisée en minuscules. Serveur uniquement. */
export function adminEmail(): string {
  const email = required("ADMIN_EMAIL", process.env.ADMIN_EMAIL).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL invalide");
  }
  return email;
}

/** Clé service_role. Serveur uniquement (voir lib/supabase/service.ts). */
export function supabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Secret de hachage des tokens de partage. Serveur uniquement. */
export function shareTokenPepper(): string {
  const pepper = required("SHARE_TOKEN_PEPPER", process.env.SHARE_TOKEN_PEPPER);
  if (pepper.length < 32) {
    throw new Error("SHARE_TOKEN_PEPPER doit contenir au moins 32 caractères");
  }
  return pepper;
}
