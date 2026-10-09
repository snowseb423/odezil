// Configuration lue dans les variables d'environnement (aucune clé en dur).
// Configuration absente ou invalide : l'app refuse de démarrer et affiche le
// nom des variables en cause, jamais leur valeur.
const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL ?? '').trim().toLowerCase()

function validUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || (url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|.*\.e2e)$/.test(url.hostname))
  } catch {
    return false
  }
}

/** Noms des variables manquantes ou invalides. */
export function missingVariables(values: { url: string; key: string; adminEmail: string }): string[] {
  const missing: string[] = []
  if (!validUrl(values.url)) missing.push('VITE_SUPABASE_URL')
  if (!values.key) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY (ou VITE_SUPABASE_ANON_KEY)')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.adminEmail)) missing.push('VITE_ADMIN_EMAIL')
  return missing
}

const missing = missingVariables({ url: rawUrl, key, adminEmail })

export const env = {
  supabaseUrl: rawUrl.replace(/\/+$/, ''),
  supabaseKey: key,
  /** Garde-fou d'interface : la protection réelle est la RLS (is_admin). */
  adminEmail,
  missing,
  configured: missing.length === 0,
  appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
} as const
