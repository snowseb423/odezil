// Retour de Supabase dans l'URL de l'app (/auth/callback), après la page
// Google ou un lien magique : traduction des erreurs pour l'écran de connexion.

/**
 * Erreur renvoyée par Supabase dans l'URL de retour (lien expiré ou déjà
 * utilisé, compte Google refusé, choix abandonné…), ou null s'il n'y en a pas.
 */
export function describeRedirectError(params: URLSearchParams): string | null {
  const error = params.get('error')
  const code = params.get('error_code')
  const description = params.get('error_description') ?? ''
  if (!error && !code && !description) return null
  // Compte hors liste : la garde d'inscription refuse de le créer.
  if (code === 'signup_disabled' || /database error|not allowed|non autorisée/i.test(description)) {
    return 'Accès non autorisé : ce compte ne peut pas utiliser EauPartagée.'
  }
  if (code === 'otp_expired' || (!code && /expired|invalid/i.test(description))) {
    return 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'
  }
  // Choix du compte abandonné sur la page Google.
  if (error === 'access_denied' && !description) return 'Connexion avec Google annulée.'
  return description || 'La connexion a échoué.'
}

/** Paramètres du retour : requête (PKCE) et fragment (certaines erreurs). */
export function redirectParams(location: Pick<Location, 'search' | 'hash'>): URLSearchParams {
  const params = new URLSearchParams(location.search)
  for (const [key, value] of new URLSearchParams(location.hash.replace(/^#/, ''))) {
    if (!params.has(key)) params.set(key, value)
  }
  return params
}

/** Échec de l'échange du code PKCE (lien ouvert dans un autre navigateur, code déjà utilisé…). */
export function describeExchangeError(message: string): string {
  if (/code verifier|code_verifier|both auth code and code verifier/i.test(message)) {
    return 'Ce lien a été ouvert dans un autre navigateur que celui de la demande : saisissez plutôt le code à 6 chiffres reçu par email.'
  }
  if (/expired|invalid|already/i.test(message)) return 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'
  return 'La connexion a échoué. Réessayez.'
}
