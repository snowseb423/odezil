import { type ReactNode, useEffect } from 'react'
import { useAuth } from './auth/AuthProvider.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { LoginScreen } from './auth/LoginScreen.tsx'
import { ConfigScreen } from './ConfigScreen.tsx'
import { env } from './env.ts'
import { navigate, useLocation } from './lib/router.ts'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { AppMark } from './ui/AppMark.tsx'
import { ToastProvider } from './ui/Toaster.tsx'
import { Button } from './ui/controls.tsx'

export function Splash({ label = 'Chargement' }: { label?: string }) {
  return (
    <div className="band grid min-h-dvh place-items-center" aria-busy="true" aria-label={label}>
      <div className="flex flex-col items-center gap-4">
        <AppMark size={72} className="motion-safe:animate-pulse" />
        {label !== 'Chargement' ? <p className="text-header-ink-2">{label}</p> : null}
      </div>
    </div>
  )
}

function CheckFailed({ message }: { message: string }) {
  const { retryCheck, signOut } = useAuth()
  return (
    <div className="band flex min-h-dvh flex-col items-start justify-end gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <AppMark size={56} />
      <h1 className="font-display text-3xl font-extrabold">Vérification impossible</h1>
      <p className="max-w-sm text-header-ink-2">{message}</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={retryCheck}>
          Réessayer
        </Button>
        <Button variant="ghost" className="text-header-ink hover:bg-surface/10" onClick={() => void signOut()}>
          Se déconnecter
        </Button>
      </div>
    </div>
  )
}

/** Après le retour de Google ou d'un lien magique : vers l'accueil. */
function LeaveCallback({ children }: { children: ReactNode }) {
  const { route } = useLocation()
  useEffect(() => {
    if (route.name === 'authCallback') navigate('/', { replace: true })
  }, [route.name])
  return route.name === 'authCallback' ? <Splash /> : children
}

function Main() {
  const { state, signOut } = useAuth()
  return (
    <div className="band flex min-h-dvh flex-col items-start justify-end gap-4 px-6 pb-12">
      <AppMark size={56} />
      <h1 className="font-display text-3xl font-extrabold">Connecté</h1>
      <p className="text-header-ink-2">{state.status === 'signedIn' ? state.user.email : ''}</p>
      <Button variant="secondary" onClick={() => void signOut()}>
        Se déconnecter
      </Button>
    </div>
  )
}

/** Garde de routes : rien de l'app sans session vérifiée (is_admin). */
function Gate() {
  const { state } = useAuth()
  switch (state.status) {
    case 'loading':
      return <Splash />
    case 'signedOut':
      // Nouvelle clé à chaque message : l'écran repart de l'état initial.
      return <LoginScreen key={state.message ?? ''} message={state.message} />
    case 'checking':
      return <Splash label="Vérification de l’accès…" />
    case 'checkFailed':
      return <CheckFailed message={state.message} />
    case 'signedIn':
      return (
        <LeaveCallback>
          <Main />
        </LeaveCallback>
      )
  }
}

export function App() {
  if (!env.configured) return <ConfigScreen missing={env.missing} />
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
      <UpdatePrompt />
    </ToastProvider>
  )
}
