import { describe, expect, it, vi } from 'vitest'
import { ACCESS_DENIED_MESSAGE, checkAdminAccess } from './access.ts'
import { describeExchangeError, describeRedirectError, redirectParams } from './redirect.ts'

const ADMIN = 'admin@example.com'

describe('vérification de l’accès après connexion', () => {
  it('un compte Google quelconque est refusé sans même interroger la base', async () => {
    const isAdmin = vi.fn<() => Promise<{ data: unknown; error: null }>>()
    const check = await checkAdminAccess({ email: 'mallory@gmail.com', adminEmail: ADMIN, isAdmin })
    expect(check).toEqual({ kind: 'denied', reason: 'email_mismatch' })
    expect(isAdmin).not.toHaveBeenCalled()
  })

  it('la bonne adresse ne suffit pas : la base doit confirmer (is_admin)', async () => {
    const denied = await checkAdminAccess({ email: ' Admin@Example.com ', adminEmail: ADMIN, isAdmin: async () => ({ data: false, error: null }) })
    expect(denied).toEqual({ kind: 'denied', reason: 'not_admin' })
    const granted = await checkAdminAccess({ email: ADMIN, adminEmail: ADMIN, isAdmin: async () => ({ data: true, error: null }) })
    expect(granted).toEqual({ kind: 'granted' })
  })

  it('un refus de droit de la base vaut refus ; une panne réseau laisse la décision en suspens', async () => {
    const forbidden = await checkAdminAccess({
      email: ADMIN,
      adminEmail: ADMIN,
      isAdmin: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }),
    })
    expect(forbidden).toEqual({ kind: 'denied', reason: 'not_admin' })
    const offline = await checkAdminAccess({
      email: ADMIN,
      adminEmail: ADMIN,
      isAdmin: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(offline).toEqual({ kind: 'unknown', message: 'Failed to fetch' })
  })

  it('sans adresse administrateur configurée, personne n’entre', async () => {
    expect(await checkAdminAccess({ email: ADMIN, adminEmail: '', isAdmin: async () => ({ data: true, error: null }) })).toEqual({
      kind: 'denied',
      reason: 'email_mismatch',
    })
  })

  it('n’accepte que la valeur true (pas une chaîne, pas null)', async () => {
    for (const data of ['true', 1, null, undefined, {}]) {
      expect((await checkAdminAccess({ email: ADMIN, adminEmail: ADMIN, isAdmin: async () => ({ data, error: null }) })).kind).toBe('denied')
    }
  })
})

const params = (query: string) => new URLSearchParams(query)

describe('erreurs au retour de Google ou d’un lien magique', () => {
  it('compte hors liste refusé par la garde d’inscription', () => {
    expect(describeRedirectError(params('error=server_error&error_description=Database+error+saving+new+user'))).toBe(ACCESS_DENIED_MESSAGE)
    expect(describeRedirectError(params('error=access_denied&error_code=signup_disabled'))).toBe(ACCESS_DENIED_MESSAGE)
  })

  it('lien expiré, choix annulé, autre erreur, aucune erreur', () => {
    expect(describeRedirectError(params('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'))).toMatch(
      /expiré/,
    )
    expect(describeRedirectError(params('error=access_denied'))).toBe('Connexion avec Google annulée.')
    expect(describeRedirectError(params('error=server_error&error_description=Unexpected'))).toBe('Unexpected')
    expect(describeRedirectError(params('code=abc'))).toBeNull()
  })

  it('lit la requête (PKCE) et le fragment', () => {
    const merged = redirectParams({ search: '?code=abc', hash: '#error=access_denied&error_description=x' })
    expect(merged.get('code')).toBe('abc')
    expect(merged.get('error_description')).toBe('x')
  })

  it('explique un lien ouvert dans un autre navigateur (code_verifier absent)', () => {
    expect(describeExchangeError('invalid request: both auth code and code verifier should be non-empty')).toMatch(/code à 6 chiffres/)
    expect(describeExchangeError('PKCE code verifier not found in storage')).toMatch(/autre navigateur/)
  })
})
