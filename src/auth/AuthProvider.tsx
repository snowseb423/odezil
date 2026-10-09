// Session Supabase de l'administrateur (Google, lien magique ou code reçu
// par email), tolérante au hors ligne : un administrateur déjà vérifié reste
// dans l'app, avec ses données locales, même si le jeton ne peut pas être
// renouvelé faute de réseau. Chaque session est vérifiée (VITE_ADMIN_EMAIL
// puis RPC is_admin) avant d'ouvrir l'app ; un refus déconnecte et efface
// les données locales.
import type { AuthError } from '@supabase/supabase-js'
import { type ReactNode, createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_STORAGE_KEY, supabase } from '../data/supabase.ts'
import { env } from '../env.ts'
import { ACCESS_DENIED_MESSAGE, checkAdminAccess, normalizeEmail } from './access.ts'
import { describeExchangeError, describeRedirectError, redirectParams } from './redirect.ts'

export interface AuthUser {
  id: string
  email: string
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; message: string | null }
  /** Première vérification de l'accès en cours. */
  | { status: 'checking'; user: AuthUser }
  /** Vérification impossible (réseau, serveur) : réessayer ou se déconnecter. */
  | { status: 'checkFailed'; user: AuthUser; message: string }
  | { status: 'signedIn'; user: AuthUser }

export type AuthResult = { ok: true } | { ok: false; message: string }

interface AuthContextValue {
  state: AuthState
  sendLink(email: string): Promise<AuthResult>
  verifyCode(email: string, code: string): Promise<AuthResult>
  /** Part vers la page Google ; le résultat n'arrive qu'en cas d'échec immédiat. */
  signInWithGoogle(): Promise<AuthResult>
  signOut(): Promise<void>
  retryCheck(): void
}

/** Administrateur déjà vérifié sur cet appareil (ouverture hors ligne). */
const VERIFIED_KEY = 'eaupartagee:verified-admin'

function readVerified(): AuthUser | null {
  try {
    const raw = localStorage.getItem(VERIFIED_KEY)
    const user = raw ? (JSON.parse(raw) as Partial<AuthUser>) : null
    return user?.id && user.email ? { id: user.id, email: user.email } : null
  } catch {
    return null
  }
}

function writeVerified(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(VERIFIED_KEY, JSON.stringify(user))
    else localStorage.removeItem(VERIFIED_KEY)
  } catch {
    /* stockage indisponible */
  }
}

function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function initialState(): AuthState {
  const verified = readVerified()
  if (verified && hasStoredSession() && normalizeEmail(verified.email) === env.adminEmail) {
    return { status: 'signedIn', user: verified }
  }
  return { status: 'loading' }
}

const OFFLINE_MESSAGE = 'Pas de connexion internet. Réessayez une fois en ligne.'

export function describeAuthError(error: AuthError | Error): string {
  const status = 'status' in error ? (error.status as number | undefined) : undefined
  const code = 'code' in error ? String(error.code ?? '') : ''
  const message = error.message ?? ''
  if (!status && /fetch|network|load failed/i.test(message)) return OFFLINE_MESSAGE
  if (status === 429 || code.includes('rate_limit')) return 'Trop de demandes : patientez une minute avant de réessayer.'
  if (/database error|not allowed|non autorisée/i.test(message) || code === 'signup_disabled') return ACCESS_DENIED_MESSAGE
  if (code === 'otp_expired' || /expired|invalid/i.test(message)) return 'Code invalide ou expiré. Demandez un nouvel email.'
  return message || 'Une erreur est survenue.'
}

/**
 * Connexion Google activée dans Supabase (Authentication → Sign In /
 * Providers) ? Lu dans les réglages publics de Supabase Auth.
 * null : impossible de le savoir (hors ligne).
 */
