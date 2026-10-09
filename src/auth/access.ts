// Vérification de l'accès administrateur après connexion. Une session
// Supabase ne prouve rien (n'importe quel compte Google en obtient une) :
// 1. garde-fou d'interface : l'email doit être celui de VITE_ADMIN_EMAIL ;
// 2. la base tranche : RPC is_admin() (allowlist, email confirmé, pas de
//    session par mot de passe). La vraie protection reste la RLS.

export type AccessCheck =
  | { kind: 'granted' }
  | { kind: 'denied'; reason: 'email_mismatch' | 'not_admin' }
  /** Vérification impossible pour l'instant (réseau, serveur) : réessayer plus tard. */
  | { kind: 'unknown'; message: string }

export interface RpcResult {
  data: unknown
  error: { message: string; code?: string } | null
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export async function checkAdminAccess(input: {
  email: string | null | undefined
  adminEmail: string
  isAdmin: () => Promise<RpcResult>
}): Promise<AccessCheck> {
  if (!input.adminEmail || normalizeEmail(input.email) !== normalizeEmail(input.adminEmail)) {
    return { kind: 'denied', reason: 'email_mismatch' }
  }
  let result: RpcResult
  try {
    result = await input.isAdmin()
  } catch (error) {
    return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) }
  }
  if (result.error) {
    // Refus explicite de la base : l'appel lui-même n'est pas autorisé.
    if (result.error.code === '42501') return { kind: 'denied', reason: 'not_admin' }
    return { kind: 'unknown', message: result.error.message }
  }
  return result.data === true ? { kind: 'granted' } : { kind: 'denied', reason: 'not_admin' }
}

export const ACCESS_DENIED_MESSAGE = 'Accès non autorisé : ce compte ne peut pas utiliser EauPartagée.'
