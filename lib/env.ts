/**
 * Accès paresseux aux variables d'environnement : rien n'est lu au chargement
 * des modules, pour que `next build` fonctionne sans secrets.
 *
 * Les variables NEXT_PUBLIC_* doivent être lues littéralement
 * (`process.env.NEXT_PUBLIC_X`) pour être injectées dans le bundle client.
 * Les autres ne sont jamais exposées au navigateur par Next.js.
 */

/** Configuration absente ou invalide : l'application refuse l'accès (échec fermé). */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function required(name: string, value: string | undefined): string {
  const cleaned = clean(value);
  if (!cleaned) {
    throw new ConfigurationError(`Variable d'environnement manquante : ${name}`);
  }
  return cleaned;
}

/** Adresse email simple, sans guillemets ni espaces (erreur fréquente dans l'interface Vercel). */
const EMAIL_PATTERN = /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/;
const MIN_PEPPER_LENGTH = 32;

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Clé publique Supabase : `anon` historique ou `publishable` (sb_publishable_…),
 * selon le nom créé par l'intégration Vercel ↔ Supabase.
 */
export function supabaseAnonKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** Adresse de l'admin, normalisée en minuscules. Serveur uniquement. */
export function adminEmail(): string {
  const email = required("ADMIN_EMAIL", process.env.ADMIN_EMAIL).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ConfigurationError("ADMIN_EMAIL invalide : indiquez l'adresse seule, sans guillemets ni espaces");
  }
  return email;
}

/**
 * Clé secrète Supabase : `service_role` historique ou `secret` (sb_secret_…).
 * Serveur uniquement (voir lib/supabase/service.ts).
 */
export function supabaseServiceRoleKey(): string {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? process.env.SUPABASE_SECRET_KEY,
  );
}

/** Secret de hachage des tokens de partage. Serveur uniquement. */
export function shareTokenPepper(): string {
  const pepper = required("SHARE_TOKEN_PEPPER", process.env.SHARE_TOKEN_PEPPER);
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new ConfigurationError(`SHARE_TOKEN_PEPPER doit contenir au moins ${MIN_PEPPER_LENGTH} caractères`);
  }
  return pepper;
}

export type ConfigurationProblem = {
  /** Nom de la variable (jamais sa valeur). */
  variable: string;
  message: string;
  /** Vrai si la connexion de l'admin est impossible sans cette variable. */
  blocksLogin: boolean;
};

/**
 * Liste les variables manquantes ou invalides, sans jamais exposer leur valeur.
 * Sert au diagnostic : encadré sur /login et refus propre du callback.
 */
export function configurationProblems(): ConfigurationProblem[] {
  const checks: Array<[string, () => unknown, boolean]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl, true],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey, true],
    ["ADMIN_EMAIL", adminEmail, true],
    ["SUPABASE_SERVICE_ROLE_KEY", supabaseServiceRoleKey, false],
    ["SHARE_TOKEN_PEPPER", shareTokenPepper, false],
  ];
  const problems: ConfigurationProblem[] = [];
  for (const [variable, read, blocksLogin] of checks) {
    try {
      read();
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      problems.push({ variable, message: error.message, blocksLogin });
    }
  }
  return problems;
}

/** Problèmes qui empêchent la connexion de l'admin (callback, proxy, layout). */
export function loginConfigurationProblems(): ConfigurationProblem[] {
  return configurationProblems().filter((problem) => problem.blocksLogin);
}