export async function isGoogleEnabled(): Promise<boolean | null> {
  if (!supabase) return false
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseKey } })
    if (!response.ok) return null
    const settings = (await response.json()) as { external?: { google?: boolean } }
    return settings.external?.google === true
  } catch {
    return null
  }
}

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  onSignedOut,
  children,
}: {
  /** Appelé à chaque déconnexion ou refus d'accès : effacement des données locales. */
  onSignedOut?: () => Promise<void>
  children: ReactNode
}) {
  const [state, setState] = useState<AuthState>(initialState)
  const onSignedOutRef = useRef(onSignedOut)
  useEffect(() => {
    onSignedOutRef.current = onSignedOut
  })
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const clearSession = useCallback(async () => {
    writeVerified(null)
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
        /* hors ligne : on retire la session à la main ci-dessous */
      }
    }
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY)
    } catch {
      /* stockage indisponible */
    }
    try {
      await onSignedOutRef.current?.()
    } catch {
      /* effacement local impossible : rien de plus à faire */
    }
  }, [])

  /** Vérifie l'accès ; en arrière-plan, une vérification impossible ne change rien. */
  const verify = useCallback(
    async (user: AuthUser, background: boolean) => {
      const client = supabase
      if (!client) return
      const check = await checkAdminAccess({
        email: user.email,
        adminEmail: env.adminEmail,
        isAdmin: async () => {
          const { data, error } = await client.rpc('is_admin')
          return { data, error: error ? { message: error.message, code: error.code } : null }
        },
      })
      if (check.kind === 'granted') {
        writeVerified(user)
        setState((previous) =>
          previous.status === 'signedIn' && previous.user.id === user.id ? previous : { status: 'signedIn', user },
        )
        return
      }
      if (check.kind === 'denied') {
        await clearSession()
        setState({ status: 'signedOut', message: ACCESS_DENIED_MESSAGE })
        return
      }
      if (!background) setState({ status: 'checkFailed', user, message: `Vérification de l’accès impossible : ${check.message}` })
    },
    [clearSession],
  )

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    const redirectError = describeRedirectError(redirectParams(window.location))

    const { data } = client.auth.onAuthStateChange((event, session) => {
      // Pas d'appel Supabase attendu dans ce rappel (verrou interne) : différé.
      window.setTimeout(() => {
        if (!active) return
        if (session?.user) {
          const user = { id: session.user.id, email: normalizeEmail(session.user.email) }
          const verified = readVerified()
          if (verified?.id === user.id && normalizeEmail(verified.email) === env.adminEmail && user.email === env.adminEmail) {
            setState((previous) =>
              previous.status === 'signedIn' && previous.user.id === user.id ? previous : { status: 'signedIn', user },
            )
            // Revérifié à chaque ouverture en ligne : un accès retiré déconnecte.
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') void verify(user, true)
            return
          }
          if (stateRef.current.status !== 'checking') setState({ status: 'checking', user })
          void verify(user, false)
          return
        }
        if (event === 'SIGNED_OUT') {
          setState((previous) => (previous.status === 'signedOut' ? previous : { status: 'signedOut', message: null }))
          return
        }
        if (event === 'INITIAL_SESSION') {
          // Session stockée mais non renouvelable (hors ligne) : l'admin déjà
          // vérifié garde l'accès à ses données locales.
          const verified = readVerified()
          if (verified && hasStoredSession() && !navigator.onLine) {
            setState({ status: 'signedIn', user: verified })
            return
          }
          void client.auth.initialize().then(({ error }) => {
            if (!active) return
            const message = redirectError ?? (error ? describeExchangeError(error.message) : null)
            setState({ status: 'signedOut', message })
          })
        }
      }, 0)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [verify])

  const sendLink = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    if (normalizeEmail(email) !== env.adminEmail) return { ok: false, message: ACCESS_DENIED_MESSAGE }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizeEmail(email),
        options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
      })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const verifyCode = useCallback(async (email: string, code: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    try {
      const { error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token: code.replace(/\s/g, ''), type: 'email' })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    if (!navigator.onLine) return { ok: false, message: OFFLINE_MESSAGE }
    try {
      // Le navigateur part vers Google, puis revient sur /auth/callback avec
      // un code échangé contre la session (PKCE, detectSessionInUrl).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl(),
          // Choix du compte à chaque fois : le compte Google ouvert sur le
          // téléphone n'est pas forcément le compte administrateur.
          queryParams: { prompt: 'select_account' },
        },
      })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const signOut = useCallback(async () => {
    await clearSession()
    setState({ status: 'signedOut', message: null })
  }, [clearSession])

  const retryCheck = useCallback(() => {
    const current = stateRef.current
    if (current.status === 'checkFailed') {
      setState({ status: 'checking', user: current.user })
      void verify(current.user, false)
    }
  }, [verify])

  const value = useMemo(
    () => ({ state, sendLink, verifyCode, signInWithGoogle, signOut, retryCheck }),
    [state, sendLink, verifyCode, signInWithGoogle, signOut, retryCheck],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth() hors de <AuthProvider>')
  return context
}
